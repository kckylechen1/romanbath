import React, { useState, useRef, useEffect } from "react";
import { Message, Role, Character, TTSConfig, GroupMessage } from "../types";
import {
  Bot,
  User,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Copy,
  RefreshCw,
  Shuffle,
  ArrowRight,
  Trash2,
  Check,
  X,
  Volume2,
  VolumeX,
} from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { speak, stop, isSpeaking } from "../services/ttsService";

interface MessageBubbleProps {
  message: Message;
  character: Character;
  userName?: string;
  ttsConfig?: TTSConfig;
  // Action callbacks
  onSwipeChange?: (id: string, direction: "left" | "right") => void;
  onGenerateSwipe?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onContinue?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  isLastMessage?: boolean;
  isGenerating?: boolean;
}

// Format message content to style actions, dialogues, and add visual separation
const formatMessageContent = (content: string): React.ReactNode => {
  // Step 1: Remove citation markers like [1], [2][3], etc.
  let cleanContent = content.replace(/\[\d+\]/g, "");

  // Step 2: Split content into segments (action, dialogue, or narrative)
  // This regex matches complete action (*...*) or dialogue patterns
  const segmentRegex =
    /(\*[^*]+\*)|("[^"]+"|"[^"]+"|'[^']+'|'[^']+'|「[^」]+」|『[^』]+』)/g;

  const segments: { type: "action" | "dialogue" | "text"; content: string }[] =
    [];
  let lastIndex = 0;
  let match;

  while ((match = segmentRegex.exec(cleanContent)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      const textBefore = cleanContent.slice(lastIndex, match.index).trim();
      if (textBefore) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    const matchedText = match[0];
    if (matchedText.startsWith("*") && matchedText.endsWith("*")) {
      segments.push({ type: "action", content: matchedText });
    } else {
      segments.push({ type: "dialogue", content: matchedText });
    }

    lastIndex = segmentRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < cleanContent.length) {
    const remaining = cleanContent.slice(lastIndex).trim();
    if (remaining) {
      segments.push({ type: "text", content: remaining });
    }
  }

  // Step 3: Render segments with visual separation between different types
  const result: React.ReactNode[] = [];
  let prevType: string | null = null;

  segments.forEach((segment, index) => {
    // Add spacing between different segment types (action <-> dialogue transitions)
    const needsSpacing =
      prevType !== null &&
      ((prevType === "action" && segment.type === "dialogue") ||
        (prevType === "dialogue" && segment.type === "action"));

    const marginTop = needsSpacing ? "0.8em" : index > 0 ? "0.4em" : 0;

    if (segment.type === "action") {
      result.push(
        <p
          key={index}
          className="italic text-amber-400"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>,
      );
    } else if (segment.type === "dialogue") {
      result.push(
        <p
          key={index}
          className="text-cyan-400 font-medium"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>,
      );
    } else {
      result.push(
        <p
          key={index}
          className="text-slate-200"
          style={{ marginTop, marginBottom: 0 }}
        >
          {segment.content}
        </p>,
      );
    }

    prevType = segment.type;
  });

  return result.length > 0 ? (
    result
  ) : (
    <span className="text-slate-200">{content}</span>
  );
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  character,
  userName,
  ttsConfig,
  onSwipeChange,
  onGenerateSwipe,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
  isLastMessage = false,
  isGenerating = false,
}) => {
  const isUser = message.role === Role.User;
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        textareaRef.current.scrollHeight + "px";
      textareaRef.current.focus();
    }
  }, [isEditing, editContent]);

  const handleStartEdit = () => {
    setEditContent(message.content);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editContent.trim() !== message.content && onEdit) {
      onEdit(message.id, editContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
  };

  const hasSwipes = !isUser && message.swipes && message.swipes.length > 1;
  const currentSwipeIndex = message.swipeId ?? 0;
  const totalSwipes = message.swipes?.length ?? 1;

  return (
    <div
      className={`flex w-full mb-6 ${isUser ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className={`flex max-w-[85%] md:max-w-[75%] gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      >
        {/* Avatar */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center shadow-md overflow-hidden ${isUser ? "bg-slate-600" : "bg-slate-800"}`}
          >
            {isUser ? (
              <User size={16} className="text-slate-100" />
            ) : character.avatar ? (
              <img
                src={character.avatar}
                alt="Bot"
                className="w-8 h-8 object-cover"
              />
            ) : (
              <Bot size={16} className="text-slate-400" />
            )}
          </div>
        </div>

        {/* Bubble */}
        <div
          className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1 px-1">
            {isUser
              ? userName || "You"
              : (message as GroupMessage).extra?.characterName || character.name}
          </span>

          {/* Edit Mode */}
          {isEditing ? (
            <div className="w-full">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-slate-800/90 text-slate-200 p-4 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-slate-500/50 border border-white/10 min-w-[300px]"
                rows={3}
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-600/50 border border-white/5 transition-all flex items-center gap-1.5"
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-emerald-600/80 hover:bg-emerald-500/80 border border-emerald-500/30 transition-all flex items-center gap-1.5"
                >
                  <Check size={14} />
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Message Bubble */}
              <div
                className={`relative px-5 py-3 rounded-2xl text-sm md:text-base leading-relaxed shadow-sm backdrop-blur-md
                  ${
                    isUser
                      ? "bg-slate-700 text-slate-100 rounded-tr-none border border-white/5"
                      : "bg-zinc-900/60 text-slate-200 rounded-tl-none border border-white/5"
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
                  ) : // Check if content has markdown indicators (code blocks, headers, lists)
                  message.content.includes("```") ||
                    message.content.match(/^#{1,3}\s/m) ||
                    message.content.match(/^\s*[-*]\s/m) ||
                    message.content.match(/^\s*\d+\.\s/m) ? (
                    <MarkdownRenderer content={message.content} />
                  ) : (
                    // Use existing formatMessageContent for simple roleplay text
                    formatMessageContent(message.content)
                  )}
                </div>
              </div>

              {/* Swipe Navigation */}
              {hasSwipes && (
                <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                  <button
                    onClick={() => onSwipeChange?.(message.id, "left")}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    disabled={isGenerating}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="font-mono">
                    {currentSwipeIndex + 1} / {totalSwipes}
                  </span>
                  <button
                    onClick={() => onSwipeChange?.(message.id, "right")}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    disabled={isGenerating}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}

              {/* Action Toolbar - appears on hover */}
              {showActions && !message.isThinking && (
                <div
                  className={`flex gap-1 mt-2 bg-slate-800/90 rounded-lg p-1 shadow-lg border border-white/10 animate-in fade-in slide-in-from-bottom-2 duration-150`}
                >
                  {/* Edit */}
                  <button
                    onClick={handleStartEdit}
                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>

                  {/* Copy */}
                  <button
                    onClick={handleCopy}
                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-white transition-colors"
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>

                  {/* AI-only actions */}
                  {!isUser && (
                    <>
                      {/* TTS Button */}
                      {ttsConfig && (
                        <button
                          onClick={() => {
                            if (isSpeaking()) {
                              stop();
                            } else {
                              speak(message.content, ttsConfig);
                            }
                          }}
                          className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-blue-400 transition-colors"
                          title="Read aloud"
                          disabled={isGenerating}
                        >
                          {isSpeaking() ? (
                            <VolumeX size={14} />
                          ) : (
                            <Volume2 size={14} />
                          )}
                        </button>
                      )}

                      {/* Regenerate */}
                      <button
                        onClick={() => onRegenerate?.(message.id)}
                        className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-amber-400 transition-colors"
                        title="Regenerate"
                        disabled={isGenerating}
                      >
                        <RefreshCw size={14} />
                      </button>

                      {/* New Swipe */}
                      <button
                        onClick={() => onGenerateSwipe?.(message.id)}
                        className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-blue-400 transition-colors"
                        title="Generate alternative"
                        disabled={isGenerating}
                      >
                        <Shuffle size={14} />
                      </button>

                      {/* Continue (only for last message) */}
                      {isLastMessage && (
                        <button
                          onClick={() => onContinue?.(message.id)}
                          className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-emerald-400 transition-colors"
                          title="Continue"
                          disabled={isGenerating}
                        >
                          <ArrowRight size={14} />
                        </button>
                      )}
                    </>
                  )}

                  {/* Delete */}
                  <button
                    onClick={() => onDelete?.(message.id)}
                    className="p-1.5 hover:bg-white/10 rounded text-slate-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default MessageBubble;
