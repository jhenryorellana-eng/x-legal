"use client";

import * as React from "react";
import {
  KpiCard,
  type KpiCardProps,
  DateRangeFilter,
  type DateRangeLabels,
  BarList,
  fmtMoneyCents,
  type BreakdownItem,
} from "@/frontend/components/dashboard";

/**
 * Andrium — "Resumen de finanzas" · /finanzas/resumen.
 *
 * Finance/operations overview: period KPIs (recaudado, morosidad, casos en mora,
 * por imprimir) + money breakdowns (balance ingresos/egresos, ingresos por
 * categoría, morosidad por antigüedad). Complements the collections kanban.
 * Presentational; the page composes analytics + billing + expediente.
 */

export interface FinanceData {
  kpis: KpiCardProps[];
  balance: BreakdownItem[];
  byCategory: BreakdownItem[];
  aging: BreakdownItem[];
}

export interface FinanceStrings {
  title: string;
  sub: string;
  filter: DateRangeLabels;
  cardBalance: string;
  cardByCategory: string;
  cardAging: string;
  empty: string;
}

export function FinanceResumenView({
  data,
  strings,
}: {
  data: FinanceData;
  strings: FinanceStrings;
}) {
  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px, 3vw, 36px) 64px", maxWidth: 1200 }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
        <DashCard title={strings.cardBalance}>
          {data.balance.length ? <BarList items={data.balance} formatValue={fmtMoneyCents} /> : <Empty text={strings.empty} />}
        </DashCard>
        <DashCard title={strings.cardByCategory}>
          {data.byCategory.length ? <BarList items={data.byCategory} formatValue={fmtMoneyCents} /> : <Empty text={strings.empty} />}
        </DashCard>
        <DashCard title={strings.cardAging}>
          {data.aging.length ? <BarList items={data.aging} formatValue={fmtMoneyCents} /> : <Empty text={strings.empty} />}
        </DashCard>
      </div>
    </div>
  );
}

function DashCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--panel, var(--card))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
        padding: 18,
        minHeight: 160,
      }}
    >
      <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: 100, color: "var(--ink-2)", fontSize: 13, fontWeight: 600 }}>
      {text}
    </div>
  );
}
