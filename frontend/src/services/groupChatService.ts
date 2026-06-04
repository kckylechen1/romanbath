/**
 * Group Chat Service
 * Manages group chats with multiple characters
 */

import { GroupChat, Character } from '../types';

const STORAGE_KEY = 'romanbath_group_chats';

/**
 * Get all group chats from localStorage
 */
export const getGroupChats = (): GroupChat[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Error loading group chats:', error);
    return [];
  }
};

/**
 * Save group chats to localStorage
 */
const saveGroupChats = (groups: GroupChat[]): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
  } catch (error) {
    console.error('Error saving group chats:', error);
  }
};

/**
 * Create a new group chat
 */
export const createGroupChat = (
  name: string,
  characterIds: string[],
  activationMode: GroupChat['activationMode'] = 'natural'
): GroupChat => {
  const now = Date.now();
  const group: GroupChat = {
    id: `group_${now}`,
    name,
    characterIds,
    activationMode,
    createdAt: now,
    updatedAt: now,
  };

  const groups = getGroupChats();
  groups.push(group);
  saveGroupChats(groups);

  return group;
};

/**
 * Update an existing group chat
 */
export const updateGroupChat = (
  id: string,
  updates: Partial<Omit<GroupChat, 'id' | 'createdAt'>>
): GroupChat | null => {
  const groups = getGroupChats();
  const index = groups.findIndex(g => g.id === id);

  if (index === -1) return null;

  groups[index] = {
    ...groups[index],
    ...updates,
    updatedAt: Date.now(),
  };

  saveGroupChats(groups);
  return groups[index];
};

/**
 * Delete a group chat
 */
export const deleteGroupChat = (id: string): boolean => {
  const groups = getGroupChats();
  const filtered = groups.filter(g => g.id !== id);

  if (filtered.length === groups.length) return false;

  saveGroupChats(filtered);
  return true;
};

/**
 * Get a single group chat by ID
 */
export const getGroupChat = (id: string): GroupChat | null => {
  const groups = getGroupChats();
  return groups.find(g => g.id === id) || null;
};

/**
 * Add a character to a group
 */
export const addCharacterToGroup = (groupId: string, characterId: string): boolean => {
  const group = getGroupChat(groupId);
  if (!group) return false;

  if (group.characterIds.includes(characterId)) return true; // Already in group

  updateGroupChat(groupId, {
    characterIds: [...group.characterIds, characterId],
  });

  return true;
};

/**
 * Remove a character from a group
 */
export const removeCharacterFromGroup = (groupId: string, characterId: string): boolean => {
  const group = getGroupChat(groupId);
  if (!group) return false;

  updateGroupChat(groupId, {
    characterIds: group.characterIds.filter(id => id !== characterId),
  });

  return true;
};

/**
 * Select the next character to speak based on activation mode
 */
export const selectNextCharacter = (
  group: GroupChat,
  characters: Character[],
  _lastMessage?: string
): Character | null => {
  const groupCharacters = characters.filter(c => group.characterIds.includes(c.id));

  if (groupCharacters.length === 0) return null;

  switch (group.activationMode) {
    case 'round-robin': {
      // Cycle through characters in order
      const lastIndex = group.lastActiveCharacterId
        ? groupCharacters.findIndex(c => c.id === group.lastActiveCharacterId)
        : -1;
      const nextIndex = (lastIndex + 1) % groupCharacters.length;
      return groupCharacters[nextIndex];
    }

    case 'random': {
      // Pick a random character (but not the same as last)
      if (groupCharacters.length === 1) return groupCharacters[0];

      const available = groupCharacters.filter(c => c.id !== group.lastActiveCharacterId);
      const randomIndex = Math.floor(Math.random() * available.length);
      return available[randomIndex];
    }

    case 'natural': {
      // Natural conversation flow - AI decides based on context
      // For now, use weighted random based on how long since they spoke
      // In future, could use AI to determine most relevant speaker
      if (groupCharacters.length === 1) return groupCharacters[0];

      // Prefer someone who hasn't spoken recently
      const available = groupCharacters.filter(c => c.id !== group.lastActiveCharacterId);
      if (available.length === 0) return groupCharacters[0];

      const randomIndex = Math.floor(Math.random() * available.length);
      return available[randomIndex];
    }

    default:
      return groupCharacters[0];
  }
};

/**
 * Build system prompt for group chat context
 */
export const buildGroupSystemPrompt = (
  activeCharacter: Character,
  allGroupCharacters: Character[],
  config: { scenario?: string; userName?: string; userDescription?: string }
): string => {
  let prompt = '';

  // Active character identity
  prompt += `You are ${activeCharacter.name}. You must stay completely in character at all times.\n\n`;

  // Character persona
  if (activeCharacter.systemInstruction) {
    prompt += activeCharacter.systemInstruction + '\n\n';
  }

  // Character description
  if (activeCharacter.description) {
    prompt += `[Your Character: ${activeCharacter.description}]\n\n`;
  }

  // Other characters in the group
  const otherCharacters = allGroupCharacters.filter(c => c.id !== activeCharacter.id);
  if (otherCharacters.length > 0) {
    prompt += '[Other characters present in this conversation:\n';
    otherCharacters.forEach(char => {
      prompt += `- ${char.name}: ${char.description || 'No description'}\n`;
    });
    prompt += ']\n\n';
  }

  // Scenario
  if (config.scenario) {
    prompt += `[Current Scenario: ${config.scenario}]\n\n`;
  }

  // User persona
  if (config.userName && config.userDescription) {
    prompt += `[The user (${config.userName}): ${config.userDescription}]\n\n`;
  }

  // Group chat instructions
  prompt += `IMPORTANT INSTRUCTIONS:
- You ARE ${activeCharacter.name}. Never break character.
- This is a GROUP CONVERSATION with multiple characters and the user.
- Only respond as ${activeCharacter.name} - do not speak for other characters.
- React naturally to what other characters say.
- Use *asterisks* for actions and descriptions.
- Stay in character and engage with the scene.`;

  return prompt;
};
