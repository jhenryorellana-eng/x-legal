"use client";

import * as React from "react";
import Link from "next/link";
import {
  KpiCard,
  type KpiCardProps,
  DateRangeFilter,
  type DateRangeLabels,
  BarList,
  AreaTrend,
  fmtUsd,
  type BreakdownItem,
  type SeriesRow,
  type SeriesSpec,
} from "@/frontend/components/dashboard";
import { Icon } from "@/frontend/components/brand";

/**
 * AiCostsView — /admin/ai-costs (RF-ADM-005 / RF-ADM-037).
 *
 * AI spend dashboard built on the shared dashboard primitives: a period filter
 * that drives the RSC, KPI row (spend vs budget, tokens, failure rate, editor
 * test spend kept separate), cost breakdowns by source/model/service, the
 * monthly trend, the top-5 ranking and the per-query cost table + CSV export.
 *
 * Presentational: the page resolves the period, calls getAiCostsReport and maps
 * the DTO to these already-formatted ViewModels.
 */

export interface AiCostQueryRow {
  id: string;
  caseNumber: string;
  source: string;
  model: string;
  tokens: string;
  cost: string;
  status: string;
  statusTone: "ok" | "bad" | "muted";
  date: string;
}

export interface AiCostsVM {
  kpis: KpiCardProps[];
  testHint: string;
  bySource: BreakdownItem[];
  byModel: BreakdownItem[];
  byService: BreakdownItem[];
  byMonth: { rows: SeriesRow[]; xKey: string; series: SeriesSpec[] };
  ranking: BreakdownItem[];
  queries: AiCostQueryRow[];
  exportHref: string;
}

export interface AiCostsStrings {
  title: string;
  sub: string;
  filter: DateRangeLabels;
  cardBySource: string;
  cardByModel: string;
  cardByService: string;
  cardByMonth: string;
  cardRanking: string;
  cardTable: string;
  thCase: string;
  thSource: string;
  thModel: string;
  thTokens: string;
  thCost: string;
  thStatus: string;
  thDate: string;
  exportCsv: string;
  empty: string;
}

export function AiCostsView({ vm, strings }: { vm: AiCostsVM; strings: AiCostsStrings }) {
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
            {strings.title}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)" }}>{strings.sub}</p>
        </div>
        <DateRangeFilter labels={strings.filter} />
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 16,
          marginBottom: 8,
        }}
      >
        {vm.kpis.map((k) => (
          <KpiCard key={k.label} {...k} />
        ))}
      </div>
      <p style={{ margin: "0 0 20px", fontSize: 11.5, color: "var(--ink-3, var(--ink-2))", fontWeight: 600 }}>
        <Icon name="info" size={12} /> {vm.testHint}
      </p>

      {/* Cost breakdowns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        <DashCard title={strings.cardBySource}>
          {vm.bySource.length ? <BarList items={vm.bySource} formatValue={fmtUsd} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardByModel}>
          {vm.byModel.length ? <BarList items={vm.byModel} formatValue={fmtUsd} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardByService}>
          {vm.byService.length ? <BarList items={vm.byService} formatValue={fmtUsd} /> : <Empty text={strings.empty} />}
        </DashCard>

        <DashCard title={strings.cardByMonth}>
          {vm.byMonth.rows.length ? (
            <AreaTrend data={vm.byMonth.rows} xKey={vm.byMonth.xKey} series={vm.byMonth.series} height={180} />
          ) : (
            <Empty text={strings.empty} />
          )}
        </DashCard>
      </div>

      {/* Ranking */}
      <div style={{ marginTop: 16 }}>
        <DashCard title={strings.cardRanking}>
          {vm.ranking.length ? <BarList items={vm.ranking} formatValue={fmtUsd} /> : <Empty text={strings.empty} />}
        </DashCard>
      </div>

      {/* Per-query cost table */}
      <div
        style={{
          marginTop: 16,
          background: "var(--panel, var(--card))",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-lg)",
          boxShadow: "var(--shadow-sm)",
          padding: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 15, color: "var(--ink)" }}>
            {strings.cardTable}
          </h3>
          <Link
            href={vm.exportHref}
            prefetch={false}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              fontSize: 13,
              fontWeight: 700,
              borderRadius: "var(--r-md, 10px)",
              border: "1px solid var(--line)",
              textDecoration: "none",
              color: "var(--ink)",
              background: "var(--card)",
            }}
          >
            <Icon name="doc" size={14} /> {strings.exportCsv}
          </Link>
        </div>

        {vm.queries.length === 0 ? (
          <Empty text={strings.empty} />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--ink-2)", borderBottom: "1px solid var(--line)" }}>
                  <Th>{strings.thCase}</Th>
                  <Th>{strings.thSource}</Th>
                  <Th>{strings.thModel}</Th>
                  <Th align="right">{strings.thTokens}</Th>
                  <Th align="right">{strings.thCost}</Th>
                  <Th>{strings.thStatus}</Th>
                  <Th align="right">{strings.thDate}</Th>
                </tr>
              </thead>
              <tbody>
                {vm.queries.map((q) => (
                  <tr key={q.id} style={{ borderBottom: "1px solid var(--line)" }}>
                    <Td><span style={{ fontWeight: 700, color: "var(--ink)" }}>{q.caseNumber}</span></Td>
                    <Td>{q.source}</Td>
                    <Td><span style={{ color: "var(--ink-2)" }}>{q.model}</span></Td>
                    <Td align="right">{q.tokens}</Td>
                    <Td align="right"><span style={{ fontWeight: 800, color: "var(--ink)" }}>{q.cost}</span></Td>
                    <Td>
                      <span
                        style={{
                          fontWeight: 700,
                          color:
                            q.statusTone === "bad" ? "var(--red)" : q.statusTone === "ok" ? "var(--green)" : "var(--ink-2)",
                        }}
                      >
                        {q.status}
                      </span>
                    </Td>
                    <Td align="right"><span style={{ color: "var(--ink-3)" }}>{q.date}</span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
        minHeight: 180,
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

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th style={{ padding: "8px 10px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", textAlign: align }}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td style={{ padding: "9px 10px", textAlign: align, whiteSpace: "nowrap" }}>{children}</td>;
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ display: "grid", placeItems: "center", flex: 1, minHeight: 110, color: "var(--ink-3, var(--ink-2))", fontSize: 13, fontWeight: 600 }}>
      {text}
    </div>
  );
}
