import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildOptionsBody,
  formToCharacterData,
  mapDetailsToForm,
  parseSseEvents,
  getCharacters,
  getCharacterBook,
  addBookEntry,
  updateBookEntry,
  deleteBookEntry,
  invalidatePairingCache,
  type CharacterFormData,
  type ChatOptions,
} from './zeroclawService';

const baseChatOptions = (): ChatOptions => ({
  temperature: 1,
  maxTokens: 512,
  topP: 0.9,
  topK: 40,
  frequencyPenalty: 0,
  presencePenalty: 0,
  stop: null,
  seed: null,
  userName: 'Alex',
  userDescription: 'A tired investigator.',
  sceneMode: false,
});

const baseCharacterForm = (): CharacterFormData => ({
  name: 'Mara',
  description: '',
  personality: '',
  scenario: '',
  firstMessage: 'Hello.',
  alternateGreetings: [],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  tags: [],
  assets: [],
  creator: '',
  characterVersion: '',
  nickname: '',
  groupOnlyGreetings: [],
  source: [],
  characterBook: null,
  extensions: {},
  avatarFile: null,
});

describe('zeroclawService character card mapping', () => {
  it('normalizes SillyTavern snake_case lorebook fields for the editor', () => {
    const form = mapDetailsToForm({
      name: 'Mara',
      description: '',
      personality: '',
      scenario: '',
      first_mes: 'Hello.',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      creator_notes: '',
      tags: [],
      creator: '',
      character_version: '',
      nickname: '',
      group_only_greetings: [],
      source: [],
      extensions: {},
      character_book: {
        name: 'book',
        description: '',
        entries: [
          {
            keys: ['whiskey'],
            secondary_keys: ['bar'],
            content: 'Mara knows the old bar.',
            enabled: true,
            selective: true,
            constant: false,
            position: 'before_char',
            token_budget: 120,
            priority: 5,
            recursive: true,
          } as never,
        ],
      },
    });

    expect(form.characterBook?.entries[0].secondaryKeys).toEqual(['bar']);
    expect(form.characterBook?.entries[0].tokenBudget).toBe(120);
  });

  it('serializes editor lorebook fields back to the gateway schema', () => {
    const data = formToCharacterData({
      ...baseCharacterForm(),
      characterBook: {
        name: 'book',
        description: '',
        entries: [
          {
            keys: ['whiskey'],
            secondaryKeys: ['bar'],
            content: 'Mara knows the old bar.',
            enabled: true,
            selective: true,
            constant: false,
            position: 'after_char',
            tokenBudget: 80,
            priority: 3,
            recursive: false,
          },
        ],
      },
    });

    expect(data.character_book).toMatchObject({
      entries: [
        {
          secondary_keys: ['bar'],
          token_budget: 80,
          position: 'after_char',
        },
      ],
    });
    expect(JSON.stringify(data)).not.toContain('secondaryKeys');
    expect(JSON.stringify(data)).not.toContain('tokenBudget');
  });
});

describe('zeroclawService chat request mapping', () => {
  it('sends RomanBath prompt controls that affect model context', () => {
    const body = buildOptionsBody({
      ...baseChatOptions(),
      scenario: 'Rainy classroom.',
      exampleDialogue: '{{char}} speaks softly.',
      lorebook: [{ id: '1', keys: ['rain'], content: 'Rain matters.', enabled: true }],
      systemPromptOverride: 'Use close third person.',
      authorsNote: 'Keep tension high.',
      authorsNoteDepth: 2,
      promptOrder: 'style_first',
      userPrefix: 'User:',
      modelPrefix: 'Mara:',
      contextTemplate: 'chatml',
      promptTemplate: 'chatml',
      negativePrompt: 'No summaries.',
    });

    expect(body).toMatchObject({
      scenario: 'Rainy classroom.',
      example_dialogue: '{{char}} speaks softly.',
      lorebook: [{ id: '1', keys: ['rain'], content: 'Rain matters.', enabled: true }],
      system_prompt_override: 'Use close third person.',
      authors_note: 'Keep tension high.',
      authors_note_depth: 2,
      prompt_order: 'style_first',
      user_prefix: 'User:',
      model_prefix: 'Mara:',
      context_template: 'chatml',
      prompt_template: 'chatml',
      negative_prompt: 'No summaries.',
    });
  });
});

describe('parseSseEvents', () => {
  const mockResponse = (chunks: Uint8Array[]): Response => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Response(stream);
  };

  const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

  const collect = async (chunks: Uint8Array[]): Promise<string[]> => {
    const out: string[] = [];
    for await (const evt of parseSseEvents(mockResponse(chunks))) {
      out.push(evt);
    }
    return out;
  };

  it('parses simple newline-separated events', async () => {
    const out = await collect([
      encode('data: hello\n\ndata: world\n\n'),
    ]);
    expect(out).toEqual(['hello', 'world']);
  });

  it('handles CRLF line endings rewritten by proxies', async () => {
    const out = await collect([
      encode('data: hello\r\n\r\ndata: world\r\n\r\n'),
    ]);
    expect(out).toEqual(['hello', 'world']);
  });

  it('handles lone CR line endings (legacy but spec-legal)', async () => {
    const out = await collect([
      encode('data: hello\r\rdata: world\r\r'),
    ]);
    expect(out).toEqual(['hello', 'world']);
  });

  it('concatenates multi-line data: fields with newline per SSE spec', async () => {
    const out = await collect([
      encode('data: line1\ndata: line2\ndata: line3\n\n'),
    ]);
    expect(out).toEqual(['line1\nline2\nline3']);
  });

  it('strips a single leading space after the colon but preserves the rest', async () => {
    const out = await collect([
      encode('data:   padded\n\n'),
    ]);
    expect(out).toEqual(['  padded']); // only one leading space stripped
  });

  it('skips comment lines starting with colon (heartbeat)', async () => {
    const out = await collect([
      encode(': heartbeat comment\ndata: real\n\n'),
    ]);
    expect(out).toEqual(['real']);
  });

  it('ignores event:, id:, retry: fields but still yields empty string for non-data events', async () => {
    const out = await collect([
      encode('event: ping\nid: 42\nretry: 5000\n\ndata: actual\n\n'),
    ]);
    expect(out).toEqual(['', 'actual']);
  });

  it('handles event boundaries split across read() chunks', async () => {
    const out = await collect([
      encode('data: hel'),
      encode('lo\n\nda'),
      encode('ta: world\n\n'),
    ]);
    expect(out).toEqual(['hello', 'world']);
  });

  it('flushes a trailing event without a final blank line', async () => {
    const out = await collect([
      encode('data: trailing'),
    ]);
    expect(out).toEqual(['trailing']);
  });

  it('does not flush a trailing comment-only block', async () => {
    const out = await collect([
      encode(': just a comment'),
    ]);
    expect(out).toEqual([]);
  });
});

// ── Network-level tests for character list + lorebook CRUD ──
//
// These tests mock globalThis.fetch so they exercise the URL building,
// envelope parsing, and per-endpoint verb wiring without needing the
// gateway. ensurePairing() short-circuits via a paired /health response
// so we never hit the pairing-code flow.

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

const noContent = (): Response => new Response(null, { status: 204 });

const pairedHealth = (): Response =>
  json({ paired: true });

// jsdom under vitest doesn't seed localStorage unless --localstorage-file
// is provided; zeroclawService.getToken() reads it on every call. Stub a
// minimal in-memory store per test so the auth header path doesn't crash.
// We pre-seed a fake token so ensurePairing() probes /health (which our
// mocks answer with { paired: true }) instead of trying to negotiate a
// pairing code.
const stubLocalStorage = (): void => {
  const store = new Map<string, string>([['zeroclaw_token', 'test-token']]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    length: 0,
  });
};

describe('getCharacters query + summary mapping', () => {
  beforeEach(() => {
    stubLocalStorage();
    invalidatePairingCache();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds the search/tag/creator/sort query string', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      // /health probe from ensurePairing()
      if (url === '/health') return pairedHealth();
      // The actual list call.
      expect(url).toContain('search=whiskey');
      expect(url).toContain('tag=fantasy');
      expect(url).toContain('creator=Alice');
      expect(url).toContain('sort=recent');
      return json({
        characters: [
          {
            name: 'Mara',
            description: 'd',
            personality: '',
            scenario: '',
            first_mes: '',
            tags: ['fantasy'],
            creator: 'Alice',
            character_version: '1',
            has_avatar: false,
            nickname: 'M',
            has_character_book: true,
            has_assets: false,
            alternate_greeting_count: 2,
            creator_notes_badge: null,
            modification_date: null,
          },
        ],
      });
    });

    const chars = await getCharacters({
      search: 'whiskey',
      tag: 'fantasy',
      creator: 'Alice',
      sort: 'recent',
    });
    expect(chars).toHaveLength(1);
    expect(chars[0].hasCharacterBook).toBe(true);
    expect(chars[0].alternateGreetingCount).toBe(2);
  });

  it('omits the query string entirely when no options are given', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      expect(url).not.toContain('?');
      return json({ characters: [] });
    });
    const chars = await getCharacters();
    expect(chars).toEqual([]);
  });
});

describe('lorebook CRUD', () => {
  beforeEach(() => {
    stubLocalStorage();
    invalidatePairingCache();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('parses the { book } envelope from getCharacterBook', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      expect(url).toBe('/api/characters/Mara/book');
      return json({
        book: {
          name: 'b',
          description: '',
          entries: [
            {
              id: 'entry-1',
              keys: ['rain'],
              content: 'Rain matters.',
              enabled: true,
              selective: false,
              constant: false,
              position: 'before_char',
              recursive: false,
            },
          ],
        },
      });
    });
    const book = await getCharacterBook('Mara');
    expect(book?.entries[0].id).toBe('entry-1');
    expect(book?.entries[0].keys).toEqual(['rain']);
  });

  it('returns null when the book envelope is null', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      return json({ book: null });
    });
    expect(await getCharacterBook('Mara')).toBeNull();
  });

  it('POSTs without id and surfaces the server-assigned id', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      expect(url).toBe('/api/characters/Mara/book/entries');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body ?? '{}'));
      // The outgoing payload must not include an id — server assigns.
      expect(body.entry).not.toHaveProperty('id');
      expect(body.entry.keys).toEqual(['whiskey']);
      return json(
        {
          entry: {
            id: 'server-1',
            keys: ['whiskey'],
            content: 'bar',
            enabled: true,
            selective: false,
            constant: false,
            position: 'before_char',
            recursive: false,
          },
        },
        { status: 201 },
      );
    });
    const saved = await addBookEntry('Mara', {
      keys: ['whiskey'],
      secondaryKeys: [],
      content: 'bar',
      enabled: true,
      selective: false,
      constant: false,
      position: 'before_char',
      recursive: false,
    });
    expect(saved.id).toBe('server-1');
  });

  it('PUTs to the right per-entry URL on update', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      expect(url).toBe('/api/characters/Mara/book/entries/entry-7');
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(String(init?.body ?? '{}'));
      expect(body.entry.id).toBe('entry-7');
      expect(body.entry.content).toBe('updated');
      return json({
        entry: {
          id: 'entry-7',
          keys: ['k'],
          content: 'updated',
          enabled: true,
          selective: false,
          constant: false,
          position: 'before_char',
          recursive: false,
        },
      });
    });
    const next = await updateBookEntry('Mara', 'entry-7', {
      id: 'entry-7',
      keys: ['k'],
      content: 'updated',
      enabled: true,
      selective: false,
      constant: false,
      position: 'before_char',
      recursive: false,
    });
    expect(next.content).toBe('updated');
  });

  it('returns true on 204 from deleteBookEntry', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      expect(url).toBe('/api/characters/Mara/book/entries/entry-9');
      expect(init?.method).toBe('DELETE');
      return noContent();
    });
    expect(await deleteBookEntry('Mara', 'entry-9')).toBe(true);
  });

  it('returns false when delete fails', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/health') return pairedHealth();
      return new Response(null, { status: 500 });
    });
    expect(await deleteBookEntry('Mara', 'entry-9')).toBe(false);
  });
});
