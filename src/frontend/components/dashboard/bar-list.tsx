import Link from "next/link";
import { chartColor } from "./format";
import type { BreakdownItem } from "./types";

/**
 * BarList — Tremor-style ranked list (lead sources, handoffs, overdue buckets…).
 * A horizontal bar (share of the max) sits behind each label, value on the right.
 * Pure CSS, no recharts → cheap and accessible. Rows link when `href` is set.
 */
export function BarList({
  items,
  formatValue = (n) => String(n),
}: {
  items: BreakdownItem[];
  formatValue?: (n: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((it, i) => {
        const pct = Math.round((it.value / max) * 100);
        const color = it.color ?? chartColor(i);
        const row = (
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderRadius: 8, overflow: "hidden" }}>
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: `${pct}%`,
                background: color,
                opacity: 0.16,
                borderRadius: 8,
              }}
            />
            <span style={{ position: "relative", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{it.name}</span>
            <span style={{ position: "relative", fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{formatValue(it.value)}</span>
          </div>
        );
        return it.href ? (
          <Link key={it.name} href={it.href} style={{ textDecoration: "none", color: "inherit" }}>
            {row}
          </Link>
        ) : (
          <div key={it.name}>{row}</div>
        );
      })}
    </div>
  );
}
