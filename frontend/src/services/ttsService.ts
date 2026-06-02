import { generateSpeech } from './zeroclawService';

export const GROK_VOICES = ["ara", "en-US"] as const;

export interface TTSConfig {
  provider: "browser" | "grok";
  enabled: boolean;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  autoPlay: boolean;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
  provider: "browser",
  enabled: false,
  voice: "",
  rate: 1,
  pitch: 1,
  volume: 1,
  autoPlay: false,
};

let currentUtterance: SpeechSynthesisUtterance | null = null;

export const getAvailableVoices = (): SpeechSynthesisVoice[] => {
  return window.speechSynthesis?.getVoices() || [];
};

let currentAudio: HTMLAudioElement | null = null;

/** Strip scene-format metadata blocks ([状态], [图片提示词]) for clean TTS reading. */
export const stripMetadataForTTS = (text: string): string => {
  return text
    .replace(/\[状态\][\s\S]*?(?=\n\[图片提示词\]|\n\n\[|$)/g, '')
    .replace(/\[图片提示词\][\s\S]*/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const speak = async (text: string, config: TTSConfig, apiKey?: string, apiUrl?: string): Promise<void> => {
  if (!config.enabled) return;
  stop();

  const cleanText = stripMetadataForTTS(text);

  if (config.provider === "grok") {
    await speakGrok(cleanText, config, apiKey, apiUrl);
  } else {
    speakBrowser(cleanText, config);
  }
};

const speakBrowser = (text: string, config: TTSConfig): void => {
  if (!window.speechSynthesis) return;

  const utterance = new SpeechSynthesisUtterance(text);
  const voices = getAvailableVoices();
  const voice = voices.find((v) => v.name === config.voice);
  if (voice) utterance.voice = voice;
  utterance.rate = config.rate;
  utterance.pitch = config.pitch;
  utterance.volume = config.volume;
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
};

const speakGrok = async (text: string, config: TTSConfig, _apiKey?: string, _apiUrl?: string): Promise<void> => {
  const voice = config.voice || 'ara';

  const audioData = await generateSpeech(text, voice, 'en-US');
  const blob = new Blob([audioData], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  currentAudio = new Audio(url);
  currentAudio.volume = config.volume;
  currentAudio.play();
  currentAudio.onended = () => {
    URL.revokeObjectURL(url);
    currentAudio = null;
  };
};

export const stop = (): void => {
  window.speechSynthesis?.cancel();
  currentUtterance = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
};

export const pause = (): void => {
  window.speechSynthesis?.pause();
};

export const resume = (): void => {
  window.speechSynthesis?.resume();
};

export const isSpeaking = (): boolean => {
  return window.speechSynthesis?.speaking || (currentAudio !== null && !currentAudio.paused) || false;
};
