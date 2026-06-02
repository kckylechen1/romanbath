import React, { useState, useEffect } from "react";
import { ChatConfig, LorebookEntry, Persona } from "../types";
import { generateText, ensurePairing } from "../services/zeroclawService";
import {
  getPersonas,
  createPersona,
  deletePersona,
  getActivePersonaId,
  setActivePersonaId,
  updatePersona,
} from "../services/personaService";
import {
  getAppSettings,
  saveAppSettings,
} from "../services/chatPersistenceService";
import GenerationSettings from "./GenerationSettings";
import {
  BookOpen,
  X,
  UserCircle,
  PenTool,
  List,
  Palette,
  SlidersHorizontal,
  FileText,
  Book,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Type,
  RefreshCw,
  CheckCircle,
  XCircle,
  Server,
  Save,
  Sparkles,
  Users,
  Download,
  Upload,
  Edit2,
  Check,
  Volume2,
  Cpu,
  Shield,
  MessageSquare,
} from "lucide-react";
import { useLanguage } from "../i18n";
import { useToast } from "./Toast";
import { BufferedInput, BufferedTextArea } from "./settings/SharedComponents";
import PersonaTab from "./settings/PersonaTab";

// Auto-restore Chat Toggle Component
const InterfaceAutoRestoreToggle: React.FC = () => {
  const { t } = useLanguage();
  const [autoRestore, setAutoRestore] = useState(
    () => getAppSettings().autoRestoreChat,
  );

  const handleToggle = () => {
    const newValue = !autoRestore;
    setAutoRestore(newValue);
    saveAppSettings({ autoRestoreChat: newValue });
  };

  return (
    <label className="flex items-center justify-between cursor-pointer group">
      <div>
        <span className="text-sm text-gray-300 group-hover:text-white transition-colors">
          {t("chat.autoRestore")}
        </span>
        <p className="text-[10px] text-gray-500 mt-0.5">
          {t("chat.restorePrompt")}
        </p>
      </div>
      <button
        onClick={handleToggle}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          autoRestore ? "bg-stone-500" : "bg-gray-700"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
            autoRestore ? "left-7" : "left-1"
          }`}
        />
      </button>
    </label>
  );
};

interface SettingsPanelProps {
  config: ChatConfig;
  onConfigChange: (config: ChatConfig) => void;
  isOpen: boolean;
  onClose: () => void;
}

type Tab =
  | "backend"
  | "generation"
  | "story"
  | "lorebook"
  | "character"
  | "persona"
  | "formatting"
  | "interface"
  | "tts";

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  onConfigChange,
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("generation");

  // Connection Status State
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [connectionMessage, setConnectionMessage] = useState("");

  // Lorebook State
  const [newLoreKey, setNewLoreKey] = useState("");

  useEffect(() => {
    if (activeTab !== "backend") return;
    ensurePairing()
      .then(() => {
        setConnectionStatus("success");
        setConnectionMessage("Connected to ZeroClaw gateway");
      })
      .catch((e) => {
        setConnectionStatus("error");
        setConnectionMessage(
          e instanceof Error ? e.message : "Gateway not reachable",
        );
      });
  }, [activeTab]);

  if (!isOpen) return null;

  const handleChange = (key: keyof ChatConfig, value: any) => {
    onConfigChange({ ...config, [key]: value });
  };

  const handleTestConnection = async () => {
    setConnectionStatus("loading");
    setConnectionMessage("Testing ZeroClaw gateway...");
    try {
      await ensurePairing();
      const text = await generateText(
        { messages: [{ role: "user", content: "ping" }] },
        {
          temperature: 0.7,
          maxTokens: 16,
          topP: null,
          topK: null,
          frequencyPenalty: null,
          presencePenalty: null,
          stop: null,
          seed: null,
          userName: null,
          userDescription: null,
          sceneMode: null,
        },
      );
      setConnectionStatus("success");
      setConnectionMessage(
        text ? "Gateway chat OK ✓" : "Gateway reachable (empty response)",
      );
    } catch (error: any) {
      setConnectionStatus("error");
      setConnectionMessage(error?.message || "Gateway test failed");
    }
  };

  // Lorebook Handlers
  const addLorebookEntry = () => {
    const newEntry: LorebookEntry = {
      id: Date.now().toString(),
      keys: [],
      content: "",
      enabled: true,
    };
    handleChange("lorebook", [...config.lorebook, newEntry]);
  };

  const updateLorebookEntry = (
    id: string,
    field: keyof LorebookEntry,
    value: any,
  ) => {
    const updated = config.lorebook.map((entry) => {
      if (entry.id === id) {
        if (field === "keys" && typeof value === "string") {
          return {
            ...entry,
            keys: value.split(",").map((k: string) => k.trim()),
          };
        }
        return { ...entry, [field]: value };
      }
      return entry;
    });
    handleChange("lorebook", updated);
  };

  const deleteLorebookEntry = (id: string) => {
    handleChange(
      "lorebook",
      config.lorebook.filter((e) => e.id !== id),
    );
  };

  const navItemClass = (tab: Tab) => `
    flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left mb-1
    ${
      activeTab === tab
        ? "bg-stone-500/10 text-stone-100 border border-stone-500/20"
        : "text-stone-500 hover:text-stone-300 hover:bg-white/5 border border-transparent"
    }
  `;

  return (
    <div className="h-full flex bg-[#0d0b09]/98 backdrop-blur-3xl border-l border-white/5 w-full shadow-2xl font-sans">
      {/* Sidebar Navigation */}
      <div className="w-16 md:w-60 border-r border-white/5 flex flex-col pt-20 md:pt-0 bg-black/40 shrink-0">
        <div className="hidden md:flex items-center gap-3 px-6 py-5 border-b border-white/5 h-20 bg-black/20">
          <SlidersHorizontal size={18} className="text-stone-400" />
          <span className="font-bold text-stone-200 tracking-widest text-xs uppercase">
            {t("settings.configuration")}
          </span>
        </div>

        <nav className="p-3 flex-1 overflow-y-auto custom-scrollbar space-y-1">
          <button
            onClick={() => setActiveTab("backend")}
            className={navItemClass("backend")}
          >
            <Server size={18} />
            <span className="hidden md:inline">Backend</span>
          </button>
          <button
            onClick={() => setActiveTab("generation")}
            className={navItemClass("generation")}
          >
            <Cpu size={18} />
            <span className="hidden md:inline">{t("tab.generation")}</span>
          </button>
          <button
            onClick={() => setActiveTab("story")}
            className={navItemClass("story")}
          >
            <BookOpen size={18} />
            <span className="hidden md:inline">{t("tab.story")}</span>
          </button>
          <button
            onClick={() => setActiveTab("lorebook")}
            className={navItemClass("lorebook")}
          >
            <Book size={18} />
            <span className="hidden md:inline">{t("tab.lorebook")}</span>
          </button>
          <button
            onClick={() => setActiveTab("character")}
            className={navItemClass("character")}
          >
            <FileText size={18} />
            <span className="hidden md:inline">{t("tab.character")}</span>
          </button>
          <button
            onClick={() => setActiveTab("persona")}
            className={navItemClass("persona")}
          >
            <UserCircle size={18} />
            <span className="hidden md:inline">{t("tab.persona")}</span>
          </button>
          <button
            onClick={() => setActiveTab("formatting")}
            className={navItemClass("formatting")}
          >
            <Type size={18} />
            <span className="hidden md:inline">{t("tab.formatting")}</span>
          </button>
          <button
            onClick={() => setActiveTab("interface")}
            className={navItemClass("interface")}
          >
            <Palette size={18} />
            <span className="hidden md:inline">{t("tab.interface")}</span>
          </button>
          <button
            onClick={() => setActiveTab("tts")}
            className={navItemClass("tts")}
          >
            <Volume2 size={18} />
            <span className="hidden md:inline">Voice</span>
          </button>
        </nav>

        <div className="p-4 border-t border-white/5 hidden md:block">
          <div className="text-[10px] text-gray-600 font-mono text-center opacity-60">
            Roman Bath (Lorebook)
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-black/20">
        {/* Mobile Close / Header */}
        <div className="flex md:hidden items-center justify-between p-4 border-b border-white/5 bg-black/40">
          <span className="font-bold uppercase tracking-wider text-sm text-gray-400">
            {t("settings.settings")}
          </span>
          <button
            onClick={onClose}
            className="p-2 bg-white/5 rounded-full text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="hidden md:flex h-20 items-center justify-between px-6 border-b border-white/5 bg-black/20">
          <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {activeTab === "backend" && "ZeroClaw Backend"}
            {activeTab === "generation" && t("settings.panelTitle.generation")}
            {activeTab === "story" && t("settings.panelTitle.story")}
            {activeTab === "lorebook" && t("settings.panelTitle.lorebook")}
            {activeTab === "character" && t("settings.panelTitle.character")}
            {activeTab === "persona" && t("settings.panelTitle.persona")}
            {activeTab === "formatting" && t("settings.panelTitle.formatting")}
            {activeTab === "interface" && t("settings.panelTitle.interface")}
            {activeTab === "tts" && "Voice / TTS"}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          {/* --- BACKEND TAB --- */}
          {activeTab === "backend" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div>
                <h3 className="text-lg font-bold text-white">ZeroClaw Gateway</h3>
                <p className="text-sm text-stone-400 mt-2">
                  Model provider, API keys, and agent configuration live in ZeroClaw
                  (typically <code className="text-stone-300">~/.zeroclaw/config.toml</code>).
                  Roman Bath sends chat requests through the gateway — model keys and providers
                  are configured in ZeroClaw, not in this UI.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
                <div className="flex items-start gap-3">
                  {connectionStatus === "success" ? (
                    <CheckCircle className="text-green-400 shrink-0" size={20} />
                  ) : connectionStatus === "error" ? (
                    <XCircle className="text-red-400 shrink-0" size={20} />
                  ) : connectionStatus === "loading" ? (
                    <RefreshCw className="text-stone-400 shrink-0 animate-spin" size={20} />
                  ) : (
                    <Server className="text-stone-400 shrink-0" size={20} />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-white">
                      {connectionStatus === "success"
                        ? "Gateway connected"
                        : connectionStatus === "error"
                          ? "Gateway error"
                          : connectionStatus === "loading"
                            ? "Connecting..."
                            : "Not checked"}
                    </h4>
                    <p className="text-xs text-stone-400 mt-1">
                      {connectionMessage ||
                        "Start zeroclaw gateway, then test the chat endpoint."}
                    </p>
                  </div>
                  <button
                    onClick={handleTestConnection}
                    disabled={connectionStatus === "loading"}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-stone-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    Test chat
                  </button>
                </div>

                <ul className="text-xs text-stone-500 space-y-2 list-disc pl-4">
                  <li>Characters: <code className="text-stone-400">GET /api/characters</code></li>
                  <li>Chat: <code className="text-stone-400">POST /api/chat</code> (SSE streaming)</li>
                  <li>Chat history: stored locally in this browser</li>
                </ul>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-stone-300">Per-request overrides</h4>
                <p className="text-xs text-stone-500">
                  Use the Generation tab to adjust temperature, top-p, max tokens, and scene mode
                  for each chat session. These are passed to the gateway on every message.
                </p>
              </div>
            </div>
          )}

          {activeTab === "generation" && (
            <GenerationSettings config={config} onConfigChange={onConfigChange} />
          )}

          {/* --- STORY TAB --- */}
          {activeTab === "story" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Scene Mode Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-purple-500/5 border border-purple-500/10">
                <div>
                  <span className="text-sm font-semibold text-white flex items-center gap-2">
                    <Sparkles size={14} className="text-purple-400" />
                    Scene Mode
                  </span>
                  <p className="text-[10px] text-gray-500 mt-1">
                    Enforce scene-based narrative format with status bars, internal monologue, and scene numbering
                  </p>
                </div>
                <button
                  onClick={() => handleChange("sceneMode", !config.sceneMode)}
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    config.sceneMode ? "bg-purple-500" : "bg-gray-700"
                  }`}
                >
                  <div
                    className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow-md transition-transform ${
                      config.sceneMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              <BufferedTextArea
                label={
                  <>
                    <span className="flex items-center gap-2">
                      <BookOpen size={14} /> Scenario
                    </span>
                    <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                      Current situation, environment, or plot constraints.
                    </span>
                  </>
                }
                value={config.scenario}
                onSave={(val) => handleChange("scenario", val)}
                placeholder="e.g. In a high school classroom during a thunderstorm..."
                className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-stone-300 focus:outline-none focus:border-stone-500/40 transition-all resize-none font-sans"
              />

              <div className="space-y-3 mt-6 p-4 rounded-xl bg-orange-900/10 border border-orange-500/10">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-orange-400 uppercase tracking-wider flex items-center gap-2">
                    <PenTool size={14} /> Author's Note / Depth Prompt
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 uppercase">
                      Depth
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={config.authorsNoteDepth}
                      onChange={(e) =>
                        handleChange(
                          "authorsNoteDepth",
                          parseInt(e.target.value),
                        )
                      }
                      className="w-12 bg-black/30 border border-white/10 rounded px-1 py-0.5 text-xs text-center text-white"
                    />
                  </div>
                </div>
                <BufferedTextArea
                  value={config.authorsNote}
                  onSave={(val) => handleChange("authorsNote", val)}
                  placeholder="[System Note: Write using vivid sensory details. The character is secretly afraid.]"
                  className="w-full h-32 bg-transparent border-0 p-0 text-sm text-gray-300 focus:ring-0 placeholder-gray-600 resize-none font-mono"
                />
              </div>
            </div>
          )}

          {/* --- LOREBOOK TAB (NEW) --- */}
          {activeTab === "lorebook" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-white">World Info</h3>
                  <p className="text-xs text-gray-500">
                    Dynamic context injected when keywords are triggered.
                  </p>
                </div>
                <button
                  onClick={addLorebookEntry}
                  className="flex items-center gap-2 bg-stone-500/10 hover:bg-stone-500/20 text-stone-300 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-stone-500/20"
                >
                  <Plus size={16} /> Add Entry
                </button>
              </div>

              <div className="space-y-4">
                {config.lorebook.length === 0 && (
                  <div className="text-center py-10 border border-dashed border-white/10 rounded-xl text-gray-600 text-sm">
                    No lorebook entries. Click "Add Entry" to create one.
                  </div>
                )}

                {config.lorebook.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3 group hover:border-white/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          updateLorebookEntry(
                            entry.id,
                            "enabled",
                            !entry.enabled,
                          )
                        }
                        className="text-gray-400 hover:text-white"
                      >
                        {entry.enabled ? (
                          <ToggleRight size={24} className="text-green-400" />
                        ) : (
                          <ToggleLeft size={24} />
                        )}
                      </button>
                      <input
                        type="text"
                        placeholder="Keywords (comma separated)"
                        value={entry.keys.join(", ")}
                        onChange={(e) =>
                          updateLorebookEntry(entry.id, "keys", e.target.value)
                        }
                        className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:border-stone-500/40 outline-none"
                      />
                      <button
                        onClick={() => deleteLorebookEntry(entry.id)}
                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <textarea
                      placeholder="Context to inject..."
                      value={entry.content}
                      onChange={(e) =>
                        updateLorebookEntry(entry.id, "content", e.target.value)
                      }
                      className="w-full h-24 bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-stone-500/40 resize-none font-sans"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* --- CHARACTER PROMPTS TAB --- */}
          {activeTab === "character" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <BufferedTextArea
                label={
                  <span className="flex items-center gap-2 text-red-400">
                    <Shield size={14} /> Main Prompt Override
                  </span>
                }
                value={config.systemPromptOverride}
                onSave={(val) => handleChange("systemPromptOverride", val)}
                placeholder="Enter a full replacement for the character card description..."
                className="w-full h-40 bg-black/30 border border-red-500/20 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-red-500/50 resize-none"
              />

              <BufferedTextArea
                label={
                  <>
                    <span className="flex items-center gap-2">
                      <MessageSquare size={14} /> Example Dialogue
                    </span>
                    <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                      Crucial for defining the character's speech pattern.
                    </span>
                  </>
                }
                value={config.exampleDialogue}
                onSave={(val) => handleChange("exampleDialogue", val)}
                placeholder={`<START>\n{{user}}: Hello\n{{char}}: *smirks* Well look who it is.`}
                className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-stone-500/40 resize-none"
              />

              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                  <List size={14} /> Prompt Ordering
                </label>
                <select
                  value={config.promptOrder}
                  onChange={(e) => handleChange("promptOrder", e.target.value)}
                  className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-gray-300 focus:outline-none focus:border-stone-500/40"
                >
                  <option value="default">
                    Default (Char → Examples → User → Scenario)
                  </option>
                  <option value="style_first">
                    Style First (Note → Char → Scenario)
                  </option>
                  <option value="scenario_last">
                    Scenario Last (Char → Note → Scenario)
                  </option>
                </select>
              </div>
            </div>
          )}

          {/* --- PERSONA TAB --- */}
          {activeTab === "persona" && (
            <PersonaTab
              config={config}
              onConfigChange={onConfigChange}
              handleChange={handleChange}
            />
          )}

          {/* --- FORMATTING TAB (NEW) --- */}
          {activeTab === "formatting" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <h3 className="text-lg font-bold text-white mb-4">
                {t("formatting.title")}
              </h3>
              <div className="space-y-3">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Prompt Template
                </label>
                <select
                  value={config.promptTemplate || "none"}
                  onChange={(e) =>
                    handleChange(
                      "promptTemplate",
                      e.target.value === "none" ? undefined : e.target.value,
                    )
                  }
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-white focus:border-stone-500/40 outline-none"
                >
                  <option value="none">None (Chat API)</option>
                  <option value="chatml">ChatML</option>
                  <option value="llama2">Llama 2</option>
                  <option value="alpaca">Alpaca</option>
                  <option value="mistral">Mistral</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <BufferedInput
                  label={t("formatting.userPrefix")}
                  value={config.userPrefix}
                  onSave={(val) => handleChange("userPrefix", val)}
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
                />
                <BufferedInput
                  label={t("formatting.modelPrefix")}
                  value={config.modelPrefix}
                  onSave={(val) => handleChange("modelPrefix", val)}
                  className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
                />
              </div>
              <BufferedInput
                label={
                  <>
                    {t("formatting.contextTemplate")}
                    <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                      {t("formatting.contextTemplateDesc")}
                    </span>
                  </>
                }
                value={config.contextTemplate}
                onSave={(val) => handleChange("contextTemplate", val)}
                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
              />
            </div>
          )}

          {/* --- INTERFACE TAB --- */}
          {activeTab === "interface" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-6">
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Font Size
                    </label>
                    <span className="text-xs text-gray-400">
                      {config.fontSize}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    value={config.fontSize}
                    onChange={(e) =>
                      handleChange("fontSize", parseInt(e.target.value))
                    }
                    className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between">
                    <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Background Blur
                    </label>
                    <span className="text-xs text-gray-400">
                      {config.backgroundBlur}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={config.backgroundBlur}
                    onChange={(e) =>
                      handleChange("backgroundBlur", parseInt(e.target.value))
                    }
                    className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* Auto-restore Chat Toggle */}
                <div className="pt-4 border-t border-white/5">
                  <InterfaceAutoRestoreToggle />
                </div>
              </div>
            </div>
          )}

          {/* --- TTS TAB --- */}
          {activeTab === "tts" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* 1. Enable / Disable */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-semibold text-white">
                    Enable TTS
                  </label>
                  <p className="text-xs text-gray-400 mt-1">
                    Enable text-to-speech for AI responses
                  </p>
                </div>
                <button
                  onClick={() =>
                    handleChange("tts", {
                      ...config.tts,
                      enabled: !config.tts.enabled,
                    })
                  }
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                    config.tts.enabled
                      ? "bg-bath-600 text-white"
                      : "bg-stone-700 text-gray-300"
                  }`}
                >
                  {config.tts.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>

              {config.tts.enabled && (
                <div className="space-y-6">
                  {/* 2. Voice selector — Grok voices */}
                  <div className="space-y-3">
                    <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      Voice
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["nova", "shimmer"] as const).map(
                        (v) => (
                          <button
                            key={v}
                            onClick={() =>
                              handleChange("tts", {
                                ...config.tts,
                                voice: v,
                              })
                            }
                            className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all border ${
                              config.tts.voice === v
                                ? "bg-bath-500/10 border-bath-500/30 text-bath-300"
                                : "bg-black/20 border-white/5 text-gray-400 hover:border-white/10 hover:text-gray-300"
                            }`}
                          >
                            {v}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* 4. Rate + Pitch */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                          Rate
                        </label>
                        <span className="text-xs text-gray-400">
                          {config.tts.rate}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={config.tts.rate}
                        onChange={(e) =>
                          handleChange("tts", {
                            ...config.tts,
                            rate: parseFloat(e.target.value),
                          })
                        }
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                          Pitch
                        </label>
                        <span className="text-xs text-gray-400">
                          {config.tts.pitch}x
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={config.tts.pitch}
                        onChange={(e) =>
                          handleChange("tts", {
                            ...config.tts,
                            pitch: parseFloat(e.target.value),
                          })
                        }
                        className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                      />
                    </div>
                  </div>

                  {/* 5. Volume */}
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                        Volume
                      </label>
                      <span className="text-xs text-gray-400">
                        {Math.round(config.tts.volume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={config.tts.volume}
                      onChange={(e) =>
                        handleChange("tts", {
                          ...config.tts,
                          volume: parseFloat(e.target.value),
                        })
                      }
                      className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                  </div>

                  {/* 6. Auto-play */}
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="text-sm font-semibold text-white">
                        Auto-play AI Responses
                      </label>
                      <p className="text-xs text-gray-400 mt-1">
                        Automatically read AI responses
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        handleChange("tts", {
                          ...config.tts,
                          autoPlay: !config.tts.autoPlay,
                        })
                      }
                      className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                        config.tts.autoPlay
                          ? "bg-bath-600 text-white"
                          : "bg-stone-700 text-gray-300"
                      }`}
                    >
                      {config.tts.autoPlay ? "On" : "Off"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
