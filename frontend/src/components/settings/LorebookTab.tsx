import React from "react";
import { ChatConfig, LorebookEntry } from "../../types";
import { generateId } from "../../utils/id";
import {
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

interface LorebookTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const LorebookTab: React.FC<LorebookTabProps> = ({ config, handleChange }) => {

  const addLorebookEntry = () => {
    const newEntry: LorebookEntry = {
      id: generateId(),
      keys: [],
      content: "",
      enabled: true,
    };
    handleChange("lorebook", [...config.lorebook, newEntry]);
  };

  const updateLorebookEntry = (
    id: string,
    field: keyof LorebookEntry,
    value: unknown,
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

  return (
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
            No lorebook entries. Click &quot;Add Entry&quot; to create one.
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
  );
};

export default LorebookTab;
