"use client";

/**
 * Lex preferences (RF-VAN-005 CA3, DOC-52 §8) — local UI pref (no table).
 *
 * "Burbujas proactivas de Lex" master switch, persisted in localStorage. The
 * provider hydrates from storage; the toggle (config) flips it and every
 * LexBubble/LexDock reads `enabled` from here. Defaults ON.
 */

import * as React from "react";

const KEY = "ulp-lex-bubbles";

interface LexPrefsValue {
  bubbles: boolean;
  setBubbles: (v: boolean) => void;
}

const Ctx = React.createContext<LexPrefsValue>({
  bubbles: true,
  setBubbles: () => {},
});

export function LexPrefsProvider({ children }: { children: React.ReactNode }) {
  const [bubbles, setBubblesState] = React.useState(true);

  React.useEffect(() => {
    try {
      setBubblesState(localStorage.getItem(KEY) !== "off");
    } catch {
      /* no-op */
    }
  }, []);

  const setBubbles = React.useCallback((v: boolean) => {
    setBubblesState(v);
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {
      /* no-op */
    }
  }, []);

  return <Ctx.Provider value={{ bubbles, setBubbles }}>{children}</Ctx.Provider>;
}

export function useLexPrefs(): LexPrefsValue {
  return React.useContext(Ctx);
}
