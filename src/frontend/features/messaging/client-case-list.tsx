"use client";

/**
 * ClientCaseChatList — the client's "your chats" list, one row per case
 * (DOC-51). Rendered inside the account-level BottomSheet; selecting a row opens
 * that case's ChatSheet. Each row uses the service's icon + color (like the
 * "Tus casos" home cards). Boundaries: no @/backend imports.
 */

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import { coerceColor, coerceIcon } from "@/frontend/features/cliente/shared/i18n";

export interface ClientCaseChatVM {
  caseId: string;
  serviceName: string | null;
  serviceColor: string | null;
  serviceIcon: string | null;
  caseNumber: string | null;
  snippet: string;
  unread: number;
  lastMessageAt: string | null;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

function relTime(iso: string | null, locale: "es" | "en"): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    // Compare against local day boundaries (epoch), not string dates.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const yestStart = new Date(todayStart);
    yestStart.setDate(todayStart.getDate() - 1);
    if (d >= todayStart)
      return d.toLocaleTimeString(locale === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" });
    if (d >= yestStart) return tt(locale, "ayer", "yest.");
    return d.toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export function ClientCaseChatList({
  chats,
  loading,
  locale,
  onSelect,
}: {
  chats: ClientCaseChatVM[];
  loading: boolean;
  locale: "es" | "en";
  onSelect: (chat: ClientCaseChatVM) => void;
}) {
  if (loading) {
    return (
      <p style={{ textAlign: "center", color: "var(--ink-3)", marginTop: 40, fontSize: 13 }}>
        {tt(locale, "Cargando tus chats…", "Loading your chats…")}
      </p>
    );
  }
  if (chats.length === 0) {
    return (
      <p style={{ textAlign: "center", color: "var(--ink-2)", marginTop: 40, fontSize: 13 }}>
        {tt(locale, "Aún no tienes casos.", "You don't have any cases yet.")}
      </p>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 10px 18px" }}>
      {chats.map((c) => (
        <button
          key={c.caseId}
          type="button"
          onClick={() => onSelect(c)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "11px 8px",
            borderRadius: 16,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: coerceColor(c.serviceColor),
            }}
          >
            <Icon name={coerceIcon(c.serviceIcon, "briefcase")} size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.serviceName ?? tt(locale, "Tu caso", "Your case")}
              </span>
              {c.caseNumber && (
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", flexShrink: 0 }}>
                  {c.caseNumber}
                </span>
              )}
            </div>
            <p style={{ margin: "1px 0 0", fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.snippet || tt(locale, "Tu equipo · te responde pronto", "Your team · replies soon")}
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
            {c.lastMessageAt && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>{relTime(c.lastMessageAt, locale)}</span>
            )}
            {c.unread > 0 && (
              <span style={{ minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: "var(--red)", color: "#fff", fontSize: 11, fontWeight: 800, display: "grid", placeItems: "center" }}>
                {c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
