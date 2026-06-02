import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Trash2, Upload, Sparkles } from 'lucide-react';
import {
  CharacterFormData,
  getCharacterDetails,
  uploadCharacterAvatar,
} from '../services/zeroclawService';
import LorebookEditor from './LorebookEditor';

interface CharacterEditorProps {
  characterId?: string; // undefined = new character, string = editing existing
  onSave: (data: CharacterFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
  isOpen: boolean;
}

const TABS = [
  { id: 'basic', label: 'Basic Info' },
  { id: 'personality', label: 'Personality' },
  { id: 'greeting', label: 'First Message' },
  { id: 'dialogue', label: 'Example Dialogue' },
  { id: 'lorebook', label: 'Lorebook' },
  { id: 'advanced', label: 'Advanced' },
] as const;

type TabId = typeof TABS[number]['id'];

const emptyForm = (): CharacterFormData => ({
  name: '',
  description: '',
  personality: '',
  scenario: '',
  firstMessage: '',
  alternateGreetings: [],
  exampleDialogue: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  creatorNotes: '',
  tags: [],
  creator: '',
  characterVersion: '',
  nickname: '',
  groupOnlyGreetings: [],
  source: [],
  characterBook: null,
  extensions: {},
  avatarFile: null,
});

const CharacterEditor: React.FC<CharacterEditorProps> = ({
  characterId,
  onSave,
  onDelete,
  onClose,
  isOpen
}) => {
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState<CharacterFormData>(emptyForm);

  // Load character data if editing
  useEffect(() => {
    if (isOpen && characterId) {
      setIsLoading(true);
      getCharacterDetails(characterId).then(data => {
        if (data) {
          setFormData({ ...emptyForm(), ...data, avatarFile: null });
          if (data.creator) {
            setAvatarPreview(`/api/characters/${encodeURIComponent(data.name)}/avatar`);
          }
        }
        setIsLoading(false);
      });
    } else if (isOpen && !characterId) {
      setFormData(emptyForm());
      setAvatarPreview(null);
    }
  }, [isOpen, characterId]);

  const handleChange = (field: keyof CharacterFormData, value: string | string[] | null) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFormData(prev => ({ ...prev, avatarFile: file }));
      const reader = new FileReader();
      reader.onload = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearAvatar = () => {
    setFormData(prev => ({ ...prev, avatarFile: null }));
    setAvatarPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      alert('Character name is required');
      return;
    }

    setIsSaving(true);
    try {
      await onSave(formData);
      // After the card data is persisted, push the avatar separately if the
      // user staged a new file. Avatar failures are surfaced to the user but
      // don't roll back the card write — the operator can re-upload.
      if (formData.avatarFile) {
        const avatarResult = await uploadCharacterAvatar(formData.name, formData.avatarFile);
        if (!avatarResult.success) {
          alert(`Character saved, but avatar upload failed: ${avatarResult.error ?? 'unknown'}`);
        }
      }
      onClose();
    } catch (error) {
      console.error('Failed to save character:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm('Are you sure you want to delete this character? This cannot be undone.')) return;

    setIsSaving(true);
    try {
      await onDelete();
      onClose();
    } catch (error) {
      console.error('Failed to delete character:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#120e0a] rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden border border-white/10 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-bath-500/20 to-bath-600/20 flex items-center justify-center border border-bath-500/30">
              <Sparkles className="text-bath-400" size={20} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {characterId ? 'Edit Character' : 'Create Character'}
              </h2>
              <p className="text-sm text-stone-500">
                {characterId ? 'Modify character details' : 'Create a new character from scratch'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/5 rounded-lg text-stone-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-stone-500">Loading character data...</div>
          </div>
        ) : (
          <>
            {/* Tabs */}
            <div className="border-b border-white/10 px-6 shrink-0">
              <div className="flex gap-1">
                {TABS.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                      activeTab === tab.id
                        ? 'text-white'
                        : 'text-stone-500 hover:text-stone-300'
                    }`}
                  >
                    {tab.label}
                    {activeTab === tab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-bath-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Basic Info Tab */}
              {activeTab === 'basic' && (
                <div className="space-y-6">
                  {/* Avatar */}
                  <div className="flex items-start gap-6">
                    <div className="shrink-0">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-32 h-32 rounded-2xl bg-stone-800 border-2 border-dashed border-stone-600 hover:border-bath-500/50 flex items-center justify-center cursor-pointer transition-colors overflow-hidden group"
                      >
                        {avatarPreview ? (
                          <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-stone-500 group-hover:text-bath-400 transition-colors">
                            <Upload size={24} />
                            <span className="text-xs">Upload</span>
                          </div>
                        )}
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={handleAvatarChange}
                        className="hidden"
                      />
                      {avatarPreview && (
                        <button
                          type="button"
                          onClick={clearAvatar}
                          className="mt-2 w-full text-xs text-stone-500 hover:text-red-400 transition-colors"
                        >
                          Clear avatar
                        </button>
                      )}
                    </div>
                    <div className="flex-1 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-stone-400 mb-2">
                          Character Name *
                        </label>
                        <input
                          type="text"
                          value={formData.name}
                          onChange={(e) => handleChange('name', e.target.value)}
                          placeholder="Enter character name"
                          className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-400 mb-2">
                          Nickname <span className="text-stone-600">(optional, V3)</span>
                        </label>
                        <input
                          type="text"
                          value={formData.nickname ?? ''}
                          onChange={(e) => handleChange('nickname', e.target.value)}
                          placeholder="Short alias or call name"
                          className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-stone-400 mb-2">
                          Tags (comma separated)
                        </label>
                        <input
                          type="text"
                          value={formData.tags?.join(', ') || ''}
                          onChange={(e) => handleChange('tags', e.target.value.split(',').map(t => t.trim()).filter(Boolean))}
                          placeholder="fantasy, female, warrior"
                          className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => handleChange('description', e.target.value)}
                      placeholder="A brief description of the character that will be shown in the character list"
                      rows={3}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none"
                    />
                  </div>

                  {/* Scenario */}
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Scenario
                    </label>
                    <textarea
                      value={formData.scenario}
                      onChange={(e) => handleChange('scenario', e.target.value)}
                      placeholder="The circumstances and context for the conversation. What's happening? Where are we?"
                      rows={3}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* Personality Tab */}
              {activeTab === 'personality' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Personality
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      Describe the character's personality traits, quirks, and behavior patterns.
                    </p>
                    <textarea
                      value={formData.personality}
                      onChange={(e) => handleChange('personality', e.target.value)}
                      placeholder="Cheerful, curious, and always eager to help. Has a tendency to make puns. Gets nervous when talking about personal matters..."
                      rows={10}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              {/* First Message Tab */}
              {activeTab === 'greeting' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      First Message / Greeting
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      The character's first message when starting a new chat. Use {"{{user}}"} for the user's name and {"{{char}}"} for the character's name.
                    </p>
                    <textarea
                      value={formData.firstMessage}
                      onChange={(e) => handleChange('firstMessage', e.target.value)}
                      placeholder="*waves excitedly* Hey there, {{user}}! I've been waiting for you!"
                      rows={8}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                    />
                  </div>

                  {/* Alternate Greetings */}
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Alternate Greetings (one per line)
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      Optional alternative first messages. Each line becomes a separate greeting option.
                    </p>
                    <textarea
                      value={formData.alternateGreetings?.join('\n---\n') || ''}
                      onChange={(e) => handleChange('alternateGreetings', e.target.value.split('\n---\n').filter(Boolean))}
                      placeholder="*looks up from reading* Oh, hello there!&#10;---&#10;*busy with something* Hmm? Oh! {{user}}! I didn't see you there."
                      rows={6}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                    />
                  </div>
                </div>
              )}

              {/* Example Dialogue Tab */}
              {activeTab === 'dialogue' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Example Dialogue
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      Example conversations that demonstrate the character's speaking style. Format: {"{{user}}: message"} and {"{{char}}: response"}
                    </p>
                    <textarea
                      value={formData.exampleDialogue}
                      onChange={(e) => handleChange('exampleDialogue', e.target.value)}
                      placeholder={`{{user}}: How are you today?
{{char}}: *smiles brightly* I'm doing great, thanks for asking! How about you?

{{user}}: What do you like to do for fun?
{{char}}: Oh, so many things! I love reading, going on adventures, and trying new foods. *eyes light up* Have you ever tried the pastries from the bakery downtown? They're amazing!`}
                      rows={12}
                       className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                     />
                  </div>
                </div>
              )}

              {/* Lorebook Tab */}
              {activeTab === 'lorebook' && (
                <div className="space-y-4">
                  <p className="text-xs text-stone-500">
                    Lorebook entries inject context into the prompt when their keywords appear
                    in the conversation. Changes here are sent back to the gateway as part of
                    the character card on save.
                  </p>
                  <LorebookEditor
                    value={formData.characterBook ?? null}
                    onChange={(book) => handleChange('characterBook', book)}
                  />
                </div>
              )}

              {/* Advanced Tab */}
              {activeTab === 'advanced' && (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      System Prompt
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      Additional instructions that override or supplement the main system prompt.
                    </p>
                    <textarea
                      value={formData.systemPrompt}
                      onChange={(e) => handleChange('systemPrompt', e.target.value)}
                      placeholder="Write {{char}}'s next reply in a fictional roleplay..."
                      rows={5}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Post-History Instructions
                    </label>
                    <p className="text-xs text-stone-500 mb-3">
                      Instructions inserted after the chat history, right before generating a response.
                    </p>
                    <textarea
                      value={formData.postHistoryInstructions}
                      onChange={(e) => handleChange('postHistoryInstructions', e.target.value)}
                      placeholder="Remember to stay in character and respond naturally..."
                      rows={4}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none font-mono text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-stone-400 mb-2">
                      Creator Notes (not sent to AI)
                    </label>
                    <textarea
                      value={formData.creatorNotes}
                      onChange={(e) => handleChange('creatorNotes', e.target.value)}
                      placeholder="Notes about this character for your reference..."
                      rows={3}
                      className="w-full bg-stone-800/50 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-bath-500/50 resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-white/10 flex items-center justify-between shrink-0">
              <div>
                {characterId && onDelete && (
                  <button
                    onClick={handleDelete}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                    Delete Character
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  disabled={isSaving}
                  className="px-5 py-2.5 text-sm font-medium text-stone-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSaving || !formData.name.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-bath-600 to-bath-700 hover:from-bath-500 hover:to-bath-600 rounded-xl shadow-lg shadow-bath-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save size={16} />
                  {isSaving ? 'Saving...' : (characterId ? 'Save Changes' : 'Create Character')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default CharacterEditor;
