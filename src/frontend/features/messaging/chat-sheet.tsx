"use client";

/**
 * ChatSheet — client messaging overlay "Tu equipo" (O1, PROMPT-CLI-27). Wraps
 * ChatThread in a BottomSheet with a group header (stacked team avatars +
 * presence + call/video/roster actions). Pressing "integrantes" switches the
 * overlay body in place between the chat and the team roster (NO modal-on-modal),
 * and a visual call overlay covers the screen on call (LiveKit lands in F7).
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

function HeaderBtn({
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
        borderRadius: 999,
        border: "none",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        background: active
          ? "var(--accent)"
          : "var(--blue-soft, color-mix(in srgb, var(--accent) 12%, transparent))",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

/** In-place team roster (replaces the thread body — NOT a modal over the sheet). */
function RosterPanel({
  staff,
  locale,
  onBack,
  onCall,
}: {
  staff: ParticipantVM[];
  locale: "es" | "en";
  onBack: () => void;
  onCall: (p: ParticipantVM, kind: "audio" | "video") => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "10px 14px 18px" }}>
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
          padding: "2px 0 10px",
        }}
      >
        <Icon name="arrowL" size={18} color="var(--accent)" />
        {tt(locale, "Volver al chat", "Back to chat")}
      </button>
      <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 800, color: "var(--ink-3)" }}>
        {tt(locale, "Integrantes del equipo", "Your team")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {staff.map((p) => (
          <div key={p.userId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 2px" }}>
            <Avatar p={p} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{p.name}</p>
              {p.roleLabel && (
                <p style={{ margin: "1px 0 0", fontSize: 12, color: "var(--ink-2)", fontWeight: 600 }}>{p.roleLabel}</p>
              )}
            </div>
            <HeaderBtn label={tt(locale, "Llamar", "Call")} onClick={() => onCall(p, "audio")}>
              <Icon name="phone" size={18} color="var(--accent)" />
            </HeaderBtn>
            <HeaderBtn label={tt(locale, "Videollamada", "Video call")} onClick={() => onCall(p, "video")}>
              <Icon name="video" size={18} color="var(--accent)" />
            </HeaderBtn>
          </div>
        ))}
      </div>
    </div>
  );
}

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

export function ChatSheet({ open, onClose, title, locale, loadThread, actions }: ChatSheetProps) {
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
      <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* Group header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "13px 14px",
            borderBottom: "1px solid var(--line)",
            flexShrink: 0,
            background: "linear-gradient(120deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent)",
          }}
        >
          {staff.length > 0 && (
            <div style={{ display: "flex", flexShrink: 0 }}>
              {staff.slice(0, 4).map((p, idx) => (
                <div key={p.userId} style={{ marginLeft: idx === 0 ? 0 : -10 }}>
                  <Avatar p={p} size={34} ring />
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
            <>
              <HeaderBtn label={tt(locale, "Llamar", "Call")} onClick={() => setCall({ kind: "audio", name: title, participants: staff })}>
                <Icon name="phone" size={19} color="var(--accent)" />
              </HeaderBtn>
              <HeaderBtn label={tt(locale, "Videollamada", "Video call")} onClick={() => setCall({ kind: "video", name: title, participants: staff })}>
                <Icon name="video" size={19} color="var(--accent)" />
              </HeaderBtn>
              <HeaderBtn
                label={tt(locale, "Ver integrantes", "View members")}
                active={showRoster}
                onClick={() => setView((v) => (v === "roster" ? "chat" : "roster"))}
              >
                <Icon name="family" size={19} color={showRoster ? "#fff" : "var(--accent)"} />
              </HeaderBtn>
            </>
          )}
          <button type="button" onClick={onClose} aria-label={tt(locale, "Cerrar", "Close")}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 999, flexShrink: 0 }}>
            <Icon name="x" size={20} color="var(--ink-3)" />
          </button>
        </div>

        {/* Body — chat OR roster, swapped in place (no modal over the sheet) */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {showRoster ? (
            <RosterPanel
              staff={staff}
              locale={locale}
              onBack={() => setView("chat")}
              onCall={(p, kind) => setCall({ kind, name: p.name, participants: [p] })}
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
