import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  getBranchMeta,
  setBranchName,
  toggleBranchFavorite,
} from './branchMetaStore';

describe('branchMetaStore', () => {
  it('returns an empty map for a chat with no metadata', async () => {
    expect(await getBranchMeta('char-x', 'fresh.jsonl')).toEqual({});
  });

  it('sets and reads back a branch name', async () => {
    await setBranchName('char-a', 'chat-1', 'node-1', '  Alternate ending  ');
    const map = await getBranchMeta('char-a', 'chat-1');
    expect(map['node-1']).toEqual({ name: 'Alternate ending' });
  });

  it('toggles a favorite on and off (round-trip)', async () => {
    const after1 = await toggleBranchFavorite('char-a', 'chat-2', 'node-2');
    expect(after1['node-2']).toEqual({ favorite: true });
    expect((await getBranchMeta('char-a', 'chat-2'))['node-2']).toEqual({ favorite: true });

    const after2 = await toggleBranchFavorite('char-a', 'chat-2', 'node-2');
    // Once neither a name nor a favorite remains, the entry is pruned.
    expect(after2['node-2']).toBeUndefined();
    expect((await getBranchMeta('char-a', 'chat-2'))['node-2']).toBeUndefined();
  });

  it('keeps name and favorite independent on the same node', async () => {
    await setBranchName('char-a', 'chat-3', 'n', 'Kept');
    await toggleBranchFavorite('char-a', 'chat-3', 'n');
    expect((await getBranchMeta('char-a', 'chat-3'))['n']).toEqual({
      name: 'Kept',
      favorite: true,
    });

    // Clearing the name leaves the favorite intact (entry not pruned).
    await setBranchName('char-a', 'chat-3', 'n', '   ');
    expect((await getBranchMeta('char-a', 'chat-3'))['n']).toEqual({ favorite: true });
  });

  it('scopes metadata per (character, chat)', async () => {
    await setBranchName('char-b', 'chat-1', 'shared', 'In chat 1');
    await setBranchName('char-b', 'chat-2', 'shared', 'In chat 2');
    await toggleBranchFavorite('char-c', 'chat-1', 'shared');

    expect((await getBranchMeta('char-b', 'chat-1'))['shared']).toEqual({ name: 'In chat 1' });
    expect((await getBranchMeta('char-b', 'chat-2'))['shared']).toEqual({ name: 'In chat 2' });
    expect((await getBranchMeta('char-c', 'chat-1'))['shared']).toEqual({ favorite: true });
  });
});
