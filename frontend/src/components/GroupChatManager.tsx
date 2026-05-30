/**
 * Group Chat Manager Component
 * UI for creating and managing group chats with multiple characters
 */

import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Trash2,
  X,
  Check,
  Edit2,
  Shuffle,
  RotateCcw,
  Sparkles,
  ChevronDown,
  UserPlus,
  UserMinus,
} from 'lucide-react';
import { GroupChat, Character } from '../types';
import {
  getGroupChats,
  createGroupChat,
  updateGroupChat,
  deleteGroupChat,
} from '../services/groupChatService';
import { useLanguage } from '../i18n';

interface GroupChatManagerProps {
  characters: Character[];
  onSelectGroup: (group: GroupChat) => void;
  selectedGroupId?: string;
  isOpen: boolean;
  onClose: () => void;
}

const GroupChatManager: React.FC<GroupChatManagerProps> = ({
  characters,
  onSelectGroup,
  selectedGroupId,
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();
  const [groups, setGroups] = useState<GroupChat[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // New group form state
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [activationMode, setActivationMode] = useState<GroupChat['activationMode']>('natural');

  // Load groups on mount
  useEffect(() => {
    setGroups(getGroupChats());
  }, []);

  const handleCreateGroup = () => {
    if (!newGroupName.trim() || selectedCharacterIds.length < 2) return;

    const group = createGroupChat(newGroupName.trim(), selectedCharacterIds, activationMode);
    setGroups(getGroupChats());
    setIsCreating(false);
    setNewGroupName('');
    setSelectedCharacterIds([]);
    setActivationMode('natural');

    // Auto-select the new group
    onSelectGroup(group);
  };

  const handleDeleteGroup = (id: string) => {
    if (window.confirm('Delete this group chat?')) {
      deleteGroupChat(id);
      setGroups(getGroupChats());
    }
  };

  const handleUpdateGroup = (id: string, updates: Partial<GroupChat>) => {
    updateGroupChat(id, updates);
    setGroups(getGroupChats());
    setEditingId(null);
  };

  const toggleCharacterSelection = (charId: string) => {
    setSelectedCharacterIds(prev =>
      prev.includes(charId)
        ? prev.filter(id => id !== charId)
        : [...prev, charId]
    );
  };

  const getCharacterById = (id: string): Character | undefined => {
    return characters.find(c => c.id === id);
  };

  const getModeIcon = (mode: GroupChat['activationMode']) => {
    switch (mode) {
      case 'round-robin':
        return <RotateCcw size={14} />;
      case 'random':
        return <Shuffle size={14} />;
      case 'natural':
        return <Sparkles size={14} />;
    }
  };

  const getModeLabel = (mode: GroupChat['activationMode']) => {
    switch (mode) {
      case 'round-robin':
        return 'Round Robin';
      case 'random':
        return 'Random';
      case 'natural':
        return 'Natural Flow';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#0a0a0c] border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
              <Users size={20} className="text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Group Chats</h2>
              <p className="text-xs text-slate-500">Chat with multiple characters</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
          {/* Create New Group */}
          {!isCreating ? (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed border-white/10 hover:border-purple-500/30 hover:bg-purple-500/5 text-slate-400 hover:text-purple-300 transition-all group"
            >
              <Plus size={20} className="group-hover:scale-110 transition-transform" />
              <span className="font-medium">Create New Group</span>
            </button>
          ) : (
            <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-purple-300">New Group Chat</h3>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewGroupName('');
                    setSelectedCharacterIds([]);
                  }}
                  className="p-1 text-slate-400 hover:text-white rounded"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Group Name */}
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name..."
                className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/40"
                autoFocus
              />

              {/* Character Selection */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Select Characters (min 2)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar">
                  {characters.map((char) => (
                    <button
                      key={char.id}
                      onClick={() => toggleCharacterSelection(char.id)}
                      className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all ${
                        selectedCharacterIds.includes(char.id)
                          ? 'bg-purple-500/20 border-purple-500/40 text-white'
                          : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
                      }`}
                    >
                      <img
                        src={char.avatar}
                        alt={char.name}
                        className="w-8 h-8 rounded-lg object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = '/default-avatar.png';
                        }}
                      />
                      <span className="text-sm font-medium truncate flex-1">{char.name}</span>
                      {selectedCharacterIds.includes(char.id) && (
                        <Check size={14} className="text-purple-400 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Activation Mode */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Speaking Order
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['natural', 'round-robin', 'random'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setActivationMode(mode)}
                      className={`flex items-center justify-center gap-2 p-2 rounded-lg border text-xs font-medium transition-all ${
                        activationMode === mode
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
                          : 'bg-black/20 border-white/5 text-slate-400 hover:border-white/10'
                      }`}
                    >
                      {getModeIcon(mode)}
                      {getModeLabel(mode)}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-500">
                  {activationMode === 'natural' && 'Characters respond naturally based on context'}
                  {activationMode === 'round-robin' && 'Characters take turns in order'}
                  {activationMode === 'random' && 'Random character responds each time'}
                </p>
              </div>

              {/* Create Button */}
              <button
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim() || selectedCharacterIds.length < 2}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Create Group
              </button>
            </div>
          )}

          {/* Existing Groups */}
          <div className="mt-6 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Your Groups ({groups.length})
            </h3>

            {groups.length === 0 ? (
              <div className="text-center py-8 text-slate-600 text-sm">
                No group chats yet. Create one to chat with multiple characters!
              </div>
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <div
                    key={group.id}
                    className={`p-4 rounded-xl border transition-all ${
                      selectedGroupId === group.id
                        ? 'bg-purple-500/10 border-purple-500/30'
                        : 'bg-black/20 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Character Avatars Stack */}
                      <div className="flex -space-x-2 shrink-0">
                        {group.characterIds.slice(0, 3).map((charId, i) => {
                          const char = getCharacterById(charId);
                          return char ? (
                            <img
                              key={charId}
                              src={char.avatar}
                              alt={char.name}
                              className="w-10 h-10 rounded-lg border-2 border-[#0a0a0c] object-cover"
                              style={{ zIndex: 3 - i }}
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/default-avatar.png';
                              }}
                            />
                          ) : null;
                        })}
                        {group.characterIds.length > 3 && (
                          <div className="w-10 h-10 rounded-lg border-2 border-[#0a0a0c] bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400">
                            +{group.characterIds.length - 3}
                          </div>
                        )}
                      </div>

                      {/* Group Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold text-white truncate">{group.name}</h4>
                          <span className="flex items-center gap-1 text-[10px] text-slate-500 bg-white/5 px-1.5 py-0.5 rounded">
                            {getModeIcon(group.activationMode)}
                            {getModeLabel(group.activationMode)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {group.characterIds.map(id => getCharacterById(id)?.name).filter(Boolean).join(', ')}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => onSelectGroup(group)}
                          className="px-3 py-1.5 text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 rounded-lg transition-colors"
                        >
                          {selectedGroupId === group.id ? 'Active' : 'Select'}
                        </button>
                        <button
                          onClick={() => handleDeleteGroup(group.id)}
                          className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 bg-black/20">
          <p className="text-[10px] text-slate-600 text-center">
            Group chats let multiple characters interact with you and each other.
          </p>
        </div>
      </div>
    </div>
  );
};

export default GroupChatManager;
