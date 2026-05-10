import fs from "fs";
import path from "path";
import { spawn, ChildProcess } from "child_process";
import { isEmpty, noop, set } from "lodash";
import dotenv from "dotenv";
import { ttsServer, asrServer } from "../cloud-api/server";
import { pluginRegistry } from "../plugin";
import type { ASRPlugin, TTSPlugin, AudioFormat } from "../plugin";
import { ASRServer, TTSResult, TTSServer } from "../type";
import { webAudioBridge } from "./web-audio-bridge";
import { deviceBehaviorDefaults } from "../config/deviceBehaviorDefaults";
import { settingsStore } from "../core/settingsStore";
import { getIncomingMessageSoundById } from "../config/incomingMessageSounds";

export { getDynamicVoiceDetectLevel } from "./voice-detect";

dotenv.config();

const soundCardIndex = process.env.SOUND_CARD_INDEX || "1";
// Use the dmix software mixer so TTS and music playback can coexist.
// Raw "hw:X,0" is exclusive — only one process can open it at a time.
const alsaOutputDevice = process.env.ALSA_OUTPUT_DEVICE || "dmixed";
const normalizeAudioFormat = (value: string | undefined, fallback: AudioFormat): AudioFormat => {
  const normalized = (value || "").toLowerCase();
  return normalized === "wav" || normalized === "mp3" ? normalized : fallback;
};

const defaultTtsAudioFormat: AudioFormat = [TTSServer.gemini, TTSServer.piper].includes(ttsServer)
  ? "wav"
  : "mp3";

const selectedTtsPlugin = pluginRegistry.getPlugin("tts", ttsServer) as TTSPlugin | undefined;
const ttsAudioFormat: AudioFormat = normalizeAudioFormat(
  selectedTtsPlugin?.audioFormat,
  defaultTtsAudioFormat,
);

const useWavPlayer = ttsAudioFormat === "wav";

const defaultAsrAudioFormat: AudioFormat = [
  ASRServer.vosk,
  ASRServer.whisper,
  ASRServer.whisperhttp,
  ASRServer.fasterwhisper,
  ASRServer.llm8850whisper,
].includes(asrServer)
  ? "wav"
  : "mp3";

const selectedAsrPlugin = pluginRegistry.getPlugin("asr", asrServer) as ASRPlugin | undefined;

export const recordFileFormat: AudioFormat = normalizeAudioFormat(
  selectedAsrPlugin?.audioFormat,
  defaultAsrAudioFormat,
);

function startPlayerProcess() {
  if (useWavPlayer) {
    return null;
  } else {
    // use mpg123 for mp3 files
    const proc = spawn("mpg123", [
      "-",
      "--scale",
      "2",
      "-o",
      "alsa",
      "-a",
      alsaOutputDevice,
    ]);
    // Prevent EPIPE from becoming an uncaught exception when the process dies
    proc.stdin?.on("error", (err) => {
      console.error("Player stdin error:", err.message);
    });
    proc.on("error", (err) => {
      console.error("Player process error:", err.message);
    });
    return proc;
  }
}

let recordingProcessList: ChildProcess[] = [];
let currentRecordingReject: (reason?: any) => void = noop;

const resolveConfiguredSoundPath = (value: string): string => {
  if (!value) {
    return "";
  }

  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
};

const tryPlayConfiguredSoundFile = (
  configuredPath: string,
  timeoutMs: number,
): Promise<boolean> => {
  return new Promise((resolve) => {
    const filePath = resolveConfiguredSoundPath(configuredPath);

    if (!filePath || !fs.existsSync(filePath)) {
      resolve(false);
      return;
    }

    let finished = false;
    const done = (played: boolean) => {
      if (finished) {
        return;
      }
      finished = true;
      resolve(played);
    };

    const soundProcess = spawn("sox", [filePath, "-t", "alsa", alsaOutputDevice]);

    soundProcess.on("error", () => done(false));
    soundProcess.on("exit", (code) => done(code === 0));

    setTimeout(() => done(true), timeoutMs);
  });
};

const killAllRecordingProcesses = (): void => {
  recordingProcessList.forEach((child) => {
    console.log("Killing recording process", child.pid);
    try {
      child.kill("SIGINT");
    } catch (e) { }
  });
  recordingProcessList.length = 0;
};

export const playWakeupChime = async (): Promise<void> => {
  const playedConfiguredSound = await tryPlayConfiguredSoundFile(
    deviceBehaviorDefaults.sounds.wakeupSoundFile,
    1500,
  );

  if (playedConfiguredSound) {
    return;
  }

  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    const chimeProcess = spawn("sox", [
      "-n",
      "-t",
      "alsa",
      alsaOutputDevice,
      "synth",
      "0.10",
      "sine",
      "720",
      "vol",
      "0.4",
      ":",
      "synth",
      "0.12",
      "sine",
      "980",
      "vol",
      "0.35",
      ":",
      "synth",
      "0.14",
      "sine",
      "1320",
      "vol",
      "0.3",
      "fade",
      "q",
      "0.02",
      "0.30",
      "0.08",
      "gain",
      "-30",
    ]);

    chimeProcess.on("error", done);
    chimeProcess.on("exit", done);

    setTimeout(done, 1500);
  });
};

export const playIncomingMessageChime = async (): Promise<void> => {
  const currentSettings = settingsStore.getSettings();

  if (!currentSettings.soundEnabled) {
    return;
  }

  const selectedSound = getIncomingMessageSoundById(
    currentSettings.incomingMessageSoundId,
  );

  const playedSelectedSound = await tryPlayConfiguredSoundFile(
    selectedSound.file,
    1000,
  );

  if (playedSelectedSound) {
    return;
  }

  const playedConfiguredSound = await tryPlayConfiguredSoundFile(
    deviceBehaviorDefaults.sounds.incomingMessageSoundFile,
    1000,
  );

  if (playedConfiguredSound) {
    return;
  }

  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    const chimeProcess = spawn("sox", [
      "-n",
      "-t",
      "alsa",
      alsaOutputDevice,
      "synth",
      "0.08",
      "sine",
      "880",
      "vol",
      "0.35",
      ":",
      "synth",
      "0.10",
      "sine",
      "1175",
      "vol",
      "0.28",
      "fade",
      "q",
      "0.01",
      "0.18",
      "0.04",
      "gain",
      "-20",
    ]);

    chimeProcess.on("error", done);
    chimeProcess.on("exit", done);

    setTimeout(done, 1000);
  });
};

export const playIncomingMessageSoundPreview = async (): Promise<void> => {
  const currentSettings = settingsStore.getSettings();
  const selectedSound = getIncomingMessageSoundById(
    currentSettings.incomingMessageSoundId,
  );

  const playedSelectedSound = await tryPlayConfiguredSoundFile(
    selectedSound.file,
    1000,
  );

  if (playedSelectedSound) {
    return;
  }

  const playedConfiguredSound = await tryPlayConfiguredSoundFile(
    deviceBehaviorDefaults.sounds.incomingMessageSoundFile,
    1000,
  );

  if (playedConfiguredSound) {
    return;
  }

  return new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) {
        return;
      }
      finished = true;
      resolve();
    };

    const chimeProcess = spawn("sox", [
      "-n",
      "-t",
      "alsa",
      alsaOutputDevice,
      "synth",
      "0.08",
      "sine",
      "880",
      "vol",
      "0.35",
      ":",
      "synth",
      "0.10",
      "sine",
      "1175",
      "vol",
      "0.28",
      "fade",
      "q",
      "0.01",
      "0.18",
      "0.04",
      "gain",
      "-20",
    ]);

    chimeProcess.on("error", done);
    chimeProcess.on("exit", done);

    setTimeout(done, 1000);
  });
};

const recordAudio = async (
  outputPath: string,
  duration: number = 10,
  voiceDetectLevel: number = 30,
): Promise<string> => {
  // Delegate to browser microphone when web audio is enabled and a client is connected.
  if (webAudioBridge.isAvailable()) {
    console.log(`[WebAudio] Starting browser recording, max ${duration} seconds...`);
    return webAudioBridge.startRecording(outputPath, duration);
  }

  return new Promise((resolve, reject) => {
    const args = [
      "-q",
	  "-t",
      "alsa",
      "default",
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      outputPath,
      "silence",
      "1",
      "0.1",
      `${voiceDetectLevel}%`,
      "1",
      "0.7",
      `${voiceDetectLevel}%`,
    ];
    console.log(`Starting recording, maximum ${duration} seconds...`);
    currentRecordingReject = reject;
    const recordingProcess = spawn("sox", args);

    recordingProcess.on("error", (err) => {
      killAllRecordingProcesses();
      reject(err);
    });

    recordingProcess.stdout?.on("data", (data) => {
      console.log(data.toString());
    });
    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });

    recordingProcess.on("exit", (code) => {
      if (code && code !== 0) {
        killAllRecordingProcesses();
        reject(code);
        return;
      }
      resolve(outputPath);
      killAllRecordingProcesses();
    });
    recordingProcessList.push(recordingProcess);

    // Set a timeout to kill the recording process after the specified duration
    setTimeout(() => {
      if (recordingProcessList.includes(recordingProcess)) {
        killAllRecordingProcesses();
        resolve(outputPath);
      }
    }, duration * 1000);
  });
};

const recordAudioManually = (
  outputPath: string
): { result: Promise<string>; stop: () => void } => {
  // Delegate to browser microphone when web audio is enabled and a client is connected.
  if (webAudioBridge.isAvailable()) {
    console.log(`[WebAudio] Starting manual browser recording...`);
    return webAudioBridge.startManualRecording(outputPath);
  }

  let stopFunc: () => void = noop;
  const result = new Promise<string>((resolve, reject) => {
    currentRecordingReject = reject;
    const recordingProcess = spawn("sox", [
      "-q",
	  "-t",
      "alsa",
      "default",
      "-t",
      recordFileFormat,
      "-c",
      "1",
      "-r",
      "16000",
      outputPath,
    ]);

    recordingProcess.on("error", (err) => {
      killAllRecordingProcesses();
      reject(err);
    });

    recordingProcess.stderr?.on("data", (data) => {
      console.error(data.toString());
    });
    recordingProcessList.push(recordingProcess);
    stopFunc = () => {
      killAllRecordingProcesses();
    };
    recordingProcess.on("exit", () => {
      resolve(outputPath);
    });
  });
  return {
    result,
    stop: stopFunc,
  };
};

const stopRecording = (): void => {
  // Also stop any in-progress web recording.
  webAudioBridge.stopRecording();

  if (!isEmpty(recordingProcessList)) {
    killAllRecordingProcesses();
    try {
      currentRecordingReject();
    } catch (e) { }
    console.log("Recording stopped");
  } else {
    console.log("No recording process running");
  }
};

interface Player {
  isPlaying: boolean;
  process: ChildProcess | null;
}

const player: Player = {
  isPlaying: false,
  process: null,
};

const ensurePlayerProcess = (): ChildProcess | null => {
  if (!player.process) {
    player.process = startPlayerProcess();
  }
  return player.process;
};

const playAudioData = (params: TTSResult): Promise<void> => {
  // Delegate to browser speaker when web audio is enabled and a client is connected.
  if (webAudioBridge.isAvailable()) {
    console.log("[WebAudio] Sending audio to browser for playback.");
    return webAudioBridge.playAudioData(params, ttsAudioFormat);
  }

  const { duration: audioDuration, filePath, base64, buffer } = params;
  if (audioDuration <= 0 || (!filePath && !base64 && !buffer)) {
    console.log("No audio data to play, skipping playback.");
    return Promise.resolve();
  }
  // play wav file using aplay
  if (filePath) {
    return Promise.race([
      new Promise<void>((resolve) => {
        setTimeout(() => {
          resolve();
        }, audioDuration + 1000);
      }),
      new Promise<void>((resolve, reject) => {
        console.log("Playback duration:", audioDuration);
        player.isPlaying = true;
        const process = spawn("sox", [filePath, "-t", "alsa", alsaOutputDevice]);
        process.on("close", (code: number) => {
          player.isPlaying = false;
          if (code !== 0) {
            console.error(`Audio playback error: ${code}`);
            reject(code);
          } else {
            console.log("Audio playback completed");
            resolve();
          }
        });
      }),
    ]).catch((error) => {
      console.error("Audio playback error:", error);
    });
  }

  // play wav/mp3 buffer based on configured TTS format
  return new Promise((resolve, reject) => {
    const audioBuffer = base64 ? Buffer.from(base64, "base64") : buffer;
    console.log("Playback duration:", audioDuration);
    player.isPlaying = true;
    setTimeout(() => {
      resolve();
      player.isPlaying = false;
      console.log("Audio playback completed");
    }, audioDuration); // Add 1 second buffer

    if (ttsAudioFormat === "wav") {
      const process = spawn("sox", [
        "-t",
        "wav",
        "-",
        "-t",
        "alsa",
        alsaOutputDevice,
      ]);
      process.stdin?.on("error", (err) => {
        console.error("Sox stdin error:", err.message);
      });
      process.stdout?.on("data", (data) => console.log(data.toString()));
      process.stderr?.on("data", (data) => console.error(data.toString()));
      process.on("exit", (code) => {
        player.isPlaying = false;
        if (code !== 0) {
          console.error(`Audio playback error: ${code}`);
          reject(code);
        } else {
          console.log("Audio playback completed");
          resolve();
        }
      });
      process.stdin?.end(audioBuffer);
      return;
    }

    const process = ensurePlayerProcess();
    if (!process) {
      return reject(new Error("Audio player is not available."));
    }

    try {
      process.stdin?.write(audioBuffer);
    } catch (e) { }
    process.stdout?.on("data", (data) => console.log(data.toString()));
    process.stderr?.on("data", (data) => console.error(data.toString()));
    process.on("exit", (code) => {
      player.isPlaying = false;
      if (code !== 0) {
        console.error(`Audio playback error: ${code}`);
        reject(code);
      } else {
        console.log("Audio playback completed");
        resolve();
      }
    });
  });
};

const stopPlaying = (): void => {
  // Also stop any in-progress web playback.
  webAudioBridge.stopPlayback();

  if (player.isPlaying) {
    try {
      console.log("Stopping audio playback");
      const process = player.process;
      if (process) {
        process.stdin?.end();
        process.kill();
      }
    } catch { }
    player.isPlaying = false;
    player.process = null;
  } else {
    console.log("No audio currently playing");
  }
};

// Close audio player when exiting program
process.on("SIGINT", () => {
  try {
    if (player.process) {
      player.process.stdin?.end();
      player.process.kill();
    }
  } catch { }
  process.exit();
});

/**
 * Kill the persistent TTS player process to free the ALSA device.
 * Resolves once the process has fully exited AND a post-exit settling
 * delay has elapsed so that ALSA fully releases the hardware.
 * Must be paired with restoreAudioPlayer() when done.
 */
const releaseAudioPlayer = (): Promise<void> => {
  const proc = player.process;
  player.process = null;
  player.isPlaying = false;

  if (!proc) {
    return Promise.resolve();
  }

  const waitForExit = new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, 3000);

    proc.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      proc.stdin?.end();
      proc.kill();
    } catch {}
  });

  // After process exit, wait for ALSA device to fully release
  return waitForExit.then(() => new Promise((r) => setTimeout(r, 500)));
};

/**
 * Recreate the persistent TTS player process after releaseAudioPlayer().
 */
const restoreAudioPlayer = (): void => {
  if (!player.process) {
    player.process = startPlayerProcess();
  }
};

export {
  recordAudio,
  recordAudioManually,
  stopRecording,
  playAudioData,
  stopPlaying,
  releaseAudioPlayer,
  restoreAudioPlayer,
  playIncomingMessageSoundPreview,
};
