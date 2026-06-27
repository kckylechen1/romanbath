import { Character } from '../types';

// Relative paths — Vite dev server proxies these to zeroclaw gateway.
const TOKEN_KEY = 'zeroclaw_token';

// ── Auth / Token helpers ──

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY) ?? null;

export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);

export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

const jsonHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

// ── Pairing ──

// Pairing promise cache. Before this was added, every API call ran
// ensurePairing() independently — N concurrent requests triggered N
// /health fetches (and potentially N pairing-code round-trips if the
// token was missing). Now the first call drives the flow and every
// concurrent caller awaits the same promise. The cache clears on
// failure so the next call retries, and clears on token change so a
// fresh `setToken` re-evaluates against /health.
let pairingPromise: Promise<void> | null = null;

export const invalidatePairingCache = (): void => {
  pairingPromise = null;
};

export const ensurePairing = async (): Promise<void> => {
  if (pairingPromise) return pairingPromise;

  pairingPromise = (async () => {
    const existingToken = getToken();
    if (existingToken) {
      try {
        const health = await fetch('/health', {
          headers: { Authorization: `Bearer ${existingToken}` },
        });
        if (health.ok) {
          const data = await health.json();
          if (data.paired) return;
        }
      } catch {
        // Gateway might not be reachable; continue to pair
      }
    }

    const codeRes = await fetch('/pair/code');
    if (!codeRes.ok) {
      throw new Error(`Failed to fetch pairing code: ${codeRes.status}`);
    }
    const data = await codeRes.json();
    let code = data.pairing_code;
    if (!code) {
      const newCodeRes = await fetch('/admin/paircode/new', { method: 'POST' });
      if (newCodeRes.ok) {
        const nd = await newCodeRes.json();
        code = nd.pairing_code;
      }
    }
    if (!code) {
      const health = await fetch('/health');
      if (health.ok) {
        const h = await health.json();
        if (h.paired) return;
      }
      throw new Error('No pairing code available. Restart the gateway to generate one.');
    }

    const pairRes = await fetch('/pair', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pairing-Code': code,
      },
    });
    if (!pairRes.ok) {
      throw new Error(`Pairing failed: ${pairRes.status}`);
    }
    const result = await pairRes.json();
    if (result.token) {
      setToken(result.token);
    }
  })().catch((err: unknown) => {
    pairingPromise = null; // allow next call to retry
    throw err;
  });

  return pairingPromise;
};

// ── Types ──

export interface MemoryEntry {
  id: string;
  text: string;
  summary?: string;
  category: string;
  importance: number;
  timestamp: string;
  tier: string;
  keywords: string[];
  entities: string[];
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatOptions {
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  topK: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  stop: string[] | null;
  seed: number | null;
  userName: string | null;
  userDescription: string | null;
  sceneMode: boolean | null;
  scenario?: string | null;
  exampleDialogue?: string | null;
  lorebook?: Array<{ id?: string; keys: string[]; content: string; enabled: boolean }> | null;
  systemPromptOverride?: string | null;
  authorsNote?: string | null;
  authorsNoteDepth?: number | null;
  promptOrder?: 'default' | 'style_first' | 'scenario_last' | null;
  userPrefix?: string | null;
  modelPrefix?: string | null;
  contextTemplate?: string | null;
  promptTemplate?: string | null;
  negativePrompt?: string | null;
}

export interface CharacterBookEntry {
  // Server-assigned entry id. New clients store it; old cards loaded
  // without ids get backfilled via replaceCharacterBook on first edit.
  id?: string;
  keys: string[];
  secondaryKeys?: string[];
  content: string;
  enabled: boolean;
  selective: boolean;
  constant: boolean;
  position: 'before_char' | 'after_char';
  tokenBudget?: number;
  priority?: number;
  recursive: boolean;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  entries: CharacterBookEntry[];
}

export interface CharacterFormData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  alternateGreetings?: string[];
  exampleDialogue: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes?: string;
  tags?: string[];
  // Pass-through metadata. Sent verbatim on save so the editor doesn't
  // destroy fields it doesn't expose (creator, character_version, V3
  // fields, lorebook, extensions, custom assets).
  assets?: CharacterAsset[];
  creator?: string;
  characterVersion?: string;
  nickname?: string;
  groupOnlyGreetings?: string[];
  source?: string[];
  characterBook?: CharacterBook | null;
  extensions?: Record<string, unknown>;
  // Companion affect persona (XiaoIce eR analog). Stored in
  // extensions.companion on the character card. Controls how the
  // zeroclaw-affect module modulates warmth/energy around a baseline
  // when this character responds.
  companion?: CompanionPersonaConfig | null;
  // The pending avatar file is held in the editor and uploaded separately
  // after the character data is saved (so avatar errors don't block the
  // card update and rename semantics stay clean).
  avatarFile?: File | null;
  removeAvatar?: boolean;
}

/// Companion affect persona stored in extensions.companion.
export interface CompanionPersonaConfig {
  archetype: 'nurturing' | 'playful' | 'steady';
  base_warmth: number; // 0.0..=1.0
  base_energy: number; // 0.0..=1.0
}

export interface CharacterSummary {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  tags: string[];
  creator: string;
  character_version: string;
  has_avatar: boolean;
  // V3 fields — always present, may be defaults for legacy cards.
  nickname: string;
  has_character_book: boolean;
  has_assets: boolean;
  alternate_greeting_count: number;
  creator_notes_badge: string | null;
  modification_date: string | null;
}

interface CharacterAsset {
  type: string;
  uri: string;
  name: string;
  ext?: string;
}

interface CharacterDataResponse {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  creator_notes: string;
  tags: string[];
  creator: string;
  character_version: string;
  nickname: string;
  group_only_greetings: string[];
  source: string[];
  character_book: CharacterBook | null;
  extensions: Record<string, unknown>;
}

const characterAvatarUrl = (name: string): string =>
  `/api/characters/${encodeURIComponent(name)}/avatar`;

// Module-level cache buster. Bumped after avatar upload/delete so the
// browser refetches the new image instead of serving the cached one.
let avatarCacheVersion = Date.now();

export const bumpAvatarVersion = (): void => {
  avatarCacheVersion = Date.now();
};

interface CharacterBookEntryWire extends Omit<CharacterBookEntry, 'secondaryKeys' | 'tokenBudget'> {
  // SillyTavern spec uses snake_case and `uid` as the legacy entry id.
  secondary_keys?: string[];
  token_budget?: number;
  secondaryKeys?: string[];
  tokenBudget?: number;
  uid?: number | string;
}

interface CharacterBookWire extends Omit<CharacterBook, 'entries'> {
  entries: CharacterBookEntryWire[];
}

const isNonEmptyString = (value: string | null | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const mapBookEntryToForm = (entry: CharacterBookEntryWire): CharacterBookEntry => {
  const formEntry = entry as CharacterBookEntryWire & Record<string, unknown>;
  return {
    ...formEntry,
    keys: entry.keys ?? [],
    secondaryKeys: entry.secondaryKeys ?? entry.secondary_keys ?? [],
    content: entry.content ?? '',
    enabled: entry.enabled ?? true,
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    position: entry.position ?? 'before_char',
    tokenBudget: entry.tokenBudget ?? entry.token_budget,
    priority: entry.priority,
    recursive: entry.recursive ?? false,
  };
};

const mapBookToForm = (book: CharacterBook | null): CharacterBook | null => {
  if (!book) return null;
  const wireBook = book as CharacterBookWire;
  return {
    ...wireBook,
    name: wireBook.name ?? '',
    description: wireBook.description ?? '',
    entries: (wireBook.entries ?? []).map(mapBookEntryToForm),
  };
};

const mapBookEntryToWire = (entry: CharacterBookEntry): CharacterBookEntryWire => {
  const wireEntry = { ...(entry as CharacterBookEntryWire) };
  const secondaryKeys = entry.secondaryKeys ?? wireEntry.secondary_keys ?? [];
  const tokenBudget = entry.tokenBudget ?? wireEntry.token_budget;
  delete wireEntry.secondaryKeys;
  delete wireEntry.tokenBudget;
  return {
    ...wireEntry,
    keys: entry.keys ?? [],
    secondary_keys: secondaryKeys,
    content: entry.content ?? '',
    enabled: entry.enabled ?? true,
    selective: entry.selective ?? false,
    constant: entry.constant ?? false,
    position: entry.position ?? 'before_char',
    ...(tokenBudget == null ? {} : { token_budget: tokenBudget }),
    priority: entry.priority,
    recursive: entry.recursive ?? false,
  };
};

const mapBookToWire = (book: CharacterBook | null | undefined): CharacterBookWire | null => {
  if (!book) return null;
  return {
    ...book,
    name: book.name ?? '',
    description: book.description ?? '',
    entries: (book.entries ?? []).map(mapBookEntryToWire),
  };
};

const mapSummaryToCharacter = (char: CharacterSummary): Character => {
  let systemInstruction = '';
  if (char.personality) systemInstruction += char.personality + '\n\n';
  if (char.scenario) systemInstruction += `[Scenario: ${char.scenario}]\n\n`;

  return {
    id: char.name,
    name: char.name,
    avatar: char.has_avatar ? `${characterAvatarUrl(char.name)}?v=${avatarCacheVersion}` : '',
    description: char.description || '',
    systemInstruction: systemInstruction.trim(),
    firstMessage: char.first_mes || '',
    backgroundImage: `https://picsum.photos/seed/${encodeURIComponent(char.name + '-bg')}/1920/1080?blur=2`,
    // V3 summary fields. Older gateways omit them, so fall back to
    // sensible defaults instead of surfacing `undefined` to the UI.
    nickname: char.nickname ?? '',
    tags: char.tags ?? [],
    creator: char.creator ?? '',
    hasCharacterBook: char.has_character_book ?? false,
    hasAssets: char.has_assets ?? false,
    alternateGreetingCount: char.alternate_greeting_count ?? 0,
    creatorNotesBadge: char.creator_notes_badge ?? null,
    modificationDate: char.modification_date ?? null,
  };
};

const parseCompanionConfig = (
  extensions: Record<string, unknown>
): CompanionPersonaConfig | null => {
  const raw = extensions.companion;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const archetype = c.archetype;
  if (archetype !== 'nurturing' && archetype !== 'playful' && archetype !== 'steady') {
    return null;
  }
  return {
    archetype,
    base_warmth: typeof c.base_warmth === 'number' ? c.base_warmth : 0.6,
    base_energy: typeof c.base_energy === 'number' ? c.base_energy : 0.5,
  };
};

const serializeCompanionConfig = (
  companion: CompanionPersonaConfig | null | undefined
): Record<string, unknown> | null => {
  if (!companion) return null;
  return {
    archetype: companion.archetype,
    base_warmth: companion.base_warmth,
    base_energy: companion.base_energy,
  };
};

export const formToCharacterData = (data: CharacterFormData): Record<string, unknown> => {
  const extensions = { ...(data.extensions ?? {}) };
  const companionWire = serializeCompanionConfig(data.companion);
  if (companionWire) {
    extensions.companion = companionWire;
  } else {
    delete extensions.companion;
  }
  return {
    name: data.name,
    description: data.description || '',
    personality: data.personality || '',
    scenario: data.scenario || '',
    first_mes: data.firstMessage || '',
    mes_example: data.exampleDialogue || '',
    system_prompt: data.systemPrompt || '',
    post_history_instructions: data.postHistoryInstructions || '',
    alternate_greetings: data.alternateGreetings ?? [],
    creator_notes: data.creatorNotes || '',
    tags: data.tags ?? [],
    assets: data.assets ?? [],
    creator: data.creator ?? '',
    character_version: data.characterVersion ?? '',
    nickname: data.nickname ?? '',
    group_only_greetings: data.groupOnlyGreetings ?? [],
    source: data.source ?? [],
    character_book: mapBookToWire(data.characterBook),
    extensions,
  };
};

export const mapDetailsToForm = (char: CharacterDataResponse): CharacterFormData => {
  const extensions = char.extensions || {};
  return {
    name: char.name || '',
    description: char.description || '',
    personality: char.personality || '',
    scenario: char.scenario || '',
    firstMessage: char.first_mes || '',
    alternateGreetings: char.alternate_greetings || [],
    exampleDialogue: char.mes_example || '',
    systemPrompt: char.system_prompt || '',
    postHistoryInstructions: char.post_history_instructions || '',
    creatorNotes: char.creator_notes || '',
    tags: char.tags || [],
    creator: char.creator || '',
    characterVersion: char.character_version || '',
    nickname: char.nickname || '',
    groupOnlyGreetings: char.group_only_greetings || [],
    source: char.source || [],
    characterBook: mapBookToForm(char.character_book),
    extensions,
    companion: parseCompanionConfig(extensions),
  };
};

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export const buildOptionsBody = (options: ChatOptions): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  if (options.temperature !== null) body.temperature = options.temperature;
  if (options.maxTokens !== null) body.max_tokens = options.maxTokens;
  if (options.topP !== null) body.top_p = options.topP;
  if (options.topK !== null) body.top_k = options.topK;
  if (options.frequencyPenalty !== null) body.frequency_penalty = options.frequencyPenalty;
  if (options.presencePenalty !== null) body.presence_penalty = options.presencePenalty;
  if (options.stop !== null) body.stop = options.stop;
  if (options.seed !== null) body.seed = options.seed;
  if (options.userName !== null) body.user_name = options.userName;
  if (options.userDescription !== null) body.user_description = options.userDescription;
  if (options.sceneMode) body.scene_mode = options.sceneMode;
  if (isNonEmptyString(options.scenario)) body.scenario = options.scenario;
  if (isNonEmptyString(options.exampleDialogue)) body.example_dialogue = options.exampleDialogue;
  if (options.lorebook?.length) body.lorebook = options.lorebook;
  if (isNonEmptyString(options.systemPromptOverride)) {
    body.system_prompt_override = options.systemPromptOverride;
  }
  if (isNonEmptyString(options.authorsNote)) {
    body.authors_note = options.authorsNote;
  }
  if (
    isNonEmptyString(options.authorsNote) &&
    options.authorsNoteDepth !== null &&
    options.authorsNoteDepth !== undefined
  ) {
    body.authors_note_depth = options.authorsNoteDepth;
  }
  if (options.promptOrder && options.promptOrder !== 'default')
    body.prompt_order = options.promptOrder;
  if (isNonEmptyString(options.userPrefix)) body.user_prefix = options.userPrefix;
  if (isNonEmptyString(options.modelPrefix)) body.model_prefix = options.modelPrefix;
  if (isNonEmptyString(options.contextTemplate)) body.context_template = options.contextTemplate;
  if (isNonEmptyString(options.promptTemplate)) body.prompt_template = options.promptTemplate;
  if (isNonEmptyString(options.negativePrompt)) body.negative_prompt = options.negativePrompt;
  return body;
};

// ── Character API ──

export type CharacterSort = 'name' | 'recent' | 'created';

export interface GetCharactersOptions {
  search?: string;
  tag?: string;
  creator?: string;
  sort?: CharacterSort;
}

const buildCharactersQuery = (opts?: GetCharactersOptions): string => {
  if (!opts) return '';
  const params = new URLSearchParams();
  if (opts.search && opts.search.trim()) params.set('search', opts.search.trim());
  if (opts.tag && opts.tag.trim()) params.set('tag', opts.tag.trim());
  if (opts.creator && opts.creator.trim()) params.set('creator', opts.creator.trim());
  if (opts.sort) params.set('sort', opts.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
};

export const getCharacters = async (opts?: GetCharactersOptions): Promise<Character[]> => {
  const loadList = async (): Promise<Character[]> => {
    const res = await fetch(`/api/characters${buildCharactersQuery(opts)}`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch characters: ${res.status}`);
    const data = await res.json();
    const summaries: CharacterSummary[] = data.characters ?? [];
    return summaries.map(mapSummaryToCharacter);
  };

  try {
    return await loadList();
  } catch (e) {
    console.warn('Failed to load characters (first attempt):', e);
  }

  try {
    await ensurePairing();
    return await loadList();
  } catch (e) {
    console.warn('Failed to load characters from gateway:', e);
    return [];
  }
};

export const getSettings = async (): Promise<Record<string, unknown>> => ({});

export const getCharacterDetails = async (
  characterId: string
): Promise<CharacterFormData | null> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as CharacterDataResponse;
    return mapDetailsToForm(data);
  } catch (e) {
    console.error('Error getting character details:', e);
    return null;
  }
};

const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB

export const importCharacterCard = async (
  file: File
): Promise<{ success: boolean; fileName?: string; error?: string }> => {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const supportedFormats = ['png', 'json', 'webp'];
  if (!supportedFormats.includes(extension)) {
    return {
      success: false,
      error: `Unsupported file format: ${extension}. Supported: ${supportedFormats.join(', ')}`,
    };
  }
  if (file.size > MAX_IMPORT_SIZE) {
    return {
      success: false,
      error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max: 10MB.`,
    };
  }

  try {
    await ensurePairing();
    const data_base64 = await fileToBase64(file);
    const res = await fetch('/api/characters/upload', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ filename: file.name, data_base64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || `Import failed: ${res.status}` };
    }
    const data = await res.json();
    return { success: true, fileName: data.name };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Import failed',
    };
  }
};

export const duplicateCharacter = async (
  characterId: string
): Promise<{ success: boolean; fileName?: string; error?: string }> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/duplicate`, {
      method: 'POST',
      headers: jsonHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Duplicate failed' };
    }
    const data = await res.json();
    return { success: true, fileName: data.name };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Duplicate failed',
    };
  }
};

export const exportCharacter = async (characterId: string): Promise<Blob | null> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(characterId)}/export`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) return null;
    return res.blob();
  } catch {
    return null;
  }
};

export const uploadCharacterAvatar = async (
  characterName: string,
  file: File
): Promise<{ success: boolean; error?: string }> => {
  try {
    await ensurePairing();
    const data_base64 = await fileToBase64(file);
    const res = await fetch(`/api/characters/${encodeURIComponent(characterName)}/avatar`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ data_base64 }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Avatar upload failed' };
    }
    bumpAvatarVersion();
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Avatar upload failed',
    };
  }
};

export const hasCharacterAvatar = async (characterName: string): Promise<boolean> => {
  try {
    await ensurePairing();
    const res = await fetch(characterAvatarUrl(characterName), { headers: jsonHeaders() });
    return res.ok;
  } catch {
    return false;
  }
};

export const deleteCharacterAvatar = async (
  characterName: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    await ensurePairing();
    const res = await fetch(characterAvatarUrl(characterName), {
      method: 'DELETE',
      headers: jsonHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Avatar delete failed' };
    }
    bumpAvatarVersion();
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Avatar delete failed',
    };
  }
};

export const createCharacter = async (
  data: CharacterFormData
): Promise<{ success: boolean; error: string; fileName?: string }> => {
  try {
    await ensurePairing();
    const res = await fetch('/api/characters', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(formToCharacterData(data)),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Create failed' };
    }
    const result = await res.json();
    return { success: true, error: '', fileName: result.name };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Create failed',
    };
  }
};

export const updateCharacter = async (
  id: string,
  data: CharacterFormData
): Promise<{ success: boolean; error: string }> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify(formToCharacterData(data)),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Update failed' };
    }
    return { success: true, error: '' };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Update failed',
    };
  }
};

export const deleteCharacter = async (id: string): Promise<{ success: boolean; error: string }> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { success: false, error: err.error || 'Delete failed' };
    }
    return { success: true, error: '' };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Delete failed',
    };
  }
};

// ── Character Book (Lorebook) API ──
// These endpoints operate on the lorebook independently of the character
// card. The frontend calls them per-entry so edits save immediately
// instead of waiting for the whole-card PUT. Entry ids are server-assigned
// and stable; callers must carry them between reads and writes.

const mapBookEntryResponse = (entry: unknown): CharacterBookEntry => {
  // The server may return either camelCase (our wire format) or snake_case
  // (raw SillyTavern spec). Normalize defensively like the rest of the
  // service does so the editor never sees an undefined field.
  const e = entry as CharacterBookEntryWire;
  const id = typeof e.id === 'string' && e.id ? e.id : e.uid != null ? String(e.uid) : '';
  const secondaryKeys = e.secondaryKeys ?? e.secondary_keys ?? [];
  const tokenBudget = e.tokenBudget ?? e.token_budget;
  return {
    id,
    keys: e.keys ?? [],
    secondaryKeys,
    content: e.content ?? '',
    enabled: e.enabled ?? true,
    selective: e.selective ?? false,
    constant: e.constant ?? false,
    position: e.position ?? 'before_char',
    tokenBudget,
    priority: e.priority,
    recursive: e.recursive ?? false,
  };
};

const mapBookResponse = (book: unknown): CharacterBook => {
  const b = book as CharacterBookWire;
  return {
    name: b.name ?? '',
    description: b.description ?? '',
    entries: (b.entries ?? []).map(mapBookEntryResponse),
  };
};

export const getCharacterBook = async (name: string): Promise<CharacterBook | null> => {
  try {
    await ensurePairing();
    const res = await fetch(`/api/characters/${encodeURIComponent(name)}/book`, {
      headers: jsonHeaders(),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { book: CharacterBook | null };
    return data.book ? mapBookResponse(data.book) : null;
  } catch (e) {
    console.error('Error getting character book:', e);
    return null;
  }
};

export const replaceCharacterBook = async (
  name: string,
  book: CharacterBook
): Promise<CharacterBook> => {
  await ensurePairing();
  const res = await fetch(`/api/characters/${encodeURIComponent(name)}/book`, {
    method: 'PUT',
    headers: jsonHeaders(),
    body: JSON.stringify({ book: mapBookToWire(book) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Replace book failed: ${res.status}`);
  }
  const data = (await res.json()) as { book: CharacterBook | null };
  if (!data.book) throw new Error('Replace book failed: server returned empty book');
  return mapBookResponse(data.book);
};

export const addBookEntry = async (
  name: string,
  entry: Omit<CharacterBookEntry, 'id'>
): Promise<CharacterBookEntry> => {
  await ensurePairing();
  // Omit<..., 'id'> is structurally compatible with CharacterBookEntry
  // (id is optional), but the server assigns fresh ids on POST — so we
  // never send one. Casting keeps the call to mapBookEntryToWire clean.
  const entryForWire = entry as CharacterBookEntry;
  const res = await fetch(`/api/characters/${encodeURIComponent(name)}/book/entries`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ entry: mapBookEntryToWire({ ...entryForWire, id: undefined }) }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Add entry failed: ${res.status}`);
  }
  const data = (await res.json()) as { entry: CharacterBookEntry };
  return mapBookEntryResponse(data.entry);
};

export const updateBookEntry = async (
  name: string,
  entryId: string,
  entry: CharacterBookEntry
): Promise<CharacterBookEntry> => {
  await ensurePairing();
  const res = await fetch(
    `/api/characters/${encodeURIComponent(name)}/book/entries/${encodeURIComponent(entryId)}`,
    {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ entry: mapBookEntryToWire({ ...entry, id: entryId }) }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Update entry failed: ${res.status}`);
  }
  const data = (await res.json()) as { entry: CharacterBookEntry };
  return mapBookEntryResponse(data.entry);
};

export const deleteBookEntry = async (name: string, entryId: string): Promise<boolean> => {
  try {
    await ensurePairing();
    const res = await fetch(
      `/api/characters/${encodeURIComponent(name)}/book/entries/${encodeURIComponent(entryId)}`,
      { method: 'DELETE', headers: jsonHeaders() }
    );
    // 204 No Content on success.
    return res.ok;
  } catch (e) {
    console.error('Error deleting book entry:', e);
    return false;
  }
};

// ── Memory API ──

export const getCharacterMemories = async (characterName: string): Promise<MemoryEntry[]> => {
  try {
    await ensurePairing();
    // Per-character endpoint backed by the sigil ChatMemoryStore the chat
    // pipeline writes to. NOT /api/memory — that resolves the install-wide
    // backend, silently drops the path filter, and returns the wrong store.
    const res = await fetch(
      `/api/characters/${encodeURIComponent(characterName)}/memories`,
      { headers: jsonHeaders() }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.entries ?? data.memories ?? []);
  } catch (e) {
    console.error('Error fetching character memories:', e);
    return [];
  }
};

// ── Chat via POST /api/chat (SSE) — matches zeroclaw/web CharacterChat ──

// Parses an SSE byte stream into discrete event payloads. Handles the
// cases that bit the old naive parser:
//   - CRLF line endings (some proxies rewrite `\n` → `\r\n`)
//   - Lone `\r` line endings (legacy but spec-legal)
//   - Multi-line `data:` fields (concatenated with `\n` per SSE spec)
//   - Comment lines starting with `:` (heartbeat / keep-alive)
//   - Event boundaries that arrive split across read() chunks
//
// Yields one string per event — the concatenated `data:` payload, or '' for
// events with no data field (so callers can still observe keep-alives if
// they care). The caller decides what to do with each payload.
export async function* parseSseEvents(res: Response): AsyncGenerator<string, void, unknown> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  const normalizeLineEndings = (s: string): string => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += normalizeLineEndings(decoder.decode(value, { stream: true }));

    // Events are separated by one or more blank lines.
    const events = buffer.split(/\n{2,}/);
    buffer = events.pop() ?? '';

    for (const eventBlock of events) {
      const dataLines: string[] = [];
      for (const line of eventBlock.split('\n')) {
        if (line === '' || line.startsWith(':')) continue; // blank or comment
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const field = line.slice(0, colonIdx);
        let val = line.slice(colonIdx + 1);
        if (val.startsWith(' ')) val = val.slice(1); // spec: leading space stripped
        if (field === 'data') dataLines.push(val);
        // event:, id:, retry: are ignored — not needed for chat streaming
      }
      yield dataLines.join('\n');
    }
  }

  // Flush trailing event if the stream ended without a final blank line.
  if (buffer.length > 0) {
    const dataLines: string[] = [];
    for (const line of buffer.split('\n')) {
      if (line === '' || line.startsWith(':')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx);
      let val = line.slice(colonIdx + 1);
      if (val.startsWith(' ')) val = val.slice(1);
      if (field === 'data') dataLines.push(val);
    }
    if (dataLines.length > 0) yield dataLines.join('\n');
  }
}

const parseSseStream = async (
  res: Response,
  onToken: (fullText: string) => void
): Promise<string> => {
  let fullText = '';

  for await (const data of parseSseEvents(res)) {
    if (data === '[DONE]') return fullText;
    if (data === '') continue; // keep-alive with no payload
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // Malformed JSON chunk — ignore (gateway may emit advisory payloads)
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const p = parsed as Record<string, unknown>;
    if (p.error) throw new Error(String(p.error));
    if (typeof p.token === 'string') {
      fullText += p.token;
      onToken(fullText);
    }
  }

  return fullText;
};

export interface ChatRequestPayload {
  messages: ChatMessage[];
  character_name?: string;
  system_prompts?: string[];
}

export const generateTextStream = async (
  request: ChatRequestPayload,
  options: ChatOptions,
  onChunk: (chunk: string, fullText: string) => void,
  onComplete: (fullText: string) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal
): Promise<void> => {
  try {
    await ensurePairing();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: jsonHeaders(),
      signal,
      body: JSON.stringify({
        messages: request.messages,
        character_name: request.character_name ?? null,
        system_prompts: request.system_prompts ?? [],
        mode: 'play',
        stream: true,
        ...buildOptionsBody(options),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `Chat error: ${res.status}`);
    }

    let prevLen = 0;
    const fullText = await parseSseStream(res, (partial) => {
      const delta = partial.slice(prevLen);
      prevLen = partial.length;
      if (delta) onChunk(delta, partial);
    });

    onComplete(fullText);
  } catch (e) {
    onError(e instanceof Error ? e : new Error(String(e)));
  }
};

export const generateText = async (
  request: ChatRequestPayload,
  options: ChatOptions,
  signal?: AbortSignal
): Promise<string> => {
  await ensurePairing();

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: jsonHeaders(),
    signal,
    body: JSON.stringify({
      messages: request.messages,
      character_name: request.character_name ?? null,
      system_prompts: request.system_prompts ?? [],
      mode: 'play',
      stream: false,
      ...buildOptionsBody(options),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Chat error: ${res.status}`);
  }

  const data = await res.json();
  return data.text ?? '';
};

// ── Image generation ──

export const generateImage = async (
  prompt: string,
  resolution?: string
): Promise<{ url: string }> => {
  await ensurePairing();

  const res = await fetch('/api/image-gen', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      prompt,
      resolution: resolution || '1k',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Image generation error: ${res.status}`);
  }

  const data = await res.json();
  if (!data.success || !data.image_data_url) {
    throw new Error(data.error || 'Image generation failed');
  }
  return { url: data.image_data_url };
};

// ── TTS ──

export const generateSpeech = async (
  text: string,
  voiceId?: string,
  language?: string
): Promise<ArrayBuffer> => {
  await ensurePairing();

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      text,
      voice_id: voiceId || 'ara',
      language: language || 'en-US',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `TTS error: ${res.status}`);
  }

  return res.arrayBuffer();
};

// ── WebSocket Chat (for tool-enabled character chat) ──

export interface WsChatCallbacks {
  onChunk: (chunk: string, fullText: string) => void;
  onToolCall: (toolName: string) => void;
  onToolResult: (
    toolName: string,
    output: string,
    mediaUrl?: string,
    mediaType?: 'image' | 'audio' | 'video'
  ) => void;
  onDone: (fullText: string) => void;
  onError: (error: string) => void;
  onFirstMessage?: (text: string) => void;
}

const WS_URL = (agentAlias: string = 'default', token?: string, sessionId?: string) => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({ agent: agentAlias });
  if (token) params.set('token', token);
  // The query-param session_id is what the gateway turns into its session_key
  // (ws.rs builds session_key from the query param *before* reading the connect
  // frame). Sending a stable id per (character, chat thread) lets the backend
  // resume the session — seed_history + recall — instead of spinning up a fresh
  // amnesiac session on every message.
  if (sessionId) params.set('session_id', sessionId);
  return `${proto}//${window.location.host}/ws/chat?${params.toString()}`;
};

function resolveMediaUrl(
  toolName: string,
  output: string
): { url: string; type: 'image' | 'audio' | 'video' } | null {
  const isRemoteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

  const normalizePath = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith('/api/files/')) {
      return trimmed.replace(/^\/api\/files\//, '');
    }
    return trimmed.replace(/^\/+/, '');
  };

  const resolveCandidate = (candidate?: unknown): string | null => {
    if (typeof candidate !== 'string') return null;
    const value = candidate.trim();
    if (!value) return null;
    if (isRemoteUrl(value)) return value;
    if (
      !value.startsWith('images/') &&
      !value.startsWith('audio/') &&
      !value.startsWith('videos/') &&
      !value.startsWith('/api/files/')
    ) {
      return null;
    }
    return `/api/files/${normalizePath(value)}`;
  };

  try {
    const data = JSON.parse(output);
    if (
      toolName.includes('image_gen') ||
      toolName.includes('imagegen') ||
      toolName.includes('photo')
    ) {
      const filePath = resolveCandidate(
        data.image || data.image_url || data.imageUrl || data.path || data.output
      );
      if (filePath) return { url: filePath, type: 'image' };
    }
    if (toolName.includes('tts')) {
      const filePath = resolveCandidate(
        data.audio || data.audio_file || data.audioFile || data.path || data.output
      );
      if (filePath) return { url: filePath, type: 'audio' };
    }
    if (toolName.includes('video')) {
      const filePath = resolveCandidate(
        data.video || data.video_url || data.videoUrl || data.path || data.output
      );
      if (filePath) return { url: filePath, type: 'video' };
    }

    const genericCandidate = resolveCandidate(
      data.file || data.file_path || data.filePath || data.url
    );
    if (genericCandidate) {
      const type = genericCandidate.includes('/audio/')
        ? ('audio' as const)
        : genericCandidate.includes('/videos/')
          ? ('video' as const)
          : ('image' as const);
      return { url: genericCandidate, type };
    }

    // Generic: check if output contains a path-like string in images/ or audio/
    const pathMatch = output.match(/"(images\/[^"]+|audio\/[^"]+|videos\/[^"]+)"/);
    if (pathMatch) {
      const path = pathMatch[1];
      const type = path.startsWith('images/')
        ? ('image' as const)
        : path.startsWith('audio/')
          ? ('audio' as const)
          : ('video' as const);
      return { url: `/api/files/${path}`, type };
    }
  } catch {
    /* not JSON */
  }

  const fallbackMatch = output.match(/(\bapi\/files\/[^"]+|\b(images|audio|videos)\/[^"]+)/);
  if (fallbackMatch) {
    const normalized = normalizePath(fallbackMatch[0]);
    const path = normalized.startsWith('api/files/')
      ? normalized.replace(/^api\/files\//, '')
      : normalized;
    const type = path.startsWith('audio/')
      ? ('audio' as const)
      : path.startsWith('videos/')
        ? ('video' as const)
        : ('image' as const);
    return { url: `/api/files/${path}`, type };
  }

  return null;
}

export class WsChatConnection {
  private ws: WebSocket | null = null;
  private callbacks: WsChatCallbacks;
  private fullText = '';
  private token: string;
  // False while a turn is streaming (between send() and its done/error frame).
  // Lets onclose tell "closed mid-reply" (surface an error so the UI unsticks)
  // apart from "closed at rest" (silent, expected).
  private turnSettled = true;

  constructor(callbacks: WsChatCallbacks) {
    this.callbacks = callbacks;
    this.token = getToken() || '';
  }

  connect(
    characterName: string,
    mode?: string,
    userName?: string,
    agentAlias?: string,
    sessionId?: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL(agentAlias, this.token, sessionId));
      this.fullText = '';
      let opened = false;

      const timer = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(new Error('WebSocket connection timeout'));
          this.ws?.close();
        }
      }, 10000);

      this.ws.onopen = () => {
        opened = true;
        const connectFrame: Record<string, unknown> = {
          type: 'connect',
          character_name: characterName,
          character_mode: mode || 'play',
          user_name: userName || 'User',
        };
        // Mirror the session id into the connect frame too: the query param
        // drives the gateway's session_key (history resume), the connect-frame
        // id drives memory_session_id (sigil). Same value keeps them aligned.
        if (sessionId) connectFrame.session_id = sessionId;
        this.ws!.send(JSON.stringify(connectFrame));
      };

      this.ws.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data);

          switch (frame.type) {
            case 'connected':
              clearTimeout(timer);
              resolve();
              break;
            case 'chunk':
              this.fullText += frame.content || '';
              this.callbacks.onChunk(frame.content || '', this.fullText);
              break;
            case 'tool_call': {
              const toolName = frame.name || frame.tool_name || 'unknown';
              this.callbacks.onToolCall(toolName);
              break;
            }
            case 'tool_result': {
              const toolName = frame.name || frame.tool_name || 'unknown';
              const output = frame.output || '';
              const media = resolveMediaUrl(
                toolName,
                typeof output === 'string' ? output : JSON.stringify(output)
              );
              this.callbacks.onToolResult(
                toolName,
                typeof output === 'string' ? output : JSON.stringify(output),
                media?.url,
                media?.type
              );
              break;
            }
            case 'done':
              this.turnSettled = true;
              this.callbacks.onDone(this.fullText || frame.full_response || '');
              break;
            case 'error':
              this.turnSettled = true;
              this.callbacks.onError(frame.message || frame.error || 'Unknown error');
              break;
            default:
              // Ignore unknown frame types (connected acks, etc.)
              break;
          }
        } catch (e) {
          console.warn('Failed to parse WS frame:', e);
        }
      };

      this.ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('WebSocket connection failed'));
      };
      this.ws.onclose = () => {
        clearTimeout(timer);
        if (!opened) {
          // Closed before the socket ever opened — connect() never resolved.
          reject(new Error('WebSocket closed before connect'));
          return;
        }
        // Opened, but the socket dropped while a reply was still streaming.
        // Without this the turn's done/error frame never arrives and the UI
        // hangs with isTyping stuck on forever.
        if (!this.turnSettled) {
          this.turnSettled = true;
          this.callbacks.onError('Connection closed before the reply finished');
        }
      };
    });
  }

  send(content: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.turnSettled = false;
    this.ws.send(JSON.stringify({ type: 'message', content }));
    this.fullText = '';
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// ── SSE Chat Subscribe (server-initiated pushes) ───────────────────
// Connects to /api/chat/subscribe?agent=X&character=Y to receive
// pushes from cron-fired "always-on" messages, dreaming milestones,
// etc. Uses the native EventSource API — simpler than WS for the
// one-way server→client push channel.

export interface ChatPushEvent {
  type: 'chat_push';
  agent_alias: string;
  character_name: string;
  push_kind: string; // 'cron' | 'always_on' | 'dreaming' | 'sync' | ...
  content: string;
  ts: string; // ISO 8601
  metadata?: Record<string, unknown>;
}

export interface ChatPushCallbacks {
  onPush: (event: ChatPushEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export class ChatPushSubscriber {
  private source: EventSource | null = null;
  private callbacks: ChatPushCallbacks;
  private agentAlias: string;
  private characterName?: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;
  private static RECONNECT_DELAY_MS = 5000;

  constructor(agentAlias: string, callbacks: ChatPushCallbacks, characterName?: string) {
    this.agentAlias = agentAlias;
    this.characterName = characterName;
    this.callbacks = callbacks;
  }

  connect(): void {
    if (this.source) return;
    this.shouldReconnect = true;

    const params = new URLSearchParams({ agent: this.agentAlias });
    if (this.characterName) params.set('character', this.characterName);

    // EventSource doesn't support custom headers. The token goes as
    // a query param — the gateway accepts ?token= for SSE the same way
    // it does for WS upgrades.
    const token = getToken();
    if (token) params.set('token', token);

    this.source = new EventSource(`/api/chat/subscribe?${params.toString()}`);

    this.source.onopen = () => {
      this.callbacks.onOpen?.();
    };

    this.source.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as ChatPushEvent;
        if (parsed.type === 'chat_push') {
          this.callbacks.onPush(parsed);
        }
      } catch {
        // Ignore malformed events (keep-alive comments, partial data)
      }
    };

    this.source.onerror = (ev) => {
      this.callbacks.onError?.(ev);
      this.source?.close();
      this.source = null;
      if (this.shouldReconnect) {
        this.reconnectTimer = setTimeout(
          () => this.connect(),
          ChatPushSubscriber.RECONNECT_DELAY_MS
        );
      }
    };
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }

  updateCharacter(characterName?: string): void {
    if (this.characterName === characterName) return;
    this.characterName = characterName;
    // Reconnect with the new character filter
    this.disconnect();
    this.shouldReconnect = true;
    this.connect();
  }

  get isConnected(): boolean {
    return this.source?.readyState === EventSource.OPEN;
  }
}
