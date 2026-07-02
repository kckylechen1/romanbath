/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZEROCLAW_PORT?: string;
  readonly VITE_ENABLE_IMAGE_GEN?: string;
  readonly VITE_ENABLE_TTS?: string;
  readonly VITE_ENABLE_VOICE_INPUT?: string;
  readonly VITE_ENABLE_GROUP_CHAT?: string;
  readonly VITE_ENABLE_STUDIO?: string;
  readonly VITE_ENABLE_AFFECT?: string;
  readonly VITE_ENABLE_BOOKMARKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
