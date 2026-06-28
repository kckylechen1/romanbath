export interface AppFeatureFlags {
  imageGeneration: boolean;
  tts: boolean;
  voiceInput: boolean;
  groupChat: boolean;
  studio: boolean;
  affect: boolean;
  bookmarks: boolean;
}

const envFlag = (name: keyof ImportMetaEnv): boolean => import.meta.env[name] === 'true';

export const appFeatures: AppFeatureFlags = {
  imageGeneration: envFlag('VITE_ENABLE_IMAGE_GEN'),
  tts: envFlag('VITE_ENABLE_TTS'),
  voiceInput: envFlag('VITE_ENABLE_VOICE_INPUT'),
  groupChat: envFlag('VITE_ENABLE_GROUP_CHAT'),
  studio: envFlag('VITE_ENABLE_STUDIO'),
  affect: envFlag('VITE_ENABLE_AFFECT'),
  bookmarks: envFlag('VITE_ENABLE_BOOKMARKS'),
};
