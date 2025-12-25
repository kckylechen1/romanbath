/**
 * Chat Persistence Service
 * Handles saving and restoring chat state across browser sessions
 */

import { Message, ChatPersistenceState, AppSettings } from '../types';

const CHAT_STATE_KEY = 'etheria_chat_state';
const APP_SETTINGS_KEY = 'etheria_app_settings';

// Default app settings
export const DEFAULT_APP_SETTINGS: AppSettings = {
    autoRestoreChat: true,
    showPersonaSwitchNotification: true,
    activePersonaId: null,
    language: 'en',
};

// Save chat state for a character
export const saveChatState = (characterId: string, messages: Message[]): void => {
    try {
        const state: ChatPersistenceState = {
            characterId,
            messages,
            lastUpdated: Date.now(),
        };
        localStorage.setItem(CHAT_STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Failed to save chat state:', e);
    }
};

// Load saved chat state
export const loadChatState = (): ChatPersistenceState | null => {
    try {
        const stored = localStorage.getItem(CHAT_STATE_KEY);
        if (stored) {
            const state = JSON.parse(stored) as ChatPersistenceState;
            // Validate the state has required fields
            if (state.characterId && Array.isArray(state.messages)) {
                return state;
            }
        }
    } catch (e) {
        console.error('Failed to load chat state:', e);
    }
    return null;
};

// Clear saved chat state
export const clearChatState = (): void => {
    try {
        localStorage.removeItem(CHAT_STATE_KEY);
    } catch (e) {
        console.error('Failed to clear chat state:', e);
    }
};

// Check if there's a saved chat to restore
export const hasSavedChat = (): boolean => {
    return loadChatState() !== null;
};

// Get app settings
export const getAppSettings = (): AppSettings => {
    try {
        const stored = localStorage.getItem(APP_SETTINGS_KEY);
        if (stored) {
            return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(stored) };
        }
    } catch (e) {
        console.error('Failed to load app settings:', e);
    }
    return DEFAULT_APP_SETTINGS;
};

// Save app settings
export const saveAppSettings = (settings: Partial<AppSettings>): void => {
    try {
        const current = getAppSettings();
        const updated = { ...current, ...settings };
        localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(updated));
    } catch (e) {
        console.error('Failed to save app settings:', e);
    }
};

// Update a single setting
export const updateAppSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
): void => {
    saveAppSettings({ [key]: value });
};

// Get time since last chat update (for display purposes)
export const getTimeSinceLastChat = (): string | null => {
    const state = loadChatState();
    if (!state) return null;

    const diff = Date.now() - state.lastUpdated;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
};

// Auto-save debounce utility
let saveTimeout: NodeJS.Timeout | null = null;

export const debouncedSaveChatState = (characterId: string, messages: Message[], delay: number = 1000): void => {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
        saveChatState(characterId, messages);
        saveTimeout = null;
    }, delay);
};
