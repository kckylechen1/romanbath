import { describe, expect, it } from 'vitest';
import {
  buildOptionsBody,
  formToCharacterData,
  mapDetailsToForm,
  parseSseEvents,
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
