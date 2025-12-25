
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_CONFIG } from './constants';
import { Character, Message, Role, ChatConfig, AppSettings } from './types';
import { createChatSession, sendMessageStream, initializeGenAI } from './services/geminiService';
import { getCharacters, getSettings, saveSettings, generateText, getHordeModels, ChatMessage } from './services/sillyTavernService';
import { loadChatState, debouncedSaveChatState, getAppSettings, saveAppSettings, getTimeSinceLastChat, clearChatState } from './services/chatPersistenceService';
import { saveChat, loadChat, getChatList, createNewChatFileName, stripChatExtension, ChatInfo } from './services/chatService';
import CharacterList from './components/CharacterList';
import MessageBubble from './components/MessageBubble';
import SettingsPanel from './components/SettingsPanel';
import { Send, Menu, Settings as SettingsIcon, Maximize2, Minimize2, Trash2, Sparkles, X, Mic, Globe, Clock, MessageCircle, Plus, History } from 'lucide-react';
import { LanguageProvider, useLanguage } from './i18n';

const AppContent: React.FC = () => {
    const { t, language, setLanguage } = useLanguage();
    const [characters, setCharacters] = useState<Character[]>([]);
    const [selectedCharacter, setSelectedCharacter] = useState<Character>({
        id: 'default',
        name: 'Loading...',
        avatar: '',
        description: '',
        systemInstruction: '',
        firstMessage: '',
        backgroundImage: ''
    });
    const [messages, setMessages] = useState<Message[]>([]);
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [config, setConfig] = useState<ChatConfig>(DEFAULT_CONFIG);
    const [rawStSettings, setRawStSettings] = useState<any>(null);

    // Voice Input State
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);

    // UI State
    const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);

    // Chat Persistence State
    const [showRestorePrompt, setShowRestorePrompt] = useState(false);
    const [savedChatCharacterName, setSavedChatCharacterName] = useState<string>('');
    const [appSettings, setAppSettings] = useState<AppSettings>(getAppSettings());
    const hasInitializedRef = useRef(false);

    // SillyTavern Chat State
    const [currentChatFileName, setCurrentChatFileName] = useState<string | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatInfo[]>([]);
    const [showChatHistory, setShowChatHistory] = useState(false);
    const [isSavingChat, setIsSavingChat] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const chatEndRef = useRef<HTMLDivElement>(null);

    const handleConfigChange = async (newConfig: ChatConfig) => {
        setConfig(newConfig);

        if (rawStSettings) {
            const updatedSettings = {
                ...rawStSettings,
                amount_gen: newConfig.maxOutputTokens,
                maxOutputTokens: newConfig.maxOutputTokens,  // Direct access for API
                thinkingBudget: newConfig.thinkingBudget,    // Extended thinking budget
                temperature: newConfig.temperature,          // Direct temperature access
                username: newConfig.userName,
                main_api: newConfig.mainApi,
                api_server_textgenerationwebui: newConfig.apiUrl,
                modelName: newConfig.modelName, // Sync selected model
                koboldhorde_settings: {
                    ...rawStSettings.koboldhorde_settings,
                    apikey: newConfig.apiKey,
                    models: newConfig.hordeModels,
                    auto_adjust_context_length: newConfig.hordeAdjustContext,
                    auto_adjust_response_length: newConfig.hordeAdjustResponse,
                    trusted_workers_only: newConfig.hordeTrustedOnly,
                },
                textgenerationwebui_settings: {
                    ...rawStSettings.textgenerationwebui_settings,
                    temp: newConfig.temperature,
                    top_p: newConfig.topP,
                    top_k: newConfig.topK,
                    rep_pen: newConfig.repetitionPenalty,
                    min_p: newConfig.minP,
                    top_a: newConfig.topA,
                    typical_p: newConfig.typicalP,
                    tfs: newConfig.tfs,
                    rep_pen_range: newConfig.repPenRange,
                    stopping_strings: newConfig.stopSequences,
                }
            };
            setRawStSettings(updatedSettings);
            // We might want to debounce this or only save on close/specific action
            await saveSettings(updatedSettings);
        }
    };

    // Initialize Speech Recognition
    useEffect(() => {
        const fetchChars = async () => {
            const chars = await getCharacters();
            setCharacters(chars);
            if (chars.length > 0) {
                setSelectedCharacter(chars[0]);
            }
        };
        fetchChars();

        const fetchConfig = async () => {
            const settings = await getSettings();
            if (settings && Object.keys(settings).length > 0) {
                setRawStSettings(settings);
                const tgSettings = settings.textgenerationwebui_settings || {};

                setConfig(prev => ({
                    ...prev,
                    mainApi: settings.main_api ?? prev.mainApi,
                    apiUrl: settings.api_server_textgenerationwebui ?? prev.apiUrl,
                    apiKey: settings.koboldhorde_settings?.apikey ?? prev.apiKey,
                    hordeModels: settings.koboldhorde_settings?.models ?? prev.hordeModels,
                    hordeAdjustContext: settings.koboldhorde_settings?.auto_adjust_context_length ?? prev.hordeAdjustContext,
                    hordeAdjustResponse: settings.koboldhorde_settings?.auto_adjust_response_length ?? prev.hordeAdjustResponse,
                    hordeTrustedOnly: settings.koboldhorde_settings?.trusted_workers_only ?? prev.hordeTrustedOnly,
                    temperature: tgSettings.temp ?? prev.temperature,
                    topP: tgSettings.top_p ?? prev.topP,
                    topK: tgSettings.top_k ?? prev.topK,
                    repetitionPenalty: tgSettings.rep_pen ?? prev.repetitionPenalty,
                    minP: tgSettings.min_p ?? prev.minP,
                    topA: tgSettings.top_a ?? prev.topA,
                    typicalP: tgSettings.typical_p ?? prev.typicalP,
                    tfs: tgSettings.tfs ?? prev.tfs,
                    repPenRange: tgSettings.rep_pen_range ?? prev.repPenRange,
                    maxOutputTokens: settings.amount_gen ?? prev.maxOutputTokens,
                    stopSequences: tgSettings.stopping_strings ?? prev.stopSequences,
                    userName: settings.username ?? prev.userName,
                }));
            }
        };
        fetchConfig();

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (SpeechRecognition) {
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = true;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.lang = 'en-US';

            recognitionRef.current.onresult = (event: any) => {
                let newTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        newTranscript += event.results[i][0].transcript;
                    }
                }
                if (newTranscript) {
                    setInputText(prev => {
                        const spacer = prev.length > 0 && !prev.endsWith(' ') ? ' ' : '';
                        return prev + spacer + newTranscript;
                    });
                }
            };

            recognitionRef.current.onerror = (event: any) => {
                console.error("Speech recognition error", event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };
        }
    }, []);

    const toggleVoiceInput = () => {
        if (!recognitionRef.current) {
            alert("Speech recognition not supported in this browser.");
            return;
        }

        if (isListening) {
            recognitionRef.current.stop();
        } else {
            try {
                recognitionRef.current.start();
                setIsListening(true);
            } catch (e) {
                console.error("Failed to start speech recognition:", e);
                setIsListening(false);
            }
        }
    };

    useEffect(() => {
        // Only start new chat if we're not in initial load with restore pending
        if (hasInitializedRef.current) {
            startNewChat();
        }
        setMobileMenuOpen(false);
    }, [selectedCharacter.id]);

    // Load chat history for current character
    const loadChatHistory = useCallback(async () => {
        if (selectedCharacter.id === 'default') return;
        const history = await getChatList(selectedCharacter.id);
        setChatHistory(history);
    }, [selectedCharacter.id]);

    // Auto-save chat to SillyTavern backend (debounced)
    const debouncedSaveToBackend = useCallback(() => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            if (messages.length > 0 && selectedCharacter.id !== 'default' && currentChatFileName) {
                setIsSavingChat(true);
                const success = await saveChat(
                    selectedCharacter.id,
                    currentChatFileName,
                    messages,
                    config.userName,
                    selectedCharacter.name
                );
                setIsSavingChat(false);
                if (success) {
                    console.log('Chat saved:', currentChatFileName);
                }
            }
        }, 2000); // Save after 2 seconds of inactivity
    }, [messages, selectedCharacter.id, selectedCharacter.name, currentChatFileName, config.userName]);

    // Auto-save when messages change
    useEffect(() => {
        if (messages.length > 1 && currentChatFileName) {
            debouncedSaveToBackend();
        }
        // Also save to localStorage for quick restore
        if (messages.length > 0 && selectedCharacter.id !== 'default' && appSettings.autoRestoreChat) {
            debouncedSaveChatState(selectedCharacter.id, messages);
        }
    }, [messages, currentChatFileName, debouncedSaveToBackend, selectedCharacter.id, appSettings.autoRestoreChat]);

    // Load chat history when character changes
    useEffect(() => {
        loadChatHistory();
    }, [loadChatHistory]);

    // Load most recent chat for character on selection
    useEffect(() => {
        const loadRecentChat = async () => {
            if (selectedCharacter.id === 'default' || !hasInitializedRef.current) return;

            const history = await getChatList(selectedCharacter.id);
            setChatHistory(history);

            if (history.length > 0) {
                // Load the most recent chat
                const mostRecent = history[0];
                const fileName = stripChatExtension(mostRecent.file_name);
                const { messages: loadedMessages } = await loadChat(selectedCharacter.id, fileName);

                if (loadedMessages.length > 0) {
                    setMessages(loadedMessages);
                    setCurrentChatFileName(fileName);
                    return;
                }
            }

            // No existing chat, start new one
            startNewChat();
        };

        if (hasInitializedRef.current && selectedCharacter.id !== 'default') {
            loadRecentChat();
        }
    }, [selectedCharacter.id]);

    // Check for saved chat on initial load
    useEffect(() => {
        if (hasInitializedRef.current) return;

        const savedChat = loadChatState();
        if (savedChat && appSettings.autoRestoreChat && characters.length > 0) {
            const savedCharacter = characters.find(c => c.id === savedChat.characterId);
            if (savedCharacter && savedChat.messages.length > 1) {
                setSavedChatCharacterName(savedCharacter.name);
                setShowRestorePrompt(true);
            } else {
                hasInitializedRef.current = true;
            }
        } else {
            hasInitializedRef.current = true;
        }
    }, [characters, appSettings.autoRestoreChat]);

    const handleRestoreChat = () => {
        const savedChat = loadChatState();
        if (savedChat) {
            const savedCharacter = characters.find(c => c.id === savedChat.characterId);
            if (savedCharacter) {
                setSelectedCharacter(savedCharacter);
                setMessages(savedChat.messages);
            }
        }
        setShowRestorePrompt(false);
        hasInitializedRef.current = true;
    };

    const handleStartFresh = () => {
        clearChatState();
        setShowRestorePrompt(false);
        hasInitializedRef.current = true;
        startNewChat();
    };

    const startNewChat = useCallback(() => {
        // Create new chat file name
        const newFileName = createNewChatFileName(selectedCharacter.name);
        setCurrentChatFileName(newFileName);

        const greeting: Message = {
            id: 'init-' + Date.now(),
            role: Role.Model,
            content: selectedCharacter.firstMessage,
            timestamp: Date.now()
        };
        setMessages([greeting]);

        try {
            createChatSession(selectedCharacter, config);
        } catch (e) {
            console.error("Failed to initialize chat session:", e);
        }

        // Refresh chat history
        loadChatHistory();
    }, [selectedCharacter, config, loadChatHistory]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isTyping]);

    const handleSendMessage = async () => {
        if (!inputText.trim() || isTyping) return;

        const userMsg: Message = {
            id: Date.now().toString(),
            role: Role.User,
            content: inputText,
            timestamp: Date.now()
        };

        setMessages(prev => [...prev, userMsg]);
        setInputText('');
        setIsTyping(true);

        const botMsgId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, {
            id: botMsgId,
            role: Role.Model,
            content: '',
            timestamp: Date.now(),
            isThinking: true
        }]);

        try {
            // Build proper chat messages for chat completion APIs
            const chatMessages: ChatMessage[] = [];

            // 1. System Prompt - includes character persona, scenario, and instructions
            let systemContent = '';

            // Strong roleplay framing
            systemContent += `You are ${selectedCharacter.name}. You must stay completely in character at all times.\n\n`;

            // Character persona/personality
            if (selectedCharacter.systemInstruction) {
                systemContent += selectedCharacter.systemInstruction + '\n\n';
            }

            // Character description
            if (selectedCharacter.description) {
                systemContent += `[Character Description: ${selectedCharacter.description}]\n\n`;
            }

            // Scenario from config
            if (config.scenario) {
                systemContent += `[Current Scenario: ${config.scenario}]\n\n`;
            }

            // User persona
            if (config.userName && config.userDescription) {
                systemContent += `[The user (${config.userName}): ${config.userDescription}]\n\n`;
            }

            // Example dialogue (helps AI understand character voice)
            if (selectedCharacter.exampleDialogue) {
                systemContent += `[Example of ${selectedCharacter.name}'s speech patterns and personality:\n${selectedCharacter.exampleDialogue}]\n\n`;
            }

            // Strong roleplay enforcement
            systemContent += `IMPORTANT INSTRUCTIONS:
- You ARE ${selectedCharacter.name}. Never break character.
- Respond naturally as ${selectedCharacter.name} would, with their personality, speech patterns, and mannerisms.
- Never mention you are an AI, language model, or assistant.
- Use descriptive actions in *asterisks* when appropriate.
- Engage emotionally with the scene and the user.
- Stay immersed in the roleplay scenario.`;

            chatMessages.push({ role: 'system', content: systemContent });

            // 2. First message from character (if exists and no chat history)
            if (selectedCharacter.firstMessage && messages.length === 0) {
                chatMessages.push({ role: 'assistant', content: selectedCharacter.firstMessage });
            }

            // 3. Chat history - convert to proper user/assistant format
            const currentHistory = [...messages, userMsg];
            currentHistory.forEach(msg => {
                chatMessages.push({
                    role: msg.role === Role.User ? 'user' : 'assistant',
                    content: msg.content
                });
            });

            // 4. Call API with structured messages
            const responseText = await generateText({ messages: chatMessages }, rawStSettings || {});

            setMessages(prev => prev.map(msg =>
                msg.id === botMsgId
                    ? { ...msg, content: responseText, isThinking: false }
                    : msg
            ));

        } catch (error) {
            console.error("Error generating response:", error);
            setMessages(prev => prev.map(msg =>
                msg.id === botMsgId
                    ? { ...msg, content: "ERROR: Connection severed. The ether is silent.", isThinking: false }
                    : msg
            ));
        } finally {
            setIsTyping(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const clearChat = () => {
        if (window.confirm("Reset this conversation with new settings?")) {
            startNewChat();
        }
    };

    return (
        <div className="relative w-full h-screen overflow-hidden font-sans text-slate-200 bg-black selection:bg-primary/20 selection:text-white"
            style={{ fontSize: `${config.fontSize}px` }}
        >

            {/* Background Layer */}
            <div
                className="absolute inset-0 z-0 transition-opacity duration-1000 ease-in-out"
                style={{
                    backgroundImage: `url(${selectedCharacter.backgroundImage})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    opacity: 0.25,
                    filter: `blur(${config.backgroundBlur}px)`
                }}
            />
            <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#09090b]/70 via-[#0f172a]/90 to-[#09090b] pointer-events-none" />
            <div className="absolute inset-0 z-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-overlay"></div>

            {/* Restore Chat Modal */}
            {showRestorePrompt && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-[#18181b]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-500/20 to-slate-600/20 flex items-center justify-center border border-slate-500/30">
                                <MessageCircle className="text-slate-400" size={28} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white">{t('chat.restore')}</h2>
                                <p className="text-sm text-slate-400 mt-0.5">{t('chat.restorePrompt')}</p>
                            </div>
                        </div>

                        <div className="bg-black/30 rounded-xl p-4 mb-6 border border-white/5">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center">
                                    <Sparkles className="text-amber-400" size={18} />
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm text-white font-medium">{t('chat.restoreWith')} {savedChatCharacterName}</p>
                                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                        <Clock size={12} />
                                        {t('chat.lastActive')} {getTimeSinceLastChat()}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={handleStartFresh}
                                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 transition-all"
                            >
                                {t('chat.startFresh')}
                            </button>
                            <button
                                onClick={handleRestoreChat}
                                className="flex-1 px-4 py-3 rounded-xl text-sm font-medium text-white bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-500 hover:to-slate-600 shadow-lg shadow-slate-900/50 transition-all hover:scale-[1.02] active:scale-[0.98]"
                            >
                                {t('chat.continue')} →
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Layout */}
            <div className="relative z-10 flex h-full">

                {/* Left Sidebar */}
                <aside
                    className={`${leftSidebarOpen ? 'w-80' : 'w-20'} hidden md:flex flex-col glass-panel border-r border-white/5 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] z-30`}
                >
                    <div className="flex items-center justify-between p-6 border-b border-white/5">
                        <div className={`flex items-center gap-3 overflow-hidden transition-all duration-300 ${leftSidebarOpen ? 'opacity-100' : 'opacity-0 w-0'}`}>
                            <div className="w-8 h-8 rounded-lg bg-slate-500/10 flex items-center justify-center border border-slate-500/20 text-slate-400">
                                <Sparkles size={16} />
                            </div>
                            <span className="font-bold text-lg tracking-tight text-slate-100">{t('app.title')} <span className="text-slate-500">V2</span></span>
                        </div>
                        <button onClick={() => setLeftSidebarOpen(!leftSidebarOpen)} className="text-slate-500 hover:text-slate-100 transition-colors">
                            {leftSidebarOpen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <CharacterList
                            characters={characters}
                            selectedId={selectedCharacter.id}
                            onSelect={setSelectedCharacter}
                            isCollapsed={!leftSidebarOpen}
                        />
                    </div>
                </aside>

                {/* Mobile Sidebar */}
                {mobileMenuOpen && (
                    <div className="absolute inset-0 z-50 bg-[#09090b]/98 backdrop-blur-2xl md:hidden flex flex-col animate-in fade-in slide-in-from-left-10 duration-200">
                        <div className="p-4 flex justify-between items-center border-b border-white/5">
                            <span className="font-bold text-lg text-slate-100">Select Persona</span>
                            <button onClick={() => setMobileMenuOpen(false)} className="text-slate-400"><X /></button>
                        </div>
                        <CharacterList
                            characters={characters}
                            selectedId={selectedCharacter.id}
                            onSelect={setSelectedCharacter}
                            isCollapsed={false}
                        />
                    </div>
                )}

                {/* Center Chat Area */}
                <main className="flex-1 flex flex-col h-full min-w-0 relative z-20">

                    {/* Header */}
                    <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 md:px-8 backdrop-blur-md z-20">
                        <div className="flex items-center gap-4 md:hidden">
                            <button onClick={() => setMobileMenuOpen(true)} className="text-slate-400 p-2 hover:bg-white/5 rounded-lg">
                                <Menu size={24} />
                            </button>
                            <span className="font-semibold text-lg text-slate-100">{selectedCharacter.name}</span>
                        </div>

                        <div className="hidden md:flex flex-col">
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl font-bold text-slate-100 tracking-tight">{selectedCharacter.name}</h1>
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400 font-mono uppercase tracking-wider">
                                    {config.modelName || 'Local'}
                                </span>
                            </div>
                            <span className="text-xs text-slate-500 mt-1 font-mono uppercase">
                                Context: 0 / {config.maxOutputTokens * 4} tokens
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Language Selector */}
                            <div className="relative group mr-2 hidden md:block">
                                <button className="flex items-center gap-2 px-3 py-2 text-sm text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors">
                                    <Globe size={18} />
                                    <span className="uppercase text-xs font-bold tracking-wider">{language === 'zh-CN' ? 'CN' : language === 'zh-TW' ? 'TW' : 'EN'}</span>
                                </button>
                                {/* Added pt-2 to bridge the gap so hover isn't lost */}
                                <div className="absolute right-0 top-full pt-2 w-32 hidden group-hover:block animate-in fade-in slide-in-from-top-2 duration-200 z-50">
                                    <div className="bg-[#09090b] border border-white/10 rounded-xl shadow-xl overflow-hidden">
                                        <button onClick={() => setLanguage('en')} className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors">English</button>
                                        <button onClick={() => setLanguage('zh-CN')} className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors">简体中文</button>
                                        <button onClick={() => setLanguage('zh-TW')} className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white transition-colors">繁體中文</button>
                                    </div>
                                </div>
                            </div>

                            {/* New Chat Button */}
                            <button
                                onClick={startNewChat}
                                className="hidden md:flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors rounded-lg hover:bg-emerald-500/10 border border-transparent hover:border-emerald-500/20"
                                title="Start new conversation"
                            >
                                <Plus size={16} />
                                <span>New</span>
                            </button>

                            {/* Chat History Button */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowChatHistory(!showChatHistory)}
                                    className={`hidden md:flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors rounded-lg border ${showChatHistory
                                            ? 'text-blue-300 bg-blue-500/10 border-blue-500/20'
                                            : 'text-slate-400 hover:text-blue-300 border-transparent hover:bg-blue-500/10 hover:border-blue-500/20'
                                        }`}
                                    title="Chat history"
                                >
                                    <History size={16} />
                                    <span>History</span>
                                    {chatHistory.length > 0 && (
                                        <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-blue-500/20 text-blue-300 rounded-full">
                                            {chatHistory.length}
                                        </span>
                                    )}
                                </button>

                                {/* Chat History Dropdown */}
                                {showChatHistory && (
                                    <div className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-y-auto bg-[#09090b] border border-white/10 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                                        <div className="p-2 border-b border-white/5">
                                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2">Chat History</h3>
                                        </div>
                                        {chatHistory.length === 0 ? (
                                            <div className="p-4 text-center text-slate-500 text-sm">
                                                No previous chats
                                            </div>
                                        ) : (
                                            <div className="p-1">
                                                {chatHistory.map((chat, index) => (
                                                    <button
                                                        key={chat.file_name}
                                                        onClick={async () => {
                                                            const fileName = stripChatExtension(chat.file_name);
                                                            const { messages: loadedMessages } = await loadChat(selectedCharacter.id, fileName);
                                                            if (loadedMessages.length > 0) {
                                                                setMessages(loadedMessages);
                                                                setCurrentChatFileName(fileName);
                                                            }
                                                            setShowChatHistory(false);
                                                        }}
                                                        className={`w-full text-left p-3 rounded-lg transition-colors ${currentChatFileName === stripChatExtension(chat.file_name)
                                                                ? 'bg-blue-500/10 border border-blue-500/20'
                                                                : 'hover:bg-white/5'
                                                            }`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-sm font-medium text-slate-200 truncate max-w-[200px]">
                                                                {chat.file_name.replace('.jsonl', '').split(' - ')[1] || `Chat ${index + 1}`}
                                                            </span>
                                                            <span className="text-[10px] text-slate-500">
                                                                {chat.message_count || chat.chat_items || 0} msgs
                                                            </span>
                                                        </div>
                                                        {chat.preview_message && (
                                                            <p className="text-xs text-slate-500 truncate mt-1">
                                                                {chat.preview_message}
                                                            </p>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Saving indicator */}
                            {isSavingChat && (
                                <div className="hidden md:flex items-center gap-1 px-2 py-1 text-xs text-slate-500">
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                                    Saving...
                                </div>
                            )}

                            <button
                                onClick={clearChat}
                                className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/5 border border-transparent hover:border-red-500/10"
                            >
                                <Trash2 size={16} />
                                <span>{t('app.reset')}</span>
                            </button>
                            <div className="w-px h-6 bg-white/5 mx-2 hidden md:block"></div>
                            <button
                                onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                                className={`p-2.5 rounded-lg border transition-all duration-300 hidden md:flex items-center justify-center
                            ${rightSidebarOpen ? 'bg-slate-700 text-slate-100 border-slate-600 shadow-lg' : 'text-slate-500 border-white/5 hover:bg-white/5 hover:text-slate-100'}
                        `}
                            >
                                <SettingsIcon size={20} />
                            </button>
                            <button
                                onClick={() => setMobileSettingsOpen(true)}
                                className="md:hidden p-2 text-slate-400 hover:text-slate-100"
                            >
                                <SettingsIcon size={20} />
                            </button>
                        </div>
                    </header>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth custom-scrollbar">
                        <div className="max-w-4xl mx-auto">
                            {messages.map((msg) => (
                                <MessageBubble
                                    key={msg.id}
                                    message={msg}
                                    character={selectedCharacter}
                                    userName={config.userName}
                                />
                            ))}
                            <div ref={chatEndRef} className="h-4" />
                        </div>
                    </div>

                    {/* Input */}
                    <div className="p-4 md:p-8 z-20 bg-gradient-to-t from-[#09090b] via-[#09090b]/80 to-transparent">
                        <div className="max-w-4xl mx-auto relative group">
                            <div className="relative bg-[#18181b]/60 backdrop-blur-2xl rounded-2xl p-2 flex items-end gap-2 ring-1 ring-white/5 focus-within:ring-slate-500/30 focus-within:bg-[#18181b]/80 transition-all shadow-2xl">
                                <textarea
                                    value={inputText}
                                    onChange={(e) => setInputText(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={`Message ${selectedCharacter.name}...`}
                                    className="w-full bg-transparent text-slate-200 placeholder-slate-600 px-4 py-3.5 max-h-40 min-h-[3.5rem] resize-none focus:outline-none rounded-2xl leading-relaxed scrollbar-hide"
                                    rows={1}
                                />

                                <button
                                    onClick={toggleVoiceInput}
                                    className={`mb-1.5 p-2.5 rounded-xl shadow-sm transition-all flex-shrink-0 duration-300
                                ${isListening
                                            ? 'bg-red-500/10 text-red-500 animate-pulse ring-1 ring-red-500/20'
                                            : 'hover:bg-white/5 text-slate-500 hover:text-slate-200'
                                        }`}
                                    title={isListening ? "Stop Listening" : "Voice Input"}
                                >
                                    <Mic size={20} />
                                </button>

                                <button
                                    onClick={handleSendMessage}
                                    disabled={!inputText.trim() || isTyping}
                                    className="mb-1.5 p-2.5 rounded-xl bg-slate-200 text-slate-900 shadow-sm hover:bg-white active:scale-95 disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed transition-all flex-shrink-0"
                                >
                                    <Send size={20} />
                                </button>
                            </div>
                        </div>
                    </div>
                </main>

                {/* Right Sidebar (Settings) */}
                <div className={`
            absolute top-0 right-0 h-full z-40
            w-[600px]
            transition-transform duration-500 cubic-bezier(0.25, 1, 0.5, 1)
            ${rightSidebarOpen ? 'translate-x-0 shadow-[-10px_0_40px_rgba(0,0,0,0.5)]' : 'translate-x-full'}
            hidden md:block
        `}>
                    <SettingsPanel
                        config={config}
                        onConfigChange={handleConfigChange}
                        isOpen={true}
                        onClose={() => setRightSidebarOpen(false)}
                    />
                </div>

                {/* Mobile Settings Drawer */}
                {mobileSettingsOpen && (
                    <div className="absolute inset-0 z-50 md:hidden animate-in fade-in slide-in-from-right-10 duration-200">
                        <SettingsPanel
                            config={config}
                            onConfigChange={handleConfigChange}
                            isOpen={true}
                            onClose={() => setMobileSettingsOpen(false)}
                        />
                    </div>
                )}

            </div>
        </div>
    );
};

const App: React.FC = () => {
    return (
        <LanguageProvider>
            <AppContent />
        </LanguageProvider>
    );
};

export default App;
