/**
 * Admin dashboard — /admin (DOC-53 §1).
 *
 * Server Component: guards the actor, resolves the period from searchParams and
 * loads the org-wide overview (analytics.getAdminOverview) — cases by
 * status/stage/service, role handoffs, the activity time-series, lead funnel,
 * income/AI-cost/overdue KPIs with period-over-period deltas. Maps the DTO to
 * the view's already-formatted ViewModels (DOC-50 §5: unknown → "—").
 */

import { redirect } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getActor, getCurrentStaffProfile } from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import { getAdminOverview } from "@/backend/modules/analytics";
import type { Period } from "@/shared/period";
import { staffHomePath } from "@/shared/staff-routes";
import {
  fmtNum,
  fmtPct,
  fmtMoneyCents,
  fmtUsd,
  chartColor,
  delta,
  type BreakdownItem,
  type SeriesRow,
  type FunnelStageVM,
  type KpiCardProps,
} from "@/frontend/components/dashboard";
import {
  DashboardView,
  type AdminDashboardData,
  type AdminDashboardStrings,
} from "@/frontend/features/admin-dashboard/dashboard-view";

export const dynamic = "force-dynamic";

const DAY_ABBR_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function dayLabel(iso: string, compact: boolean): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (compact) return DAY_ABBR_ES[d.getUTCDay()];
  return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  if (actor.role && actor.role !== "admin") redirect(staffHomePath(actor.role));

  const sp = await searchParams;
  const period: Period =
    sp.period === "today" || sp.period === "month" || sp.period === "custom" ? sp.period : "week";

  const [t, locale] = [await getTranslations("staff.dashboard"), await getLocale()];

  const [profile, overview, services] = await Promise.all([
    getCurrentStaffProfile(),
    getAdminOverview(actor, { period, from: sp.from, to: sp.to }),
    listServicesAdmin(actor).catch(() => []),
  ]);

  const firstName = (profile?.displayName ?? "").split(" ")[0] || "";

  // ── Label maps ────────────────────────────────────────────────────────────
  const serviceLabels = new Map<string, string>();
  for (const s of services) {
    const li = (s.label_i18n ?? {}) as Record<string, string>;
    serviceLabels.set(s.id, li[locale] ?? li.es ?? s.slug ?? s.id);
  }
  // Static keys (next-intl rejects dynamic template-literal keys).
  const STAGE: Record<string, string> = {
    sales: t("stage.sales"),
    legal: t("stage.legal"),
    operations: t("stage.operations"),
    done: t("stage.done"),
  };
  const STATUS: Record<string, string> = {
    payment_pending: t("status.payment_pending"),
    active: t("status.active"),
    in_validation: t("status.in_validation"),
    ready_for_delivery: t("status.ready_for_delivery"),
    delivered: t("status.delivered"),
    completed: t("status.completed"),
    on_hold: t("status.on_hold"),
    cancelled: t("status.cancelled"),
  };
  const stageLabel = (k: string) => STAGE[k] ?? k;
  const statusLabel = (k: string) => STATUS[k] ?? k;

  // ── Breakdowns ────────────────────────────────────────────────────────────
  const casesByStatus: BreakdownItem[] = overview.casesByStatus.map((b, i) => ({
    name: statusLabel(b.key),
    value: b.count,
    color: chartColor(i),
  }));
  const casesByStage: BreakdownItem[] = overview.casesByStage.map((b, i) => ({
    name: stageLabel(b.key),
    value: b.count,
    color: chartColor(i),
  }));
  const casesByService: BreakdownItem[] = overview.casesByService.map((b, i) => ({
    name: serviceLabels.get(b.key) ?? b.key,
    value: b.count,
    color: chartColor(i),
  }));

  // ── Handoffs: aggregate from→to across the period ─────────────────────────
  const handoffMap = new Map<string, number>();
  for (const h of overview.handoffs) {
    const key = `${h.fromStage}→${h.toStage}`;
    handoffMap.set(key, (handoffMap.get(key) ?? 0) + h.count);
  }
  const handoffs: BreakdownItem[] = [...handoffMap.entries()]
    .map(([key, value], i) => {
      const [from, to] = key.split("→");
      return { name: `${stageLabel(from)} → ${stageLabel(to)}`, value, color: chartColor(i) };
    })
    .sort((a, b) => b.value - a.value);

  // ── Activity: per-day total ───────────────────────────────────────────────
  const perDay = new Map<string, number>();
  for (const a of overview.activity) {
    perDay.set(a.bucketIso, (perDay.get(a.bucketIso) ?? 0) + a.count);
  }
  const days = [...perDay.keys()].sort();
  const compact = days.length <= 8;
  const activityRows: SeriesRow[] = days.map((iso) => ({
    day: dayLabel(iso, compact),
    total: perDay.get(iso) ?? 0,
  }));

  // ── Funnel ────────────────────────────────────────────────────────────────
  const f = overview.funnel;
  const base = f.newLeads || 1;
  const funnelRaw = [
    { label: t("funnelStage.leads"), count: f.newLeads },
    { label: t("funnelStage.contacted"), count: f.contacted },
    { label: t("funnelStage.won"), count: f.won },
  ];
  const funnel: FunnelStageVM[] = funnelRaw.map((s, i) => {
    const pct = Math.round((s.count / base) * 100);
    const prevCount = i > 0 ? funnelRaw[i - 1].count : s.count;
    const drop = i > 0 && prevCount > 0 ? Math.round(((prevCount - s.count) / prevCount) * 100) : 0;
    return { label: s.label, count: s.count, pct, drop: drop > 0 ? `-${drop}%` : null };
  });

  // ── KPI row ───────────────────────────────────────────────────────────────
  const kpis: KpiCardProps[] = [
    {
      icon: "briefcase",
      hot: true,
      label: t("kpi.cases"),
      value: fmtNum(overview.activeCases),
      href: "/admin/casos",
      delta: delta(overview.newCases.value, overview.newCases.prev, fmtNum),
    },
    {
      icon: "dollar",
      label: t("kpi.revenue"),
      value: fmtMoneyCents(overview.incomeCents.value),
      delta: delta(overview.incomeCents.value, overview.incomeCents.prev, fmtMoneyCents),
    },
    {
      icon: "route",
      label: t("kpi.conversion"),
      value: fmtPct(overview.conversionPct.value),
      delta: delta(overview.conversionPct.value, overview.conversionPct.prev, (n) => `${n}%`),
    },
    {
      icon: "sparkle",
      label: t("kpi.aiCost"),
      value: fmtUsd(overview.aiCostUsd.value),
      delta: delta(overview.aiCostUsd.value, overview.aiCostUsd.prev, fmtUsd),
    },
    {
      icon: "wallet",
      label: t("kpi.overdue"),
      value: fmtMoneyCents(overview.overdue.cents),
    },
  ];

  const data: AdminDashboardData = {
    kpis,
    handoffs,
    casesByStatus,
    casesByStage,
    casesByService,
    activity: {
      rows: activityRows,
      xKey: "day",
      series: [{ key: "total", label: t("card.activityPeriod"), color: "var(--accent)" }],
    },
    funnel,
  };

  const strings: AdminDashboardStrings = {
    greeting: firstName ? t("greetingName", { name: firstName }) : t("greeting"),
    sub: t("sub"),
    filter: {
      today: t("period.today"),
      week: t("period.week"),
      month: t("period.month"),
      custom: t("period.custom"),
      from: t("filter.from"),
      to: t("filter.to"),
      apply: t("filter.apply"),
    },
    cardHandoffs: t("card.handoffs"),
    cardCasesByStatus: t("card.casesByStatus"),
    cardCasesByStage: t("card.casesByStage"),
    cardCasesByService: t("card.casesByService"),
    cardActivity: t("card.activityPeriod"),
    cardFunnel: t("card.funnel"),
    empty: t("empty"),
  };

  return <DashboardView data={data} strings={strings} />;
}
