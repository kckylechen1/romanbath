/**
 * Chat Service - Handles chat persistence using SillyTavern's backend API
 * Chats are stored as JSONL files on the server
 */

import { Message, Role } from '../types';

// Get CSRF token (reuse from sillyTavernService)
let csrfToken: string | null = null;

const getCsrfToken = async (forceRefresh: boolean = false): Promise<string | null> => {
    if (csrfToken && !forceRefresh) return csrfToken;
    try {
        const response = await fetch('/csrf-token', { credentials: 'include' });
        if (!response.ok) return null;
        const data = await response.json();
        csrfToken = data.token;
        return csrfToken;
    } catch (error) {
        console.error("Error fetching CSRF token:", error);
        return null;
    }
};

const getHeaders = async (): Promise<HeadersInit> => {
    const token = await getCsrfToken();
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) headers['X-CSRF-Token'] = token;
    return headers;
};

// SillyTavern chat message format
export interface STChatMessage {
    name: string;
    is_user: boolean;
    is_system?: boolean;
    send_date: string;
    mes: string;
    extra?: Record<string, any>;
}

// Chat metadata (first line of JSONL)
export interface STChatMetadata {
    user_name: string;
    character_name: string;
    create_date: string;
    chat_metadata?: {
        integrity?: string;
        [key: string]: any;
    };
}

// Chat info returned by search/recent endpoints
export interface ChatInfo {
    file_name: string;
    file_id?: string;
    file_size: string;
    message_count?: number;
    chat_items?: number;
    mes?: string;
    last_mes?: number;
    preview_message?: string;
    avatar?: string;
}

// Convert our Message format to SillyTavern format
const toSTMessage = (msg: Message, userName: string, characterName: string): STChatMessage => {
    const isUser = msg.role === Role.User;
    return {
        name: isUser ? userName : characterName,
        is_user: isUser,
        is_system: false,
        send_date: new Date(msg.timestamp).toLocaleString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }),
        mes: msg.content,
        extra: {}
    };
};

// Convert SillyTavern format to our Message format
const fromSTMessage = (stMsg: STChatMessage, index: number): Message => {
    return {
        id: `msg-${index}-${Date.now()}`,
        role: stMsg.is_user ? Role.User : Role.Model,
        content: stMsg.mes,
        timestamp: new Date(stMsg.send_date).getTime() || Date.now()
    };
};

// Generate a chat filename
const generateChatFileName = (characterName: string): string => {
    const now = new Date();
    const dateStr = now.toISOString()
        .replace('T', ' @')
        .replace(/:/g, 'h')
        .replace(/\./g, 'm')
        .slice(0, -1) + 'ms';
    return `${characterName} - ${dateStr.replace(' @', '@').replace(/h/g, 'h ').replace('m ', 'm ').replace('ms', 'ms')}`;
};

// Format date for chat filename (matching SillyTavern format)
const formatDateForFilename = (characterName: string): string => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();

    return `${characterName} - ${year}-${month}-${day} @${hours}h ${minutes}m ${seconds}s ${ms}ms`;
};

/**
 * Save a chat to the server
 */
export const saveChat = async (
    characterId: string,  // avatar filename like "Seraphina.png"
    chatFileName: string, // filename without .jsonl
    messages: Message[],
    userName: string,
    characterName: string
): Promise<boolean> => {
    try {
        const headers = await getHeaders();

        // Build chat data array
        const chatData: (STChatMetadata | STChatMessage)[] = [];

        // First line: metadata
        chatData.push({
            user_name: userName,
            character_name: characterName,
            create_date: new Date().toISOString().replace('T', '@').slice(0, 19).replace(/:/g, 'h').replace('h', 'h') + 's',
            chat_metadata: {
                integrity: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
            }
        });

        // Add messages
        messages.forEach(msg => {
            chatData.push(toSTMessage(msg, userName, characterName));
        });

        const response = await fetch('/api/chats/save', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                avatar_url: characterId,
                file_name: chatFileName,
                chat: chatData
            })
        });

        if (!response.ok) {
            console.error('Failed to save chat:', response.statusText);
            return false;
        }

        const result = await response.json();
        return result.result === 'ok';
    } catch (error) {
        console.error('Error saving chat:', error);
        return false;
    }
};

/**
 * Load a chat from the server
 */
export const loadChat = async (
    characterId: string,
    chatFileName: string
): Promise<{ messages: Message[], metadata: STChatMetadata | null }> => {
    try {
        const headers = await getHeaders();

        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                avatar_url: characterId,
                file_name: chatFileName
            })
        });

        if (!response.ok) {
            console.error('Failed to load chat:', response.statusText);
            return { messages: [], metadata: null };
        }

        const data: (STChatMetadata | STChatMessage)[] = await response.json();

        if (!data || data.length === 0) {
            return { messages: [], metadata: null };
        }

        // First entry is metadata
        const metadata = data[0] as STChatMetadata;

        // Rest are messages
        const messages = data.slice(1).map((msg, index) =>
            fromSTMessage(msg as STChatMessage, index)
        );

        return { messages, metadata };
    } catch (error) {
        console.error('Error loading chat:', error);
        return { messages: [], metadata: null };
    }
};

/**
 * Get list of chats for a character
 */
export const getChatList = async (characterId: string): Promise<ChatInfo[]> => {
    try {
        const headers = await getHeaders();

        const response = await fetch('/api/chats/search', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                avatar_url: characterId,
                query: '' // Empty query returns all chats
            })
        });

        if (!response.ok) {
            console.error('Failed to get chat list:', response.statusText);
            return [];
        }

        const chats: ChatInfo[] = await response.json();
        return chats;
    } catch (error) {
        console.error('Error getting chat list:', error);
        return [];
    }
};

/**
 * Get recent chats across all characters
 */
export const getRecentChats = async (max: number = 20): Promise<ChatInfo[]> => {
    try {
        const headers = await getHeaders();

        const response = await fetch('/api/chats/recent', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({ max })
        });

        if (!response.ok) {
            console.error('Failed to get recent chats:', response.statusText);
            return [];
        }

        const chats: ChatInfo[] = await response.json();
        return chats;
    } catch (error) {
        console.error('Error getting recent chats:', error);
        return [];
    }
};

/**
 * Delete a chat
 */
export const deleteChat = async (characterId: string, chatFileName: string): Promise<boolean> => {
    try {
        const headers = await getHeaders();

        const response = await fetch('/api/chats/delete', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                avatar_url: characterId,
                chatfile: chatFileName
            })
        });

        return response.ok;
    } catch (error) {
        console.error('Error deleting chat:', error);
        return false;
    }
};

/**
 * Rename a chat
 */
export const renameChat = async (
    characterId: string,
    originalFileName: string,
    newFileName: string
): Promise<boolean> => {
    try {
        const headers = await getHeaders();

        const response = await fetch('/api/chats/rename', {
            method: 'POST',
            headers,
            credentials: 'include',
            body: JSON.stringify({
                avatar_url: characterId,
                original_file: originalFileName,
                renamed_file: newFileName
            })
        });

        return response.ok;
    } catch (error) {
        console.error('Error renaming chat:', error);
        return false;
    }
};

/**
 * Create a new chat file name
 */
export const createNewChatFileName = (characterName: string): string => {
    return formatDateForFilename(characterName);
};

/**
 * Helper to get chat file name without extension
 */
export const stripChatExtension = (fileName: string): string => {
    return fileName.replace('.jsonl', '');
};
