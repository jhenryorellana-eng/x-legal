"use client";

import * as React from "react";

/**
 * Lightweight CSS confetti for the demo success moments. No deps, no canvas:
 * a handful of absolutely-positioned chips with randomized fall animations.
 * Only ever rendered after a user action (never during SSR), so the random
 * values can't cause a hydration mismatch.
 */
const COLORS = ["var(--gold)", "var(--accent)", "var(--green)", "var(--gold-deep)", "#ffffff"];

export function Confetti({ count = 38 }: { count?: number }) {
  const pieces = React.useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        duration: 1.1 + Math.random() * 1,
        color: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
        rounded: Math.random() > 0.5,
      })),
    [count],
  );

  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: -14,
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 1.4,
            background: p.color,
            borderRadius: p.rounded ? "50%" : 2,
            animation: `demo-confetti-fall ${p.duration}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  );
}
