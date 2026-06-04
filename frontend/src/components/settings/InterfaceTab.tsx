import React, { useState } from "react";
import { ChatConfig } from "../../types";
import { useLanguage } from "../../i18n";
import {
  getAppSettings,
  saveAppSettings,
} from "../../services/chatPersistenceService";

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

interface InterfaceTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const InterfaceTab: React.FC<InterfaceTabProps> = ({ config, handleChange }) => {
  return (
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
  );
};

export default InterfaceTab;
