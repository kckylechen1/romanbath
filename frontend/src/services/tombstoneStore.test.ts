import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { getTombstones, addTombstones } from './tombstoneStore';

describe('tombstoneStore', () => {
  it('returns an empty array for a chat with no tombstones', async () => {
    expect(await getTombstones('char-x', 'fresh.jsonl')).toEqual([]);
  });

  it('persists and unions deleted ids across calls (dedup)', async () => {
    await addTombstones('char-a', 'chat-1', ['n1', 'n2']);
    await addTombstones('char-a', 'chat-1', ['n2', 'n3']); // n2 overlaps
    const ids = (await getTombstones('char-a', 'chat-1')).sort();
    expect(ids).toEqual(['n1', 'n2', 'n3']);
  });

  it('scopes tombstones per (character, chat)', async () => {
    await addTombstones('char-b', 'chat-1', ['x']);
    await addTombstones('char-b', 'chat-2', ['y']);
    expect(await getTombstones('char-b', 'chat-1')).toEqual(['x']);
    expect(await getTombstones('char-b', 'chat-2')).toEqual(['y']);
  });

  it('is a no-op for an empty id list', async () => {
    await addTombstones('char-c', 'chat-1', []);
    expect(await getTombstones('char-c', 'chat-1')).toEqual([]);
  });
});
