"use client";

/**
 * Lex — proactive bubble + dock (DOC-52 §0.5, RF-VAN-005).
 *
 * V2.0 Lex is DETERMINISTIC: greetings and bubbles are computed by rules over
 * the real data already loaded (no LLM, P-52-07). The parent view passes the
 * composed text + actions; this component only renders + manages dismissal.
 *
 * - LexBubble: glass bubble with orb, rich text (<b> in accent), action row,
 *   close. Dismissed → does not reappear this session (key persisted to a
 *   session Set). The global "Lex bubbles" toggle (config) hides ALL bubbles.
 * - LexDock: 66px FAB orb (badge "1" when an unseen insight exists) + 360px
 *   glass panel with greeting message + quick-question pills.
 */

import * as React from "react";
import { MSym } from "./msym";

const LEX_WEBP = "/assets/lex.webp";
const LEX_GIF = "/assets/lex.gif";

function LexOrb({ size }: { size: number }) {
  return (
    <span
      className="lexbub-orb"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <picture>
        <source srcSet={LEX_WEBP} type="image/webp" />
        <img src={LEX_GIF} alt="" width={size} height={size} />
      </picture>
    </span>
  );
}

export interface LexAction {
  label: string;
  icon?: string;
  ghost?: boolean;
  onClick: () => void;
}

export interface LexBubbleProps {
  /** Stable key — once dismissed it won't reappear this session. */
  dismissKey: string;
  /** Rich text; <b>…</b> renders in accent. Provided already-localized. */
  html: string;
  orb?: number;
  actions?: LexAction[];
  /** Master switch from config (RF-VAN-005 CA3). When false → render nothing. */
  enabled?: boolean;
}

// Session-scoped dismissed set (per view key). Module-level so it survives
// route re-renders within the SPA session.
const dismissed = new Set<string>();

export function LexBubble({
  dismissKey,
  html,
  orb = 30,
  actions,
  enabled = true,
}: LexBubbleProps) {
  const [gone, setGone] = React.useState(() => dismissed.has(dismissKey));
  if (!enabled || gone) return null;

  const close = () => {
    dismissed.add(dismissKey);
    setGone(true);
  };

  return (
    <div className="lexbub" style={{ marginBottom: 16, borderTopLeftRadius: 16 }}>
      <LexOrb size={orb} />
      <div style={{ flex: 1, minWidth: 0, paddingRight: 18 }}>
        <div className="lexbub-name">
          Lex <span aria-hidden="true">✦</span>
        </div>
        <div
          className="lexbub-txt"
          // Rich text is composed server-side from i18n strings (no user input).
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {actions && actions.length > 0 && (
          <div className="lexbub-acts">
            {actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className={`lexbub-act${a.ghost ? " ghost" : ""}`}
                onClick={a.onClick}
              >
                {a.icon && <MSym name={a.icon} size={15} />}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="lexbub-x"
        onClick={close}
        aria-label="Descartar sugerencia de Lex"
      >
        <MSym name="close" size={16} />
      </button>
    </div>
  );
}

export interface LexQuickQuestion {
  label: string;
  /** Pre-written deterministic answer (tone reference of `ANSWERS`). */
  answer: string;
}

export interface LexDockProps {
  /** Contextual greeting for the current view (already localized + composed). */
  greetingHtml: string;
  quickQuestions: LexQuickQuestion[];
  statusLabel: string;
  enabled?: boolean;
}

export function LexDock({
  greetingHtml,
  quickQuestions,
  statusLabel,
  enabled = true,
}: LexDockProps) {
  const [open, setOpen] = React.useState(false);
  const [seen, setSeen] = React.useState(false);
  const [answers, setAnswers] = React.useState<{ q: string; a: string }[]>([]);

  if (!enabled) return null;

  const toggle = () => {
    setOpen((o) => !o);
    setSeen(true);
  };

  return (
    <div className="lex-dock">
      {open && (
        <div className="lex-panel" role="dialog" aria-label="Lex, asistente">
          <div className="lex-panel-head">
            <span className="lex-launch-orb" style={{ width: 38, height: 38 }}>
              <picture>
                <source srcSet={LEX_WEBP} type="image/webp" />
                <img src={LEX_GIF} alt="" width={38} height={38} />
              </picture>
            </span>
            <div style={{ flex: 1 }}>
              <div className="nm">Lex</div>
              <div className="st">{statusLabel}</div>
            </div>
            <button
              type="button"
              className="lexbub-x"
              style={{ position: "static" }}
              onClick={() => setOpen(false)}
              aria-label="Cerrar Lex"
            >
              <MSym name="close" size={18} />
            </button>
          </div>
          <div className="lex-msgs">
            <div
              className="lex-msg"
              dangerouslySetInnerHTML={{ __html: greetingHtml }}
            />
            {answers.map((m, i) => (
              <React.Fragment key={i}>
                <div className="lex-msg me">{m.q}</div>
                <div
                  className="lex-msg"
                  dangerouslySetInnerHTML={{ __html: m.a }}
                />
              </React.Fragment>
            ))}
          </div>
          <div className="lex-quick">
            {quickQuestions.map((q) => (
              <button
                key={q.label}
                type="button"
                className="lex-q"
                onClick={() =>
                  setAnswers((prev) => [...prev, { q: q.label, a: q.answer }])
                }
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className="lex-launch"
        onClick={toggle}
        aria-label="Abrir asistente Lex"
      >
        <span className="lex-launch-orb">
          <span className="lex-orb-halo" aria-hidden="true" />
          <picture>
            <source srcSet={LEX_WEBP} type="image/webp" />
            <img src={LEX_GIF} alt="" width={66} height={66} />
          </picture>
        </span>
        {!seen && <span className="pop">1</span>}
      </button>
    </div>
  );
}
