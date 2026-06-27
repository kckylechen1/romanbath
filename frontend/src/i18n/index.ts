import React, { createContext, useContext, useState, ReactNode } from 'react';
import en from './en';
import zhCN from './zh-CN';
import zhTW from './zh-TW';

export type Language = 'en' | 'zh-CN' | 'zh-TW';

export const translations: Record<Language, Record<string, string>> = {
  en: en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

export const LanguageContext = createContext<LanguageContextType>({
  language: 'en', // Default to English
  setLanguage: () => {},
  t: (key) => key,
});

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // Default to English
  const [language, setLanguage] = useState<Language>('en');

  const t = (key: string): string => {
    return translations[language][key] || key;
  };

  return React.createElement(
    LanguageContext.Provider,
    { value: { language, setLanguage, t } },
    children
  );
};

export const useLanguage = () => useContext(LanguageContext);
