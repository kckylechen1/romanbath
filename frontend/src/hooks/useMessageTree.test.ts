import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { Role } from '../types';
import {
  deepestLeaf,
  indexMessages,
  mergeServerNodes,
  shouldAdoptServerLeaf,
} from './useMessageTree';

const mk = (
  id: string,
  parentId: string | null,
  childrenIds: string[] = [],
  timestamp = 0
): Message => ({
  id,
  role: Role.User,
  content: id,
  timestamp,
  parentId,
  childrenIds,
});

describe('deepestLeaf', () => {
  it('returns null when fromId is not in the tree', () => {
    // Race-condition guard: when a branch switch races with a concurrent
    // setMessages, the caller can hand us an id that no longer resolves.
    // Crashing here would take out the whole swipe handler.
    const tree = indexMessages([mk('a', null)]);
    expect(deepestLeaf(tree, 'missing')).toBeNull();
  });

  it('descends through children to the leaf', () => {
    const tree = indexMessages([mk('a', null, ['b']), mk('b', 'a', ['c']), mk('c', 'b', [])]);
    expect(deepestLeaf(tree, 'a')?.id).toBe('c');
  });
});

describe('mergeServerNodes', () => {
  it('is a no-op when every server node is already local (same-device, ids match)', () => {
    const local = [mk('u1', null), mk('a1', 'u1')];
    const merged = mergeServerNodes(local, [
      { id: 'u1', parent_id: null, role: 'user', content: 'hi' },
      { id: 'a1', parent_id: 'u1', role: 'assistant', content: 'hello' },
    ]);
    expect(merged).toBe(local); // referential no-op
  });

  it('adds server-only nodes (cross-device) without disturbing local ones', () => {
    const local = [mk('u1', null), mk('a1', 'u1')];
    const merged = mergeServerNodes(local, [
      { id: 'u1', parent_id: null, role: 'user', content: 'hi' },
      { id: 'a1', parent_id: 'u1', role: 'assistant', content: 'local content stays' },
      { id: 'u2', parent_id: 'a1', role: 'user', content: 'from another device' },
      { id: 'a2', parent_id: 'u2', role: 'assistant', content: 'reply' },
    ]);
    expect(merged.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    // Existing local node keeps its content (server content does NOT clobber it).
    expect(merged.find((m) => m.id === 'a1')!.content).toBe('a1');
    // childrenIds is rebuilt so leaf-detection (BranchMiniMap) stays consistent:
    // a1 is no longer a phantom leaf — it now has child u2; only a2 is a leaf.
    expect(merged.find((m) => m.id === 'a1')!.childrenIds).toEqual(['u2']);
    expect(merged.find((m) => m.id === 'u2')!.childrenIds).toEqual(['a2']);
    expect(merged.find((m) => m.id === 'a2')!.childrenIds).toEqual([]);
    // Added nodes map role + parent correctly for rendering.
    const a2 = merged.find((m) => m.id === 'a2')!;
    expect(a2.role).toBe(Role.Model);
    expect(a2.parentId).toBe('u2');
    const u2 = merged.find((m) => m.id === 'u2')!;
    expect(u2.role).toBe(Role.User);
  });

  it('returns the same array when there are no server nodes', () => {
    const local = [mk('u1', null)];
    expect(mergeServerNodes(local, [])).toBe(local);
  });

  it('does NOT resurrect a tombstoned (locally-deleted) server node', () => {
    // The user deleted {u2,a2} locally; the server snapshot still has them
    // (delete frame never landed). With those ids tombstoned the merge must NOT
    // re-add them, even though they are server-only.
    const local = [mk('u1', null), mk('a1', 'u1')];
    const merged = mergeServerNodes(
      local,
      [
        { id: 'u1', parent_id: null, role: 'user', content: 'hi' },
        { id: 'a1', parent_id: 'u1', role: 'assistant', content: 'a1' },
        { id: 'u2', parent_id: 'a1', role: 'user', content: 'deleted-locally' },
        { id: 'a2', parent_id: 'u2', role: 'assistant', content: 'deleted-locally' },
      ],
      new Set(['u2', 'a2'])
    );
    expect(merged.map((m) => m.id).sort()).toEqual(['a1', 'u1']);
  });

  it('still adds non-tombstoned server-only nodes when a tombstone set is given', () => {
    const local = [mk('u1', null)];
    const merged = mergeServerNodes(
      local,
      [
        { id: 'u1', parent_id: null, role: 'user', content: 'hi' },
        { id: 'a1', parent_id: 'u1', role: 'assistant', content: 'genuinely new' },
      ],
      new Set(['some-other-deleted-id'])
    );
    expect(merged.map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});

describe('shouldAdoptServerLeaf (X3 adoption safety)', () => {
  it('adopts on a fresh client (empty local tree) when the leaf is in the merged tree', () => {
    // Cleared cache / new device: nothing local to contradict, land where the
    // server says the active branch is.
    expect(shouldAdoptServerLeaf(new Set(), new Set(['a2']), 'a2')).toBe(true);
  });

  it('adopts a leaf the client already had locally (reload → stay on my branch)', () => {
    expect(shouldAdoptServerLeaf(new Set(['u1', 'a1', 'a2']), new Set(['u1', 'a1', 'a2']), 'a2')).toBe(
      true
    );
  });

  it('does NOT adopt a resurrected leaf absent from the local tree (deleted locally)', () => {
    // The user deleted subtree {u2,a2} locally; the merge resurrected it from
    // the server (delete frame never landed). It is in mergedIds but NOT in the
    // non-empty localIds, so X3 must NOT yank the user onto it.
    const localIds = new Set(['u1', 'a1']);
    const mergedIds = new Set(['u1', 'a1', 'u2', 'a2']);
    expect(shouldAdoptServerLeaf(localIds, mergedIds, 'a2')).toBe(false);
  });

  it('does NOT adopt a leaf missing from the merged tree', () => {
    expect(shouldAdoptServerLeaf(new Set(['u1']), new Set(['u1']), 'ghost')).toBe(false);
  });

  it('does NOT adopt when there is no server active leaf', () => {
    expect(shouldAdoptServerLeaf(new Set(['u1']), new Set(['u1']), null)).toBe(false);
    expect(shouldAdoptServerLeaf(new Set(['u1']), new Set(['u1']), undefined)).toBe(false);
  });
});
