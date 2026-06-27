/**
 * Per-chat tombstones: ids of conversation nodes the user deleted locally.
 *
 * The WS history_snapshot is a UNION merge (mergeServerNodes) — it re-adds any
 * server node the client doesn't have. If a delete frame never reached the
 * server (deleted while offline) the server still has the subtree, so a later
 * reload would RESURRECT it. Persisting the deleted ids lets the merge skip
 * them permanently, even across a full reload. Kept in its own idb-keyval store
 * so recording a delete doesn't touch the debounced StoredChat write path.
 *
 * A fresh client (cleared IndexedDB) also clears its tombstones, so it
 * correctly loads the full server tree — tombstones are a per-device memory of
 * "I deleted this", not a global authority.
 */

import { get, set, createStore } from 'idb-keyval';

const STORE_NAME = 'romanbath_tombstones_v1';

const store = createStore(STORE_NAME, STORE_NAME);

const buildKey = (characterId: string, fileName: string): string => `${characterId}/${fileName}`;

/** All node ids the user has deleted in this chat (empty if none). */
export const getTombstones = async (
  characterId: string,
  fileName: string
): Promise<string[]> => {
  const value = await get<string[]>(buildKey(characterId, fileName), store);
  return value ?? [];
};

/** Union `ids` into the chat's tombstone set (dedup; no-op for an empty list). */
export const addTombstones = async (
  characterId: string,
  fileName: string,
  ids: string[]
): Promise<void> => {
  if (ids.length === 0) return;
  const key = buildKey(characterId, fileName);
  const existing = (await get<string[]>(key, store)) ?? [];
  const merged = Array.from(new Set([...existing, ...ids]));
  if (merged.length === existing.length) return; // nothing new
  await set(key, merged, store);
};
