import { StreamResponser } from "../StreamResponsor";
import type { MeshtasticService } from "../../meshtastic";

export type FlowName =
  | "sleep"
  | "camera"
  | "music"
  | "listening"
  | "wake_listening"
  | "asr"
  | "review_outgoing"
  | "incoming_message"
  | "answer"
  | "image"
  | "external_answer";

export type FlowStateHandler = (ctx: ChatFlowContext) => void;

export interface IncomingDisplayMessage {
  fromDisplay: string;
  receivedAtDisplay: string;
  text: string;
}

export interface ChatFlowContext {
  currentFlowName: FlowName;
  recordingsDir: string;
  currentRecordFilePath: string;
  asrText: string;
  streamResponser: StreamResponser;
  partialThinking: string;
  thinkingSentences: string[];
  answerId: number;
  enableCamera: boolean;
  knowledgePrompts: string[];
  wakeSessionActive: boolean;
  wakeSessionStartAt: number;
  wakeSessionLastSpeechAt: number;
  wakeSessionIdleTimeoutMs: number;
  wakeRecordMaxSec: number;
  wakeEndKeywords: string[];
  endAfterAnswer: boolean;
  pendingExternalReply: string;
  pendingExternalEmoji: string;
  pendingExternalImageUrl: string;
  currentExternalEmoji: string;
  isFromWakeListening: boolean;
  enterMusicAfterAnswer: boolean;
  musicDisplayText: string;
  appMode: "chatbot" | "meshtastic";
  meshtasticService: MeshtasticService | null;
  incomingMessageQueue: IncomingDisplayMessage[];
  currentIncomingMessage: IncomingDisplayMessage | null;

  transitionTo: (flowName: FlowName) => void;
  recognizeAudio: (path: string, isFromAutoListening?: boolean) => Promise<string>;
  partialThinkingCallback: (partialThinking: string) => void;
  startWakeSession: () => void;
  endWakeSession: () => void;
  shouldContinueWakeSession: () => boolean;
  shouldEndAfterAnswer: (text: string) => boolean;
  streamExternalReply: (text: string, emoji?: string) => Promise<void>;
}