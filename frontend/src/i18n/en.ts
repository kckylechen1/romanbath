const en: Record<string, string> = {
  // App Header
  'app.title': 'Roman Bath',
  'app.activePath': 'Active Path',
  'app.systemNode': 'System Node // Latency: Nominal',
  'app.reset': 'Reset',
  'app.selectPersona': 'Select Persona',

  // Sidebar
  'sidebar.search': 'Search entities...',
  'sidebar.newChat': 'New Chat',
  'sidebar.noCharacters': 'No characters found',

  // Settings Panel - Tabs
  'tab.generation': 'Generation',
  'tab.api': 'API Connection',
  'tab.story': 'Story & Context',
  'tab.persona': 'Persona',
  'tab.interface': 'Interface',

  // Settings - API
  'api.selectProvider': 'Select Provider',
  'api.configure': 'Configure',
  'api.apiKey': 'API Key',
  'api.connect': 'Connect',
  'api.connected': 'Connected',
  'api.connecting': 'Connecting...',
  'api.disconnected': 'Disconnected',
  'api.model': 'Model Selection',
  'api.customUrl': 'Custom API URL',

  // Settings - Response Style (NSFW)
  'style.title': 'Response Style',
  'style.natural': '😊 Natural',
  'style.natural.desc': 'Balanced & Friendly',
  'style.sexy': '😏 Sexy',
  'style.sexy.desc': 'Hot & Atmospheric',
  'style.flirty': '💋 Flirty',
  'style.flirty.desc': 'Playful & Teasing',
  'style.horny': '😈 Horny',
  'style.horny.desc': 'Wild & Unfiltered',
  'style.custom': '⚙️ Custom',
  'style.custom.desc': 'Fine-tune All Settings',

  // Settings - Params
  'param.advanced': 'Advanced Parameters',
  'param.temperature': 'Temperature',
  'param.maxTokens': 'Max Response Tokens',
  'param.thinking': 'Thinking Budget',
  'param.topK': 'Top K (Diversity)',
  'param.topP': 'Top P (Nucleus)',
  'param.presencePenalty': 'Presence Penalty',
  'param.frequencyPenalty': 'Frequency Penalty',
  'param.repetitionPenalty': 'Repetition Penalty',
  'param.minP': 'Min P',
  'param.seed': 'Seed',
  'param.stopSequences': 'Stop Sequences',

  // Advanced Samplers
  'sampler.dry': 'DRY (Anti-Repeat)',
  'sampler.dry.multiplier': 'DRY Multiplier',
  'sampler.dry.base': 'DRY Base',
  'sampler.dry.allowedLength': 'Allowed Length',
  'sampler.dry.penaltyLastN': 'Penalty Range',
  'sampler.dry.desc': 'Prevents repeating long phrases',

  'sampler.xtc': 'XTC (Creativity Boost)',
  'sampler.xtc.threshold': 'XTC Threshold',
  'sampler.xtc.probability': 'XTC Probability',
  'sampler.xtc.desc': 'Excludes obvious choices for creativity',

  'sampler.mirostat': 'Mirostat',
  'sampler.mirostat.mode': 'Mode',
  'sampler.mirostat.tau': 'Target Entropy (Tau)',
  'sampler.mirostat.eta': 'Learning Rate (Eta)',
  'sampler.mirostat.desc': 'Auto-adjusts sampling for consistent quality',

  'sampler.dynatemp': 'Dynamic Temperature',
  'sampler.dynatemp.enabled': 'Enable Dynamic Temp',
  'sampler.dynatemp.min': 'Min Temperature',
  'sampler.dynatemp.max': 'Max Temperature',
  'sampler.dynatemp.exponent': 'Exponent',
  'sampler.dynatemp.desc': 'Adjusts randomness based on context',

  // Advanced Control - New Features
  'advanced.title': 'Advanced Control',
  'advanced.logitBias': 'Logit Bias / Token Biasing',
  'advanced.logitBias.desc': 'Promote or ban specific tokens/words',
  'advanced.bannedTokens': 'Banned Tokens',
  'advanced.sendBannedTokens': 'Send Banned Tokens',
  'advanced.globalBannedTokens': 'Global Banned Tokens',
  'advanced.negativePrompt': 'Negative Prompt',
  'advanced.grammar': 'Grammar / JSON Schema',
  'advanced.enableJsonSchema': 'Enable JSON Schema',
  'advanced.grammarString': 'Grammar String (GBNF)',

  // Settings - Titles
  'settings.sampler': 'Sampler Settings',
  'settings.connection': 'Connection Manager',
  'settings.configuration': 'Configuration',
  'settings.settings': 'Settings',
  'settings.universal': 'Universal',
  'settings.panelTitle.api': 'API Connections',
  'settings.panelTitle.generation': 'Generation Parameters',
  'settings.panelTitle.story': 'World Information',
  'settings.panelTitle.lorebook': 'Lorebook / World Info',
  'settings.panelTitle.character': 'System Prompts',
  'settings.panelTitle.persona': 'User Settings',
  'settings.panelTitle.formatting': 'Prompt Formatting',
  'settings.panelTitle.interface': 'Appearance',

  // Tabs
  'tab.lorebook': 'Lorebook',

  // Message Input
  'input.placeholder': 'Type a message...',
  'input.listening': 'Listening...',

  // Formatting
  'tab.character': 'Character Prompts',
  'tab.formatting': 'Formatting',
  'formatting.title': 'Output Formatting',
  'formatting.userPrefix': 'User Prefix',
  'formatting.modelPrefix': 'Model Prefix',
  'formatting.contextTemplate': 'Context Template Override',
  'formatting.contextTemplateDesc': "Leave as 'default' or enter a custom JSON string.",

  // Common
  'common.save': 'Save Changes',
  'common.saved': 'Saved',
  'common.saving': 'Saving...',

  // Persona Management
  'persona.title': 'Persona Management',
  'persona.saved': 'Saved Personas',
  'persona.current': 'Current Persona',
  'persona.new': 'New Persona',
  'persona.save': 'Save Current',
  'persona.delete': 'Delete',
  'persona.load': 'Load',
  'persona.name': 'Persona Name',
  'persona.noPersonas': 'No saved personas yet',
  'persona.saveSuccess': 'Persona saved successfully',
  'persona.deleteConfirm': 'Are you sure you want to delete this persona?',
  'persona.switchNotify': 'Switched to persona:',

  // Chat Persistence
  'chat.restore': 'Restore Previous Chat',
  'chat.restorePrompt': 'Would you like to continue your previous conversation?',
  'chat.restoreWith': 'Continue chat with',
  'chat.lastActive': 'Last active',
  'chat.startFresh': 'Start Fresh',
  'chat.continue': 'Continue',
  'chat.autoSave': 'Auto-save chats',
  'chat.autoRestore': 'Auto-restore last chat',

  // Error Messages
  'error.generation': 'Generation Failed',
  'error.apiKey': 'API Key Error',
  'error.apiKeyMessage': 'Please check your API key in settings.',
  'error.rateLimit': 'Rate Limited',
  'error.rateLimitMessage': 'Too many requests. Please wait a moment.',
  'error.network': 'Network Error',
  'error.networkMessage': 'Could not connect to the server.',
  'error.timeout': 'Request Timeout',
  'error.timeoutMessage': 'The request took too long. Try again.',
  'error.unknown': 'Unknown Error',

  // Character Import
  'character.contacts': 'Contacts',
  'character.importCard': 'Import Character',
  'character.importing': 'Importing...',
  'character.importSuccess': 'Character imported successfully',
  'character.importFailed': 'Import failed',
};

export default en;
