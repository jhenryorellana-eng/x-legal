import { chartColor } from "./format";
import type { FunnelStageVM } from "./types";

/**
 * Funnel — horizontal conversion funnel (leads → contactados → … → traspaso).
 * Bar width is % of the first stage; drop badges flag the loss between stages.
 * Pure CSS (no recharts) so it's cheap above the fold.
 */
export function Funnel({ stages }: { stages: FunnelStageVM[] }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {stages.map((s, i) => (
        <div key={s.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
                {s.count} · {s.pct}%
              </span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.min(100, Math.max(0, s.pct))}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: chartColor(i),
                  transition: "width 0.5s var(--ease, ease)",
                }}
              />
            </div>
          </div>
          <span
            style={{
              minWidth: 52,
              textAlign: "right",
              fontSize: 12,
              fontWeight: 800,
              color: s.drop ? "var(--red)" : "transparent",
            }}
          >
            {s.drop ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}
