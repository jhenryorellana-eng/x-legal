"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Period } from "@/shared/period";

/**
 * DateRangeFilter — period selector that drives the RSC via searchParams.
 *
 * Writes `?period=today|week|month|custom` (+ `from`/`to` for custom) and the
 * server page re-resolves the range with resolvePeriodRange. Replaces the local
 * useState tabs (admin) and the no-op MetricasClient (ventas) so the filter
 * actually recomputes the data. Native date inputs → zero extra deps, a11y-ok.
 */
export interface DateRangeLabels {
  today: string;
  week: string;
  month: string;
  custom: string;
  from: string;
  to: string;
  apply: string;
}

const DEFAULT_LABELS: DateRangeLabels = {
  today: "Hoy",
  week: "Semana",
  month: "Mes",
  custom: "Personalizado",
  from: "Desde",
  to: "Hasta",
  apply: "Aplicar",
};

const PRESETS: Period[] = ["today", "week", "month", "custom"];

export function DateRangeFilter({ labels }: { labels?: Partial<DateRangeLabels> }) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const current = (params.get("period") as Period) || "week";
  const [from, setFrom] = React.useState(params.get("from") ?? "");
  const [to, setTo] = React.useState(params.get("to") ?? "");

  const push = React.useCallback(
    (next: URLSearchParams) => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  function selectPreset(p: Period) {
    if (p === "custom") {
      const next = new URLSearchParams(params);
      next.set("period", "custom");
      if (from) next.set("from", from);
      if (to) next.set("to", to);
      push(next);
      return;
    }
    const next = new URLSearchParams(params);
    next.set("period", p);
    next.delete("from");
    next.delete("to");
    push(next);
  }

  return (
    <div role="group" aria-label="Rango de fechas" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <div style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: "var(--r-md, 10px)", overflow: "hidden" }}>
        {PRESETS.map((p) => {
          const active = current === p;
          return (
            <button
              key={p}
              type="button"
              aria-pressed={active}
              onClick={() => selectPreset(p)}
              style={{
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                color: active ? "#fff" : "var(--ink-2)",
                background: active ? "var(--accent)" : "transparent",
                transition: "background 0.14s var(--ease, ease), color 0.14s",
              }}
            >
              {l[p]}
            </button>
          );
        })}
      </div>

      {current === "custom" && (
        <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
            {l.from}{" "}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)" }}>
            {l.to}{" "}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              style={inputStyle}
            />
          </label>
          <button
            type="button"
            onClick={() => selectPreset("custom")}
            disabled={!from || !to}
            style={{
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: "var(--r-md, 10px)",
              border: "none",
              cursor: from && to ? "pointer" : "not-allowed",
              color: "#fff",
              background: from && to ? "var(--brand-navy)" : "var(--ink-2)",
            }}
          >
            {l.apply}
          </button>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 8,
  padding: "5px 8px",
  fontSize: 13,
  color: "var(--ink)",
  background: "var(--card)",
};
