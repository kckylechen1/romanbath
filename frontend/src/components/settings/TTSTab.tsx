import React from 'react';
import { ChatConfig } from '../../types';

interface TTSTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const TTSTab: React.FC<TTSTabProps> = ({ config, handleChange }) => {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* 1. Enable / Disable */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-semibold text-white">Enable TTS</label>
          <p className="text-xs text-gray-400 mt-1">Enable text-to-speech for AI responses</p>
        </div>
        <button
          onClick={() =>
            handleChange('tts', {
              ...config.tts,
              enabled: !config.tts.enabled,
            })
          }
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            config.tts.enabled ? 'bg-bath-600 text-white' : 'bg-stone-700 text-gray-300'
          }`}
        >
          {config.tts.enabled ? 'Enabled' : 'Disabled'}
        </button>
      </div>

      {config.tts.enabled && (
        <div className="space-y-6">
          {/* 2. Voice selector — Grok voices */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
              Voice
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(['nova', 'shimmer'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() =>
                    handleChange('tts', {
                      ...config.tts,
                      voice: v,
                    })
                  }
                  className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition-all border ${
                    config.tts.voice === v
                      ? 'bg-bath-500/10 border-bath-500/30 text-bath-300'
                      : 'bg-black/20 border-white/5 text-gray-400 hover:border-white/10 hover:text-gray-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* 4. Rate + Pitch */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Rate
                </label>
                <span className="text-xs text-gray-400">{config.tts.rate}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={config.tts.rate}
                onChange={(e) =>
                  handleChange('tts', {
                    ...config.tts,
                    rate: parseFloat(e.target.value),
                  })
                }
                className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Pitch
                </label>
                <span className="text-xs text-gray-400">{config.tts.pitch}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={config.tts.pitch}
                onChange={(e) =>
                  handleChange('tts', {
                    ...config.tts,
                    pitch: parseFloat(e.target.value),
                  })
                }
                className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>
          </div>

          {/* 5. Volume */}
          <div className="space-y-3">
            <div className="flex justify-between">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Volume
              </label>
              <span className="text-xs text-gray-400">{Math.round(config.tts.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={config.tts.volume}
              onChange={(e) =>
                handleChange('tts', {
                  ...config.tts,
                  volume: parseFloat(e.target.value),
                })
              }
              className="w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
            />
          </div>

          {/* 6. Auto-play */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-semibold text-white">Auto-play AI Responses</label>
              <p className="text-xs text-gray-400 mt-1">Automatically read AI responses</p>
            </div>
            <button
              onClick={() =>
                handleChange('tts', {
                  ...config.tts,
                  autoPlay: !config.tts.autoPlay,
                })
              }
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                config.tts.autoPlay ? 'bg-bath-600 text-white' : 'bg-stone-700 text-gray-300'
              }`}
            >
              {config.tts.autoPlay ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TTSTab;
