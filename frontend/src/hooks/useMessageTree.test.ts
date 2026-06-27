import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { Role } from '../types';
import { deepestLeaf, indexMessages, mergeServerNodes } from './useMessageTree';

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
});
