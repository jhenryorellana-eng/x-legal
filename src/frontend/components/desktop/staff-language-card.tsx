"use client";

/**
 * StaffLanguageCard — shared language (ES/EN) switch for the staff panels
 * (DOC-24 i18n). Token-styled so it renders correctly in any staff surface.
 * The persist action (users.locale + cookie) is injected by the page; on change
 * it persists then reloads so SSR re-renders in the new language.
 */

import * as React from "react";

export interface StaffLanguageCardProps {
  current: "es" | "en";
  setLocale: (locale: "es" | "en") => Promise<{ ok: boolean }>;
  strings: { title: string; subtitle?: string; spanish: string; english: string };
}

export function StaffLanguageCard({ current, setLocale, strings }: StaffLanguageCardProps) {
  const [busy, setBusy] = React.useState(false);

  const change = async (l: "es" | "en") => {
    if (l === current || busy) return;
    setBusy(true);
    await setLocale(l);
    window.location.reload();
  };

  return (
    <div
      style={{
        maxWidth: 760,
        background: "var(--card)",
        border: "1px solid var(--line)",
        borderRadius: 18,
        padding: "20px 22px",
      }}
    >
      <div style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15.5, color: "var(--ink)" }}>
        {strings.title}
      </div>
      {strings.subtitle ? (
        <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2, fontWeight: 600 }}>
          {strings.subtitle}
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "var(--blue-soft)",
          borderRadius: 12,
          padding: 4,
          maxWidth: 320,
          marginTop: 14,
        }}
      >
        {(["es", "en"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => change(l)}
            disabled={busy}
            aria-pressed={current === l}
            style={{
              flex: 1,
              height: 40,
              border: "none",
              borderRadius: 10,
              cursor: busy ? "default" : "pointer",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 14,
              background: current === l ? "var(--accent)" : "transparent",
              color: current === l ? "#fff" : "var(--ink-2)",
              transition: "background .15s, color .15s",
            }}
          >
            {l === "es" ? strings.spanish : strings.english}
          </button>
        ))}
      </div>
    </div>
  );
}
