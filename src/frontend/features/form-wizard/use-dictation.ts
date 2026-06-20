"use client";

import * as React from "react";
import { getBridge, type Unsubscribe } from "@/frontend/platform-bridge";

/**
 * useDictation — voice-to-text for "Mi Historia" and `textarea` relato fields
 * (DOC-50 §6.1, DOC-51 §20). Progressive enhancement:
 *
 *  - PWA: Web Speech API behind the platform-bridge (`getBridge().dictation`).
 *    Transcribed text is APPENDED live to the field; the audio is NEVER stored,
 *    only the text (RF-CLI-034).
 *  - Capacitor (F8): the same `getBridge().dictation` surface resolves to a
 *    native speech plugin without changing this hook. Until then the bridge
 *    degrades to Web Speech and, when unavailable, the field keeps working by
 *    hand (never blocking).
 *
 * Language follows `users.locale` (passed in). On any error / permission denial
 * the hook stops listening and the textarea stays fully usable.
 */

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
  const onAppendRef = React.useRef(onAppend);
  onAppendRef.current = onAppend;
  // Subscriptions for the active session — torn down on stop / unmount.
  const subsRef = React.useRef<Unsubscribe[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void getBridge()
      .dictation.isSupported()
      .then((ok) => {
        if (!cancelled) setIsSupported(ok);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const teardown = React.useCallback(() => {
    subsRef.current.forEach((unsub) => unsub());
    subsRef.current = [];
  }, []);

  const stop = React.useCallback(() => {
    void getBridge().dictation.stop();
    teardown();
    setIsListening(false);
  }, [teardown]);

  const start = React.useCallback(() => {
    const dictation = getBridge().dictation;
    teardown();
    // Only finalized chunks are appended — interim text is never written so the
    // field never flickers and the audio itself is never persisted.
    subsRef.current.push(
      dictation.onResult((r) => {
        if (r.isFinal && r.transcript.trim()) onAppendRef.current(r.transcript);
      }),
      dictation.onError(() => {
        teardown();
        setIsListening(false);
      }),
      dictation.onEnd(() => {
        teardown();
        setIsListening(false);
      }),
    );
    void dictation
      .start({ lang: locale === "es" ? "es-US" : "en-US", interimResults: true })
      .then(() => setIsListening(true))
      .catch(() => {
        teardown();
        setIsListening(false);
      });
  }, [locale, teardown]);

  const toggle = React.useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  // Clean up on unmount — never leave the mic open.
  React.useEffect(() => {
    return () => {
      void getBridge().dictation.stop();
      teardown();
    };
  }, [teardown]);

  return { isSupported, isListening, toggle, stop };
}
