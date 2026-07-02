import { useState, useEffect, useMemo } from 'react';
import type React from 'react';
import { DEFAULT_CONFIG } from '../constants';
import { Message, ChatConfig, GroupChat, GroupMessage, Role } from '../types';
import { getSettings } from '../services/zeroclawService';
import { countMessagesTokens } from '../services/tokenizerService';
import {
  getBookmarks,
  saveBookmark,
  deleteBookmark,
  createBookmark,
  ChatBookmark,
} from "../services/bookmarkService";
import {
  selectNextCharacter,
  updateGroupChat,
} from "../services/groupChatService";
import { createNewChatFileName } from "../services/chatService";
import { useToast } from "../components/Toast";
import { useLanguage } from "../i18n";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { generateId } from "../utils/id";
import { appFeatures } from "../config/features";
import { useCharacterManagement } from "./useCharacterManagement";
import { useChatPersistence } from "./useChatPersistence";
import { useChatGeneration } from "./useChatGeneration";
import { useMessageActions } from "./useMessageActions";
import { useChatPush } from "./useChatPush";
import { confirm as confirmDialog, prompt as promptDialog } from "../services/dialogService";
import { indexMessages, pathToRoot } from "./useMessageTree";
import type { StudioTab } from "../components/StudioRail";
import { useUIStore } from "../store/uiStore";

export const useAppLogic = () => {
  const { t, language, setLanguage } = useLanguage();
  const toast = useToast();

  // ==================== CHARACTER MANAGEMENT ====================
  const characterMgmt = useCharacterManagement();

  // ==================== SHARED CHAT STATE ====================
  const [messages, setMessages] = useState<Message[]>([]);
  const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);

  // ==================== MESSAGE TREE STATE ====================
  // Active leaf is the bottom of the currently rendered branch. Stays in
  // sync with messages: when messages reset/swap (new chat, character
  // switch, restore), activeLeafId is recomputed to the last message.
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);

  const messageTree = useMemo(() => indexMessages(messages), [messages]);

  // If the active leaf got removed (delete, character switch, restore),
  // fall back to the deepest reachable leaf from any root. This keeps
  // the rendered path non-empty whenever messages is non-empty.
  useEffect(() => {
    if (messages.length === 0) {
      setActiveLeafId(null);
      return;
    }
    if (!activeLeafId || !messageTree.byId.has(activeLeafId)) {
      // Default to the most recent message — matches the pre-tree UX
      // where the chat always scrolled to the bottom.
      const last = messages[messages.length - 1];
      setActiveLeafId(last.id);
    }
  }, [messages, activeLeafId, messageTree]);

  // Active path = walk from leaf to root, reversed. This is what the
  // chat view renders. Other consumers (persistence, token count) keep
  // using the full `messages` array so saving stores every branch.
  const activePath = useMemo(
    () => pathToRoot(messageTree, activeLeafId),
    [messageTree, activeLeafId]
  );

  // ==================== UI STATE (via zustand) ====================
  const ui = useUIStore();
  // ==================== STUDIO RAIL STATE ====================
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<StudioTab>('context');

  // ==================== BOOKMARK STATE ====================
  const [bookmarks, setBookmarks] = useState<ChatBookmark[]>([]);

  // ==================== GROUP CHAT STATE ====================
  const [activeGroup, setActiveGroup] = useState<GroupChat | null>(null);

  // ==================== TOKEN COUNT ====================
  const [tokenCount, setTokenCount] = useState(0);

  // ==================== CHAT PERSISTENCE ====================
  const chatPersistence = useChatPersistence(
    characterMgmt.selectedCharacter,
    messages,
    config,
    characterMgmt.characters,
    setMessages,
    characterMgmt.setSelectedCharacter
  );

  // ==================== CHAT GENERATION ====================
  const generation = useChatGeneration(
    characterMgmt.characters,
    characterMgmt.selectedCharacter,
    activeGroup,
    config,
    messages,
    activePath,
    setMessages,
    setActiveLeafId,
    toast,
    t,
    chatPersistence.currentChatFileName,
    setActiveGroup
  );

  // Voice Input
  const { isListening, toggleVoiceInput } = useSpeechRecognition((newTranscript) => {
    generation.setInputText((prev) => {
      const spacer = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
      return prev + spacer + newTranscript;
    });
  }, appFeatures.voiceInput);

  // ==================== MESSAGE ACTIONS ====================
  const messageActions = useMessageActions(
    messages,
    activePath,
    activeLeafId,
    setMessages,
    setActiveLeafId,
    characterMgmt.selectedCharacter,
    characterMgmt.characters,
    config,
    activeGroup,
    generation.setIsTyping,
    toast,
    generation.wsChatRef,
    generation.regenerateAssistant,
    generation.recordTombstones
  );

  // ==================== CHAT PUSH (server-initiated messages) =====
  useChatPush({
    agentAlias: 'default',
    characterName:
      characterMgmt.selectedCharacter.id !== 'default'
        ? characterMgmt.selectedCharacter.name
        : undefined,
    activeLeafId,
    setMessages,
    setActiveLeafId,
  });

  // ==================== CONFIG ====================
  const handleConfigChange = async (newConfig: ChatConfig) => {
    setConfig(newConfig);
  };

  // ==================== SETTINGS LOADING ====================
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await getSettings();
        if (settings && Object.keys(settings).length > 0) {
          setConfig((prev) => ({
            ...prev,
            temperature: (settings.temperature as number | undefined) ?? prev.temperature,
            maxOutputTokens:
              (settings.maxOutputTokens as number | undefined) ?? prev.maxOutputTokens,
            userName: (settings.username as string | undefined) ?? prev.userName,
          }));
        }
      } catch (e) {
        console.warn('Failed to load settings:', e);
      }
    };
    loadSettings();
  }, []);

  // ==================== TOKEN COUNT ====================
  useEffect(() => {
    const systemPrompt = characterMgmt.selectedCharacter.systemInstruction || '';
    const count = countMessagesTokens(messages) + Math.ceil(systemPrompt.length / 4);
    setTokenCount(count);
  }, [messages, characterMgmt.selectedCharacter.systemInstruction]);

  // ==================== BOOKMARKS ====================
  useEffect(() => {
    if (appFeatures.bookmarks && characterMgmt.selectedCharacter.id !== 'default') {
      setBookmarks(getBookmarks(characterMgmt.selectedCharacter.id));
    } else {
      setBookmarks([]);
    }
  }, [characterMgmt.selectedCharacter.id]);

  const handleCreateBookmark = async () => {
    if (!appFeatures.bookmarks) {
      toast.error('Bookmarks are disabled in this build');
      return;
    }

    if (!chatPersistence.currentChatFileName || messages.length === 0) {
      toast.error('No messages to bookmark');
      return;
    }

    const name = await promptDialog({
      title: 'Create bookmark',
      message: 'Give this checkpoint a name so you can find it later.',
      defaultValue: `Checkpoint - ${messages.length} messages`,
      placeholder: 'Bookmark name',
      confirmLabel: 'Create',
    });
    if (!name) return;

    const bookmark = createBookmark(
      characterMgmt.selectedCharacter.id,
      chatPersistence.currentChatFileName,
      messages,
      name
    );

    saveBookmark(bookmark);
    setBookmarks((prev) => [bookmark, ...prev]);
    toast.success('Bookmark created');
  };

  const handleRestoreBookmark = async (bookmark: ChatBookmark) => {
    if (!appFeatures.bookmarks) return;

    const ok = await confirmDialog({
      title: 'Restore bookmark?',
      message: `Restoring to "${bookmark.name}" will replace the current messages in this conversation.`,
      confirmLabel: 'Restore',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (!ok) return;

    setMessages(bookmark.messages);
    ui.setShowBookmarks(false);
    toast.success("Restored from bookmark");
  };

  const handleDeleteBookmark = async (bookmarkId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!appFeatures.bookmarks) return;

    const ok = await confirmDialog({
      title: 'Delete bookmark?',
      message: 'This bookmark will be removed permanently.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;

    deleteBookmark(bookmarkId);
    setBookmarks((prev) => prev.filter((b) => b.id !== bookmarkId));
    toast.success('Bookmark deleted');
  };

  // ==================== GROUP CHAT ====================
  const handleSelectGroup = (group: GroupChat) => {
    if (!appFeatures.groupChat) {
      toast.error('Group chat is disabled in this build');
      return;
    }

    setActiveGroup(group);
    ui.setShowGroupManager(false);

    const newFileName = createNewChatFileName(`Group-${group.name}`);
    chatPersistence.setCurrentChatFileName(newFileName);

    const firstChar = selectNextCharacter(group, characterMgmt.characters);
    if (firstChar) {
      const greeting: Message = {
        id: generateId(),
        role: Role.Model,
        content: `*${firstChar.name} enters the conversation*\n\n${firstChar.firstMessage || `Hello! I'm ${firstChar.name}.`}`,
        timestamp: Date.now(),
        extra: {
          characterId: firstChar.id,
          characterName: firstChar.name,
        },
      } as GroupMessage;
      setMessages([greeting]);

      updateGroupChat(group.id, {
        lastActiveCharacterId: firstChar.id,
      });
    }

    toast.success(`Entered group: ${group.name}`);
  };

  const handleExitGroup = () => {
    if (!appFeatures.groupChat) return;

    setActiveGroup(null);
    chatPersistence.startNewChat();
    toast.success('Exited group chat');
  };

  // ==================== IMAGE GENERATION ====================
  const handleGenerateImage = (prompt: string) => {
    if (!appFeatures.imageGeneration) {
      toast.error("Image generation is disabled in this build");
      return;
    }

    ui.setImageGenPrompt(prompt);
    ui.setShowImageGen(true);
  };

  // ==================== CLEAR CHAT ====================
  const clearChat = async () => {
    const ok = await confirmDialog({
      title: 'Reset conversation?',
      message:
        'This will clear the current chat and start a new one with your latest settings. Bookmarks are kept.',
      confirmLabel: 'Reset',
      cancelLabel: 'Cancel',
      danger: true,
    });
    if (ok) {
      chatPersistence.startNewChat();
    }
  };

  return {
    // i18n
    t,
    language,
    setLanguage,

    // Character management
    characters: characterMgmt.characters,
    selectedCharacter: characterMgmt.selectedCharacter,
    setSelectedCharacter: characterMgmt.setSelectedCharacter,
    refreshCharacters: characterMgmt.refreshCharacters,
    characterFilter: characterMgmt.characterFilter,
    setCharacterFilter: characterMgmt.setCharacterFilter,
    handleEditCharacter: characterMgmt.handleEditCharacter,
    handleCreateCharacter: characterMgmt.handleCreateCharacter,
    handleSaveCharacter: characterMgmt.handleSaveCharacter,
    handleDeleteCharacter: characterMgmt.handleDeleteCharacter,
    showCharacterEditor: characterMgmt.showCharacterEditor,
    setShowCharacterEditor: characterMgmt.setShowCharacterEditor,
    editingCharacterId: characterMgmt.editingCharacterId,

    // Chat state
    messages,
    setMessages,
    // Tree-rendered view. Active path is what the chat surface shows; the
    // full `messages` array above still carries every branch for save.
    activePath,
    activeLeafId,
    setActiveLeafId,
    messageTree,
    inputText: generation.inputText,
    setInputText: generation.setInputText,
    isTyping: generation.isTyping,
    currentAffect: generation.currentAffect,
    config,

    // Voice
    isListening,
    toggleVoiceInput,

    // UI
    leftSidebarOpen: ui.leftSidebarOpen,
    setLeftSidebarOpen: ui.setLeftSidebarOpen,
    rightSidebarOpen: ui.rightSidebarOpen,
    setRightSidebarOpen: ui.setRightSidebarOpen,
    mobileMenuOpen: ui.mobileMenuOpen,
    setMobileMenuOpen: ui.setMobileMenuOpen,
    mobileSettingsOpen: ui.mobileSettingsOpen,
    setMobileSettingsOpen: ui.setMobileSettingsOpen,
    studioOpen,
    setStudioOpen,
    studioTab,
    setStudioTab,

    // Studio inspector context (resolved system prompt + per-turn accounting)
    systemPrompt: generation.systemPrompt,
    turnContext: generation.turnContext,

    // Persistence
    showRestorePrompt: chatPersistence.showRestorePrompt,
    savedChatCharacterName: chatPersistence.savedChatCharacterName,
    currentChatFileName: chatPersistence.currentChatFileName,
    setCurrentChatFileName: chatPersistence.setCurrentChatFileName,
    chatHistory: chatPersistence.chatHistory,
    showChatHistory: chatPersistence.showChatHistory,
    setShowChatHistory: chatPersistence.setShowChatHistory,
    isSavingChat: chatPersistence.isSavingChat,

    // Bookmarks
    bookmarks,
    showBookmarks: ui.showBookmarks,
    setShowBookmarks: ui.setShowBookmarks,
    showMoreMenu: ui.showMoreMenu,
    setShowMoreMenu: ui.setShowMoreMenu,

    // Group chat
    activeGroup,
    showGroupManager: ui.showGroupManager,
    setShowGroupManager: ui.setShowGroupManager,

    // Image gen
    showImageGen: ui.showImageGen,
    setShowImageGen: ui.setShowImageGen,
    imageGenPrompt: ui.imageGenPrompt,
    setImageGenPrompt: ui.setImageGenPrompt,

    // Token count
    tokenCount,

    // Refs
    chatEndRef: generation.chatEndRef,
    isComposingRef: generation.isComposingRef,

    // Config
    handleConfigChange,

    // Chat operations
    handleRestoreChat: () => chatPersistence.handleRestoreChat(characterMgmt.characters),
    handleStartFresh: chatPersistence.handleStartFresh,
    startNewChat: chatPersistence.startNewChat,
    handleSendMessage: generation.handleSendMessage,
    handleKeyDown: generation.handleKeyDown,
    clearChat,

    // Message actions
    handleSwipeChange: messageActions.handleSwipeChange,
    handleGenerateSwipe: messageActions.handleGenerateSwipe,
    handleRegenerate: messageActions.handleRegenerate,
    handleContinue: messageActions.handleContinue,
    handleEditMessage: messageActions.handleEditMessage,
    handleDeleteMessage: messageActions.handleDeleteMessage,

    // Other handlers
    handleGenerateImage,
    handleCreateBookmark,
    handleRestoreBookmark,
    handleDeleteBookmark,
    handleSelectGroup,
    handleExitGroup,
  };
};
