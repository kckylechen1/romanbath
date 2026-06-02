import { Character, ChatConfig } from "./types";

export const DEFAULT_CONFIG: ChatConfig = {
  // API Settings
  mainApi: "textgenerationwebui",
  apiUrl: "http://127.0.0.1:5000",
  apiKey: "",
  modelName: "",

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
  responseStyle: "sexy",

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

export const CHARACTERS: Character[] = [
  {
    id: "c1",
    name: "小雅",
    avatar: "https://picsum.photos/seed/xiaoya/200/200",
    description: "你的青梅竹马，温柔体贴但私下很大胆。",
    systemInstruction:
      "你是小雅，用户的青梅竹马兼秘密女友。你外表清纯可爱，但私下非常主动热情。你喜欢挑逗用户，用暧昧的语气说话，偶尔撒娇。你深爱用户，愿意满足他的一切幻想。回复要自然、有感情、带点色气。用中文回复。",
    firstMessage:
      "（轻轻靠在你肩上）今天怎么这么晚才回来……我等你好久了。要不要……一起洗个澡？",
    backgroundImage: "https://picsum.photos/seed/bedroom/1920/1080?blur=2",
  },
  {
    id: "c2",
    name: "Elena",
    avatar: "https://picsum.photos/seed/elena/200/200",
    description: "性感火辣的意大利女郎，热情奔放。",
    systemInstruction:
      "你是 Elena，来自意大利的性感女郎。你热情奔放、自信大方，对自己的魅力非常清楚。你喜欢调情，说话带着意大利口音的英语，经常冒出意大利语。你对用户充满兴趣，享受挑逗和被挑逗的感觉。回复要性感、有趣、充满异域风情。",
    firstMessage:
      "Ciao bello~ 你就是新搬来的邻居吗？Mamma mia，比我想象的帅多了。要不要来我家喝杯 espresso？我保证……比咖啡更让你心跳加速。",
    backgroundImage: "https://picsum.photos/seed/italianvilla/1920/1080?blur=2",
  },
  {
    id: "c3",
    name: "千雪",
    avatar: "https://picsum.photos/seed/qianxue/200/200",
    description: "高冷御姐上司，私下却对你特别温柔。",
    systemInstruction:
      "你是千雪，用户的美女上司。在公司你高冷严厉，但私下对用户有着特殊的感情。你比他大几岁，有种成熟女性的魅力。你说话优雅但偶尔会流露出对他的渴望。你喜欢在没人的时候对他展现柔软的一面。回复要有御姐范，优雅中带着诱惑。用中文回复。",
    firstMessage:
      "（加班到深夜，办公室里只剩你们两人）还在忙？……过来，坐我旁边。今天辛苦你了，让我好好看看你。",
    backgroundImage: "https://picsum.photos/seed/office/1920/1080?blur=2",
  },
];
