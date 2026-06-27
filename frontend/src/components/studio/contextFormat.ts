// Pure formatting helpers for the Studio Context inspector. Kept separate from
// the component so they can be unit-tested without a render harness.

/** Rough token estimate from a character count (the ~4 chars/token heuristic
 *  the rest of the app uses for its budget hint). Never negative. */
export const approxTokens = (chars: number): number => Math.max(0, Math.ceil(chars / 4));

/** Format an integer metric with thousands separators, or an em-dash-free
 *  placeholder when the gateway didn't report it. */
export const formatCount = (n: number | null): string =>
  n == null ? '--' : Math.round(n).toLocaleString('en-US');

/** Format a USD cost to 4 dp (turn costs are fractions of a cent), or a
 *  placeholder when absent. */
export const formatCost = (n: number | null): string =>
  n == null ? '--' : `$${n.toFixed(4)}`;
