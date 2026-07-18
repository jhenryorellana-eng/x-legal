/**
 * WizardSkeleton — streaming shell for `formulario/[formId]` (Ola perf).
 *
 * Server-safe (no "use client"): pure ghost shapes + a CSS shimmer, rendered by
 * the route's loading.tsx while getFormForClient streams. Zero visible text
 * (nothing to translate), aria-busy for AT, honors prefers-reduced-motion.
 */

import type * as React from "react";

const shimmer: React.CSSProperties = {
  background:
    "linear-gradient(90deg, var(--line) 25%, color-mix(in srgb, var(--line) 40%, transparent) 50%, var(--line) 75%)",
  backgroundSize: "200% 100%",
  animation: "ulpSkeletonSheen 1.4s ease-in-out infinite",
};

function Ghost({ w, h, r = 10 }: { w: string | number; h: number; r?: number }) {
  return <div aria-hidden style={{ width: w, height: h, borderRadius: r, ...shimmer }} />;
}

export function WizardSkeleton() {
  return (
    <div
      aria-busy="true"
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "18px 16px 32px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <style>{`
        @keyframes ulpSkeletonSheen { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
        @media (prefers-reduced-motion: reduce) { [aria-busy="true"] * { animation: none !important } }
      `}</style>

      {/* Header: back + step counter + progress bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Ghost w={34} h={34} r={999} />
        <Ghost w={110} h={14} />
      </div>
      <Ghost w="100%" h={8} r={999} />

      {/* Group title */}
      <Ghost w="70%" h={22} />

      {/* Question blocks: label + control */}
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: i === 0 ? 6 : 0 }}>
          <Ghost w={`${78 - i * 9}%`} h={14} />
          <div
            aria-hidden
            style={{
              width: "100%",
              height: i === 1 ? 96 : 52,
              borderRadius: 18,
              border: "1.5px solid var(--line)",
              background: "var(--card)",
            }}
          />
        </div>
      ))}

      {/* Bottom CTA */}
      <div style={{ marginTop: 10 }}>
        <Ghost w="100%" h={52} r={999} />
      </div>
    </div>
  );
}
