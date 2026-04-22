export type MeshtasticConfig = {
  enabled: boolean;
  host: string;
  port: number;
  channelIndex: number;
  pollIntervalMs: number;
  receiveEnabled: boolean;
};

export type MeshConnectionState =
  | "disabled"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type MeshTextMessage = {
  id?: string;
  from?: string;
  to?: string;
  text: string;
  channelIndex?: number;
  receivedAt?: number;
  rxRssi?: number;
  rxSnr?: number;
};

export type MeshSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};