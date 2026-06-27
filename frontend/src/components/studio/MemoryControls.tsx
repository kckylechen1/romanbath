import React, { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Heart,
  Star,
  User,
  Clock,
  Sparkles,
  Pin,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import {
  getCharacterMemories,
  deleteCharacterMemory,
  updateCharacterMemory,
  type MemoryEntry,
} from '../../services/zeroclawService';
import { confirm } from '../../services/dialogService';

interface MemoryControlsProps {
  characterName: string;
}

const CATEGORY_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  preference: { icon: Heart, label: 'Preference', color: 'text-rose-400/80' },
  fact: { icon: Brain, label: 'Fact', color: 'text-bath-300/80' },
  experience: { icon: Star, label: 'Experience', color: 'text-amber-400/80' },
  entity: { icon: User, label: 'Entity', color: 'text-bath-400/80' },
  decision: { icon: Clock, label: 'Decision', color: 'text-bath-500/80' },
};

const CATEGORY_ORDER = ['preference', 'fact', 'experience', 'entity', 'decision'] as const;
const TIER_ORDER = ['consolidated', 'pattern'] as const;

const categoryMeta = (category: string) =>
  CATEGORY_META[category] ?? { icon: Brain, label: category || 'other', color: 'text-bath-400/80' };

const isPinned = (m: MemoryEntry) => m.retention_policy === 'pinned';

// A single-select filter: "all", or a tier/category narrowing. Encoded as a
// flat string key so the chip row stays trivially comparable.
type FilterKey = 'all' | `tier:${string}` | `cat:${string}`;

const tierMarker = (tier: string) => {
  if (tier === 'consolidated') return { icon: Star, color: 'text-bath-300/70', title: 'Consolidated' };
  if (tier === 'pattern') return { icon: Sparkles, color: 'text-amber-400/70', title: 'Pattern' };
  return null;
};

export const MemoryControls: React.FC<MemoryControlsProps> = ({ characterName }) => {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refetch = React.useCallback(() => {
    if (!characterName) return;
    setLoading(true);
    getCharacterMemories(characterName)
      .then(setMemories)
      .finally(() => setLoading(false));
  }, [characterName]);

  useEffect(() => {
    setExpandedId(null);
    setEditingId(null);
    refetch();
  }, [refetch]);

  // Which filter chips to surface: only categories/tiers actually present, so
  // the row never offers a narrowing that yields nothing.
  const presentCategories = useMemo(
    () => CATEGORY_ORDER.filter((c) => memories.some((m) => m.category === c)),
    [memories]
  );
  const presentTiers = useMemo(
    () => TIER_ORDER.filter((t) => memories.some((m) => m.tier === t)),
    [memories]
  );

  // If the active filter's chip vanishes (e.g. its last entry was deleted),
  // fall back to All so the user isn't stranded on a chip-less empty view.
  useEffect(() => {
    if (filter === 'all') return;
    const stillPresent =
      (filter.startsWith('tier:') && (presentTiers as string[]).includes(filter.slice(5))) ||
      (filter.startsWith('cat:') && (presentCategories as string[]).includes(filter.slice(4)));
    if (!stillPresent) setFilter('all');
  }, [filter, presentTiers, presentCategories]);

  const filtered = useMemo(() => {
    let list = memories;
    if (filter.startsWith('tier:')) {
      const t = filter.slice(5);
      list = memories.filter((m) => m.tier === t);
    } else if (filter.startsWith('cat:')) {
      const c = filter.slice(4);
      list = memories.filter((m) => m.category === c);
    }
    // Pinned float to the top; server already returns newest-first within each.
    return [...list].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)));
  }, [memories, filter]);

  const applyUpdated = (entry: MemoryEntry) => {
    setMemories((prev) => prev.map((m) => (m.id === entry.id ? entry : m)));
  };

  const handleTogglePin = async (m: MemoryEntry) => {
    setBusyId(m.id);
    const next = !isPinned(m);
    // Optimistic: flip retention locally, reconcile from the returned entry.
    setMemories((prev) =>
      prev.map((x) =>
        x.id === m.id ? { ...x, retention_policy: next ? 'pinned' : 'durable' } : x
      )
    );
    const updated = await updateCharacterMemory(characterName, m.id, { pinned: next });
    if (updated) applyUpdated(updated);
    else refetch();
    setBusyId(null);
  };

  const startEdit = (m: MemoryEntry) => {
    setEditingId(m.id);
    setEditText(m.text);
    setExpandedId(m.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (m: MemoryEntry) => {
    const text = editText.trim();
    if (!text || text === m.text) {
      cancelEdit();
      return;
    }
    setBusyId(m.id);
    const updated = await updateCharacterMemory(characterName, m.id, { text });
    if (updated) applyUpdated(updated);
    else refetch();
    setBusyId(null);
    cancelEdit();
  };

  const handleDelete = async (m: MemoryEntry) => {
    const ok = await confirm({
      title: 'Delete this memory?',
      message: 'This permanently removes it from what this companion remembers. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    setBusyId(m.id);
    // Optimistic removal; restore via refetch if the server rejects it.
    const snapshot = memories;
    setMemories((prev) => prev.filter((x) => x.id !== m.id));
    const deleted = await deleteCharacterMemory(characterName, m.id);
    if (!deleted) setMemories(snapshot);
    setBusyId(null);
  };

  const Chip: React.FC<{ value: FilterKey; label: string; count: number }> = ({
    value,
    label,
    count,
  }) => {
    const active = filter === value;
    return (
      <button
        type="button"
        onClick={() => setFilter(value)}
        aria-pressed={active}
        className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-md border transition-colors ${
          active
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-white/[0.03] border-bath-700/30 text-bath-400 hover:text-bath-200 hover:border-bath-600/40'
        }`}
      >
        {label}
        <span className="ml-1.5 tabular-nums text-bath-500">{count}</span>
      </button>
    );
  };

  const RowButton: React.FC<{
    onClick: () => void;
    label: string;
    active?: boolean;
    danger?: boolean;
    disabled?: boolean;
    children: React.ReactNode;
  }> = ({ onClick, label, active, danger, disabled, children }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-bath-400 ${
        danger
          ? 'text-bath-500 hover:text-rose-300 hover:bg-rose-500/10'
          : active
            ? 'text-primary hover:bg-white/5'
            : 'text-bath-500 hover:text-bath-200 hover:bg-white/5'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Header: label + total count */}
      <div className="flex items-baseline justify-between px-0.5">
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-accent/80" />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-bath-200">
            Memory
          </span>
        </div>
        <span className="font-mono text-[10px] tabular-nums text-bath-500">
          {memories.length} {memories.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>

      {/* Filter chips: All + present tiers + present categories */}
      {memories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Chip value="all" label="All" count={memories.length} />
          {presentTiers.map((t) => (
            <Chip
              key={`tier:${t}`}
              value={`tier:${t}`}
              label={t}
              count={memories.filter((m) => m.tier === t).length}
            />
          ))}
          {presentCategories.map((c) => (
            <Chip
              key={`cat:${c}`}
              value={`cat:${c}`}
              label={categoryMeta(c).label}
              count={memories.filter((m) => m.category === c).length}
            />
          ))}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          <div className="shimmer-warm h-12 rounded-lg" />
          <div className="shimmer-warm h-12 rounded-lg" />
          <div className="shimmer-warm h-12 rounded-lg" />
        </div>
      ) : memories.length === 0 ? (
        <p className="font-sans text-[13px] italic text-bath-500/70 leading-relaxed py-6 text-center">
          No memories yet for {characterName}.
        </p>
      ) : filtered.length === 0 ? (
        <p className="font-sans text-[13px] italic text-bath-500/70 leading-relaxed py-6 text-center">
          Nothing in this filter.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => {
            const meta = categoryMeta(m.category);
            const Icon = meta.icon;
            const marker = tierMarker(m.tier);
            const pinned = isPinned(m);
            const expanded = expandedId === m.id;
            const editing = editingId === m.id;
            const busy = busyId === m.id;
            const display = m.summary || m.text.slice(0, 120);

            return (
              <div
                key={m.id}
                className={`rounded-lg border bg-black/20 overflow-hidden animate-message-in ${
                  pinned ? 'border-primary/30' : 'border-bath-700/25'
                }`}
              >
                <div className="flex items-start gap-2 px-3 py-2.5">
                  {/* Category icon + tier marker */}
                  <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
                    <Icon size={13} className={meta.color} />
                    {marker && (
                      <marker.icon size={11} className={marker.color} aria-label={marker.title} />
                    )}
                  </div>

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    {editing ? (
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={4}
                        autoFocus
                        className="w-full resize-y rounded-md bg-black/40 border border-bath-700/40 px-2.5 py-2 font-sans text-[13px] leading-relaxed text-bath-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : m.id)}
                        className="w-full text-left font-sans text-[13px] leading-relaxed text-bath-100/90 break-words"
                      >
                        {expanded ? m.text : display}
                        {!expanded && !m.summary && m.text.length > 120 ? '…' : ''}
                      </button>
                    )}

                    {/* Controls row (persistent, touch-accessible) */}
                    <div className="flex items-center gap-0.5 mt-1.5 -ml-1">
                      {editing ? (
                        <>
                          <RowButton
                            onClick={() => saveEdit(m)}
                            label="Save edit"
                            active
                            disabled={busy}
                          >
                            <Check size={15} />
                          </RowButton>
                          <RowButton onClick={cancelEdit} label="Cancel edit" disabled={busy}>
                            <X size={15} />
                          </RowButton>
                        </>
                      ) : (
                        <>
                          <RowButton
                            onClick={() => handleTogglePin(m)}
                            label={pinned ? 'Unpin memory' : 'Pin memory'}
                            active={pinned}
                            disabled={busy}
                          >
                            <Pin size={15} className={pinned ? 'fill-current' : ''} />
                          </RowButton>
                          <RowButton onClick={() => startEdit(m)} label="Edit memory" disabled={busy}>
                            <Pencil size={15} />
                          </RowButton>
                          <RowButton
                            onClick={() => handleDelete(m)}
                            label="Delete memory"
                            danger
                            disabled={busy}
                          >
                            <Trash2 size={15} />
                          </RowButton>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MemoryControls;
