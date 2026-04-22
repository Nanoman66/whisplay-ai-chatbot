import { MeshtasticConfig } from "./types";

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  return value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const meshtasticConfig: MeshtasticConfig = {
  enabled: parseBoolean(process.env.MESHTASTIC_ENABLED, false),
  host: process.env.MESHTASTIC_HOST || "127.0.0.1",
  port: parseNumber(process.env.MESHTASTIC_PORT, 4403),
  channelIndex: parseNumber(process.env.MESHTASTIC_CHANNEL_INDEX, 0),
  pollIntervalMs: parseNumber(process.env.MESHTASTIC_POLL_INTERVAL_MS, 1000),
  receiveEnabled: parseBoolean(process.env.MESHTASTIC_RECEIVE_ENABLED, true),
};