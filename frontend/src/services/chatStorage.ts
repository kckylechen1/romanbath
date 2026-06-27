/**
 * IndexedDB access layer for chat history.
 *
 * One record per chat, keyed `${characterId}/${fileName}`. Replaces the
 * localStorage blob that used to hold every chat for every character in a
 * single JSON string — that capped out at the 5-10MB localStorage quota and
 * silently truncated long roleplay chats.
 */

import { get, set, del, keys, clear, createStore } from 'idb-keyval';
import type { Message } from '../types';

const STORE_NAME = 'romanbath_chats_v1';

// Module-scoped store instance; lazily created once and reused. idb-keyval
// caches the DB connection, so subsequent calls are cheap.
const store = createStore(STORE_NAME, STORE_NAME);

export interface StoredChat {
  fileName: string;
  characterId: string;
  characterName: string;
  userName: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

const buildKey = (characterId: string, fileName: string): string => `${characterId}/${fileName}`;

export const storageGetChat = async (
  characterId: string,
  fileName: string
): Promise<StoredChat | undefined> => {
  const value = await get<StoredChat>(buildKey(characterId, fileName), store);
  return value;
};

export const storageSetChat = async (chat: StoredChat): Promise<void> => {
  try {
    await set(buildKey(chat.characterId, chat.fileName), chat, store);
  } catch (error) {
    // Quota exhaustion is recoverable by evicting the oldest chats across
    // every character; rethrow anything else so the caller sees the real
    // failure (structured-clone errors, IO faults, etc.).
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const evicted = await _evictOldestAcrossCharacters();
      if (!evicted) throw error;
      await set(buildKey(chat.characterId, chat.fileName), chat, store);
      return;
    }
    throw error;
  }
};

// Drop the oldest chats across all characters to free IDB quota. Returns
// true if anything was evicted so the caller can decide whether a retry is
// worth attempting. Pure LRU on updatedAt — we don't try to be smart about
// which character loses history, since cross-character fairness is the same
// long-tail problem the old localStorage writeStore had.
const EVICT_BATCH_SIZE = 5;

export const _evictOldestAcrossCharacters = async (): Promise<boolean> => {
  const all = await storageListAllChats();
  if (all.length === 0) return false;
  const sorted = all.slice().sort((a, b) => a.updatedAt - b.updatedAt);
  const victims = sorted.slice(0, Math.min(EVICT_BATCH_SIZE, sorted.length));
  for (const victim of victims) {
    await del(buildKey(victim.characterId, victim.fileName), store);
  }
  return victims.length > 0;
};

export const storageDeleteChat = async (characterId: string, fileName: string): Promise<void> => {
  await del(buildKey(characterId, fileName), store);
};

export const storageListChats = async (characterId: string): Promise<StoredChat[]> => {
  const allKeys = await keys<string>(store);
  const prefix = `${characterId}/`;
  const matching = allKeys.filter((k) => typeof k === 'string' && k.startsWith(prefix));
  const results: StoredChat[] = [];
  for (const key of matching) {
    const value = await get<StoredChat>(key, store);
    if (value) results.push(value);
  }
  return results;
};

export const storageListAllChats = async (): Promise<StoredChat[]> => {
  const allKeys = await keys<string>(store);
  const results: StoredChat[] = [];
  for (const key of allKeys) {
    const value = await get<StoredChat>(key, store);
    if (value) results.push(value);
  }
  return results;
};

// Test-only helper: drops every chat record without tearing down the DB
// connection. Exported so tests can isolate cases without re-opening the
// store, which fake-indexeddb makes awkward via deleteDatabase.
export const storageClearForTests = async (): Promise<void> => {
  await clear(store);
};
