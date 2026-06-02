import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MessageCircle, User, ChevronDown, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { t } from '@/lib/i18n';
import { getToken } from '@/lib/auth';
import { apiOrigin, basePath } from '@/lib/basePath';

// ── Types ──

interface CharacterSummary {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  tags: string[];
  creator: string;
  character_version: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
}

// ── Helpers ──

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Fetch character list from the gateway. */
async function fetchCharacters(): Promise<CharacterSummary[]> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${apiOrigin}${basePath}/api/characters`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch characters: ${res.status}`);
  const data = await res.json();
  return data.characters ?? [];
}

/** Send a chat message with SSE streaming. Returns the full text. */
async function sendChatStream(
  messages: { role: string; content: string }[],
  characterName: string | null,
  onToken: (token: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${apiOrigin}${basePath}/api/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      messages,
      character_name: characterName,
      mode: 'play',
      stream: true,
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? res.statusText);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return fullText;

        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.token) {
            fullText += parsed.token;
            onToken(fullText);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected token') throw e;
        }
      }
    }
  }

  return fullText;
}

// ── Component ──

export default function CharacterChat() {
  const [characters, setCharacters] = useState<CharacterSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [charsLoading, setCharsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCharPicker, setShowCharPicker] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const charPickerRef = useRef<HTMLDivElement>(null);

  const selectedChar = characters.find((c) => c.name === selected);

  // Fetch characters on mount
  useEffect(() => {
    let cancelled = false;
    fetchCharacters()
      .then((chars) => {
        if (!cancelled) {
          setCharacters(chars);
          // Auto-select first character
          if (chars.length > 0 && !selected) {
            setSelected(chars[0]?.name ?? null);
          }
        }
      })
      .catch(() => {
        // Characters may not be available (no cards imported yet)
      })
      .finally(() => {
        if (!cancelled) setCharsLoading(false);
      });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close char picker when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (charPickerRef.current && !charPickerRef.current.contains(e.target as Node)) {
        setShowCharPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Send greeting when character is selected and no messages yet
  useEffect(() => {
    if (selectedChar && messages.length === 0 && selectedChar.first_mes) {
      setMessages([{
        id: uid(),
        role: 'assistant',
        content: selectedChar.first_mes,
      }]);
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setError(null);
    setInput('');

    const userMsg: ChatMsg = { id: uid(), role: 'user', content: text };
    const assistantMsg: ChatMsg = { id: uid(), role: 'assistant', content: '', streaming: true };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setLoading(true);

    // Build history for API (exclude streaming placeholder)
    const history = newMessages
      .filter((m) => !m.streaming)
      .map((m) => ({ role: m.role, content: m.content }));

    const assistantId = assistantMsg.id;

    try {
      abortRef.current = new AbortController();

      const fullText = await sendChatStream(
        history,
        selected,
        (partial) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: partial } : m,
            ),
          );
        },
        abortRef.current.signal,
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: fullText, streaming: false } : m,
        ),
      );
    } catch (e) {
      // Remove the empty streaming message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  }, [input, loading, messages, selected]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Render ──

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* ── Character selector header ── */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" style={{ color: 'var(--pc-accent)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--pc-text-primary)' }}>
            {t('nav.chat')}
          </span>
        </div>

        {/* Character picker */}
        <div className="relative" ref={charPickerRef}>
          <button
            type="button"
            onClick={() => setShowCharPicker(!showCharPicker)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: 'var(--pc-bg-elevated)',
              color: 'var(--pc-text-secondary)',
              border: '1px solid var(--pc-border)',
            }}
          >
            {charsLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : selectedChar ? (
              <>
                <span className="font-medium" style={{ color: 'var(--pc-text-primary)' }}>
                  {selectedChar.name}
                </span>
              </>
            ) : (
              <span>{characters.length === 0 ? 'No characters' : 'Select character'}</span>
            )}
            <ChevronDown
              className="h-3.5 w-3.5"
              style={{ transform: showCharPicker ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }}
            />
          </button>

          {showCharPicker && (
            <div
              className="absolute right-0 top-full mt-1 rounded-xl border overflow-hidden shadow-lg z-50"
              style={{
                background: 'var(--pc-bg-elevated)',
                borderColor: 'var(--pc-border)',
                minWidth: '200px',
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              {characters.length === 0 ? (
                <div className="px-3 py-3 text-xs" style={{ color: 'var(--pc-text-muted)' }}>
                  No character cards imported yet. Add cards to ~/.zeroclaw/characters/
                </div>
              ) : (
                characters.map((char) => (
                  <button
                    key={char.name}
                    type="button"
                    onClick={() => {
                      setSelected(char.name);
                      setMessages([]);
                      setShowCharPicker(false);
                    }}
                    className="w-full px-3 py-2.5 text-left text-sm flex items-center gap-2.5 transition-colors"
                    style={{
                      color: char.name === selected ? 'var(--pc-accent)' : 'var(--pc-text-secondary)',
                      background: char.name === selected ? 'var(--pc-accent-glow)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (char.name !== selected) {
                        e.currentTarget.style.background = 'var(--pc-hover)';
                        e.currentTarget.style.color = 'var(--pc-text-primary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (char.name !== selected) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.color = 'var(--pc-text-secondary)';
                      }
                    }}
                  >
                    <span className="font-medium">{char.name}</span>
                    {char.tags.length > 0 && (
                      <span className="text-xs opacity-50">({char.tags.slice(0, 2).join(', ')})</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Messages area ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ minHeight: 0 }}>
        {messages.length === 0 && !charsLoading && (
          <div className="flex flex-col items-center justify-center h-full gap-4 opacity-60">
            <MessageCircle className="h-12 w-12" style={{ color: 'var(--pc-accent)' }} />
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--pc-text-primary)' }}>
                {selectedChar ? `Chat with ${selectedChar.name}` : 'Select a character to start chatting'}
              </p>
              {selectedChar?.description && (
                <p className="text-xs mt-1 max-w-md" style={{ color: 'var(--pc-text-muted)' }}>
                  {selectedChar.description.slice(0, 200)}
                </p>
              )}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}
          >
            <div
              className="flex items-start gap-2.5 max-w-[75%]"
              style={{ flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}
            >
              {/* Avatar */}
              <div
                className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: msg.role === 'user' ? 'var(--pc-accent)' : 'var(--pc-bg-elevated)',
                  color: msg.role === 'user' ? 'white' : 'var(--pc-accent)',
                  border: msg.role === 'assistant' ? '1px solid var(--pc-border)' : 'none',
                }}
              >
                {msg.role === 'user' ? <User className="h-4 w-4" /> : (selectedChar?.name?.[0] ?? '?')}
              </div>

              {/* Bubble */}
              <div
                className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
                style={{
                  background: msg.role === 'user'
                    ? 'var(--pc-accent)'
                    : 'var(--pc-bg-elevated)',
                  color: msg.role === 'user' ? 'white' : 'var(--pc-text-primary)',
                  border: msg.role === 'assistant' ? '1px solid var(--pc-border)' : 'none',
                }}
              >
                {msg.role === 'assistant' ? (
                  <div className="chat-markdown">
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    ) : msg.streaming ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="bounce-dot h-1.5 w-1.5 rounded-full" style={{ background: 'var(--pc-accent)' }} />
                        <span className="bounce-dot h-1.5 w-1.5 rounded-full" style={{ background: 'var(--pc-accent)' }} />
                        <span className="bounce-dot h-1.5 w-1.5 rounded-full" style={{ background: 'var(--pc-accent)' }} />
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                )}
              </div>
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Error bar */}
      {error && (
        <div
          className="mx-4 mb-2 px-3 py-2 rounded-lg text-xs animate-fade-in"
          style={{ background: 'var(--color-status-error-alpha-08)', color: 'var(--color-status-error)' }}
        >
          {error}
        </div>
      )}

      {/* ── Input area ── */}
      <div
        className="px-4 py-3 border-t shrink-0"
        style={{ borderColor: 'var(--pc-border)', background: 'var(--pc-bg-surface)' }}
      >
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{
            background: 'var(--pc-bg-input)',
            border: '1px solid var(--pc-border)',
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={selected ? `Message ${selected}...` : 'Select a character to chat...'}
            disabled={!selected || loading}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm"
            style={{
              color: 'var(--pc-text-primary)',
              maxHeight: '120px',
              minHeight: '24px',
            }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || loading || !selected}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors"
            style={{
              background: input.trim() && !loading ? 'var(--pc-accent)' : 'var(--pc-bg-elevated)',
              color: input.trim() && !loading ? 'white' : 'var(--pc-text-muted)',
              border: 'none',
              cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
            }}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
