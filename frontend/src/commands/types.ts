import type React from 'react';
import type { LucideIcon } from 'lucide-react';

export type CommandCategory = 'actions' | 'navigate' | 'characters' | 'settings' | 'help';

export interface Command {
  id: string;
  title: string;
  category: CommandCategory;
  /** Extra tokens to feed the fuzzy matcher beyond title. */
  keywords?: string[];
  icon?: LucideIcon;
  /** Display-only shortcut hint, e.g. "⌘R". Does not register the binding. */
  shortcut?: string;
  /** Muted right-aligned hint (current value, target name, etc.). */
  hint?: string;
  /** When true, the command is omitted from the default browse list and
   * only surfaces when the user types something that matches it. Use this
   * for "set temperature to 0.5" variants so they don't crowd the list. */
  hidden?: boolean;
  run: () => void | Promise<void>;
}

export const CATEGORY_LABELS: Record<CommandCategory, string> = {
  actions: 'Actions',
  navigate: 'Navigate',
  characters: 'Characters',
  settings: 'Settings',
  help: 'Help',
};

export const CATEGORY_ORDER: CommandCategory[] = [
  'actions',
  'navigate',
  'characters',
  'settings',
  'help',
];

// Concatenate the searchable fields into one string for uFuzzy.
export const commandToHaystack = (cmd: Command): string =>
  [cmd.title, cmd.category, ...(cmd.keywords ?? [])].join(' ').toLowerCase();

// Re-exported so consumers don't need to import React types directly.
export type { React };
