import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { ASRServer } from "../../type";

const modelPath = process.env.VOSK_MODEL_PATH || "";
const asrServer = (process.env.ASR_SERVER || "").toLowerCase() as ASRServer;
const helperPath = path.resolve(__dirname, "../../../python/vosk_transcriber.py");

let isVoskInstall = false;

export const checkVoskInstallation = (): boolean => {
  if (!fs.existsSync(helperPath)) {
    console.error("Vosk helper script is missing:", helperPath);
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

if (asrServer === ASRServer.vosk) {
  isVoskInstall = checkVoskInstallation();
}

export const recognizeAudio = async (
  audioFilePath: string
): Promise<string> => {
  if (!isVoskInstall && !checkVoskInstallation()) {
    return "";
  }

  if (!fs.existsSync(audioFilePath)) {
    console.error("Audio file does not exist:", audioFilePath);
    return "";
  }

  return await new Promise<string>((resolve) => {
    const child = spawn("python3", [
      helperPath,
      "--model",
      modelPath,
      "--input",
      audioFilePath,
    ]);

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      console.error("Failed to start Vosk helper:", err?.message ?? err);
      resolve("");
    });

    child.on("close", (code, signal) => {
      if (stderr && stderr.trim()) {
        console.error("vosk helper stderr:", stderr.trim());
      }

      if (code !== 0) {
        console.error(
          `vosk helper exited with code ${code}${
            signal ? ` (signal ${signal})` : ""
          }`
        );
      }

      resolve(stdout ? stdout.trim() : "");
    });
  });
};