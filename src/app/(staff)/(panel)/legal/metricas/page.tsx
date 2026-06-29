/**
 * Diana — "Mis métricas" (legal performance) · /legal/metricas.
 *
 * Server Component: resolves the period from searchParams, loads the paralegal's
 * performance KPIs (analytics.getLegalDashboard — gated on `cases`, since the
 * paralegal lacks the `metrics` module) and her cases-by-status breakdown, and
 * maps them to the view's ViewModels. DOC-50 §5: unknown → "—".
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getLegalDashboard } from "@/backend/modules/analytics";
import type { Period } from "@/shared/period";
import {
  fmtNum,
  delta,
  chartColor,
  type KpiCardProps,
  type BreakdownItem,
} from "@/frontend/components/dashboard";
import {
  LegalMetricasView,
  type LegalMetricasData,
  type LegalMetricasStrings,
} from "@/frontend/features/legal/metricas/legal-metricas-view";

export const dynamic = "force-dynamic";

export default async function LegalMetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const sp = await searchParams;
  const period: Period =
    sp.period === "today" || sp.period === "month" || sp.period === "custom" ? sp.period : "week";

  const t = await getTranslations("staff.legal.metricas");
  const td = await getTranslations("staff.dashboard");

  const dash = await getLegalDashboard(actor, { period, from: sp.from, to: sp.to });

  // Cases by status — already scoped to her LEGAL-stage workload by the service
  // (excludes cases she nominally owns but are still pre-legal / payment_pending).
  const STATUS: Record<string, string> = {
    payment_pending: td("status.payment_pending"),
    active: td("status.active"),
    in_validation: td("status.in_validation"),
    ready_for_delivery: td("status.ready_for_delivery"),
    delivered: td("status.delivered"),
    completed: td("status.completed"),
    on_hold: td("status.on_hold"),
    cancelled: td("status.cancelled"),
  };
  const casesByStatus: BreakdownItem[] = dash.casesByStatus.map((b, i) => ({
    name: STATUS[b.key] ?? b.key,
    value: b.count,
    color: chartColor(i),
  }));

  const kpis: KpiCardProps[] = [
    {
      icon: "briefcase",
      hot: true,
      label: t("kpiReceived"),
      value: fmtNum(dash.received.value),
      delta: delta(dash.received.value, dash.received.prev, fmtNum),
    },
    {
      icon: "send",
      label: t("kpiSentToFinance"),
      value: fmtNum(dash.sentToFinance.value),
      delta: delta(dash.sentToFinance.value, dash.sentToFinance.prev, fmtNum),
    },
    {
      icon: "bolt",
      label: t("kpiActivity"),
      value: fmtNum(dash.activity.value),
      delta: delta(dash.activity.value, dash.activity.prev, fmtNum),
    },
  ];

  const data: LegalMetricasData = { kpis, casesByStatus };

  const strings: LegalMetricasStrings = {
    title: t("title"),
    sub: t("sub"),
    filter: {
      today: td("period.today"),
      week: td("period.week"),
      month: td("period.month"),
      custom: td("period.custom"),
      from: td("filter.from"),
      to: td("filter.to"),
      apply: td("filter.apply"),
    },
    cardCasesByStatus: t("cardCasesByStatus"),
    empty: t("empty"),
  };

  return <LegalMetricasView data={data} strings={strings} />;
}
