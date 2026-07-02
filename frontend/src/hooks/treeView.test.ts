import { describe, expect, it } from 'vitest';
import { Role, type Message } from '../types';
import {
  buildForkGraph,
  findRunContaining,
  activePathRuns,
  hasForks,
} from './treeView';

// Minimal message factory. Tree links are filled by linkChildren below so the
// fixtures read as plain parent declarations.
const msg = (id: string, parentId: string | null, ts: number): Message => ({
  id,
  role: id.startsWith('u') ? Role.User : Role.Model,
  content: `content ${id}`,
  timestamp: ts,
  parentId,
  childrenIds: [],
});

// Backfill childrenIds from parentId, mirroring the load-time linker.
const linkChildren = (messages: Message[]): Message[] => {
  const byId = new Map(messages.map((m) => [m.id, m]));
  for (const m of messages) m.childrenIds = [];
  for (const m of messages) {
    if (m.parentId) byId.get(m.parentId)?.childrenIds!.push(m.id);
  }
  return messages;
};

describe('buildForkGraph', () => {
  it('(a) collapses a five-message linear chain into one run with no children', () => {
    const messages = linkChildren([
      msg('a', null, 1),
      msg('b', 'a', 2),
      msg('c', 'b', 3),
      msg('d', 'c', 4),
      msg('e', 'd', 5),
    ]);
    const roots = buildForkGraph(messages);

    expect(roots).toHaveLength(1);
    const run = roots[0];
    expect(run.runMessages).toHaveLength(5);
    expect(run.runMessages.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(run.headId).toBe('a');
    expect(run.tailId).toBe('e');
    expect(run.children).toHaveLength(0);
    expect(run.depth).toBe(0);
    expect(run.siblingCount).toBe(1);
    expect(hasForks(roots)).toBe(false);
  });

  it('(b) one fork yields a head run plus two child runs with sibling counts', () => {
    // a -> b (fork) -> {c1, c2}
    const messages = linkChildren([
      msg('a', null, 1),
      msg('b', 'a', 2),
      msg('c1', 'b', 3),
      msg('c2', 'b', 4),
    ]);
    const roots = buildForkGraph(messages);

    expect(roots).toHaveLength(1);
    const head = roots[0];
    expect(head.runMessages.map((m) => m.id)).toEqual(['a', 'b']);
    expect(head.tailId).toBe('b');
    expect(head.children).toHaveLength(2);
    expect(hasForks(roots)).toBe(true);

    const [b1, b2] = head.children;
    expect(b1.headId).toBe('c1');
    expect(b1.siblingIndex).toBe(0);
    expect(b1.siblingCount).toBe(2);
    expect(b1.depth).toBe(1);
    expect(b1.children).toHaveLength(0);

    expect(b2.headId).toBe('c2');
    expect(b2.siblingIndex).toBe(1);
    expect(b2.siblingCount).toBe(2);
  });

  it('(c) supports nested forks (a branch that itself forks)', () => {
    // a -> b(fork) -> { x , y(fork) -> { y1, y2 } }
    const messages = linkChildren([
      msg('a', null, 1),
      msg('b', 'a', 2),
      msg('x', 'b', 3),
      msg('y', 'b', 4),
      msg('y1', 'y', 5),
      msg('y2', 'y', 6),
    ]);
    const roots = buildForkGraph(messages);
    const head = roots[0];
    expect(head.children).toHaveLength(2);

    const yBranch = head.children.find((c) => c.headId === 'y')!;
    expect(yBranch.runMessages.map((m) => m.id)).toEqual(['y']);
    expect(yBranch.children).toHaveLength(2);
    expect(yBranch.children.map((c) => c.headId).sort()).toEqual(['y1', 'y2']);
    expect(yBranch.children[0].depth).toBe(2);
    expect(hasForks(roots)).toBe(true);
  });

  it('(d) detects the active run and the active path of runs', () => {
    // a -> b(fork) -> { c1 -> c1b , c2 }
    const messages = linkChildren([
      msg('a', null, 1),
      msg('b', 'a', 2),
      msg('c1', 'b', 3),
      msg('c1b', 'c1', 4),
      msg('c2', 'b', 5),
    ]);
    const roots = buildForkGraph(messages);

    // Active leaf c1b lives in the c1 run.
    const run = findRunContaining(roots, 'c1b');
    expect(run).not.toBeNull();
    expect(run!.headId).toBe('c1');
    expect(run!.runMessages.map((m) => m.id)).toEqual(['c1', 'c1b']);

    // A mid-run id resolves to the same run.
    expect(findRunContaining(roots, 'c1')!.headId).toBe('c1');
    // An unknown id resolves to nothing.
    expect(findRunContaining(roots, 'nope')).toBeNull();

    // Active path: head run (a,b) then the c1 run.
    const path = activePathRuns(roots, 'c1b');
    expect(path.map((n) => n.headId)).toEqual(['a', 'c1']);

    // The off-path branch is not on the active path.
    const otherPath = activePathRuns(roots, 'c2');
    expect(otherPath.map((n) => n.headId)).toEqual(['a', 'c2']);
  });

  it('handles an empty message list', () => {
    expect(buildForkGraph([])).toEqual([]);
    expect(hasForks([])).toBe(false);
    expect(findRunContaining([], 'x')).toBeNull();
    expect(activePathRuns([], 'x')).toEqual([]);
  });
});
