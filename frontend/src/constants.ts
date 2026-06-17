import { ChatConfig } from "./types";

export const DEFAULT_CONFIG: ChatConfig = {
  // Generation
  temperature: 1.0,
  topK: 40,
  topP: 0.95,
  maxOutputTokens: 8192,
  thinkingBudget: 4096,
  stopSequences: [],
  presencePenalty: 0.0,
  frequencyPenalty: 0.0,
  repetitionPenalty: 1.1,
  minP: 0.02,
  topA: 0.0,
  typicalP: 1.0,
  tfs: 1.0,
  repPenRange: 2048,
  seed: -1,

  // New: Advanced Generation Control
  logitBias: [],
  bannedTokens: "",
  globalBannedTokens: "",
  sendBannedTokens: true,
  negativePrompt: "",
  grammarString: "",
  jsonSchema: null,
  jsonSchemaAllowEmpty: false,

  // New: Advanced Samplers
  noRepeatNgramSize: 0,
  repPenSlope: 1,
  repPenDecay: 0,
  smoothingFactor: 0.0,
  smoothingCurve: 1.0,
  numBeams: 1,
  lengthPenalty: 1,
  earlyStopping: false,
  encoderRepPenalty: 1,
  banEosToken: false,
  skipSpecialTokens: true,
  addBosToken: true,
  guidanceScale: 1,
  penaltyAlpha: 0,
  maxTokensSecond: 0,
  n: 1,

  // Response Style
  responseStyle: "natural",

  // Advanced Samplers - DRY
  dryMultiplier: 0.0,
  dryBase: 1.75,
  dryAllowedLength: 2,
  dryPenaltyLastN: 0,

  // Advanced Samplers - XTC
  xtcThreshold: 0.1,
  xtcProbability: 0.0,

  // Advanced Samplers - Mirostat
  mirostatMode: 0,
  mirostatTau: 5.0,
  mirostatEta: 0.1,

  // Advanced Samplers - Dynamic Temperature
  dynatemp: false,
  minTemp: 0.5,
  maxTemp: 1.5,
  dynatempExponent: 1.0,

  // Story
  scenario: "",
  exampleDialogue: "",
  lorebook: [], // Start empty

  // Persona
  userName: "User",
  userDescription: "",

  // Advanced
  systemPromptOverride: "",
  authorsNote: "",
  authorsNoteDepth: 4,
  promptOrder: "default",

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
