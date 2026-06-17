import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import uFuzzy from "@leeoniya/ufuzzy";
import {
  type Command,
  type CommandCategory,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  commandToHaystack,
} from "../commands/types";

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

interface GroupedResults {
  category: CommandCategory;
  items: Command[];
}

// Filter the command list by query. Empty query returns the visible browse
// list (everything except commands flagged `hidden`). Non-empty runs uFuzzy
// against the haystack and intersects with the full list (so hidden
// commands like "set temperature to 0.7" still surface by name).
const filterCommands = (commands: Command[], query: string): Command[] => {
  const q = query.trim();
  if (!q) return commands.filter((c) => !c.hidden);

  const uf = new uFuzzy({ intraIns: 0 }); // disable intra-word substring matches — too noisy for short queries
  const haystack = commands.map(commandToHaystack);
  const result = uf.search(haystack, q.toLowerCase());
  const indices = result?.[0] ?? [];
  return indices.map((i) => commands[i]).filter(Boolean);
};

const groupByCategory = (commands: Command[]): GroupedResults[] => {
  const groups: GroupedResults[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = commands.filter((c) => c.category === category);
    if (items.length > 0) groups.push({ category, items });
  }
  return groups;
};

export const CommandPalette: React.FC<CommandPaletteProps> = ({ commands, onClose }) => {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
  const flat = useMemo(() => filtered, [filtered]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);

  // Reset selection to first match whenever the result set changes.
  useEffect(() => {
    setSelectedId(flat[0]?.id ?? null);
  }, [flat]);

  // Autofocus the search field on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the selected row scrolled into view during keyboard navigation.
  useEffect(() => {
    if (!selectedId) return;
    const el = listRef.current?.querySelector(`[data-cmd-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const moveSelection = (dir: 1 | -1): void => {
    if (flat.length === 0) return;
    const idx = flat.findIndex((c) => c.id === selectedId);
    const next = idx === -1 ? 0 : (idx + dir + flat.length) % flat.length;
    setSelectedId(flat[next].id);
  };

  const runSelected = async (): Promise<void> => {
    const cmd = flat.find((c) => c.id === selectedId);
    if (!cmd) return;
    onClose();
    // Defer the side effect so the palette can finish closing first.
    setTimeout(() => {
      void cmd.run();
    }, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveSelection(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveSelection(-1);
        break;
      case "Enter":
        e.preventDefault();
        void runSelected();
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "Tab":
        // Prevent Tab from leaving the palette — keep focus in search.
        e.preventDefault();
        moveSelection(e.shiftKey ? -1 : 1);
        break;
    }
  };

  const renderItem = (cmd: Command): React.ReactNode => {
    const Icon = cmd.icon;
    const isSelected = cmd.id === selectedId;
    return (
      <button
        key={cmd.id}
        data-cmd-id={cmd.id}
        onMouseMove={() => setSelectedId(cmd.id)}
        onClick={() => {
          onClose();
          setTimeout(() => {
            void cmd.run();
          }, 0);
        }}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
          isSelected ? "bg-bath-500/15 text-white" : "text-stone-300 hover:bg-white/5"
        }`}
      >
        {Icon ? (
          <Icon size={16} className={isSelected ? "text-bath-300" : "text-stone-500"} />
        ) : (
          <span className="w-4" />
        )}
        <span className="flex-1 text-sm truncate">{cmd.title}</span>
        {cmd.hint && (
          <span className="text-[11px] uppercase tracking-wider text-stone-500 font-mono">
            {cmd.hint}
          </span>
        )}
        {cmd.shortcut && (
          <kbd className="text-[11px] font-mono text-stone-500 bg-stone-800/60 px-1.5 py-0.5 rounded border border-white/5">
            {cmd.shortcut}
          </kbd>
        )}
      </button>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[180] flex items-start justify-center pt-[12vh] px-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#0e1217]/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl animate-in zoom-in-95 slide-in-from-top-4 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search size={18} className="text-stone-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search actions, characters, settings…"
            className="flex-1 bg-transparent text-stone-100 placeholder-stone-600 text-base focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={onClose}
            className="text-stone-500 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2 px-2 scrollbar-thin">
          {groups.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-stone-500">
              No matches for "{query}"
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.category} className="mb-2">
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-widest font-semibold text-stone-600">
                  {CATEGORY_LABELS[group.category]}
                </div>
                <div className="space-y-0.5">{group.items.map(renderItem)}</div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 text-[11px] text-stone-600">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-stone-800/60 px-1 py-0.5 rounded border border-white/5 mr-1">↑↓</kbd>
              navigate
            </span>
            <span>
              <kbd className="font-mono bg-stone-800/60 px-1 py-0.5 rounded border border-white/5 mr-1">↵</kbd>
              run
            </span>
            <span>
              <kbd className="font-mono bg-stone-800/60 px-1 py-0.5 rounded border border-white/5 mr-1">esc</kbd>
              close
            </span>
          </div>
          <span className="font-mono">{flat.length} results</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
