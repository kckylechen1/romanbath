import React from 'react';
import { Message, Role, Character } from '../types';
import { Bot, User } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

interface MessageBubbleProps {
  message: Message;
  character: Character;
  userName?: string;
}

// Format message content to style actions, dialogues, and add visual separation
const formatMessageContent = (content: string): React.ReactNode => {
  // Step 1: Remove citation markers like [1], [2][3], etc.
  let cleanContent = content.replace(/\[\d+\]/g, '');

  // Step 2: Split content into segments (action, dialogue, or narrative)
  // This regex matches complete action (*...*) or dialogue patterns
  const segmentRegex = /(\*[^*]+\*)|("[^"]+"|"[^"]+"|'[^']+'|'[^']+'|「[^」]+」|『[^』]+』)/g;

  const segments: { type: 'action' | 'dialogue' | 'text'; content: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = segmentRegex.exec(cleanContent)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = cleanContent.slice(lastIndex, match.index).trim();
      if (textBefore) {
        segments.push({ type: 'text', content: textBefore });
      }
    }

    const matchedText = match[0];
    if (matchedText.startsWith('*') && matchedText.endsWith('*')) {
      segments.push({ type: 'action', content: matchedText });
    } else {
      segments.push({ type: 'dialogue', content: matchedText });
    }

    lastIndex = segmentRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < cleanContent.length) {
    const remaining = cleanContent.slice(lastIndex).trim();
    if (remaining) {
      segments.push({ type: 'text', content: remaining });
    }
  }

  // Step 3: Render segments with visual separation between different types
  const result: React.ReactNode[] = [];
  let prevType: string | null = null;

  segments.forEach((segment, index) => {
    // Add spacing between different segment types (action <-> dialogue transitions)
    const needsSpacing = prevType !== null &&
      ((prevType === 'action' && segment.type === 'dialogue') ||
        (prevType === 'dialogue' && segment.type === 'action'));

    const marginTop = needsSpacing ? '0.8em' : (index > 0 ? '0.4em' : 0);

    if (segment.type === 'action') {
      result.push(
        <p
          key={index}
          className="italic text-amber-400"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>
      );
    } else if (segment.type === 'dialogue') {
      result.push(
        <p
          key={index}
          className="text-cyan-400 font-medium"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>
      );
    } else {
      result.push(
        <p
          key={index}
          className="text-slate-200"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>
      );
    }

    prevType = segment.type;
  });

  return result.length > 0 ? result : <span className="text-slate-200">{content}</span>;
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
              {isUser ? (
                message.content
              ) : message.isThinking ? (
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                  <span className="w-1.5 h-1.5 bg-current rounded-full animate-bounce"></span>
                </span>
              ) : (
                // Check if content has markdown indicators (code blocks, headers, lists)
                message.content.includes('```') ||
                  message.content.match(/^#{1,3}\s/m) ||
                  message.content.match(/^\s*[-*]\s/m) ||
                  message.content.match(/^\s*\d+\.\s/m) ? (
                  <MarkdownRenderer content={message.content} />
                ) : (
                  // Use existing formatMessageContent for simple roleplay text
                  formatMessageContent(message.content)
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
