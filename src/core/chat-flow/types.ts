import { StreamResponser } from "../StreamResponsor";
import type { MeshtasticService } from "../../meshtastic";
import type { AppSettings } from "../settingsStore";

export type FlowName =
  | "sleep"
  | "dormant"
  | "settings_menu"
  | "camera"
  | "music"
  | "listening"
  | "wake_listening"
  | "asr"
  | "review_outgoing"
  | "nickname_prompt"
  | "review_nickname"
  | "incoming_message"
  | "thread_view"
  | "answer"
  | "image"
  | "external_answer";

export type FlowStateHandler = (ctx: ChatFlowContext) => void;

export interface IncomingDisplayMessage {
  fromDisplay: string;
  routeTag: "DM" | "Ch";
  receivedAtDisplay: string;
  text: string;
  threadNodeId: string | null;
}

export interface ThreadDisplayMessage {
  headerText: string;
  headerColor: string;
  headerAlign: "left" | "right";
  bodyText: string;
  bodyColor: string;
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
  currentHomeSelectionId: string | null;
  currentOutgoingRecipientId: string | null;
  currentNicknameTargetId: string | null;
  nicknameDraftText: string;
  nicknameFlowMode: "create" | "rename";
  recordingPurpose: "message" | "nickname";
  incomingMessageQueue: IncomingDisplayMessage[];
  currentIncomingMessage: IncomingDisplayMessage | null;
  currentThreadPage: number;

  settings: AppSettings;
  hasUnread: boolean;
  unreadThreadKeys: Set<string>;
  lastUserInteractionAt: number;
  incomingWakeDeadlineAt: number;
  currentSettingsMenuIndex: number;

  transitionTo: (flowName: FlowName) => void;
  recognizeAudio: (path: string, isFromAutoListening?: boolean) => Promise<string>;
  partialThinkingCallback: (partialThinking: string) => void;
  startWakeSession: () => void;
  endWakeSession: () => void;
  shouldContinueWakeSession: () => boolean;
  shouldEndAfterAnswer: (text: string) => boolean;
  getHomeScreenTitle: () => string;
  initializeHomeSelection: () => void;
  cycleHomeSelection: () => void;
  getHomeContactListText: () => string;
  initializeOutgoingRecipientSelection: () => void;
  cycleOutgoingRecipient: () => void;
  getOutgoingRecipientLabel: () => string;
  getAwakeBrightness: () => number;
  streamExternalReply: (text: string, emoji?: string) => Promise<void>;
  resetThreadPage: () => void;
  cycleThreadPage: () => void;
  getCurrentThreadMessages: () => ThreadDisplayMessage[];
  getCurrentThreadTitle: () => string;
  appendOutgoingThreadMessage: (text: string, toNodeId: string | null) => void;
  shouldPromptForNickname: () => boolean;
  shouldAllowRenameNickname: () => boolean;
  prepareNicknameTargetFromHomeSelection: (mode?: "create" | "rename") => void;
  isNicknameRenameFlow: () => boolean;
  getCurrentSavedNickname: () => string | null;
  getNicknameTargetLabel: () => string;
  getFormattedNicknameDraft: () => string;
  saveNicknameDraft: () => void;
  clearNicknameDraft: () => void;

  recordUserInteraction: () => void;
  shouldEnterDormant: () => boolean;
  markThreadUnread: (nodeId: string | null) => void;
  markThreadRead: (nodeId: string | null) => void;
  markCurrentIncomingThreadRead: () => void;
  cancelAutoReturnToDormant: () => void;
  wakeFromDormant: () => void;
  dismissCurrentIncomingMessage: () => void;
  armIgnoreNextRelease: () => void;
  consumeIgnoredRelease: () => boolean;

  getSettingsMenuText: () => string;
  cycleSettingsMenuSelection: () => void;
  adjustSelectedSetting: () => void;
}