import React from 'react';
import { ToolCallInfo } from '../../types';
import { Loader2, CheckCircle2, AlertCircle, ImageIcon, Volume2, Video } from 'lucide-react';

interface ToolCallCardProps {
  toolCall: ToolCallInfo;
}

const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall }) => {
  const toolName = toolCall.toolName.toLowerCase();
  const isImage =
    toolName.includes('image_gen') ||
    toolName.includes('imagegen') ||
    toolName.includes('photo') ||
    toolName.includes('xai_image');
  const isTts = toolName.includes('tts');
  const isVideo = toolName.includes('video');
  const label = isImage ? 'Image' : isTts ? 'Voice' : isVideo ? 'Video' : toolCall.toolName;

  return (
    <div className="my-2 rounded-lg bg-white/5 border border-white/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white/5">
        {isImage ? (
          <ImageIcon size={14} className="text-purple-400" />
        ) : isTts ? (
          <Volume2 size={14} className="text-blue-400" />
        ) : isVideo ? (
          <Video size={14} className="text-pink-400" />
        ) : null}
        <span className="text-xs text-stone-400">{label}</span>
        {toolCall.status === 'running' && (
          <Loader2 size={12} className="text-stone-500 animate-spin ml-auto" />
        )}
        {toolCall.status === 'done' && (
          <CheckCircle2 size={12} className="text-green-500 ml-auto" />
        )}
        {toolCall.status === 'error' && <AlertCircle size={12} className="text-red-500 ml-auto" />}
      </div>

      {/* Media content */}
      {toolCall.mediaUrl && toolCall.status === 'done' && (
        <div className="px-3 pb-3">
          {toolCall.mediaType === 'image' && (
            <img
              src={toolCall.mediaUrl}
              alt="Generated"
              className="rounded-lg max-w-full max-h-80 object-contain"
              loading="lazy"
            />
          )}
          {toolCall.mediaType === 'audio' && (
            <audio controls className="w-full max-w-md" src={toolCall.mediaUrl} />
          )}
          {toolCall.mediaType === 'video' && (
            <video controls className="rounded-lg max-w-full max-h-80" src={toolCall.mediaUrl} />
          )}
        </div>
      )}

      {/* Error display */}
      {toolCall.status === 'error' && toolCall.output && (
        <div className="px-3 pb-3">
          <p className="text-xs text-red-400">{toolCall.output}</p>
        </div>
      )}
    </div>
  );
};

export default ToolCallCard;
