"use client";

/**
 * ChatSheet — client messaging overlay "Tu equipo" (O1, PROMPT-CLI-27).
 *
 * Solid surfaces (no translucent chrome), styled to match the staff panel.
 * The header carries identity + the roster toggle only; group call/video live
 * inside the roster ("Integrantes"), next to the people they reach. A visual
 * call overlay covers the screen on call (LiveKit lands in F7).
 * Boundaries: no @/backend imports.
 */

import * as React from "react";
import { BottomSheet } from "@/frontend/components/mobile";
import { Icon } from "@/frontend/components/brand";
import { ChatThread } from "./chat-thread";
import type { ChatActions, ChatThreadVM, ParticipantVM } from "./types";

export interface ChatSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  locale: "es" | "en";
  /** Lazily loads the thread when the sheet opens. */
  loadThread: () => Promise<ChatThreadVM | null>;
  actions: ChatActions;
  /** When set, the header shows a "back" arrow (e.g. return to the case list). */
  onBack?: () => void;
}

type Call = { kind: "audio" | "video"; name: string; participants: ParticipantVM[] };

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

function Avatar({ p, size = 34, ring }: { p: ParticipantVM; size?: number; ring?: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: p.color,
        color: "#fff",
        display: "grid",
        placeItems: "center",
        fontSize: Math.round(size * 0.36),
        fontWeight: 800,
        boxSizing: "border-box",
        border: ring ? "2.5px solid var(--card)" : undefined,
        flexShrink: 0,
      }}
    >
      {p.initials}
    </div>
  );
}

/** Square accent action button (matches the staff panel's .th-act). */
function ActionBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        background: active ? "var(--accent)" : "var(--blue-soft, #eaf1ff)",
        flexShrink: 0,
        transition: "background .14s",
      }}
    >
      {children}
    </button>
  );
}

/** In-place team roster (replaces the thread body — no modal over the sheet). */
function RosterPanel({
  staff,
  locale,
  onBack,
  onCall,
  onGroupCall,
}: {
  staff: ParticipantVM[];
  locale: "es" | "en";
  onBack: () => void;
  onCall: (p: ParticipantVM, kind: "audio" | "video") => void;
  onGroupCall: (kind: "audio" | "video") => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px 20px", background: "var(--card)" }}>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--accent)",
          fontSize: 13,
          fontWeight: 800,
          padding: "2px 0 12px",
        }}
      >
        <Icon name="arrowL" size={18} color="var(--accent)" />
        {tt(locale, "Volver al chat", "Back to chat")}
      </button>

      {/* Group call actions — the hero of this view */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        <button
          type="button"
          onClick={() => onGroupCall("audio")}
          style={groupBtnStyle}
        >
          <Icon name="phone" size={19} color="var(--accent)" />
          {tt(locale, "Llamar al equipo", "Call the team")}
        </button>
        <button
          type="button"
          onClick={() => onGroupCall("video")}
          style={groupBtnStyle}
        >
          <Icon name="video" size={19} color="var(--accent)" />
          {tt(locale, "Videollamada", "Video call")}
        </button>
      </div>

      <p style={{ margin: "0 0 6px 2px", fontSize: 12.5, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {tt(locale, "Integrantes", "Members")} · {staff.length}
      </p>
      <div>
        {staff.map((p, i) => (
          <div
            key={p.userId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 2px",
              borderTop: i === 0 ? "none" : "1px solid var(--line)",
            }}
          >
            <Avatar p={p} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{p.name}</p>
              {p.roleLabel && (
                <p style={{ margin: "1px 0 0", fontSize: 12, color: "var(--ink-2)", fontWeight: 600 }}>{p.roleLabel}</p>
              )}
            </div>
            <button type="button" onClick={() => onCall(p, "audio")} aria-label={tt(locale, `Llamar a ${p.name}`, `Call ${p.name}`)} style={memberBtnStyle}>
              <Icon name="phone" size={17} color="var(--accent)" />
            </button>
            <button type="button" onClick={() => onCall(p, "video")} aria-label={tt(locale, `Videollamar a ${p.name}`, `Video call ${p.name}`)} style={memberBtnStyle}>
              <Icon name="video" size={17} color="var(--accent)" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const groupBtnStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  height: 48,
  borderRadius: 14,
  border: "1px solid var(--line)",
  cursor: "pointer",
  background: "var(--blue-soft, #eaf1ff)",
  color: "var(--accent)",
  fontWeight: 800,
  fontSize: 13.5,
};

const memberBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: "none",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  background: "var(--blue-soft, #eaf1ff)",
  flexShrink: 0,
};

function CallOverlay({ call, locale, onEnd }: { call: Call; locale: "es" | "en"; onEnd: () => void }) {
  const heads = call.participants.slice(0, 3);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #0A1B3D, #04101F)",
        textAlign: "center",
        padding: 28,
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          {heads.length > 1 ? (
            <div style={{ display: "flex" }}>
              {heads.map((p, idx) => (
                <div key={p.userId} style={{ marginLeft: idx === 0 ? 0 : -18 }}>
                  <Avatar p={p} size={84} ring />
                </div>
              ))}
            </div>
          ) : heads[0] ? (
            <Avatar p={heads[0]} size={104} />
          ) : null}
        </div>
        <p style={{ margin: 0, color: "#fff", fontSize: 22, fontWeight: 900 }}>{call.name}</p>
        <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: 600 }}>
          {call.kind === "video" ? tt(locale, "Videollamada…", "Video call…") : tt(locale, "Llamando…", "Calling…")}
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 16, marginTop: 30 }}>
          <button
            type="button"
            onClick={onEnd}
            aria-label={tt(locale, "Colgar", "Hang up")}
            style={{ width: 66, height: 66, borderRadius: 999, border: "none", cursor: "pointer", background: "var(--red)", display: "grid", placeItems: "center", transform: "rotate(135deg)" }}
          >
            <Icon name="phone" size={26} color="#fff" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ChatSheet({ open, onClose, title, locale, loadThread, actions, onBack }: ChatSheetProps) {
  const [vm, setVm] = React.useState<ChatThreadVM | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [view, setView] = React.useState<"chat" | "roster">("chat");
  const [call, setCall] = React.useState<Call | null>(null);

  React.useEffect(() => {
    if (!open) {
      setView("chat");
      return;
    }
    if (vm) return;
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

  const staff = (vm?.participants ?? []).filter((p) => p.kind === "staff");
  const showRoster = view === "roster" && !!vm;

  return (
    <BottomSheet open={open} onClose={onClose} hideHeader height="88vh">
      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--card)" }}>
        {/* Group header — solid surface */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "13px 14px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
            background: "var(--card)",
          }}
        >
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label={tt(locale, "Volver a tus chats", "Back to your chats")}
              style={{ width: 34, height: 34, display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", borderRadius: 10, flexShrink: 0, marginLeft: -4 }}
            >
              <Icon name="arrowL" size={20} color="var(--ink-2)" />
            </button>
          )}
          {staff.length > 0 && (
            <div style={{ display: "flex", flexShrink: 0 }}>
              {staff.slice(0, 4).map((p, idx) => (
                <div key={p.userId} style={{ marginLeft: idx === 0 ? 0 : -10 }}>
                  <Avatar p={p} size={36} ring />
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 900, color: "var(--ink)" }}>{title}</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--green)", display: "inline-block", flexShrink: 0 }} />
              {tt(locale, "En línea · te responde pronto", "Online · replies soon")}
            </p>
          </div>
          {staff.length > 0 && (
            <ActionBtn
              label={tt(locale, "Ver integrantes", "View members")}
              active={showRoster}
              onClick={() => setView((v) => (v === "roster" ? "chat" : "roster"))}
            >
              <Icon name="family" size={19} color={showRoster ? "#fff" : "var(--accent)"} />
            </ActionBtn>
          )}
          <button type="button" onClick={onClose} aria-label={tt(locale, "Cerrar", "Close")}
            style={{ width: 40, height: 40, display: "grid", placeItems: "center", background: "none", border: "none", cursor: "pointer", borderRadius: 12, flexShrink: 0 }}>
            <Icon name="x" size={20} color="var(--ink-3)" />
          </button>
        </div>

        {/* Body — chat OR roster, swapped in place */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--card)" }}>
          {showRoster ? (
            <RosterPanel
              staff={staff}
              locale={locale}
              onBack={() => setView("chat")}
              onCall={(p, kind) => setCall({ kind, name: p.name, participants: [p] })}
              onGroupCall={(kind) => setCall({ kind, name: title, participants: staff })}
            />
          ) : loading || (!vm && !error) ? (
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

      {/* Visual call overlay (LiveKit in F7) */}
      {call && <CallOverlay call={call} locale={locale} onEnd={() => setCall(null)} />}
    </BottomSheet>
  );
}
