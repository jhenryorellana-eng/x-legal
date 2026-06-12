import * as React from "react";

/**
 * ProgressBar (DOC-01 §5.1).
 * 8–12px tall, pill, gold gradient fill over a `--line` track, width `.9s`.
 */

export interface ProgressBarProps {
  /** 0–100. */
  pct?: number;
  /** Track height in px. */
  height?: number;
  "aria-label"?: string;
}

export function ProgressBar({
  pct = 40,
  height = 9,
  "aria-label": ariaLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? "Progreso"}
      style={{
        background: "var(--line)",
        borderRadius: 999,
        height,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div
        style={{
          width: `${clamped}%`,
          height: "100%",
          borderRadius: 999,
          background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
          transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
        }}
      />
    </div>
  );
}
