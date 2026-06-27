import React from 'react';
import { ChatConfig } from '../../types';
import { BufferedTextArea } from './SharedComponents';
import { Shield, MessageSquare, List } from 'lucide-react';

interface CharacterTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const CharacterTab: React.FC<CharacterTabProps> = ({ config, handleChange }) => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <BufferedTextArea
        label={
          <span className="flex items-center gap-2 text-red-400">
            <Shield size={14} /> Main Prompt Override
          </span>
        }
        value={config.systemPromptOverride}
        onSave={(val) => handleChange('systemPromptOverride', val)}
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
              Crucial for defining the character&apos;s speech pattern.
            </span>
          </>
        }
        value={config.exampleDialogue}
        onSave={(val) => handleChange('exampleDialogue', val)}
        placeholder={`<START>\n{{user}}: Hello\n{{char}}: *smirks* Well look who it is.`}
        className="w-full h-40 bg-black/30 border border-white/10 rounded-xl p-3 text-xs font-mono text-gray-300 focus:outline-none focus:border-stone-500/40 resize-none"
      />

      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-2">
          <List size={14} /> Prompt Ordering
        </label>
        <select
          value={config.promptOrder}
          onChange={(e) => handleChange('promptOrder', e.target.value)}
          className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-gray-300 focus:outline-none focus:border-stone-500/40"
        >
          <option value="default">Default (Char → Examples → User → Scenario)</option>
          <option value="style_first">Style First (Note → Char → Scenario)</option>
          <option value="scenario_last">Scenario Last (Char → Note → Scenario)</option>
        </select>
      </div>
    </div>
  );
};

export default CharacterTab;
