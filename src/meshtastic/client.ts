import { meshtasticConfig } from "./config";
import {
  MeshConnectionState,
  MeshSendResult,
  MeshTextMessage,
} from "./types";

export class MeshtasticClient {
  private state: MeshConnectionState = meshtasticConfig.enabled
    ? "disconnected"
    : "disabled";

  getState(): MeshConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (!meshtasticConfig.enabled) {
      this.state = "disabled";
      return;
    }

    this.state = "connecting";

    // Placeholder for the real client integration.
    this.state = "connected";
  }

  async disconnect(): Promise<void> {
    if (!meshtasticConfig.enabled) {
      this.state = "disabled";
      return;
    }

    this.state = "disconnected";
  }

  async sendText(text: string): Promise<MeshSendResult> {
    if (!meshtasticConfig.enabled) {
      return { ok: false, error: "Meshtastic mode is disabled." };
    }

    if (!text.trim()) {
      return { ok: false, error: "Cannot send an empty message." };
    }

    return { ok: true };
  }

  onMessage(_handler: (message: MeshTextMessage) => void): void {
    // Placeholder for receive subscription support.
  }
}