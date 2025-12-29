
import React, { useState, useEffect } from 'react';
import { ChatConfig, LorebookEntry, Persona } from '../types';
import { getHordeModels, detectApiType, getGenericModels, saveSecret } from '../services/sillyTavernService';
import { getPersonas, createPersona, deletePersona, getActivePersonaId, setActivePersonaId, updatePersona } from '../services/personaService';
import { getAppSettings, saveAppSettings } from '../services/chatPersistenceService';
import ApiProviderSelector, { ApiProvider, PROVIDERS } from './ApiProviderSelector';
import {
    Settings,
    BookOpen,
    X,
    BrainCircuit,
    AlignLeft,
    UserCircle,
    Shield,
    Terminal,
    Cpu,
    PenTool,
    AlertTriangle,
    List,
    Palette,
    MessageSquare,
    SlidersHorizontal,
    Dna,
    FileText,
    Book,
    Plus,
    Trash2,
    ToggleLeft,
    ToggleRight,
    Type,
    Plug,
    RefreshCw,
    CheckSquare,
    Square,
    Wand2,
    CheckCircle,
    XCircle,
    Server,
    Search,
    Info,
    ExternalLink,
    Octagon,
    Save,
    Sparkles,
    ChevronDown,
    Users,
    Download,
    Upload,
    Edit2,
    Check
} from 'lucide-react';

interface BufferedProps {
    value: any;
    onSave: (val: any) => void;
    label?: React.ReactNode;
    placeholder?: string;
    className?: string;
    type?: string;
    min?: string | number;
    max?: string | number;
    step?: string | number;
}

const BufferedInput: React.FC<BufferedProps> = ({ value, onSave, label, className, type = 'text', ...props }) => {
    const { t } = useLanguage();
    const [localValue, setLocalValue] = useState(value ?? '');
    const [isDirty, setIsDirty] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isTyping, setIsTyping] = useState(false); // Track if user is actively typing

    // Only sync from external value if we're not dirty (user hasn't made changes)
    useEffect(() => {
        if (!isDirty) {
            setLocalValue(value ?? '');
        }
    }, [value, isDirty]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await onSave(localValue);
            setIsDirty(false);
            setIsTyping(false);
        } finally {
            setIsSaving(false);
        }
    };

    // Determine if we should show as text (to display placeholder) or password
    const isEmpty = localValue === '' || localValue === undefined || localValue === null;
    const shouldShowAsPassword = type === 'password' && (isTyping || !isEmpty);
    const inputType = shouldShowAsPassword ? 'password' : (type === 'password' ? 'text' : type);

    return (
        <div className="space-y-2">
            {label && <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{label}</label>}
            <input
                {...props}
                type={inputType}
                value={localValue}
                onChange={(e) => {
                    const val = type === 'number' ? parseFloat(e.target.value) : e.target.value;
                    setLocalValue(val);
                    setIsDirty(true);
                    if (type === 'password') {
                        setIsTyping(true);
                    }
                }}
                onFocus={() => {
                    // When focusing on a password field with existing content, show as password
                    if (type === 'password' && !isEmpty) {
                        setIsTyping(true);
                    }
                }}
                onBlur={() => {
                    // When leaving the field, if it's empty, show placeholder again
                    if (type === 'password' && isEmpty) {
                        setIsTyping(false);
                    }
                }}
                className={className}
            />
            <button
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                    ${isDirty
                        ? 'bg-slate-200 text-slate-900 hover:bg-white shadow-sm cursor-pointer'
                        : 'bg-white/5 text-slate-600 cursor-not-allowed'
                    }
                `}
            >
                <Save size={14} />
                {isSaving ? t('common.saving') : isDirty ? t('common.save') : t('common.saved')}
            </button>
        </div>
    );
};


const BufferedTextArea: React.FC<BufferedProps> = ({ value, onSave, label, className, ...props }) => {
    const { t } = useLanguage();
    const [localValue, setLocalValue] = useState(value);
    const [isDirty, setIsDirty] = useState(false);

    useEffect(() => {
        setLocalValue(value);
        setIsDirty(false);
    }, [value]);

    const handleSave = () => {
        onSave(localValue);
        setIsDirty(false);
    };

    return (
        <div className="space-y-2">
            {label && <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">{label}</label>}
            <textarea
                {...props}
                value={localValue}
                onChange={(e) => {
                    setLocalValue(e.target.value);
                    setIsDirty(true);
                }}
                className={className}
            />
            <button
                onClick={handleSave}
                disabled={!isDirty}
                className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all
                    ${isDirty
                        ? 'bg-slate-200 text-slate-900 hover:bg-white shadow-sm'
                        : 'bg-white/5 text-slate-600 cursor-not-allowed'
                    }
                `}
            >
                <Save size={14} />
                {isDirty ? t('common.save') : t('common.saved')}
            </button>
        </div>
    );
};

import { useLanguage } from '../i18n';

// PersonaTab Component - Manages multiple user personas
interface PersonaTabProps {
    config: ChatConfig;
    onConfigChange: (config: ChatConfig) => void;
    handleChange: (key: keyof ChatConfig, value: any) => void;
}

const PersonaTab: React.FC<PersonaTabProps> = ({ config, onConfigChange, handleChange }) => {
    const { t } = useLanguage();
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [activePersonaId, setActiveId] = useState<string | null>(null);
    const [newPersonaName, setNewPersonaName] = useState('');
    const [showNewPersonaInput, setShowNewPersonaInput] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');

    // Load personas on mount
    useEffect(() => {
        setPersonas(getPersonas());
        setActiveId(getActivePersonaId());
    }, []);

    const handleSaveCurrentAsPersona = () => {
        if (!newPersonaName.trim()) return;

        const persona = createPersona(newPersonaName.trim(), config.userDescription);
        setPersonas(getPersonas());
        setNewPersonaName('');
        setShowNewPersonaInput(false);
    };

    const handleLoadPersona = (persona: Persona) => {
        // Update config with persona's data
        onConfigChange({
            ...config,
            userName: persona.name,
            userDescription: persona.description,
        });
        setActivePersonaId(persona.id);
        setActiveId(persona.id);
    };

    const handleDeletePersona = (id: string) => {
        if (window.confirm(t('persona.deleteConfirm'))) {
            deletePersona(id);
            setPersonas(getPersonas());
            if (activePersonaId === id) {
                setActiveId(null);
            }
        }
    };

    const handleStartEdit = (persona: Persona) => {
        setEditingId(persona.id);
        setEditName(persona.name);
    };

    const handleSaveEdit = (id: string) => {
        if (editName.trim()) {
            updatePersona(id, { name: editName.trim() });
            setPersonas(getPersonas());
        }
        setEditingId(null);
        setEditName('');
    };

    const handleUpdateCurrentToPersona = (persona: Persona) => {
        // Update this persona with current config values
        updatePersona(persona.id, {
            name: config.userName,
            description: config.userDescription,
        });
        setPersonas(getPersonas());
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {/* Current Persona Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <UserCircle size={20} className="text-slate-400" />
                        {t('persona.current')}
                    </h3>
                    {activePersonaId && (
                        <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {personas.find(p => p.id === activePersonaId)?.name}
                        </span>
                    )}
                </div>

                <BufferedInput
                    label="Display Name"
                    value={config.userName}
                    onSave={(val) => handleChange('userName', val)}
                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40"
                />

                <BufferedTextArea
                    label={
                        <>
                            User Description / Persona
                            <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                                How the character sees you (appearance, personality).
                            </span>
                        </>
                    }
                    value={config.userDescription}
                    onSave={(val) => handleChange('userDescription', val)}
                    placeholder="Tall, mysterious stranger with a mechanical arm..."
                    className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 resize-none"
                />
            </div>

            {/* Save Current Persona */}
            <div className="p-4 rounded-xl bg-slate-500/5 border border-slate-500/10">
                {!showNewPersonaInput ? (
                    <button
                        onClick={() => setShowNewPersonaInput(true)}
                        className="w-full flex items-center justify-center gap-2 text-sm font-medium text-slate-400 hover:text-white py-2 transition-colors"
                    >
                        <Plus size={16} />
                        {t('persona.save')}
                    </button>
                ) : (
                    <div className="space-y-3">
                        <input
                            type="text"
                            value={newPersonaName}
                            onChange={(e) => setNewPersonaName(e.target.value)}
                            placeholder={t('persona.name')}
                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-slate-500/40"
                            autoFocus
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowNewPersonaInput(false)}
                                className="flex-1 px-3 py-2 text-sm text-slate-400 hover:text-white bg-white/5 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveCurrentAsPersona}
                                disabled={!newPersonaName.trim()}
                                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-slate-600 hover:bg-slate-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Save size={14} className="inline mr-1" />
                                Save
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Saved Personas List */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                        <Users size={14} />
                        {t('persona.saved')}
                    </h4>
                    <span className="text-xs text-slate-500">{personas.length} saved</span>
                </div>

                {personas.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-white/10 rounded-xl text-gray-600 text-sm">
                        {t('persona.noPersonas')}
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                        {personas.map((persona) => (
                            <div
                                key={persona.id}
                                className={`group p-3 rounded-xl border transition-all ${activePersonaId === persona.id
                                    ? 'bg-slate-500/10 border-slate-500/30'
                                    : 'bg-black/20 border-white/5 hover:border-white/10 hover:bg-white/5'
                                    }`}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-500/20 to-slate-600/20 flex items-center justify-center text-slate-400 font-bold text-lg">
                                        {persona.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        {editingId === persona.id ? (
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={editName}
                                                    onChange={(e) => setEditName(e.target.value)}
                                                    className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-slate-500/40"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={() => handleSaveEdit(persona.id)}
                                                    className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                                                >
                                                    <Check size={14} />
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <p className="text-sm font-medium text-white truncate">{persona.name}</p>
                                                <p className="text-xs text-slate-500 truncate">
                                                    {persona.description.substring(0, 50)}{persona.description.length > 50 ? '...' : ''}
                                                </p>
                                            </>
                                        )}
                                    </div>

                                    {editingId !== persona.id && (
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={() => handleStartEdit(persona)}
                                                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                                title="Edit name"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleUpdateCurrentToPersona(persona)}
                                                className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                                                title="Update with current"
                                            >
                                                <Upload size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleLoadPersona(persona)}
                                                className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                                                title="Load persona"
                                            >
                                                <Download size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDeletePersona(persona.id)}
                                                className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    )}

                                    {activePersonaId === persona.id && editingId !== persona.id && (
                                        <div className="flex-shrink-0">
                                            <CheckCircle size={16} className="text-emerald-400" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// Auto-restore Chat Toggle Component
const InterfaceAutoRestoreToggle: React.FC = () => {
    const { t } = useLanguage();
    const [autoRestore, setAutoRestore] = useState(() => getAppSettings().autoRestoreChat);

    const handleToggle = () => {
        const newValue = !autoRestore;
        setAutoRestore(newValue);
        saveAppSettings({ autoRestoreChat: newValue });
    };

    return (
        <label className="flex items-center justify-between cursor-pointer group">
            <div>
                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
                    {t('chat.autoRestore')}
                </span>
                <p className="text-[10px] text-gray-500 mt-0.5">
                    {t('chat.restorePrompt')}
                </p>
            </div>
            <button
                onClick={handleToggle}
                className={`relative w-12 h-6 rounded-full transition-colors ${autoRestore ? 'bg-slate-500' : 'bg-gray-700'
                    }`}
            >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${autoRestore ? 'left-7' : 'left-1'
                    }`} />
            </button>
        </label>
    );
};

interface SettingsPanelProps {
    config: ChatConfig;
    onConfigChange: (config: ChatConfig) => void;
    isOpen: boolean;
    onClose: () => void;
}


type Tab = 'api' | 'generation' | 'story' | 'lorebook' | 'character' | 'persona' | 'formatting' | 'interface';

const SettingsPanel: React.FC<SettingsPanelProps> = ({ config, onConfigChange, isOpen, onClose }) => {
    const { t } = useLanguage();
    const [activeTab, setActiveTab] = useState<Tab>('generation');
    const [hordeModelsList, setHordeModelsList] = useState<string[]>([]);
    const [genericModelsList, setGenericModelsList] = useState<string[]>([]);
    const [loadingModels, setLoadingModels] = useState(false);

    // Connection Status State
    const [connectionStatus, setConnectionStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [connectionMessage, setConnectionMessage] = useState('');

    // Lorebook State
    const [newLoreKey, setNewLoreKey] = useState('');

    useEffect(() => {
        if (activeTab !== 'api') return;

        if (config.mainApi === 'koboldhorde') {
            fetchHordeModels();
        } else if (['textgenerationwebui', 'kobold', 'koboldcpp', 'ollama'].includes(config.mainApi) && config.apiUrl) {
            fetchGenericModels();
        }
    }, [config.mainApi, activeTab, config.apiUrl]);

    // Separate effect for Cloud Providers to react to API Key changes without re-fetching models unnecessarily
    useEffect(() => {
        if (activeTab === 'api' && ['openrouter', 'openai', 'google'].includes(config.mainApi)) {
            if (config.apiKey) {
                setConnectionStatus('success');
                setConnectionMessage('Ready');
            } else {
                setConnectionStatus('idle');
                setConnectionMessage('Waiting for API Key...');
            }
        }
    }, [activeTab, config.mainApi, config.apiKey]);

    // Auto-load API keys from environment variables and sync to backend
    // Load API key from localStorage on provider change
    useEffect(() => {
        const ENV_KEY_MAP: Record<string, string> = {
            'perplexity': import.meta.env.VITE_PERPLEXITY_API_KEY,
            'openai': import.meta.env.VITE_OPENAI_API_KEY,
            'openrouter': import.meta.env.VITE_OPENROUTER_API_KEY,
            'google': import.meta.env.VITE_GOOGLE_API_KEY,
        };

        // Try to load from localStorage first
        const primaryStorageKey = `romanbath_api_key_${config.mainApi}`;
        const legacyStorageKey = `etheria_api_key_${config.mainApi}`;

        const storedKey = localStorage.getItem(primaryStorageKey) ?? localStorage.getItem(legacyStorageKey);
        if (storedKey && !config.apiKey) {
            // Migrate legacy key name to the new prefix for forward compatibility
            if (!localStorage.getItem(primaryStorageKey)) {
                localStorage.setItem(primaryStorageKey, storedKey);
            }
            console.log(`Loading ${config.mainApi} API key from localStorage`);
            handleChange('apiKey', storedKey);
            return;
        }

        // Fallback to .env
        const envKey = ENV_KEY_MAP[config.mainApi];
        if (envKey && !config.apiKey) {
            // If .env has a key and config doesn't, sync it
            console.log(`Loading ${config.mainApi} API key from .env`);
            handleChange('apiKey', envKey);
            // Also save to backend
            saveSecret(config.mainApi, envKey).then(success => {
                if (success) {
                    setConnectionStatus('success');
                    setConnectionMessage('API Key loaded from .env and saved');
                }
            });
        }
    }, [config.mainApi]);

    const fetchHordeModels = async () => {
        setLoadingModels(true);
        setConnectionStatus('loading');
        setConnectionMessage('Connecting to Horde...');
        try {
            const models = await getHordeModels();
            setHordeModelsList(models);
            setLoadingModels(false);
            setConnectionStatus('success');
            setConnectionMessage('Connected to Horde');
        } catch (e) {
            setLoadingModels(false);
            setConnectionStatus('error');
            setConnectionMessage('Failed to connect to Horde');
        }
    };

    const fetchGenericModels = async () => {
        if (!config.apiUrl) return;
        setLoadingModels(true);
        setConnectionStatus('loading');
        setConnectionMessage('Fetching models...');
        // Map internal type names if needed
        let apiType = 'textgenerationwebui';
        if (config.mainApi === 'kobold') apiType = 'koboldcpp';
        if (config.mainApi === 'ollama') apiType = 'ollama';

        try {
            const models = await getGenericModels(config.apiUrl, apiType);
            setGenericModelsList(models);
            setLoadingModels(false);
            if (models.length > 0) {
                setConnectionStatus('success');
                setConnectionMessage(`Connected. Found ${models.length} models.`);
            } else {
                setConnectionStatus('error'); // Or warning
                setConnectionMessage('Connected, but no models found.');
            }
        } catch (e) {
            setLoadingModels(false);
            setConnectionStatus('error');
            setConnectionMessage('Failed to fetch models.');
        }
    };

    const handleProviderSelect = (provider: ApiProvider) => {
        // Clear API key first, then let useEffect load the correct one for this provider
        const newConfig = {
            ...config,
            mainApi: provider.id,
            apiKey: '' // Clear current key, useEffect will load from localStorage if available
        };

        setConnectionStatus('idle');
        setConnectionMessage('');

        if (provider.defaultUrl) {
            newConfig.apiUrl = provider.defaultUrl;
        }

        onConfigChange(newConfig);
    };

    if (!isOpen) return null;

    const handleChange = (key: keyof ChatConfig, value: any) => {
        onConfigChange({ ...config, [key]: value });
    };

    // Special handler for API Key that also saves to secrets and localStorage
    const handleApiKeyChange = async (value: string) => {
        handleChange('apiKey', value);

        // Save to localStorage for persistence
        const primaryStorageKey = `romanbath_api_key_${config.mainApi}`;
        const legacyStorageKey = `etheria_api_key_${config.mainApi}`;
        if (value) {
            localStorage.setItem(primaryStorageKey, value);
            localStorage.setItem(legacyStorageKey, value);
        } else {
            localStorage.removeItem(primaryStorageKey);
            localStorage.removeItem(legacyStorageKey);
        }

        // Save to SillyTavern secrets for cloud providers (not local)
        if (value && ['perplexity', 'openai', 'openrouter', 'google', 'koboldhorde'].includes(config.mainApi)) {
            const success = await saveSecret(config.mainApi, value);
            if (success) {
                setConnectionStatus('loading');
                setConnectionMessage('Testing connection...');

                // Test the API connection
                const testResult = await testApiConnection(config.mainApi, value, config.apiUrl, config.modelName);
                if (testResult.success) {
                    setConnectionStatus('success');
                    setConnectionMessage(testResult.message || 'Connected successfully');
                } else {
                    setConnectionStatus('error');
                    setConnectionMessage(testResult.message || 'Connection failed');
                }
            } else {
                setConnectionStatus('error');
                setConnectionMessage('Failed to save API Key');
            }
        }

        // For local API, just test connection directly (no backend secret storage)
        if (value && config.mainApi === 'local') {
            setConnectionStatus('loading');
            setConnectionMessage('Testing connection...');

            const testResult = await testApiConnection('local', value, config.apiUrl, config.modelName);
            if (testResult.success) {
                setConnectionStatus('success');
                setConnectionMessage(testResult.message || 'Connected successfully');
            } else {
                setConnectionStatus('error');
                setConnectionMessage(testResult.message || 'Connection failed');
            }
        }
    };

    // Test API connection by sending a minimal request
    const testApiConnection = async (
        provider: string,
        apiKey: string,
        apiUrl?: string,
        modelName?: string
    ): Promise<{ success: boolean; message: string }> => {
        try {
            let testUrl = '';
            let headers: Record<string, string> = {};
            let body: any = null;
            let method = 'GET';

            switch (provider) {
                case 'openai':
                    testUrl = 'https://api.openai.com/v1/models';
                    headers = { 'Authorization': `Bearer ${apiKey}` };
                    break;
                case 'openrouter':
                    testUrl = 'https://openrouter.ai/api/v1/models';
                    headers = { 'Authorization': `Bearer ${apiKey}` };
                    break;
                case 'google':
                    testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
                    break;
                case 'perplexity':
                    // Perplexity doesn't have a models endpoint, test with a minimal chat request
                    testUrl = 'https://api.perplexity.ai/chat/completions';
                    headers = {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    };
                    body = JSON.stringify({
                        model: 'sonar',
                        messages: [{ role: 'user', content: 'Hi' }],
                        max_tokens: 1
                    });
                    method = 'POST';
                    break;
                case 'local':
                    // Test local proxy through Vite's proxy to bypass CORS
                    // The proxy rewrites /local-api/* to localhost:8045/*
                    testUrl = '/local-api/v1/models';
                    headers = { 'Authorization': `Bearer ${apiKey}` };
                    break;
                default:
                    return { success: true, message: 'API Key saved (no test available)' };
            }

            const response = await fetch(testUrl, {
                method,
                headers,
                body
            });

            if (response.ok) {
                return { success: true, message: 'API connection verified ✓' };
            } else if (response.status === 401 || response.status === 403) {
                return { success: false, message: 'Invalid API Key' };
            } else if (response.status === 429) {
                // Rate limited but key is valid
                return { success: true, message: 'API Key valid (rate limited)' };
            } else {
                return { success: false, message: `API error: ${response.status}` };
            }
        } catch (error: any) {
            if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
                return { success: false, message: 'Network error - cannot reach API' };
            }
            return { success: false, message: error.message || 'Connection test failed' };
        }
    };

    // Lorebook Handlers
    const addLorebookEntry = () => {
        const newEntry: LorebookEntry = {
            id: Date.now().toString(),
            keys: [],
            content: '',
            enabled: true
        };
        handleChange('lorebook', [...config.lorebook, newEntry]);
    };

    const updateLorebookEntry = (id: string, field: keyof LorebookEntry, value: any) => {
        const updated = config.lorebook.map(entry => {
            if (entry.id === id) {
                if (field === 'keys' && typeof value === 'string') {
                    return { ...entry, keys: value.split(',').map((k: string) => k.trim()) };
                }
                return { ...entry, [field]: value };
            }
            return entry;
        });
        handleChange('lorebook', updated);
    };

    const deleteLorebookEntry = (id: string) => {
        handleChange('lorebook', config.lorebook.filter(e => e.id !== id));
    };

    const navItemClass = (tab: Tab) => `
    flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left mb-1
    ${activeTab === tab
            ? 'bg-slate-500/10 text-slate-100 border border-slate-500/20'
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5 border border-transparent'
        }
  `;

    return (
        <div className="h-full flex bg-[#09090b]/98 backdrop-blur-3xl border-l border-white/5 w-full shadow-2xl font-sans">

            {/* Sidebar Navigation */}
            <div className="w-16 md:w-60 border-r border-white/5 flex flex-col pt-20 md:pt-0 bg-black/40 shrink-0">
                <div className="hidden md:flex items-center gap-3 px-6 py-5 border-b border-white/5 h-20 bg-black/20">
                    <SlidersHorizontal size={18} className="text-slate-400" />
                    <span className="font-bold text-slate-200 tracking-widest text-xs uppercase">{t('settings.configuration')}</span>
                </div>

                <nav className="p-3 flex-1 overflow-y-auto custom-scrollbar space-y-1">
                    <button onClick={() => setActiveTab('api')} className={navItemClass('api')}>
                        <Plug size={18} />
                        <span className="hidden md:inline">{t('tab.api')}</span>
                    </button>
                    <button onClick={() => setActiveTab('generation')} className={navItemClass('generation')}>
                        <Cpu size={18} />
                        <span className="hidden md:inline">{t('tab.generation')}</span>
                    </button>
                    <button onClick={() => setActiveTab('story')} className={navItemClass('story')}>
                        <BookOpen size={18} />
                        <span className="hidden md:inline">{t('tab.story')}</span>
                    </button>
                    <button onClick={() => setActiveTab('lorebook')} className={navItemClass('lorebook')}>
                        <Book size={18} />
                        <span className="hidden md:inline">{t('tab.lorebook')}</span>
                    </button>
                    <button onClick={() => setActiveTab('character')} className={navItemClass('character')}>
                        <FileText size={18} />
                        <span className="hidden md:inline">{t('tab.character')}</span>
                    </button>
                    <button onClick={() => setActiveTab('persona')} className={navItemClass('persona')}>
                        <UserCircle size={18} />
                        <span className="hidden md:inline">{t('tab.persona')}</span>
                    </button>
                    <button onClick={() => setActiveTab('formatting')} className={navItemClass('formatting')}>
                        <Type size={18} />
                        <span className="hidden md:inline">{t('tab.formatting')}</span>
                    </button>
                    <button onClick={() => setActiveTab('interface')} className={navItemClass('interface')}>
                        <Palette size={18} />
                        <span className="hidden md:inline">{t('tab.interface')}</span>
                    </button>
                </nav>

                <div className="p-4 border-t border-white/5 hidden md:block">
                    <div className="text-[10px] text-gray-600 font-mono text-center opacity-60">
                        Roman Bath (Lorebook)
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-black/20">
                {/* Mobile Close / Header */}
                <div className="flex md:hidden items-center justify-between p-4 border-b border-white/5 bg-black/40">
                    <span className="font-bold uppercase tracking-wider text-sm text-gray-400">{t('settings.settings')}</span>
                    <button onClick={onClose} className="p-2 bg-white/5 rounded-full text-white"><X size={16} /></button>
                </div>

                <div className="hidden md:flex h-20 items-center justify-between px-6 border-b border-white/5 bg-black/20">
                    <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
                        {activeTab === 'api' && t('settings.panelTitle.api')}
                        {activeTab === 'generation' && t('settings.panelTitle.generation')}
                        {activeTab === 'story' && t('settings.panelTitle.story')}
                        {activeTab === 'lorebook' && t('settings.panelTitle.lorebook')}
                        {activeTab === 'character' && t('settings.panelTitle.character')}
                        {activeTab === 'persona' && t('settings.panelTitle.persona')}
                        {activeTab === 'formatting' && t('settings.panelTitle.formatting')}
                        {activeTab === 'interface' && t('settings.panelTitle.interface')}
                    </span>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">

                    {/* --- API TAB (NEW) --- */}
                    {activeTab === 'api' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">API Settings</h3>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <ApiProviderSelector
                                        selectedId={config.mainApi}
                                        onSelect={handleProviderSelect}
                                        isLoading={connectionStatus === 'loading'}
                                        error={connectionStatus === 'error'}
                                    />
                                </div>

                                {/* Only show API URL + optional key for local APIs that don't require a key */}
                                {config.mainApi !== 'koboldhorde' && config.mainApi !== 'local' && !PROVIDERS.find(p => p.id === config.mainApi)?.requiresKey && (
                                    <div className="space-y-4">
                                        <BufferedInput
                                            label="API URL"
                                            value={config.apiUrl}
                                            onSave={(val) => handleChange('apiUrl', val)}
                                            placeholder="http://127.0.0.1:5000"
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                        />
                                        <BufferedInput
                                            label="API Key (Optional)"
                                            type="password"
                                            value={config.apiKey}
                                            onSave={handleApiKeyChange}
                                            placeholder="Enter API Key if required"
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                        />
                                    </div>
                                )}

                                {/* Local Proxy Settings */}
                                {config.mainApi === 'local' && (
                                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                                            <h4 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                                                <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                                                本地反代 (Local Proxy)
                                            </h4>
                                            <p className="text-xs text-slate-400 mt-1">
                                                连接到本地 OpenAI 兼容 API，支持 Gemini、Claude 等模型
                                            </p>
                                        </div>
                                        <BufferedInput
                                            label="API URL"
                                            value={config.apiUrl}
                                            onSave={(val) => handleChange('apiUrl', val)}
                                            placeholder="http://localhost:8045/v1"
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                        />
                                        <BufferedInput
                                            label="API Key"
                                            type="password"
                                            value={config.apiKey}
                                            onSave={handleApiKeyChange}
                                            placeholder="Enter your API Key"
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                        />
                                        <div className="space-y-2">
                                            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                                Model
                                            </label>
                                            <input
                                                type="text"
                                                value={config.modelName || ''}
                                                onChange={(e) => handleChange('modelName', e.target.value)}
                                                placeholder="gemini-2.5-pro"
                                                className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                            />
                                            <p className="text-[10px] text-gray-500">
                                                输入模型名称，如 gemini-2.5-pro, gemini-3-flash, claude-3-sonnet 等
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Provider Info & Status */}
                                {PROVIDERS.find(p => p.id === config.mainApi)?.docsUrl && (
                                    <div className="flex items-center justify-between px-1">
                                        <a
                                            href={PROVIDERS.find(p => p.id === config.mainApi)?.docsUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-[10px] text-slate-400 hover:text-slate-300 flex items-center gap-1 transition-colors"
                                        >
                                            <Info size={12} /> Documentation
                                            <ExternalLink size={10} />
                                        </a>
                                        {connectionMessage && (
                                            <span className={`text-[10px] ${connectionStatus === 'error' ? 'text-red-400' : connectionStatus === 'success' ? 'text-green-400' : 'text-gray-500'}`}>
                                                {connectionMessage}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {config.mainApi === 'koboldhorde' && (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <div className="bg-white/5 rounded-xl p-4 space-y-2 text-xs text-gray-400">
                                            <ul className="list-disc pl-4 space-y-1">
                                                <li>AI Horde Website</li>
                                                <li>Avoid sending sensitive information to Horde. View Privacy Policy.</li>
                                                <li>Register Horde account to speed up queue times.</li>
                                                <li>Learn how to share your idle GPU time with Horde.</li>
                                            </ul>
                                        </div>

                                        <div className="space-y-3">
                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${config.hordeAdjustContext ? 'bg-slate-500 border-slate-500' : 'border-white/20 group-hover:border-white/40'}`}>
                                                    {config.hordeAdjustContext && <CheckSquare size={14} className="text-white" />}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="hidden"
                                                    checked={config.hordeAdjustContext}
                                                    onChange={(e) => handleChange('hordeAdjustContext', e.target.checked)}
                                                />
                                                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">Adjust context length based on worker capacity</span>
                                            </label>

                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${config.hordeAdjustResponse ? 'bg-slate-500 border-slate-500' : 'border-white/20 group-hover:border-white/40'}`}>
                                                    {config.hordeAdjustResponse && <CheckSquare size={14} className="text-white" />}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="hidden"
                                                    checked={config.hordeAdjustResponse}
                                                    onChange={(e) => handleChange('hordeAdjustResponse', e.target.checked)}
                                                />
                                                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">Adjust response length based on worker capacity</span>
                                            </label>

                                            <label className="flex items-center gap-3 cursor-pointer group">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${config.hordeTrustedOnly ? 'bg-slate-500 border-slate-500' : 'border-white/20 group-hover:border-white/40'}`}>
                                                    {config.hordeTrustedOnly && <CheckSquare size={14} className="text-white" />}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="hidden"
                                                    checked={config.hordeTrustedOnly}
                                                    onChange={(e) => handleChange('hordeTrustedOnly', e.target.checked)}
                                                />
                                                <span className="text-sm text-gray-300 group-hover:text-white transition-colors">Trusted workers only</span>
                                            </label>
                                        </div>

                                        <div className="flex items-center gap-4 text-xs font-mono text-gray-500">
                                            <span>Context: -</span>
                                            <span>Response: -</span>
                                        </div>
                                    </div>
                                )}

                                {(PROVIDERS.find(p => p.id === config.mainApi)?.requiresKey) && config.mainApi !== 'local' && (
                                    <BufferedInput
                                        label={
                                            <>
                                                API Key
                                                <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                                                    {config.mainApi === 'koboldhorde' ? 'Use "0000000000" for anonymous access.' : 'Required for authentication.'}
                                                </span>
                                            </>
                                        }
                                        type="password"
                                        value={config.apiKey}
                                        onSave={handleApiKeyChange}
                                        placeholder="Enter your API Key"
                                        className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40 font-mono"
                                    />
                                )}

                                {/* Model Selector for Cloud APIs */}
                                {['perplexity', 'openai', 'openrouter', 'google'].includes(config.mainApi) && (
                                    <div className="space-y-2">
                                        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                            <Cpu size={14} className="text-cyan-400" />
                                            Model
                                        </label>
                                        <select
                                            value={config.modelName || ''}
                                            onChange={(e) => handleChange('modelName', e.target.value)}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-slate-500/40"
                                        >
                                            <option value="">-- Select Model --</option>
                                            {config.mainApi === 'perplexity' && (
                                                <>
                                                    <optgroup label="Search Models">
                                                        <option value="sonar">Sonar (Lightweight Search)</option>
                                                        <option value="sonar-pro">Sonar Pro (Advanced Search)</option>
                                                    </optgroup>
                                                    <optgroup label="Reasoning">
                                                        <option value="sonar-reasoning-pro">Sonar Reasoning Pro (CoT)</option>
                                                    </optgroup>
                                                    <optgroup label="Research">
                                                        <option value="sonar-deep-research">Sonar Deep Research</option>
                                                    </optgroup>
                                                </>
                                            )}
                                            {config.mainApi === 'openai' && (
                                                <>
                                                    <optgroup label="Flagship (Best Overall)">
                                                        <option value="gpt-4o">GPT-4o (Smart & Fast)</option>
                                                        <option value="gpt-4o-mini">GPT-4o Mini (Efficient)</option>
                                                    </optgroup>
                                                    <optgroup label="Reasoning (SOTA)">
                                                        <option value="o3-mini">o3-mini (Advanced Reasoning)</option>
                                                        <option value="o1">o1 (Full Reasoning)</option>
                                                        <option value="o1-mini">o1-mini (Fast Reasoning)</option>
                                                    </optgroup>
                                                    <optgroup label="Legacy">
                                                        <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                                        <option value="gpt-4">GPT-4</option>
                                                        <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                                                    </optgroup>
                                                </>
                                            )}
                                            {config.mainApi === 'openrouter' && (
                                                <>
                                                    <optgroup label="Claude (Anthropic)">
                                                        <option value="anthropic/claude-sonnet-4">Claude Sonnet 4 (Latest)</option>
                                                        <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
                                                        <option value="anthropic/claude-3-opus">Claude 3 Opus</option>
                                                        <option value="anthropic/claude-3-haiku">Claude 3 Haiku (Fast)</option>
                                                    </optgroup>
                                                    <optgroup label="OpenAI">
                                                        <option value="openai/gpt-4o">GPT-4o</option>
                                                        <option value="openai/o1">o1 Reasoning</option>
                                                    </optgroup>
                                                    <optgroup label="Google">
                                                        <option value="google/gemini-2.5-pro-preview">Gemini 2.5 Pro</option>
                                                        <option value="google/gemini-2.5-flash-preview">Gemini 2.5 Flash</option>
                                                        <option value="google/gemini-2.0-flash-exp:free">Gemini 2.0 Flash (Free)</option>
                                                    </optgroup>
                                                    <optgroup label="Meta Llama">
                                                        <option value="meta-llama/llama-3.3-70b-instruct">Llama 3.3 70B</option>
                                                        <option value="meta-llama/llama-3.1-405b-instruct">Llama 3.1 405B</option>
                                                    </optgroup>
                                                    <optgroup label="DeepSeek">
                                                        <option value="deepseek/deepseek-r1">DeepSeek R1 (Reasoning)</option>
                                                        <option value="deepseek/deepseek-chat">DeepSeek Chat</option>
                                                    </optgroup>
                                                </>
                                            )}
                                            {config.mainApi === 'google' && (
                                                <>
                                                    <optgroup label="Gemini 2.5 (Latest)">
                                                        <option value="gemini-2.5-pro">Gemini 2.5 Pro (Reasoning)</option>
                                                        <option value="gemini-2.5-flash">Gemini 2.5 Flash (Best Value)</option>
                                                    </optgroup>
                                                    <optgroup label="Gemini 2.0">
                                                        <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                                                    </optgroup>
                                                    <optgroup label="Gemini 1.5 (Legacy)">
                                                        <option value="gemini-1.5-pro">Gemini 1.5 Pro</option>
                                                        <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                                                    </optgroup>
                                                </>
                                            )}
                                        </select>
                                        <p className="text-[10px] text-gray-500">
                                            Select the model to use for text generation.
                                        </p>
                                    </div>
                                )}

                                {config.mainApi === 'koboldhorde' && (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                                                Select Horde Models
                                            </label>
                                            <button onClick={fetchHordeModels} className="text-slate-400 hover:text-slate-200">
                                                <RefreshCw size={14} className={loadingModels ? 'animate-spin' : ''} />
                                            </button>
                                        </div>
                                        <select
                                            multiple
                                            value={config.hordeModels}
                                            onChange={(e) => {
                                                const target = e.target as HTMLSelectElement;
                                                const selected = Array.from(target.selectedOptions, option => option.value);
                                                handleChange('hordeModels', selected);
                                            }}
                                            className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-gray-300 focus:outline-none focus:border-slate-500/40 custom-scrollbar"
                                        >
                                            {hordeModelsList.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </select>
                                        <p className="text-[10px] text-gray-500">Hold Ctrl/Cmd to select multiple models.</p>
                                    </div>
                                )}

                                {(config.mainApi === 'textgenerationwebui' || config.mainApi === 'kobold') && (
                                    <div className="space-y-2 pt-2 border-t border-white/5">
                                        <div className="flex justify-between items-center">
                                            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                                <Server size={14} /> Available Models
                                            </label>
                                            <button onClick={fetchGenericModels} className="text-slate-400 hover:text-slate-200 p-1">
                                                <RefreshCw size={14} className={loadingModels ? 'animate-spin' : ''} />
                                            </button>
                                        </div>
                                        <select
                                            value={config.modelName}
                                            onChange={(e) => handleChange('modelName', e.target.value)}
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-gray-300 focus:outline-none focus:border-slate-500/40"
                                        >
                                            <option value="">-- Select Model --</option>
                                            {genericModelsList.map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </select>
                                        <p className="text-[10px] text-gray-500">
                                            {genericModelsList.length === 0 ? "Click refresh to fetch models from API." : `${genericModelsList.length} models found.`}
                                        </p>
                                    </div>
                                )}

                                {/* Dynamic Connection Status */}
                                <div className={`p-4 rounded-xl border ${connectionStatus === 'success'
                                    ? 'bg-green-500/5 border-green-500/20'
                                    : connectionStatus === 'error'
                                        ? 'bg-red-500/5 border-red-500/20'
                                        : connectionStatus === 'loading'
                                            ? 'bg-blue-500/5 border-blue-500/20'
                                            : 'bg-yellow-500/5 border-yellow-500/20'
                                    }`}>
                                    <div className="flex items-start gap-3">
                                        <div className={`w-2 h-2 rounded-full mt-1.5 ${connectionStatus === 'success'
                                            ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]'
                                            : connectionStatus === 'error'
                                                ? 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                                                : connectionStatus === 'loading'
                                                    ? 'bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                                                    : 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]'
                                            }`}></div>
                                        <div className="space-y-1 flex-1">
                                            <h4 className={`text-sm font-medium ${connectionStatus === 'success' ? 'text-green-500'
                                                : connectionStatus === 'error' ? 'text-red-500'
                                                    : connectionStatus === 'loading' ? 'text-blue-500'
                                                        : 'text-yellow-500'
                                                }`}>
                                                {connectionStatus === 'success' ? 'Connected'
                                                    : connectionStatus === 'error' ? 'Error'
                                                        : connectionStatus === 'loading' ? 'Connecting...'
                                                            : 'Waiting for API Key'}
                                            </h4>
                                            <p className="text-xs text-gray-400">
                                                {connectionMessage || 'Enter your API key and save to connect.'}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {config.mainApi === 'koboldhorde' && (
                                    <label className="flex items-center gap-3 cursor-pointer group pt-2">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${true ? 'bg-slate-500 border-slate-500' : 'border-white/20 group-hover:border-white/40'}`}>
                                            <CheckSquare size={14} className="text-white" />
                                        </div>
                                        <span className="text-sm text-gray-300 group-hover:text-white transition-colors">Automatically connect to last server</span>
                                    </label>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- GENERATION TAB --- */}
                    {activeTab === 'generation' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-white">{t('settings.sampler')}</h3>
                                <span className="text-xs font-mono text-slate-400 bg-slate-500/10 px-2 py-1 rounded">{t('settings.universal')}</span>
                            </div>

                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                        <Sparkles size={14} className="text-amber-400" /> {t('style.title')}
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[
                                            { id: 'natural', label: t('style.natural'), desc: t('style.natural.desc') },
                                            { id: 'sexy', label: t('style.sexy'), desc: t('style.sexy.desc') },
                                            { id: 'flirty', label: t('style.flirty'), desc: t('style.flirty.desc') },
                                            { id: 'horny', label: t('style.horny'), desc: t('style.horny.desc') },
                                            { id: 'custom', label: t('style.custom'), desc: t('style.custom.desc') },
                                        ].map((style) => (
                                            <button
                                                key={style.id}
                                                onClick={() => {
                                                    // Apply optimized presets based on community best practices
                                                    // Use a single state update to avoid race conditions
                                                    let presetValues: Partial<ChatConfig> = { responseStyle: style.id as ChatConfig['responseStyle'] };

                                                    if (style.id === 'natural') {
                                                        presetValues = {
                                                            ...presetValues,
                                                            temperature: 1.0,
                                                            topP: 1.0,
                                                            minP: 0.02,
                                                            repetitionPenalty: 1.1,
                                                            presencePenalty: 0,
                                                            dryMultiplier: 0,
                                                            xtcProbability: 0,
                                                            thinkingBudget: 2048,
                                                        };
                                                    } else if (style.id === 'sexy') {
                                                        presetValues = {
                                                            ...presetValues,
                                                            temperature: 1.1,
                                                            topP: 0.95,
                                                            minP: 0.02,
                                                            repetitionPenalty: 1.1,
                                                            presencePenalty: 0.1,
                                                            dryMultiplier: 0.5,
                                                            xtcProbability: 0,
                                                            thinkingBudget: 4096,
                                                        };
                                                    } else if (style.id === 'flirty') {
                                                        presetValues = {
                                                            ...presetValues,
                                                            temperature: 1.2,
                                                            topP: 0.95,
                                                            minP: 0.02,
                                                            repetitionPenalty: 1.15,
                                                            presencePenalty: 0.15,
                                                            dryMultiplier: 0.8,
                                                            xtcProbability: 0.3,
                                                            xtcThreshold: 0.1,
                                                            thinkingBudget: 6144,
                                                        };
                                                    } else if (style.id === 'horny') {
                                                        presetValues = {
                                                            ...presetValues,
                                                            temperature: 1.35,
                                                            topP: 1.0,
                                                            minP: 0.02,
                                                            repetitionPenalty: 1.15,
                                                            presencePenalty: 0.2,
                                                            dryMultiplier: 0.8,
                                                            xtcProbability: 0.5,
                                                            xtcThreshold: 0.1,
                                                            thinkingBudget: 8192,
                                                        };
                                                    }
                                                    // Custom mode: only change responseStyle, user controls all other settings
                                                    onConfigChange({ ...config, ...presetValues });
                                                }}
                                                className={`p-3 rounded-xl border text-left transition-all duration-200 group relative overflow-hidden ${(config.responseStyle || 'natural') === style.id
                                                    ? 'bg-slate-500/20 border-slate-500/50 text-white shadow-lg shadow-black/20 ring-1 ring-slate-500/30'
                                                    : 'bg-black/20 border-white/5 text-slate-400 hover:bg-white/5 hover:border-white/10'
                                                    } ${style.id === 'custom' ? 'col-span-2' : ''}`}
                                            >
                                                <div className="font-medium text-sm relative z-10">{style.label}</div>
                                                <div className="text-[10px] opacity-60 mt-0.5 relative z-10">{style.desc}</div>
                                                {/* Subtle gradient glow */}
                                                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Advanced Samplers Panel - Only show when Custom is selected */}
                                {config.responseStyle === 'custom' && (
                                    <div className="space-y-4 p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <h4 className="text-sm font-bold text-purple-300 uppercase tracking-wider flex items-center gap-2">
                                            <Settings size={14} /> {t('style.custom')}
                                        </h4>

                                        {/* DRY Settings */}
                                        <div className="space-y-3 p-3 rounded-lg bg-black/20 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-300">{t('sampler.dry')}</span>
                                                <span className="text-[10px] text-slate-500">{t('sampler.dry.desc')}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.dry.multiplier')}</label>
                                                    <input type="number" step="0.1" min="0" max="2"
                                                        value={config.dryMultiplier}
                                                        onChange={(e) => handleChange('dryMultiplier', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.dry.base')}</label>
                                                    <input type="number" step="0.25" min="1" max="3"
                                                        value={config.dryBase}
                                                        onChange={(e) => handleChange('dryBase', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* XTC Settings */}
                                        <div className="space-y-3 p-3 rounded-lg bg-black/20 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-300">{t('sampler.xtc')}</span>
                                                <span className="text-[10px] text-slate-500">{t('sampler.xtc.desc')}</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.xtc.threshold')}</label>
                                                    <input type="number" step="0.05" min="0" max="1"
                                                        value={config.xtcThreshold}
                                                        onChange={(e) => handleChange('xtcThreshold', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.xtc.probability')}</label>
                                                    <input type="number" step="0.1" min="0" max="1"
                                                        value={config.xtcProbability}
                                                        onChange={(e) => handleChange('xtcProbability', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Mirostat Settings */}
                                        <div className="space-y-3 p-3 rounded-lg bg-black/20 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-300">{t('sampler.mirostat')}</span>
                                                <span className="text-[10px] text-slate-500">{t('sampler.mirostat.desc')}</span>
                                            </div>
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.mirostat.mode')}</label>
                                                    <select
                                                        value={config.mirostatMode}
                                                        onChange={(e) => handleChange('mirostatMode', parseInt(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    >
                                                        <option value={0}>Off</option>
                                                        <option value={1}>v1</option>
                                                        <option value={2}>v2</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.mirostat.tau')}</label>
                                                    <input type="number" step="0.5" min="1" max="10"
                                                        value={config.mirostatTau}
                                                        onChange={(e) => handleChange('mirostatTau', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] text-slate-500">{t('sampler.mirostat.eta')}</label>
                                                    <input type="number" step="0.05" min="0" max="1"
                                                        value={config.mirostatEta}
                                                        onChange={(e) => handleChange('mirostatEta', parseFloat(e.target.value))}
                                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Dynamic Temperature */}
                                        <div className="space-y-3 p-3 rounded-lg bg-black/20 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-300">{t('sampler.dynatemp')}</span>
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox"
                                                        checked={config.dynatemp}
                                                        onChange={(e) => handleChange('dynatemp', e.target.checked)}
                                                        className="sr-only"
                                                    />
                                                    <div className={`w-10 h-5 rounded-full transition-colors ${config.dynatemp ? 'bg-purple-500' : 'bg-gray-700'}`}>
                                                        <div className={`w-4 h-4 rounded-full bg-white shadow-md transform transition-transform mt-0.5 ${config.dynatemp ? 'translate-x-5 ml-0.5' : 'translate-x-0.5'}`} />
                                                    </div>
                                                </label>
                                            </div>
                                            {config.dynatemp && (
                                                <div className="grid grid-cols-3 gap-3 animate-in fade-in duration-200">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] text-slate-500">{t('sampler.dynatemp.min')}</label>
                                                        <input type="number" step="0.1" min="0" max="2"
                                                            value={config.minTemp}
                                                            onChange={(e) => handleChange('minTemp', parseFloat(e.target.value))}
                                                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] text-slate-500">{t('sampler.dynatemp.max')}</label>
                                                        <input type="number" step="0.1" min="0" max="3"
                                                            value={config.maxTemp}
                                                            onChange={(e) => handleChange('maxTemp', parseFloat(e.target.value))}
                                                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                        />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] text-slate-500">{t('sampler.dynatemp.exponent')}</label>
                                                        <input type="number" step="0.1" min="0.5" max="2"
                                                            value={config.dynatempExponent}
                                                            onChange={(e) => handleChange('dynatempExponent', parseFloat(e.target.value))}
                                                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-purple-500/40"
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Thinking Budget - Only in Custom mode */}
                                        <div className="space-y-3 p-3 rounded-lg bg-black/20 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                                                    <Cpu size={14} className="text-blue-400" /> {t('param.thinking')}
                                                </span>
                                                <span className="text-xs font-mono text-blue-300">
                                                    {config.thinkingBudget === 0 ? 'Disabled' : `${config.thinkingBudget} tok`}
                                                </span>
                                            </div>
                                            <input
                                                type="range" min="0" max="16384" step="1024"
                                                value={config.thinkingBudget}
                                                onChange={(e) => handleChange('thinkingBudget', parseInt(e.target.value))}
                                                className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                                            />
                                            <p className="text-[10px] text-slate-500">Enable Chain-of-Thought reasoning for complex logic. 0 = Disabled.</p>
                                        </div>
                                    </div>
                                )}

                                <div className="pt-2">
                                    <details className="group marker:content-none">
                                        <summary className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer hover:text-slate-300 transition-colors select-none py-2">
                                            <ChevronDown size={14} className="group-open:rotate-180 transition-transform duration-200 text-slate-600" />
                                            {t('param.advanced')}
                                            <div className="h-[1px] flex-1 bg-white/5 ml-2"></div>
                                        </summary>

                                        <div className="pt-4 space-y-5 animate-in slide-in-from-top-2 duration-200 pl-1">
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <label className="text-xs font-semibold text-gray-400 flex items-center gap-2">
                                                        <BrainCircuit size={14} /> {t('param.temperature')}
                                                    </label>
                                                    <span className="text-xs font-mono text-slate-500 bg-black/30 px-1.5 py-0.5 rounded">{config.temperature}</span>
                                                </div>
                                                <input
                                                    type="range" min="0" max="2" step="0.05"
                                                    value={config.temperature}
                                                    onChange={(e) => handleChange('temperature', parseFloat(e.target.value))}
                                                    className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-slate-400"
                                                />
                                            </div>

                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <label className="text-xs font-semibold text-gray-400 flex items-center gap-2">
                                                        <AlignLeft size={14} /> {t('param.maxTokens')}
                                                    </label>
                                                    <span className="text-xs font-mono text-emerald-500/80 bg-emerald-500/10 px-1.5 py-0.5 rounded">{config.maxOutputTokens}</span>
                                                </div>
                                                <input
                                                    type="range" min="100" max="8192" step="100"
                                                    value={config.maxOutputTokens}
                                                    onChange={(e) => handleChange('maxOutputTokens', parseInt(e.target.value))}
                                                    className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                                />
                                            </div>
                                        </div>
                                    </details>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Top K</label>
                                    <input
                                        type="number" value={config.topK}
                                        onChange={(e) => handleChange('topK', parseInt(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Top P</label>
                                    <input
                                        type="number" step="0.01" value={config.topP}
                                        onChange={(e) => handleChange('topP', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Presence Penalty</label>
                                    <input
                                        type="number" step="0.1" value={config.presencePenalty}
                                        onChange={(e) => handleChange('presencePenalty', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Frequency Penalty</label>
                                    <input
                                        type="number" step="0.1" value={config.frequencyPenalty}
                                        onChange={(e) => handleChange('frequencyPenalty', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Repetition Penalty</label>
                                    <input
                                        type="number" step="0.01" value={config.repetitionPenalty}
                                        onChange={(e) => handleChange('repetitionPenalty', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Min P</label>
                                    <input
                                        type="number" step="0.01" value={config.minP}
                                        onChange={(e) => handleChange('minP', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Top A</label>
                                    <input
                                        type="number" step="0.01" value={config.topA}
                                        onChange={(e) => handleChange('topA', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Typical P</label>
                                    <input
                                        type="number" step="0.01" value={config.typicalP}
                                        onChange={(e) => handleChange('typicalP', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">TFS</label>
                                    <input
                                        type="number" step="0.01" value={config.tfs}
                                        onChange={(e) => handleChange('tfs', parseFloat(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-semibold text-gray-400 uppercase">Rep Pen Range</label>
                                    <input
                                        type="number" step="1" value={config.repPenRange}
                                        onChange={(e) => handleChange('repPenRange', parseInt(e.target.value))}
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm text-center outline-none focus:border-slate-500/40"
                                    />
                                </div>
                            </div>

                            <div className="space-y-4 pt-4 border-t border-white/5">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                                    <div>
                                        <BufferedInput
                                            label={
                                                <span className="flex items-center gap-2">
                                                    <Dna size={12} /> {t('param.seed')}
                                                </span>
                                            }
                                            type="number"
                                            placeholder="-1 (Random)"
                                            value={config.seed === -1 ? '' : config.seed}
                                            onSave={(val) => handleChange('seed', (val === '' || isNaN(Number(val))) ? -1 : parseInt(String(val)))}
                                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-slate-500/40"
                                        />
                                    </div>
                                    <div>
                                        <BufferedInput
                                            label={
                                                <span className="flex items-center gap-2">
                                                    <Octagon size={12} /> {t('param.stopSequences')}
                                                </span>
                                            }
                                            value={config.stopSequences.join(', ')}
                                            onSave={(val) => {
                                                const split = String(val).split(',').map(s => s.trim()).filter(s => s.length > 0);
                                                handleChange('stopSequences', split);
                                            }}
                                            className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-sm outline-none focus:border-slate-500/40"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* --- STORY TAB --- */}
                    {activeTab === 'story' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <BufferedTextArea
                                label={
                                    <>
                                        <span className="flex items-center gap-2">
                                            <BookOpen size={14} /> Scenario
                                        </span>
                                        <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                                            Current situation, environment, or plot constraints.
                                        </span>
                                    </>
                                }
                                value={config.scenario}
                                onSave={(val) => handleChange('scenario', val)}
                                placeholder="e.g. In a high school classroom during a thunderstorm..."
                                className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-slate-300 focus:outline-none focus:border-slate-500/40 transition-all resize-none font-sans"
                            />

                            <div className="space-y-3 mt-6 p-4 rounded-xl bg-orange-900/10 border border-orange-500/10">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-semibold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                                        <PenTool size={14} /> Author's Note / Depth Prompt
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-gray-500 uppercase">Depth</span>
                                        <input
                                            type="number" min="0" max="10"
                                            value={config.authorsNoteDepth}
                                            onChange={(e) => handleChange('authorsNoteDepth', parseInt(e.target.value))}
                                            className="w-12 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs text-center text-white"
                                        />
                                    </div>
                                </div>
                                <BufferedTextArea
                                    value={config.authorsNote}
                                    onSave={(val) => handleChange('authorsNote', val)}
                                    placeholder="[System Note: Write using vivid sensory details. The character is secretly afraid.]"
                                    className="w-full h-32 bg-transparent border-0 p-0 text-sm text-gray-300 focus:ring-0 placeholder-gray-600 resize-none font-mono"
                                />
                            </div>
                        </div>
                    )}

                    {/* --- LOREBOOK TAB (NEW) --- */}
                    {activeTab === 'lorebook' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h3 className="text-lg font-bold text-white">World Info</h3>
                                    <p className="text-xs text-gray-500">Dynamic context injected when keywords are triggered.</p>
                                </div>
                                <button onClick={addLorebookEntry} className="flex items-center gap-2 bg-slate-500/10 hover:bg-slate-500/20 text-slate-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-slate-500/20">
                                    <Plus size={16} /> Add Entry
                                </button>
                            </div>

                            <div className="space-y-4">
                                {config.lorebook.length === 0 && (
                                    <div className="text-center py-10 border border-dashed border-white/10 rounded-xl text-gray-600 text-sm">
                                        No lorebook entries. Click "Add Entry" to create one.
                                    </div>
                                )}

                                {config.lorebook.map((entry) => (
                                    <div key={entry.id} className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 group hover:border-white/20 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => updateLorebookEntry(entry.id, 'enabled', !entry.enabled)} className="text-gray-400 hover:text-white">
                                                {entry.enabled ? <ToggleRight size={24} className="text-green-400" /> : <ToggleLeft size={24} />}
                                            </button>
                                            <input
                                                type="text"
                                                placeholder="Keywords (comma separated)"
                                                value={entry.keys.join(', ')}
                                                onChange={(e) => updateLorebookEntry(entry.id, 'keys', e.target.value)}
                                                className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:border-slate-500/40 outline-none"
                                            />
                                            <button onClick={() => deleteLorebookEntry(entry.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                        <textarea
                                            placeholder="Context to inject..."
                                            value={entry.content}
                                            onChange={(e) => updateLorebookEntry(entry.id, 'content', e.target.value)}
                                            className="w-full h-24 bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-slate-500/40 resize-none font-sans"
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* --- CHARACTER PROMPTS TAB --- */}
                    {activeTab === 'character' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <BufferedTextArea
                                label={
                                    <span className="flex items-center gap-2 text-red-400">
                                        <Shield size={14} /> Main Prompt Override
                                    </span>
                                }
                                value={config.systemPromptOverride}
                                onSave={(val) => handleChange('systemPromptOverride', val)}
                                placeholder="Enter a full replacement for the character card description..."
                                className="w-full h-40 bg-black/30 border border-red-500/20 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-red-500/50 resize-none"
                            />

                            <BufferedTextArea
                                label={
                                    <>
                                        <span className="flex items-center gap-2">
                                            <MessageSquare size={14} /> Example Dialogue
                                        </span>
                                        <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                                            Crucial for defining the character's speech pattern.
                                        </span>
                                    </>
                                }
                                value={config.exampleDialogue}
                                onSave={(val) => handleChange('exampleDialogue', val)}
                                placeholder={`<START>\n{{user}}: Hello\n{{char}}: *smirks* Well look who it is.`}
                                className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-slate-500/40 resize-none"
                            />

                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                                    <List size={14} /> Prompt Ordering
                                </label>
                                <select
                                    value={config.promptOrder}
                                    onChange={(e) => handleChange('promptOrder', e.target.value)}
                                    className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-gray-300 focus:outline-none focus:border-slate-500/40"
                                >
                                    <option value="default">Default (Char → Examples → User → Scenario)</option>
                                    <option value="style_first">Style First (Note → Char → Scenario)</option>
                                    <option value="scenario_last">Scenario Last (Char → Note → Scenario)</option>
                                </select>
                            </div>
                        </div>
                    )}

                    {/* --- PERSONA TAB --- */}
                    {activeTab === 'persona' && (
                        <PersonaTab config={config} onConfigChange={onConfigChange} handleChange={handleChange} />
                    )}

                    {/* --- FORMATTING TAB (NEW) --- */}
                    {activeTab === 'formatting' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <h3 className="text-lg font-bold text-white mb-4">{t('formatting.title')}</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <BufferedInput
                                    label={t('formatting.userPrefix')}
                                    value={config.userPrefix}
                                    onSave={(val) => handleChange('userPrefix', val)}
                                    className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-slate-500/40 outline-none"
                                />
                                <BufferedInput
                                    label={t('formatting.modelPrefix')}
                                    value={config.modelPrefix}
                                    onSave={(val) => handleChange('modelPrefix', val)}
                                    className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-slate-500/40 outline-none"
                                />
                            </div>
                            <BufferedInput
                                label={
                                    <>
                                        {t('formatting.contextTemplate')}
                                        <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                                            {t('formatting.contextTemplateDesc')}
                                        </span>
                                    </>
                                }
                                value={config.contextTemplate}
                                onSave={(val) => handleChange('contextTemplate', val)}
                                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-slate-500/40 outline-none"
                            />
                        </div>
                    )}

                    {/* --- INTERFACE TAB --- */}
                    {activeTab === 'interface' && (
                        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <div className="flex justify-between">
                                        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Font Size</label>
                                        <span className="text-xs text-gray-400">{config.fontSize}px</span>
                                    </div>
                                    <input
                                        type="range" min="12" max="24"
                                        value={config.fontSize}
                                        onChange={(e) => handleChange('fontSize', parseInt(e.target.value))}
                                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                                    />
                                </div>

                                <div className="space-y-3">
                                    <div className="flex justify-between">
                                        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Background Blur</label>
                                        <span className="text-xs text-gray-400">{config.backgroundBlur}px</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="20"
                                        value={config.backgroundBlur}
                                        onChange={(e) => handleChange('backgroundBlur', parseInt(e.target.value))}
                                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                                    />
                                </div>

                                {/* Auto-restore Chat Toggle */}
                                <div className="pt-4 border-t border-white/5">
                                    <InterfaceAutoRestoreToggle />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SettingsPanel;
