import { useState, useEffect, useRef, useCallback } from "react";
import type React from "react";
import { DEFAULT_CONFIG } from "../constants";
import { Character, Message, Role, ChatConfig, AppSettings, GroupChat, GroupMessage } from "../types";
import {
  getCharacters,
  generateText,
  generateTextStream,
  WsChatConnection,
  getSettings,
  ChatMessage,
  ChatOptions,
  ChatRequestPayload,
  CharacterFormData,
  updateCharacter,
  createCharacter,
  deleteCharacter,
  ensurePairing,
} from "../services/zeroclawService";
import { countMessagesTokens } from "../services/tokenizerService";
import {
  loadChatState,
  debouncedSaveChatState,
  getAppSettings,
  getTimeSinceLastChat,
  clearChatState,
} from "../services/chatPersistenceService";
import {
  saveChat,
  loadChat,
  getChatList,
  createNewChatFileName,
  stripChatExtension,
  ChatInfo,
} from "../services/chatService";
import {
  getBookmarks,
  saveBookmark,
  deleteBookmark,
  createBookmark,
  ChatBookmark,
} from "../services/bookmarkService";
import { useToast } from "../components/Toast";
import { useLanguage } from "../i18n";
import {
  buildGroupSystemPrompt,
  selectNextCharacter,
  updateGroupChat,
} from "../services/groupChatService";
import { useSpeechRecognition } from "./useSpeechRecognition";

const characterNameForMessage = (msg: Message, fallback: Character): string => {
  const extra = (msg as GroupMessage).extra;
  return extra?.characterName ?? fallback.name;
};

const emptyCharacter: Character = {
  id: "default",
  name: "No characters",
  avatar: "",
  description: "",
  systemInstruction: "",
  firstMessage: "",
  backgroundImage: "",
};

export const useAppLogic = () => {
  const { t, language, setLanguage } = useLanguage();
  const toast = useToast();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character>({
    id: "default",
    name: "Loading...",
    avatar: "",
    description: "",
    systemInstruction: "",
    firstMessage: "",
    backgroundImage: "",
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);

  // Voice Input Logic
  const { isListening, toggleVoiceInput } = useSpeechRecognition((newTranscript) => {
    setInputText((prev) => {
      const spacer = prev.length > 0 && !prev.endsWith(" ") ? " " : "";
      return prev + spacer + newTranscript;
    });
  });

  // UI State
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

  // Chat Persistence State
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [savedChatCharacterName, setSavedChatCharacterName] = useState<string>("");
  const [appSettings, setAppSettings] = useState<AppSettings>(getAppSettings());
  const hasInitializedRef = useRef(false);
  const restoreInProgressRef = useRef(false);

  // Chat persistence (localStorage)
  const [currentChatFileName, setCurrentChatFileName] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatInfo[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const wsChatRef = useRef<WsChatConnection | null>(null);

  // Bookmark State
  const [bookmarks, setBookmarks] = useState<ChatBookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // Group Chat State
  const [activeGroup, setActiveGroup] = useState<GroupChat | null>(null);
  const [showGroupManager, setShowGroupManager] = useState(false);

  // Character Editor State
  const [showCharacterEditor, setShowCharacterEditor] = useState(false);
  const [showImageGen, setShowImageGen] = useState(false);
  const [imageGenPrompt, setImageGenPrompt] = useState<string | undefined>(undefined);
  const [editingCharacterId, setEditingCharacterId] = useState<string | undefined>(undefined);

  // Track character switching to prevent showing stale data
  const [lastLoadedCharacterId, setLastLoadedCharacterId] = useState<string | null>(null);

  // Token Count State
  const [tokenCount, setTokenCount] = useState(0);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);

  const handleConfigChange = async (newConfig: ChatConfig) => {
    setConfig(newConfig);
  };

  const pickCharacter = useCallback(
    (chars: Character[], prev: Character): Character => {
      if (chars.length === 0) return emptyCharacter;
      const match = chars.find((c) => c.id === prev.id || c.name === prev.name);
      return match ?? chars[0];
    },
    [],
  );

  // Function to refresh character list (used after import)
  const refreshCharacters = useCallback(async () => {
    const chars = await getCharacters();
    setCharacters(chars);
    setSelectedCharacter((prev) => pickCharacter(chars, prev));
  }, [pickCharacter]);

  // Character Editor Handlers
  const handleEditCharacter = (charId: string) => {
    setEditingCharacterId(charId);
    setShowCharacterEditor(true);
  };

  const handleCreateCharacter = () => {
    setEditingCharacterId(undefined);
    setShowCharacterEditor(true);
  };

  const handleSaveCharacter = async (data: CharacterFormData) => {
    if (editingCharacterId) {
      // Update existing
      const result = await updateCharacter(editingCharacterId, data);
      if (!result.success) {
        throw new Error(result.error);
      }
    } else {
      // Create new
      const result = await createCharacter(data);
      if (!result.success) {
        throw new Error(result.error);
      }
    }
    await refreshCharacters();
    setShowCharacterEditor(false);
  };

  const handleDeleteCharacter = async () => {
    if (!editingCharacterId) return;
    const result = await deleteCharacter(editingCharacterId);
    if (!result.success) {
      throw new Error(result.error);
    }
    await refreshCharacters();
    setShowCharacterEditor(false);
  };

  // Initialize backend and characters on mount
  useEffect(() => {
    const initBackend = async () => {
      try {
        await ensurePairing();
      } catch (e) {
        console.warn("ZeroClaw pairing failed on init:", e);
      }

      const chars = await getCharacters();
      setCharacters(chars);
      setSelectedCharacter((prev) => pickCharacter(chars, prev));

      const settings = await getSettings();
      if (settings && Object.keys(settings).length > 0) {
        setConfig((prev) => ({
          ...prev,
          temperature: settings.temperature ?? prev.temperature,
          maxOutputTokens: settings.maxOutputTokens ?? prev.maxOutputTokens,
          userName: settings.username ?? prev.userName,
        }));
      }
    };
    initBackend();
  }, [pickCharacter]);

  // Load chat history for current character
  const loadChatHistory = useCallback(async () => {
    if (selectedCharacter.id === "default") return;
    const history = await getChatList(selectedCharacter.id);
    setChatHistory(history);
  }, [selectedCharacter.id]);

  // Auto-save chat to local storage (debounced)
  const debouncedSaveToBackend = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      if (
        messages.length > 0 &&
        selectedCharacter.id !== "default" &&
        currentChatFileName
      ) {
        setIsSavingChat(true);
        const success = await saveChat(
          selectedCharacter.id,
          currentChatFileName,
          messages,
          config.userName,
          selectedCharacter.name,
        );
        setIsSavingChat(false);
        if (success) {
          console.log("Chat saved:", currentChatFileName);
        }
      }
    }, 2000); // Save after 2 seconds of inactivity
  }, [
    messages,
    selectedCharacter.id,
    selectedCharacter.name,
    currentChatFileName,
    config.userName,
  ]);

  // Auto-save when messages change
  useEffect(() => {
    if (messages.length > 1 && currentChatFileName) {
      debouncedSaveToBackend();
    }
    // Also save to localStorage for quick restore
    if (
      messages.length > 0 &&
      selectedCharacter.id !== "default" &&
      appSettings.autoRestoreChat
    ) {
      debouncedSaveChatState(
        selectedCharacter.id,
        messages,
        currentChatFileName || undefined,
      );
    }
  }, [
    messages,
    currentChatFileName,
    debouncedSaveToBackend,
    selectedCharacter.id,
    appSettings.autoRestoreChat,
  ]);

  // Update token count
  useEffect(() => {
    const systemPrompt = selectedCharacter.systemInstruction || "";
    const count =
      countMessagesTokens(messages) + Math.ceil(systemPrompt.length / 4);
    setTokenCount(count);
  }, [messages, selectedCharacter.systemInstruction]);

  // Load chat history when character changes
  useEffect(() => {
    loadChatHistory();
  }, [loadChatHistory]);

  // Load most recent chat for character on selection
  useEffect(() => {
    const loadRecentChat = async () => {
      if (
        selectedCharacter.id === "default" ||
        !hasInitializedRef.current ||
        restoreInProgressRef.current
      )
        return;

      const currentCharacterId = selectedCharacter.id;
      console.log('[loadRecentChat] Starting load for:', currentCharacterId, selectedCharacter.name);

      // Clear messages immediately to show we're switching
      setMessages([]);
      setLastLoadedCharacterId(null);

      try {
        const history = await getChatList(selectedCharacter.id);
        console.log('[loadRecentChat] Chat history loaded:', history.length, 'chats');
        setChatHistory(history);

        // Check if character changed during async load
        if (currentCharacterId !== selectedCharacter.id) {
          console.log('[loadRecentChat] Character changed during load, aborting. Was:', currentCharacterId, 'Now:', selectedCharacter.id);
          return;
        }

        if (history.length > 0) {
          // Load the most recent chat
          const mostRecent = history[0];
          const fileName = stripChatExtension(mostRecent.file_name);
          console.log('[loadRecentChat] Loading chat file:', fileName);

          const { messages: loadedMessages } = await loadChat(
            selectedCharacter.id,
            fileName,
          );

          // Double-check character didn't change during async operation
          if (currentCharacterId !== selectedCharacter.id) {
            console.log('[loadRecentChat] Character changed during chat load, aborting');
            return;
          }

          console.log('[loadRecentChat] Loaded', loadedMessages.length, 'messages');
          if (loadedMessages.length > 0) {
            console.log('[loadRecentChat] Setting messages:', loadedMessages);
            setMessages(loadedMessages);
            setCurrentChatFileName(fileName);
            setLastLoadedCharacterId(currentCharacterId);
            console.log('[loadRecentChat] Messages set successfully for', currentCharacterId);
            return;
          } else {
            console.warn('[loadRecentChat] No messages to set, loadedMessages is empty');
          }
        }

        // No existing chat, start new one - create greeting directly
        // Double-check character didn't change
        if (currentCharacterId !== selectedCharacter.id) {
          console.log('[loadRecentChat] Character changed, aborting new chat creation');
          return;
        }

        console.log('[loadRecentChat] No existing chat, creating new one for', selectedCharacter.name);
        const newFileName = createNewChatFileName(selectedCharacter.name);
        setCurrentChatFileName(newFileName);

        const greeting: Message = {
          id: "init-" + Date.now(),
          role: Role.Model,
          content: selectedCharacter.firstMessage,
          timestamp: Date.now(),
        };
        setMessages([greeting]);
        setLastLoadedCharacterId(currentCharacterId);
        console.log('[loadRecentChat] Created new chat with greeting for', currentCharacterId);

        // Refresh chat history
        loadChatHistory();
      } catch (error) {
        console.error('[loadRecentChat] Error loading chat for character:', currentCharacterId, error);
        // Even on error, create a new chat so the user can still interact
        const newFileName = createNewChatFileName(selectedCharacter.name);
        setCurrentChatFileName(newFileName);

        const greeting: Message = {
          id: "init-" + Date.now(),
          role: Role.Model,
          content: selectedCharacter.firstMessage,
          timestamp: Date.now(),
        };
        setMessages([greeting]);
        setLastLoadedCharacterId(currentCharacterId);
        console.log('[loadRecentChat] Created fallback chat after error for', currentCharacterId);
      }
    };

    if (hasInitializedRef.current && selectedCharacter.id !== "default") {
      console.log('[loadRecentChat] Effect triggered, calling loadRecentChat');
      loadRecentChat();
    } else {
      console.log('[loadRecentChat] Effect skipped - initialized:', hasInitializedRef.current, 'charId:', selectedCharacter.id);
    }
  }, [selectedCharacter.id, loadChatHistory]);

  useEffect(() => {
    if (restoreInProgressRef.current && currentChatFileName) {
      restoreInProgressRef.current = false;
    }
  }, [currentChatFileName]);

  // Check for saved chat on initial load
  useEffect(() => {
    if (hasInitializedRef.current) return;

    const savedChat = loadChatState();
    if (savedChat && appSettings.autoRestoreChat && characters.length > 0) {
      const savedCharacter = characters.find(
        (c) => c.id === savedChat.characterId,
      );
      if (savedCharacter && savedChat.messages.length > 1) {
        setSavedChatCharacterName(savedCharacter.name);
        setShowRestorePrompt(true);
      } else {
        hasInitializedRef.current = true;
      }
    } else {
      hasInitializedRef.current = true;
    }
  }, [characters, appSettings.autoRestoreChat]);

  const handleRestoreChat = () => {
    const savedChat = loadChatState();
    if (savedChat) {
      const savedCharacter = characters.find(
        (c) => c.id === savedChat.characterId,
      );
      if (savedCharacter) {
        restoreInProgressRef.current = true;
        setSelectedCharacter(savedCharacter);
        setMessages(savedChat.messages);
        setCurrentChatFileName(
          savedChat.chatFileName || createNewChatFileName(savedCharacter.name),
        );
      }
    }
    setShowRestorePrompt(false);
    hasInitializedRef.current = true;
  };

  const startNewChat = useCallback(() => {
    // Create new chat file name
    const newFileName = createNewChatFileName(selectedCharacter.name);
    setCurrentChatFileName(newFileName);

    const greeting: Message = {
      id: "init-" + Date.now(),
      role: Role.Model,
      content: selectedCharacter.firstMessage,
      timestamp: Date.now(),
    };
    setMessages([greeting]);

    // Refresh chat history
    loadChatHistory();
  }, [selectedCharacter, loadChatHistory]);

  const handleStartFresh = () => {
    clearChatState();
    setShowRestorePrompt(false);
    hasInitializedRef.current = true;
    startNewChat();
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Build ChatOptions from current config
  const buildChatOptions = useCallback((): ChatOptions => ({
    temperature: config.temperature,
    maxTokens: config.maxOutputTokens,
    topP: config.topP,
    topK: config.topK,
    frequencyPenalty: config.frequencyPenalty,
    presencePenalty: config.presencePenalty,
    stop: config.stopSequences?.length ? config.stopSequences : null,
    seed: config.seed !== -1 ? config.seed : null,
    userName: config.userName,
    userDescription: config.userDescription,
    sceneMode: config.sceneMode,
    scenario: config.scenario,
    exampleDialogue: config.exampleDialogue,
    lorebook: config.lorebook,
    systemPromptOverride: config.systemPromptOverride,
    authorsNote: config.authorsNote,
    authorsNoteDepth: config.authorsNoteDepth,
    promptOrder: config.promptOrder,
    userPrefix: config.userPrefix !== DEFAULT_CONFIG.userPrefix ? config.userPrefix : null,
    modelPrefix: config.modelPrefix !== DEFAULT_CONFIG.modelPrefix ? config.modelPrefix : null,
    contextTemplate: config.contextTemplate !== DEFAULT_CONFIG.contextTemplate ? config.contextTemplate : null,
    promptTemplate: config.promptTemplate ?? null,
    negativePrompt: config.negativePrompt,
  }), [config]);

  const buildChatRequest = useCallback((
    chatMessages: ChatMessage[],
    respondingCharacter: Character,
  ): ChatRequestPayload => {
    const request: ChatRequestPayload = {
      messages: chatMessages,
      character_name: respondingCharacter.name,
    };

    if (activeGroup) {
      const groupCharacters = characters.filter((char) =>
        activeGroup.characterIds.includes(char.id),
      );
      const groupPrompt = buildGroupSystemPrompt(respondingCharacter, groupCharacters, {
        scenario: config.scenario,
        userName: config.userName,
        userDescription: config.userDescription,
      });
      request.system_prompts = [groupPrompt];
    }

    return request;
  }, [activeGroup, characters, config.scenario, config.userDescription, config.userName]);

  const handleSendMessage = async () => {
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
      id: Date.now().toString(),
      role: Role.User,
      content: inputText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    const botMsgId = (Date.now() + 1).toString();

    // Add placeholder message with character info for group chats
    setMessages((prev) => [
      ...prev,
      {
        id: botMsgId,
        role: Role.Model,
        content: "",
        timestamp: Date.now(),
        isThinking: true,
        extra: activeGroup ? {
          characterId: respondingCharacter.id,
          characterName: respondingCharacter.name,
        } : undefined,
      } as GroupMessage,
    ]);

    try {
      // ── Try WebSocket chat (tool-enabled: image gen, TTS) for supported agents ──
      // WS is best-effort. Many character cards only support the lightweight REST path.
      const useWs = !activeGroup && respondingCharacter.name !== "Assistant";
      let usedWs = false;

      if (useWs) {
        try {
          // Ensure WS connection is alive
          if (!wsChatRef.current || !wsChatRef.current.isConnected) {
            wsChatRef.current?.close();
            const ws = new WsChatConnection({
              onChunk: (chunk: string, fullText: string) => {
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
              onToolResult: (toolName: string, output: string, mediaUrl?: string, mediaType?: "image" | "audio" | "video") => {
                setMessages((prev) =>
                  prev.map((msg) => {
                    if (msg.id !== botMsgId) return msg;
                    const calls = [...(msg.toolCalls || [])];
                    const idx = calls.findIndex((tc) => tc.toolName === toolName && tc.status === "running");
                    if (idx !== -1) {
                      calls[idx] = { ...calls[idx], status: "done" as const, output, mediaUrl, mediaType };
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
            await ws.connect(respondingCharacter.name, "play", config.userName || undefined);
            wsChatRef.current = ws;
          }
          wsChatRef.current.send(inputText);
          usedWs = true;
        } catch (wsErr) {
          // WS not available for this character/agent (common for simple imported cards).
          // Fall back gracefully to the reliable REST SSE path.
          console.warn("WebSocket chat unavailable for character, falling back to REST:", wsErr);
          wsChatRef.current?.close();
          wsChatRef.current = null;
        }
      }

      if (!usedWs) {
        // ── REST SSE path (works for all character cards) ──
        const chatMessages: ChatMessage[] = [];
        const currentHistory = [...messages, userMsg];
        currentHistory.forEach((msg) => {
          const groupMsg = msg as GroupMessage;
          let content = msg.content;
          if (activeGroup && msg.role === Role.Model && groupMsg.extra?.characterName) {
            content = `[${groupMsg.extra.characterName}]: ${content}`;
          }
          chatMessages.push({
            role: msg.role === Role.User ? "user" : "assistant",
            content: content,
          });
        });

        await generateTextStream(
          buildChatRequest(chatMessages, respondingCharacter),
          buildChatOptions(),
          (chunk: string, fullText: string) => {
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
        );
      }
    } catch (error: any) {
      console.error("Error generating response:", error);

      // Parse error message for user-friendly display
      let errorTitle = t("error.generation") || "Generation Failed";
      let errorMessage = error?.message || "Unknown error occurred";

      // Handle specific error types
      if (errorMessage.includes("API key")) {
        errorTitle = t("error.apiKey") || "API Key Error";
        errorMessage =
          t("error.apiKeyMessage") || "Please check your API key in settings.";
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
          t("error.networkMessage") || "Could not connect to the server.";
      } else if (errorMessage.includes("timeout")) {
        errorTitle = t("error.timeout") || "Request Timeout";
        errorMessage =
          t("error.timeoutMessage") || "The request took too long. Try again.";
      } else if (errorMessage.toLowerCase().includes("websocket")) {
        // Should rarely happen now (we fallback), but keep it friendly
        errorTitle = "Connection issue";
        errorMessage = "Retrying with standard connection...";
      }

      // Show toast notification (only for real provider / config issues)
      if (!errorMessage.includes("standard connection")) {
        toast.error(errorTitle, errorMessage);
      }

      // Update message bubble with error (only surface real errors)
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
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // Don't send while IME is composing (e.g. confirming Chinese input with Enter)
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
      return;
    }
    e.preventDefault();
    handleSendMessage();
  };

  const clearChat = () => {
    if (window.confirm("Reset this conversation with new settings?")) {
      startNewChat();
    }
  };

  // ==================== MESSAGE ACTION HANDLERS ====================

  // Navigate between swipes (alternative responses)
  const handleSwipeChange = (
    messageId: string,
    direction: "left" | "right",
  ) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId || !msg.swipes || msg.swipes.length <= 1)
          return msg;

        const currentIndex = msg.swipeId ?? 0;
        const maxIndex = msg.swipes.length - 1;

        let newIndex: number;
        if (direction === "left") {
          newIndex = currentIndex > 0 ? currentIndex - 1 : maxIndex;
        } else {
          newIndex = currentIndex < maxIndex ? currentIndex + 1 : 0;
        }

        return {
          ...msg,
          content: msg.swipes[newIndex],
          swipeId: newIndex,
          timestamp: msg.swipeTimestamps?.[newIndex] ?? msg.timestamp,
        };
      }),
    );
  };

  // Build chat messages for API (extracted helper)
  const buildChatMessagesForContext = (
    contextMessages: Message[],
  ): ChatMessage[] => {
    return contextMessages.map((msg) => {
      const groupMsg = msg as GroupMessage;
      const shouldPrefix =
        activeGroup && msg.role === Role.Model && groupMsg.extra?.characterName;
      return {
        role: msg.role === Role.User ? "user" : "assistant",
        content: shouldPrefix ? `[${groupMsg.extra?.characterName}]: ${msg.content}` : msg.content,
      };
    });
  };

  // Generate a new swipe (alternative response)
  const handleGenerateSwipe = async (messageId: string) => {
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;

    const message = messages[messageIndex];
    if (message.role !== Role.Model) return;

    // Get messages up to (but not including) the target message
    const contextMessages = messages.slice(0, messageIndex);

    setIsTyping(true);

    try {
      const chatMessages = buildChatMessagesForContext(contextMessages);
      const respondingCharacter = characters.find(
        (char) => char.name === characterNameForMessage(message, selectedCharacter),
      ) ?? selectedCharacter;
      const responseText = await generateText(
        buildChatRequest(chatMessages, respondingCharacter),
        buildChatOptions(),
      );

      // Add new swipe to existing swipes array
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id !== messageId) return msg;

          const currentSwipes = msg.swipes || [msg.content];
          const currentTimestamps = msg.swipeTimestamps || [msg.timestamp];
          const newSwipes = [...currentSwipes, responseText];
          const newTimestamps = [...currentTimestamps, Date.now()];
          const newIndex = newSwipes.length - 1;

          return {
            ...msg,
            content: responseText,
            swipes: newSwipes,
            swipeId: newIndex,
            swipeTimestamps: newTimestamps,
            timestamp: Date.now(),
          };
        }),
      );

      toast.success("New swipe generated");
    } catch (error: any) {
      toast.error("Failed to generate swipe", error.message);
    } finally {
      setIsTyping(false);
    }
  };

  // Regenerate the last AI message
  const handleRegenerate = async (messageId?: string) => {
    // Find the target message
    let targetIndex: number;
    if (messageId) {
      targetIndex = messages.findIndex((m) => m.id === messageId);
    } else {
      // Find last model message
      targetIndex = messages.length - 1;
      while (targetIndex >= 0 && messages[targetIndex].role !== Role.Model) {
        targetIndex--;
      }
    }

    if (targetIndex === -1) return;

    const targetMessage = messages[targetIndex];
    if (targetMessage.role !== Role.Model) return;

    // Get context (all messages before the target)
    const contextMessages = messages.slice(0, targetIndex);

    // Mark message as regenerating
    setMessages((prev) =>
      prev.map((msg, idx) =>
        idx === targetIndex ? { ...msg, isThinking: true, content: "" } : msg,
      ),
    );
    setIsTyping(true);

    try {
      const chatMessages = buildChatMessagesForContext(contextMessages);
      const respondingCharacter = characters.find(
        (char) => char.name === characterNameForMessage(targetMessage, selectedCharacter),
      ) ?? selectedCharacter;
      const responseText = await generateText(
        buildChatRequest(chatMessages, respondingCharacter),
        buildChatOptions(),
      );

      // Update message with new content (add to swipes)
      setMessages((prev) =>
        prev.map((msg, idx) => {
          if (idx !== targetIndex) return msg;

          const currentSwipes =
            msg.swipes && msg.swipes.length > 0
              ? msg.swipes
              : [targetMessage.content];
          const currentTimestamps = msg.swipeTimestamps || [
            targetMessage.timestamp,
          ];
          const newSwipes = [...currentSwipes, responseText];
          const newTimestamps = [...currentTimestamps, Date.now()];

          return {
            ...msg,
            content: responseText,
            swipes: newSwipes,
            swipeId: newSwipes.length - 1,
            swipeTimestamps: newTimestamps,
            timestamp: Date.now(),
            isThinking: false,
          };
        }),
      );

      toast.success("Message regenerated");
    } catch (error: any) {
      toast.error("Regeneration failed", error.message);
      // Restore original content
      setMessages((prev) =>
        prev.map((msg, idx) =>
          idx === targetIndex
            ? { ...msg, isThinking: false, content: targetMessage.content }
            : msg,
        ),
      );
    } finally {
      setIsTyping(false);
    }
  };

  // Continue/extend the last AI message
  const handleContinue = async (messageId?: string) => {
    // Find the target message
    let targetIndex: number;
    if (messageId) {
      targetIndex = messages.findIndex((m) => m.id === messageId);
    } else {
      targetIndex = messages.length - 1;
      while (targetIndex >= 0 && messages[targetIndex].role !== Role.Model) {
        targetIndex--;
      }
    }

    if (targetIndex === -1) return;

    const targetMessage = messages[targetIndex];
    if (targetMessage.role !== Role.Model) return;

    setIsTyping(true);

    try {
      // Build context including the message to continue
      const contextMessages = messages.slice(0, targetIndex + 1);
      const chatMessages = buildChatMessagesForContext(contextMessages);

      // Add a continue instruction
      chatMessages.push({
        role: "user",
        content:
          "[Continue your response naturally without repeating yourself. Do not acknowledge this instruction.]",
      });

      const respondingCharacter = characters.find(
        (char) => char.name === characterNameForMessage(targetMessage, selectedCharacter),
      ) ?? selectedCharacter;
      const continuationText = await generateText(
        buildChatRequest(chatMessages, respondingCharacter),
        buildChatOptions(),
      );

      // Append continuation to existing content
      setMessages((prev) =>
        prev.map((msg, idx) => {
          if (idx !== targetIndex) return msg;

          const newContent = msg.content + " " + continuationText;

          // Update current swipe if swipes exist
          if (msg.swipes && msg.swipes.length > 0) {
            const newSwipes = [...msg.swipes];
            const currentSwipeId = msg.swipeId ?? 0;
            newSwipes[currentSwipeId] = newContent;
            return {
              ...msg,
              content: newContent,
              swipes: newSwipes,
            };
          }

          return {
            ...msg,
            content: newContent,
          };
        }),
      );

      toast.success("Message continued");
    } catch (error: any) {
      toast.error("Continue failed", error.message);
    } finally {
      setIsTyping(false);
    }
  };

  // Edit a message
  const handleEditMessage = (messageId: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id !== messageId) return msg;

        // Update swipes if they exist
        if (msg.swipes && msg.swipes.length > 0) {
          const newSwipes = [...msg.swipes];
          const currentSwipeId = msg.swipeId ?? 0;
          newSwipes[currentSwipeId] = newContent;
          return {
            ...msg,
            content: newContent,
            swipes: newSwipes,
          };
        }

        return {
          ...msg,
          content: newContent,
        };
      }),
    );
    toast.success("Message edited");
  };

  // Delete a message
  const handleDeleteMessage = (messageId: string) => {
    if (!window.confirm("Delete this message?")) return;
    setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
    toast.success("Message deleted");
  };

  // Open image generation modal with an optional pre-filled prompt
  const handleGenerateImage = (prompt: string) => {
    setImageGenPrompt(prompt);
    setShowImageGen(true);
  };

  // ==================== BOOKMARK HANDLERS ====================

  // Load bookmarks when character changes
  useEffect(() => {
    if (selectedCharacter.id !== "default") {
      setBookmarks(getBookmarks(selectedCharacter.id));
    }
  }, [selectedCharacter.id]);

  // Close WS chat on character switch
  useEffect(() => {
    wsChatRef.current?.close();
    wsChatRef.current = null;
  }, [selectedCharacter.id]);

  // Create a new bookmark
  const handleCreateBookmark = () => {
    if (!currentChatFileName || messages.length === 0) {
      toast.error("No messages to bookmark");
      return;
    }

    const name = window.prompt(
      "Enter bookmark name:",
      `Checkpoint - ${messages.length} messages`,
    );
    if (!name) return;

    const bookmark = createBookmark(
      selectedCharacter.id,
      currentChatFileName,
      messages,
      name,
    );

    saveBookmark(bookmark);
    setBookmarks((prev) => [bookmark, ...prev]);
    toast.success("Bookmark created");
  };

  // Restore from a bookmark
  const handleRestoreBookmark = (bookmark: ChatBookmark) => {
    if (
      !window.confirm(
        `Restore to "${bookmark.name}"? Current messages after this point will be replaced.`,
      )
    )
      return;

    setMessages(bookmark.messages);
    setShowBookmarks(false);
    toast.success("Restored from bookmark");
  };

  // Delete a bookmark
  const handleDeleteBookmark = (bookmarkId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm("Delete this bookmark?")) return;

    deleteBookmark(bookmarkId);
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    toast.success("Bookmark deleted");
  };

  // ==================== END BOOKMARK HANDLERS ====================

  // ==================== GROUP CHAT HANDLERS ====================

  // Handle selecting a group chat
  const handleSelectGroup = (group: GroupChat) => {
    setActiveGroup(group);
    setShowGroupManager(false);

    // Start a new chat for the group
    const newFileName = createNewChatFileName(`Group-${group.name}`);
    setCurrentChatFileName(newFileName);

    // Get the first character to speak
    const firstChar = selectNextCharacter(group, characters);
    if (firstChar) {
      const greeting: Message = {
        id: "group-init-" + Date.now(),
        role: Role.Model,
        content: `*${firstChar.name} enters the conversation*\n\n${firstChar.firstMessage || `Hello! I'm ${firstChar.name}.`}`,
        timestamp: Date.now(),
        extra: {
          characterId: firstChar.id,
          characterName: firstChar.name,
        },
      } as GroupMessage;
      setMessages([greeting]);

      // Update last active character
      updateGroupChat(group.id, { lastActiveCharacterId: firstChar.id });
    }

    toast.success(`Entered group: ${group.name}`);
  };

  // Exit group chat mode
  const handleExitGroup = () => {
    setActiveGroup(null);
    startNewChat();
    toast.success("Exited group chat");
  };

  return {
    t,
    language,
    setLanguage,
    characters,
    selectedCharacter,
    setSelectedCharacter,
    messages,
    setMessages,
    inputText,
    setInputText,
    isTyping,
    config,
    isListening,
    toggleVoiceInput,
    leftSidebarOpen,
    setLeftSidebarOpen,
    rightSidebarOpen,
    setRightSidebarOpen,
    mobileMenuOpen,
    setMobileMenuOpen,
    mobileSettingsOpen,
    setMobileSettingsOpen,
    showRestorePrompt,
    savedChatCharacterName,
    currentChatFileName,
    setCurrentChatFileName,
    chatHistory,
    showChatHistory,
    setShowChatHistory,
    isSavingChat,
    bookmarks,
    showBookmarks,
    setShowBookmarks,
    showMoreMenu,
    setShowMoreMenu,
    activeGroup,
    showGroupManager,
    setShowGroupManager,
    showCharacterEditor,
    setShowCharacterEditor,
    showImageGen,
    setShowImageGen,
    imageGenPrompt,
    setImageGenPrompt,
    editingCharacterId,
    tokenCount,
    chatEndRef,
    isComposingRef,
    handleConfigChange,
    refreshCharacters,
    handleEditCharacter,
    handleCreateCharacter,
    handleSaveCharacter,
    handleDeleteCharacter,
    handleRestoreChat,
    handleStartFresh,
    startNewChat,
    handleSendMessage,
    handleKeyDown,
    clearChat,
    handleSwipeChange,
    handleGenerateSwipe,
    handleRegenerate,
    handleContinue,
    handleEditMessage,
    handleDeleteMessage,
    handleGenerateImage,
    handleCreateBookmark,
    handleRestoreBookmark,
    handleDeleteBookmark,
    handleSelectGroup,
    handleExitGroup,
  };
};
