import { ChildProcess, spawn } from "child_process";
import path from "path";

export class MeshtasticBridgeProcess {
  private process: ChildProcess | null = null;

  start(): void {
    if (this.process) {
      return;
    }

    const scriptPath = path.resolve(__dirname, "../../python/meshtastic_bridge.py");

    this.process = spawn("python3", ["-u", scriptPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    this.process.stdout?.on("data", (data) => {
      console.log(`[meshtastic-bridge] ${data.toString().trim()}`);
    });

    this.process.stderr?.on("data", (data) => {
      console.error(`[meshtastic-bridge:stderr] ${data.toString().trim()}`);
    });

    this.process.on("exit", (code, signal) => {
      console.log(`[meshtastic-bridge] exited code=${code} signal=${signal}`);
      this.process = null;
    });
  }

  stop(): void {
    if (!this.process) {
      return;
    }

    this.process.kill();
    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null;
  }
}