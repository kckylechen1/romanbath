export enum Role {
  User = "user",
  Model = "model",
}

export interface ToolCallInfo {
  toolName: string;
  status: "running" | "done" | "error";
  output?: string;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video";
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  isThinking?: boolean;

  // Swipe support (alternative AI responses)
  swipes?: string[]; // Array of alternative responses
  swipeId?: number; // Currently selected swipe index (0-based)
  swipeTimestamps?: number[]; // Timestamp for each swipe

  // Tool call info (for WS chat with image gen / TTS)
  toolCalls?: ToolCallInfo[];

  // Generation metadata
  extra?: {
    api?: string; // Which API generated this
    model?: string; // Model used
    generationId?: string; // Unique generation ID
    characterId?: string; // Character ID (for group chats)
    characterName?: string; // Character name (for group chats)
  };
}

export interface Character {
  id: string;
  name: string;
  avatar: string;
  description: string;
  systemInstruction: string;
  firstMessage: string;
  exampleDialogue?: string;
  backgroundImage: string;
}

export interface LorebookEntry {
  id: string;
  keys: string[]; // Keywords that trigger this entry
  content: string; // The context to inject
  enabled: boolean;
}

// Group Chat - Multiple characters in one conversation
export interface GroupChat {
  id: string;
  name: string;
  characterIds: string[]; // IDs of characters in the group
  activationMode: "round-robin" | "random" | "natural"; // How to select next speaker
  createdAt: number;
  updatedAt: number;
  lastActiveCharacterId?: string; // Track who spoke last
}

// Extended Message type for group chats
export interface GroupMessage extends Message {
  characterId?: string; // Which character sent this message (for group chats)
  characterName?: string; // Character name for display
}

export interface TTSConfig {
  provider: "browser" | "grok";
  enabled: boolean;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  autoPlay: boolean;
}

export interface PromptTemplate {
  id: string;
  name: string;
  systemPrefix: string;
  systemSuffix: string;
  userPrefix: string;
  userSuffix: string;
  assistantPrefix: string;
  assistantSuffix: string;
  stopSequences: string[];
}

// Persona - User profiles that can be saved and switched
export interface Persona {
  id: string;
  name: string;
  description: string;
  avatar?: string; // Optional avatar URL
  createdAt: number;
  updatedAt: number;
}

// Chat persistence state for auto-restore
export interface ChatPersistenceState {
  characterId: string;
  messages: Message[];
  chatFileName?: string;
  lastUpdated: number;
}

// App settings that persist across sessions
export interface AppSettings {
  autoRestoreChat: boolean;
  showPersonaSwitchNotification: boolean;
  activePersonaId: string | null;
  language: "en" | "zh-CN" | "zh-TW";
}

// ── ChatConfig sub-types ──

export type MainApi =
  | "kobold"
  | "koboldhorde"
  | "openai"
  | "textgenerationwebui"
  | "openrouter"
  | "google"
  | "ollama"
  | "grok"
  | "custom";

export interface ApiConfig {
  mainApi: MainApi;
  apiUrl: string;
  apiKey: string;
  modelName: string;
}

export interface HordeConfig {
  hordeModels: string[];
  hordeAdjustContext: boolean;
  hordeAdjustResponse: boolean;
  hordeTrustedOnly: boolean;
}

export interface GenerationConfig {
  temperature: number;
  topK: number;
  topP: number;
  maxOutputTokens: number;
  thinkingBudget: number;
  stopSequences: string[];
  presencePenalty: number;
  frequencyPenalty: number;
  repetitionPenalty: number;
  minP: number;
  topA: number;
  typicalP: number;
  tfs: number;
  repPenRange: number;
  seed: number;
}

export interface AdvancedGenerationConfig {
  logitBias: Array<{ sequence: string; bias: number }>;
  bannedTokens: string;
  globalBannedTokens: string;
  sendBannedTokens: boolean;
  negativePrompt: string;
  grammarString: string;
  jsonSchema: object | null;
  jsonSchemaAllowEmpty: boolean;
  noRepeatNgramSize: number;
  repPenSlope: number;
  repPenDecay: number;
  smoothingFactor: number;
  smoothingCurve: number;
  numBeams: number;
  lengthPenalty: number;
  earlyStopping: boolean;
  encoderRepPenalty: number;
  banEosToken: boolean;
  skipSpecialTokens: boolean;
  addBosToken: boolean;
  guidanceScale: number;
  penaltyAlpha: number;
  maxTokensSecond: number;
  n: number;
}

export interface SamplerConfig {
  dryMultiplier: number;
  dryBase: number;
  dryAllowedLength: number;
  dryPenaltyLastN: number;
  xtcThreshold: number;
  xtcProbability: number;
  mirostatMode: 0 | 1 | 2;
  mirostatTau: number;
  mirostatEta: number;
  dynatemp: boolean;
  minTemp: number;
  maxTemp: number;
  dynatempExponent: number;
}

export interface PromptConfig {
  scenario: string;
  exampleDialogue: string;
  lorebook: LorebookEntry[];
  userName: string;
  userDescription: string;
  systemPromptOverride: string;
  authorsNote: string;
  authorsNoteDepth: number;
  promptOrder: "default" | "style_first" | "scenario_last";
}

export interface FormattingConfig {
  userPrefix: string;
  modelPrefix: string;
  contextTemplate: string;
}

export interface InterfaceConfig {
  fontSize: number;
  backgroundBlur: number;
}

export interface ChatConfig
  extends ApiConfig,
    HordeConfig,
    GenerationConfig,
    AdvancedGenerationConfig,
    SamplerConfig,
    PromptConfig,
    FormattingConfig,
    InterfaceConfig {
  responseStyle: "natural" | "sexy" | "flirty" | "horny" | "custom";
  tts: TTSConfig;
  promptTemplate?: string;
  sceneMode: boolean;
}
