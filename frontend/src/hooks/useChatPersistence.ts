import { useState, useRef, useCallback, useEffect } from "react";
import type React from "react";
import { Character, Message, ChatConfig } from "../types";
import type { ChatInfo } from "../services/chatService";
import {
  getAppSettings,
  saveLastSession,
  loadLastSession,
  clearLastSession,
} from "../services/chatPersistenceService";
import {
  saveChat,
  loadChat,
  getChatList,
  createNewChatFileName,
  stripChatExtension,
} from "../services/chatService";
import { generateId } from "../utils/id";
import { Role } from "../types";

export interface UseChatPersistenceReturn {
  currentChatFileName: string | null;
  setCurrentChatFileName: React.Dispatch<React.SetStateAction<string | null>>;
  chatHistory: ChatInfo[];
  showChatHistory: boolean;
  setShowChatHistory: React.Dispatch<React.SetStateAction<boolean>>;
  isSavingChat: boolean;
  showRestorePrompt: boolean;
  savedChatCharacterName: string;
  loadChatHistory: () => Promise<void>;
  startNewChat: () => void;
  handleRestoreChat: (characters: Character[]) => void;
  handleStartFresh: () => void;
  hasInitializedRef: React.MutableRefObject<boolean>;
  restoreInProgressRef: React.MutableRefObject<boolean>;
}

export const useChatPersistence = (
  selectedCharacter: Character,
  messages: Message[],
  config: ChatConfig,
  characters: Character[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  setSelectedCharacter: React.Dispatch<React.SetStateAction<Character>>,
): UseChatPersistenceReturn => {
  const [currentChatFileName, setCurrentChatFileName] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatInfo[]>([]);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [isSavingChat, setIsSavingChat] = useState(false);
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const [savedChatCharacterName, setSavedChatCharacterName] = useState<string>("");

  const appSettings = getAppSettings();
  const hasInitializedRef = useRef(false);
  const restoreInProgressRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastLoadedCharacterIdRef = useRef<string | null>(null);

  const loadChatHistory = useCallback(async () => {
    if (selectedCharacter.id === "default") return;
    const history = await getChatList(selectedCharacter.id);
    setChatHistory(history);
  }, [selectedCharacter.id]);

  // Auto-save chat to backend (debounced)
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
    }, 2000);
  }, [messages, selectedCharacter.id, selectedCharacter.name, currentChatFileName, config.userName]);

  // Auto-save when messages change
  useEffect(() => {
    if (messages.length > 1 && currentChatFileName) {
      debouncedSaveToBackend();
    }
    // Persist a tiny last-session pointer so the boot-time restore
    // prompt knows which character + chat to offer. The messages
    // themselves live only in IndexedDB (single source of truth).
    if (
      messages.length > 0 &&
      selectedCharacter.id !== "default" &&
      appSettings.autoRestoreChat
    ) {
      saveLastSession({
        characterId: selectedCharacter.id,
        chatFileName: currentChatFileName ?? "",
        messageCount: messages.length,
        lastUpdated: Date.now(),
      });
    }
  }, [messages, currentChatFileName, debouncedSaveToBackend, selectedCharacter.id, appSettings.autoRestoreChat]);

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

      // Clear messages immediately to show we're switching
      setMessages([]);
      lastLoadedCharacterIdRef.current = null;

      try {
        const history = await getChatList(selectedCharacter.id);
        setChatHistory(history);

        // Check if character changed during async load
        if (currentCharacterId !== selectedCharacter.id) {
          return;
        }

        if (history.length > 0) {
          // Load the most recent chat
          const mostRecent = history[0];
          const fileName = stripChatExtension(mostRecent.file_name);

          const { messages: loadedMessages } = await loadChat(
            selectedCharacter.id,
            fileName,
          );

          if (currentCharacterId !== selectedCharacter.id) {
            return;
          }

          if (loadedMessages.length > 0) {
            setMessages(loadedMessages);
            setCurrentChatFileName(fileName);
            lastLoadedCharacterIdRef.current = currentCharacterId;
            return;
          }
        }

        // No existing chat, create new one
        if (currentCharacterId !== selectedCharacter.id) {
          return;
        }

        const newFileName = createNewChatFileName(selectedCharacter.name);
        setCurrentChatFileName(newFileName);

        const greeting: Message = {
          id: generateId(),
          role: Role.Model,
          content: selectedCharacter.firstMessage,
          timestamp: Date.now(),
        };
        setMessages([greeting]);
        lastLoadedCharacterIdRef.current = currentCharacterId;

        // Refresh chat history
        loadChatHistory();
      } catch (error) {
        console.error("Error loading chat for character:", currentCharacterId, error);
        // Even on error, create a new chat so the user can still interact
        const newFileName = createNewChatFileName(selectedCharacter.name);
        setCurrentChatFileName(newFileName);

        const greeting: Message = {
          id: generateId(),
          role: Role.Model,
          content: selectedCharacter.firstMessage,
          timestamp: Date.now(),
        };
        setMessages([greeting]);
        lastLoadedCharacterIdRef.current = currentCharacterId;
      }
    };

    if (hasInitializedRef.current && selectedCharacter.id !== "default") {
      loadRecentChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCharacter.id, loadChatHistory]);

  useEffect(() => {
    if (restoreInProgressRef.current && currentChatFileName) {
      restoreInProgressRef.current = false;
    }
  }, [currentChatFileName]);

  // Check for saved chat on initial load
  useEffect(() => {
    if (hasInitializedRef.current) return;

    const lastSession = loadLastSession();
    if (lastSession && appSettings.autoRestoreChat && characters.length > 0) {
      const savedCharacter = characters.find(
        (c) => c.id === lastSession.characterId,
      );
      if (savedCharacter && lastSession.messageCount > 1) {
        setSavedChatCharacterName(savedCharacter.name);
        setShowRestorePrompt(true);
      } else {
        hasInitializedRef.current = true;
      }
    } else {
      hasInitializedRef.current = true;
    }
  }, [characters, appSettings.autoRestoreChat]);

  const handleRestoreChat = async (characters: Character[]) => {
    const lastSession = loadLastSession();
    if (lastSession) {
      const savedCharacter = characters.find(
        (c) => c.id === lastSession.characterId,
      );
      if (savedCharacter) {
        restoreInProgressRef.current = true;
        setSelectedCharacter(savedCharacter);
        // Pull the canonical messages from IndexedDB — the localStorage
        // pointer only carries metadata, never the messages themselves.
        try {
          const { messages: loaded } = await loadChat(
            savedCharacter.id,
            lastSession.chatFileName,
          );
          setMessages(loaded.length > 0 ? loaded : []);
        } catch {
          setMessages([]);
        }
        setCurrentChatFileName(
          lastSession.chatFileName || createNewChatFileName(savedCharacter.name),
        );
      }
    }
    setShowRestorePrompt(false);
    hasInitializedRef.current = true;
  };

  const startNewChat = useCallback(() => {
    const newFileName = createNewChatFileName(selectedCharacter.name);
    setCurrentChatFileName(newFileName);

    const greeting: Message = {
      id: generateId(),
      role: Role.Model,
      content: selectedCharacter.firstMessage,
      timestamp: Date.now(),
    };
    setMessages([greeting]);

    loadChatHistory();
  }, [selectedCharacter, setMessages, loadChatHistory]);

  const handleStartFresh = () => {
    clearLastSession();
    setShowRestorePrompt(false);
    hasInitializedRef.current = true;
    startNewChat();
  };

  return {
    currentChatFileName,
    setCurrentChatFileName,
    chatHistory,
    showChatHistory,
    setShowChatHistory,
    isSavingChat,
    showRestorePrompt,
    savedChatCharacterName,
    loadChatHistory,
    startNewChat,
    handleRestoreChat,
    handleStartFresh,
    hasInitializedRef,
    restoreInProgressRef,
  };
};
