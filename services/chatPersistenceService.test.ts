import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadChatState, saveChatState, clearChatState, debouncedSaveChatState } from './chatPersistenceService';
import { Role, Message } from '../types';

const createMessages = (): Message[] => ([
  {
    id: '1',
    role: Role.User,
    content: 'Hello',
    timestamp: 1,
  },
  {
    id: '2',
    role: Role.Model,
    content: 'Hi there',
    timestamp: 2,
  },
]);

describe('chatPersistenceService', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const mockLocalStorage = {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    };

    Object.defineProperty(globalThis, 'localStorage', {
      value: mockLocalStorage,
      configurable: true,
    });

    globalThis.localStorage.clear();
  });

  it('saves and loads chat state with a chat filename', () => {
    const messages = createMessages();
    saveChatState('char-1', messages, 'Chat File');

    const loaded = loadChatState();
    expect(loaded?.characterId).toBe('char-1');
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.chatFileName).toBe('Chat File');
  });

  it('clears chat state', () => {
    saveChatState('char-1', createMessages(), 'Chat File');
    clearChatState();
    expect(loadChatState()).toBeNull();
  });

  it('debounces chat state saves', () => {
    vi.useFakeTimers();
    debouncedSaveChatState('char-1', createMessages(), 'Debounced Chat', 200);
    expect(loadChatState()).toBeNull();

    vi.advanceTimersByTime(200);
    const loaded = loadChatState();
    expect(loaded?.chatFileName).toBe('Debounced Chat');
    vi.useRealTimers();
  });
});
