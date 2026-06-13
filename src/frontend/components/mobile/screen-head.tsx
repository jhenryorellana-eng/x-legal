"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Lex, type LexMood } from "@/frontend/components/brand/lex";

/**
 * ScreenHead — header de pantalla de la app cliente (DOC-01 §5.2, DOC-51 §0).
 * Ported verbatim from the prototype `V2/UI Cliente/app/ui.jsx → ScreenHead`.
 *
 * Layout: optional circular back button (44px, card + soft shadow) +
 * eyebrow / h1 / sub block + Lex 62px on the right.
 * Mobile-first, scales with the user text-scale (no fixed text heights).
 */

export interface ScreenHeadProps {
  /** Small label above the title (e.g. "Servicios"). */
  eyebrow?: string;
  title: string;
  /** Supporting paragraph below the title. */
  sub?: string;
  /** Lex mood (DOC-01 §5.1). Defaults to `atento`. */
  lexMood?: LexMood;
  /** Lex halo color override. */
  lexHalo?: string;
  /** When set, renders the back button and invokes this on tap. */
  onBack?: () => void;
  /** Accessible label for the back button. */
  backLabel?: string;
  /** Larger title (31px instead of 27px). */
  big?: boolean;
  /** Hide Lex (some screens use ScreenHead without the mascot). */
  hideLex?: boolean;
  /** Trailing slot rendered instead of Lex (e.g. action buttons). */
  trailing?: React.ReactNode;
}

export function ScreenHead({
  eyebrow,
  title,
  sub,
  lexMood = "atento",
  lexHalo,
  onBack,
  backLabel = "Volver",
  big,
  hideLex,
  trailing,
}: ScreenHeadProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        marginBottom: 18,
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: "var(--card)",
            boxShadow: "var(--shadow-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            marginTop: 2,
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={22} color="var(--navy)" />
        </button>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              color: "var(--ink-2)",
              fontWeight: 700,
              fontSize: 15,
              marginBottom: 2,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          className="t-black"
          style={{ margin: 0, fontSize: big ? 31 : 27, color: "var(--navy)" }}
        >
          {title}
        </h1>
        {sub && (
          <p
            style={{
              margin: "7px 0 0",
              color: "var(--ink-2)",
              fontSize: 16,
              lineHeight: 1.5,
              fontWeight: 600,
            }}
          >
            {sub}
          </p>
        )}
      </div>

      {trailing ? (
        <div style={{ flexShrink: 0 }}>{trailing}</div>
      ) : hideLex ? null : (
        <div style={{ marginTop: -4, flexShrink: 0 }}>
          <Lex size={62} mood={lexMood} halo={lexHalo} />
        </div>
      )}
    </div>
  );
}
