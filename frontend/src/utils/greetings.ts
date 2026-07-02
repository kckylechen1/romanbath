// Pure helpers for the opening-greeting picker (UX-6). Character cards can
// carry alternateGreetings alongside firstMessage; these build the selectable
// option list and handle wrap-around cycling. No React, no I/O.

/**
 * Build the ordered list of selectable greetings: firstMessage first, then any
 * alternateGreetings. Empty/whitespace-only entries are dropped and exact
 * duplicates (by trimmed text) are collapsed so the picker never shows a blank
 * or redundant option. Original (untrimmed) text is preserved in the output so
 * the displayed greeting keeps the card's formatting.
 */
export const buildGreetingOptions = (
  firstMessage: string | undefined,
  alternateGreetings: string[] | undefined
): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (g: string | undefined): void => {
    if (typeof g !== 'string') return;
    const trimmed = g.trim();
    if (trimmed.length === 0) return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    out.push(g);
  };
  push(firstMessage);
  for (const g of alternateGreetings ?? []) push(g);
  return out;
};

/** Wrap an index into [0, length) with positive-modulo semantics so chevrons
 *  cycle past either end. Returns 0 for a non-positive length. */
export const wrapIndex = (index: number, length: number): number => {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
};
