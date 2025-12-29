
import React, { createContext, useContext, useState, ReactNode } from 'react';

export type Language = 'en' | 'zh-CN' | 'zh-TW';

export const translations: Record<Language, Record<string, string>> = {
    'en': {
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
    },
    'zh-CN': {
        // App Header
        'app.title': '罗马大浴场',
        'app.activePath': '当前路径',
        'app.systemNode': '系统节点 // 延迟: 正常',
        'app.reset': '重置',
        'app.selectPersona': '选择角色',

        // Sidebar
        'sidebar.search': '搜索实体...',
        'sidebar.newChat': '新对话',
        'sidebar.noCharacters': '未找到角色',

        // Settings Panel - Tabs
        'tab.generation': '生成设置',
        'tab.api': 'API 连接',
        'tab.story': '剧情与上下文',
        'tab.persona': '用户人设',
        'tab.interface': '界面设置',

        // Settings - API
        'api.selectProvider': '选择提供商',
        'api.configure': '配置',
        'api.apiKey': 'API 密钥',
        'api.connect': '连接',
        'api.connected': '已连接',
        'api.connecting': '连接中...',
        'api.disconnected': '未连接',
        'api.model': '模型选择',
        'api.customUrl': '自定义 API URL',

        // Settings - Response Style (NSFW)
        'style.title': '回复风格',
        'style.natural': '😊 自然 (Natural)',
        'style.natural.desc': '平衡 & 友好',
        'style.sexy': '😏 性感 (Sexy)',
        'style.sexy.desc': '火热 & 氛围感',
        'style.flirty': '💋 挑逗 (Flirty)',
        'style.flirty.desc': '调情 & 诱惑',
        'style.horny': '😈 狂野 (Horny)',
        'style.horny.desc': '无拘无束 & 直球',
        'style.custom': '⚙️ 自定义 (Custom)',
        'style.custom.desc': '精细调整所有参数',

        // Settings - Params
        'param.advanced': '高级参数',
        'param.temperature': '随机性 (Temperature)',
        'param.maxTokens': '最大回复长度',
        'param.thinking': '思考预算 (Chain of Thought)',
        'param.topK': 'Top K (多样性)',
        'param.topP': 'Top P (核采样)',
        'param.presencePenalty': '话题新颖度 (Presence)',
        'param.frequencyPenalty': '重复惩罚 (Frequency)',
        'param.repetitionPenalty': '复读惩罚 (Repetition)',
        'param.minP': '最小概率 (Min P)',
        'param.seed': '随机种子 (Seed)',
        'param.stopSequences': '停止序列 (Stop Sequences)',

        // Advanced Samplers
        'sampler.dry': 'DRY (防复读)',
        'sampler.dry.multiplier': 'DRY 强度',
        'sampler.dry.base': 'DRY 基数',
        'sampler.dry.allowedLength': '允许重复长度',
        'sampler.dry.penaltyLastN': '检测范围',
        'sampler.dry.desc': '防止重复长段落',

        'sampler.xtc': 'XTC (创意增强)',
        'sampler.xtc.threshold': 'XTC 阈值',
        'sampler.xtc.probability': 'XTC 概率',
        'sampler.xtc.desc': '踢掉最明显的选项以增加创意',

        'sampler.mirostat': 'Mirostat 自适应采样',
        'sampler.mirostat.mode': '模式',
        'sampler.mirostat.tau': '目标熵 (Tau)',
        'sampler.mirostat.eta': '学习率 (Eta)',
        'sampler.mirostat.desc': '自动调整采样保持质量稳定',

        'sampler.dynatemp': '动态温度',
        'sampler.dynatemp.enabled': '启用动态温度',
        'sampler.dynatemp.min': '最低温度',
        'sampler.dynatemp.max': '最高温度',
        'sampler.dynatemp.exponent': '指数',
        'sampler.dynatemp.desc': '根据上下文自动调整随机性',

        // Settings - Titles
        'settings.sampler': '采样设置',
        'settings.connection': '连接管理器',
        'settings.configuration': '配置',
        'settings.settings': '设置',
        'settings.universal': '通用',
        'settings.panelTitle.api': 'API 连接',
        'settings.panelTitle.generation': '生成参数',
        'settings.panelTitle.story': '世界信息',
        'settings.panelTitle.lorebook': '知识库 / 世界信息',
        'settings.panelTitle.character': '系统提示词',
        'settings.panelTitle.persona': '用户设置',
        'settings.panelTitle.formatting': '提示词格式',
        'settings.panelTitle.interface': '外观设置',

        // Tabs
        'tab.lorebook': '知识库',

        // Message Input
        'input.placeholder': '输入消息...',
        'input.listening': '正在聆听...',

        // Formatting
        'tab.character': '角色提示词',
        'tab.formatting': '格式设置',
        'formatting.title': '输出格式',
        'formatting.userPrefix': '用户前缀',
        'formatting.modelPrefix': '模型前缀',
        'formatting.contextTemplate': '上下文模板覆盖',
        'formatting.contextTemplateDesc': "保持 'default' 或输入自定义 JSON 字符串。",

        // Common
        'common.save': '保存更改',
        'common.saved': '已保存',
        'common.saving': '保存中...',

        // Persona Management
        'persona.title': '人设管理',
        'persona.saved': '已保存的人设',
        'persona.current': '当前人设',
        'persona.new': '新建人设',
        'persona.save': '保存当前人设',
        'persona.delete': '删除',
        'persona.load': '加载',
        'persona.name': '人设名称',
        'persona.noPersonas': '暂无保存的人设',
        'persona.saveSuccess': '人设保存成功',
        'persona.deleteConfirm': '确定要删除这个人设吗？',
        'persona.switchNotify': '已切换到人设：',

        // Chat Persistence
        'chat.restore': '恢复上次聊天',
        'chat.restorePrompt': '是否继续上次的对话？',
        'chat.restoreWith': '继续与',
        'chat.lastActive': '上次活跃于',
        'chat.startFresh': '开始新对话',
        'chat.continue': '继续对话',
        'chat.autoSave': '自动保存聊天',
        'chat.autoRestore': '自动恢复上次聊天',

        // Error Messages
        'error.generation': '生成失败',
        'error.apiKey': 'API 密钥错误',
        'error.apiKeyMessage': '请检查设置中的 API 密钥。',
        'error.rateLimit': '请求过于频繁',
        'error.rateLimitMessage': '请求太多了，请稍等片刻。',
        'error.network': '网络错误',
        'error.networkMessage': '无法连接到服务器。',
        'error.timeout': '请求超时',
        'error.timeoutMessage': '请求时间过长，请重试。',
        'error.unknown': '未知错误',

        // Character Import
        'character.contacts': '联系人',
        'character.importCard': '导入角色卡',
        'character.importing': '导入中...',
        'character.importSuccess': '角色导入成功',
        'character.importFailed': '导入失败',
    },
    'zh-TW': {
        // App Header
        'app.title': '羅馬大浴場',
        'app.activePath': '當前路徑',
        'app.systemNode': '系統節點 // 延遲: 正常',
        'app.reset': '重置',
        'app.selectPersona': '選擇角色',

        // Sidebar
        'sidebar.search': '搜尋實體...',
        'sidebar.newChat': '新對話',
        'sidebar.noCharacters': '未找到角色',

        // Settings Panel - Tabs
        'tab.generation': '生成設定',
        'tab.api': 'API 連線',
        'tab.story': '劇情與上下文',
        'tab.persona': '用戶人設',
        'tab.interface': '介面設定',

        // Settings - API
        'api.selectProvider': '選擇提供商',
        'api.configure': '配置',
        'api.apiKey': 'API 金鑰',
        'api.connect': '連線',
        'api.connected': '已連線',
        'api.connecting': '連線中...',
        'api.disconnected': '未連線',
        'api.model': '模型選擇',
        'api.customUrl': '自訂 API URL',

        // Settings - Response Style (NSFW)
        'style.title': '回覆風格',
        'style.natural': '😊 自然 (Natural)',
        'style.natural.desc': '平衡 & 友好',
        'style.sexy': '😏 性感 (Sexy)',
        'style.sexy.desc': '火熱 & 氛圍感',
        'style.flirty': '💋 挑逗 (Flirty)',
        'style.flirty.desc': '調情 & 誘惑',
        'style.horny': '😈 狂野 (Horny)',
        'style.horny.desc': '無拘無束 & 直球',
        'style.custom': '⚙️ 自訂 (Custom)',
        'style.custom.desc': '精細調整所有參數',

        // Settings - Params
        'param.advanced': '進階參數',
        'param.temperature': '隨機性 (Temperature)',
        'param.maxTokens': '最大回覆長度',
        'param.thinking': '思考預算 (Chain of Thought)',
        'param.topK': 'Top K (多樣性)',
        'param.topP': 'Top P (核採樣)',
        'param.presencePenalty': '話題新穎度 (Presence)',
        'param.frequencyPenalty': '重複懲罰 (Frequency)',
        'param.repetitionPenalty': '覆讀懲罰 (Repetition)',
        'param.minP': '最小概率 (Min P)',
        'param.seed': '隨機數種子 (Seed)',
        'param.stopSequences': '停止序列 (Stop Sequences)',

        // Advanced Samplers
        'sampler.dry': 'DRY (防覆讀)',
        'sampler.dry.multiplier': 'DRY 強度',
        'sampler.dry.base': 'DRY 基數',
        'sampler.dry.allowedLength': '允許重複長度',
        'sampler.dry.penaltyLastN': '檢測範圍',
        'sampler.dry.desc': '防止重複長段落',

        'sampler.xtc': 'XTC (創意增強)',
        'sampler.xtc.threshold': 'XTC 閾值',
        'sampler.xtc.probability': 'XTC 概率',
        'sampler.xtc.desc': '踢掉最明顯的選項以增加創意',

        'sampler.mirostat': 'Mirostat 自適應採樣',
        'sampler.mirostat.mode': '模式',
        'sampler.mirostat.tau': '目標熵 (Tau)',
        'sampler.mirostat.eta': '學習率 (Eta)',
        'sampler.mirostat.desc': '自動調整採樣保持品質穩定',

        'sampler.dynatemp': '動態溫度',
        'sampler.dynatemp.enabled': '啟用動態溫度',
        'sampler.dynatemp.min': '最低溫度',
        'sampler.dynatemp.max': '最高溫度',
        'sampler.dynatemp.exponent': '指數',
        'sampler.dynatemp.desc': '根據上下文自動調整隨機性',

        // Settings - Titles
        'settings.sampler': '採樣設定',
        'settings.connection': '連線管理器',
        'settings.configuration': '配置',
        'settings.settings': '設定',
        'settings.universal': '通用',
        'settings.panelTitle.api': 'API 連線',
        'settings.panelTitle.generation': '生成參數',
        'settings.panelTitle.story': '世界資訊',
        'settings.panelTitle.lorebook': '知識庫 / 世界資訊',
        'settings.panelTitle.character': '系統提示詞',
        'settings.panelTitle.persona': '用戶設定',
        'settings.panelTitle.formatting': '提示詞格式',
        'settings.panelTitle.interface': '外觀設定',

        // Tabs
        'tab.lorebook': '知識庫',

        // Message Input
        'input.placeholder': '輸入訊息...',
        'input.listening': '正在聆聽...',

        // Formatting
        'tab.character': '角色提示詞',
        'tab.formatting': '格式設定',
        'formatting.title': '輸出格式',
        'formatting.userPrefix': '用戶前綴',
        'formatting.modelPrefix': '模型前綴',
        'formatting.contextTemplate': '上下文模板覆蓋',
        'formatting.contextTemplateDesc': "保持 'default' 或輸入自訂 JSON 字串。",

        // Common
        'common.save': '儲存變更',
        'common.saved': '已儲存',
        'common.saving': '儲存中...',

        // Persona Management
        'persona.title': '人設管理',
        'persona.saved': '已儲存的人設',
        'persona.current': '當前人設',
        'persona.new': '新建人設',
        'persona.save': '儲存當前人設',
        'persona.delete': '刪除',
        'persona.load': '載入',
        'persona.name': '人設名稱',
        'persona.noPersonas': '暫無儲存的人設',
        'persona.saveSuccess': '人設儲存成功',
        'persona.deleteConfirm': '確定要刪除這個人設嗎？',
        'persona.switchNotify': '已切換到人設：',

        // Chat Persistence
        'chat.restore': '恢復上次聊天',
        'chat.restorePrompt': '是否繼續上次的對話？',
        'chat.restoreWith': '繼續與',
        'chat.lastActive': '上次活躍於',
        'chat.startFresh': '開始新對話',
        'chat.continue': '繼續對話',
        'chat.autoSave': '自動儲存聊天',
        'chat.autoRestore': '自動恢復上次聊天',

        // Error Messages
        'error.generation': '生成失敗',
        'error.apiKey': 'API 金鑰錯誤',
        'error.apiKeyMessage': '請檢查設定中的 API 金鑰。',
        'error.rateLimit': '請求過於頻繁',
        'error.rateLimitMessage': '請求太多了，請稍等片刻。',
        'error.network': '網路錯誤',
        'error.networkMessage': '無法連線到伺服器。',
        'error.timeout': '請求逾時',
        'error.timeoutMessage': '請求時間過長，請重試。',
        'error.unknown': '未知錯誤',

        // Character Import
        'character.contacts': '聯絡人',
        'character.importCard': '匯入角色卡',
        'character.importing': '匯入中...',
        'character.importSuccess': '角色匯入成功',
        'character.importFailed': '匯入失敗',
    }
};

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

export const LanguageContext = createContext<LanguageContextType>({
    language: 'en', // Default to English
    setLanguage: () => { },
    t: (key) => key,
});

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Default to English
    const [language, setLanguage] = useState<Language>('en');

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return React.createElement(LanguageContext.Provider, { value: { language, setLanguage, t } }, children);
};

export const useLanguage = () => useContext(LanguageContext);
