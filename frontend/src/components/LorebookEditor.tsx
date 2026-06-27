import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Trash2, BookOpen } from 'lucide-react';
import {
  CharacterBook,
  CharacterBookEntry,
  addBookEntry,
  deleteBookEntry,
  replaceCharacterBook,
  updateBookEntry,
} from '../services/zeroclawService';
import { useToast } from './Toast';

interface LorebookEditorProps {
  value: CharacterBook | null;
  onChange: (book: CharacterBook) => void;
  // When provided, the editor switches to "standalone" mode and persists
  // every entry mutation through the lorebook CRUD endpoints. Without it,
  // it falls back to the legacy "embedded" mode where the parent saves the
  // whole card (including the book) in one PUT.
  characterName?: string;
  mode?: 'embedded' | 'standalone';
}

const POSITIONS: { value: CharacterBookEntry['position']; label: string }[] = [
  { value: 'before_char', label: 'Before character' },
  { value: 'after_char', label: 'After character' },
];

const TEMP_ID_PREFIX = '__pending_';

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

const isTempId = (id: string | undefined): boolean =>
  typeof id === 'string' && id.startsWith(TEMP_ID_PREFIX);

const makeTempId = (): string =>
  `${TEMP_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cloneBook = (book: CharacterBook | null): CharacterBook => ({
  name: book?.name ?? '',
  description: book?.description ?? '',
  entries: (book?.entries ?? []).map((e) => ({ ...e })),
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
  pending?: boolean;
}> = ({ index, entry, onChange, onDelete, pending }) => {
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
          <div className="text-sm font-medium text-white truncate flex items-center gap-2">
            <span>
              #{index + 1} {entry.keys[0] || '(no keys)'}
              {entry.keys.length > 1 && (
                <span className="text-stone-500"> +{entry.keys.length - 1}</span>
              )}
            </span>
            {pending && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-bath-500/20 text-bath-200 border border-bath-500/30">
                saving…
              </span>
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
              onChange={(e) => onChange({ ...entry, secondaryKeys: chipsToList(e.target.value) })}
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

const LorebookEditor: React.FC<LorebookEditorProps> = ({
  value,
  onChange,
  characterName,
  mode,
}) => {
  // Standalone is the default when the parent hands us a character name,
  // because that's the only path the V3 lorebook endpoints can serve.
  // Embedded mode is reserved for callers (tests, preview surfaces) that
  // don't have a persisted character yet.
  const isStandalone = mode === 'standalone' || (mode === undefined && !!characterName);
  const toast = useToast();

  // Local copy used for optimistic updates. In standalone mode this is the
  // source of truth; in embedded mode we mirror `value` and let the parent
  // own state.
  const [localBook, setLocalBook] = useState<CharacterBook>(() => cloneBook(value));
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Always-fresh mirror of localBook so async callbacks (POST/PUT/DELETE
  // resolutions) can read the latest state without re-subscribing. Without
  // this, a callback created in one render reads a stale closure snapshot
  // and clobbers concurrent edits when it propagates via onChange.
  const bookRef = useRef<CharacterBook>(localBook);
  useEffect(() => {
    bookRef.current = localBook;
  }, [localBook]);

  // Track which effect cycle last pushed localBook up to the parent so we
  // don't echo our own updates back into local state.
  const lastPushedRef = useRef<string>('');

  // Sync incoming `value` into local state when it changes externally
  // (e.g. character reloaded). Skip if the change originated from us.
  useEffect(() => {
    if (isStandalone) return; // standalone owns the book locally
    setLocalBook(cloneBook(value));
  }, [value, isStandalone]);

  // Migration: legacy cards arrive without entry ids. If the parent is
  // editing an existing character that has a book but no ids, push the
  // book through replaceCharacterBook once so subsequent per-entry CRUD
  // has stable ids to target. This is idempotent — once ids are assigned
  // the guard short-circuits on every subsequent render.
  useEffect(() => {
    if (!isStandalone || !characterName) return;
    const entries = localBook.entries;
    if (entries.length === 0) return;
    const needsBackfill = entries.some((e) => !e.id || isTempId(e.id));
    if (!needsBackfill) return;
    let cancelled = false;
    replaceCharacterBook(characterName, localBook)
      .then((next) => {
        if (cancelled) return;
        setLocalBook(next);
        onChange(next);
      })
      .catch((e: unknown) => {
        toast.error('Could not migrate lorebook', e instanceof Error ? e.message : undefined);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStandalone, characterName]);

  const emitChange = (next: CharacterBook) => {
    setLocalBook(next);
    const signature = JSON.stringify(next);
    lastPushedRef.current = signature;
    onChange(next);
  };

  const updateEntry = (index: number, next: CharacterBookEntry) => {
    const current = localBook;
    const prev = current.entries[index];
    const rebuilt: CharacterBook = {
      name: current.name,
      description: current.description,
      entries: current.entries.map((e, i) => (i === index ? next : e)),
    };
    emitChange(rebuilt);

    if (!isStandalone || !characterName) return;
    const entryId = prev?.id;
    if (!entryId || isTempId(entryId)) {
      // Pending add hasn't resolved yet — skip the PUT; the POST will
      // carry the latest content when it lands. We can't reliably PATCH
      // a row that doesn't have a server id.
      return;
    }
    updateBookEntry(characterName, entryId, next).catch((e: unknown) => {
      toast.error('Failed to save entry', e instanceof Error ? e.message : undefined);
      // Revert optimistic state for this entry.
      setLocalBook((curr) => ({
        ...curr,
        entries: curr.entries.map((e, i) => (i === index ? prev : e)),
      }));
    });
  };

  const deleteEntry = (index: number) => {
    const current = localBook;
    const target = current.entries[index];
    const rebuilt: CharacterBook = {
      name: current.name,
      description: current.description,
      entries: current.entries.filter((_, i) => i !== index),
    };
    emitChange(rebuilt);

    if (!isStandalone || !characterName) return;
    const entryId = target?.id;
    if (!entryId || isTempId(entryId)) return; // never made it server-side
    deleteBookEntry(characterName, entryId).then((ok) => {
      if (ok) return;
      toast.error('Failed to delete entry', 'The server rejected the delete.');
      // Revert.
      setLocalBook((curr) => ({
        ...curr,
        entries: [...curr.entries.slice(0, index), target, ...curr.entries.slice(index)],
      }));
    });
  };

  const addEntry = () => {
    const tempId = makeTempId();
    const newEntry: CharacterBookEntry = { ...blankEntry(), id: tempId };
    const current = localBook;
    const rebuilt: CharacterBook = {
      name: current.name,
      description: current.description,
      entries: [...current.entries, newEntry],
    };
    emitChange(rebuilt);
    setPendingIds((s) => new Set(s).add(tempId));

    if (!isStandalone || !characterName) {
      setPendingIds((s) => {
        const next = new Set(s);
        next.delete(tempId);
        return next;
      });
      return;
    }

    // Pull the latest entry state at the time the request fires so any
    // edits made between the optimistic insert and the POST resolve are
    // captured — we don't want the server to land a stale snapshot.
    const { id: _drop, ...entryPayload } = rebuilt.entries[rebuilt.entries.length - 1];
    void _drop;
    addBookEntry(characterName, entryPayload)
      .then((saved) => {
        setLocalBook((curr) => {
          const next: CharacterBook = {
            ...curr,
            entries: curr.entries.map((e) => (e.id === tempId ? saved : e)),
          };
          bookRef.current = next;
          onChange(next);
          return next;
        });
      })
      .catch((e: unknown) => {
        toast.error('Failed to add entry', e instanceof Error ? e.message : undefined);
        setLocalBook((curr) => ({
          ...curr,
          entries: curr.entries.filter((e) => e.id !== tempId),
        }));
      })
      .finally(() => {
        setPendingIds((s) => {
          const next = new Set(s);
          next.delete(tempId);
          return next;
        });
      });
  };

  const entries = useMemo(() => localBook.entries, [localBook]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <BookOpen size={16} />
          {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          {isStandalone && (
            <span className="text-[10px] text-stone-600">· auto-saved per entry</span>
          )}
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
          No lorebook entries. Click &quot;Add entry&quot; to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <EntryPanel
              key={entry.id ?? `entry-${i}`}
              index={i}
              entry={entry}
              pending={!!entry.id && isTempId(entry.id) && pendingIds.has(entry.id)}
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
