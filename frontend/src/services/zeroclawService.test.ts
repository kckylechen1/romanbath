import { describe, expect, it } from 'vitest';
import {
  buildOptionsBody,
  formToCharacterData,
  mapDetailsToForm,
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
