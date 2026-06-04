import { useState, useRef, useCallback, useEffect } from "react";
import type React from "react";
import {
  Character,
  Message,
  Role,
  ChatConfig,
  GroupChat,
  GroupMessage,
} from "../types";
import {
  generateTextStream,
  WsChatConnection,
  getCharacterDetails,
} from "../services/zeroclawService";
import {
  buildCharacterPhotoPrompt,
  generateImage,
  isPhotoRequest,
} from "../services/imageGenService";
import {
  selectNextCharacter,
  updateGroupChat,
} from "../services/groupChatService";
import { useChatHelpers } from "./useChatHelpers";
import { generateId } from "../utils/id";
import type { ToastAPI } from "../components/Toast";

export interface UseChatGenerationReturn {
  inputText: string;
  setInputText: React.Dispatch<React.SetStateAction<string>>;
  isTyping: boolean;
  setIsTyping: React.Dispatch<React.SetStateAction<boolean>>;
  handleSendMessage: () => Promise<void>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  isComposingRef: React.MutableRefObject<boolean>;
  wsChatRef: React.MutableRefObject<WsChatConnection | null>;
}

export const useChatGeneration = (
  characters: Character[],
  selectedCharacter: Character,
  activeGroup: GroupChat | null,
  config: ChatConfig,
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  toast: ToastAPI,
  t: (key: string) => string,
): UseChatGenerationReturn => {
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);
  const wsChatRef = useRef<WsChatConnection | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const { buildChatOptions, buildChatRequest } =
    useChatHelpers(config, activeGroup, characters);

  // Scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Close WS chat and abort pending REST requests on character switch
  useEffect(() => {
    wsChatRef.current?.close();
    wsChatRef.current = null;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = null;
  }, [selectedCharacter.id]);

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || isTyping) return;

    let respondingCharacter = selectedCharacter;
    if (activeGroup) {
      const nextChar = selectNextCharacter(activeGroup, characters, inputText);
      if (nextChar) {
        respondingCharacter = nextChar;
        updateGroupChat(activeGroup.id, { lastActiveCharacterId: nextChar.id });
      }
    }

    if (
      characters.length === 0 ||
      !characters.some((c) => c.name === respondingCharacter.name)
    ) {
      toast.error(
        `角色「${respondingCharacter.name}」不在 ZeroClaw 后端。请从左侧选择已导入的角色。`,
      );
      return;
    }

    const userMsg: Message = {
      id: generateId(),
      role: Role.User,
      content: inputText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    const botMsgId = generateId();

    setMessages((prev) => [
      ...prev,
      {
        id: botMsgId,
        role: Role.Model,
        content: "",
        timestamp: Date.now(),
        isThinking: true,
        extra: activeGroup
          ? {
              characterId: respondingCharacter.id,
              characterName: respondingCharacter.name,
            }
          : undefined,
      } as GroupMessage,
    ]);

    try {
      if (isPhotoRequest(inputText)) {
        const toolName = "xai_image_gen";
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId
              ? {
                  ...msg,
                  isThinking: false,
                  toolCalls: [{ toolName, status: "running" }],
                }
              : msg,
          ),
        );

        const details = await getCharacterDetails(respondingCharacter.name);
        const prompt = buildCharacterPhotoPrompt(
          inputText,
          respondingCharacter,
          details,
        );
        const result = await generateImage({ prompt, resolution: "1k" });

        if (!result.success || !result.image_data_url) {
          throw new Error(result.error || "Image generation failed");
        }

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMsgId
              ? {
                  ...msg,
                  content: "",
                  isThinking: false,
                  toolCalls: [
                    {
                      toolName,
                      status: "done",
                      output: JSON.stringify({ prompt }),
                      mediaUrl: result.image_data_url,
                      mediaType: "image",
                    },
                  ],
                }
              : msg,
          ),
        );
        return;
      }

      const useWs = !activeGroup && respondingCharacter.name !== "Assistant";
      let usedWs = false;

      if (useWs) {
        try {
          if (!wsChatRef.current || !wsChatRef.current.isConnected) {
            wsChatRef.current?.close();
            const ws = new WsChatConnection({
              onChunk: (_chunk: string, fullText: string) => {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMsgId
                      ? { ...msg, content: fullText, isThinking: false }
                      : msg,
                  ),
                );
              },
              onToolCall: (toolName: string) => {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMsgId
                      ? {
                          ...msg,
                          toolCalls: [
                            ...(msg.toolCalls || []),
                            { toolName, status: "running" as const },
                          ],
                        }
                      : msg,
                  ),
                );
              },
              onToolResult: (
                toolName: string,
                output: string,
                mediaUrl?: string,
                mediaType?: "image" | "audio" | "video",
              ) => {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== botMsgId) return msg;
                    const calls = [...(msg.toolCalls || [])];
                    const idx = calls.findIndex(
                      (tc) =>
                        tc.toolName === toolName && tc.status === "running",
                    );
                    if (idx !== -1) {
                      calls[idx] = {
                        ...calls[idx],
                        status: "done" as const,
                        output,
                        mediaUrl,
                        mediaType,
                      };
                    }
                    return { ...msg, toolCalls: calls, isThinking: false };
                  }),
                );
              },
              onDone: (fullText: string) => {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMsgId
                      ? { ...msg, content: fullText, isThinking: false }
                      : msg,
                  ),
                );
              },
              onError: (error: string) => {
                console.error("WS chat error:", error);
              },
            });
            await ws.connect(
              respondingCharacter.name,
              "play",
              config.userName || undefined,
            );
            wsChatRef.current = ws;
          }
          wsChatRef.current.send(inputText);
          usedWs = true;
        } catch (wsErr) {
          console.warn(
            "WebSocket chat unavailable for character, falling back to REST:",
            wsErr,
          );
          wsChatRef.current?.close();
          wsChatRef.current = null;
        }
      }

      if (!usedWs) {
        abortCtrlRef.current?.abort();
        abortCtrlRef.current = new AbortController();

        const chatMessages = buildChatMessagesForContext([...messages, userMsg]);

        await generateTextStream(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
          (_chunk: string, fullText: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? { ...msg, content: fullText, isThinking: false }
                  : msg,
              ),
            );
          },
          (fullText: string) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId
                  ? { ...msg, content: fullText, isThinking: false }
                  : msg,
              ),
            );
          },
          (error: Error) => {
            throw error;
          },
          abortCtrlRef.current.signal,
        );
      }
    } catch (error: unknown) {
      // Silently ignore abort errors (user switched character or stopped)
      if (error instanceof Error && error.name === "AbortError") {
        setIsTyping(false);
        return;
      }
      console.error("Error generating response:", error);

      let errorTitle = t("error.generation") || "Generation Failed";
      let errorMessage =
        (error instanceof Error ? error.message : String(error)) ||
        "Unknown error occurred";

      if (errorMessage.includes("API key")) {
        errorTitle = t("error.apiKey") || "API Key Error";
        errorMessage =
          t("error.apiKeyMessage") ||
          "Please check your API key in settings.";
      } else if (
        errorMessage.includes("rate limit") ||
        errorMessage.includes("429")
      ) {
        errorTitle = t("error.rateLimit") || "Rate Limited";
        errorMessage =
          t("error.rateLimitMessage") ||
          "Too many requests. Please wait a moment.";
      } else if (
        errorMessage.includes("network") ||
        errorMessage.includes("fetch")
      ) {
        errorTitle = t("error.network") || "Network Error";
        errorMessage =
          t("error.networkMessage") ||
          "Could not connect to the server.";
      } else if (errorMessage.includes("timeout")) {
        errorTitle = t("error.timeout") || "Request Timeout";
        errorMessage =
          t("error.timeoutMessage") ||
          "The request took too long. Try again.";
      } else if (errorMessage.toLowerCase().includes("websocket")) {
        errorTitle = "Connection issue";
        errorMessage = "Retrying with standard connection...";
      }

      if (!errorMessage.includes("standard connection")) {
        toast.error(errorTitle, errorMessage);
      }

      const isTransportIssue = errorMessage.includes("standard connection");
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                ...msg,
                content: isTransportIssue
                  ? "(Retrying...)"
                  : `⚠️ ${errorTitle}: ${errorMessage}`,
                isThinking: false,
              }
            : msg,
        ),
      );
    } finally {
      setIsTyping(false);
    }
  }, [
    inputText,
    isTyping,
    selectedCharacter,
    activeGroup,
    characters,
    config,
    messages,
    setMessages,
    toast,
    t,
    buildChatOptions,
    buildChatRequest,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      if (
        e.nativeEvent.isComposing ||
        isComposingRef.current ||
        e.keyCode === 229
      ) {
        return;
      }
      e.preventDefault();
      handleSendMessage();
    },
    [handleSendMessage],
  );

  return {
    inputText,
    setInputText,
    isTyping,
    setIsTyping,
    handleSendMessage,
    handleKeyDown,
    chatEndRef,
    isComposingRef,
    wsChatRef,
  };
};
