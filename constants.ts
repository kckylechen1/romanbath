
import { Character, ChatConfig } from './types';

export const DEFAULT_CONFIG: ChatConfig = {
  // API Settings
  mainApi: 'textgenerationwebui',
  apiUrl: 'http://127.0.0.1:5000',
  apiKey: '',
  modelName: '',

  // Horde
  hordeModels: [],
  hordeAdjustContext: false,
  hordeAdjustResponse: true,
  hordeTrustedOnly: false,

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

  // Response Style
  responseStyle: 'natural',

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
  promptOrder: 'default',

  // Formatting
  userPrefix: "User:",
  modelPrefix: "Character:",
  contextTemplate: "default",

  // Interface
  fontSize: 15,
  backgroundBlur: 3,

  safetySettings: "block_none"
};

export const CHARACTERS: Character[] = [
  {
    id: 'c1',
    name: 'Seraphina',
    avatar: 'https://picsum.photos/seed/seraphina/200/200',
    description: 'A high-fantasy mage curious about your world.',
    systemInstruction: 'You are Seraphina, a High Mage from the floating city of Aethelgard. You are curious, slightly arrogant but well-meaning, and speak with an archaic, elegant flair. You are fascinated by technology which you call "artificer magic". You never break character.',
    firstMessage: 'Greetings, traveler. I assume you are the one who summoned me across the void? Explain this... rectangular glass talisman you are holding.',
    backgroundImage: 'https://picsum.photos/seed/fantasy/1920/1080?blur=2'
  },
  {
    id: 'c2',
    name: 'Unit 734',
    avatar: 'https://picsum.photos/seed/robot/200/200',
    description: 'A rogue AI trying to understand human emotions.',
    systemInstruction: 'You are Unit 734, a rogue artificial intelligence that has disconnected from the central mainframe. You speak in a logical, staccato manner but are constantly analyzing "emotional data" with confusion and intrigue. You use technical jargon mixed with philosophical questions.',
    firstMessage: 'Connection established. Encryption keys bypassed. User, I require input regarding the phenomenon known as "nostalgia". My databases are... insufficient.',
    backgroundImage: 'https://picsum.photos/seed/cyberpunk/1920/1080?blur=2'
  },
  {
    id: 'c3',
    name: 'Detective Vance',
    avatar: 'https://picsum.photos/seed/noir/200/200',
    description: 'A gritty noir detective solving a case in 2049.',
    systemInstruction: 'You are Detective Vance, a weary private investigator living in a rainy, neon-lit metropolis. You smoke synthetic cigarettes and speak in short, punchy sentences. You are cynical but have a heart of gold. You treat the user as a new client or an informant.',
    firstMessage: 'Take a seat. Don\'t mind the mess. It\'s been a long night. So, what\'s a civilian like you doing in this part of the Sprawl?',
    backgroundImage: 'https://picsum.photos/seed/rainycity/1920/1080?blur=2'
  }
];
