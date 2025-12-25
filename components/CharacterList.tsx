import React from 'react';
import { Character } from '../types';
import { Users, Plus, User } from 'lucide-react';

interface CharacterListProps {
  characters: Character[];
  selectedId: string;
  onSelect: (character: Character) => void;
  isCollapsed: boolean;
}

const CharacterList: React.FC<CharacterListProps> = ({ characters, selectedId, onSelect, isCollapsed }) => {
  return (
    <div className="flex flex-col h-full gap-4">
      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} px-2 py-4`}>
        {!isCollapsed && <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2"><Users size={20} /> Contacts</h2>}
        {isCollapsed && <Users size={24} className="text-gray-400" />}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 px-2">
        {characters.map((char) => (
          <button
            key={char.id}
            onClick={() => onSelect(char)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all duration-300 group
              ${selectedId === char.id
                ? 'bg-slate-500/10 border border-slate-500/20 shadow-sm'
                : 'hover:bg-white/5 border border-transparent'
              }
            `}
          >
            <div className="relative shrink-0">
              {char.avatar ? (
                <img
                  src={char.avatar}
                  alt={char.name}
                  className={`w-12 h-12 rounded-full object-cover ring-1 transition-all duration-300 ${selectedId === char.id ? 'ring-slate-400' : 'ring-white/10 group-hover:ring-white/20'}`}
                />
              ) : (
                <div className={`w-12 h-12 rounded-full ring-1 flex items-center justify-center bg-slate-900 transition-all duration-300 ${selectedId === char.id ? 'ring-slate-400' : 'ring-white/10 group-hover:ring-white/20'}`}>
                  <User size={24} className="text-slate-500" />
                </div>
              )}
              <div className={`absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#09090b] ${selectedId === char.id ? 'bg-slate-400' : 'bg-slate-700'}`}></div>
            </div>

            {!isCollapsed && (
              <div className="flex flex-col items-start text-left overflow-hidden">
                <span className={`font-semibold text-sm truncate w-full ${selectedId === char.id ? 'text-slate-100' : 'text-slate-400 group-hover:text-slate-300'}`}>
                  {char.name}
                </span>
                <span className="text-[10px] text-slate-600 truncate w-full uppercase font-mono tracking-tighter">
                  {char.description}
                </span>
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-white/5">
        <button className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'justify-center gap-2'} bg-slate-800/40 hover:bg-slate-800/60 text-slate-400 hover:text-slate-200 p-3 rounded-xl border border-white/5 transition-all`}>
          <Plus size={18} />
          {!isCollapsed && <span className="text-sm font-medium">New Persona</span>}
        </button>
      </div>
    </div>
  );
};

export default CharacterList;
