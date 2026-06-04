import { useState, useCallback, useEffect } from "react";
import { Character, CharacterFormData } from "../types";
import {
  getCharacters,
  updateCharacter,
  createCharacter,
  deleteCharacter,
  ensurePairing,
} from "../services/zeroclawService";

const emptyCharacter: Character = {
  id: "default",
  name: "No characters",
  avatar: "",
  description: "",
  systemInstruction: "",
  firstMessage: "",
  backgroundImage: "",
};

export interface UseCharacterManagementReturn {
  characters: Character[];
  selectedCharacter: Character;
  setSelectedCharacter: React.Dispatch<React.SetStateAction<Character>>;
  refreshCharacters: () => Promise<void>;
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
    id: "default",
    name: "Loading...",
    avatar: "",
    description: "",
    systemInstruction: "",
    firstMessage: "",
    backgroundImage: "",
  });
  const [showCharacterEditor, setShowCharacterEditor] = useState(false);
  const [editingCharacterId, setEditingCharacterId] = useState<string | undefined>(undefined);

  const pickCharacter = useCallback(
    (chars: Character[], prev: Character): Character => {
      if (chars.length === 0) return emptyCharacter;
      const match = chars.find((c) => c.id === prev.id || c.name === prev.name);
      return match ?? chars[0];
    },
    [],
  );

  const refreshCharacters = useCallback(async () => {
    const chars = await getCharacters();
    setCharacters(chars);
    setSelectedCharacter((prev) => pickCharacter(chars, prev));
  }, [pickCharacter]);

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
        console.warn("ZeroClaw pairing failed on init:", e);
      }

      const chars = await getCharacters();
      setCharacters(chars);
      setSelectedCharacter((prev) => pickCharacter(chars, prev));
    };
    initBackend();
  }, [pickCharacter]);

  return {
    characters,
    selectedCharacter,
    setSelectedCharacter,
    refreshCharacters,
    handleEditCharacter,
    handleCreateCharacter,
    handleSaveCharacter,
    handleDeleteCharacter,
    showCharacterEditor,
    setShowCharacterEditor,
    editingCharacterId,
  };
};
