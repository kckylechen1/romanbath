import React, { useState, useEffect, useRef } from "react";
import { X, Image as ImageIcon, Loader2, Download } from "lucide-react";
import { generateImage } from "../services/imageGenService";

const STYLE_PRESETS = [
  "cinematic photorealistic",
  "anime style",
  "oil painting",
  "dark fantasy",
  "film noir",
  "soft watercolor",
] as const;

interface ImageGenModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: string;
  characterAppearance?: string;
}

const ImageGenModal: React.FC<ImageGenModalProps> = ({
  isOpen,
  onClose,
  initialPrompt,
  characterAppearance,
}) => {
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<"1k" | "2k">("1k");
  const [style, setStyle] = useState<string>(STYLE_PRESETS[0]);
  const [useCharacterContext, setUseCharacterContext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isComposingRef = useRef(false);

  // Pre-fill prompt when initialPrompt changes
  useEffect(() => {
    if (isOpen && initialPrompt !== undefined) {
      setPrompt(initialPrompt);
      setImage(null);
      setError(null);
    }
  }, [isOpen, initialPrompt]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;

    // Assemble final prompt: (characterAppearance if toggle on) + " " + user prompt + ", " + style
    const parts: string[] = [];
    if (useCharacterContext && characterAppearance) {
      parts.push(characterAppearance.trim());
    }
    parts.push(trimmed);
    const assembledPrompt = parts.join(" ") + ", " + style;

    setLoading(true);
    setError(null);
    setImage(null);

    try {
      const result = await generateImage({ prompt: assembledPrompt, resolution });
      if (result.success && result.image_data_url) {
        setImage(result.image_data_url);
      } else {
        setError(result.error || "Image generation failed. Please try again.");
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = `grok-image-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
      return;
    }
    e.preventDefault();
    handleGenerate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#18181b]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg leading-tight">
                Image Generation
              </h2>
              <p className="text-white/40 text-xs">Grok Imagine</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Prompt textarea */}
          <div>
            <label className="block text-white/60 text-sm mb-2 font-medium">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Describe the image you want to generate..."
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 resize-none transition-colors"
            />
          </div>

          {/* Style selector */}
          <div>
            <label className="block text-white/60 text-sm mb-2 font-medium">
              Style
            </label>
            <div className="flex flex-wrap gap-2">
              {STYLE_PRESETS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStyle(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                    style === s
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      : "bg-white/5 text-white/40 border border-white/10 hover:text-white/60 hover:bg-white/10"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Use Character Context toggle */}
          <div className="flex items-center justify-between">
            <label className="text-white/60 text-sm font-medium">
              Use Character Context
            </label>
            <button
              onClick={() => setUseCharacterContext(!useCharacterContext)}
              className={`relative w-10 h-5 rounded-full transition-colors ${
                useCharacterContext ? "bg-purple-500" : "bg-white/10"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  useCharacterContext ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Resolution toggle */}
          <div>
            <label className="block text-white/60 text-sm mb-2 font-medium">
              Resolution
            </label>
            <div className="flex gap-2">
              {(["1k", "2k"] as const).map((res) => (
                <button
                  key={res}
                  onClick={() => setResolution(res)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    resolution === res
                      ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                      : "bg-white/5 text-white/40 border border-white/10 hover:text-white/60 hover:bg-white/10"
                  }`}
                >
                  {res === "1k" ? "1K" : "2K"}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating…
              </>
            ) : (
              "Generate"
            )}
          </button>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Result image */}
          {image && (
            <div className="space-y-3">
              <div className="rounded-xl overflow-hidden border border-white/10">
                <img
                  src={image}
                  alt="Generated"
                  className="w-full h-auto"
                />
              </div>
              <button
                onClick={handleDownload}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-white/5 border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-all flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageGenModal;
