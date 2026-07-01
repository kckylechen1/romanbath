/**
 * Chat Service — local chat history persistence.
 *
 * Backed by IndexedDB (see chatStorage.ts). The previous localStorage blob
 * (`romanbath_chat_history_v1`) is read once on first launch to migrate
 * existing chats into IndexedDB, then removed. After migration completes,
 * IndexedDB is the sole source of truth.
 */

import { Message, Role } from '../types';
import {
  StoredChat as IDBStoredChat,
  storageGetChat,
  storageSetChat,
  storageDeleteChat,
  storageListChats,
  storageListAllChats,
  storageClearForTests,
} from './chatStorage';
import {
  getSessionTree,
  sessionKeyForCharacter,
  getToken,
  type SessionTreeNode,
} from './zeroclawService';

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
 * key. Idempotency keys off the legacy localStorage key itself — NOT the
 * contents of IndexedDB — so a mid-loop failure or a race with saveChat
 * cannot lose the unmigrated history.
 */
export const migrateFromLocalStorageIfNeeded = async (): Promise<void> => {
  if (typeof globalThis === 'undefined' || !globalThis.localStorage) return;

  // No legacy key means migration is fully done (or never had anything to
  // migrate). This is the only correct idempotency signal: IDB contents
  // can be non-empty from a saveChat that beat migration to the punch.
  const legacyRaw = globalThis.localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacyRaw === null) return;

  const legacy = parseLegacyStore(legacyRaw);
  if (!legacy) {
    // Unparseable blob — drop it so a corrupt payload can't wedge migration
    // forever. Logged so a support ticket can recover the raw value if needed.
    console.error('Chat history legacy blob was unparseable; dropping it.');
    globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
    return;
  }

  // Watermark approach: each chat lands independently. Already-migrated
  // chats (from a partial prior run) are detected by storageGetChat so we
  // skip the rewrite instead of duplicating. Failures are logged and
  // skipped so one bad record doesn't block the rest.
  let allLanded = true;
  for (const characterId of Object.keys(legacy)) {
    for (const chat of legacy[characterId]) {
      try {
        const alreadyThere = await storageGetChat(characterId, chat.fileName);
        if (alreadyThere) continue;
        await storageSetChat(chat as IDBStoredChat);
      } catch (error) {
        allLanded = false;
        console.error('Chat history migration failed for', characterId, chat.fileName, error);
      }
    }
  }

  // Only drop the source once every chat is in IndexedDB. Partial runs leave
  // the legacy key in place so the next launch resumes from where it broke.
  if (allLanded) {
    globalThis.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
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
  characterName: string
): Promise<boolean> => {
  try {
    // Explicit race guard: if the legacy localStorage key is still present
    // when saveChat runs, the module-load migration kick hasn't finished
    // yet. Awaiting here makes sure we don't land a write that the migration
    // would then misclassify as "already migrated" and drop the blob.
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.localStorage &&
      globalThis.localStorage.getItem(LEGACY_STORAGE_KEY) !== null
    ) {
      await ensureMigrated();
    }

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
  chatFileName: string
): Promise<{
  messages: Message[];
  metadata: { user_name: string; character_name: string } | null;
}> => {
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
export const linkLinearTree = <
  T extends { id: string; parentId?: string | null; childrenIds?: string[] },
>(
  messages: T[]
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
  newFileName: string
): Promise<boolean> => {
  try {
    await ensureMigrated();
    const chat = await storageGetChat(characterId, originalFileName);
    if (!chat) return false;
    // Write the new key first and only delete the old one once the new one
    // is safely on disk. If setChat throws (quota, IO) the original is
    // preserved so a rename can't lose the chat.
    await storageSetChat({
      ...chat,
      fileName: newFileName,
      updatedAt: Date.now(),
    });
    await storageDeleteChat(characterId, originalFileName);
    return true;
  } catch (error) {
    console.error('Error renaming chat:', error);
    return false;
  }
};

export const createNewChatFileName = (characterName: string): string =>
  formatDateForFilename(characterName);

export const stripChatExtension = (fileName: string): string => fileName.replace(/\.jsonl$/, '');

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

export interface ServerLoadResult {
  messages: Message[];
  activeLeafId: string | null;
  sessionKey: string;
}

function convertServerNodeToMessage(
  node: SessionTreeNode,
  childrenIds: string[]
): Message {
  const role = node.role === 'assistant' ? Role.Model : node.role === 'user' ? Role.User : Role.User;
  const timestamp = node.timestamp
    ? Date.parse(node.timestamp) || Date.now()
    : Date.now();
  return {
    id: node.id,
    role,
    content: node.content,
    timestamp,
    parentId: node.parent_id ?? null,
    childrenIds,
  };
}

export const loadMessagesFromServer = async (
  characterName: string
): Promise<ServerLoadResult | null> => {
  const sessionKey = sessionKeyForCharacter(characterName);
  const tree = await getSessionTree(sessionKey);
  if (!tree || !tree.session_persistence || tree.nodes.length === 0) {
    return null;
  }

  const childrenOf = new Map<string | null, string[]>();
  for (const node of tree.nodes) {
    const parentKey = node.parent_id ?? null;
    const arr = childrenOf.get(parentKey) ?? [];
    arr.push(node.id);
    childrenOf.set(parentKey, arr);
  }

  const messages: Message[] = tree.nodes.map((node) =>
    convertServerNodeToMessage(node, childrenOf.get(node.id) ?? [])
  );

  return {
    messages,
    activeLeafId: tree.active_leaf,
    sessionKey,
  };
};

export async function migrateCharacterToServer(
  characterName: string,
  messages: Message[]
): Promise<{ inserted: number; skipped: number } | null> {
  if (messages.length === 0) return null;
  const sessionKey = sessionKeyForCharacter(characterName);
  const nodes = messages.map((msg) => ({
    id: msg.id,
    parent_id: msg.parentId ?? null,
    role: msg.role === Role.Model ? 'assistant' : 'user',
    content: msg.content,
    timestamp: new Date(msg.timestamp).toISOString(),
  }));

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch('/api/sessions/migrate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_key: sessionKey, nodes, name: characterName }),
    });
    if (!resp.ok) return null;
    const result = await resp.json();
    return { inserted: result.inserted ?? 0, skipped: result.skipped ?? 0 };
  } catch {
    return null;
  }
}
