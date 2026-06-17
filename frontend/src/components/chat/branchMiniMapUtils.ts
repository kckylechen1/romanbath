import type { Message } from "../../types";

// Pure leaf extraction for the branch mini-map. Leaves are messages with no
// children. Sorted by timestamp ascending so the dot row reflects creation
// order and stays stable as new branches spawn.
export const collectLeaves = (messages: Message[]): Message[] => {
  const leaves = messages.filter(
    (m) => !m.childrenIds || m.childrenIds.length === 0,
  );
  return [...leaves].sort((a, b) => a.timestamp - b.timestamp);
};

// Compact timestamp formatter for the hover tooltip. Uses a fixed locale
// string rather than a relative "5m ago" so the function stays pure (no
// Date.now call) — keeps the lint purity rule happy and the label stable.
export const formatLeafTimestamp = (ts: number): string => {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} ${time}`;
};

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max).trimEnd()}...`;

// Stable join used as a memo key for leaf-identity comparison.
export const leafIdHash = (ids: string[]): string => ids.join("|");
