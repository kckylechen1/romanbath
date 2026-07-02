import { useState, useCallback, useEffect, useRef } from 'react';
import { Character } from '../types';
import type { CharacterFormData, GetCharactersOptions } from '../services/zeroclawService';
import {
  getCharacters,
  updateCharacter,
  createCharacter,
  deleteCharacter,
  ensurePairing,
} from '../services/zeroclawService';

const emptyCharacter: Character = {
  id: 'default',
  name: 'No characters',
  avatar: '',
  description: '',
  systemInstruction: '',
  firstMessage: '',
  backgroundImage: '',
};

export interface UseCharacterManagementReturn {
  characters: Character[];
  selectedCharacter: Character;
  setSelectedCharacter: React.Dispatch<React.SetStateAction<Character>>;
  refreshCharacters: () => Promise<void>;
  characterFilter: GetCharactersOptions;
  setCharacterFilter: (opts: GetCharactersOptions) => void;
  handleEditCharacter: (charId: string) => void;
  handleCreateCharacter: () => void;
  handleSaveCharacter: (data: CharacterFormData) => Promise<void>;
  handleDeleteCharacter: () => Promise<void>;
  showCharacterEditor: boolean;
  setShowCharacterEditor: React.Dispatch<React.SetStateAction<boolean>>;
  editingCharacterId: string | undefined;
}

export const useCharacterManagement = (): UseCharacterManagementReturn => {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState<Character>({
    id: 'default',
    name: 'Loading...',
    avatar: '',
    description: '',
    systemInstruction: '',
    firstMessage: '',
    backgroundImage: '',
  });
  const [showCharacterEditor, setShowCharacterEditor] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string | undefined>(undefined);
  // Active server-side filter for the character list. The list component
  // drives this through setCharacterFilter; we keep it here so other
  // surfaces (e.g. save-then-refresh) re-apply the same filter.
  const [characterFilter, setCharacterFilter] = useState<GetCharactersOptions>({});
  // Used by the initial mount load — we don't want the filter-changed
  // effect to clobber selection while the first load is still in flight.
  const initializedRef = useRef(false);

  const pickCharacter = useCallback((chars: Character[], prev: Character): Character => {
    if (chars.length === 0) return emptyCharacter;
    const match = chars.find((c) => c.id === prev.id || c.name === prev.name);
    return match ?? chars[0];
  }, []);

  const refreshCharacters = useCallback(async () => {
    const chars = await getCharacters(characterFilter);
    setCharacters(chars);
    setSelectedCharacter((prev) => pickCharacter(chars, prev));
  }, [pickCharacter, characterFilter]);

  // Re-fetch whenever the user types in the search box or toggles a tag.
  // Skips the very first render — the mount initializer below owns that.
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    let cancelled = false;
    (async () => {
      const chars = await getCharacters(characterFilter);
      if (cancelled) return;
      setCharacters(chars);
      setSelectedCharacter((prev) => pickCharacter(chars, prev));
    })();
    return () => {
      cancelled = true;
    };
  }, [characterFilter, pickCharacter]);

  const handleEditCharacter = (charId: string) => {
    setEditingCharacterId(charId);
    setShowCharacterEditor(true);
  };

  const handleCreateCharacter = () => {
    setEditingCharacterId(undefined);
    setShowCharacterEditor(true);
  };

  const handleSaveCharacter = async (data: CharacterFormData) => {
    if (editingCharacterId) {
      const result = await updateCharacter(editingCharacterId, data);
      if (!result.success) {
        throw new Error(result.error);
      }
    } else {
      const result = await createCharacter(data);
      if (!result.success) {
        throw new Error(result.error);
      }
    }
    await refreshCharacters();
    setShowCharacterEditor(false);
  };

  const handleDeleteCharacter = async () => {
    if (!editingCharacterId) return;
    const result = await deleteCharacter(editingCharacterId);
    if (!result.success) {
      throw new Error(result.error);
    }
    await refreshCharacters();
    setShowCharacterEditor(false);
  };

  // Initialize backend and characters on mount
  useEffect(() => {
    const initBackend = async () => {
      try {
        await ensurePairing();
      } catch (e) {
        console.warn('ZeroClaw pairing failed on init:', e);
      }

      const chars = await getCharacters(characterFilter);
      setCharacters(chars);
      setSelectedCharacter((prev) => pickCharacter(chars, prev));
    };
    initBackend();
    // We intentionally only run this once on mount — subsequent filter
    // changes go through the dedicated effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    characters,
    selectedCharacter,
    setSelectedCharacter,
    refreshCharacters,
    characterFilter,
    setCharacterFilter,
    handleEditCharacter,
    handleCreateCharacter,
    handleSaveCharacter,
    handleDeleteCharacter,
    showCharacterEditor,
    setShowCharacterEditor,
    editingCharacterId,
  };
};
