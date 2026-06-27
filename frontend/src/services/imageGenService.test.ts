import { describe, expect, it } from 'vitest';
import type { Character } from '../types';
import type { CharacterFormData } from './zeroclawService';
import { buildCharacterPhotoPrompt, isPhotoRequest } from './imageGenService';

const character: Character = {
  id: 'Jayne',
  name: 'Jayne',
  avatar: '',
  description: 'East Asian woman with black long hair and a relaxed controlled posture.',
  systemInstruction: '',
  firstMessage: '',
  backgroundImage: '',
};

const details: CharacterFormData = {
  name: 'Jayne',
  description: character.description,
  personality: '',
  scenario: '',
  firstMessage: '',
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
  extensions: {
    image_profile: {
      identity_prompt: 'The character is Jayne: consistent face, dark expressive eyes, full lips.',
      style_prompt: 'cinematic photorealistic style, natural skin texture',
      scene_prefix: 'Keep Jayne physically consistent across scenes.',
      negative_prompt: 'different face identity, extra fingers',
    },
  },
  avatarFile: null,
};

describe('imageGenService photo intent', () => {
  it('detects direct Chinese and English photo requests', () => {
    expect(isPhotoRequest('发张照片看看')).toBe(true);
    expect(isPhotoRequest('send me a selfie')).toBe(true);
    expect(isPhotoRequest('你今天在忙什么')).toBe(false);
  });

  it('builds a character-anchored prompt from image_profile', () => {
    const prompt = buildCharacterPhotoPrompt('发张咖啡馆照片', character, details);

    expect(prompt).toContain('The character is Jayne');
    expect(prompt).toContain('Keep Jayne physically consistent');
    expect(prompt).toContain('cinematic photorealistic');
    expect(prompt).toContain('different face identity');
  });
});
