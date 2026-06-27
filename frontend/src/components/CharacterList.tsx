import React, { useMemo, useRef, useState } from 'react';
import { Character } from '../types';
import {
  Users,
  Upload,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Download,
  Search,
  X,
  BookOpen,
  Image as ImageIcon,
  MessageSquare,
} from 'lucide-react';
import {
  importCharacterCard,
  duplicateCharacter,
  exportCharacter,
  deleteCharacter,
} from '../services/zeroclawService';
import type { GetCharactersOptions } from '../services/zeroclawService';
import { useLanguage } from '../i18n';
import { CharacterAvatar } from './CharacterAvatar';
import { confirm as confirmDialog } from '../services/dialogService';
import { useDebouncedValue } from '../hooks/useCharacterSearch';

interface CharacterListProps {
  characters: Character[];
  selectedId: string;
  onSelect: (character: Character) => void;
  isCollapsed: boolean;
  onCharacterImported?: () => void; // Callback to refresh character list
  onEditCharacter?: (charId: string) => void; // Callback to edit character
  onCreateCharacter?: () => void; // Callback to create new character
  // Server-side filter state. When provided, the list drives search/tag
  // selection through this pair instead of mutating its own copy.
  filter?: GetCharactersOptions;
  onFilterChange?: (opts: GetCharactersOptions) => void;
}

// Pull the top N unique tags out of the current character list so the
// user can click-filter without a separate tag management screen. 5 keeps
// the chip row from overflowing when collapsed sidebars render it.
const TOP_TAG_COUNT = 5;

const CharacterList: React.FC<CharacterListProps> = ({
  characters,
  selectedId,
  onSelect,
  isCollapsed,
  onCharacterImported,
  onEditCharacter,
  onCreateCharacter,
  filter,
  onFilterChange,
}) => {
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Search box is local so the input feels instant; the debounce pushes
  // the value up through onFilterChange and the parent refetches.
  const [searchInput, setSearchInput] = useState<string>(filter?.search ?? '');
  const debouncedSearch = useDebouncedValue(searchInput, 200);
  React.useEffect(() => {
    if (!onFilterChange) return;
    if ((filter?.search ?? '') === debouncedSearch) return;
    onFilterChange({ ...filter, search: debouncedSearch || undefined });
    // We deliberately exclude `filter` from deps — including it would
    // re-fire this effect on every parent-driven filter change and loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, onFilterChange]);

  const activeTag = filter?.tag;

  const topTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const char of characters) {
      for (const tag of char.tags ?? []) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_TAG_COUNT)
      .map(([tag]) => tag);
  }, [characters]);

  // Context Menu State
  const [contextMenuChar, setContextMenuChar] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportError(null);

    try {
      const result = await importCharacterCard(file);

      if (result.success) {
        console.log('Character imported successfully:', result.fileName);
        // Trigger refresh of character list
        onCharacterImported?.();
      } else {
        setImportError(result.error || 'Import failed');
        setTimeout(() => setImportError(null), 5000); // Clear error after 5s
      }
    } catch (error) {
      console.error('Import error:', error);
      setImportError(error instanceof Error ? error.message : 'Import failed');
      setTimeout(() => setImportError(null), 5000);
    } finally {
      setIsImporting(false);
      // Reset file input so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDuplicateCharacter = async (charId: string) => {
    setContextMenuChar(null);
    const result = await duplicateCharacter(charId);
    if (result.success) {
      onCharacterImported?.();
    } else {
      setImportError(result.error || 'Duplicate failed');
      setTimeout(() => setImportError(null), 5000);
    }
  };

  const handleExportCharacter = async (charId: string) => {
    setContextMenuChar(null);
    const blob = await exportCharacter(charId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${charId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, charId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuChar(charId);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  };

  const handleEditFromMenu = (charId: string) => {
    setContextMenuChar(null);
    onEditCharacter?.(charId);
  };

  const handleDeleteFromMenu = async (charId: string) => {
    setContextMenuChar(null);
    const ok = await confirmDialog({
      title: 'Delete character?',
      message: `"${charId}" and its avatar will be removed permanently. Chat history is kept.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = await deleteCharacter(charId);
    if (result.success) {
      onCharacterImported?.();
    } else {
      setImportError(result.error || 'Delete failed');
      setTimeout(() => setImportError(null), 5000);
    }
  };

  // Close context menu when clicking outside
  React.useEffect(() => {
    const handleClick = () => setContextMenuChar(null);
    if (contextMenuChar) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenuChar]);

  return (
    <div className="flex flex-col h-full gap-4">
      <div
        className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-2 py-4`}
      >
        {!isCollapsed && (
          <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
            <Users size={20} /> {t('character.contacts')}
          </h2>
        )}
        {isCollapsed && <Users size={24} className="text-gray-400" />}
      </div>

      {/* Search + tag filter. Hidden when the sidebar collapses to a
          rail — the icons-only mode doesn't have room for an input. */}
      {!isCollapsed && onFilterChange && (
        <div className="px-2 space-y-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search characters…"
              className="w-full bg-stone-900/60 border border-white/10 rounded-xl pl-9 pr-9 py-2 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/40"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-stone-500 hover:text-white hover:bg-white/5"
              >
                <X size={14} />
              </button>
            )}
          </div>
          {topTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {topTags.map((tag) => {
                const active = activeTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onFilterChange({ ...filter, tag: active ? undefined : tag })}
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-bath-500/20 border-bath-500/40 text-bath-200'
                        : 'bg-stone-900/40 border-white/10 text-stone-400 hover:text-stone-200 hover:border-white/20'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
              {activeTag && (
                <button
                  type="button"
                  onClick={() => onFilterChange({ ...filter, tag: undefined })}
                  className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 text-stone-500 hover:text-white"
                >
                  clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 px-2">
        {characters.map((char) => (
          <div
            key={char.id}
            className="relative group"
            onContextMenu={(e) => handleContextMenu(e, char.id)}
          >
            <button
              onClick={() => onSelect(char)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-300
                ${
                  selectedId === char.id
                    ? 'bg-gradient-to-r from-bath-500/5 to-transparent border border-bath-500/10 border-l-2 border-l-bath-500/40 shadow-sm'
                    : 'hover:bg-gradient-to-r hover:from-white/[0.03] hover:to-transparent border border-transparent border-l-2 border-l-transparent'
                }
              `}
            >
              <div className="relative shrink-0">
                <CharacterAvatar
                  name={char.name}
                  avatar={char.avatar}
                  size="lg"
                  ringClassName={
                    selectedId === char.id
                      ? 'ring-bath-500/30'
                      : 'ring-white/5 group-hover:ring-white/10'
                  }
                />
                <div
                  className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0d0b09] transition-colors duration-300 ${selectedId === char.id ? 'bg-bath-400' : 'bg-stone-700'}`}
                ></div>
              </div>

              {!isCollapsed && (
                <div className="flex flex-col items-start text-left overflow-hidden flex-1">
                  <span
                    className={`font-semibold text-sm truncate w-full ${selectedId === char.id ? 'text-stone-100' : 'text-stone-400 group-hover:text-stone-300'}`}
                  >
                    {char.name}
                  </span>
                  <span className="text-[10px] text-stone-600 truncate w-full">
                    {char.description}
                  </span>
                  {/* V3 summary badges. Muted stone so they don't crowd
                      the layout; each is a title-tooltip so the meaning
                      is one hover away. */}
                  {(char.hasCharacterBook ||
                    char.hasAssets ||
                    (char.alternateGreetingCount ?? 0) > 0) && (
                    <div className="flex items-center gap-1.5 mt-1 text-stone-600">
                      {char.hasCharacterBook && (
                        <span title="Has lorebook" className="inline-flex">
                          <BookOpen size={11} />
                        </span>
                      )}
                      {char.hasAssets && (
                        <span title="Has character assets" className="inline-flex">
                          <ImageIcon size={11} />
                        </span>
                      )}
                      {(char.alternateGreetingCount ?? 0) > 0 && (
                        <span
                          title={`${char.alternateGreetingCount} alternate greeting${char.alternateGreetingCount === 1 ? '' : 's'}`}
                          className="inline-flex items-center gap-0.5"
                        >
                          <MessageSquare size={11} />
                          <span className="text-[10px] leading-none">
                            {char.alternateGreetingCount}
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </button>

            {/* Edit button on hover */}
            {!isCollapsed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEditCharacter?.(char.id);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-stone-800/80 text-stone-500 hover:text-white hover:bg-stone-700 opacity-0 group-hover:opacity-100 transition-all"
                aria-label="Edit character"
                title="Edit character"
              >
                <Pencil size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Context Menu */}
      {contextMenuChar && (
        <div
          className="fixed z-50 bg-[#1a1410] border border-white/10 rounded-xl shadow-2xl py-1 min-w-[160px] animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleEditFromMenu(contextMenuChar)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-stone-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Pencil size={14} />
            Edit
          </button>
          <button
            onClick={() => handleDuplicateCharacter(contextMenuChar)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-stone-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Copy size={14} />
            Duplicate
          </button>
          <button
            onClick={() => handleExportCharacter(contextMenuChar)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-stone-300 hover:bg-white/5 hover:text-white transition-colors"
          >
            <Download size={14} />
            Export
          </button>
          <div className="h-px bg-white/10 my-1" />
          <button
            onClick={() => handleDeleteFromMenu(contextMenuChar)}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
          >
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {/* Import Error Message */}
      {importError && !isCollapsed && (
        <div className="mx-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
          {importError}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".png,.json,.webp"
        onChange={handleFileChange}
        className="hidden"
      />

      <div className="p-4 border-t border-white/5 space-y-2">
        {/* Create New Character Button */}
        {!isCollapsed && (
          <button
            onClick={onCreateCharacter}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-bath-600/10 to-bath-700/10 hover:from-bath-600/20 hover:to-bath-700/20 text-bath-300/80 hover:text-bath-200 p-3 rounded-xl border border-bath-500/10 hover:border-bath-500/20 transition-all"
          >
            <Plus size={18} />
            <span className="text-sm font-medium">Create Character</span>
          </button>
        )}

        {/* Import Button */}
        <button
          onClick={handleImportClick}
          disabled={isImporting}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-center gap-2'} bg-white/[0.02] hover:bg-white/[0.05] text-stone-500 hover:text-stone-200 p-3 rounded-xl border border-white/5 hover:border-white/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed`}
          aria-label={t('character.importCard')}
          title={t('character.importCard')}
        >
          {isImporting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              {!isCollapsed && (
                <span className="text-sm font-medium">{t('character.importing')}</span>
              )}
            </>
          ) : (
            <>
              <Upload size={18} />
              {!isCollapsed && (
                <span className="text-sm font-medium">{t('character.importCard')}</span>
              )}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default CharacterList;
