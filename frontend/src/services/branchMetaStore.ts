/**
 * Per-chat branch metadata: user-given names and favorite flags for runs in the
 * conversation fork graph, keyed by the run head's node id.
 *
 * Naming and favoriting a branch is a per-device convenience layer over the
 * authoritative message tree, not part of the saved chat itself. Kept in its
 * own idb-keyval store (separate from the debounced StoredChat write path and
 * from tombstones) so toggling a star never churns the chat save. Mirrors
 * tombstoneStore: scoped by (characterId, fileName), survives reloads, and a
 * fresh client simply starts with no names.
 */

import { get, set, createStore } from 'idb-keyval';

const STORE_NAME = 'romanbath_branchmeta_v1';

const store = createStore(STORE_NAME, STORE_NAME);

export interface BranchMeta {
  name?: string;
  favorite?: boolean;
}

/** Map from run-head node id to its metadata. Absent ids have no metadata. */
export type BranchMetaMap = Record<string, BranchMeta>;

const buildKey = (characterId: string, fileName: string): string => `${characterId}/${fileName}`;

/** All branch metadata for a chat (empty object if none). */
export const getBranchMeta = async (
  characterId: string,
  fileName: string
): Promise<BranchMetaMap> => {
  const value = await get<BranchMetaMap>(buildKey(characterId, fileName), store);
  return value ?? {};
};

// Drop a node's entry entirely once it carries no name and no favorite, so the
// store doesn't accumulate empty shells.
const pruneEmpty = (map: BranchMetaMap, nodeId: string): void => {
  const meta = map[nodeId];
  if (meta && !meta.name && !meta.favorite) delete map[nodeId];
};

/**
 * Set (or clear, when `name` is blank) a branch's display name. Returns the
 * updated map so the caller can refresh state without a second read.
 */
export const setBranchName = async (
  characterId: string,
  fileName: string,
  nodeId: string,
  name: string
): Promise<BranchMetaMap> => {
  const key = buildKey(characterId, fileName);
  const map = (await get<BranchMetaMap>(key, store)) ?? {};
  const trimmed = name.trim();
  const next: BranchMeta = { ...(map[nodeId] ?? {}) };
  if (trimmed) next.name = trimmed;
  else delete next.name;
  map[nodeId] = next;
  pruneEmpty(map, nodeId);
  await set(key, map, store);
  return map;
};

/** Flip a branch's favorite flag. Returns the updated map. */
export const toggleBranchFavorite = async (
  characterId: string,
  fileName: string,
  nodeId: string
): Promise<BranchMetaMap> => {
  const key = buildKey(characterId, fileName);
  const map = (await get<BranchMetaMap>(key, store)) ?? {};
  const next: BranchMeta = { ...(map[nodeId] ?? {}) };
  if (next.favorite) delete next.favorite;
  else next.favorite = true;
  map[nodeId] = next;
  pruneEmpty(map, nodeId);
  await set(key, map, store);
  return map;
};
