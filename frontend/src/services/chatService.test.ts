import { describe, expect, it, beforeEach } from 'vitest';
import {
  saveChat,
  loadChat,
  deleteChat,
  renameChat,
  getChatList,
} from './chatService';
import { Role, Message } from '../types';

const createMessages = (count = 2): Message[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    role: i % 2 === 0 ? Role.User : Role.Model,
    content: `Message ${i + 1}`,
    timestamp: Date.now() + i,
  }));

describe('chatService', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    };
    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      configurable: true,
    });
    globalThis.localStorage.clear();
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

  it('handles quota exceeded gracefully', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => null,
        setItem: () => {
          const err = new DOMException('Quota exceeded', 'QuotaExceededError');
          throw err;
        },
        removeItem: () => {},
        clear: () => {},
      },
      configurable: true,
    });

    const saved = await saveChat('char-1', 'BigChat', createMessages(100), 'User', 'Char');
    expect(saved).toBe(false);
  });
});
