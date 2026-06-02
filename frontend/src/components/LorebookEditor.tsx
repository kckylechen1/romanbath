import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, BookOpen } from 'lucide-react';
import { CharacterBook, CharacterBookEntry } from '../services/zeroclawService';

interface LorebookEditorProps {
  value: CharacterBook | null;
  onChange: (book: CharacterBook) => void;
}

const POSITIONS: { value: CharacterBookEntry['position']; label: string }[] = [
  { value: 'before_char', label: 'Before character' },
  { value: 'after_char', label: 'After character' },
];

const blankEntry = (): CharacterBookEntry => ({
  keys: [],
  secondaryKeys: [],
  content: '',
  enabled: true,
  selective: false,
  constant: false,
  position: 'before_char',
  recursive: false,
});

const chipsToList = (s: string): string[] =>
  s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

const listToChips = (xs: string[] | undefined): string => (xs ?? []).join(', ');

const EntryPanel: React.FC<{
  index: number;
  entry: CharacterBookEntry;
  onChange: (next: CharacterBookEntry) => void;
  onDelete: () => void;
}> = ({ index, entry, onChange, onDelete }) => {
  const [open, setOpen] = useState(false);
  const keysText = listToChips(entry.keys);
  const secondaryText = listToChips(entry.secondaryKeys);

  return (
    <div className="bg-stone-800/40 border border-white/10 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-white/[0.03] transition-colors"
      >
        {open ? (
          <ChevronDown size={16} className="text-stone-500 shrink-0" />
        ) : (
          <ChevronRight size={16} className="text-stone-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">
            #{index + 1} {entry.keys[0] || '(no keys)'}
            {entry.keys.length > 1 && (
              <span className="text-stone-500"> +{entry.keys.length - 1}</span>
            )}
          </div>
          <div className="text-xs text-stone-500 truncate">
            {entry.enabled ? 'enabled' : 'disabled'} ·{' '}
            {entry.position === 'after_char' ? 'after character' : 'before character'}
            {entry.constant ? ' · constant' : ''}
            {entry.selective ? ' · selective' : ''}
            {entry.recursive ? ' · recursive' : ''}
            {entry.priority != null ? ` · pri ${entry.priority}` : ''}
          </div>
        </div>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded-lg text-stone-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          title="Delete entry"
        >
          <Trash2 size={14} />
        </span>
      </button>

      {open && (
        <div className="p-3 space-y-3 border-t border-white/5">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Keys (comma separated)
            </label>
            <input
              type="text"
              value={keysText}
              onChange={(e) => onChange({ ...entry, keys: chipsToList(e.target.value) })}
              placeholder="whiskey, 旗袍, secret"
              className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Secondary keys (only used when Selective is on)
            </label>
            <input
              type="text"
              value={secondaryText}
              onChange={(e) =>
                onChange({ ...entry, secondaryKeys: chipsToList(e.target.value) })
              }
              placeholder="drink, alcohol"
              className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">Content</label>
            <textarea
              value={entry.content}
              onChange={(e) => onChange({ ...entry, content: e.target.value })}
              placeholder="The lore to inject when this entry matches…"
              rows={5}
              className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">Position</label>
              <select
                value={entry.position}
                onChange={(e) =>
                  onChange({
                    ...entry,
                    position: e.target.value as CharacterBookEntry['position'],
                  })
                }
                className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-bath-500/50"
              >
                {POSITIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1">
                Priority (higher = earlier)
              </label>
              <input
                type="number"
                value={entry.priority ?? 0}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...entry, priority: v === '' ? undefined : parseInt(v, 10) });
                }}
                className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-bath-500/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">
              Token budget (0 or empty = no truncation)
            </label>
            <input
              type="number"
              min={0}
              value={entry.tokenBudget ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onChange({
                  ...entry,
                  tokenBudget: v === '' ? undefined : Math.max(0, parseInt(v, 10)),
                });
              }}
              placeholder="e.g. 200"
              className="w-full bg-stone-900/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ToggleChip
              label="Enabled"
              on={entry.enabled}
              onChange={(v) => onChange({ ...entry, enabled: v })}
            />
            <ToggleChip
              label="Constant"
              on={entry.constant}
              onChange={(v) => onChange({ ...entry, constant: v })}
            />
            <ToggleChip
              label="Selective"
              on={entry.selective}
              onChange={(v) => onChange({ ...entry, selective: v })}
            />
            <ToggleChip
              label="Recursive"
              on={entry.recursive}
              onChange={(v) => onChange({ ...entry, recursive: v })}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const ToggleChip: React.FC<{ label: string; on: boolean; onChange: (v: boolean) => void }> = ({
  label,
  on,
  onChange,
}) => (
  <button
    type="button"
    onClick={() => onChange(!on)}
    className={`text-xs px-3 py-2 rounded-lg border transition-colors ${
      on
        ? 'bg-bath-500/20 border-bath-500/40 text-bath-200'
        : 'bg-stone-900/40 border-white/10 text-stone-500 hover:text-stone-300'
    }`}
  >
    {label}
  </button>
);

const LorebookEditor: React.FC<LorebookEditorProps> = ({ value, onChange }) => {
  const entries = value?.entries ?? [];

  const updateEntry = (index: number, next: CharacterBookEntry) => {
    onChange({
      name: value?.name ?? '',
      description: value?.description ?? '',
      entries: entries.map((e, i) => (i === index ? next : e)),
    });
  };

  const deleteEntry = (index: number) => {
    onChange({
      name: value?.name ?? '',
      description: value?.description ?? '',
      entries: entries.filter((_, i) => i !== index),
    });
  };

  const addEntry = () => {
    onChange({
      name: value?.name ?? '',
      description: value?.description ?? '',
      entries: [...entries, blankEntry()],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <BookOpen size={16} />
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
        </div>
        <button
          type="button"
          onClick={addEntry}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-bath-300 hover:text-bath-200 bg-bath-500/10 hover:bg-bath-500/20 border border-bath-500/20 rounded-lg transition-colors"
        >
          <Plus size={14} /> Add entry
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-8 text-stone-500 text-sm border border-dashed border-white/10 rounded-xl">
          No lorebook entries. Click "Add entry" to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <EntryPanel
              key={i}
              index={i}
              entry={entry}
              onChange={(next) => updateEntry(i, next)}
              onDelete={() => deleteEntry(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default LorebookEditor;
