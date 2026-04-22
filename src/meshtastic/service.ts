import { MeshtasticBridgeProcess } from "./bridgeProcess";
import { MeshtasticClient } from "./client";
import { MeshTextMessage } from "./types";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return value.toLowerCase() === "true";
}

export class MeshtasticService {
  private bridgeProcess = new MeshtasticBridgeProcess();
  private client = new MeshtasticClient();
  private incomingQueue: MeshTextMessage[] = [];
  private incomingHandler: ((message: MeshTextMessage) => void) | null = null;

  readonly readAloudIncoming = parseBoolean(
    process.env.MESHTASTIC_READ_ALOUD_INCOMING,
    false,
  );

  async start(): Promise<void> {
    this.bridgeProcess.start();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    this.client.onMessage((message) => {
      this.incomingQueue.push(message);
      this.incomingHandler?.(message);
    });

    await this.client.connect();
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
    this.bridgeProcess.stop();
  }

  async sendText(text: string) {
    return this.client.sendText(text);
  }

  onIncomingMessage(handler: (message: MeshTextMessage) => void): void {
    this.incomingHandler = handler;
  }

  dequeueIncomingMessage(): MeshTextMessage | undefined {
    return this.incomingQueue.shift();
  }

  hasPendingIncomingMessages(): boolean {
    return this.incomingQueue.length > 0;
  }
}