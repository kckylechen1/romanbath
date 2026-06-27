import { describe, expect, it } from 'vitest';
import {
  AFFECT_CONFIDENCE_FLOOR,
  affectToLabel,
  formatSigned,
  formatAffectNumbers,
} from './affect';
import type { AffectState } from '../services/zeroclawService';

const mk = (valence: number, arousal: number, confidence = 0.9): AffectState => ({
  valence,
  arousal,
  label: null,
  confidence,
});

describe('affectToLabel', () => {
  it('returns the unknown "Reading..." state for null', () => {
    const r = affectToLabel(null);
    expect(r.known).toBe(false);
    expect(r.label).toBe('Reading...');
    expect(r.valence).toBeNull();
    expect(r.arousal).toBeNull();
  });

  it('returns the unknown state below the confidence floor', () => {
    const r = affectToLabel(mk(0.9, 0.9, AFFECT_CONFIDENCE_FLOOR - 0.01));
    expect(r.known).toBe(false);
    expect(r.label).toBe('Reading...');
  });

  it('is known exactly at the confidence floor', () => {
    const r = affectToLabel(mk(0.9, 0.9, AFFECT_CONFIDENCE_FLOOR));
    expect(r.known).toBe(true);
    expect(r.label).toBe('Elated');
  });

  it('maps high valence + high arousal to Elated', () => {
    expect(affectToLabel(mk(0.8, 0.9)).label).toBe('Elated');
  });

  it('maps high valence + low arousal to Content', () => {
    expect(affectToLabel(mk(0.7, 0.2)).label).toBe('Content');
  });

  it('maps low valence + high arousal to Tense', () => {
    expect(affectToLabel(mk(-0.6, 0.85)).label).toBe('Tense');
  });

  it('maps low valence + low arousal to Subdued', () => {
    expect(affectToLabel(mk(-0.7, 0.1)).label).toBe('Subdued');
  });

  it('maps the near-zero dead zone to Neutral', () => {
    expect(affectToLabel(mk(0.05, 0.5)).label).toBe('Neutral');
    expect(affectToLabel(mk(-0.1, 0.45)).label).toBe('Neutral');
  });

  it('clamps out-of-range dimensions before mapping', () => {
    const r = affectToLabel(mk(5, 5));
    expect(r.valence).toBe(1);
    expect(r.arousal).toBe(1);
    expect(r.label).toBe('Elated');
    const r2 = affectToLabel(mk(-5, -5));
    expect(r2.valence).toBe(-1);
    expect(r2.arousal).toBe(0);
    expect(r2.label).toBe('Subdued');
  });
});

describe('formatSigned', () => {
  it('prefixes a + for non-negative values', () => {
    expect(formatSigned(0.4)).toBe('+0.4');
    expect(formatSigned(0)).toBe('+0.0');
  });
  it('keeps the - for negatives', () => {
    expect(formatSigned(-0.3)).toBe('-0.3');
  });
});

describe('formatAffectNumbers', () => {
  it('formats valence and arousal in the studio-mono readout', () => {
    expect(formatAffectNumbers(0.4, 0.2)).toBe('v +0.4 · a 0.2');
    expect(formatAffectNumbers(-0.6, 0.8)).toBe('v -0.6 · a 0.8');
  });
  it('returns empty string when a dimension is unknown', () => {
    expect(formatAffectNumbers(null, 0.2)).toBe('');
    expect(formatAffectNumbers(0.4, null)).toBe('');
  });
});
