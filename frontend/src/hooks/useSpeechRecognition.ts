/// <reference types="dom-speech-recognition" />
import { useState, useEffect, useRef } from 'react';
import { alert as alertDialog } from '../services/dialogService';

export const useSpeechRecognition = (onTranscript: (text: string) => void) => {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: SpeechRecognitionEvent) => {
        let newTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            newTranscript += event.results[i][0].transcript;
          }
        }
        if (newTranscript) {
          onTranscript(newTranscript);
        }
      };

      recognitionRef.current.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, [onTranscript]);

  const toggleVoiceInput = () => {
    if (!recognitionRef.current) {
      void alertDialog({
        title: 'Voice input unavailable',
        message:
          'This browser does not support the Web Speech API. Try Chrome or Edge on desktop, or Safari on iOS 14.5+.',
        okLabel: 'OK',
      });
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Failed to start speech recognition:', e);
        setIsListening(false);
      }
    }
  };

  return {
    isListening,
    toggleVoiceInput,
    isSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  };
};
