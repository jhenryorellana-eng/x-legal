import * as React from "react";

/**
 * Chip (DOC-01 §5.1).
 * Pill 26px tall, 12px bold. Tones: blue · gold · green · amber · red, each
 * over its soft tint. Optional leading dot.
 */

export type ChipTone = "blue" | "gold" | "green" | "amber" | "red";

interface ChipStyle {
  bg: string;
  fg: string;
}

const CHIP_MAP: Record<ChipTone, ChipStyle> = {
  blue: { bg: "var(--blue-soft)", fg: "var(--accent)" },
  gold: { bg: "var(--gold-soft)", fg: "var(--gold-deep)" },
  green: { bg: "var(--green-soft)", fg: "var(--green)" },
  amber: { bg: "var(--gold-soft)", fg: "var(--gold-deep)" },
  red: { bg: "var(--red-soft)", fg: "var(--red)" },
};

export interface ChipProps {
  tone?: ChipTone;
  /** Show a small leading status dot in the chip color. */
  dot?: boolean;
  children: React.ReactNode;
}

export function Chip({ tone = "blue", dot = false, children }: ChipProps) {
  const s = CHIP_MAP[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 11px",
        background: s.bg,
        color: s.fg,
        borderRadius: 999,
        fontFamily: "var(--font-title)",
        fontWeight: 800,
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{
            width: 7,
            height: 7,
            borderRadius: 999,
            background: s.fg,
          }}
        />
      )}
      {children}
    </span>
  );
}
