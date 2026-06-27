// Pure helpers that decode a perceived affect state into a human-readable
// emotion readout. No React, no DOM, no I/O — kept testable so the quadrant
// mapping is verified independently of the avatar UI.
import type { AffectState } from '../services/zeroclawService';

// Below this confidence the signal is treated as not-yet-readable. MUST match
// the floor affectToGlowColor uses in App.tsx (single source of truth so the
// glow and the label agree on when a signal is "real").
export const AFFECT_CONFIDENCE_FLOOR = 0.35;

// Dead zone around the neutral center. Inside it (valence near 0 AND arousal
// near its 0.5 midpoint) the readout is "Neutral" rather than a strong quadrant
// emotion, so a faint-but-confident signal does not read as elation/tension.
const NEUTRAL_VALENCE = 0.15;
const NEUTRAL_AROUSAL = 0.15;

export interface AffectReadout {
  /** Emotion word, or "Reading..." when unknown. */
  label: string;
  /** false when affect is null or below the confidence floor. */
  known: boolean;
  /** Clamped valence (-1..1), or null when unknown. */
  valence: number | null;
  /** Clamped arousal (0..1), or null when unknown. */
  arousal: number | null;
}

/**
 * Decode an affect state into a short emotion label using a valence x arousal
 * quadrant. Valence splits at 0 (positive vs negative), arousal at its 0.5
 * midpoint (activated vs calm):
 *   high valence + high arousal => "Elated"
 *   high valence + low  arousal => "Content"
 *   low  valence + high arousal => "Tense"
 *   low  valence + low  arousal => "Subdued"
 *   near-zero (dead zone)       => "Neutral"
 * Null or low-confidence input returns an unknown "Reading..." state.
 */
export const affectToLabel = (affect: AffectState | null): AffectReadout => {
  if (!affect || affect.confidence < AFFECT_CONFIDENCE_FLOOR) {
    return { label: 'Reading...', known: false, valence: null, arousal: null };
  }

  const v = Math.max(-1, Math.min(1, affect.valence));
  const a = Math.max(0, Math.min(1, affect.arousal));

  if (Math.abs(v) <= NEUTRAL_VALENCE && Math.abs(a - 0.5) <= NEUTRAL_AROUSAL) {
    return { label: 'Neutral', known: true, valence: v, arousal: a };
  }

  const highValence = v >= 0;
  const highArousal = a >= 0.5;

  let label: string;
  if (highValence && highArousal) label = 'Elated';
  else if (highValence && !highArousal) label = 'Content';
  else if (!highValence && highArousal) label = 'Tense';
  else label = 'Subdued';

  return { label, known: true, valence: v, arousal: a };
};

/** Signed, fixed-1-decimal string: 0.42 => "+0.4", -0.3 => "-0.3". */
export const formatSigned = (n: number): string =>
  n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1);

/** Compact studio-mono readout of the raw dimensions, e.g. "v +0.4 · a 0.2".
 *  Returns "" when either dimension is unknown. */
export const formatAffectNumbers = (
  valence: number | null,
  arousal: number | null
): string => {
  if (valence === null || arousal === null) return '';
  return `v ${formatSigned(valence)} · a ${arousal.toFixed(1)}`;
};
