import React from 'react';
import { ChatConfig } from '../types';
import {
  BrainCircuit,
  AlignLeft,
  SlidersHorizontal,
  Sparkles,
  Hash,
  Octagon,
} from 'lucide-react';
import { useLanguage } from '../i18n';

interface GenerationSettingsProps {
  config: ChatConfig;
  onConfigChange: (config: ChatConfig) => void;
}

const PRESETS: Array<{
  id: ChatConfig['responseStyle'];
  labelKey: string;
  values: Partial<ChatConfig>;
}> = [
  {
    id: 'natural',
    labelKey: 'style.natural',
    values: { temperature: 1.0, topP: 0.95, topK: 40, frequencyPenalty: 0, presencePenalty: 0 },
  },
  {
    id: 'sexy',
    labelKey: 'style.sexy',
    values: { temperature: 1.1, topP: 0.95, topK: 40, frequencyPenalty: 0, presencePenalty: 0.1 },
  },
  {
    id: 'flirty',
    labelKey: 'style.flirty',
    values: { temperature: 1.2, topP: 0.95, topK: 50, frequencyPenalty: 0.05, presencePenalty: 0.15 },
  },
  {
    id: 'horny',
    labelKey: 'style.horny',
    values: { temperature: 1.35, topP: 1.0, topK: 60, frequencyPenalty: 0.1, presencePenalty: 0.2 },
  },
  {
    id: 'custom',
    labelKey: 'style.custom',
    values: {},
  },
];

const GenerationSettings: React.FC<GenerationSettingsProps> = ({
  config,
  onConfigChange,
}) => {
  const { t } = useLanguage();

  const handleChange = (key: keyof ChatConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value });
  };

  const stopText = (config.stopSequences ?? []).join('\n');
  const setStopText = (text: string) => {
    const sequences = text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    handleChange('stopSequences', sequences);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div>
        <h3 className="text-lg font-bold text-white">{t('settings.sampler')}</h3>
        <p className="text-xs text-stone-500 mt-2">
          Sent to ZeroClaw <code className="text-stone-400">POST /api/chat</code> on each message.
          Provider and model are configured in ZeroClaw, not here.
        </p>
      </div>

      <div className="space-y-3">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <Sparkles size={14} className="text-amber-400" />
          {t('style.title')}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onConfigChange({
                  ...config,
                  responseStyle: preset.id,
                  ...preset.values,
                })
              }
              className={`p-3 rounded-xl border text-left transition-all ${
                (config.responseStyle || 'natural') === preset.id
                  ? 'bg-stone-500/20 border-stone-500/50 text-white'
                  : 'bg-black/20 border-white/5 text-stone-400 hover:bg-white/5'
              } ${preset.id === 'custom' ? 'col-span-2' : ''}`}
            >
              <div className="font-medium text-sm">{t(preset.labelKey)}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        <SliderField
          icon={<BrainCircuit size={14} />}
          label={t('param.temperature')}
          value={config.temperature}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => handleChange('temperature', v)}
        />
        <SliderField
          icon={<AlignLeft size={14} />}
          label={t('param.maxTokens')}
          value={config.maxOutputTokens}
          min={100}
          max={8192}
          step={100}
          onChange={(v) => handleChange('maxOutputTokens', v)}
          accent="bath"
        />
        <SliderField
          icon={<SlidersHorizontal size={14} />}
          label="Top P"
          value={config.topP}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => handleChange('topP', v)}
        />
        <SliderField
          icon={<SlidersHorizontal size={14} />}
          label="Top K"
          value={config.topK}
          min={0}
          max={200}
          step={1}
          onChange={(v) => handleChange('topK', Math.round(v))}
          display={String(Math.round(config.topK))}
        />
        <SliderField
          icon={<SlidersHorizontal size={14} />}
          label="Frequency penalty"
          value={config.frequencyPenalty}
          min={-2}
          max={2}
          step={0.05}
          onChange={(v) => handleChange('frequencyPenalty', v)}
        />
        <SliderField
          icon={<SlidersHorizontal size={14} />}
          label="Presence penalty"
          value={config.presencePenalty}
          min={-2}
          max={2}
          step={0.05}
          onChange={(v) => handleChange('presencePenalty', v)}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-400 flex items-center gap-2">
          <Octagon size={14} />
          Stop sequences
        </label>
        <textarea
          value={stopText}
          onChange={(e) => setStopText(e.target.value)}
          rows={3}
          placeholder="One sequence per line"
          className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-stone-500/40 font-mono resize-none"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-gray-400 flex items-center gap-2">
          <Hash size={14} />
          Seed (-1 = random)
        </label>
        <input
          type="number"
          value={config.seed}
          onChange={(e) => handleChange('seed', parseInt(e.target.value, 10) || -1)}
          className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-stone-500/40 font-mono"
        />
      </div>
    </div>
  );
};

interface SliderFieldProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  accent?: 'bath' | 'default';
  display?: string;
}

const SliderField: React.FC<SliderFieldProps> = ({
  icon,
  label,
  value,
  min,
  max,
  step,
  onChange,
  accent = 'default',
  display,
}) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center">
      <label className="text-xs font-semibold text-gray-400 flex items-center gap-2">
        {icon} {label}
      </label>
      <span
        className={`text-xs font-mono px-1.5 py-0.5 rounded ${
          accent === 'bath'
            ? 'text-bath-500/80 bg-bath-500/10'
            : 'text-stone-500 bg-black/30'
        }`}
      >
        {display ?? value}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`w-full h-1.5 bg-gray-800 rounded-lg appearance-none cursor-pointer ${
        accent === 'bath' ? 'accent-bath-500' : 'accent-stone-400'
      }`}
    />
  </div>
);

export default GenerationSettings;
