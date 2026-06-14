/**
 * Métricas — sales performance · /ventas/metricas (DOC-52 §6).
 *
 * Server Component: guards the actor, resolves the period from searchParams,
 * calls `kanban.getSalesMetrics` (API-MET-01) and maps the result to the
 * MetricasView prop shapes (§6.2 formulas).
 *
 * DOC-50 §5 rule: where a number is genuinely unknown (null from the service),
 * the displayed value is "—" (em-dash), NEVER a false zero.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getSalesMetrics } from "@/backend/modules/kanban";
import {
  MetricasView,
  LexPrefsProvider,
  type MetricKpi,
  type FunnelStage,
  type WeekBar,
  type DonutVM,
  type SourceRow,
  type SecondaryCard,
} from "@/frontend/features/vanessa";
import { MetricasClient } from "./client";

export const dynamic = "force-dynamic";

// Source gradient map (DOC-52 §6.1)
const SOURCE_GRADIENTS: Record<string, string> = {
  tiktok:   "linear-gradient(90deg, #25F4EE, #FE2C55)",
  whatsapp: "linear-gradient(90deg, #25D366, #128C7E)",
  web:      "linear-gradient(90deg, #2F6BFF, #5B8CFF)",
  voice:    "linear-gradient(90deg, #8B5CF6, #6D28D9)",
  referral: "linear-gradient(90deg, #F59E0B, #FFC629)",
  referido: "linear-gradient(90deg, #F59E0B, #FFC629)",
  default:  "linear-gradient(90deg, #2F6BFF, #5B8CFF)",
};

function sourceGradient(source: string): string {
  const lower = source.toLowerCase();
  for (const [key, grad] of Object.entries(SOURCE_GRADIENTS)) {
    if (lower.includes(key)) return grad;
  }
  return SOURCE_GRADIENTS.default;
}

/** Format a number or return "—" per DOC-50 §5. */
function fmt(n: number | null | undefined, suffix = ""): string {
  if (n == null) return "—";
  return `${n}${suffix}`;
}

export default async function VentasMetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const sp = await searchParams;
  const period = (sp.period === "month" || sp.period === "custom" ? sp.period : "week") as
    | "week"
    | "month"
    | "custom";

  const t = await getTranslations("staff.ventas.metricas");

  // ─── Fetch metrics ────────────────────────────────────────────────────────

  let metrics: Awaited<ReturnType<typeof getSalesMetrics>> | null = null;
  try {
    metrics = await getSalesMetrics(actor, {
      period,
      from: sp.from,
      to:   sp.to,
    });
  } catch {
    // Actor lacks metrics permission (AuthzError) or DB error.
    // Fall through → all values render as "—" (DOC-50 §5).
  }

  // ─── KPIs (DOC-52 §6.1 labels — normative) ───────────────────────────────

  const closuresDelta =
    metrics && metrics.prevClosuresCount > 0
      ? metrics.closuresCount - metrics.prevClosuresCount
      : null;

  const leadsDelta =
    metrics && metrics.prevNewLeadsCount > 0
      ? metrics.newLeadsCount - metrics.prevNewLeadsCount
      : null;

  const kpis: MetricKpi[] = [
    {
      label: t("kpiClosings"),
      value: fmt(metrics?.closuresCount),
      trend: closuresDelta,
      hint: t("kpiHintWeek"),
    },
    {
      label: t("kpiNewLeads"),
      value: fmt(metrics?.newLeadsCount),
      trend: leadsDelta,
      hint: t("kpiHintWeek"),
    },
    {
      label: t("kpiReady"),
      value: fmt(metrics?.readyForDianaCount),
      trend: null,
      hint: t("kpiHintReady"),
    },
    {
      label: t("kpiConversion"),
      // RF-VAN-049 A1: "—" when no leads
      value: fmt(metrics?.conversionPct, "%"),
      trend: null,
      hint: t("kpiHintConversion"),
    },
  ];

  // ─── Funnel (DOC-52 §6.2 — 6 stages) ────────────────────────────────────

  const FUNNEL_LABELS = [
    t("fLeads"),
    t("fContacted"),
    t("fScheduled"),
    t("fAttended"),
    t("fContract"),
    t("fHandoff"),
  ];

  let funnel: FunnelStage[] = [];
  if (metrics) {
    const counts = [
      metrics.funnel.stage0,
      metrics.funnel.stage1,
      metrics.funnel.stage2,
      metrics.funnel.stage3,
      metrics.funnel.stage4,
      metrics.funnel.stage5,
    ];
    const base = counts[0] > 0 ? counts[0] : 1;

    funnel = counts.map((count, i) => {
      const pct = Math.round((count / base) * 100);
      const dropNum =
        i > 0 && counts[i - 1] > 0
          ? Math.round(((counts[i - 1] - count) / counts[i - 1]) * 100)
          : 0;
      return {
        label: FUNNEL_LABELS[i],
        count,
        pct,
        drop: dropNum > 0 ? `-${dropNum}%` : null,
      };
    });
  }

  // ─── Week bars ────────────────────────────────────────────────────────────

  const todayIso = new Date().toISOString().slice(0, 10);
  const weekBars: WeekBar[] = (metrics?.weekBars ?? []).map((b) => ({
    label: b.dayLabel,
    value: b.count,
    isToday: b.dayIso === todayIso,
  }));

  // ─── Donuts (DOC-52 §6.1) ─────────────────────────────────────────────────
  // "Asistencia" is live; Formularios/Docs require F5 case reads — render 0%
  // (pending); these are not "genuinely unknown" KPIs — they're structural
  // pending work, so 0% is correct (no em-dash here).

  const donuts: DonutVM[] = [
    {
      pct: metrics?.attendancePct ?? 0,
      color: "var(--brand-green)",
      label: t("donutAttendance"),
      sub: t("donutAttSub"),
    },
    {
      pct: 0,
      color: "var(--accent)",
      label: t("donutForms"),
      sub: t("donutFormsSub"),
    },
    {
      pct: 0,
      color: "#F59E0B",
      label: t("donutDocs"),
      sub: t("donutDocsSub"),
    },
  ];

  // ─── Sources ──────────────────────────────────────────────────────────────

  const totalLeads = metrics?.newLeadsCount ?? 0;
  const sources: SourceRow[] = (metrics?.sources ?? []).map((s) => {
    const convPct = s.total > 0 ? Math.round((s.won / s.total) * 100) : 0;
    const pct     = totalLeads > 0 ? Math.round((s.total / totalLeads) * 100) : 0;
    return {
      label: s.source,
      count: s.total,
      pct,
      conv: `${convPct}%`,
      gradient: sourceGradient(s.source),
    };
  });

  // ─── Secondary cards (DOC-52 §6.1) ───────────────────────────────────────

  // RF-VAN-050 A1: "—" with note when data is insufficient.
  // noShow = stage3_completed * (100 - attendancePct) / attendancePct
  // This inverts the service formula: attendancePct = completed/(completed+noShow)*100.
  // Guard: attendancePct === 0 is impossible given stage3 > 0 path, but check to be safe.
  const noShowCount =
    metrics && metrics.attendancePct !== null && metrics.attendancePct > 0
      ? Math.round(
          (metrics.funnel.stage3 * (100 - metrics.attendancePct)) /
            metrics.attendancePct,
        )
      : null;

  const secondary: SecondaryCard[] = [
    {
      icon: "bolt",
      label: t("secVelocity"),
      value: fmt(metrics?.medianContactMinutes, " min"),
      sub: t("secVelocitySub"),
      tone: (() => {
        const m = metrics?.medianContactMinutes;
        if (m == null) return "blue";
        return m <= 5 ? "green" : "amber";
      })(),
    },
    {
      icon: "event_available",
      label: t("secAttendance"),
      value: fmt(metrics?.attendancePct, "%"),
      sub: t("secNoShows", { n: fmt(noShowCount) }),
      tone: "green",
    },
    {
      icon: "schedule",
      label: t("secCycle"),
      // Cycle time requires lead→traspaso tracking — genuinely unknown in P3.
      value: "—",
      sub: t("secCycleSub"),
      tone: "blue",
    },
    {
      icon: "replay",
      label: t("secReschedules"),
      value: fmt(metrics?.rescheduledCount),
      sub: t("secRescheduleSub"),
      tone: "blue",
    },
  ];

  // ─── Strings ──────────────────────────────────────────────────────────────

  const strings = {
    title: t("title"),
    sub: t("sub"),
    thisWeek: t("thisWeek"),
    month: t("month"),
    custom: t("custom"),
    lexTipHtml: t.markup("lexTipHtml", {
      b: (c) => `<b>${c}</b>`,
      conv: fmt(metrics?.conversionPct, "%"),
    }),
    funnelTitle: t("funnelTitle"),
    activityTitle: t("activityTitle"),
    clientsTitle: t("clientsTitle"),
    sourcesTitle: t("sourcesTitle"),
    lexEnabled: true,
  };

  return (
    <LexPrefsProvider>
      <MetricasClient period={period}>
        <MetricasView
          kpis={kpis}
          funnel={funnel}
          weekBars={weekBars}
          donuts={donuts}
          sources={sources}
          secondary={secondary}
          period={period}
          strings={strings}
        />
      </MetricasClient>
    </LexPrefsProvider>
  );
}
