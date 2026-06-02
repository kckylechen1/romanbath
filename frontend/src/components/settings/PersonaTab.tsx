import React, { useState, useEffect } from "react";
import { ChatConfig, Persona } from "../../types";
import {
  getPersonas,
  createPersona,
  deletePersona,
  getActivePersonaId,
  setActivePersonaId,
  updatePersona,
} from "../../services/personaService";
import { useLanguage } from "../../i18n";
import { BufferedInput, BufferedTextArea } from "./SharedComponents";
import {
  UserCircle,
  Plus,
  Save,
  Users,
  Edit2,
  Check,
  Upload,
  Download,
  Trash2,
  CheckCircle,
} from "lucide-react";

interface PersonaTabProps {
  config: ChatConfig;
  onConfigChange: (config: ChatConfig) => void;
  handleChange: (key: keyof ChatConfig, value: any) => void;
}

export const PersonaTab: React.FC<PersonaTabProps> = ({
  config,
  onConfigChange,
  handleChange,
}) => {
  const { t } = useLanguage();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersonaId, setActiveId] = useState<string | null>(null);
  const [newPersonaName, setNewPersonaName] = useState("");
  const [showNewPersonaInput, setShowNewPersonaInput] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    setPersonas(getPersonas());
    setActiveId(getActivePersonaId());
  }, []);

  const handleSaveCurrentAsPersona = () => {
    if (!newPersonaName.trim()) return;

    createPersona(
      newPersonaName.trim(),
      config.userDescription,
    );
    setPersonas(getPersonas());
    setNewPersonaName("");
    setShowNewPersonaInput(false);
  };

  const handleLoadPersona = (persona: Persona) => {
    onConfigChange({
      ...config,
      userName: persona.name,
      userDescription: persona.description,
    });
    setActivePersonaId(persona.id);
    setActiveId(persona.id);
  };

  const handleDeletePersona = (id: string) => {
    if (window.confirm(t("persona.deleteConfirm"))) {
      deletePersona(id);
      setPersonas(getPersonas());
      if (activePersonaId === id) {
        setActiveId(null);
      }
    }
  };

  const handleStartEdit = (persona: Persona) => {
    setEditingId(persona.id);
    setEditName(persona.name);
  };

  const handleSaveEdit = (id: string) => {
    if (editName.trim()) {
      updatePersona(id, { name: editName.trim() });
      setPersonas(getPersonas());
    }
    setEditingId(null);
    setEditName("");
  };

  const handleUpdateCurrentToPersona = (persona: Persona) => {
    updatePersona(persona.id, {
      name: config.userName,
      description: config.userDescription,
    });
    setPersonas(getPersonas());
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <UserCircle size={20} className="text-stone-400" />
            {t("persona.current")}
          </h3>
          {activePersonaId && (
            <span className="text-xs px-2 py-1 rounded-full bg-bath-500/10 text-bath-400 border border-bath-500/20">
              {personas.find((p) => p.id === activePersonaId)?.name}
            </span>
          )}
        </div>

        <BufferedInput
          label="Display Name"
          value={config.userName}
          onSave={(val) => handleChange("userName", val)}
          className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-stone-500/40"
        />

        <BufferedTextArea
          label={
            <>
              User Description / Persona
              <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
                How the character sees you (appearance, personality).
              </span>
            </>
          }
          value={config.userDescription}
          onSave={(val) => handleChange("userDescription", val)}
          placeholder="Tall, mysterious stranger with a mechanical arm..."
          className="w-full h-32 bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-stone-500/40 resize-none"
        />
      </div>

      <div className="p-4 rounded-xl bg-stone-500/5 border border-stone-500/10">
        {!showNewPersonaInput ? (
          <button
            onClick={() => setShowNewPersonaInput(true)}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium text-stone-400 hover:text-white py-2 transition-colors"
          >
            <Plus size={16} />
            {t("persona.save")}
          </button>
        ) : (
          <div className="space-y-3">
            <input
              type="text"
              value={newPersonaName}
              onChange={(e) => setNewPersonaName(e.target.value)}
              placeholder={t("persona.name")}
              className="w-full bg-black/30 border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-stone-500/40"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewPersonaInput(false)}
                className="flex-1 px-3 py-2 text-sm text-stone-400 hover:text-white bg-white/5 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCurrentAsPersona}
                disabled={!newPersonaName.trim()}
                className="flex-1 px-3 py-2 text-sm font-medium text-white bg-stone-600 hover:bg-stone-500 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save size={14} className="inline mr-1" />
                Save
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
            <Users size={14} />
            {t("persona.saved")}
          </h4>
          <span className="text-xs text-stone-500">
            {personas.length} saved
          </span>
        </div>

        {personas.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-white/10 rounded-xl text-gray-600 text-sm">
            {t("persona.noPersonas")}
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
            {personas.map((persona) => (
              <div
                key={persona.id}
                className={`group p-3 rounded-xl border transition-all ${
                  activePersonaId === persona.id
                    ? "bg-stone-500/10 border-stone-500/30"
                    : "bg-black/20 border-white/5 hover:border-white/10 hover:bg-white/5"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-stone-500/20 to-stone-600/20 flex items-center justify-center text-stone-400 font-bold text-lg">
                    {persona.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    {editingId === persona.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 bg-black/30 border border-white/10 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-stone-500/40"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveEdit(persona.id)}
                          className="p-1.5 text-bath-400 hover:bg-bath-500/10 rounded-lg transition-colors"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-white truncate">
                          {persona.name}
                        </p>
                        <p className="text-xs text-stone-500 truncate">
                          {persona.description.substring(0, 50)}
                          {persona.description.length > 50 ? "..." : ""}
                        </p>
                      </>
                    )}
                  </div>

                  {editingId !== persona.id && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleStartEdit(persona)}
                        className="p-1.5 text-stone-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                        title="Edit name"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleUpdateCurrentToPersona(persona)}
                        className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="Update with current"
                      >
                        <Upload size={14} />
                      </button>
                      <button
                        onClick={() => handleLoadPersona(persona)}
                        className="p-1.5 text-bath-400 hover:bg-bath-500/10 rounded-lg transition-colors"
                        title="Load persona"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={() => handleDeletePersona(persona.id)}
                        className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}

                  {activePersonaId === persona.id &&
                    editingId !== persona.id && (
                      <div className="flex-shrink-0">
                        <CheckCircle size={16} className="text-bath-400" />
                      </div>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
export default PersonaTab;
