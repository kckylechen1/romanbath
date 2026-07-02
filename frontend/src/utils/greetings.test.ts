import { describe, expect, it } from 'vitest';
import { buildGreetingOptions, wrapIndex } from './greetings';

describe('buildGreetingOptions', () => {
  it('puts firstMessage first, then alternates', () => {
    expect(buildGreetingOptions('hi', ['alt1', 'alt2'])).toEqual(['hi', 'alt1', 'alt2']);
  });

  it('drops empty / whitespace-only entries', () => {
    expect(buildGreetingOptions('hi', ['', '   ', 'alt'])).toEqual(['hi', 'alt']);
    expect(buildGreetingOptions('', ['alt'])).toEqual(['alt']);
  });

  it('collapses exact duplicates by trimmed text', () => {
    expect(buildGreetingOptions('hi', ['hi', 'hi ', 'alt'])).toEqual(['hi', 'alt']);
  });

  it('preserves original (untrimmed) text in the output', () => {
    expect(buildGreetingOptions('  spaced  ', ['alt'])).toEqual(['  spaced  ', 'alt']);
  });

  it('handles missing alternates', () => {
    expect(buildGreetingOptions('hi', undefined)).toEqual(['hi']);
    expect(buildGreetingOptions(undefined, undefined)).toEqual([]);
  });
});

describe('wrapIndex', () => {
  it('returns the index when in range', () => {
    expect(wrapIndex(1, 3)).toBe(1);
  });
  it('wraps past the end', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(4, 3)).toBe(1);
  });
  it('wraps below zero', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-4, 3)).toBe(2);
  });
  it('returns 0 for non-positive length', () => {
    expect(wrapIndex(2, 0)).toBe(0);
  });
});
