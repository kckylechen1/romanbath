import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GitBranch,
  GitFork,
  Star,
  Pencil,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { Role, type Message } from '../../types';
import { useMessageTree, deepestLeaf } from '../../hooks/useMessageTree';
import {
  buildForkGraph,
  findRunContaining,
  activePathRuns,
  hasForks,
  type ForkGraphNode,
} from '../../hooks/treeView';
import { truncate, formatLeafTimestamp } from '../chat/branchMiniMapUtils';
import {
  getBranchMeta,
  setBranchName,
  toggleBranchFavorite,
  type BranchMetaMap,
} from '../../services/branchMetaStore';

interface ConversationTreeProps {
  messages: Message[];
  activeLeafId: string | null;
  onSelectLeaf: (leafId: string) => void;
  characterId: string;
  chatFileName: string | null;
}

// Shared render context threaded down the recursion so each run can highlight,
// expand, jump, and edit without re-deriving the whole graph.
interface RenderCtx {
  activeRunHead: string | null;
  pathHeads: Set<string>;
  open: Record<string, boolean>;
  toggleOpen: (headId: string, defaultOpen: boolean) => void;
  meta: BranchMetaMap;
  editingId: string | null;
  beginEdit: (headId: string, current: string) => void;
  cancelEdit: () => void;
  commitName: (headId: string, name: string) => void;
  draft: string;
  setDraft: (v: string) => void;
  onFavorite: (headId: string) => void;
  onJump: (node: ForkGraphNode) => void;
  /** Whether branch name/favorite can persist (false for an unsaved chat with
   *  no file yet) — controls are hidden rather than rendered as silent no-ops. */
  canPersist: boolean;
}

// Last message of a run drives the preview line and timestamp.
const runTail = (node: ForkGraphNode): Message =>
  node.runMessages[node.runMessages.length - 1];

const RunCard: React.FC<{ node: ForkGraphNode; ctx: RenderCtx }> = ({ node, ctx }) => {
  const tail = runTail(node);
  const isActive = ctx.activeRunHead === node.headId;
  const onPath = ctx.pathHeads.has(node.headId);
  const isFork = node.children.length >= 2;
  const defaultOpen = onPath;
  const expanded = node.headId in ctx.open ? ctx.open[node.headId] : defaultOpen;

  const nodeMeta = ctx.meta[node.headId];
  const favorite = !!nodeMeta?.favorite;
  const customName = nodeMeta?.name;
  const editing = ctx.editingId === node.headId;

  const count = node.runMessages.length;
  const lastRole = tail.role === Role.User ? 'You' : 'Reply';
  const preview = customName ?? truncate(tail.content || `(${lastRole.toLowerCase()})`, 64);

  // Emphasis: active run glows amber; on-path runs are bright; off-path muted.
  const frameCls = isActive
    ? 'border-primary/70 bg-primary/[0.06] shadow-[0_0_14px_rgba(212,165,116,0.18)]'
    : onPath
      ? 'border-bath-700/40 bg-black/30 hover:border-bath-600/60'
      : 'border-bath-800/40 bg-black/20 hover:border-bath-700/50';
  const textCls = isActive ? 'text-bath-50' : onPath ? 'text-bath-100/90' : 'text-bath-500';

  return (
    <div
      className={`group relative rounded-lg border-l-2 border ${frameCls} transition-colors duration-200`}
    >
      {/* Active spine — a thicker amber left edge on the live run. */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-[-2px] top-1 bottom-1 w-[2px] rounded-full bg-primary shadow-[0_0_8px_rgba(212,165,116,0.6)]"
        />
      )}

      <div className="flex items-stretch">
        {/* Jump target: select the deepest leaf under this run. */}
        <button
          type="button"
          onClick={() => ctx.onJump(node)}
          aria-current={isActive ? 'true' : undefined}
          className="flex-1 min-w-0 text-left px-3 py-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60 rounded-lg"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span
              className={`font-mono text-[9px] uppercase tracking-[0.16em] tabular-nums px-1 py-px rounded shrink-0 ${
                isActive ? 'bg-primary/15 text-primary' : 'bg-white/[0.04] text-bath-500'
              }`}
            >
              {count} msg
            </span>
            {favorite && (
              <Star size={11} className="text-primary shrink-0 fill-primary" aria-label="Favorite" />
            )}
            {customName && (
              <span className="font-mono text-[10px] uppercase tracking-wider text-accent/80 shrink-0">
                named
              </span>
            )}
            <span className="ml-auto font-mono text-[9px] text-bath-600 tabular-nums shrink-0">
              {formatLeafTimestamp(tail.timestamp)}
            </span>
          </div>

          {editing ? (
            <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={ctx.draft}
                onChange={(e) => ctx.setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') ctx.commitName(node.headId, ctx.draft);
                  if (e.key === 'Escape') ctx.cancelEdit();
                }}
                maxLength={60}
                placeholder="Name this branch"
                className="flex-1 min-w-0 bg-black/50 border border-bath-700/50 rounded px-2 py-1 font-mono text-[12px] text-bath-50 placeholder:text-bath-600 focus:outline-none focus:border-primary/60"
              />
            </div>
          ) : (
            <p
              className={`mt-1 font-sans text-[13px] leading-snug truncate ${textCls} ${
                customName ? 'italic' : ''
              }`}
              title={preview}
            >
              {preview}
            </p>
          )}
        </button>

        {/* Touch-accessible controls: persistent (not hover-only). Hidden when
            the chat has no file yet, since name/favorite can't persist. */}
        {ctx.canPersist && (
        <div className="flex flex-col items-center justify-center gap-0.5 px-1.5 border-l border-bath-800/40">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => ctx.commitName(node.headId, ctx.draft)}
                aria-label="Save name"
                className="p-1 rounded text-accent hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={ctx.cancelEdit}
                aria-label="Cancel rename"
                className="p-1 rounded text-bath-500 hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-bath-400"
              >
                <X size={13} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => ctx.onFavorite(node.headId)}
                aria-label={favorite ? 'Unfavorite branch' : 'Favorite branch'}
                aria-pressed={favorite}
                className={`p-1 rounded hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${
                  favorite ? 'text-primary' : 'text-bath-500 hover:text-bath-300'
                }`}
              >
                <Star size={13} className={favorite ? 'fill-primary' : ''} />
              </button>
              <button
                type="button"
                onClick={() => ctx.beginEdit(node.headId, customName ?? '')}
                aria-label="Rename branch"
                className="p-1 rounded text-bath-500 hover:text-bath-300 hover:bg-white/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-bath-400"
              >
                <Pencil size={12} />
              </button>
            </>
          )}
        </div>
        )}
      </div>

      {/* Fork header — chevron collapses/expands the branches below. */}
      {isFork && (
        <button
          type="button"
          onClick={() => ctx.toggleOpen(node.headId, defaultOpen)}
          aria-expanded={expanded}
          className="w-full flex items-center gap-1.5 px-3 py-1.5 border-t border-bath-800/40 text-left hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-bath-400"
        >
          <GitFork size={11} className="text-accent/80 shrink-0" />
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-bath-400">
            Fork
          </span>
          <span className="font-mono text-[9px] tabular-nums text-bath-600">
            {node.children.length} branches
          </span>
          <ChevronDown
            size={13}
            className={`ml-auto text-bath-500 transition-transform duration-300 ${
              expanded ? 'rotate-0' : '-rotate-90'
            }`}
          />
        </button>
      )}
    </div>
  );
};

// One run plus, when expanded, its labelled child branches (recursive).
const RunBranch: React.FC<{ node: ForkGraphNode; ctx: RenderCtx }> = ({ node, ctx }) => {
  const isFork = node.children.length >= 2;
  const defaultOpen = ctx.pathHeads.has(node.headId);
  const expanded = node.headId in ctx.open ? ctx.open[node.headId] : defaultOpen;

  return (
    <div>
      <RunCard node={node} ctx={ctx} />
      {isFork && expanded && (
        <div className="mt-1.5 ml-3 pl-3 border-l border-bath-800/50 space-y-2">
          {node.children.map((child) => (
            <div key={child.headId}>
              <div className="flex items-center gap-1.5 mb-1">
                <GitBranch size={10} className="text-bath-600 shrink-0" />
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-bath-500">
                  branch {child.siblingIndex + 1} of {child.siblingCount}
                </span>
              </div>
              <RunBranch node={child} ctx={ctx} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ConversationTree: React.FC<ConversationTreeProps> = ({
  messages,
  activeLeafId,
  onSelectLeaf,
  characterId,
  chatFileName,
}) => {
  const tree = useMessageTree(messages);
  const roots = useMemo(() => buildForkGraph(messages), [messages]);

  const activeRun = useMemo(
    () => findRunContaining(roots, activeLeafId),
    [roots, activeLeafId]
  );
  const pathHeads = useMemo(
    () => new Set(activePathRuns(roots, activeLeafId).map((n) => n.headId)),
    [roots, activeLeafId]
  );
  const forked = useMemo(() => hasForks(roots), [roots]);

  // Branch metadata (names + favorites), loaded per chat.
  const [meta, setMeta] = useState<BranchMetaMap>({});
  useEffect(() => {
    let alive = true;
    if (!chatFileName) {
      setMeta({});
      return;
    }
    getBranchMeta(characterId, chatFileName).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [characterId, chatFileName]);

  // Expansion overrides keyed by run head; absent means "use default".
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggleOpen = useCallback((headId: string, defaultOpen: boolean) => {
    setOpen((prev) => {
      const current = headId in prev ? prev[headId] : defaultOpen;
      return { ...prev, [headId]: !current };
    });
  }, []);

  // Inline rename state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const beginEdit = useCallback((headId: string, current: string) => {
    setEditingId(headId);
    setDraft(current);
  }, []);
  const cancelEdit = useCallback(() => setEditingId(null), []);
  const commitName = useCallback(
    (headId: string, name: string) => {
      setEditingId(null);
      if (!chatFileName) return;
      setBranchName(characterId, chatFileName, headId, name).then(setMeta);
    },
    [characterId, chatFileName]
  );
  const onFavorite = useCallback(
    (headId: string) => {
      if (!chatFileName) return;
      toggleBranchFavorite(characterId, chatFileName, headId).then(setMeta);
    },
    [characterId, chatFileName]
  );

  // Jump: select the deepest current leaf under this run's tail.
  const onJump = useCallback(
    (node: ForkGraphNode) => {
      const leaf = deepestLeaf(tree, node.tailId);
      onSelectLeaf(leaf ? leaf.id : node.tailId);
    },
    [tree, onSelectLeaf]
  );

  const ctx: RenderCtx = {
    activeRunHead: activeRun?.headId ?? null,
    pathHeads,
    open,
    toggleOpen,
    meta,
    editingId,
    beginEdit,
    cancelEdit,
    commitName,
    draft,
    setDraft,
    onFavorite,
    onJump,
    canPersist: chatFileName != null,
  };

  if (messages.length === 0) {
    return (
      <div className="rounded-xl border border-bath-700/25 bg-black/20 px-4 py-6 text-center">
        <GitBranch size={18} className="mx-auto text-bath-600 mb-2" />
        <p className="font-sans text-[13px] italic text-bath-500/70 leading-relaxed">
          No conversation yet. Send a message to grow the tree.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header strip — engine-room label + branch count. */}
      <div className="flex items-center gap-2 px-0.5">
        <GitBranch size={13} className="text-primary/90" />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-bath-200">
          Fork graph
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-bath-500">
          {forked ? `${roots.length} root` : '1 thread'}
        </span>
      </div>

      <div className="space-y-2">
        {roots.map((root) => (
          <RunBranch key={root.headId} node={root} ctx={ctx} />
        ))}
      </div>

      {/* Empty-branch hint: linear chats still show the run list, plus a nudge. */}
      {!forked && (
        <p className="font-sans text-[12px] italic text-bath-500/70 leading-relaxed border-t border-bath-800/40 pt-3">
          No branches yet. Regenerate or swipe a reply to fork the conversation.
        </p>
      )}
    </div>
  );
};

export default ConversationTree;
