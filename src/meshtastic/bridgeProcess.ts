import { ChildProcess, spawn, spawnSync } from "child_process";
import path from "path";
import { meshtasticConfig } from "./config";

export class MeshtasticBridgeProcess {
  private process: ChildProcess | null = null;

  private cleanupStaleBridgeProcess(): void {
    if (process.platform === "win32") {
      return;
    }

    try {
      spawnSync(
        "bash",
        [
          "-lc",
          `pkill -f "meshtastic_bridge.py" >/dev/null 2>&1 || true; fuser -k ${meshtasticConfig.bridgePort}/tcp >/dev/null 2>&1 || true`,
        ],
        { stdio: "ignore" },
      );
    } catch (error) {
      console.warn("[meshtastic-bridge] stale bridge cleanup failed:", error);
    }
  }

  private terminateProcess(proc: ChildProcess | null): void {
    if (!proc) {
      return;
    }

    const pid = proc.pid;

    try {
      proc.kill("SIGTERM");
    } catch (error: any) {
      if (error?.code !== "ESRCH") {
        console.warn("[meshtastic-bridge] SIGTERM failed:", error);
      }
    }

    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error: any) {
        if (error?.code !== "ESRCH") {
          console.warn("[meshtastic-bridge] SIGKILL failed:", error);
        }
      }
    }
  }

  start(): void {
    if (this.process && this.process.exitCode == null && !this.process.killed) {
      return;
    }

    this.process = null;
    this.cleanupStaleBridgeProcess();

    const scriptPath = path.resolve(__dirname, "../../python/meshtastic_bridge.py");

    const proc = spawn("python3", ["-u", scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    this.process = proc;

    proc.stdout?.on("data", (data) => {
      console.log(`[meshtastic-bridge] ${data.toString().trim()}`);
    });

    proc.stderr?.on("data", (data) => {
      console.error(`[meshtastic-bridge:stderr] ${data.toString().trim()}`);
    });

    proc.on("error", (error) => {
      console.error("[meshtastic-bridge] spawn failed:", error);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[meshtastic-bridge] exited code=${code} signal=${signal}`);
      if (this.process?.pid === proc.pid) {
        this.process = null;
      }
    });
  }

  stop(): void {
    const proc = this.process;
    this.process = null;
    this.terminateProcess(proc);
  }

  isRunning(): boolean {
    return this.process !== null && this.process.exitCode == null && !this.process.killed;
  }
}