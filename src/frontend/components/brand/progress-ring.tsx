import * as React from "react";

/**
 * ProgressRing — donut SVG (DOC-01 §5.1).
 * 76–120px, stroke 9–10px, blue→gold gradient, large centered %, animated
 * `stroke-dashoffset .9s`. Track uses `--line`.
 */

export interface ProgressRingProps {
  /** 0–100. */
  pct?: number;
  size?: number;
  stroke?: number;
  /** Center label; defaults to `${pct}%`. */
  label?: React.ReactNode;
  sub?: React.ReactNode;
  "aria-label"?: string;
}

export function ProgressRing({
  pct = 50,
  size = 76,
  stroke = 9,
  label,
  sub,
  "aria-label": ariaLabel,
}: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off = circ - (clamped / 100) * circ;
  const gradientId = React.useId();

  return (
    <div
      style={{ position: "relative", width: size, height: size }}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel ?? "Progreso"}
    >
      <svg
        width={size}
        height={size}
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--gold)" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--line)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 900,
            fontSize: size * 0.26,
            color: "var(--navy)",
            lineHeight: 1,
          }}
        >
          {label != null ? label : `${Math.round(clamped)}%`}
        </span>
        {sub && (
          <span style={{ fontSize: 11, color: "var(--ink-2)", fontWeight: 700 }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
