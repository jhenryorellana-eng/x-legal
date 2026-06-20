"use client";

/**
 * MensajesTab — staff case chat (F7-Ola7a). Lazy-loads the case thread and
 * renders the shared ChatThread. Receives the VM-shaped chat surface (built by
 * SharedCaseView via buildChatActions); no @/backend imports here.
 */

import * as React from "react";
import { ChatThread } from "@/frontend/features/messaging/chat-thread";
import type { ChatActions, ChatThreadVM } from "@/frontend/features/messaging/types";

export interface MensajesTabProps {
  loadThread: () => Promise<ChatThreadVM | null>;
  actions: ChatActions;
  locale: "es" | "en";
}

export function MensajesTab({ loadThread, actions, locale }: MensajesTabProps) {
  const [vm, setVm] = React.useState<ChatThreadVM | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
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
  }, [loadThread]);

  return (
    <div style={{ height: "68vh", maxHeight: 660, border: "1px solid var(--line)", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--card)" }}>
      {loading ? (
        <p style={{ textAlign: "center", color: "var(--ink-3)", marginTop: 40 }}>
          {locale === "es" ? "Cargando conversación…" : "Loading conversation…"}
        </p>
      ) : error || !vm ? (
        <p style={{ textAlign: "center", color: "var(--ink-2)", marginTop: 40 }}>
          {locale === "es" ? "No pudimos abrir el chat." : "We couldn't open the chat."}
        </p>
      ) : (
        <ChatThread vm={vm} actions={actions} locale={locale} />
      )}
    </div>
  );
}
