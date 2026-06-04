import React from "react";
import { ChatConfig } from "../../types";
import { BufferedTextArea } from "./SharedComponents";
import { Sparkles, BookOpen, PenTool } from "lucide-react";

interface StoryTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const StoryTab: React.FC<StoryTabProps> = ({ config, handleChange }) => {

  return (
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
            <PenTool size={14} /> Author&apos;s Note / Depth Prompt
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
  );
};

export default StoryTab;
