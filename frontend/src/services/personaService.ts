/**
 * Persona Management Service
 * Handles saving, loading, and managing multiple user personas
 */

import { Persona } from '../types';

const STORAGE_PREFIX = 'romanbath';
const LEGACY_STORAGE_PREFIXES = ['etheria'] as const;

const PERSONAS_KEY = `${STORAGE_PREFIX}_personas`;
const LEGACY_PERSONAS_KEYS = LEGACY_STORAGE_PREFIXES.map(prefix => `${prefix}_personas`);

const ACTIVE_PERSONA_KEY = `${STORAGE_PREFIX}_active_persona`;
const LEGACY_ACTIVE_PERSONA_KEYS = LEGACY_STORAGE_PREFIXES.map(prefix => `${prefix}_active_persona`);

const getItemWithLegacyFallback = (primaryKey: string, legacyKeys: string[]): string | null => {
    const current = localStorage.getItem(primaryKey);
    if (current !== null) return current;

    for (const legacyKey of legacyKeys) {
        const legacyValue = localStorage.getItem(legacyKey);
        if (legacyValue !== null) {
            localStorage.setItem(primaryKey, legacyValue);
            return legacyValue;
        }
    }

    return null;
};

const setItemForAllKeys = (primaryKey: string, legacyKeys: string[], value: string): void => {
    localStorage.setItem(primaryKey, value);
    for (const legacyKey of legacyKeys) {
        localStorage.setItem(legacyKey, value);
    }
};

const removeItemForAllKeys = (primaryKey: string, legacyKeys: string[]): void => {
    localStorage.removeItem(primaryKey);
    for (const legacyKey of legacyKeys) {
        localStorage.removeItem(legacyKey);
    }
};

// Generate unique ID
const generateId = (): string => {
    return 'persona_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
};

// Get all saved personas
export const getPersonas = (): Persona[] => {
    try {
        const stored = getItemWithLegacyFallback(PERSONAS_KEY, LEGACY_PERSONAS_KEYS);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to load personas:', e);
    }
    return [];
};

// Save all personas
export const savePersonas = (personas: Persona[]): void => {
    try {
        setItemForAllKeys(PERSONAS_KEY, LEGACY_PERSONAS_KEYS, JSON.stringify(personas));
    } catch (e) {
        console.error('Failed to save personas:', e);
    }
};

// Create a new persona
export const createPersona = (name: string, description: string, avatar?: string): Persona => {
    const now = Date.now();
    const persona: Persona = {
        id: generateId(),
        name,
        description,
        avatar,
        createdAt: now,
        updatedAt: now,
    };

    const personas = getPersonas();
    personas.push(persona);
    savePersonas(personas);

    return persona;
};

// Update an existing persona
export const updatePersona = (id: string, updates: Partial<Omit<Persona, 'id' | 'createdAt'>>): Persona | null => {
    const personas = getPersonas();
    const index = personas.findIndex(p => p.id === id);

    if (index === -1) return null;

    personas[index] = {
        ...personas[index],
        ...updates,
        updatedAt: Date.now(),
    };

    savePersonas(personas);
    return personas[index];
};

// Delete a persona
export const deletePersona = (id: string): boolean => {
    const personas = getPersonas();
    const filtered = personas.filter(p => p.id !== id);

    if (filtered.length === personas.length) return false;

    savePersonas(filtered);

    // If deleted persona was active, clear active
    if (getActivePersonaId() === id) {
        setActivePersonaId(null);
    }

    return true;
};

// Get a specific persona by ID
export const getPersonaById = (id: string): Persona | null => {
    const personas = getPersonas();
    return personas.find(p => p.id === id) || null;
};

// Get the active persona ID
export const getActivePersonaId = (): string | null => {
    try {
        return getItemWithLegacyFallback(ACTIVE_PERSONA_KEY, LEGACY_ACTIVE_PERSONA_KEYS);
    } catch (e) {
        return null;
    }
};

// Set the active persona ID
export const setActivePersonaId = (id: string | null): void => {
    try {
        if (id) {
            setItemForAllKeys(ACTIVE_PERSONA_KEY, LEGACY_ACTIVE_PERSONA_KEYS, id);
        } else {
            removeItemForAllKeys(ACTIVE_PERSONA_KEY, LEGACY_ACTIVE_PERSONA_KEYS);
        }
    } catch (e) {
        console.error('Failed to set active persona:', e);
    }
};

// Get the active persona
export const getActivePersona = (): Persona | null => {
    const id = getActivePersonaId();
    if (!id) return null;
    return getPersonaById(id);
};

// Create a persona from current config
export const createPersonaFromConfig = (
    name: string,
    userName: string,
    userDescription: string
): Persona => {
    return createPersona(name || userName || 'User', userDescription);
};

// Export persona to JSON
export const exportPersona = (persona: Persona): string => {
    return JSON.stringify(persona, null, 2);
};

// Import persona from JSON
export const importPersona = (json: string): Persona | null => {
    try {
        const data = JSON.parse(json);
        if (data.name && typeof data.description === 'string') {
            return createPersona(data.name, data.description, data.avatar);
        }
    } catch (e) {
        console.error('Failed to import persona:', e);
    }
    return null;
};
