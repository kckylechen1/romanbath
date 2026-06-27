import { generateImage as zcGenerateImage } from './zeroclawService';
import type { Character } from '../types';
import type { CharacterFormData } from './zeroclawService';

export interface ImageGenRequest {
  prompt: string;
  resolution?: '1k' | '2k';
}

export interface ImageGenResponse {
  success: boolean;
  image_data_url?: string;
  error?: string;
}

export const extractImagePrompt = (text: string): string | null => {
  const match = text.match(/\[图片提示词\]\s*\n([\s\S]*?)(?=\n\n\[|\n\[|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
};

export const isPhotoRequest = (text: string): boolean => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const verbs = /(?:发|傳|传|来|给|給|拍|看|send|show|take|share)/i;
  const nouns = /(?:照片|相片|自拍|图|圖|photo|pic|picture|selfie)/i;
  return (
    new RegExp(`${verbs.source}.{0,12}${nouns.source}`, 'i').test(normalized) ||
    new RegExp(`${nouns.source}.{0,12}(?:发|傳|传|来|给|給|看看|see|show|send)`, 'i').test(
      normalized
    )
  );
};

const getImageProfile = (details?: CharacterFormData | null): Record<string, unknown> | null => {
  const extensions = details?.extensions;
  if (!extensions || typeof extensions !== 'object') return null;
  const profile = extensions.image_profile ?? extensions.imageProfile;
  return profile && typeof profile === 'object' && !Array.isArray(profile)
    ? (profile as Record<string, unknown>)
    : null;
};

const stringField = (
  object: Record<string, unknown> | null,
  snakeName: string,
  camelName?: string
): string | null => {
  if (!object) return null;
  const value = object[snakeName] ?? (camelName ? object[camelName] : undefined);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

export const buildCharacterPhotoPrompt = (
  requestText: string,
  character: Character,
  details?: CharacterFormData | null
): string => {
  const profile = getImageProfile(details);
  const identity = stringField(profile, 'identity_prompt', 'identityPrompt');
  const style = stringField(profile, 'style_prompt', 'stylePrompt');
  const scenePrefix = stringField(profile, 'scene_prefix', 'scenePrefix');
  const negative = stringField(profile, 'negative_prompt', 'negativePrompt');

  const baseIdentity =
    identity ||
    [`The character is ${character.name}.`, character.description].filter(Boolean).join(' ');

  const scene = requestText
    .replace(/(?:发|傳|传|来|给|給|拍|看|send|show|take|share)/gi, ' ')
    .replace(/(?:照片|相片|自拍|图|圖|photo|pic|picture|selfie|看看|see)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = [
    baseIdentity,
    scenePrefix,
    scene
      ? `Scene request: ${scene}`
      : 'Scene request: casual in-character photo for the current conversation.',
    style ||
      'cinematic photorealistic style, natural skin texture, realistic anatomy, coherent lighting, consistent face identity',
    'Keep the same face geometry, body proportions, hairstyle, and identity across all images in this chat; only change pose, wardrobe, lighting, and location when requested.',
    negative
      ? `Avoid: ${negative}`
      : 'Avoid: cartoon, anime, low detail, disfigured face, extra fingers, blurry, different face identity',
  ];

  return parts.filter(Boolean).join(', ');
};

export const generateImage = async (request: ImageGenRequest): Promise<ImageGenResponse> => {
  try {
    const result = await zcGenerateImage(request.prompt, request.resolution);
    if (result.url) {
      return { success: true, image_data_url: result.url };
    }
    return { success: false, error: 'No image URL returned' };
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e.message : 'Image generation failed' };
  }
};
