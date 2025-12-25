
export enum Role {
  User = 'user',
  Model = 'model'
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  isThinking?: boolean;
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
  lastUpdated: number;
}

// App settings that persist across sessions
export interface AppSettings {
  autoRestoreChat: boolean;
  showPersonaSwitchNotification: boolean;
  activePersonaId: string | null;
  language: 'en' | 'zh-CN' | 'zh-TW';
}

export interface ChatConfig {
  // --- API Settings (New) ---
  mainApi: 'kobold' | 'koboldhorde' | 'openai' | 'textgenerationwebui' | 'openrouter' | 'google' | 'ollama' | 'custom';
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

  // --- Response Style Preset ---
  responseStyle: 'natural' | 'sexy' | 'flirty' | 'horny' | 'custom';

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
  promptOrder: 'default' | 'style_first' | 'scenario_last';

  // --- Formatting (New) ---
  userPrefix: string; // e.g. "User:" or "## User"
  modelPrefix: string; // e.g. "Char:"
  contextTemplate: string; // Advanced template string

  // --- Interface ---
  fontSize: number;
  backgroundBlur: number;

  // --- Safety ---
  safetySettings: 'block_none' | 'block_some' | 'block_most';
}
