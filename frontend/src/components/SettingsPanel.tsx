import React, { useState } from 'react';
import { ChatConfig } from '../types';
import {
  BookOpen,
  X,
  UserCircle,
  Palette,
  SlidersHorizontal,
  FileText,
  Book,
  Type,
  Server,
  Volume2,
  Cpu,
} from 'lucide-react';
import { useLanguage } from '../i18n';
import PersonaTab from './settings/PersonaTab';
import BackendTab from './settings/BackendTab';
import GenerationTab from './settings/GenerationTab';
import StoryTab from './settings/StoryTab';
import LorebookTab from './settings/LorebookTab';
import CharacterTab from './settings/CharacterTab';
import FormattingTab from './settings/FormattingTab';
import InterfaceTab from './settings/InterfaceTab';
import { appFeatures } from '../config/features';

const TTSTab = React.lazy(() => import('./settings/TTSTab'));

interface SettingsPanelProps {
  config: ChatConfig;
  onConfigChange: (config: ChatConfig) => void;
  isOpen: boolean;
  onClose: () => void;
}

type Tab =
  | 'backend'
  | 'generation'
  | 'story'
  | 'lorebook'
  | 'character'
  | 'persona'
  | 'formatting'
  | 'interface'
  | 'tts';

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  config,
  onConfigChange,
  isOpen,
  onClose,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<Tab>('generation');

  if (!isOpen) return null;

  const handleChange = (key: keyof ChatConfig, value: unknown) => {
    onConfigChange({ ...config, [key]: value });
  };

  const navItemClass = (tab: Tab) => `
    flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all duration-200 w-full text-left mb-1
    ${
      activeTab === tab
        ? 'bg-stone-500/10 text-stone-100 border border-stone-500/20'
        : 'text-stone-500 hover:text-stone-300 hover:bg-white/5 border border-transparent'
    }
  `;

  return (
    <div className="h-full flex bg-[#0d0b09]/98 backdrop-blur-3xl border-l border-white/5 w-full shadow-2xl font-sans">
      {/* Sidebar Navigation */}
      <div className="w-16 md:w-60 border-r border-white/5 flex flex-col pt-20 md:pt-0 bg-black/40 shrink-0">
        <div className="hidden md:flex items-center gap-3 px-6 py-5 border-b border-white/5 h-20 bg-black/20">
          <SlidersHorizontal size={18} className="text-stone-400" />
          <span className="font-bold text-stone-200 tracking-widest text-xs uppercase">
            {t('settings.configuration')}
          </span>
        </div>

        <nav className="p-3 flex-1 overflow-y-auto custom-scrollbar space-y-1">
          <button onClick={() => setActiveTab('backend')} className={navItemClass('backend')}>
            <Server size={18} />
            <span className="hidden md:inline">Backend</span>
          </button>
          <button onClick={() => setActiveTab('generation')} className={navItemClass('generation')}>
            <Cpu size={18} />
            <span className="hidden md:inline">{t('tab.generation')}</span>
          </button>
          <button onClick={() => setActiveTab('story')} className={navItemClass('story')}>
            <BookOpen size={18} />
            <span className="hidden md:inline">{t('tab.story')}</span>
          </button>
          <button onClick={() => setActiveTab('lorebook')} className={navItemClass('lorebook')}>
            <Book size={18} />
            <span className="hidden md:inline">{t('tab.lorebook')}</span>
          </button>
          <button onClick={() => setActiveTab('character')} className={navItemClass('character')}>
            <FileText size={18} />
            <span className="hidden md:inline">{t('tab.character')}</span>
          </button>
          <button onClick={() => setActiveTab('persona')} className={navItemClass('persona')}>
            <UserCircle size={18} />
            <span className="hidden md:inline">{t('tab.persona')}</span>
          </button>
          <button onClick={() => setActiveTab('formatting')} className={navItemClass('formatting')}>
            <Type size={18} />
            <span className="hidden md:inline">{t('tab.formatting')}</span>
          </button>
          <button onClick={() => setActiveTab('interface')} className={navItemClass('interface')}>
            <Palette size={18} />
            <span className="hidden md:inline">{t('tab.interface')}</span>
          </button>
          {appFeatures.tts && (
            <button onClick={() => setActiveTab('tts')} className={navItemClass('tts')}>
              <Volume2 size={18} />
              <span className="hidden md:inline">Voice</span>
            </button>
          )}
        </nav>

        <div className="p-4 border-t border-white/5 hidden md:block">
          <div className="text-[10px] text-gray-600 font-mono text-center opacity-60">
            Roman Bath (Lorebook)
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-black/20">
        {/* Mobile Close / Header */}
        <div className="flex md:hidden items-center justify-between p-4 border-b border-white/5 bg-black/40">
          <span className="font-bold uppercase tracking-wider text-sm text-gray-400">
            {t('settings.settings')}
          </span>
          <button onClick={onClose} className="p-2 bg-white/5 rounded-full text-white">
            <X size={16} />
          </button>
        </div>

        <div className="hidden md:flex h-20 items-center justify-between px-6 border-b border-white/5 bg-black/20">
          <span className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {activeTab === 'backend' && 'ZeroClaw Backend'}
            {activeTab === 'generation' && t('settings.panelTitle.generation')}
            {activeTab === 'story' && t('settings.panelTitle.story')}
            {activeTab === 'lorebook' && t('settings.panelTitle.lorebook')}
            {activeTab === 'character' && t('settings.panelTitle.character')}
            {activeTab === 'persona' && t('settings.panelTitle.persona')}
            {activeTab === 'formatting' && t('settings.panelTitle.formatting')}
            {activeTab === 'interface' && t('settings.panelTitle.interface')}
            {appFeatures.tts && activeTab === 'tts' && 'Voice / TTS'}
          </span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
          {activeTab === 'backend' && <BackendTab />}
          {activeTab === 'generation' && (
            <GenerationTab config={config} onConfigChange={onConfigChange} />
          )}
          {activeTab === 'story' && <StoryTab config={config} handleChange={handleChange} />}
          {activeTab === 'lorebook' && <LorebookTab config={config} handleChange={handleChange} />}
          {activeTab === 'character' && (
            <CharacterTab config={config} handleChange={handleChange} />
          )}
          {activeTab === 'persona' && (
            <PersonaTab
              config={config}
              onConfigChange={onConfigChange}
              handleChange={handleChange}
            />
          )}
          {activeTab === 'formatting' && (
            <FormattingTab config={config} handleChange={handleChange} />
          )}
          {activeTab === 'interface' && (
            <InterfaceTab config={config} handleChange={handleChange} />
          )}
          {appFeatures.tts && activeTab === 'tts' && (
            <React.Suspense fallback={null}>
              <TTSTab config={config} handleChange={handleChange} />
            </React.Suspense>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
