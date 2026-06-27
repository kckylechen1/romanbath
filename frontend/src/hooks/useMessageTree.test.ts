import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { Role } from '../types';
import { deepestLeaf, indexMessages } from './useMessageTree';

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
