import fs from "fs";
import path from "path";
import { ChildProcess, spawn } from "child_process";
import { ASRServer } from "../../type";

const modelPath = process.env.VOSK_MODEL_PATH || "";
const asrServer = (process.env.ASR_SERVER || "").toLowerCase() as ASRServer;

const helperHost = process.env.VOSK_SERVER_HOST || "127.0.0.1";
const helperPort = parseInt(process.env.VOSK_SERVER_PORT || "4411", 10);
const helperScriptPath = path.resolve(
  __dirname,
  "../../../python/vosk_transcriber_server.py"
);

let isVoskInstall = false;
let helperProcess: ChildProcess | null = null;
let helperReadyPromise: Promise<void> | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const helperBaseUrl = (): string => `http://${helperHost}:${helperPort}`;

const isHelperHealthy = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${helperBaseUrl()}/health`);
    return response.ok;
  } catch {
    return false;
  }
};

export const checkVoskInstallation = (): boolean => {
  if (!fs.existsSync(helperScriptPath)) {
    console.error("Vosk helper server script is missing:", helperScriptPath);
    return false;
  }

  if (!modelPath) {
    console.error("VOSK_MODEL_PATH is not set.");
    return false;
  }

  if (!fs.existsSync(modelPath)) {
    console.error("Vosk model path does not exist:", modelPath);
    return false;
  }

  isVoskInstall = true;
  return true;
};

const ensureHelperStarted = async (): Promise<void> => {
  if (!isVoskInstall && !checkVoskInstallation()) {
    throw new Error("Vosk is not installed or configured correctly.");
  }

  if (await isHelperHealthy()) {
    return;
  }

  if (helperReadyPromise) {
    return helperReadyPromise;
  }

  helperReadyPromise = new Promise<void>((resolve, reject) => {
    let settled = false;

    helperProcess = spawn(
      "python3",
      [
        "-u",
        helperScriptPath,
        "--model",
        modelPath,
        "--host",
        helperHost,
        "--port",
        String(helperPort),
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
        },
      }
    );

    helperProcess.stdout?.setEncoding("utf8");
    helperProcess.stdout?.on("data", (chunk: string) => {
      console.log(`[vosk-helper] ${chunk.trim()}`);
    });

    helperProcess.stderr?.setEncoding("utf8");
    helperProcess.stderr?.on("data", (chunk: string) => {
      console.error(`[vosk-helper:stderr] ${chunk.trim()}`);
    });

    helperProcess.on("error", (err) => {
      if (!settled) {
        settled = true;
        helperReadyPromise = null;
        reject(err);
      }
    });

    helperProcess.on("exit", (code, signal) => {
      console.log(`[vosk-helper] exited code=${code} signal=${signal}`);
      helperProcess = null;

      if (!settled) {
        settled = true;
        helperReadyPromise = null;
        reject(
          new Error(`Vosk helper exited before ready. code=${code} signal=${signal}`)
        );
      }
    });

    void (async () => {
      for (let attempt = 1; attempt <= 120; attempt++) {
        if (await isHelperHealthy()) {
          if (!settled) {
            settled = true;
            resolve();
          }
          return;
        }
        await sleep(500);
      }

      if (!settled) {
        settled = true;
        helperReadyPromise = null;
        reject(new Error("Timed out waiting for persistent Vosk helper to become ready."));
      }
    })();
  });

  return helperReadyPromise;
};

const stopHelper = (): void => {
  if (helperProcess) {
    try {
      helperProcess.kill();
    } catch {}
    helperProcess = null;
  }
};

process.on("exit", stopHelper);

if (asrServer === ASRServer.vosk) {
  isVoskInstall = checkVoskInstallation();
  if (isVoskInstall) {
    void ensureHelperStarted().catch((error) => {
      console.error("[Vosk] failed to pre-start helper:", error);
    });
  }
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  try {
    await ensureHelperStarted();

    const response = await fetch(`${helperBaseUrl()}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input: audioFilePath }),
    });

    const payload = (await response.json()) as {
      ok?: boolean;
      text?: string;
      error?: string;
    };

    if (!response.ok || !payload.ok) {
      console.error("Persistent Vosk helper transcription failed:", payload.error);
      return "";
    }

    return (payload.text || "").trim();
  } catch (error) {
    console.error("Failed to use persistent Vosk helper:", error);
    return "";
  }
};