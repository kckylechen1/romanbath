import React, { useEffect, useState } from 'react';
import { Brain, Heart, Star, User, Clock, ChevronUp } from 'lucide-react';
import { getCharacterMemories, type MemoryEntry } from '../services/zeroclawService';

const CATEGORY_META: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  preference: { icon: Heart, label: 'Preferences', color: 'text-rose-400/70' },
  fact: { icon: Brain, label: 'Facts', color: 'text-bath-300/70' },
  experience: { icon: Star, label: 'Experiences', color: 'text-amber-400/70' },
  entity: { icon: User, label: 'People & Places', color: 'text-bath-400/70' },
  decision: { icon: Clock, label: 'Decisions', color: 'text-bath-500/70' },
};

interface MemoryPanelProps {
  characterName: string;
  isOpen: boolean;
  onClose: () => void;
}

export const MemoryPanel: React.FC<MemoryPanelProps> = ({ characterName, isOpen, onClose }) => {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !characterName) return;
    setLoading(true);
    getCharacterMemories(characterName)
      .then(setMemories)
      .finally(() => setLoading(false));
  }, [isOpen, characterName]);

  if (!isOpen) return null;

  // Group by category
  const grouped = memories.reduce<Record<string, MemoryEntry[]>>((acc, m) => {
    const cat = m.category || 'other';
    (acc[cat] ??= []).push(m);
    return acc;
  }, {});

  // Sort categories by count descending
  const sortedCategories = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="animate-in fade-in slide-in-from-top-4 duration-300">
      <div className="max-w-2xl mx-auto px-4 pb-6">
        <div className="bg-bath-900/60 backdrop-blur-xl rounded-2xl border border-bath-700/20 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-bath-700/15">
            <span className="text-sm font-display text-bath-200 tracking-wide">
              What {characterName} remembers
            </span>
            <button
              onClick={onClose}
              className="p-1 hover:bg-bath-800/50 rounded-lg transition-colors"
              aria-label="Close memories"
            >
              <ChevronUp size={16} className="text-bath-500" />
            </button>
          </div>

          {/* Content */}
          <div className="p-5 max-h-[50vh] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="shimmer-warm w-full h-16 rounded-xl" />
              </div>
            ) : memories.length === 0 ? (
              <p className="text-center text-bath-500/60 text-sm py-8 font-sans">
                No memories yet. Start chatting to build a connection.
              </p>
            ) : (
              <div className="space-y-5">
                {sortedCategories.map(([category, items]) => {
                  const meta = CATEGORY_META[category] ?? {
                    icon: Brain,
                    label: category,
                    color: 'text-bath-400/70',
                  };
                  const Icon = meta.icon;
                  return (
                    <div key={category}>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon size={14} className={meta.color} />
                        <span className="text-xs font-sans uppercase tracking-wider text-bath-500/70">
                          {meta.label}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {items.slice(0, 5).map((m) => (
                          <div
                            key={m.id}
                            className="text-sm text-bath-200/80 pl-5 border-l border-bath-700/20 py-1 font-sans leading-relaxed"
                          >
                            {m.summary || m.text.slice(0, 120)}
                            {!m.summary && m.text.length > 120 ? '…' : ''}
                            {m.tier === 'consolidated' && (
                              <span className="ml-2 text-[10px] text-bath-500/40">★</span>
                            )}
                            {m.tier === 'pattern' && (
                              <span className="ml-2 text-[10px] text-amber-500/40">✦</span>
                            )}
                          </div>
                        ))}
                        {items.length > 5 && (
                          <p className="text-xs text-bath-600/50 pl-5">
                            +{items.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
