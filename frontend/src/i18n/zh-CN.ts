const zhCN: Record<string, string> = {
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

  // Advanced Control - New Features
  'advanced.title': '高级控制',
  'advanced.logitBias': 'Logit 偏差 / Token 偏差',
  'advanced.logitBias.desc': '提升或禁止特定词元/词语',
  'advanced.bannedTokens': '禁用词元',
  'advanced.sendBannedTokens': '发送禁用词元',
  'advanced.globalBannedTokens': '全局禁用词元',
  'advanced.negativePrompt': '负面提示词',
  'advanced.grammar': '语法 / JSON Schema',
  'advanced.enableJsonSchema': '启用 JSON Schema',
  'advanced.grammarString': '语法字符串 (GBNF)',

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
};

export default zhCN;
