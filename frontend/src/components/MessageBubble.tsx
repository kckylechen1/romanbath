import React, { useState, useRef, useEffect } from "react";
import { Message, Role, Character, TTSConfig, GroupMessage } from "../types";
import {
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
  Image,
} from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import { CharacterAvatar } from "./CharacterAvatar";
import ToolCallCard from "./chat/ToolCallCard";
import { speak, stop, isSpeaking } from "../services/ttsService";
import { extractImagePrompt } from "../services/imageGenService";

interface MessageBubbleProps {
  message: Message;
  character: Character;
  userName?: string;
  ttsConfig?: TTSConfig;
  apiKey?: string;
  apiUrl?: string;
  // Action callbacks
  onSwipeChange?: (id: string, direction: "left" | "right") => void;
  onGenerateSwipe?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onContinue?: (id: string) => void;
  onEdit?: (id: string, content: string) => void;
  onDelete?: (id: string) => void;
  onGenerateImage?: (prompt: string) => void;
  isLastMessage?: boolean;
  isGenerating?: boolean;
}

// Format message content to style actions, dialogues, and add visual separation
const formatMessageContent = (content: string): React.ReactNode => {
  // Step 1: Remove citation markers like [1], [2][3], etc.
  const cleanContent = content.replace(/\[\d+\]/g, "");

  // Step 2: Split content into segments (action, dialogue, or narrative)
  // This regex matches complete action (*...*) or dialogue patterns
  const segmentRegex =
    /(\*[^*]+\*)|("[^"]+"|'[^']+'|“[^”]+”|‘[^’]+’|「[^」]+」|『[^』]+』|《[^》]+》)/g;

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
          className="italic text-bath-300/80"
          style={{ marginTop, marginBottom: 0, lineHeight: 1.75 }}
        >
          {segment.content}
        </p>,
      );
    } else if (segment.type === "dialogue") {
      result.push(
        <p
          key={index}
          className="text-bath-300/90 font-medium"
          style={{ marginTop, marginBottom: 0, lineHeight: 1.75 }}
        >
          {segment.content}
        </p>,
      );
    } else {
      result.push(
        <p
          key={index}
          className="text-stone-200"
          style={{ marginTop, marginBottom: 0, lineHeight: 1.75 }}
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
    <span className="text-stone-200">{content}</span>
  );
};

const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  character,
  userName,
  ttsConfig,
  apiKey,
  apiUrl,
  onSwipeChange,
  onGenerateSwipe,
  onRegenerate,
  onContinue,
  onEdit,
  onDelete,
  onGenerateImage,
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

  const groupExtra = (message as GroupMessage).extra;
  const displayName = groupExtra?.characterName || character.name;
  const avatarForDisplay =
    groupExtra?.characterName && groupExtra.characterName !== character.name
      ? ""
      : character.avatar;

  return (
    <div
      className={`flex w-full mb-6 ${isUser ? "justify-end" : "justify-start"} animate-message-in`}
      style={{ contain: "layout" }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div
        className={`flex max-w-[85%] md:max-w-[75%] gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
      >
        {/* Avatar */}
        <div className="shrink-0 flex flex-col items-center gap-1">
          {isUser ? (
            <CharacterAvatar name={userName || "You"} variant="user" size="md" ringClassName="ring-white/5" />
          ) : (
            <CharacterAvatar
              name={displayName}
              avatar={avatarForDisplay}
              size="md"
              ringClassName="ring-bath-500/20"
            />
          )}
        </div>

        {/* Bubble */}
        <div
          className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1 px-1">
            {isUser
              ? userName || "You"
              : displayName}
          </span>

          {/* Edit Mode */}
          {isEditing ? (
            <div className="w-full">
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full bg-stone-800/90 text-stone-200 p-4 rounded-2xl resize-none focus:outline-none focus:ring-2 focus:ring-bath-500/30 border border-white/10 min-w-[300px]"
                rows={3}
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-stone-400 hover:text-white bg-stone-700/50 hover:bg-stone-600/50 border border-white/5 transition-all flex items-center gap-1.5"
                >
                  <X size={14} />
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-bath-600/80 hover:bg-bath-500/80 border border-bath-500/30 transition-all flex items-center gap-1.5"
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
                className={`relative px-5 py-3 text-sm md:text-base leading-[1.75] shadow-sm backdrop-blur-md
                  ${
                    isUser
                      ? "bg-bath-950/30 text-stone-100 rounded-3xl rounded-tr-sm border border-bath-500/10"
                      : "bg-stone-900/60 text-stone-200 rounded-3xl rounded-tl-sm border border-white/5 border-l-2 border-l-bath-500/30"
                  }
                `}
              >
                <div className="whitespace-pre-wrap font-sans">
                  {isUser ? (
                    message.content
                  ) : message.isThinking ? (
                    <span className="inline-flex gap-1.5 items-center py-1">
                      <span className="w-1.5 h-1.5 bg-bath-400/60 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                      <span className="w-1.5 h-1.5 bg-bath-400/60 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                      <span className="w-1.5 h-1.5 bg-bath-400/60 rounded-full animate-bounce"></span>
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
                {/* Tool call media (images, audio, video) */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.toolCalls.map((tc, i) => (
                      <ToolCallCard key={i} toolCall={tc} />
                    ))}
                  </div>
                )}
              </div>

              {/* Swipe Navigation */}
              {hasSwipes && (
                <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
                  <button
                    onClick={() => onSwipeChange?.(message.id, "left")}
                    className="p-1 hover:bg-white/10 rounded transition-colors"
                    disabled={isGenerating}
                    aria-label="Previous swipe"
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
                    aria-label="Next swipe"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              )}

              {/* Action Toolbar - appears on hover */}
              {showActions && !message.isThinking && (
                <div
                  className={`flex gap-1 mt-2 bg-stone-800/90 rounded-lg p-1 shadow-lg border border-white/10 animate-in fade-in slide-in-from-bottom-2 duration-150`}
                >
                  {/* Edit */}
                  <button
                    onClick={handleStartEdit}
                    className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-white transition-colors"
                    aria-label="Edit"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>

                  {/* Copy */}
                  <button
                    onClick={handleCopy}
                    className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-white transition-colors"
                    aria-label="Copy"
                    title="Copy"
                  >
                    <Copy size={14} />
                  </button>

                  {/* AI-only actions */}
                  {!isUser && (
                    <>
                      {/* Image Gen Button */}
                      <button
                        onClick={() => {
                          const extracted = extractImagePrompt(message.content);
                          onGenerateImage?.(extracted || "");
                        }}
                        className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-purple-400 transition-colors"
                        aria-label="Generate image"
                        title="Generate image"
                        disabled={isGenerating}
                      >
                        <Image size={14} />
                      </button>

                      {/* TTS Button */}
                      {ttsConfig && (
                        <button
                          onClick={() => {
                            if (isSpeaking()) {
                              stop();
                            } else {
                              speak(message.content, ttsConfig, apiKey, apiUrl);
                            }
                          }}
                          className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-bath-400 transition-colors"
                          aria-label="Read aloud"
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
                        className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-bath-400 transition-colors"
                        aria-label="Regenerate"
                        title="Regenerate"
                        disabled={isGenerating}
                      >
                        <RefreshCw size={14} />
                      </button>

                      {/* New Swipe */}
                      <button
                        onClick={() => onGenerateSwipe?.(message.id)}
                        className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-bath-400 transition-colors"
                        aria-label="Generate alternative"
                        title="Generate alternative"
                        disabled={isGenerating}
                      >
                        <Shuffle size={14} />
                      </button>

                      {/* Continue (only for last message) */}
                      {isLastMessage && (
                        <button
                          onClick={() => onContinue?.(message.id)}
                          className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-bath-400 transition-colors"
                          aria-label="Continue"
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
                    className="p-1.5 hover:bg-white/10 rounded text-stone-400 hover:text-red-400 transition-colors"
                    aria-label="Delete"
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
