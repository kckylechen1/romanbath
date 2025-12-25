import React from 'react';
import { Message, Role, Character } from '../types';
import { Bot, User } from 'lucide-react';

interface MessageBubbleProps {
  message: Message;
  character: Character;
  userName?: string;
}

// Format message content to style actions, dialogues, and remove citations
const formatMessageContent = (content: string): React.ReactNode => {
  // Step 1: Remove citation markers like [1], [2][3], etc.
  let cleanContent = content.replace(/\[\d+\]/g, '');

  // Step 2: Split by double newlines first to preserve paragraph structure
  const paragraphs = cleanContent.split(/\n\n+/);
  const result: React.ReactNode[] = [];
  let key = 0;

  paragraphs.forEach((paragraph, pIndex) => {
    if (!paragraph.trim()) return;

    // Process each paragraph
    const parts: React.ReactNode[] = [];

    // Regex to match:
    // - *action text* (asterisks)
    // - "dialogue" or "dialogue" (English quotes)
    // - 「dialogue」(Japanese brackets)
    // - "dialogue" or 'dialogue' (Chinese quotes)
    // - 『dialogue』(Japanese double brackets)
    const regex = /(\*[^*]+\*)|(\"[^\"]+\")|(\"[^\"]+\")|('.*?')|('.*?')|(「[^」]+」)|(『[^』]+』)/g;

    let lastIndex = 0;
    let match;
    const content = paragraph;

    while ((match = regex.exec(content)) !== null) {
      // Add text before the match
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        if (textBefore.trim()) {
          parts.push(
            <span key={key++} className="text-slate-200">{textBefore}</span>
          );
        }
      }

      const matchedText = match[0];

      if (matchedText.startsWith('*') && matchedText.endsWith('*')) {
        // Action text - style in amber/gold italic
        parts.push(
          <span
            key={key++}
            className="italic text-amber-400"
            style={{ fontStyle: 'italic' }}
          >
            {matchedText}
          </span>
        );
      } else {
        // Dialogue text (any type of quotes) - style in bright cyan
        parts.push(
          <span
            key={key++}
            className="text-cyan-400 font-medium"
          >
            {matchedText}
          </span>
        );
      }

      lastIndex = regex.lastIndex;
    }

    // Add remaining text after last match
    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex);
      if (remaining.trim()) {
        parts.push(
          <span key={key++} className="text-slate-200">{remaining}</span>
        );
      }
    }

    // If no matches found, just add the paragraph with proper styling
    if (parts.length === 0 && paragraph.trim()) {
      parts.push(
        <span key={key++} className="text-slate-200">{paragraph}</span>
      );
    }

    // Add paragraph with spacing
    if (parts.length > 0) {
      result.push(
        <p key={`p-${pIndex}`} style={{ marginBottom: pIndex < paragraphs.length - 1 ? '0.75em' : 0 }}>
          {parts}
        </p>
      );
    }
  });

  // Handle single-line content (no paragraph breaks)
  if (result.length === 0 && cleanContent.trim()) {
    // Process the entire content as a single paragraph
    const parts: React.ReactNode[] = [];
    const regex = /(\*[^*]+\*)|(\"[^\"]+\")|(\"[^\"]+\")|('.*?')|('.*?')|(「[^」]+」)|(『[^』]+』)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(cleanContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={key++} className="text-slate-200">{cleanContent.slice(lastIndex, match.index)}</span>
        );
      }

      const matchedText = match[0];
      if (matchedText.startsWith('*') && matchedText.endsWith('*')) {
        parts.push(
          <span key={key++} className="italic text-amber-400" style={{ fontStyle: 'italic' }}>{matchedText}</span>
        );
      } else {
        parts.push(
          <span key={key++} className="text-cyan-400 font-medium">{matchedText}</span>
        );
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < cleanContent.length) {
      parts.push(
        <span key={key++} className="text-slate-200">{cleanContent.slice(lastIndex)}</span>
      );
    }

    return parts.length > 0 ? parts : <span className="text-slate-200">{cleanContent}</span>;
  }

  return result;
};

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, character, userName }) => {
  const isUser = message.role === Role.User;

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] md:max-w-[75%] gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>

        {/* Avatar */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md overflow-hidden ${isUser ? 'bg-slate-600' : 'bg-slate-800'}`}>
            {isUser ? (
              <User size={16} className="text-slate-100" />
            ) : character.avatar ? (
              <img src={character.avatar} alt="Bot" className="w-8 h-8 object-cover" />
            ) : (
              <Bot size={16} className="text-slate-400" />
            )}
          </div>
        </div>

        {/* Bubble */}
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1 px-1">
            {isUser ? (userName || 'You') : character.name}
          </span>
          <div
            className={`relative px-5 py-3 rounded-2xl text-sm md:text-base leading-relaxed shadow-sm backdrop-blur-md
              ${isUser
                ? 'bg-slate-700 text-slate-100 rounded-tr-none border border-white/5'
                : 'bg-zinc-900/60 text-slate-200 rounded-tl-none border border-white/5'
              }
            `}
          >
            <div className="whitespace-pre-wrap font-sans">
              {isUser ? message.content : formatMessageContent(message.content)}
              {message.isThinking && (
                <span className="inline-flex ml-2 gap-1">
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
