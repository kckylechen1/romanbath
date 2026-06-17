import React, { useMemo, useState } from "react";
import type { Message } from "../../types";
import { type MessageTree, pathToRoot } from "../../hooks/useMessageTree";
import {
  collectLeaves,
  formatLeafTimestamp,
  leafIdHash,
  truncate,
} from "./branchMiniMapUtils";

interface BranchMiniMapProps {
  messages: Message[];
  messageTree: MessageTree;
  activeLeafId: string | null;
  onSelectLeaf: (leafId: string) => void;
}

const BranchMiniMapImpl: React.FC<BranchMiniMapProps> = ({
  messages,
  messageTree,
  activeLeafId,
  onSelectLeaf,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const leaves = useMemo(() => collectLeaves(messages), [messages]);
  const leafIdsKey = useMemo(() => leafIdHash(leaves.map((l) => l.id)), [leaves]);

  // Active path = the chain from activeLeafId back to root. A leaf is "on
  // path" if it appears in that chain (the active leaf itself, or any
  // ancestor that happens to also be a leaf — possible when an ancestor's
  // only descendant was pruned by an edit).
  const activePathIds = useMemo(() => {
    const path = pathToRoot(messageTree, activeLeafId);
    return new Set(path.map((m) => m.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageTree, activeLeafId, leafIdsKey]);

  // Single-leaf (linear) chats hide the mini-map entirely — matches the
  // MessageBubble rule of hiding branch arrows when there's nothing to switch.
  if (leaves.length <= 1) return null;

  const hovered = hoveredId ? messageTree.byId.get(hoveredId) : null;

  return (
    <div
      className="relative flex items-center gap-3 px-2 py-1.5"
      role="navigation"
      aria-label="Conversation branches"
    >
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
        Branches ({leaves.length})
      </span>

      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin py-1">
        {leaves.map((leaf, idx) => {
          const isActive = leaf.id === activeLeafId;
          const onPath = activePathIds.has(leaf.id);
          const sizeCls = isActive ? "w-3 h-3" : "w-2 h-2";
          const styleCls = onPath
            ? "bg-bath-500 border-bath-300"
            : "bg-transparent border-bath-500/40";
          const ringCls = isActive
            ? "ring-2 ring-bath-300/50 ring-offset-1 ring-offset-stone-900"
            : "";
          return (
            <button
              key={leaf.id}
              type="button"
              onClick={() => onSelectLeaf(leaf.id)}
              onMouseEnter={() => setHoveredId(leaf.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(leaf.id)}
              onBlur={() => setHoveredId(null)}
              aria-label={`Switch to branch ${idx + 1} of ${leaves.length}`}
              aria-current={isActive ? "true" : undefined}
              className={`shrink-0 rounded-full border transition-all duration-150 hover:scale-110 hover:border-bath-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-bath-400 ${sizeCls} ${styleCls} ${ringCls}`}
            />
          );
        })}
      </div>

      {hovered && (
        <div className="pointer-events-none absolute left-28 top-full z-50 mt-1 max-w-xs">
          <div className="rounded-lg border border-white/10 bg-stone-900/80 px-3 py-2 text-xs text-stone-200 shadow-xl backdrop-blur-xl">
            <p className="line-clamp-2 text-stone-200">
              {truncate(hovered.content, 40)}
            </p>
            <p className="mt-0.5 text-[10px] text-stone-500">
              {formatLeafTimestamp(hovered.timestamp)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// Custom comparator: re-render only when leaf count, active leaf, or the set
// of leaf ids changes. Avoids re-rendering on every streaming token.
const computeLeafIdsKey = (messages: Message[]): string =>
  leafIdHash(
    messages
      .filter((m) => !m.childrenIds || m.childrenIds.length === 0)
      .map((m) => m.id),
  );

export const BranchMiniMap = React.memo(BranchMiniMapImpl, (prev, next) =>
  prev.activeLeafId === next.activeLeafId &&
  prev.messages.length === next.messages.length &&
  computeLeafIdsKey(prev.messages) === computeLeafIdsKey(next.messages),
);
