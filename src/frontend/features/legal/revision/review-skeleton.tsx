/**
 * ReviewSkeleton — streaming shell for the staff side-by-side review and letter
 * screens (`revisar/[formId]` · `generacion/[formId]`, Ola perf).
 *
 * Server-safe (no "use client"): ghost of the split layout — PDF panel left,
 * question rows right; single column under 900px. Zero visible text,
 * aria-busy, honors prefers-reduced-motion.
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

export function ReviewSkeleton() {
  const panel: React.CSSProperties = {
    border: "1px solid var(--line)",
    borderRadius: 14,
    background: "var(--card)",
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 0,
  };
  return (
    <div aria-busy="true" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 96px)", gap: 12 }}>
      <style>{`
        @keyframes ulpSkeletonSheen { 0% { background-position: 200% 0 } 100% { background-position: -200% 0 } }
        @media (prefers-reduced-motion: reduce) { [aria-busy="true"] * { animation: none !important } }
        .ulp-review-skeleton-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 16px; flex: 1; min-height: 0; }
        @media (max-width: 900px) { .ulp-review-skeleton-grid { grid-template-columns: minmax(0,1fr); } }
      `}</style>

      {/* Back link ghost */}
      <Ghost w={140} h={14} />

      <div className="ulp-review-skeleton-grid">
        {/* LEFT — official PDF ghost */}
        <div style={panel}>
          <Ghost w={160} h={14} />
          <div
            aria-hidden
            style={{ flex: 1, minHeight: 260, borderRadius: 10, background: "var(--chip, #f1f5fb)" }}
          />
        </div>

        {/* RIGHT — tabs + question rows */}
        <div style={panel}>
          <div style={{ display: "flex", gap: 8 }}>
            <Ghost w={120} h={30} r={999} />
            <Ghost w={150} h={30} r={999} />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Ghost w={`${80 - i * 6}%`} h={12} />
              <div
                aria-hidden
                style={{
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  border: "1.5px solid var(--line)",
                  background: "var(--card)",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Pinned action bar ghost */}
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)" }}>
        <Ghost w={170} h={36} r={999} />
        <Ghost w={120} h={36} r={999} />
        <Ghost w={110} h={36} r={999} />
      </div>
    </div>
  );
}
