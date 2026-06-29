/**
 * AI costs dashboard — /admin/ai-costs (RF-ADM-005 / RF-ADM-037).
 *
 * Server Component: guards the actor, resolves the period from searchParams and
 * loads the full cost report (ai-engine.getAiCostsReport) — totals vs budget,
 * tokens, failure rate, editor test spend (kept separate), breakdowns by
 * source/model/service, the monthly trend, the top-5 ranking and the per-query
 * cost table. Maps the DTO to the view's already-formatted ViewModels
 * (DOC-50 §5: unknown → "—"). The CSV export lives at ./export.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatInTimeZone } from "date-fns-tz";
import { getActor } from "@/backend/modules/identity";
import { getAiCostsReport } from "@/backend/modules/ai-engine";
import { staffHomePath } from "@/shared/staff-routes";
import { DEFAULT_TZ, type Period } from "@/shared/period";
import {
  fmtUsd,
  fmtNum,
  fmtPct,
  chartColor,
  delta,
  type KpiCardProps,
  type BreakdownItem,
} from "@/frontend/components/dashboard";
import {
  AiCostsView,
  type AiCostsVM,
  type AiCostsStrings,
  type AiCostQueryRow,
} from "@/frontend/features/admin/ai-costs";

export const dynamic = "force-dynamic";

/** "claude-opus-4-7" → "opus", "gemini-2.5-flash" → "gemini" (ranking labels). */
function shortModel(model: string | null): string {
  if (!model) return "";
  if (model.startsWith("gemini")) return "gemini";
  const parts = model.split("-");
  return parts[1] ?? model; // claude-<tier>-… → tier
}

export default async function AiCostsPage({
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

  const [t, report] = await Promise.all([
    getTranslations("staff.admin.aiCosts"),
    getAiCostsReport(actor, { period, from: sp.from, to: sp.to }),
  ]);

  // ── KPI row ─────────────────────────────────────────────────────────────
  const usagePct = report.budgetUsd > 0 ? Math.round((report.totalUsd / report.budgetUsd) * 100) : 0;
  const kpis: KpiCardProps[] = [
    {
      icon: "dollar",
      hot: usagePct >= 100,
      label: t("kpiSpend"),
      value: fmtUsd(report.totalUsd),
      delta: delta(report.totalUsd, report.prevTotalUsd, fmtUsd, true),
      goal: {
        pct: usagePct,
        caption: t("budgetCaption", { spent: fmtUsd(report.totalUsd), budget: fmtUsd(report.budgetUsd) }),
      },
    },
    { icon: "sparkle", label: t("kpiTokens"), value: fmtNum(report.totalTokens) },
    {
      icon: "shield",
      label: t("kpiFailureRate"),
      value: fmtPct(report.failureRatePct),
      hot: (report.failureRatePct ?? 0) >= 20,
    },
    { icon: "bolt", label: t("kpiTestSpend"), value: fmtUsd(report.testUsd) },
  ];

  // ── Breakdowns (BarList, value = USD) ─────────────────────────────────────
  const SOURCE_LABEL: Record<"generations" | "extractions" | "translations", string> = {
    generations: `${t("sourceGenerations")} · ${t("engineClaude")}`,
    extractions: `${t("sourceExtractions")} · ${t("engineGemini")}`,
    translations: `${t("sourceTranslations")} · ${t("engineGemini")}`,
  };
  const bySource: BreakdownItem[] = (["generations", "extractions", "translations"] as const)
    .map((k, i) => ({ name: SOURCE_LABEL[k], value: report.bySource[k], color: chartColor(i) }))
    .filter((it) => it.value > 0);

  const byModel: BreakdownItem[] = report.byModel.map((m, i) => ({
    name: m.model,
    value: m.usd,
    color: chartColor(i),
  }));

  const byService: BreakdownItem[] = report.byService.map((s, i) => ({
    name: s.serviceLabel,
    value: s.usd,
    color: chartColor(i),
  }));

  const byMonth = {
    rows: report.byMonth.map((m) => ({ month: m.month, cost: m.usd })),
    xKey: "month",
    series: [{ key: "cost", label: t("kpiSpend"), color: "var(--accent)" }],
  };

  const ranking: BreakdownItem[] = report.topRuns.map((r, i) => {
    const tier = shortModel(r.model);
    return {
      name: `${i + 1}. ${r.caseNumber ?? "—"}${tier ? ` · ${tier}` : ""}`,
      value: r.costUsd,
      color: chartColor(i),
    };
  });

  // ── Per-query table ───────────────────────────────────────────────────────
  const SOURCE_SHORT: Record<string, string> = {
    generations: t("sourceGenerations"),
    extractions: t("sourceExtractions"),
    translations: t("sourceTranslations"),
  };
  const STATUS: Record<string, string> = {
    completed: t("statusCompleted"),
    failed: t("statusFailed"),
    queued: t("statusQueued"),
    running: t("statusRunning"),
    cancelled: t("statusCancelled"),
  };
  const statusTone = (s: string): AiCostQueryRow["statusTone"] =>
    s === "completed" ? "ok" : s === "failed" ? "bad" : "muted";

  const queries: AiCostQueryRow[] = report.queries.map((q) => ({
    id: q.id,
    caseNumber: q.caseNumber ?? "—",
    source: SOURCE_SHORT[q.source] ?? q.source,
    model: q.model ?? "—",
    tokens: fmtNum(q.tokens),
    cost: fmtUsd(q.costUsd),
    status: STATUS[q.status] ?? q.status,
    statusTone: statusTone(q.status),
    date: formatInTimeZone(new Date(q.createdAt), DEFAULT_TZ, "dd/MM/yy HH:mm"),
  }));

  // ── Export link (carries the active period) ───────────────────────────────
  const qs = new URLSearchParams({ period });
  if (sp.from) qs.set("from", sp.from);
  if (sp.to) qs.set("to", sp.to);
  const exportHref = `/admin/ai-costs/export?${qs.toString()}`;

  const vm: AiCostsVM = {
    kpis,
    testHint: t("testHint"),
    bySource,
    byModel,
    byService,
    byMonth,
    ranking,
    queries,
    exportHref,
  };

  const strings: AiCostsStrings = {
    title: t("title"),
    sub: t("sub"),
    filter: {
      today: t("periodToday"),
      week: t("periodWeek"),
      month: t("periodMonth"),
      custom: t("periodCustom"),
      from: t("filterFrom"),
      to: t("filterTo"),
      apply: t("filterApply"),
    },
    cardBySource: t("cardBySource"),
    cardByModel: t("cardByModel"),
    cardByService: t("cardByService"),
    cardByMonth: t("cardByMonth"),
    cardRanking: t("cardRanking"),
    cardTable: t("cardTable"),
    thCase: t("tableCase"),
    thSource: t("tableSource"),
    thModel: t("tableModel"),
    thTokens: t("tableTokens"),
    thCost: t("tableCost"),
    thStatus: t("tableStatus"),
    thDate: t("tableDate"),
    exportCsv: t("export"),
    empty: t("empty"),
  };

  return <AiCostsView vm={vm} strings={strings} />;
}
