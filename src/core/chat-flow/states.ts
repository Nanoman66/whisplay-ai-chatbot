import moment from "moment";
import { compact, noop } from "lodash";
import {
  onButtonPressed,
  onButtonReleased,
  onButtonDoubleClick,
  display,
  getCurrentStatus,
  onCameraCapture,
  onTextInput,
  isButtonDown,
} from "../../device/display";
import {
  recordAudio,
  recordAudioManually,
  recordFileFormat,
  getDynamicVoiceDetectLevel,
} from "../../device/audio";
import { chatWithLLMStream } from "../../cloud-api/server";
import { isImMode } from "../../cloud-api/llm";
import { getSystemPromptWithKnowledge } from "../Knowledge";
import { enableRAG } from "../../cloud-api/knowledge";
import { cameraDir } from "../../utils/dir";
import {
  clearPendingCapturedImgForChat,
  getLatestGenImg,
  getLatestDisplayImg,
  setLatestCapturedImg,
  setPendingCapturedImgForChat,
} from "../../utils/image";
import { sendWhisplayIMMessage } from "../../cloud-api/whisplay-im/whisplay-im";
import { ChatFlowContext, FlowName, FlowStateHandler } from "./types";
import {
  enterCameraMode,
  handleCameraModePress,
  handleCameraModeRelease,
  onCameraModeExit,
  resetCameraModeControl,
} from "./camera-mode";
import { DEFAULT_EMOJI } from "../../utils";
import { isMusicPlaying, getCurrentTrackTitle, stopMusicPlayback, startPendingMusicPlayback, onMusicTrackChange, onMusicPlaybackEnd } from "../../device/music-player";
import { buildFooterLegend, FOOTER_LEGEND_COLOR } from "./footerLegend";

export const flowStates: Record<FlowName, FlowStateHandler> = {
  sleep: (ctx: ChatFlowContext) => {
    if (ctx.appMode === "meshtastic") {
      let longPressTimer: NodeJS.Timeout | null = null;
      let longPressHandled = false;
      let tapCount = 0;
      let tapTimer: NodeJS.Timeout | null = null;
      let renameHoldCandidate = false;

      const resetTapState = () => {
        tapCount = 0;
        renameHoldCandidate = false;
        if (tapTimer) {
          clearTimeout(tapTimer);
          tapTimer = null;
        }
      };

      const renderHomeScreen = () => {
        ctx.initializeHomeSelection();
        const homeList = ctx.getHomeContactListText();

        display({
          status: ctx.getHomeScreenTitle(),
          emoji: "",
          top_center_text: "{time}",
          RGB: "#000055",
          rag_icon_visible: false,
          header_text: "",
          header_color: "#AAAAAA",
          body_text: homeList,
          body_color: "#FFFFFF",
          footer_text: buildFooterLegend({
            single: "next",
            double: "select",
            long: "dictate",
          }),
          footer_color: FOOTER_LEGEND_COLOR,
          body_frame_visible: true,
          body_frame_color: "#444444",
          text: homeList,
        });
      };

      onButtonDoubleClick(null);

      onButtonPressed(() => {
        resetCameraModeControl();
        stopMusicPlayback();

        longPressHandled = false;

        const canStartNicknameHold =
          tapCount === 1 &&
          Boolean(tapTimer) &&
          Boolean(ctx.currentHomeSelectionId);

        if (canStartNicknameHold) {
          renameHoldCandidate = true;

          if (tapTimer) {
            clearTimeout(tapTimer);
            tapTimer = null;
          }

          longPressTimer = setTimeout(() => {
            if (!isButtonDown()) {
              return;
            }
            longPressHandled = true;
            renameHoldCandidate = false;
            resetTapState();

            const nicknameMode = ctx.shouldAllowRenameNickname()
              ? "rename"
              : "create";

            ctx.prepareNicknameTargetFromHomeSelection(nicknameMode);
            ctx.transitionTo("nickname_prompt");
          }, 700);
          return;
        }

        longPressTimer = setTimeout(() => {
          if (!isButtonDown()) {
            return;
          }
          longPressHandled = true;
          resetTapState();
          ctx.recordingPurpose = "message";
          ctx.transitionTo("listening");
        }, 700);
      });

      onButtonReleased(() => {
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }

        if (longPressHandled) {
          return;
        }

        tapCount += 1;

        if (tapCount === 1) {
          tapTimer = setTimeout(() => {
            if (tapCount === 1) {
              ctx.cycleHomeSelection();
              renderHomeScreen();
            }
            resetTapState();
          }, 450);
          return;
        }

        if (tapCount === 2) {
          resetTapState();

          if (ctx.currentHomeSelectionId && ctx.shouldPromptForNickname()) {
            ctx.prepareNicknameTargetFromHomeSelection("create");
            ctx.transitionTo("nickname_prompt");
            return;
          }

          ctx.transitionTo("thread_view");
        }
      });

      onCameraModeExit(null);

      onTextInput((text: string) => {
        if (ctx.currentFlowName !== "sleep") return;
        ctx.answerId += 1;
        ctx.asrText = text;
        display({ status: "recognizing", text, text_input_enabled: false });
        ctx.transitionTo("review_outgoing");
      });

      if (
        !ctx.currentIncomingMessage &&
        ctx.incomingMessageQueue.length > 0
      ) {
        ctx.currentIncomingMessage = ctx.incomingMessageQueue.shift() || null;
        ctx.transitionTo("incoming_message");
        return;
      }

      renderHomeScreen();
      return;
    }

    onButtonPressed(() => {
      resetCameraModeControl();
      // Stop any playing music when waking up
      stopMusicPlayback();
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
    onCameraModeExit(null);
    onTextInput((text: string) => {
	  if (ctx.currentFlowName !== "sleep") return;
      ctx.answerId += 1;
      ctx.asrText = text;
      display({ status: "recognizing", text, text_input_enabled: false });
      if (ctx.appMode === "meshtastic") {
        ctx.transitionTo("review_outgoing");
      } else {
        ctx.transitionTo("answer");
      }
    });
    if (ctx.enableCamera) {
      const captureImgPath = `${cameraDir}/capture-${moment().format(
        "YYYYMMDD-HHmmss",
      )}.jpg`;
      onButtonDoubleClick(() => {
        enterCameraMode(captureImgPath);
        ctx.transitionTo("camera");
      });
    }

    display({
      status: "idle",
      emoji: "😴",
      RGB: "#000055",
      rag_icon_visible: false,
      ...(getCurrentStatus().text.endsWith("Listening...") || !getCurrentStatus().text
        ? {
            text: `Long Press the button to say something${ctx.enableCamera ? ",\ndouble click to launch camera" : ""
              }.`,
          }
        : {}),
    });
  },
  camera: (ctx: ChatFlowContext) => {
    onButtonDoubleClick(null);
    onButtonPressed(() => {
      handleCameraModePress();
    });
    onButtonReleased(() => {
      handleCameraModeRelease();
    });
    onCameraCapture(() => {
      const captureImagePath = getCurrentStatus().capture_image_path;
      if (!captureImagePath) {
        return;
      }
      setLatestCapturedImg(captureImagePath);
      setPendingCapturedImgForChat(captureImagePath);
      display({ image_icon_visible: true });
    });
    onCameraModeExit(() => {
      if (ctx.currentFlowName === "camera") {
        ctx.transitionTo("sleep");
      }
    });
    display({
      status: "camera",
      emoji: "📷",
      RGB: "#00ff88",
    });
  },
  music: (ctx: ChatFlowContext) => {
    // Start deferred music playback when entering music state
    startPendingMusicPlayback();

    // Update display when track changes during continuous playback
    onMusicTrackChange((title) => {
      if (ctx.currentFlowName === "music") {
        display({ text: `Now playing: ${title}` });
      }
    });

    // Return to sleep when non-continuous playback finishes
    onMusicPlaybackEnd(() => {
      if (ctx.currentFlowName === "music") {
        onMusicTrackChange(null);
        onMusicPlaybackEnd(null);
        ctx.transitionTo("sleep");
      }
    });

    onButtonDoubleClick(null);
    onButtonPressed(() => {
      // Stop music immediately when button is pressed
      onMusicTrackChange(null);
      onMusicPlaybackEnd(null);
      stopMusicPlayback();
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);

    const trackTitle = getCurrentTrackTitle();
    display({
      status: "music",
      emoji: "🎹",
      RGB: "#0066aa",
      text:
        ctx.musicDisplayText ||
        (isMusicPlaying() && trackTitle
          ? `Now playing: ${trackTitle}`
          : "Music mode. Press the button to talk."),
      rag_icon_visible: false,
    });
  },
  listening: (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    ctx.isFromWakeListening = false;
    ctx.answerId += 1;
    ctx.wakeSessionActive = false;
    ctx.endAfterAnswer = false;
    onButtonDoubleClick(null);
    ctx.currentRecordFilePath = `${ctx.recordingsDir}/user-${Date.now()}.${recordFileFormat}`;
    onButtonPressed(noop);

    const listeningStartedAt = Date.now();

    if (!isButtonDown()) {
      console.log("[listening] Button already released, returning to sleep");
      ctx.transitionTo("sleep");
      return;
    }

    let releaseHandled = false;
    let transitionHandled = false;
    let releaseWatchdog: NodeJS.Timeout | null = null;
    let asrFallbackTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      if (releaseWatchdog) {
        clearInterval(releaseWatchdog);
        releaseWatchdog = null;
      }
      if (asrFallbackTimer) {
        clearTimeout(asrFallbackTimer);
        asrFallbackTimer = null;
      }
    };

    const transitionToSleepOnce = () => {
      if (transitionHandled) {
        return;
      }
      transitionHandled = true;
      clearTimers();
      ctx.transitionTo("sleep");
    };

    const transitionToAsrOnce = () => {
      if (transitionHandled) {
        return;
      }
      transitionHandled = true;
      clearTimers();
      ctx.transitionTo("asr");
    };

    const { result, stop } = recordAudioManually(ctx.currentRecordFilePath);

    const handleRelease = () => {
      if (releaseHandled) {
        return;
      }

      releaseHandled = true;

      if (releaseWatchdog) {
        clearInterval(releaseWatchdog);
        releaseWatchdog = null;
      }

      if (Date.now() - listeningStartedAt < 500) {
        console.log("[listening] Button released too quickly, returning to sleep");
        stop();
        transitionToSleepOnce();
        return;
      }

      stop();
      display({
        RGB: "#ff6800",
        image: "",
      });

      asrFallbackTimer = setTimeout(() => {
        console.warn("[listening] forcing transition to asr after recorder stop timeout");
        transitionToAsrOnce();
      }, 1500);
    };

    onButtonReleased(handleRelease);

    releaseWatchdog = setInterval(() => {
      if (!releaseHandled && !isButtonDown()) {
        console.log("[listening] Release watchdog fired");
        handleRelease();
      }
    }, 75);

    result
      .then(() => {
        transitionToAsrOnce();
      })
      .catch((err) => {
        if (transitionHandled) {
          return;
        }
        console.error("Error during recording:", err);
        transitionToSleepOnce();
      });

    display({
      status: "listening",
      emoji: DEFAULT_EMOJI,
      RGB: "#00ff00",
      text: "Listening...",
      footer_text: buildFooterLegend({
        long: "release to transcribe",
      }),
      footer_color: FOOTER_LEGEND_COLOR,
      rag_icon_visible: false,
    });
  },
  wake_listening: (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    ctx.isFromWakeListening = true;
    ctx.answerId += 1;
    ctx.currentRecordFilePath = `${ctx.recordingsDir
      }/user-${Date.now()}.${recordFileFormat}`;
    onButtonPressed(() => {
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
    display({
      status: "detecting",
      emoji: DEFAULT_EMOJI,
      RGB: "#00ff00",
      text: "Detecting voice level...",
      rag_icon_visible: false,
    });
    getDynamicVoiceDetectLevel().then((level) => {
      display({
        status: "listening",
        emoji: DEFAULT_EMOJI,
        RGB: "#00ff00",
        text: `(Detect level: ${level}%) Listening...`,
        rag_icon_visible: false,
      });
      recordAudio(ctx.currentRecordFilePath, ctx.wakeRecordMaxSec, level)
        .then(() => {
          ctx.transitionTo("asr");
        })
        .catch((err) => {
          console.error("Error during auto recording:", err);
          ctx.endWakeSession();
          ctx.transitionTo("sleep");
        });
    });
  },
  asr: (ctx: ChatFlowContext) => {
    display({
      status: "recognizing",
    });
    onButtonDoubleClick(null);
    Promise.race([
      ctx.recognizeAudio(ctx.currentRecordFilePath, ctx.isFromWakeListening),
      new Promise<string>((resolve) => {
        onButtonPressed(() => {
          resolve("[UserPress]");
        });
        onButtonReleased(noop);
      }),
    ]).then((result) => {
      if (ctx.currentFlowName !== "asr") return;
      if (result === "[UserPress]") {
        ctx.transitionTo("listening");
        return;
      }
      if (result) {
        console.log("Audio recognized result:", result);

        if (ctx.recordingPurpose === "nickname") {
          ctx.nicknameDraftText = result;
          ctx.recordingPurpose = "message";
          display({ status: "recognizing", text: result });
          ctx.transitionTo("review_nickname");
          return;
        }

		ctx.asrText = result;
		ctx.endAfterAnswer = ctx.shouldEndAfterAnswer(result);
		if (ctx.wakeSessionActive) {
		  ctx.wakeSessionLastSpeechAt = Date.now();
		}
		display({ status: "recognizing", text: result });
		if (ctx.appMode === "meshtastic") {
		  ctx.transitionTo("review_outgoing");
		} else {
		  ctx.transitionTo("answer");
		}
		return;
      }
      if (ctx.recordingPurpose === "nickname") {
        ctx.transitionTo("nickname_prompt");
        return;
      }

      if (ctx.wakeSessionActive) {
        if (ctx.shouldContinueWakeSession()) {
          ctx.transitionTo("wake_listening");
        } else {
          ctx.endWakeSession();
          ctx.transitionTo("sleep");
        }
        return;
      }
      ctx.transitionTo("sleep");
    });
  },
 review_outgoing: (ctx: ChatFlowContext) => {
  let longPressTimer: NodeJS.Timeout | null = null;
  let longPressHandled = false;
  let tapCount = 0;
  let tapTimer: NodeJS.Timeout | null = null;
  let isSending = false;

  ctx.initializeOutgoingRecipientSelection();

  const renderReviewScreen = () => {
    const recipientLabel = ctx.getOutgoingRecipientLabel();

    display({
      status: "review",
      emoji: "📝",
      RGB: "#ffaa00",
      header_text: `To: ${recipientLabel}`,
      header_color: "#00c8a3",
      body_text: ctx.asrText,
      body_color: "#FFFFFF",
      footer_text: buildFooterLegend({
        single: "switch To:",
        double: "send",
        long: "discard",
      }),
      footer_color: FOOTER_LEGEND_COLOR,
      text: `To: ${recipientLabel}\n${ctx.asrText}`,
      rag_icon_visible: false,
    });
  };

  const resetTapState = () => {
    tapCount = 0;
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
    }
  };

  const discardAndReturnToSleep = () => {
    resetTapState();
    ctx.asrText = "";
    display({
      status: "idle",
      emoji: "😴",
      RGB: "#000055",
      text: "Message discarded.",
      footer_text: "",
      footer_color: FOOTER_LEGEND_COLOR,
    });
    setTimeout(() => {
      if (ctx.currentFlowName === "review_outgoing") {
        ctx.transitionTo("sleep");
      }
    }, 800);
  };

  const sendMessage = async () => {
    if (isSending) return;
    isSending = true;
    resetTapState();

    display({
      status: "sending",
      emoji: "📡",
      RGB: "#00c8a3",
      text: "Sending...",
      footer_text: "",
      footer_color: FOOTER_LEGEND_COLOR,
    });

    if (!ctx.meshtasticService) {
      display({
        status: "error",
        emoji: "⚠️",
        RGB: "#ff0000",
        text: "Meshtastic service unavailable.",
        footer_text: "",
        footer_color: FOOTER_LEGEND_COLOR,
      });
      setTimeout(() => ctx.transitionTo("sleep"), 1500);
      return;
    }

    const result = await ctx.meshtasticService.sendText(
      ctx.asrText,
      ctx.currentOutgoingRecipientId,
    );

    if (result.ok) {
      ctx.appendOutgoingThreadMessage(ctx.asrText, ctx.currentOutgoingRecipientId);

      display({
        status: "sent",
        emoji: "✅",
        RGB: "#00aa55",
        text: "Message sent.",
        footer_text: "",
        footer_color: FOOTER_LEGEND_COLOR,
      });
    } else {
      display({
        status: "error",
        emoji: "⚠️",
        RGB: "#ff0000",
        text: result.error || "Send failed.",
        footer_text: "",
        footer_color: FOOTER_LEGEND_COLOR,
      });
    }

    setTimeout(() => {
      ctx.transitionTo("sleep");
    }, 1500);
  };

  onButtonDoubleClick(null);

  onButtonPressed(() => {
    if (isSending) return;
    longPressTimer = setTimeout(() => {
      if (!isButtonDown()) {
        return;
      }
      longPressHandled = true;
      discardAndReturnToSleep();
    }, 1200);
  });

  onButtonReleased(() => {
    if (isSending) return;

    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    if (longPressHandled) {
      return;
    }

    tapCount += 1;

    if (tapCount === 1) {
      tapTimer = setTimeout(() => {
        if (tapCount === 1) {
          ctx.cycleOutgoingRecipient();
          renderReviewScreen();
        }
        resetTapState();
      }, 700);
      return;
    }

    if (tapCount === 2) {
      void sendMessage();
    }
  });

  renderReviewScreen();
},

  nickname_prompt: (ctx: ChatFlowContext) => {
    let longPressTimer: NodeJS.Timeout | null = null;
    let longPressHandled = false;

    const continueToThread = () => {
      ctx.clearNicknameDraft();
      ctx.transitionTo("thread_view");
    };

    onButtonDoubleClick(null);

    onButtonPressed(() => {
      longPressHandled = false;
      longPressTimer = setTimeout(() => {
        if (!isButtonDown()) {
          return;
        }
        longPressHandled = true;
        ctx.recordingPurpose = "nickname";
        ctx.transitionTo("listening");
      }, 700);
    });

    onButtonReleased(() => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (longPressHandled) {
        return;
      }

      continueToThread();
    });

    const isRenameFlow = ctx.isNicknameRenameFlow();
    const currentSavedNickname = ctx.getCurrentSavedNickname();
    const promptStatus = isRenameFlow ? "Rename?" : "Nickname?";
    const promptBody = isRenameFlow
      ? currentSavedNickname
        ? `Current nickname: ${currentSavedNickname}\nWould you like to rename this recipient?`
        : "Would you like to rename this recipient?"
      : "Would you like to nickname this recipient?";

    display({
      status: promptStatus,
      emoji: "🏷️",
      RGB: "#6633aa",
      header_text: `Recipient: ${ctx.getNicknameTargetLabel()}`,
      header_color: "#00c8a3",
      body_text: promptBody,
      body_color: "#FFFFFF",
      footer_text: buildFooterLegend({
        single: "No",
        long: "Hold to record nickname",
      }),
      footer_color: FOOTER_LEGEND_COLOR,
      body_frame_visible: true,
      body_frame_color: "#444444",
      text: `Recipient: ${ctx.getNicknameTargetLabel()}\n${promptBody}`,
    });
  },

  review_nickname: (ctx: ChatFlowContext) => {
    let longPressTimer: NodeJS.Timeout | null = null;
    let longPressHandled = false;
    let tapCount = 0;
    let tapTimer: NodeJS.Timeout | null = null;
    let isSaving = false;

    const resetTapState = () => {
      tapCount = 0;
      if (tapTimer) {
        clearTimeout(tapTimer);
        tapTimer = null;
      }
    };

    const renderReviewNickname = () => {
      const targetLabel = ctx.getNicknameTargetLabel();
      const isRenameFlow = ctx.isNicknameRenameFlow();
      const formattedNickname =
        ctx.getFormattedNicknameDraft() || ctx.nicknameDraftText;

      display({
        status: isRenameFlow ? "rename" : "nickname",
        emoji: "🏷️",
        RGB: "#6633aa",
        header_text: `${isRenameFlow ? "Rename nickname for" : "Nickname for"}: ${targetLabel}`,
        header_color: "#00c8a3",
        body_text: formattedNickname,
        body_color: "#FFFFFF",
        footer_text: buildFooterLegend({
          single: "rerecord",
          double: "save",
          long: "cancel",
        }),
        footer_color: FOOTER_LEGEND_COLOR,
        body_frame_visible: true,
        body_frame_color: "#444444",
        text: `Nickname for: ${targetLabel}\n${formattedNickname}`,
      });
    };

    const cancelNickname = () => {
      resetTapState();
      ctx.clearNicknameDraft();
      ctx.transitionTo("thread_view");
    };

    const saveNickname = () => {
      if (isSaving) {
        return;
      }

      isSaving = true;
      resetTapState();

      try {
        ctx.saveNicknameDraft();
      } catch (error: any) {
        display({
          status: "error",
          emoji: "⚠️",
          RGB: "#ff0000",
          text: error?.message || "Nickname save failed.",
          footer_text: "",
          footer_color: FOOTER_LEGEND_COLOR,
        });

        setTimeout(() => {
          if (ctx.currentFlowName === "review_nickname") {
            ctx.clearNicknameDraft();
            ctx.transitionTo("thread_view");
          }
        }, 1200);

        return;
      }

      const savedLabel = ctx.getNicknameTargetLabel();

      display({
        status: "saved",
        emoji: "✅",
        RGB: "#00aa55",
        text: `Nickname saved: ${savedLabel}`,
        footer_text: "",
        footer_color: FOOTER_LEGEND_COLOR,
      });

      setTimeout(() => {
        ctx.clearNicknameDraft();
        ctx.transitionTo("thread_view");
      }, 900);
    };

    onButtonDoubleClick(null);

    onButtonPressed(() => {
      if (isSaving) {
        return;
      }

      longPressHandled = false;
      longPressTimer = setTimeout(() => {
        if (!isButtonDown()) {
          return;
        }

        longPressHandled = true;
        cancelNickname();
      }, 1200);
    });

    onButtonReleased(() => {
      if (isSaving) {
        return;
      }

      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (longPressHandled) {
        return;
      }

      tapCount += 1;

      if (tapCount === 1) {
        tapTimer = setTimeout(() => {
          if (tapCount === 1) {
            ctx.nicknameDraftText = "";
            ctx.recordingPurpose = "message";
            ctx.transitionTo("nickname_prompt");
          }
          resetTapState();
        }, 700);
        return;
      }

      if (tapCount === 2) {
        saveNickname();
      }
    });

    renderReviewNickname();
  },

  thread_view: (ctx: ChatFlowContext) => {
    let longPressTimer: NodeJS.Timeout | null = null;
    let longPressHandled = false;
    let tapCount = 0;
    let tapTimer: NodeJS.Timeout | null = null;

    ctx.resetThreadPage();

    const resetTapState = () => {
      tapCount = 0;
      if (tapTimer) {
        clearTimeout(tapTimer);
        tapTimer = null;
      }
    };

    const renderThreadView = () => {
      const title = ctx.getCurrentThreadTitle();
      const messages = ctx.getCurrentThreadMessages();
      const hasMessages = messages.length > 0;
      const fallbackText = hasMessages ? "" : "No messages yet.";

      display({
        status: title,
        emoji: "",
        top_center_text: "{time}",
        RGB: "#000055",
        rag_icon_visible: false,
        header_text: "",
        header_color: "#AAAAAA",
        body_text: fallbackText,
        body_color: "#FFFFFF",
        thread_messages: messages.map((msg) => ({
          headerText: msg.headerText,
          headerColor: msg.headerColor,
          headerAlign: msg.headerAlign,
          bodyText: msg.bodyText,
          bodyColor: msg.bodyColor,
        })),
        footer_text: buildFooterLegend({
          single: "scroll",
          double: "back",
          long: "dictate",
        }),
        footer_color: FOOTER_LEGEND_COLOR,
        body_frame_visible: true,
        body_frame_color: "#444444",
        text: fallbackText,
      });
    };

    onButtonDoubleClick(null);

    onButtonPressed(() => {
      longPressHandled = false;
        longPressTimer = setTimeout(() => {
          if (!isButtonDown()) {
            return;
          }
          longPressHandled = true;
          resetTapState();
          ctx.recordingPurpose = "message";
          ctx.transitionTo("listening");
        }, 700);
    });

    onButtonReleased(() => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }

      if (longPressHandled) {
        return;
      }

      tapCount += 1;

      if (tapCount === 1) {
        tapTimer = setTimeout(() => {
          if (tapCount === 1) {
            ctx.cycleThreadPage();
            renderThreadView();
          }
          resetTapState();
        }, 450);
        return;
      }

      if (tapCount === 2) {
        resetTapState();
        ctx.transitionTo("sleep");
      }
    });

    renderThreadView();
  },

  incoming_message: (ctx: ChatFlowContext) => {
    if (!ctx.currentIncomingMessage) {
      if (ctx.incomingMessageQueue.length > 0) {
        ctx.currentIncomingMessage = ctx.incomingMessageQueue.shift() || null;
      }
    }

    if (!ctx.currentIncomingMessage) {
      ctx.transitionTo("sleep");
      return;
    }

    const dismissCurrentMessage = () => {
      ctx.currentIncomingMessage = null;

      if (ctx.incomingMessageQueue.length > 0) {
        ctx.currentIncomingMessage = ctx.incomingMessageQueue.shift() || null;
        ctx.transitionTo("incoming_message");
      } else {
        ctx.transitionTo("sleep");
      }
    };

    onButtonDoubleClick(null);
    onButtonPressed(noop);
    onButtonReleased(() => {
      dismissCurrentMessage();
    });

    display({
      status: "incoming",
      emoji: "📨",
      RGB: "#0088ff",
      rag_icon_visible: false,
      header_text: `${ctx.currentIncomingMessage.fromDisplay}  ${ctx.currentIncomingMessage.routeTag}  ${ctx.currentIncomingMessage.receivedAtDisplay}`,
      header_color: "#ff5555",
      body_text: ctx.currentIncomingMessage.text,
      body_color: "#FFFFFF",
      footer_text: buildFooterLegend({
        single: "dismiss",
      }),
      footer_color: FOOTER_LEGEND_COLOR,
      text: `${ctx.currentIncomingMessage.fromDisplay}  ${ctx.currentIncomingMessage.routeTag}  ${ctx.currentIncomingMessage.receivedAtDisplay}\n${ctx.currentIncomingMessage.text}`,
    });
  },

  answer: (ctx: ChatFlowContext) => {
    ctx.enterMusicAfterAnswer = false;
    ctx.musicDisplayText = "";
    display({
      status: "answering...",
      RGB: "#00c8a3",
    });
    const currentAnswerId = ctx.answerId;
    if (isImMode) {
      const prompt: {
        role: "system" | "user";
        content: string;
      }[] = [
          {
            role: "user",
            content: ctx.asrText,
          },
        ];
      sendWhisplayIMMessage(prompt)
        .then((ok) => {
          if (ok) {
            display({
              status: "idle",
              emoji: "😊",
              RGB: "#000055",
              image_icon_visible: false,
            });
          } else {
            display({
              status: "error",
              emoji: "⚠️",
              text: "OpenClaw send failed",
              image_icon_visible: false,
            });
          }
        })
        .finally(() => {
          clearPendingCapturedImgForChat();
          ctx.transitionTo("sleep");
        });
      return;
    }
    onButtonPressed(() => {
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
    const {
      partial,
      endPartial,
      getPlayEndPromise,
      stop: stopPlaying,
    } = ctx.streamResponser;
    ctx.partialThinking = "";
    ctx.thinkingSentences = [];
    [() => Promise.resolve().then(() => ""), getSystemPromptWithKnowledge]
    [enableRAG ? 1 : 0](ctx.asrText)
      .then((res: string) => {
        let knowledgePrompt = res;
        if (res) {
          console.log("Retrieved knowledge for RAG:\n", res);
        }
        if (ctx.knowledgePrompts.includes(res)) {
          console.log(
            "[RAG] Knowledge prompt already used in this session, skipping to avoid repetition.",
          );
          knowledgePrompt = "";
        }
        if (knowledgePrompt) {
          ctx.knowledgePrompts.push(knowledgePrompt);
        }
        display({
          rag_icon_visible: Boolean(enableRAG && knowledgePrompt),
        });
        const prompt: {
          role: "system" | "user";
          content: string;
        }[] = compact([
          knowledgePrompt
            ? {
              role: "system",
              content: knowledgePrompt,
            }
            : null,
          {
            role: "user",
            content: ctx.asrText,
          },
        ]);
        chatWithLLMStream(
          prompt,
          (text) => currentAnswerId === ctx.answerId && partial(text),
          () => currentAnswerId === ctx.answerId && endPartial(),
          (partialThinking) =>
            currentAnswerId === ctx.answerId &&
            ctx.partialThinkingCallback(partialThinking),
          (functionName: string, result?: string) => {
            if (
              functionName === "endConversation" &&
              result?.startsWith("[success]")
            ) {
              ctx.endAfterAnswer = true;
            }
            if (
              functionName === "generateImage" &&
              result?.startsWith("[success]")
            ) {
              const img = getLatestGenImg();
              if (img) {
                display({ image: img });
              }
            }
            if (
              functionName.startsWith("playMusic") &&
              result?.startsWith("[success]")
            ) {
              ctx.enterMusicAfterAnswer = true;
              ctx.musicDisplayText = result.replace(/^\[success\]/, "").trim();
            }
            if (result) {
              display({
                text: `[${functionName}]${result}`,
              });
            } else {
              display({
                text: `Invoking [${functionName}]... {count}s`,
              });
            }
          },
        );
      });
    getPlayEndPromise().then(() => {
      if (ctx.currentFlowName === "answer") {
        clearPendingCapturedImgForChat();
        display({ image_icon_visible: false });
        if (ctx.wakeSessionActive || ctx.endAfterAnswer) {
          if (ctx.endAfterAnswer) {
            ctx.endWakeSession();
            ctx.transitionTo("sleep");
          } else {
            ctx.transitionTo("wake_listening");
          }
          return;
        }
        if (ctx.enterMusicAfterAnswer) {
          ctx.transitionTo("music");
          return;
        }
        const img = getLatestDisplayImg();
        if (img) {
          ctx.transitionTo("image");
        } else {
          ctx.transitionTo("sleep");
        }
      }
    });
    onButtonPressed(() => {
      stopPlaying();
      clearPendingCapturedImgForChat();
      display({ image_icon_visible: false });
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
  },
  image: (ctx: ChatFlowContext) => {
    onButtonPressed(() => {
      display({ image: "" });
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
  },
  external_answer: (ctx: ChatFlowContext) => {
    if (!ctx.pendingExternalReply && !ctx.pendingExternalImageUrl) {
      ctx.transitionTo("sleep");
      return;
    }
    display({
      status: "answering...",
      RGB: "#00c8a3",
      ...(ctx.pendingExternalEmoji ? { emoji: ctx.pendingExternalEmoji } : {}),
    });
    onButtonPressed(() => {
      ctx.streamResponser.stop();
      display({ image: "" });
      ctx.transitionTo("listening");
    });
    onButtonReleased(noop);
    const replyText = ctx.pendingExternalReply;
    const replyEmoji = ctx.pendingExternalEmoji;
    const replyImageUrl = ctx.pendingExternalImageUrl;
    ctx.currentExternalEmoji = replyEmoji;
    ctx.pendingExternalReply = "";
    ctx.pendingExternalEmoji = "";
    ctx.pendingExternalImageUrl = "";

    // Display the image if one was provided
    if (replyImageUrl) {
      display({ image: replyImageUrl });
    }

    if (replyText) {
      void ctx.streamExternalReply(replyText, replyEmoji);
      ctx.streamResponser.getPlayEndPromise().then(() => {
        if (ctx.currentFlowName !== "external_answer") return;
        if (ctx.wakeSessionActive || ctx.endAfterAnswer) {
          if (ctx.endAfterAnswer) {
            ctx.endWakeSession();
            ctx.transitionTo("sleep");
          } else {
            ctx.transitionTo("wake_listening");
          }
        } else if (replyImageUrl) {
          // Stay in image display mode after TTS finishes
          ctx.transitionTo("image");
        } else {
          ctx.transitionTo("sleep");
        }
      });
    } else {
      // Image only, no text to speak — go to image display mode
      ctx.transitionTo("image");
    }
  },
};
