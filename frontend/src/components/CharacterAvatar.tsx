import React, { useState } from "react";
import { Bot, User } from "lucide-react";

const GRADIENTS = [
  "from-rose-700/90 to-orange-600/80",
  "from-violet-700/90 to-indigo-600/80",
  "from-emerald-700/90 to-teal-600/80",
  "from-amber-700/90 to-yellow-600/80",
  "from-fuchsia-700/90 to-pink-600/80",
  "from-sky-700/90 to-cyan-600/80",
] as const;

const SIZE_CLASSES = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
} as const;

const hashName = (name: string): number => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return hash;
};

const displayInitial = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed[0];
};

interface CharacterAvatarProps {
  name: string;
  avatar?: string;
  size?: keyof typeof SIZE_CLASSES;
  rounded?: "full" | "lg";
  variant?: "character" | "user";
  className?: string;
  ringClassName?: string;
}

export const CharacterAvatar: React.FC<CharacterAvatarProps> = ({
  name,
  avatar,
  size = "md",
  rounded = "full",
  variant = "character",
  className = "",
  ringClassName = "ring-white/5",
}) => {
  const [imgFailed, setImgFailed] = useState(false);
  const sizeClass = SIZE_CLASSES[size];
  const roundedClass = rounded === "lg" ? "rounded-lg" : "rounded-full";
  const gradient = GRADIENTS[hashName(name) % GRADIENTS.length];
  const showImage = Boolean(avatar) && !imgFailed;

  if (showImage) {
    return (
      <img
        src={avatar}
        alt=""
        onError={() => setImgFailed(true)}
        className={`${sizeClass} ${roundedClass} object-cover ring-1 ${ringClassName} ${className}`}
      />
    );
  }

  if (variant === "user") {
    return (
      <div
        className={`${sizeClass} ${roundedClass} flex items-center justify-center bg-stone-700/80 ring-1 ${ringClassName} ${className}`}
      >
        <User size={size === "lg" ? 20 : size === "md" ? 18 : 16} className="text-stone-200" />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} flex items-center justify-center font-semibold text-white bg-gradient-to-br ${gradient} ring-1 ${ringClassName} shadow-inner ${className}`}
      aria-hidden="true"
    >
      {displayInitial(name) || <Bot size={16} className="text-white/80" />}
    </div>
  );
};
