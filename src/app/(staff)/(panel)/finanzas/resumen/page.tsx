/**
 * Andrium — "Resumen de finanzas" · /finanzas/resumen.
 *
 * Server Component: resolves the period, composes the finance overview from
 * analytics.getFinanceDashboard (income/overdue/ledger — gated on `accounting`,
 * since finance lacks `metrics`), billing.listOverdueForCollections (aging) and
 * expediente.listPrintQueue (por imprimir), and maps to the view's ViewModels.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFinanceDashboard } from "@/backend/modules/analytics";
import { listPrintQueue } from "@/backend/modules/expediente";
import type { Period } from "@/shared/period";
import {
  fmtMoneyCents,
  fmtNum,
  delta,
  chartColor,
  type KpiCardProps,
  type BreakdownItem,
} from "@/frontend/components/dashboard";
import {
  FinanceResumenView,
  type FinanceData,
  type FinanceStrings,
} from "@/frontend/features/andrium/resumen/finance-resumen-view";

export const dynamic = "force-dynamic";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export default async function FinanceResumenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const sp = await searchParams;
  const period: Period =
    sp.period === "today" || sp.period === "month" || sp.period === "custom" ? sp.period : "week";

  const t = await getTranslations("staff.finanzas.resumen");
  const td = await getTranslations("staff.dashboard");

  const [dash, printQueue] = await Promise.all([
    getFinanceDashboard(actor, { period, from: sp.from, to: sp.to }),
    listPrintQueue(actor).catch(() => []),
  ]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpis: KpiCardProps[] = [
    {
      icon: "dollar",
      hot: true,
      label: t("kpiIncome"),
      value: fmtMoneyCents(dash.income.value),
      delta: delta(dash.income.value, dash.income.prev, fmtMoneyCents),
    },
    { icon: "wallet", label: t("kpiOverdue"), value: fmtMoneyCents(dash.overdue.cents) },
    { icon: "briefcase", label: t("kpiOverdueCases"), value: fmtNum(dash.overdue.cases) },
    { icon: "copy", label: t("kpiToPrint"), value: fmtNum(printQueue.length) },
  ];

  // ── Balance (income vs expense) ───────────────────────────────────────────
  const balance: BreakdownItem[] = [
    { name: t("balanceIncome"), value: dash.ledgerIncomeCents, color: "var(--green)" },
    { name: t("balanceExpense"), value: dash.ledgerExpenseCents, color: "var(--red)" },
  ].filter((x) => x.value > 0);

  // ── Income by category (Breakdown.count holds cents) ──────────────────────
  const byCategory: BreakdownItem[] = dash.incomeByCategory.map((b, i) => ({
    name: cap(b.key),
    value: b.count,
    color: chartColor(i),
  }));

  // ── Overdue by age (same definition as the morosidad KPI) ─────────────────
  const aging: BreakdownItem[] = [
    { name: t("agingRecent"), value: dash.overdueByAge.recent, color: "var(--gold)" },
    { name: t("agingMid"), value: dash.overdueByAge.mid, color: "#F59E0B" },
    { name: t("agingOld"), value: dash.overdueByAge.old, color: "var(--red)" },
  ].filter((x) => x.value > 0);

  const data: FinanceData = { kpis, balance, byCategory, aging };

  const strings: FinanceStrings = {
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
    cardBalance: t("cardBalance"),
    cardByCategory: t("cardByCategory"),
    cardAging: t("cardAging"),
    empty: t("empty"),
  };

  return <FinanceResumenView data={data} strings={strings} />;
}
