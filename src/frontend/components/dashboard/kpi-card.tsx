import Link from "next/link";
import { Kpi } from "@/frontend/components/desktop/kpi";
import type { IconName } from "@/frontend/components/brand/icon";
import type { Delta } from "./format";

/**
 * KpiCard — dashboard metric card built on the existing `Kpi` (DOC-01 §5.3).
 *
 * Adds: period-over-period `delta` (↑/↓ vs previous period), optional drill-down
 * `href`, and an optional goal progress bar (value vs target). Presentational —
 * the page formats `value` and computes `delta`/`goal` from the analytics DTO.
 */
export interface KpiCardProps {
  icon: IconName;
  label: string;
  /** Pre-formatted value ("$1,200" | "87%" | "—"). */
  value: string;
  delta?: Delta;
  hot?: boolean;
  href?: string;
  /** Optional progress toward a configured goal (0–100 + caption). */
  goal?: { pct: number; caption: string };
}

export function KpiCard({ icon, label, value, delta, hot, href, goal }: KpiCardProps) {
  const card = (
    <Kpi
      icon={icon}
      label={label}
      value={value}
      hot={hot}
      trend={delta ? { dir: delta.dir, label: delta.label } : undefined}
    />
  );

  const body = href ? (
    <Link href={href} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
      {card}
    </Link>
  ) : (
    card
  );

  if (!goal) return body;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {body}
      <div style={{ display: "grid", gap: 4 }}>
        <div
          aria-hidden="true"
          style={{
            height: 6,
            borderRadius: 999,
            background: "var(--line)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, goal.pct))}%`,
              height: "100%",
              borderRadius: 999,
              background:
                goal.pct >= 100
                  ? "var(--green)"
                  : goal.pct >= 80
                    ? "var(--gold)"
                    : "var(--accent)",
            }}
          />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-2)" }}>{goal.caption}</span>
      </div>
    </div>
  );
}
