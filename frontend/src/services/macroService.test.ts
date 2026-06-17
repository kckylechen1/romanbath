import { describe, expect, it } from 'vitest';
import { expandMacros, MACRO_PATTERN, type MacroContext } from './macroService';

const baseCtx = (): MacroContext => ({
  userName: 'Alex',
  characterName: 'Mara',
});

describe('expandMacros — identity substitutions', () => {
  it('substitutes {{user}}', () => {
    expect(expandMacros('You are {{user}}.', baseCtx())).toBe('You are Alex.');
  });

  it('substitutes {{char}}', () => {
    expect(expandMacros('{{char}} nods.', baseCtx())).toBe('Mara nods.');
  });

  it('substitutes {{persona}} when provided', () => {
    const ctx = { ...baseCtx(), personaDescription: 'A tired detective.' };
    expect(expandMacros('Persona: {{persona}}', ctx)).toBe(
      'Persona: A tired detective.',
    );
  });

  it('falls back to empty string for {{persona}} when missing', () => {
    expect(expandMacros('[{{persona}}]', baseCtx())).toBe('[]');
  });
});

describe('expandMacros — whitespace tolerance', () => {
  it('treats {{ user }} the same as {{user}}', () => {
    expect(expandMacros('{{ user }} / {{user}}', baseCtx())).toBe(
      'Alex / Alex',
    );
  });

  it('matches the documented MACRO_PATTERN shape', () => {
    expect(MACRO_PATTERN.global).toBe(true);
    expect('{{user}}'.match(MACRO_PATTERN)?.[0]).toBe('{{user}}');
    expect('{{ user }}'.match(MACRO_PATTERN)?.[0]).toBe('{{ user }}');
  });
});

describe('expandMacros — {{random}}', () => {
  const CHOICES = ['a', 'b', 'c'];

  it('returns one of the supplied choices across 20 trials', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const out = expandMacros('{{random:a,b,c}}', baseCtx());
      expect(CHOICES).toContain(out);
      seen.add(out);
    }
    // Over 20 trials we should see more than one distinct pick — guards
    // against a bug that always returns the same index.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('accepts the {{random::...}} double-colon form', () => {
    for (let i = 0; i < 20; i++) {
      expect(CHOICES).toContain(expandMacros('{{random::a,b,c}}', baseCtx()));
    }
  });

  it('trims whitespace around each option', () => {
    const allowed = ['x', 'y'];
    for (let i = 0; i < 20; i++) {
      expect(allowed).toContain(expandMacros('{{random: x , y }}', baseCtx()));
    }
  });
});

describe('expandMacros — {{pick}}', () => {
  // MVP: pick behaves like random — items are supplied inline. The ST
  // per-chat persistence layer is a known gap (documented in the service).
  it('picks one of the inline items across 20 trials', () => {
    const allowed = ['red', 'blue', 'green'];
    for (let i = 0; i < 20; i++) {
      expect(allowed).toContain(
        expandMacros('{{pick::red,blue,green}}', baseCtx()),
      );
    }
  });

  it('does not leak the literal token for a bare-name pick', () => {
    // Without a registry the name has nothing to split on, so the MVP
    // resolves to empty — still not the raw token, which is what we care
    // about for downstream prompt safety.
    const out = expandMacros('{{pick::mood}}', baseCtx());
    expect(out).not.toContain('{{');
  });
});

describe('expandMacros — {{roll}}', () => {
  it('produces 1..6 for {{roll:1d6}} across 20 trials', () => {
    for (let i = 0; i < 20; i++) {
      const out = Number.parseInt(expandMacros('{{roll:1d6}}', baseCtx()), 10);
      expect(out).toBeGreaterThanOrEqual(1);
      expect(out).toBeLessThanOrEqual(6);
    }
  });

  it('produces 3..18 for {{roll:3d6}} across 20 trials', () => {
    for (let i = 0; i < 20; i++) {
      const out = Number.parseInt(expandMacros('{{roll:3d6}}', baseCtx()), 10);
      expect(out).toBeGreaterThanOrEqual(3);
      expect(out).toBeLessThanOrEqual(18);
    }
  });

  it('preserves the literal token on parse failure', () => {
    expect(expandMacros('{{roll:bad}}', baseCtx())).toBe('{{roll:bad}}');
    expect(expandMacros('{{roll:0d6}}', baseCtx())).toBe('{{roll:0d6}}');
    expect(expandMacros('{{roll:2d0}}', baseCtx())).toBe('{{roll:2d0}}');
  });
});

describe('expandMacros — time / date / format', () => {
  it('expands {{time}} to HH:MM shape', () => {
    expect(expandMacros('{{time}}', baseCtx())).toMatch(/^\d{2}:\d{2}$/);
  });

  it('expands {{date}} to YYYY-MM-DD shape', () => {
    expect(expandMacros('{{date}}', baseCtx())).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    );
  });

  it('expands {{datetimeformat:YYYY-MM-DD HH:mm:ss}}', () => {
    expect(
      expandMacros('{{datetimeformat:YYYY-MM-DD HH:mm:ss}}', baseCtx()),
    ).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('expandMacros — placeholders / variables / comments', () => {
  it('returns the documented placeholder for {{idle_duration}}', () => {
    expect(expandMacros('{{idle_duration}}', baseCtx())).toBe('0s');
  });

  it('returns the documented placeholder for {{model}}', () => {
    expect(expandMacros('{{model}}', baseCtx())).toBe('unknown');
  });

  it('resolves {{getvar::name}} through the ctx getter', () => {
    const ctx: MacroContext = {
      ...baseCtx(),
      getVar: (name) => (name === 'mood' ? 'tense' : undefined),
    };
    expect(expandMacros('Mood: {{getvar::mood}}', ctx)).toBe('Mood: tense');
  });

  it('returns empty string when getvar misses and no getter is set', () => {
    expect(expandMacros('[{{getvar::missing}}]', baseCtx())).toBe('[]');
  });

  it('strips {{// comment}} entirely', () => {
    expect(expandMacros('a{{// hidden}}b', baseCtx())).toBe('ab');
  });
});

describe('expandMacros — preservation and edge cases', () => {
  it('preserves unknown macros verbatim', () => {
    expect(expandMacros('{{unknown_macro}}', baseCtx())).toBe(
      '{{unknown_macro}}',
    );
  });

  it('expands every macro in a multi-macro string', () => {
    const out = expandMacros(
      '{{char}} talks to {{user}} about {{random:tea,whiskey}}. ({{roll:1d20}})',
      baseCtx(),
    );
    expect(out.startsWith('Mara talks to Alex about ')).toBe(true);
    expect(['tea', 'whiskey']).toContain(
      out.slice('Mara talks to Alex about '.length).split('.')[0],
    );
    expect(out).toMatch(/\.\s\((\d+)\)$/);
  });

  it('returns empty string for empty input', () => {
    expect(expandMacros('', baseCtx())).toBe('');
  });

  it('preserves plain text without macros', () => {
    expect(expandMacros('just plain text', baseCtx())).toBe('just plain text');
  });

  it('does not crash when ctx values are undefined-ish', () => {
    const ctx: MacroContext = { userName: '', characterName: '' };
    expect(expandMacros('{{user}}{{char}}', ctx)).toBe('');
  });
});
