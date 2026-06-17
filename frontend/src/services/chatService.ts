/**
 * Chat Service — local chat history persistence.
 *
 * Backed by IndexedDB (see chatStorage.ts). The previous localStorage blob
 * (`romanbath_chat_history_v1`) is read once on first launch to migrate
 * existing chats into IndexedDB, then removed. After migration completes,
 * IndexedDB is the sole source of truth.
 */

import { Message } from '../types';
import {
  StoredChat as IDBStoredChat,
  storageGetChat,
  storageSetChat,
  storageDeleteChat,
  storageListChats,
  storageListAllChats,
  storageClearForTests,
} from './chatStorage';

const LEGACY_STORAGE_KEY = 'romanbath_chat_history_v1';

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

// Shape persisted by the old localStorage blob.
interface LegacyStoredChat {
  fileName: string;
  characterId: string;
  characterName: string;
  userName: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface LegacyChatStore {
  [characterId: string]: LegacyStoredChat[];
}

// Migration runs at most once per session. The promise is shared so callers
// landing on chatService during the initial mount all await the same run.
let migrationPromise: Promise<void> | null = null;

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

const parseLegacyStore = (raw: string | null): LegacyChatStore | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as LegacyChatStore;
  } catch {
    return null;
  }
};

/**
 * Copy any chats still in localStorage into IndexedDB, then drop the legacy
 * key. Idempotent: if IndexedDB already has chats we assume migration ran
 * previously and skip the copy so we don't clobber newer writes.
 */
export const migrateFromLocalStorageIfNeeded = async (): Promise<void> => {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) return;

  // Idempotency check — IndexedDB already populated means we already migrated.
  const existing = await storageListAllChats();
  if (existing.length > 0) {
    // Drop the legacy blob if it's still hanging around so we don't keep
    // re-reading it on every launch.
    if (globalThis.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    return;
  }

  const legacy = parseLegacyStore(globalThis.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (!legacy) return;

  for (const characterId of Object.keys(legacy)) {
    for (const chat of legacy[characterId]) {
      try {
        await storageSetChat(chat as IDBStoredChat);
      } catch (error) {
        // Leave the legacy key intact so the next launch retries. Surface the
        // error so it doesn't fail silently.
        console.error('Chat history migration failed for', characterId, chat.fileName, error);
        return;
      }
    }
  }

  // Only remove the source after every chat landed in IndexedDB.
  globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
};

const ensureMigrated = (): Promise<void> => {
  if (!migrationPromise) {
    migrationPromise = migrateFromLocalStorageIfNeeded().catch((error) => {
      // Allow a fresh retry next launch rather than pinning the failure.
      migrationPromise = null;
      console.error('Chat history migration error:', error);
    });
  }
  return migrationPromise;
};

// Kick off migration eagerly on module load. Failure here doesn't block the
// API — every public function below also awaits ensureMigrated() so a lazy
// retry path still exists for late arrivals.
if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
  void ensureMigrated();
}

export const saveChat = async (
  characterId: string,
  chatFileName: string,
  messages: Message[],
  userName: string,
  characterName: string,
): Promise<boolean> => {
  try {
    await ensureMigrated();
    const now = Date.now();
    const existing = await storageGetChat(characterId, chatFileName);

    const entry: StoredChat = {
      fileName: chatFileName,
      characterId,
      characterName,
      userName,
      messages,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await storageSetChat(entry as IDBStoredChat);
    return true;
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
    await ensureMigrated();
    const chat = await storageGetChat(characterId, chatFileName);
    if (!chat) {
      return { messages: [], metadata: null };
    }

    // Backfill tree structure. Legacy chats saved before Message Tree
    // ship without parentId/childrenIds; we link them linearly so the
    // first regenerate/edit creates a sibling under the right parent
    // instead of starting a parallel root branch.
    const messages = linkLinearTree(chat.messages.map((msg) => ({ ...msg })));

    return {
      messages,
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

// Ensure every message has parentId and childrenIds. If the saved chat
// pre-dates the tree model we synthesize a linear chain (each message's
// parent is the previous message in array order). Messages that already
// declare a parentId are left alone — their existing tree is respected.
export const linkLinearTree = <T extends { id: string; parentId?: string | null; childrenIds?: string[] }>(
  messages: T[],
): T[] => {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const next = messages.map((msg) => ({
    ...msg,
    parentId: msg.parentId ?? null,
    childrenIds: [...(msg.childrenIds ?? [])],
  }));

  // First pass: if parentId is null but the message is not actually a
  // root in array order, link it to the previous message. This is the
  // legacy-data migration path.
  for (let i = 0; i < next.length; i += 1) {
    const msg = next[i];
    if (msg.parentId === null && i > 0) {
      const prev = next[i - 1];
      msg.parentId = prev.id;
    }
  }

  // Second pass: rebuild childrenIds from the now-complete parentId set
  // so it's consistent even if the saved file had stale entries.
  const childrenOf = new Map<string | null, string[]>();
  for (const msg of next) {
    const list = childrenOf.get(msg.parentId) ?? [];
    list.push(msg.id);
    childrenOf.set(msg.parentId, list);
  }
  for (const msg of next) {
    msg.childrenIds = childrenOf.get(msg.id) ?? [];
  }

  // Suppress unused-var warning for byId — kept for future random-access
  // utilities without re-introducing a second scan.
  void byId;

  return next;
};

export const getChatList = async (characterId: string): Promise<ChatInfo[]> => {
  try {
    await ensureMigrated();
    const list = await storageListChats(characterId);
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
    await ensureMigrated();
    const all = await storageListAllChats();
    return all
      .slice()
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
    await ensureMigrated();
    await storageDeleteChat(characterId, chatFileName);
    return true;
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
    await ensureMigrated();
    const chat = await storageGetChat(characterId, originalFileName);
    if (!chat) return false;
    await storageDeleteChat(characterId, originalFileName);
    await storageSetChat({
      ...chat,
      fileName: newFileName,
      updatedAt: Date.now(),
    });
    return true;
  } catch (error) {
    console.error('Error renaming chat:', error);
    return false;
  }
};

export const createNewChatFileName = (characterName: string): string =>
  formatDateForFilename(characterName);

export const stripChatExtension = (fileName: string): string =>
  fileName.replace(/\.jsonl$/, '');

/**
 * Test-only: drop every IndexedDB chat record AND reset the cached migration
 * promise so the next call re-evaluates localStorage. Not part of the public
 * runtime API; exported purely so tests can isolate cases without restarting
 * the module (idb-keyval keeps the DB connection open, which makes
 * deleteDatabase block).
 */
export const _resetForTests = async (): Promise<void> => {
  await storageClearForTests();
  migrationPromise = null;
};
