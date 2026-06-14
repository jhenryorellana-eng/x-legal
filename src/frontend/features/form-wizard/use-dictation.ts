"use client";

import * as React from "react";

/**
 * useDictation — voice-to-text for "Mi Historia" and `textarea` relato fields
 * (DOC-50 §6.1, DOC-51 §20). Progressive enhancement:
 *
 *  - PWA: Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) after
 *    a support check. Transcribed text is APPENDED live to the field; the audio
 *    is NEVER stored, only the text (RF-CLI-034).
 *  - Capacitor (F8): a native plugin would be wired here via `platform-bridge`;
 *    until that bridge exists, we degrade to Web Speech and, when unavailable,
 *    the field keeps working by hand (never blocking).
 *
 * Language follows `users.locale` (passed in). On any error / permission denial
 * the hook reports `unsupported` and the textarea stays fully usable.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseDictationArgs {
  locale: "es" | "en";
  /** Called with each finalized chunk of transcript to append to the field. */
  onAppend: (chunk: string) => void;
}

export interface DictationApi {
  isSupported: boolean;
  isListening: boolean;
  toggle: () => void;
  stop: () => void;
}

export function useDictation({ locale, onAppend }: UseDictationArgs): DictationApi {
  const [isListening, setIsListening] = React.useState(false);
  const [isSupported, setIsSupported] = React.useState(false);
  const recRef = React.useRef<SpeechRecognitionLike | null>(null);
  const onAppendRef = React.useRef(onAppend);
  onAppendRef.current = onAppend;

  React.useEffect(() => {
    setIsSupported(getRecognitionCtor() !== null);
  }, []);

  const stop = React.useCallback(() => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setIsListening(false);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setIsSupported(false);
      return;
    }
    try {
      const rec = new Ctor();
      rec.lang = locale === "es" ? "es-US" : "en-US";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e) => {
        let chunk = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) chunk += r[0].transcript;
        }
        if (chunk.trim()) onAppendRef.current(chunk);
      };
      rec.onerror = () => {
        setIsListening(false);
      };
      rec.onend = () => {
        setIsListening(false);
      };
      recRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      setIsSupported(false);
    }
  }, [locale]);

  const toggle = React.useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  // Clean up on unmount — never leave the mic open.
  React.useEffect(() => {
    return () => {
      const rec = recRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return { isSupported, isListening, toggle, stop };
}
