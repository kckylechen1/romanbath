/**
 * Bookmark Service - Save and restore chat checkpoints
 * Bookmarks are stored in localStorage
 */

import { Message } from '../types';

export interface ChatBookmark {
  id: string;
  name: string;
  characterId: string;
  chatFileName: string;
  messageCount: number;
  messages: Message[];
  createdAt: number;
  description?: string;
  previewText?: string; // First 100 chars of last message
}

const BOOKMARKS_KEY = 'romanbath_bookmarks';

/**
 * Get all bookmarks for a specific character
 */
export const getBookmarks = (characterId: string): ChatBookmark[] => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return [];

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    return allBookmarks
      .filter(b => b.characterId === characterId)
      .sort((a, b) => b.createdAt - a.createdAt); // Most recent first
  } catch (error) {
    console.error('Error loading bookmarks:', error);
    return [];
  }
};

/**
 * Get all bookmarks across all characters
 */
export const getAllBookmarks = (): ChatBookmark[] => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return [];

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    return allBookmarks.sort((a, b) => b.createdAt - a.createdAt);
  } catch (error) {
    console.error('Error loading all bookmarks:', error);
    return [];
  }
};

/**
 * Save a new bookmark
 */
export const saveBookmark = (bookmark: ChatBookmark): void => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    const allBookmarks: ChatBookmark[] = stored ? JSON.parse(stored) : [];

    // Remove existing bookmark with same ID (for updates)
    const filtered = allBookmarks.filter(b => b.id !== bookmark.id);
    filtered.push(bookmark);

    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error saving bookmark:', error);
    throw new Error('Failed to save bookmark', { cause: error });
  }
};

/**
 * Delete a bookmark by ID
 */
export const deleteBookmark = (bookmarkId: string): void => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return;

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    const filtered = allBookmarks.filter(b => b.id !== bookmarkId);

    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error deleting bookmark:', error);
    throw new Error('Failed to delete bookmark', { cause: error });
  }
};

/**
 * Rename a bookmark
 */
export const renameBookmark = (bookmarkId: string, newName: string): void => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return;

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    const updated = allBookmarks.map(b =>
      b.id === bookmarkId ? { ...b, name: newName } : b
    );

    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error('Error renaming bookmark:', error);
    throw new Error('Failed to rename bookmark', { cause: error });
  }
};

/**
 * Create a new bookmark from current chat state
 */
export const createBookmark = (
  characterId: string,
  chatFileName: string,
  messages: Message[],
  name?: string
): ChatBookmark => {
  const lastMessage = messages[messages.length - 1];
  const previewText = lastMessage
    ? lastMessage.content.slice(0, 100) + (lastMessage.content.length > 100 ? '...' : '')
    : '';

  return {
    id: `bookmark-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: name || `Checkpoint at ${new Date().toLocaleString()}`,
    characterId,
    chatFileName,
    messageCount: messages.length,
    messages: JSON.parse(JSON.stringify(messages)), // Deep copy
    createdAt: Date.now(),
    previewText
  };
};

/**
 * Get bookmark count for a character
 */
export const getBookmarkCount = (characterId: string): number => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return 0;

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    return allBookmarks.filter(b => b.characterId === characterId).length;
  } catch {
    return 0;
  }
};

/**
 * Clear all bookmarks for a character
 */
export const clearCharacterBookmarks = (characterId: string): void => {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    if (!stored) return;

    const allBookmarks: ChatBookmark[] = JSON.parse(stored);
    const filtered = allBookmarks.filter(b => b.characterId !== characterId);

    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error clearing bookmarks:', error);
  }
};

/**
 * Export all bookmarks as JSON (for backup)
 */
export const exportBookmarks = (): string => {
  const stored = localStorage.getItem(BOOKMARKS_KEY);
  return stored || '[]';
};

/**
 * Import bookmarks from JSON (restore from backup)
 */
export const importBookmarks = (jsonString: string, merge: boolean = true): number => {
  try {
    const imported: ChatBookmark[] = JSON.parse(jsonString);

    if (!Array.isArray(imported)) {
      throw new Error('Invalid bookmark data');
    }

    if (merge) {
      const stored = localStorage.getItem(BOOKMARKS_KEY);
      const existing: ChatBookmark[] = stored ? JSON.parse(stored) : [];

      // Merge, preferring imported versions for duplicates
      const merged = [
        ...imported,
        ...existing.filter(b => !imported.some(i => i.id === b.id))
      ];

      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(merged));
      return imported.length;
    } else {
      localStorage.setItem(BOOKMARKS_KEY, jsonString);
      return imported.length;
    }
  } catch (error) {
    console.error('Error importing bookmarks:', error);
    throw new Error('Failed to import bookmarks', { cause: error });
  }
};
