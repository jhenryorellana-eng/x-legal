"use client";

import * as React from "react";
import {
  KpiCard,
  type KpiCardProps,
  DateRangeFilter,
  type DateRangeLabels,
  BarBreakdown,
  BarList,
  AreaTrend,
  Funnel,
  type BreakdownItem,
  type SeriesRow,
  type SeriesSpec,
  type FunnelStageVM,
} from "@/frontend/components/dashboard";
import { LexBoardBubble, type LexBubbleVM } from "@/frontend/features/lex";

/**
 * Admin dashboard view (DOC-53 §1) — real KPIs.
 *
 * Header (greeting + DateRangeFilter), a KPI row (headline "Casos activos" is
 * `hot`, each with a period-over-period delta), and the §1.1 analytics cards
 * powered by analytics.getAdminOverview: role handoffs (the star KPI), cases by
 * status/stage/service, the activity time-series, and the lead funnel.
 *
 * Presentational: the page resolves the period, fetches the DTO and maps it to
 * these already-formatted ViewModels.
 */

export interface AdminDashboardData {
  kpis: KpiCardProps[];
  handoffs: BreakdownItem[];
  casesByStatus: BreakdownItem[];
  casesByStage: BreakdownItem[];
  casesByService: BreakdownItem[];
  activity: { rows: SeriesRow[]; xKey: string; series: SeriesSpec[] };
  funnel: FunnelStageVM[];
}

export interface AdminDashboardStrings {
  greeting: string;
  sub: string;
  filter: DateRangeLabels;
  cardHandoffs: string;
  cardCasesByStatus: string;
  cardCasesByStage: string;
  cardCasesByService: string;
  cardActivity: string;
  cardFunnel: string;
  empty: string;
}

export function DashboardView({
  data,
  strings,
  lex = null,
}: {
  data: AdminDashboardData;
  strings: AdminDashboardStrings;
  /** Deterministic Lex insight for the org dashboard (P-52-07). */
  lex?: LexBubbleVM | null;
}) {
  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px, 3vw, 36px) 64px", maxWidth: 1320 }}>
      {/* view-head */}
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
            {strings.greeting}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{strings.sub}</p>
        </div>
        <DateRangeFilter labels={strings.filter} />
      </div>

      <LexBoardBubble vm={lex} orb={34} />

      {/* KPI row */}
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

      {/* Analytics grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <DashCard title={strings.cardHandoffs}>
          {data.handoffs.length ? <BarList items={data.handoffs} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardActivity}>
          {data.activity.rows.length ? (
            <AreaTrend data={data.activity.rows} xKey={data.activity.xKey} series={data.activity.series} />
          ) : (
            <Empty text={strings.empty} />
          )}
        </DashCard>

        <DashCard title={strings.cardCasesByStatus}>
          {data.casesByStatus.length ? <BarBreakdown items={data.casesByStatus} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardCasesByStage}>
          {data.casesByStage.length ? <BarBreakdown items={data.casesByStage} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardCasesByService}>
          {data.casesByService.length ? <BarBreakdown items={data.casesByService} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardFunnel}>
          {data.funnel.length ? <Funnel stages={data.funnel} /> : <Empty text={strings.empty} />}
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
        minHeight: 190,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h3 style={{ margin: "0 0 14px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
        {title}
      </h3>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", flex: 1, minHeight: 120, color: "var(--ink-3, var(--ink-2))", fontSize: 13, fontWeight: 600 }}>
      {text}
    </div>
  );
}
