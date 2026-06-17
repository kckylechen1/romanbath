// SillyTavern-compatible macro substitution. Pure functions only — no React,
// no DOM beyond Date/Intl, no I/O. Used both for the outgoing chat request
// body (see useChatGeneration / useChatHelpers) and any client-side surface
// that needs the same expansion (e.g. rendering the first message).
//
// SillyTavern macro reference (subset implemented here):
//   {{user}}, {{char}}, {{persona}}, {{random:...}}, {{pick::...}},
//   {{roll:NdM}}, {{time}}, {{date}}, {{datetimeformat:...}},
//   {{idle_duration}}, {{model}}, {{getvar::name}}, {{// comment}}
//
// Whitespace inside braces is allowed: {{ user }} === {{user}}.
// Unknown {{...}} patterns are preserved verbatim so we don't strip macros
// the user defined elsewhere or that a future spec adds.

export interface MacroContext {
  userName: string;
  characterName: string;
  personaDescription?: string;
  // Optional getter for {{getvar::name}} — return undefined if not set.
  getVar?: (name: string) => string | undefined;
}

// Single regex, compiled once. Capture group order is load-bearing and must
// match the dispatch switch in expandMatch below.
//
//   1: comment marker `//`           {{// anything}}
//   2: pick name                     {{pick::name}}
//   3: random (double-colon) args    {{random::a,b,c}}
//   4: random (single-colon) args    {{random:a,b,c}}
//   5: roll count                    {{roll:N}} — left side of `d`
//   6: roll sides                    {{roll:dM}} — right side of `d`
//   7: datetimeformat spec           {{datetimeformat:YYYY-MM-DD HH:mm}}
//   8: getvar name                   {{getvar::name}}
//   9: plain macro name              {{user}}, {{char}}, etc.
//
// Order matters inside the alternation: double-colon forms (`random::`,
// `pick::`, `getvar::`) must be tried before their single-colon cousins
// or the greedy `[^}]+` argument capture will swallow the second colon.
// Each branch matches leading `\s*` (between `{{` and the keyword) and the
// wrapper tacks on a trailing `\s*` before `}}` so `{{ user }}` works.
const COMMENT_RE = '\\s*\\/\\/\\s*([\\s\\S]*?)\\s*';
const PICK_RE = '\\s*pick::\\s*([^}]+?)\\s*';
const RANDOM2_RE = '\\s*random::\\s*([^}]+?)\\s*';
const RANDOM1_RE = '\\s*random:\\s*([^}]+?)\\s*';
const ROLL_RE = '\\s*roll:\\s*(\\d+)d(\\d+)\\s*';
const DATETIME_RE = '\\s*datetimeformat:\\s*([^}]+?)\\s*';
const GETVAR_RE = '\\s*getvar::\\s*([^}]+?)\\s*';
const PLAIN_RE = '\\s*([a-zA-Z_][a-zA-Z0-9_-]*)\\s*';

export const MACRO_PATTERN: RegExp = new RegExp(
  `\\{\\{(?:` +
    `${COMMENT_RE}|` +
    `${PICK_RE}|` +
    `${RANDOM2_RE}|` +
    `${RANDOM1_RE}|` +
    `${ROLL_RE}|` +
    `${DATETIME_RE}|` +
    `${GETVAR_RE}|` +
    `${PLAIN_RE}` +
    `)\\}\\}`,
  'g',
);

const pad2 = (n: number): string => n.toString().padStart(2, '0');

const formatLocalTime = (date: Date, format: string): string => {
  // Minimal day.js-style subset. Only the tokens ST cards actually use.
  return format
    .replace(/YYYY/g, String(date.getFullYear()))
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/DD/g, pad2(date.getDate()))
    .replace(/HH/g, pad2(date.getHours()))
    .replace(/mm/g, pad2(date.getMinutes()))
    .replace(/ss/g, pad2(date.getSeconds()));
};

const pickRandom = (rawArgs: string): string => {
  const args = rawArgs
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (args.length === 0) return '';
  return args[Math.floor(Math.random() * args.length)] ?? '';
};

const rollDice = (count: number, sides: number): number => {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    // sides is guaranteed >= 1 by the regex; the +1 makes it inclusive.
    sum += Math.floor(Math.random() * sides) + 1;
  }
  return sum;
};

const expandMatch = (
  match: string,
  groups: ReadonlyArray<string | undefined>,
  ctx: MacroContext,
): string => {
  // `groups` is regex captures 1..N in order. Indexing must line up with
  // MACRO_PATTERN's branch order — see the capture-group map above.
  const [
    comment,
    pick,
    random2,
    random1,
    rollN,
    rollM,
    datetimeFmt,
    getVarName,
    plainName,
  ] = groups;

  if (comment !== undefined) return '';
  if (pick !== undefined) {
    // ST persists picks per-chat keyed by name; this MVP just rolls fresh
    // each time. Cards that rely on stable picks across turns will see
    // drift — fix by wiring a per-chat registry through MacroContext later.
    return pickRandom(pick);
  }
  if (random2 !== undefined) return pickRandom(random2);
  if (random1 !== undefined) return pickRandom(random1);
  if (rollN !== undefined && rollM !== undefined) {
    const n = Number.parseInt(rollN, 10);
    const m = Number.parseInt(rollM, 10);
    if (!Number.isFinite(n) || !Number.isFinite(m) || n <= 0 || m <= 0) {
      return match;
    }
    return String(rollDice(n, m));
  }
  if (datetimeFmt !== undefined) {
    return formatLocalTime(new Date(), datetimeFmt);
  }
  if (getVarName !== undefined) {
    return ctx.getVar?.(getVarName.trim()) ?? '';
  }
  if (plainName !== undefined) {
    switch (plainName) {
      case 'user':
        return ctx.userName;
      case 'char':
        return ctx.characterName;
      case 'persona':
        return ctx.personaDescription ?? '';
      case 'time':
        return formatLocalTime(new Date(), 'HH:MM');
      case 'date':
        return formatLocalTime(new Date(), 'YYYY-MM-DD');
      case 'idle_duration':
        // ST tracks time since last user message. RomanBath doesn't carry
        // that yet; surface a stable placeholder so cards parse cleanly.
        return '0s';
      case 'model':
        // Gateway doesn't echo the routed model client-side yet. When it
        // does, plumb it through MacroContext instead of hardcoding here.
        return 'unknown';
      default:
        return match;
    }
  }
  return match;
};

export const expandMacros = (text: string, ctx: MacroContext): string => {
  if (typeof text !== 'string' || text.length === 0) return text ?? '';
  // Replace manually so we can index capture groups by name rather than
  // position. String.prototype.replace would work, but the dispatch needs
  // every group's value or undefined, and getting the array slicing right
  // is fiddly. Match state is local to this call.
  let result = '';
  let lastIndex = 0;
  MACRO_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MACRO_PATTERN.exec(text)) !== null) {
    result += text.slice(lastIndex, m.index);
    result += expandMatch(m[0], m.slice(1), ctx);
    lastIndex = m.index + m[0].length;
    if (m[0].length === 0) MACRO_PATTERN.lastIndex++; // guard against zero-width loop
  }
  result += text.slice(lastIndex);
  return result;
};
