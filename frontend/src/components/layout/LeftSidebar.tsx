import React from "react";
import { Character } from "../../types";
import CharacterList from "../CharacterList";
import { Flame, Minimize2, Maximize2 } from "lucide-react";
import { useLanguage } from "../../i18n";

interface LeftSidebarProps {
  leftSidebarOpen: boolean;
  setLeftSidebarOpen: (open: boolean) => void;
  characters: Character[];
  selectedCharacterId: string;
  setSelectedCharacter: (char: Character) => void;
  refreshCharacters: () => Promise<void>;
  handleEditCharacter: (charId: string) => void;
  handleCreateCharacter: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  leftSidebarOpen,
  setLeftSidebarOpen,
  characters,
  selectedCharacterId,
  setSelectedCharacter,
  refreshCharacters,
  handleEditCharacter,
  handleCreateCharacter,
}) => {
  const { t } = useLanguage();

  return (
    <aside
      className={`${leftSidebarOpen ? "w-80" : "w-20"} hidden md:flex flex-col glass-panel border-r border-white/5 transition-all duration-500 ease-[cubic-bezier(0.25,1,0.5,1)] z-30 bath-reveal bath-reveal-delay-1`}
    >
      <div className="flex items-center justify-between p-6 border-b border-white/5">
        <div
          className={`flex items-center gap-3 overflow-hidden transition-all duration-300 ${leftSidebarOpen ? "opacity-100" : "opacity-0 w-0"}`}
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-bath-500/15 to-bath-600/10 flex items-center justify-center border border-bath-500/20 text-bath-400/80">
            <Flame size={16} />
          </div>
          <span className="font-display font-bold text-lg tracking-tight text-stone-100">
            {t("app.title")} <span className="text-stone-500 font-sans text-sm">V2</span>
          </span>
        </div>
        <button
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
          className="text-stone-500 hover:text-stone-100 transition-colors"
          aria-label={leftSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {leftSidebarOpen ? (
            <Minimize2 size={18} />
          ) : (
            <Maximize2 size={18} />
          )}
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <CharacterList
          characters={characters}
          selectedId={selectedCharacterId}
          onSelect={setSelectedCharacter}
          isCollapsed={!leftSidebarOpen}
          onCharacterImported={refreshCharacters}
          onEditCharacter={handleEditCharacter}
          onCreateCharacter={handleCreateCharacter}
        />
      </div>
    </aside>
  );
};
