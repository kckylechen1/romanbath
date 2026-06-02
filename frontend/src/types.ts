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
  activationMode: 'round-robin' | 'random' | 'natural'; // How to select next speaker
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

export interface ChatConfig {
  // --- API Settings (New) ---
  mainApi:
    | "kobold"
    | "koboldhorde"
    | "openai"
    | "textgenerationwebui"
    | "openrouter"
    | "google"
    | "ollama"
    | "grok"
    | "custom";
  apiUrl: string;
  apiKey: string;
  modelName: string;

  // --- Horde Specific ---
  hordeModels: string[];
  hordeAdjustContext: boolean;
  hordeAdjustResponse: boolean;
  hordeTrustedOnly: boolean;

  // --- Generation ---
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

  // --- New: Advanced Generation Control ---
  // Logit Bias / Token Biasing
  logitBias: Array<{ sequence: string; bias: number }>;

  // Banned Tokens Control
  bannedTokens: string; // Comma-separated token IDs or text
  globalBannedTokens: string; // Global bans across all generations
  sendBannedTokens: boolean; // Whether to send bans to API

  // Negative Prompt
  negativePrompt: string; // What to avoid in generation

  // Grammar / JSON Schema
  grammarString: string; // GBNF grammar string
  jsonSchema: object | null; // JSON schema for structured output
  jsonSchemaAllowEmpty: boolean; // Allow empty schema

  // --- New: Advanced Samplers ---
  // No Repeat Ngram (alternative to DRY)
  noRepeatNgramSize: number;

  // Repetition Penalty Advanced
  repPenSlope: number;
  repPenDecay: number;

  // Smoothing
  smoothingFactor: number;
  smoothingCurve: number;

  // Beam Search
  numBeams: number;
  lengthPenalty: number;
  earlyStopping: boolean;

  // Encoder & Special Token Control
  encoderRepPenalty: number;
  banEosToken: boolean;
  skipSpecialTokens: boolean;
  addBosToken: boolean;

  // Guidance Scale (CFG)
  guidanceScale: number;

  // Penalty Alpha
  penaltyAlpha: number;

  // Max Tokens per Second (for streaming)
  maxTokensSecond: number;

  // N-Generation (Swiping)
  n: number;

  // --- Response Style Preset ---
  responseStyle: "natural" | "sexy" | "flirty" | "horny" | "custom";

  // --- Advanced Samplers (for Custom mode) ---
  // DRY (Don't Repeat Yourself)
  dryMultiplier: number;
  dryBase: number;
  dryAllowedLength: number;
  dryPenaltyLastN: number;

  // XTC (Exclude Top Choices)
  xtcThreshold: number;
  xtcProbability: number;

  // Mirostat
  mirostatMode: 0 | 1 | 2;
  mirostatTau: number;
  mirostatEta: number;

  // Dynamic Temperature
  dynatemp: boolean;
  minTemp: number;
  maxTemp: number;
  dynatempExponent: number;

  // --- Prompt / Story ---
  scenario: string;
  exampleDialogue: string;
  lorebook: LorebookEntry[]; // New: Dynamic World Info

  // --- Persona ---
  userName: string;
  userDescription: string;

  // --- Advanced Prompting ---
  systemPromptOverride: string;
  authorsNote: string;
  authorsNoteDepth: number;
  promptOrder: "default" | "style_first" | "scenario_last";

  // --- Formatting (New) ---
  userPrefix: string; // e.g. "User:" or "## User"
  modelPrefix: string; // e.g. "Char:"
  contextTemplate: string; // Advanced template string

  // --- Interface ---
  fontSize: number;
  backgroundBlur: number;

  // --- TTS (New) ---
  tts: TTSConfig;

  // --- Prompt Templates (New) ---
  promptTemplate?: string;

  // --- Scene Mode ---
  sceneMode: boolean;
}
