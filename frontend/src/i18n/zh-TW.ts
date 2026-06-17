const zhTW: Record<string, string> = {
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

    // Advanced Control - New Features
    'advanced.title': '高級控制',
    'advanced.logitBias': 'Logit 偏差 / Token 偏差',
    'advanced.logitBias.desc': '提升或禁止特定詞元/詞語',
    'advanced.bannedTokens': '禁用詞元',
    'advanced.sendBannedTokens': '發送禁用詞元',
    'advanced.globalBannedTokens': '全域禁用詞元',
    'advanced.negativePrompt': '負面提示詞',
    'advanced.grammar': '語法 / JSON Schema',
    'advanced.enableJsonSchema': '啟用 JSON Schema',
    'advanced.grammarString': '語法字串 (GBNF)',

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
};

export default zhTW;
