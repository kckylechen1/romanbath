import React from 'react';
import { Send, Mic } from 'lucide-react';

interface ChatInputProps {
  inputText: string;
  setInputText: (text: string) => void;
  selectedCharacterName: string;
  leftSidebarOpen: boolean;
  isListening: boolean;
  toggleVoiceInput: () => void;
  isTyping: boolean;
  handleSendMessage: () => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isComposingRef: React.MutableRefObject<boolean>;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  inputText,
  setInputText,
  selectedCharacterName,
  leftSidebarOpen,
  isListening,
  toggleVoiceInput,
  isTyping,
  handleSendMessage,
  handleKeyDown,
  isComposingRef,
}) => {
  return (
    <div className="p-4 md:p-8 z-20 bg-gradient-to-t from-[#090b0e] via-[#090b0e]/80 to-transparent bath-reveal bath-reveal-delay-4">
      <div
        className={`max-w-4xl mx-auto relative group transition-transform ${leftSidebarOpen ? '' : 'md:-translate-x-10'}`}
      >
        <div className="relative bg-[#0e1217]/60 backdrop-blur-2xl rounded-2xl p-2 flex items-end gap-2 ring-1 ring-white/5 focus-within:ring-bath-500/30 focus-within:bg-[#0e1217]/80 focus-within:shadow-[0_0_20px_rgba(212,165,116,0.10)] transition-all duration-300 shadow-2xl">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${selectedCharacterName}...`}
            className="w-full bg-transparent text-stone-200 placeholder-stone-600 px-4 py-3.5 max-h-40 min-h-[3.5rem] resize-none focus:outline-none rounded-2xl leading-relaxed scrollbar-hide"
            rows={1}
          />

          <button
            onClick={toggleVoiceInput}
            className={`mb-1.5 p-2.5 rounded-xl transition-all flex-shrink-0 duration-300
                          ${
                            isListening
                              ? 'bg-red-500/10 text-red-400 animate-pulse ring-1 ring-red-500/20'
                              : 'hover:bg-white/5 text-stone-600 hover:text-stone-300'
                          }`}
            aria-label={isListening ? 'Stop Listening' : 'Voice Input'}
            title={isListening ? 'Stop Listening' : 'Voice Input'}
          >
            <Mic size={18} />
          </button>

          <button
            onClick={handleSendMessage}
            disabled={!inputText.trim() || isTyping}
            aria-label="Send message"
            className="mb-1.5 p-2.5 rounded-xl bg-gradient-to-br from-bath-500 to-bath-700 text-white shadow-lg shadow-bath-500/20 hover:shadow-bath-500/30 hover:from-bath-400 hover:to-bath-600 active:scale-95 disabled:opacity-30 disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none transition-all duration-200 flex-shrink-0"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};
