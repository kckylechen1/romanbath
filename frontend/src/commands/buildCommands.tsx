import {
  ArrowRight,
  BookOpen,
  Bot,
  Brush,
  CornerDownLeft,
  Eraser,
  Globe,
  HelpCircle,
  History,
  Image as ImageIcon,
  Keyboard,
  Languages,
  type LucideIcon,
  MessageSquarePlus,
  PanelLeft,
  PanelRight,
  Pencil,
  RefreshCw,
  Settings as SettingsIcon,
  Shuffle,
  Sparkles,
  Thermometer,
  Users,
  Volume2,
} from "lucide-react";
import type { Command } from "./types";
import type { useAppLogic } from "../hooks/useAppLogic";

type Logic = ReturnType<typeof useAppLogic>;

interface BuildOptions {
  /** Preset temperature values surfaced as discrete commands. */
  temperaturePresets?: number[];
}

const DEFAULT_TEMPERATURE_PRESETS = [0.4, 0.7, 1.0, 1.3];

// Pure builder — takes the current logic snapshot and returns a flat list
// of commands. Kept side-effect-free so the palette can rebuild on every
// render without worrying about staleness.
export const buildCommands = (logic: Logic, opts: BuildOptions = {}): Command[] => {
  const temps = opts.temperaturePresets ?? DEFAULT_TEMPERATURE_PRESETS;
  const commands: Command[] = [];

  // ── Actions ─────────────────────────────────────────────────────────
  const lastAssistant = [...logic.messages].reverse().find((m) => m.role === "model");
  if (lastAssistant) {
    commands.push({
      id: "action.regenerate",
      title: "Regenerate last response",
      category: "actions",
      keywords: ["retry", "redo", "swipe", "reroll"],
      icon: RefreshCw,
      shortcut: "⇧⌘R",
      run: () => logic.handleRegenerate(lastAssistant.id),
    });
    commands.push({
      id: "action.alternative",
      title: "Generate alternative response",
      category: "actions",
      keywords: ["swipe", "branch", "reroll", "variation"],
      icon: Shuffle,
      run: () => logic.handleGenerateSwipe(lastAssistant.id),
    });
    commands.push({
      id: "action.continue",
      title: "Continue last response",
      category: "actions",
      keywords: ["append", "extend", "more"],
      icon: ArrowRight,
      run: () => logic.handleContinue(lastAssistant.id),
    });
  }

  commands.push({
    id: "action.new-chat",
    title: "Start new chat",
    category: "actions",
    keywords: ["fresh", "reset", "clear"],
    icon: MessageSquarePlus,
    run: () => logic.startNewChat(),
  });
  commands.push({
    id: "action.clear",
    title: "Clear current conversation",
    category: "actions",
    keywords: ["reset", "wipe", "restart"],
    icon: Eraser,
    run: () => logic.clearChat(),
  });
  commands.push({
    id: "action.image-gen",
    title: "Generate image…",
    category: "actions",
    keywords: ["picture", "draw", "photo", "stable diffusion"],
    icon: ImageIcon,
    run: () => logic.setShowImageGen(true),
  });
  commands.push({
    id: "action.bookmark-create",
    title: "Bookmark this checkpoint",
    category: "actions",
    keywords: ["snapshot", "save", "checkpoint"],
    icon: BookOpen,
    run: () => logic.handleCreateBookmark(),
  });
  commands.push({
    id: "action.history",
    title: "Browse chat history",
    category: "actions",
    keywords: ["past", "previous", "chats"],
    icon: History,
    run: () => logic.setShowChatHistory(true),
  });

  // ── Navigate ────────────────────────────────────────────────────────
  commands.push({
    id: "nav.toggle-sidebar",
    title: logic.leftSidebarOpen ? "Hide character sidebar" : "Show character sidebar",
    category: "navigate",
    keywords: ["left", "panel", "characters"],
    icon: PanelLeft,
    shortcut: "⌘\\",
    run: () => logic.setLeftSidebarOpen(!logic.leftSidebarOpen),
  });
  commands.push({
    id: "nav.toggle-settings",
    title: logic.rightSidebarOpen ? "Hide settings panel" : "Open settings panel",
    category: "navigate",
    keywords: ["right", "panel", "config"],
    icon: PanelRight,
    shortcut: "⌘.",
    run: () => logic.setRightSidebarOpen(!logic.rightSidebarOpen),
  });
  commands.push({
    id: "nav.group-manager",
    title: "Open group chat manager",
    category: "navigate",
    keywords: ["multi", "characters", "round robin"],
    icon: Users,
    run: () => logic.setShowGroupManager(true),
  });
  commands.push({
    id: "nav.bookmarks",
    title: "Open bookmarks",
    category: "navigate",
    keywords: ["checkpoints", "saved"],
    icon: BookOpen,
    run: () => logic.setShowBookmarks(true),
  });
  commands.push({
    id: "nav.edit-character",
    title: `Edit "${logic.selectedCharacter.name}"`,
    category: "navigate",
    keywords: ["modify", "card", "current"],
    icon: Pencil,
    run: () => logic.handleEditCharacter(logic.selectedCharacter.id),
  });

  // ── Characters (dynamic) ────────────────────────────────────────────
  for (const char of logic.characters) {
    const isActive = char.id === logic.selectedCharacter.id;
    commands.push({
      id: `char.select.${char.id}`,
      title: `Talk to ${char.name}`,
      category: "characters",
      keywords: [char.name, "switch", "select"],
      icon: Bot,
      hint: isActive ? "active" : undefined,
      // Don't crowd the default browse view with the entire roster when
      // there are many characters — only show the active one and let
      // search surface the rest by name.
      hidden: !isActive,
      run: () => logic.setSelectedCharacter(char),
    });
  }
  commands.push({
    id: "char.create",
    title: "Create new character",
    category: "characters",
    keywords: ["new", "add", "blank"],
    icon: Sparkles,
    run: () => logic.handleCreateCharacter(),
  });

  // ── Settings ────────────────────────────────────────────────────────
  commands.push({
    id: "set.scene-mode",
    title: `${logic.config.sceneMode ? "Disable" : "Enable"} scene mode`,
    category: "settings",
    keywords: ["scene", "stage", "theatre"],
    icon: Brush,
    hint: logic.config.sceneMode ? "on" : "off",
    run: () =>
      logic.handleConfigChange({
        ...logic.config,
        sceneMode: !logic.config.sceneMode,
      }),
  });
  commands.push({
    id: "set.tts",
    title: `${logic.config.tts.enabled ? "Disable" : "Enable"} text-to-speech`,
    category: "settings",
    keywords: ["voice", "audio", "speak", "tts"],
    icon: Volume2,
    hint: logic.config.tts.enabled ? "on" : "off",
    run: () =>
      logic.handleConfigChange({
        ...logic.config,
        tts: { ...logic.config.tts, enabled: !logic.config.tts.enabled },
      }),
  });
  for (const t of temps) {
    commands.push({
      id: `set.temperature.${t}`,
      title: `Set temperature to ${t}`,
      category: "settings",
      keywords: ["temp", "creative", "random"],
      icon: Thermometer,
      hint: logic.config.temperature === t ? "current" : undefined,
      hidden: true,
      run: () =>
        logic.handleConfigChange({
          ...logic.config,
          temperature: t,
        }),
    });
  }
  commands.push({
    id: "set.language-en",
    title: "Switch UI language to English",
    category: "settings",
    keywords: ["lang", "i18n", "locale"],
    icon: Languages,
    hint: logic.language === "en" ? "current" : undefined,
    hidden: logic.language === "en",
    run: () => logic.setLanguage("en"),
  });
  commands.push({
    id: "set.language-zh-CN",
    title: "切换界面语言到 简体中文",
    category: "settings",
    keywords: ["chinese", "simplified", "lang", "i18n"],
    icon: Languages,
    hint: logic.language === "zh-CN" ? "current" : undefined,
    hidden: logic.language === "zh-CN",
    run: () => logic.setLanguage("zh-CN"),
  });
  commands.push({
    id: "set.language-zh-TW",
    title: "切換界面語言到 繁體中文",
    category: "settings",
    keywords: ["chinese", "traditional", "lang", "i18n"],
    icon: Languages,
    hint: logic.language === "zh-TW" ? "current" : undefined,
    hidden: logic.language === "zh-TW",
    run: () => logic.setLanguage("zh-TW"),
  });

  // ── Help ────────────────────────────────────────────────────────────
  commands.push({
    id: "help.settings-panel",
    title: "Open full settings panel",
    category: "help",
    keywords: ["config", "all", "preferences"],
    icon: SettingsIcon,
    run: () => logic.setRightSidebarOpen(true),
  });
  commands.push({
    id: "help.gateway-status",
    title: "Open ZeroClaw gateway status",
    category: "help",
    keywords: ["backend", "health", "connection", "pair"],
    icon: Globe,
    run: () => logic.setRightSidebarOpen(true),
  });
  commands.push({
    id: "help.keyboard",
    title: "Keyboard shortcuts",
    category: "help",
    keywords: ["hotkey", "binding", "cheatsheet"],
    icon: Keyboard,
    run: () => {
      // Closes the palette by virtue of focusing the help affordance.
      // Real cheatsheet coming in a follow-up.
      logic.setRightSidebarOpen(true);
    },
  });
  commands.push({
    id: "help.about",
    title: "About Roman Bath",
    category: "help",
    keywords: ["version", "info"],
    icon: HelpCircle,
    run: () => logic.setRightSidebarOpen(true),
  });

  // Suppress unused-import warning for CornerDownLeft — kept around as
  // the natural icon for the "submit" affordance we'll add later.
  void CornerDownLeft;

  return commands;
};

export type { LucideIcon };
