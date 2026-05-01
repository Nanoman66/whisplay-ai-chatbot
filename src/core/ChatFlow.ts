import {
  getCurrentTimeTag,
  getRecordFileDurationMs,
  splitSentences,
} from "./../utils/index";
import { display } from "../device/display";
import { recognizeAudio, ttsProcessor } from "../cloud-api/server";
import { isImMode } from "../cloud-api/llm";
import { DEFAULT_EMOJI, extractEmojis } from "../utils";
import { StreamResponser } from "./StreamResponsor";
import { recordingsDir } from "../utils/dir";
import dotEnv from "dotenv";
import { WakeWordListener } from "../device/wakeword";
import { WhisplayIMBridgeServer } from "../device/im-bridge";
import { FlowStateMachine } from "./chat-flow/stateMachine";
import { flowStates } from "./chat-flow/states";
import { ChatFlowContext, FlowName, IncomingDisplayMessage, ThreadDisplayMessage } from "./chat-flow/types";
import { MeshtasticService } from "../meshtastic";
import type { MeshTextMessage } from "../meshtastic";
import { nicknameStore } from "../meshtastic/nicknameStore";
import { threadHistoryStore } from "../meshtastic/threadHistory";
import { playWakeupChime } from "../device/audio";
import { stopMusicPlayback, isMusicPlaying } from "../device/music-player";
import type { Status } from "../device/display";


dotEnv.config();

class ChatFlow implements ChatFlowContext {
  currentFlowName: FlowName = "sleep";
  recordingsDir: string = "";
  currentRecordFilePath: string = "";
  asrText: string = "";
  streamResponser: StreamResponser;
  partialThinking: string = "";
  thinkingSentences: string[] = [];
  answerId: number = 0;
  enableCamera: boolean = false;
  knowledgePrompts: string[] = [];
  wakeWordListener: WakeWordListener | null = null;
  wakeSessionActive: boolean = false;
  wakeSessionStartAt: number = 0;
  wakeSessionLastSpeechAt: number = 0;
  wakeSessionIdleTimeoutMs: number =
    parseInt(process.env.WAKE_WORD_IDLE_TIMEOUT_SEC || "60") * 1000;
  wakeRecordMaxSec: number = parseInt(
    process.env.WAKE_WORD_RECORD_MAX_SEC || "60",
  );
  wakeEndKeywords: string[] = (process.env.WAKE_WORD_END_KEYWORDS || "byebye,goodbye,stop,byebye").toLowerCase()
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  endAfterAnswer: boolean = false;
  whisplayIMBridge: WhisplayIMBridgeServer | null = null;
  pendingExternalReply: string = "";
  pendingExternalEmoji: string = "";
  pendingExternalImageUrl: string = "";
  currentExternalEmoji: string = "";
  stateMachine: FlowStateMachine;
  isFromWakeListening: boolean = false;
  enterMusicAfterAnswer: boolean = false;
  musicDisplayText: string = "";
  incomingMessageQueue: IncomingDisplayMessage[] = [];
  currentIncomingMessage: IncomingDisplayMessage | null = null;
  currentHomeSelectionId: string | null = null;
  currentOutgoingRecipientId: string | null = null;
  currentThreadPage: number = 0;
    appMode: "chatbot" | "meshtastic" =
    (process.env.APP_MODE || "chatbot").toLowerCase() === "meshtastic"
      ? "meshtastic"
      : "chatbot";
  meshtasticService: MeshtasticService | null = null;

  constructor(options: { enableCamera?: boolean } = {}) {
    console.log(`[${getCurrentTimeTag()}] ChatBot started.`);
    this.recordingsDir = recordingsDir;
    this.stateMachine = new FlowStateMachine(this, flowStates);
    this.streamResponser = new StreamResponser(
      ttsProcessor,
      (sentences: string[]) => {
        if (!this.isAnswerFlow()) return;
        const fullText = sentences.join(" ");
        let emoji = DEFAULT_EMOJI;
        if (this.currentFlowName === "external_answer") {
          emoji = this.currentExternalEmoji || extractEmojis(fullText) || emoji;
        } else {
          emoji = extractEmojis(fullText) || emoji;
        }
        display({
          status: "answering",
          emoji,
          text: fullText,
          RGB: "#0000ff",
          scroll_speed: 3,
        });
      },
      (text: string) => {
        if (!this.isAnswerFlow()) return;
        display({
          status: "answering",
          text: text || undefined,
          scroll_speed: 3,
        });
      },
      ({ charEnd, durationMs }) => {
        if (!this.isAnswerFlow()) return;
        if (!durationMs || durationMs <= 0) return;
        display({
          scroll_sync: {
            char_end: charEnd,
            duration_ms: durationMs,
          },
        });
      }
    );
    if (options?.enableCamera) {
      this.enableCamera = true;
    }

    this.initializeHomeSelection();
    this.transitionTo("sleep");
	
	if (this.appMode === "meshtastic") {
      this.meshtasticService = new MeshtasticService();
      this.meshtasticService.onIncomingMessage(this.handleIncomingMeshtasticMessage);
      this.attachMeshtasticCleanup();
      void this.startMeshtasticMode();
    }

    const wakeEnabled = (process.env.WAKE_WORD_ENABLED || "").toLowerCase();
    if (wakeEnabled === "true") {
      this.wakeWordListener = new WakeWordListener();
      this.wakeWordListener.on("wake", () => {
        if (this.currentFlowName === "sleep") {
          this.startWakeSession();
        }
      });
      this.wakeWordListener.start();
    }

    if (isImMode) {
      this.whisplayIMBridge = new WhisplayIMBridgeServer();
      this.whisplayIMBridge.on(
        "reply",
        (payload: { reply: string; emoji?: string; imagePath?: string }) => {
          this.pendingExternalReply = payload.reply;
          this.pendingExternalEmoji = payload.emoji || "";
          this.pendingExternalImageUrl = payload.imagePath || "";
          this.transitionTo("external_answer");
        },
      );
      this.whisplayIMBridge.on(
        "status",
        (payload: { status: string; emoji?: string; text?: string; tool?: string }) => {
          const statusText = payload.tool
            ? `[${payload.tool}] ${payload.text || ""}`
            : payload.text || "";
          const textInputEnabled =
            payload.status === "idle" && this.currentFlowName === "sleep";
          const statusMap: Record<string, Partial<Status>> = {
            thinking: {
              status: "Thinking",
              emoji: payload.emoji || "🤔",
              text: statusText,
              RGB: "#ff6800",
              scroll_speed: 6,
              text_input_enabled: false,
            },
            tool_calling: {
              status: "Tool calling",
              emoji: payload.emoji || "🔧",
              text: statusText,
              RGB: "#ff6800",
              scroll_speed: 4,
              text_input_enabled: false,
            },
            answering: {
              status: "answering...",
              emoji: payload.emoji || "💬",
              RGB: "#00c8a3",
              text_input_enabled: false,
            },
            idle: {
              status: "idle",
              emoji: payload.emoji || "😊",
              RGB: "#000055",
              text_input_enabled: textInputEnabled,
            },
          };
          const displayPayload = statusMap[payload.status] || {
            status: payload.status,
            emoji: payload.emoji || "🤖",
            text: statusText,
            RGB: "#ff6800",
            text_input_enabled: false,
          };
          display(displayPayload);
        },
      );
      this.whisplayIMBridge.start();
    }
  }

  private startMeshtasticMode = async (): Promise<void> => {
    if (!this.meshtasticService) {
      return;
    }

    try {
      await this.meshtasticService.start();
      console.log("[Meshtastic] service started.");
    } catch (error) {
      console.error("[Meshtastic] failed to start service:", error);
    }
  };

  private resolveIncomingSenderDisplay = (message: MeshTextMessage): string => {
    return nicknameStore.getDisplayLabel(message.from);
  };
  
    private getMeshtasticContactOptions = (): Array<{ nodeId: string | null; label: string }> => {
    return [
      { nodeId: null, label: "Channel" },
      ...nicknameStore.listKnownNodes().map((entry) => ({
        nodeId: entry.nodeId,
        label: nicknameStore.getDisplayLabel(entry.nodeId),
      })),
    ];
  };

  getHomeScreenTitle = (): string => {
    const configured = (process.env.MESHTASTIC_HOME_LABEL || "").trim();
    if (configured) {
      return configured;
    }

    const hostname = (process.env.HOSTNAME || "").trim();
    if (hostname) {
      return hostname;
    }

    return "AIMeshyPi";
  };

  initializeHomeSelection = (): void => {
    const options = this.getMeshtasticContactOptions();
    const stillValid = options.some(
      (option) => option.nodeId === this.currentHomeSelectionId,
    );

    if (!stillValid) {
      this.currentHomeSelectionId = options[0]?.nodeId ?? null;
    }
  };

  cycleHomeSelection = (): void => {
    const options = this.getMeshtasticContactOptions();
    if (!options.length) {
      this.currentHomeSelectionId = null;
      return;
    }

    const currentIndex = options.findIndex(
      (option) => option.nodeId === this.currentHomeSelectionId,
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % options.length : 0;
    this.currentHomeSelectionId = options[nextIndex].nodeId;
  };

  getHomeContactListText = (): string => {
    const options = this.getMeshtasticContactOptions();
    if (!options.length) {
      return "No contacts";
    }

    const selectedIndex = options.findIndex(
      (option) => option.nodeId === this.currentHomeSelectionId,
    );
    const normalizedSelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;

    const maxVisible = 5;
    let start = Math.max(0, normalizedSelectedIndex - Math.floor(maxVisible / 2));
    let end = Math.min(options.length, start + maxVisible);
    start = Math.max(0, end - maxVisible);

    return options.slice(start, end).map((option, index) => {
      const absoluteIndex = start + index;
      const marker = absoluteIndex === normalizedSelectedIndex ? "›" : " ";
      return `${marker} ${option.label}`;
    }).join("\n");
  };
  
    initializeOutgoingRecipientSelection = (): void => {
    const options = this.getMeshtasticContactOptions();
    const preferred = this.currentHomeSelectionId;
    const preferredExists = options.some(
      (option) => option.nodeId === preferred,
    );

    this.currentOutgoingRecipientId = preferredExists ? preferred : null;
  };

  cycleOutgoingRecipient = (): void => {
    const options = this.getMeshtasticContactOptions();
    if (!options.length) {
      this.currentOutgoingRecipientId = null;
      return;
    }

    const currentIndex = options.findIndex(
      (option) => option.nodeId === this.currentOutgoingRecipientId,
    );
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % options.length : 0;
    this.currentOutgoingRecipientId = options[nextIndex].nodeId;
  };

  getOutgoingRecipientLabel = (): string => {
    const selected = this.getMeshtasticContactOptions().find(
      (option) => option.nodeId === this.currentOutgoingRecipientId,
    );
    return selected?.label || "Channel";
  };
  
    resetThreadPage = (): void => {
    this.currentThreadPage = 0;
  };

  cycleThreadPage = (): void => {
    const messages = threadHistoryStore.getThreadEntries(this.currentHomeSelectionId);
    if (!messages.length) {
      this.currentThreadPage = 0;
      return;
    }

    const pageSize = 4;
    const maxPage = Math.max(0, Math.ceil(messages.length / pageSize) - 1);
    this.currentThreadPage = this.currentThreadPage >= maxPage ? 0 : this.currentThreadPage + 1;
  };

  getCurrentThreadMessages = (): ThreadDisplayMessage[] => {
    const messages = threadHistoryStore.getThreadEntries(this.currentHomeSelectionId);
    const pageSize = 4;
    const total = messages.length;

    if (!total) {
      return [];
    }

    const endExclusive = total - this.currentThreadPage * pageSize;
    const startInclusive = Math.max(0, endExclusive - pageSize);

    return messages
      .slice(startInclusive, Math.max(startInclusive, endExclusive))
      .map((entry) => ({
        headerText: entry.headerText,
        headerColor: entry.headerColor,
        headerAlign: entry.headerAlign,
        bodyText: entry.bodyText,
        bodyColor: entry.bodyColor,
      }));
  };

  getCurrentThreadTitle = (): string => {
    const selected = this.getMeshtasticContactOptions().find(
      (option) => option.nodeId === this.currentHomeSelectionId,
    );
    return selected?.label || "Channel";
  };

  appendOutgoingThreadMessage = (text: string, toNodeId: string | null): void => {
    threadHistoryStore.appendOutgoing({
      toNodeId,
      routeTag: toNodeId ? "DM" : "Ch",
      sentAtDisplay: this.formatIncomingTimestamp(new Date()),
      text,
      senderLabel: "You",
    });
  };

  private formatIncomingTimestamp = (date: Date): string => {
    const timeText = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const year = date.getFullYear();

    return `${timeText} ${month}/${day}/${year}`;
  };

  private showNextIncomingMessage = (): void => {
    if (this.currentIncomingMessage || this.incomingMessageQueue.length === 0) {
      return;
    }

    this.currentIncomingMessage = this.incomingMessageQueue.shift() || null;

    if (this.currentIncomingMessage && this.currentFlowName === "sleep") {
      this.transitionTo("incoming_message");
    }
  };

  private handleIncomingMeshtasticMessage = (message: MeshTextMessage): void => {
    console.log("[Meshtastic] incoming message:", message);

    const routeTag: "DM" | "Ch" = message.to === "^all" ? "Ch" : "DM";
    const fromNodeId = message.from ?? "!unknown";
    const incomingThreadId = routeTag === "Ch" ? null : fromNodeId;

    nicknameStore.touchNode(fromNodeId, {
      displayName: message.fromDisplay,
      shortName: message.fromShortName,
    });

    const fromDisplay = nicknameStore.getDisplayLabel(fromNodeId);
    const receivedAtDisplay = this.formatIncomingTimestamp(new Date());
    const text = message.text?.trim() || "";

    threadHistoryStore.appendIncoming({
      fromNodeId,
      fromDisplay,
      routeTag,
      receivedAtDisplay,
      text,
    });

    const displayMessage: IncomingDisplayMessage = {
      fromDisplay,
      routeTag,
      receivedAtDisplay,
      text,
    };

    const isBusy = [
      "listening",
      "asr",
      "review_outgoing",
      "incoming_message",
    ].includes(this.currentFlowName);

    const isViewingSameThread =
      this.currentFlowName === "thread_view" &&
      this.currentHomeSelectionId === incomingThreadId;

    if (isViewingSameThread) {
      this.resetThreadPage();
      this.transitionTo("thread_view");
      return;
    }

    this.incomingMessageQueue.push(displayMessage);

    if (!isBusy && !this.currentIncomingMessage) {
      this.currentIncomingMessage = this.incomingMessageQueue.shift() || null;
      if (this.currentIncomingMessage) {
        this.transitionTo("incoming_message");
      }
    }
  };

  private attachMeshtasticCleanup = (): void => {
    const cleanup = () => {
      if (this.meshtasticService) {
        void this.meshtasticService.stop();
      }
    };

    process.on("exit", cleanup);
  };


  async recognizeAudio(path: string, isFromAutoListening?: boolean): Promise<string> {
    if (!isFromAutoListening && (await getRecordFileDurationMs(path)) < 500) {
      console.log("Record audio too short, skipping recognition.");
      return Promise.resolve("");
    }
    console.time(`[ASR time]`);
    const result = await recognizeAudio(path);
    console.timeEnd(`[ASR time]`);
    return result;
  }

  partialThinkingCallback = (partialThinking: string): void => {
    this.partialThinking += partialThinking;
    const { sentences, remaining } = splitSentences(this.partialThinking);
    if (sentences.length > 0) {
      this.thinkingSentences.push(...sentences);
      const displayText = this.thinkingSentences.join(" ");
      display({
        status: "Thinking",
        emoji: "🤔",
        text: displayText,
        RGB: "#ff6800", // yellow
        scroll_speed: 6,
      });
    }
    this.partialThinking = remaining;
  };

  transitionTo = (flowName: FlowName): void => {
    if (flowName !== "music" && isMusicPlaying()) {
      stopMusicPlayback();
    }

    display({
      header_text: "",
      header_color: "#AAAAAA",
      body_text: "",
      body_color: "#FFFFFF",
      footer_text: "",
      footer_color: "#AAAAAA",
      body_frame_visible: false,
      body_frame_color: "#444444",
    });

    console.log(`[${getCurrentTimeTag()}] switch to:`, flowName);
    this.stateMachine.transitionTo(flowName);
    display({ text_input_enabled: flowName === "sleep" });
  };

  isAnswerFlow = (): boolean => {
    return (
      this.currentFlowName === "answer" ||
      this.currentFlowName === "external_answer"
    );
  };

  streamExternalReply = async (text: string, emoji?: string): Promise<void> => {
    if (!text) {
      this.streamResponser.endPartial();
      return;
    }
    if (emoji) {
      display({
        status: "answering",
        emoji,
        scroll_speed: 3,
      });
    }
    const { sentences, remaining } = splitSentences(text);
    const parts = [...sentences];
    if (remaining.trim()) {
      parts.push(remaining);
    }
    for (const part of parts) {
      this.streamResponser.partial(part);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    this.streamResponser.endPartial();
  };

  startWakeSession = (): void => {
    this.wakeSessionActive = true;
    this.wakeSessionStartAt = Date.now();
    this.wakeSessionLastSpeechAt = this.wakeSessionStartAt;
    this.endAfterAnswer = false;
    playWakeupChime();
    this.transitionTo("wake_listening");
  };

  endWakeSession = (): void => {
    this.wakeSessionActive = false;
    this.endAfterAnswer = false;
  };

  shouldContinueWakeSession = (): boolean => {
    if (!this.wakeSessionActive) return false;
    const last = this.wakeSessionLastSpeechAt || this.wakeSessionStartAt;
    return Date.now() - last < this.wakeSessionIdleTimeoutMs;
  };

  shouldEndAfterAnswer = (text: string): boolean => {
    const lower = text.toLowerCase();
    return this.wakeEndKeywords.some(
      (keyword) => keyword && lower.includes(keyword),
    );
  };
}

export default ChatFlow;
