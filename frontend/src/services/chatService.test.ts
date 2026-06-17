import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { Role, type Message } from '../types';
import {
  saveChat,
  loadChat,
  deleteChat,
  renameChat,
  getChatList,
  migrateFromLocalStorageIfNeeded,
  _resetForTests,
} from './chatService';

const LEGACY_KEY = 'romanbath_chat_history_v1';

// jsdom in this vitest config doesn't ship a working localStorage; provide
// a minimal shim so the migration path has something to read against.
const installLocalStorageShim = () => {
  const map = new Map<string, string>();
  const shim = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
  });
};

const createMessages = (count = 2): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    role: i % 2 === 0 ? Role.User : Role.Model,
    content: `Message ${i + 1}`,
    timestamp: Date.now() + i,
  }));

describe('chatService', () => {
  beforeEach(async () => {
    installLocalStorageShim();
    await _resetForTests();
  });

  it('saves and loads a chat', async () => {
    const messages = createMessages();
    const saved = await saveChat('char-1', 'Test Chat', messages, 'User', 'Character');
    expect(saved).toBe(true);

    const loaded = await loadChat('char-1', 'Test Chat');
    expect(loaded.messages).toHaveLength(2);
    expect(loaded.metadata?.character_name).toBe('Character');
  });

  it('lists chats sorted by most recent', async () => {
    await saveChat('char-1', 'Chat A', createMessages(), 'User', 'Char');
    await new Promise((r) => setTimeout(r, 10));
    await saveChat('char-1', 'Chat B', createMessages(), 'User', 'Char');

    const list = await getChatList('char-1');
    expect(list).toHaveLength(2);
    expect(list[0].file_name).toBe('Chat B');
  });

  it('deletes a chat', async () => {
    await saveChat('char-1', 'ToDelete', createMessages(), 'User', 'Char');
    const deleted = await deleteChat('char-1', 'ToDelete');
    expect(deleted).toBe(true);

    const list = await getChatList('char-1');
    expect(list).toHaveLength(0);
  });

  it('renames a chat', async () => {
    await saveChat('char-1', 'OldName', createMessages(), 'User', 'Char');
    const renamed = await renameChat('char-1', 'OldName', 'NewName');
    expect(renamed).toBe(true);

    const list = await getChatList('char-1');
    expect(list[0].file_name).toBe('NewName');
  });

  it('handles storage errors gracefully', async () => {
    // IndexedDB uses structured clone; a function value can't be cloned, so
    // the write rejects. saveChat must swallow it and return false rather
    // than throwing up the stack.
    const unserializable = (() => {}) as unknown as Message;
    const messages: Message[] = [
      { id: '1', role: Role.User, content: 'x', timestamp: 1 },
      unserializable,
    ];

    const saved = await saveChat('char-1', 'BigChat', messages, 'User', 'Char');
    expect(saved).toBe(false);
  });

  it('migrates localStorage chats into IndexedDB and removes the source key', async () => {
    const legacy = {
      'char-1': [
        {
          fileName: 'Legacy Chat',
          characterId: 'char-1',
          characterName: 'Char',
          userName: 'User',
          messages: createMessages(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    await migrateFromLocalStorageIfNeeded();

    const list = await getChatList('char-1');
    expect(list).toHaveLength(1);
    expect(list[0].file_name).toBe('Legacy Chat');

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('migration is idempotent — second run no-ops when IndexedDB has data', async () => {
    // Pre-populate IndexedDB so the idempotency guard trips.
    await saveChat('char-1', 'Existing', createMessages(), 'User', 'Char');

    // Now write a legacy blob. Migration should NOT copy it because
    // IndexedDB already has chats — only the stale key is removed.
    const legacy = {
      'char-2': [
        {
          fileName: 'Should Not Appear',
          characterId: 'char-2',
          characterName: 'Char2',
          userName: 'User',
          messages: createMessages(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    await migrateFromLocalStorageIfNeeded();

    const list = await getChatList('char-2');
    expect(list).toHaveLength(0);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it('survives large chats (writes/reads ~10MB payload)', async () => {
    // Build a payload comfortably past the old localStorage ceiling.
    const big = 'x'.repeat(2 * 1024 * 1024); // 2MB per message
    const messages = createMessages(5).map((m) => ({ ...m, content: big }));

    const saved = await saveChat('char-1', 'BigChat', messages, 'User', 'Char');
    expect(saved).toBe(true);

    const loaded = await loadChat('char-1', 'BigChat');
    expect(loaded.messages).toHaveLength(5);
    expect(loaded.messages[0].content).toHaveLength(2 * 1024 * 1024);
  });
});
