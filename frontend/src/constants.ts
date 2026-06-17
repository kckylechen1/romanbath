import { ChatConfig } from "./types";

export const DEFAULT_CONFIG: ChatConfig = {
  // Generation (gateway-accepted samplers only)
  temperature: 1.0,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 8192,
  stopSequences: [],
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  seed: -1,

  // Response Style
  responseStyle: "natural",

  // Story
  scenario: "",
  exampleDialogue: "",
  lorebook: [],

  // Persona
  userName: "User",
  userDescription: "",

  // Prompt
  systemPromptOverride: "",
  authorsNote: "",
  authorsNoteDepth: 4,
  promptOrder: "default",
  negativePrompt: "",

  // Formatting
  userPrefix: "User:",
  modelPrefix: "Character:",
  contextTemplate: "default",

  // Interface
  fontSize: 15,
  backgroundBlur: 3,

  // TTS
  tts: {
    provider: "browser" as const,
    enabled: false,
    voice: "",
    rate: 1,
    pitch: 1,
    volume: 1,
    autoPlay: false,
  },

  // Prompt Templates
  promptTemplate: undefined,

  // Scene Mode
  sceneMode: false,
};
