"use client";

import {
  KpiCard,
  type KpiCardProps,
  DateRangeFilter,
  type DateRangeLabels,
  BarBreakdown,
  type BreakdownItem,
} from "@/frontend/components/dashboard";

/**
 * Diana — "Mis métricas" (legal performance) · /legal/metricas.
 *
 * Period-over-period KPIs (casos recibidos, enviados a finanzas, tu actividad)
 * with a DateRangeFilter, plus a "mis casos por estado" breakdown. Mirrors the
 * admin/ventas dashboards; presentational (the page resolves + formats data).
 */

export interface LegalMetricasData {
  kpis: KpiCardProps[];
  casesByStatus: BreakdownItem[];
}

export interface LegalMetricasStrings {
  title: string;
  sub: string;
  filter: DateRangeLabels;
  cardCasesByStatus: string;
  empty: string;
}

export function LegalMetricasView({
  data,
  strings,
}: {
  data: LegalMetricasData;
  strings: LegalMetricasStrings;
}) {
  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px, 3vw, 36px) 64px", maxWidth: 1100 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 900, fontSize: 24, letterSpacing: "-0.02em", color: "var(--navy, var(--ink))" }}>
            {strings.title}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{strings.sub}</p>
        </div>
        <DateRangeFilter labels={strings.filter} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 18,
        }}
      >
        {data.kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>

      <div
        style={{
          background: "var(--panel, var(--card))",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: 18,
        }}
      >
        <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
          {strings.cardCasesByStatus}
        </h3>
        {data.casesByStatus.length ? (
          <BarBreakdown items={data.casesByStatus} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", minHeight: 120, color: "var(--ink-2)", fontSize: 13, fontWeight: 600 }}>
            {strings.empty}
          </div>
        )}
      </div>
    </div>
  );
}
