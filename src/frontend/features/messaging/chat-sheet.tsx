"use client";

/**
 * ChatSheet — client messaging overlay (O1). Wraps ChatThread in a BottomSheet
 * and lazily loads the case thread on open. Boundaries: no @/backend imports.
 */

import * as React from "react";
import { BottomSheet } from "@/frontend/components/mobile";
import { Icon } from "@/frontend/components/brand";
import { ChatThread } from "./chat-thread";
import type { ChatActions, ChatThreadVM } from "./types";

export interface ChatSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  locale: "es" | "en";
  /** Lazily loads the thread when the sheet opens. */
  loadThread: () => Promise<ChatThreadVM | null>;
  actions: ChatActions;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

export function ChatSheet({ open, onClose, title, locale, loadThread, actions }: ChatSheetProps) {
  const [vm, setVm] = React.useState<ChatThreadVM | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    if (!open || vm) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    loadThread()
      .then((t) => {
        if (cancelled) return;
        if (t) setVm(t);
        else setError(true);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} hideHeader height="88vh">
      <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>{title}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              {tt(locale, "Te respondemos lo antes posible", "We'll reply as soon as we can")}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={tt(locale, "Cerrar", "Close")}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 999 }}>
            <Icon name="x" size={20} color="var(--ink-3)" />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {loading || (!vm && !error) ? (
            <p style={{ textAlign: "center", color: "var(--ink-3)", marginTop: 40 }}>
              {tt(locale, "Cargando conversación…", "Loading conversation…")}
            </p>
          ) : error || !vm ? (
            <p style={{ textAlign: "center", color: "var(--ink-2)", marginTop: 40 }}>
              {tt(locale, "No pudimos abrir el chat. Intenta de nuevo.", "We couldn't open the chat. Please try again.")}
            </p>
          ) : (
            <ChatThread vm={vm} actions={actions} locale={locale} />
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
