import { describe, expect, it } from 'vitest';
import { approxTokens, formatCount, formatCost } from './contextFormat';
import { parseTurnContext } from '../../services/zeroclawService';

describe('approxTokens', () => {
  it('rounds up at ~4 chars per token', () => {
    expect(approxTokens(0)).toBe(0);
    expect(approxTokens(1)).toBe(1);
    expect(approxTokens(4)).toBe(1);
    expect(approxTokens(5)).toBe(2);
    expect(approxTokens(4000)).toBe(1000);
  });

  it('never returns a negative count', () => {
    expect(approxTokens(-10)).toBe(0);
  });
});

describe('formatCount', () => {
  it('renders a placeholder for null', () => {
    expect(formatCount(null)).toBe('--');
  });

  it('adds thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('rounds fractional token counts', () => {
    expect(formatCount(12.6)).toBe('13');
  });
});

describe('formatCost', () => {
  it('renders a placeholder for null', () => {
    expect(formatCost(null)).toBe('--');
  });

  it('formats to 4 decimal places with a dollar sign', () => {
    expect(formatCost(0)).toBe('$0.0000');
    expect(formatCost(0.00123)).toBe('$0.0012');
  });
});

describe('parseTurnContext', () => {
  it('reads a full done frame', () => {
    const ctx = parseTurnContext({
      recalled_memories: 'she prefers tea',
      input_tokens: 100,
      output_tokens: 40,
      tokens_used: 140,
      cost_usd: 0.0021,
      model: 'claude',
      provider: 'anthropic',
    });
    expect(ctx).toEqual({
      recalledMemories: 'she prefers tea',
      inputTokens: 100,
      outputTokens: 40,
      tokensUsed: 140,
      costUsd: 0.0021,
      model: 'claude',
      provider: 'anthropic',
    });
  });

  it('falls back to null/empty on a sparse or malformed frame', () => {
    const ctx = parseTurnContext({ input_tokens: 'oops', model: '' });
    expect(ctx).toEqual({
      recalledMemories: '',
      inputTokens: null,
      outputTokens: null,
      tokensUsed: null,
      costUsd: null,
      model: null,
      provider: null,
    });
  });
});
