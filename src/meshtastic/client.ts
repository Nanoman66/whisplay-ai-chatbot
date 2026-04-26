import { meshtasticConfig } from "./config";
import {
  MeshConnectionState,
  MeshSendResult,
  MeshTextMessage,
} from "./types";

type BridgeMessagesResponse = {
  ok: boolean;
  messages: MeshTextMessage[];
};

export class MeshtasticClient {
  private state: MeshConnectionState = meshtasticConfig.enabled
    ? "disconnected"
    : "disabled";

  private pollTimer: NodeJS.Timeout | null = null;
  private lastMessageSignature = "";
  private messageHandler: ((message: MeshTextMessage) => void) | null = null;

  private get baseUrl(): string {
    return `http://127.0.0.1:${meshtasticConfig.bridgePort}`;
  }

  getState(): MeshConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (!meshtasticConfig.enabled) {
      this.state = "disabled";
      return;
    }

    this.state = "connecting";

    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        throw new Error(`Bridge health check failed: ${response.status}`);
      }

      this.state = "connected";

      if (meshtasticConfig.receiveEnabled) {
        this.startPolling();
      }
    } catch (error) {
      this.state = "error";
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPolling();

    if (!meshtasticConfig.enabled) {
      this.state = "disabled";
      return;
    }

    this.state = "disconnected";
  }

  async sendText(text: string, destinationId?: string | null): Promise<MeshSendResult> {
    if (!meshtasticConfig.enabled) {
      return { ok: false, error: "Meshtastic mode is disabled." };
    }

    if (!text.trim()) {
      return { ok: false, error: "Cannot send an empty message." };
    }

    try {
      const requestBody: Record<string, unknown> = {
        text,
        channelIndex: meshtasticConfig.channelIndex,
      };

      if (destinationId) {
        requestBody.destinationId = destinationId;
      }

      const response = await fetch(`${this.baseUrl}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const body = await response.json();

      if (!response.ok || !body.ok) {
        return {
          ok: false,
          error: body.error || `Bridge send failed with status ${response.status}`,
        };
      }

      return { ok: true };
    } catch (error: any) {
      return { ok: false, error: error?.message || "Unknown send error" };
    }
  }

  onMessage(handler: (message: MeshTextMessage) => void): void {
    this.messageHandler = handler;
  }

  private startPolling(): void {
    this.stopPolling();

    this.pollTimer = setInterval(async () => {
      try {
        const response = await fetch(`${this.baseUrl}/messages`);
        if (!response.ok) return;

        const body = (await response.json()) as BridgeMessagesResponse;
        if (!body.ok || !body.messages.length) return;

        const latest = body.messages[body.messages.length - 1];
        const signature = JSON.stringify({
          from: latest.from,
          text: latest.text,
          rxTime: latest.rxTime,
        });

        if (signature !== this.lastMessageSignature) {
          this.lastMessageSignature = signature;
          this.messageHandler?.(latest);
        }
      } catch {
        // Ignore transient polling failures for now.
      }
    }, meshtasticConfig.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}