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

const buildKey = (characterId: string, fileName: string): string =>
  `${characterId}/${fileName}`;

export const storageGetChat = async (
  characterId: string,
  fileName: string,
): Promise<StoredChat | undefined> => {
  const value = await get<StoredChat>(buildKey(characterId, fileName), store);
  return value;
};

export const storageSetChat = async (chat: StoredChat): Promise<void> => {
  await set(buildKey(chat.characterId, chat.fileName), chat, store);
};

export const storageDeleteChat = async (
  characterId: string,
  fileName: string,
): Promise<void> => {
  await del(buildKey(characterId, fileName), store);
};

export const storageListChats = async (
  characterId: string,
): Promise<StoredChat[]> => {
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
