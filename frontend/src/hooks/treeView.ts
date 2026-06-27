// Fork-graph view model for the conversation tree.
//
// A node-per-message indented tree is unreadable for long chats: a hundred
// linear turns become a hundred rows of noise. The fork graph collapses every
// LINEAR run (a chain where each node has exactly one child) into ONE segment,
// and branches the display only at FORKS (a node with more than one child).
// What matters structurally is forks and branches, not the linear runs between
// them, so that is what this model surfaces.
//
// Pure and React-free so it can be unit-tested directly.

import { type Message } from '../types';
import { indexMessages } from './useMessageTree';

/**
 * One collapsed linear RUN in the fork graph. The run is the chain of messages
 * from `headId` (its first message) to `tailId` (the last message before the
 * chain either ends or forks). `children` are the sub-runs that start at each
 * child of the tail node: an empty array means the tail is a leaf, length >= 2
 * means the tail is a fork. A run never has exactly one child run, because a
 * single child would have been folded into the run itself.
 */
export interface ForkGraphNode {
  /** Messages of this run, head-first, tail-last. Length >= 1. */
  runMessages: Message[];
  /** Id of the first message in the run. Stable key for branch metadata. */
  headId: string;
  /** Id of the last message in the run (the leaf or fork point). */
  tailId: string;
  /** Sub-runs starting at each child of the tail. Length 0 (leaf) or >= 2 (fork). */
  children: ForkGraphNode[];
  /** Nesting depth: 0 for a root run, +1 per fork descended. */
  depth: number;
  /** Position of this run among its siblings (0-based). */
  siblingIndex: number;
  /** Number of sibling runs sharing this run's fork parent (1 if a root). */
  siblingCount: number;
}

/**
 * Collapse `messages` into a forest of fork-graph nodes (one per root). Each
 * root walks down through single-child links until it hits a leaf or a fork;
 * forks recurse into one child run per branch.
 */
export const buildForkGraph = (messages: Message[]): ForkGraphNode[] => {
  const tree = indexMessages(messages);

  const buildRun = (
    headId: string,
    depth: number,
    siblingIndex: number,
    siblingCount: number
  ): ForkGraphNode => {
    const runMessages: Message[] = [];
    const seen = new Set<string>();
    let cur: Message | undefined = tree.byId.get(headId);
    let tailId = headId;

    // Follow the single-child chain. Stop at a leaf (0 children) or a fork
    // (>= 2 children); both terminate the run at the current node.
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      runMessages.push(cur);
      tailId = cur.id;
      const kids = tree.childrenOf.get(cur.id) ?? [];
      if (kids.length === 1) {
        cur = kids[0];
      } else {
        break;
      }
    }

    const tailKids = tree.childrenOf.get(tailId) ?? [];
    const children = tailKids.map((kid, i) =>
      buildRun(kid.id, depth + 1, i, tailKids.length)
    );

    return { runMessages, headId, tailId, children, depth, siblingIndex, siblingCount };
  };

  return tree.roots.map((root, i) => buildRun(root.id, 0, i, tree.roots.length));
};

/**
 * The run that contains `nodeId` anywhere in its collapsed chain. Used to find
 * the ACTIVE run from the active leaf id. Returns null if no run owns the id.
 */
export const findRunContaining = (
  roots: ForkGraphNode[],
  nodeId: string | null | undefined
): ForkGraphNode | null => {
  if (!nodeId) return null;
  const visit = (node: ForkGraphNode): ForkGraphNode | null => {
    if (node.runMessages.some((m) => m.id === nodeId)) return node;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const root of roots) {
    const hit = visit(root);
    if (hit) return hit;
  }
  return null;
};

/**
 * The chain of runs from a root down to (and including) the run that contains
 * `leafId`. Empty if the leaf is not found. The component uses this to mark the
 * active path (every run on it is emphasized and expanded by default).
 */
export const activePathRuns = (
  roots: ForkGraphNode[],
  leafId: string | null | undefined
): ForkGraphNode[] => {
  if (!leafId) return [];
  const path: ForkGraphNode[] = [];
  const dfs = (node: ForkGraphNode): boolean => {
    path.push(node);
    if (node.runMessages.some((m) => m.id === leafId)) return true;
    for (const child of node.children) {
      if (dfs(child)) return true;
    }
    path.pop();
    return false;
  };
  for (const root of roots) {
    if (dfs(root)) return path;
  }
  return [];
};

/** True if any run in the forest forks (has more than one child run). */
export const hasForks = (roots: ForkGraphNode[]): boolean => {
  const visit = (node: ForkGraphNode): boolean =>
    node.children.length >= 2 || node.children.some(visit);
  return roots.some(visit);
};
