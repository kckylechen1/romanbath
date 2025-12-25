/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_PERPLEXITY_API_KEY: string;
    readonly VITE_OPENAI_API_KEY: string;
    readonly VITE_OPENROUTER_API_KEY: string;
    readonly VITE_GOOGLE_API_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
