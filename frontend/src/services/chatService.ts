/**
 * Chat Service — local chat history persistence (browser localStorage).
 * Local chat history persistence for Roman Bath.
 * Stored in the browser; ZeroClaw gateway has no chat-history endpoint.
 */

import { Message } from '../types';

const STORAGE_KEY = 'romanbath_chat_history_v1';

export interface ChatInfo {
  file_name: string;
  file_id?: string;
  file_size: string;
  message_count?: number;
  chat_items?: number;
  mes?: string;
  last_mes?: number;
  preview_message?: string;
  avatar?: string;
}

interface StoredChat {
  fileName: string;
  characterId: string;
  characterName: string;
  userName: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChatStore {
  [characterId: string]: StoredChat[];
}

const readStore = (): ChatStore => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ChatStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeStore = (store: ChatStore): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      // Try to free space by removing oldest chats across all characters
      let freed = false;
      for (const characterId of Object.keys(store)) {
        const list = store[characterId];
        if (list.length > 1) {
          list.pop(); // Remove oldest
          freed = true;
        } else if (list.length === 1) {
          delete store[characterId];
          freed = true;
        }
        if (freed) break;
      }
      if (freed) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
          return true;
        } catch {
          // Still failing after cleanup
        }
      }
    }
    return false;
  }
};

const toChatInfo = (chat: StoredChat): ChatInfo => {
  const lastMessage = chat.messages[chat.messages.length - 1];
  return {
    file_name: chat.fileName,
    file_size: String(JSON.stringify(chat.messages).length),
    message_count: chat.messages.length,
    chat_items: chat.messages.length,
    preview_message: lastMessage?.content?.slice(0, 120) ?? '',
    last_mes: chat.updatedAt,
  };
};

const formatDateForFilename = (characterName: string): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  return `${characterName} - ${year}-${month}-${day} @${hours}h ${minutes}m ${seconds}s ${ms}ms`;
};

export const saveChat = async (
  characterId: string,
  chatFileName: string,
  messages: Message[],
  userName: string,
  characterName: string,
): Promise<boolean> => {
  try {
    const store = readStore();
    const list = store[characterId] ?? [];
    const now = Date.now();
    const existingIdx = list.findIndex((c) => c.fileName === chatFileName);

    const entry: StoredChat = {
      fileName: chatFileName,
      characterId,
      characterName,
      userName,
      messages,
      createdAt: existingIdx >= 0 ? list[existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.unshift(entry);
    }

    store[characterId] = list;
    return writeStore(store);
  } catch (error) {
    console.error('Error saving chat:', error);
    return false;
  }
};

export const loadChat = async (
  characterId: string,
  chatFileName: string,
): Promise<{ messages: Message[]; metadata: { user_name: string; character_name: string } | null }> => {
  try {
    const store = readStore();
    const chat = store[characterId]?.find((c) => c.fileName === chatFileName);
    if (!chat) {
      return { messages: [], metadata: null };
    }

    return {
      messages: chat.messages.map((msg) => ({ ...msg })),
      metadata: {
        user_name: chat.userName,
        character_name: chat.characterName,
      },
    };
  } catch (error) {
    console.error('Error loading chat:', error);
    return { messages: [], metadata: null };
  }
};

export const getChatList = async (characterId: string): Promise<ChatInfo[]> => {
  try {
    const store = readStore();
    const list = store[characterId] ?? [];
    return list
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toChatInfo);
  } catch (error) {
    console.error('Error getting chat list:', error);
    return [];
  }
};

export const getRecentChats = async (max: number = 20): Promise<ChatInfo[]> => {
  try {
    const store = readStore();
    const all: Array<StoredChat & { characterId: string }> = [];
    for (const [characterId, chats] of Object.entries(store)) {
      for (const chat of chats) {
        all.push({ ...chat, characterId });
      }
    }
    return all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, max)
      .map(toChatInfo);
  } catch (error) {
    console.error('Error getting recent chats:', error);
    return [];
  }
};

export const deleteChat = async (characterId: string, chatFileName: string): Promise<boolean> => {
  try {
    const store = readStore();
    const list = store[characterId] ?? [];
    store[characterId] = list.filter((c) => c.fileName !== chatFileName);
    return writeStore(store);
  } catch (error) {
    console.error('Error deleting chat:', error);
    return false;
  }
};

export const renameChat = async (
  characterId: string,
  originalFileName: string,
  newFileName: string,
): Promise<boolean> => {
  try {
    const store = readStore();
    const list = store[characterId] ?? [];
    const chat = list.find((c) => c.fileName === originalFileName);
    if (!chat) return false;
    chat.fileName = newFileName;
    chat.updatedAt = Date.now();
    return writeStore(store);
  } catch (error) {
    console.error('Error renaming chat:', error);
    return false;
  }
};

export const createNewChatFileName = (characterName: string): string =>
  formatDateForFilename(characterName);

export const stripChatExtension = (fileName: string): string =>
  fileName.replace(/\.jsonl$/, '');
