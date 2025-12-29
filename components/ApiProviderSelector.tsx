import React, { useState, useRef, useEffect } from 'react';
import {
    ChevronDown,
    Check,
    Ghost,
    HardDrive,
    Terminal,
    Cpu,
    Server,
    AlertCircle,
    Loader2,
} from 'lucide-react';

// Custom Brand Icons
const OpenAIIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.8956zm16.5963 3.8558L13.1038 8.364l2.0201-1.1638a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.4046-.6813zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" fill="#10a37f" />
    </svg>
);

const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

const PerplexityIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L4 6v12l8 4 8-4V6l-8-4z" stroke="#20b2aa" strokeWidth="2" fill="none" />
        <path d="M12 6v12M8 8l4 4 4-4M8 16l4-4 4 4" stroke="#20b2aa" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

const OpenRouterIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="#6366f1" strokeWidth="2" fill="none" />
        <path d="M8 12h8M12 8v8" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="12" r="3" fill="#6366f1" />
    </svg>
);

const OllamaIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="12" rx="8" ry="10" stroke="#ffffff" strokeWidth="2" fill="none" />
        <circle cx="9" cy="10" r="1.5" fill="#ffffff" />
        <circle cx="15" cy="10" r="1.5" fill="#ffffff" />
        <path d="M9 15c1.5 1.5 4.5 1.5 6 0" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
);

export type ApiProviderId = 'local' | 'openai' | 'koboldhorde' | 'kobold' | 'textgenerationwebui' | 'openrouter' | 'google' | 'ollama' | 'perplexity' | 'custom';

export interface ApiProvider {
    id: ApiProviderId;
    name: string;
    icon: React.ReactNode;
    defaultUrl: string;
    description: string;
    requiresKey: boolean;
    modelsUrl?: string; // Optional: specific endpoint for models if different
    docsUrl?: string;
}

export const PROVIDERS: ApiProvider[] = [
    {
        id: 'local',
        name: '本地反代 (Local Proxy)',
        icon: <Cpu size={18} className="text-emerald-400" />,
        defaultUrl: 'http://localhost:8045/v1',
        description: 'OpenAI 兼容本地代理',
        requiresKey: true,
        docsUrl: ''
    },
    {
        id: 'openai',
        name: 'OpenAI',
        icon: <OpenAIIcon />,
        defaultUrl: 'https://api.openai.com/v1',
        description: 'GPT-4o, o1 Reasoning Models',
        requiresKey: true,
        docsUrl: 'https://platform.openai.com/docs/api-reference'
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        icon: <OpenRouterIcon />,
        defaultUrl: 'https://openrouter.ai/api/v1',
        description: 'Claude, GPT, Gemini, Llama & more',
        requiresKey: true,
        docsUrl: 'https://openrouter.ai/docs'
    },
    {
        id: 'google',
        name: 'Google Gemini',
        icon: <GoogleIcon />,
        defaultUrl: 'https://generativelanguage.googleapis.com/v1beta',
        description: 'Gemini 2.5 Pro/Flash',
        requiresKey: true,
        docsUrl: 'https://ai.google.dev/docs'
    },
    {
        id: 'perplexity',
        name: 'Perplexity',
        icon: <PerplexityIcon />,
        defaultUrl: 'https://api.perplexity.ai',
        description: 'Sonar with real-time search',
        requiresKey: true,
        docsUrl: 'https://docs.perplexity.ai'
    },
    {
        id: 'koboldhorde',
        name: 'KoboldAI Horde',
        icon: <Ghost size={18} className="text-purple-400" />,
        defaultUrl: 'https://aihorde.net/api',
        description: 'Free crowdsourced cluster',
        requiresKey: true,
        docsUrl: 'https://aihorde.net/api'
    },
    {
        id: 'ollama',
        name: 'Ollama',
        icon: <OllamaIcon />,
        defaultUrl: 'http://127.0.0.1:11434',
        description: 'Local open-source models',
        requiresKey: false,
        docsUrl: 'https://ollama.com/library'
    },
    {
        id: 'textgenerationwebui',
        name: 'TextGen WebUI (Ooba)',
        icon: <Terminal size={18} className="text-orange-400" />,
        defaultUrl: 'http://127.0.0.1:5000',
        description: 'Local Oobabooga instance',
        requiresKey: false,
        docsUrl: 'https://github.com/oobabooga/text-generation-webui'
    },
    {
        id: 'kobold',
        name: 'KoboldCpp / United',
        icon: <HardDrive size={18} className="text-yellow-400" />,
        defaultUrl: 'http://127.0.0.1:5001',
        description: 'Local KoboldCpp instance',
        requiresKey: false,
        docsUrl: 'https://github.com/LostRuins/koboldcpp'
    },
    {
        id: 'custom',
        name: 'Custom / Other',
        icon: <Server size={18} className="text-gray-400" />,
        defaultUrl: '',
        description: 'Manual configuration',
        requiresKey: false
    }
];

interface ApiProviderSelectorProps {
    selectedId: string;
    onSelect: (provider: ApiProvider) => void;
    className?: string;
    isLoading?: boolean;
    error?: boolean;
}

const ApiProviderSelector: React.FC<ApiProviderSelectorProps> = ({ selectedId, onSelect, className = '', isLoading = false, error = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedProvider = PROVIDERS.find(p => p.id === selectedId) || PROVIDERS.find(p => p.id === 'custom')!;

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (provider: ApiProvider) => {
        onSelect(provider);
        setIsOpen(false);
    };

    return (
        <div className={`relative ${className}`} ref={dropdownRef}>
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider mb-2 block">
                API Provider
            </label>

            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full flex items-center justify-between bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-slate-100 transition-all duration-200 hover:bg-white/5 hover:border-slate-500/30
                    ${isOpen ? 'border-slate-500 ring-1 ring-slate-500/30' : ''}
                    ${error ? 'border-red-500/50' : ''}
                `}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 rounded-lg bg-white/5 border border-white/10 shrink-0">
                        {isLoading ? <Loader2 size={18} className="animate-spin text-slate-400" /> : selectedProvider.icon}
                    </div>
                    <div className="flex flex-col items-start min-w-0">
                        <span className="font-semibold truncate w-full text-left">{selectedProvider.name}</span>
                        <span className="text-[10px] text-slate-500 uppercase tracking-tight truncate max-w-[180px] text-left font-mono">
                            {selectedProvider.description}
                        </span>
                    </div>
                </div>
                {error ? (
                    <AlertCircle size={16} className="text-red-500 shrink-0" />
                ) : (
                    <ChevronDown size={16} className={`text-slate-500 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                )}
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-[#09090b] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 origin-top">
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar p-1">
                        {PROVIDERS.map((provider) => (
                            <button
                                key={provider.id}
                                onClick={() => handleSelect(provider)}
                                className={`w-full flex items-center gap-3 p-2.5 rounded-lg transition-colors group
                                    ${selectedId === provider.id
                                        ? 'bg-slate-500/10 text-slate-100'
                                        : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                                    }
                                `}
                            >
                                <div className={`p-1.5 rounded-lg border transition-colors ${selectedId === provider.id ? 'bg-slate-500/10 border-slate-500/30' : 'bg-white/5 border-white/5 group-hover:border-white/10'}`}>
                                    {provider.icon}
                                </div>
                                <div className="flex flex-col items-start flex-1 min-w-0">
                                    <span className="text-sm font-semibold truncate w-full text-left">{provider.name}</span>
                                    <span className={`text-[10px] truncate w-full text-left uppercase font-mono tracking-tighter ${selectedId === provider.id ? 'text-slate-400' : 'text-slate-600'}`}>
                                        {provider.description}
                                    </span>
                                </div>
                                {selectedId === provider.id && (
                                    <Check size={16} className="text-slate-400 shrink-0" />
                                )}
                            </button>
                        ))}
                    </div>
                    <div className="p-2 bg-black/20 border-t border-white/5 text-[10px] text-gray-500 text-center">
                        Select a provider to auto-configure connection settings.
                    </div>
                </div>
            )}
        </div>
    );
};

export default ApiProviderSelector;
