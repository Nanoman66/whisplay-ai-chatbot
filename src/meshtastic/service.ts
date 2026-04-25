import { MeshtasticBridgeProcess } from "./bridgeProcess";
import { MeshtasticClient } from "./client";
import { MeshTextMessage } from "./types";
import { meshtasticConfig } from "./config";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return value.toLowerCase() === "true";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBridgeReady(): Promise<void> {
  const maxAttempts = 30;
  const delayMs = 1000;
  const healthUrl = `http://127.0.0.1:${meshtasticConfig.bridgePort}/health`;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        console.log(`[Meshtastic] bridge ready on attempt ${attempt}.`);
        return;
      }

      lastError = new Error(`Bridge health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    console.warn(
      `[Meshtastic] waiting for bridge readiness attempt ${attempt}/${maxAttempts}.`,
      lastError,
    );

    await sleep(delayMs);
  }

  throw lastError ?? new Error("Meshtastic bridge did not become ready.");
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
	await waitForBridgeReady();

    this.client.onMessage((message) => {
      this.incomingQueue.push(message);
      this.incomingHandler?.(message);
    });

    const maxAttempts = 10;
    const delayMs = 1000;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client.connect();
        console.log(`[Meshtastic] client connected on attempt ${attempt}.`);
        return;
      } catch (error) {
        lastError = error;
        console.warn(
          `[Meshtastic] connect attempt ${attempt}/${maxAttempts} failed.`,
          error,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError ?? new Error("Meshtastic bridge failed to start.");
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