// Pure tree utilities for the Message Tree model.
//
// Messages form a forest (multiple roots are allowed but the app maintains
// a single active root per chat in practice). Each Message has optional
// `parentId` and `childrenIds`. Legacy chats without these fields get
// backfilled by chatService.linkLinearTree at load time, so every code
// path below can assume the fields are populated.
//
// The "active path" is the chain of messages currently rendered in the
// chat view, walked from the active leaf back to its root. Branches
// off the active path exist in the messages array but are not rendered
// until the user switches to them.

import { useMemo } from 'react';
import { type Message, Role } from '../types';

/** A node from the server's authoritative conversation tree (Solution B). */
export interface ServerHistoryNode {
  id: string;
  parent_id: string | null;
  role: string; // "user" | "assistant"
  content: string;
  timestamp?: string | null;
}

/**
 * Reconcile the local message tree with the server's authoritative snapshot by
 * UNION ON ID. Nodes the client already has are left untouched (so an in-flight
 * or locally-edited node isn't clobbered); nodes only the server has — e.g. a
 * turn from another device — are added. Because the client now sends its minted
 * ids, same-device snapshots are a subset of the local tree and this is a no-op;
 * the merge only does work for genuine cross-device / fresh-client reconciliation.
 * The snapshot is a self-contained tree, so added nodes' parents are present too.
 */
export const mergeServerNodes = (local: Message[], nodes: ServerHistoryNode[]): Message[] => {
  if (nodes.length === 0) return local;
  const have = new Set(local.map((m) => m.id));
  const additions: Message[] = [];
  for (const n of nodes) {
    if (have.has(n.id)) continue;
    additions.push({
      id: n.id,
      role: n.role === 'user' ? Role.User : Role.Model,
      content: n.content,
      timestamp: n.timestamp ? Date.parse(n.timestamp) || Date.now() : Date.now(),
      parentId: n.parent_id ?? null,
      childrenIds: [],
    });
  }
  if (additions.length === 0) return local; // referential no-op → React bailout
  const merged = [...local, ...additions];
  // Rebuild childrenIds from parentId across the merged set. The chat view
  // derives rendering from parentId (indexMessages), but BranchMiniMap/
  // collectLeaves detect leaves from childrenIds — if the merge left a parent's
  // childrenIds stale, that parent reads as a phantom leaf. Recompute so both
  // sources of truth agree.
  const childrenByParent = new Map<string, string[]>();
  for (const m of merged) {
    if (!m.parentId) continue;
    const list = childrenByParent.get(m.parentId);
    if (list) list.push(m.id);
    else childrenByParent.set(m.parentId, [m.id]);
  }
  return merged.map((m) => ({ ...m, childrenIds: childrenByParent.get(m.id) ?? [] }));
};

export interface MessageTree {
  byId: Map<string, Message>;
  childrenOf: Map<string | null, Message[]>;
  roots: Message[];
}

const EMPTY_TREE: MessageTree = {
  byId: new Map(),
  childrenOf: new Map(),
  roots: [],
};

export const indexMessages = (messages: Message[]): MessageTree => {
  if (messages.length === 0) return EMPTY_TREE;

  const byId = new Map<string, Message>();
  for (const msg of messages) byId.set(msg.id, msg);

  const childrenOf = new Map<string | null, Message[]>();
  for (const msg of messages) {
    const parent = msg.parentId ?? null;
    const list = childrenOf.get(parent) ?? [];
    list.push(msg);
    childrenOf.set(parent, list);
  }

  // Sort each siblings list by timestamp so the switcher UI presents
  // branches in creation order. Stable sort preserves array order on ties.
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp);
  }

  const roots = childrenOf.get(null) ?? [];
  return { byId, childrenOf, roots };
};

// Walk from leaf back to root, return path root-first.
export const pathToRoot = (tree: MessageTree, leafId: string | null | undefined): Message[] => {
  if (!leafId) return [];
  const path: Message[] = [];
  let cur = tree.byId.get(leafId);
  // Guard against cycles from corrupted data.
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    path.push(cur);
    seen.add(cur.id);
    cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
  }
  return path.reverse();
};

// Find the deepest leaf reachable from `fromId` by always descending
// through childrenIds[0]. Used when the user switches a sibling mid-
// conversation: the new active leaf is whatever branch currently ends
// at, walking down from the switched node.
export const deepestLeaf = (tree: MessageTree, fromId: string): Message | null => {
  const start = tree.byId.get(fromId);
  if (!start) return null;

  const seen = new Set<string>();
  let cur: Message = start;
  while (!seen.has(cur.id)) {
    seen.add(cur.id);
    const children = tree.childrenOf.get(cur.id) ?? [];
    if (children.length === 0) break;
    // Prefer the most recently touched child so that the user's last
    // active branch is the one we descend into. Falls back to first.
    const next = children.reduce((acc, c) => (c.timestamp > acc.timestamp ? c : acc), children[0]);
    cur = next;
  }
  return cur;
};

// Resolve the active leaf for a given starting point. If the start is
// already a leaf, returns it; otherwise walks down via deepestLeaf.
export const resolveLeaf = (
  tree: MessageTree,
  startId: string | null | undefined
): string | null => {
  if (!startId) return null;
  const start = tree.byId.get(startId);
  if (!start) return null;
  const children = tree.childrenOf.get(start.id) ?? [];
  if (children.length === 0) return start.id;
  // start.id is guaranteed in byId, so deepestLeaf cannot miss; the null
  // check is for the type system rather than a realizable runtime state.
  return deepestLeaf(tree, start.id)?.id ?? start.id;
};

// Get siblings sharing the same parent (and same role) as the given
// message. The branch switcher UI navigates this list.
export const siblingsOf = (tree: MessageTree, msgId: string): Message[] => {
  const msg = tree.byId.get(msgId);
  if (!msg) return [];
  const parent = msg.parentId ?? null;
  const sameParent = tree.childrenOf.get(parent) ?? [];
  return sameParent.filter((m) => m.role === msg.role);
};

// React hook wrapping the index for memoization.
export const useMessageTree = (messages: Message[]): MessageTree =>
  useMemo(() => indexMessages(messages), [messages]);
