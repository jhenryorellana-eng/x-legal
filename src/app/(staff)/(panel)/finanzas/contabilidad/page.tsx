/**
 * Contabilidad — /finanzas/contabilidad (DOC-55 §5, RF-AND-028..033).
 *
 * Server Component:
 *   1. Guards actor (staff + billing:view).
 *   2. Resolves the month (?month=YYYY-MM, default = current month).
 *   3. getMonthlySummary + listLedger (libro) + getCollectionMetrics (reused KPI source).
 *   4. Builds the serialisable VM and renders ContabilidadView with bound actions.
 *
 * Boundary: app → module-pub only. Uses console.error (logger is not importable from app).
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { getMonthlySummary, listLedger, getCollectionMetrics } from "@/backend/modules/billing";
import type { Locale } from "@/shared/i18n";
import {
  ContabilidadView,
  type ContabilidadVM,
} from "@/frontend/features/andrium/contabilidad/contabilidad-view";
import {
  recordLedgerEntryAction,
  updateLedgerEntryAction,
  listLedgerMoreAction,
} from "./actions";

export const dynamic = "force-dynamic";

function isValidMonth(m: string | undefined): m is string {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
}

function shiftMonth(month: string, delta: number): string {
  const [y, mo] = month.split("-").map((s) => parseInt(s, 10));
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, mo] = month.split("-").map((s) => parseInt(s, 10));
  const lastDay = new Date(y, mo, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / Math.abs(prev)) * 100);
}

export default async function ContabilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try {
    can(actor, "billing", "view");
  } catch {
    redirect("/admin");
  }

  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = isValidMonth(sp.month) ? sp.month : currentMonth;
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const today = now.toISOString().slice(0, 10);

  let summary: Awaited<ReturnType<typeof getMonthlySummary>> | null = null;
  let ledger: Awaited<ReturnType<typeof listLedger>> = { items: [], nextCursor: null };
  let metrics: Awaited<ReturnType<typeof getCollectionMetrics>> | null = null;

  try {
    const [summaryRes, ledgerRes, metricsRes] = await Promise.allSettled([
      getMonthlySummary(actor, month),
      listLedger(actor, { from: monthStart, to: monthEnd, limit: 500 }),
      getCollectionMetrics(actor, today, month),
    ]);
    if (summaryRes.status === "fulfilled") summary = summaryRes.value;
    if (ledgerRes.status === "fulfilled") ledger = ledgerRes.value;
    if (metricsRes.status === "fulfilled") metrics = metricsRes.value;
  } catch (err) {
    console.error("[/finanzas/contabilidad] load failed:", err);
  }

  // Month label (e.g. "Junio 2026"), capitalised.
  const dtf = new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { month: "long", year: "numeric" });
  const rawLabel = dtf.format(new Date(`${month}-01T12:00:00`));
  const monthLabel = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);

  // Category breakdown — pct relative to the largest bucket.
  const buckets = summary?.byCategory ?? [];
  const maxBucket = buckets.reduce((m, b) => Math.max(m, b.totalCents), 0);
  const breakdown = buckets.slice(0, 8).map((b) => ({
    kind: b.kind,
    category: b.category,
    totalCents: b.totalCents,
    pct: maxBucket > 0 ? Math.round((b.totalCents / maxBucket) * 100) : 0,
  }));

  const vm: ContabilidadVM = {
    month,
    monthLabel,
    monthStart,
    monthEnd,
    prevMonth: shiftMonth(month, -1),
    nextMonth: shiftMonth(month, 1),
    canGoNext: month < currentMonth,
    summary: {
      incomeCents: summary?.incomeCents ?? 0,
      expenseCents: summary?.expenseCents ?? 0,
      balanceCents: summary?.balanceCents ?? 0,
      deltaIncomePct: summary ? deltaPct(summary.incomeCents, summary.previous.incomeCents) : null,
      deltaExpensePct: summary ? deltaPct(summary.expenseCents, summary.previous.expenseCents) : null,
      deltaBalancePct: summary ? deltaPct(summary.balanceCents, summary.previous.balanceCents) : null,
    },
    breakdown,
    metrics: {
      collectedMonthCents: metrics?.collectedMonthCents ?? 0,
      onTimePct: metrics?.onTimePct ?? 100,
      overdueCuotas: metrics?.overdue.cuotas ?? 0,
      overdueMontoCents: metrics?.overdue.montoCents ?? 0,
      overdueCasos: metrics?.overdue.casos ?? 0,
    },
    entries: ledger.items,
    nextCursor: ledger.nextCursor,
    locale: locale === "es" ? "es" : "en",
  };

  return (
    <ContabilidadView
      vm={vm}
      actions={{
        record: recordLedgerEntryAction,
        update: updateLedgerEntryAction,
        loadMore: listLedgerMoreAction.bind(null, monthStart, monthEnd),
      }}
    />
  );
}
