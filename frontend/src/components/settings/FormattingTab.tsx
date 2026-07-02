import React from 'react';
import { ChatConfig } from '../../types';
import { useLanguage } from '../../i18n';
import { BufferedInput } from './SharedComponents';

interface FormattingTabProps {
  config: ChatConfig;
  handleChange: (key: keyof ChatConfig, value: unknown) => void;
}

const FormattingTab: React.FC<FormattingTabProps> = ({ config, handleChange }) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <h3 className="text-lg font-bold text-white mb-4">{t('formatting.title')}</h3>
      <div className="space-y-3">
        <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Prompt Template
        </label>
        <select
          value={config.promptTemplate || 'none'}
          onChange={(e) =>
            handleChange('promptTemplate', e.target.value === 'none' ? undefined : e.target.value)
          }
          className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-white focus:border-stone-500/40 outline-none"
        >
          <option value="none">None (Chat API)</option>
          <option value="chatml">ChatML</option>
          <option value="llama2">Llama 2</option>
          <option value="alpaca">Alpaca</option>
          <option value="mistral">Mistral</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <BufferedInput
          label={t('formatting.userPrefix')}
          value={config.userPrefix}
          onSave={(val) => handleChange('userPrefix', val)}
          className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
        />
        <BufferedInput
          label={t('formatting.modelPrefix')}
          value={config.modelPrefix}
          onSave={(val) => handleChange('modelPrefix', val)}
          className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
        />
      </div>
      <BufferedInput
        label={
          <>
            {t('formatting.contextTemplate')}
            <span className="block text-[10px] text-gray-500 font-normal normal-case mt-1">
              {t('formatting.contextTemplateDesc')}
            </span>
          </>
        }
        value={config.contextTemplate}
        onSave={(val) => handleChange('contextTemplate', val)}
        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm font-mono focus:border-stone-500/40 outline-none"
      />
    </div>
  );
};

export default FormattingTab;
