import * as React from "react";

/**
 * Logo — the real UsaLatinoPrime brand mark (`/icons/logo.png`, the navy/red
 * star on a white disc) plus the optional "X LEGAL" wordmark.
 *
 * Single source of truth for the brand lockup so the staff login, the staff
 * sidebar (every role) and the client dashboard stay in sync. Replaces the old
 * hand-drawn placeholders (the login "flag" bars and the sidebar gradient "U").
 *
 * The source PNG already carries a white circular background, so on light
 * surfaces it reads as a clean star emblem; `elevated` adds a soft ring + shadow
 * to lift it off a tinted (non-white) surface (e.g. the login gradient).
 *
 * No "use client" / hooks → usable from Server Components too.
 */

export interface LogoProps {
  /** Square size of the mark, in px. */
  size?: number;
  /** Render the wordmark next to (row) / below (column) the mark. */
  withWordmark?: boolean;
  /** Stack direction when the wordmark is shown. */
  direction?: "row" | "column";
  /** Wordmark font-size in px (defaults proportional to `size`). */
  wordmarkSize?: number;
  /** Soft shadow ring around the mark — use on colored / non-white surfaces. */
  elevated?: boolean;
  /** Accessible name. When omitted the lockup is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

export function Logo({
  size = 40,
  withWordmark = false,
  direction = "row",
  wordmarkSize,
  elevated = false,
  label,
  className,
}: LogoProps) {
  const ws = wordmarkSize ?? Math.round(size * 0.42);
  const decorative = !label;

  return (
    <span
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      style={{
        display: "inline-flex",
        flexDirection: direction,
        alignItems: "center",
        gap: withWordmark ? Math.round(size * (direction === "row" ? 0.3 : 0.22)) : 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset, sized; matches <Lex> */}
      <img
        src="/icons/logo.png"
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          borderRadius: "50%",
          flexShrink: 0,
          boxShadow: elevated
            ? "0 4px 14px rgba(11,27,51,0.18), 0 0 0 1px color-mix(in srgb, var(--line) 70%, transparent)"
            : undefined,
        }}
      />
      {withWordmark && (
        <span
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: ws,
            color: "var(--navy)",
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            whiteSpace: "nowrap",
          }}
        >
          X <span style={{ color: "var(--accent)" }}>LEGAL</span>
        </span>
      )}
    </span>
  );
}
