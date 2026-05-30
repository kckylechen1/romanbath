export interface TTSConfig {
  enabled: boolean;
  voice: string;
  rate: number;
  pitch: number;
  volume: number;
  autoPlay: boolean;
}

export const DEFAULT_TTS_CONFIG: TTSConfig = {
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

export const speak = (text: string, config: TTSConfig): void => {
  if (!window.speechSynthesis || !config.enabled) return;

  stop();

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

export const stop = (): void => {
  window.speechSynthesis?.cancel();
  currentUtterance = null;
};

export const pause = (): void => {
  window.speechSynthesis?.pause();
};

export const resume = (): void => {
  window.speechSynthesis?.resume();
};

export const isSpeaking = (): boolean => {
  return window.speechSynthesis?.speaking || false;
};
