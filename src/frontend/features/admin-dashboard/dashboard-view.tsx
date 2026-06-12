"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Kpi } from "@/frontend/components/desktop/kpi";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { Skeleton } from "@/frontend/components/desktop/skeleton";
import { Icon } from "@/frontend/components/brand/icon";

/**
 * Admin dashboard view (DOC-53 §1) — F1 skeleton.
 *
 * view-head greeting + period tabs, a KPI row (the headline KPI "Casos activos"
 * is `hot`), and the analytics cards from the §1.1 layout. The cards that depend
 * on aggregations not yet wired (revenue, conversion, validations, AI cost,
 * recent activity) render their loading/empty shells with the canonical patterns
 * (Skeleton + EmptyState with Lex) until F1-W2 connects them.
 *
 * Presentational: every count arrives as a prop; only navigation is interactive.
 */

export interface DashboardKpis {
  /** Active cases — real value arrives W2 (catalog/cases module in parallel). */
  activeCases: number | null;
  /** Active services — real value arrives W2. */
  activeServices: number | null;
  /** Active employees — real (identity read). */
  activeEmployees: number;
}

export interface DashboardMessages {
  greeting: string;
  sub: string;
  periodToday: string;
  period7: string;
  period30: string;
  periodCustom: string;
  kpiCases: string;
  kpiServices: string;
  kpiEmployees: string;
  kpiRevenue: string;
  kpiConversion: string;
  cardCasesByService: string;
  cardCasesByPhase: string;
  cardRevenue: string;
  cardFunnel: string;
  cardValidations: string;
  cardAiCost: string;
  cardActivity: string;
  comingSoon: string;
  activityEmptyTitle: string;
  activityEmptySub: string;
  pendingData: string;
}

export interface DashboardViewProps {
  kpis: DashboardKpis;
  messages: DashboardMessages;
}

export function DashboardView({ kpis, messages }: DashboardViewProps) {
  const router = useRouter();
  const [period, setPeriod] = React.useState<"today" | "7" | "30" | "custom">(
    "30",
  );

  const periods = [
    { id: "today" as const, label: messages.periodToday },
    { id: "7" as const, label: messages.period7 },
    { id: "30" as const, label: messages.period30 },
    { id: "custom" as const, label: messages.periodCustom },
  ];

  /** A KPI value not yet wired shows an em-dash, not a fake zero. */
  const fmt = (v: number | null) => (v == null ? "—" : v.toLocaleString("es-US"));

  return (
    <div
      className="anim-fade-in-up"
      style={{ padding: "28px clamp(18px, 3vw, 36px) 64px", maxWidth: 1320 }}
    >
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
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-title)",
              fontWeight: 900,
              fontSize: 24,
              letterSpacing: "-0.02em",
              color: "var(--navy)",
            }}
          >
            {messages.greeting}
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-2)" }}>
            {messages.sub}
          </p>
        </div>

        {/* Period tabs (state-only in W1; searchParams wiring lands with the
            aggregations in W2) */}
        <div
          role="tablist"
          aria-label="Período"
          style={{
            display: "inline-flex",
            gap: 2,
            padding: 3,
            borderRadius: 999,
            background: "var(--chip)",
          }}
        >
          {periods.map((p) => {
            const active = period === p.id;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={active}
                onClick={() => setPeriod(p.id)}
                style={{
                  height: 32,
                  padding: "0 14px",
                  borderRadius: 999,
                  border: "none",
                  cursor: "pointer",
                  background: active ? "var(--panel, var(--card))" : "transparent",
                  color: active ? "var(--accent)" : "var(--ink-2)",
                  boxShadow: active ? "var(--shadow-sm)" : "none",
                  fontFamily: "var(--font-title)",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <Kpi
          icon="briefcase"
          hot
          label={messages.kpiCases}
          value={fmt(kpis.activeCases)}
          aria-label={messages.kpiCases}
          onClick={() => router.push("/admin/casos?status=active")}
        />
        <Kpi icon="grid" label={messages.kpiServices} value={fmt(kpis.activeServices)} />
        <Kpi
          icon="user"
          label={messages.kpiEmployees}
          value={fmt(kpis.activeEmployees)}
          onClick={() => router.push("/admin/empleados")}
          aria-label={messages.kpiEmployees}
        />
        <Kpi icon="dollar" label={messages.kpiRevenue} value="—" />
        <Kpi icon="route" label={messages.kpiConversion} value="—" />
      </div>

      {/* Analytics grid (W2 connects aggregations) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <PlaceholderCard title={messages.cardCasesByService} note={messages.pendingData} bars />
        <PlaceholderCard title={messages.cardCasesByPhase} note={messages.pendingData} />
        <PlaceholderCard title={messages.cardRevenue} note={messages.pendingData} bars />
        <PlaceholderCard title={messages.cardFunnel} note={messages.pendingData} />
        <PlaceholderCard title={messages.cardValidations} note={messages.pendingData} />
        <PlaceholderCard title={messages.cardAiCost} note={messages.pendingData} bars />
      </div>

      {/* Recent activity — empty state with Lex */}
      <section style={{ marginTop: 16 }}>
        <h2
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 16,
            color: "var(--ink)",
          }}
        >
          {messages.cardActivity}
        </h2>
        <EmptyState
          mood="calma"
          lexSize={92}
          title={messages.activityEmptyTitle}
          subtitle={messages.activityEmptySub}
        />
      </section>
    </div>
  );
}

/* ── Placeholder analytics card (loading shell, W2 fills it) ──────────────── */

function PlaceholderCard({
  title,
  note,
  bars = false,
}: {
  title: string;
  note: string;
  bars?: boolean;
}) {
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
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 15,
            color: "var(--ink)",
          }}
        >
          {title}
        </h3>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            fontWeight: 700,
            color: "var(--ink-3)",
            background: "var(--chip)",
            padding: "3px 9px",
            borderRadius: 999,
          }}
        >
          <Icon name="clock" size={12} color="currentColor" />
          {note}
        </span>
      </div>

      {bars ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, justifyContent: "center" }}>
          {[80, 62, 45, 30].map((w, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Skeleton width={64} height={11} />
              <Skeleton width={`${w}%`} height={11} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 14, alignItems: "center", flex: 1, justifyContent: "center" }}>
          <Skeleton circle width={104} />
          <div style={{ display: "flex", flexDirection: "column", gap: 9, flex: 1 }}>
            <Skeleton width="80%" height={11} />
            <Skeleton width="60%" height={11} />
            <Skeleton width="70%" height={11} />
          </div>
        </div>
      )}
    </div>
  );
}
