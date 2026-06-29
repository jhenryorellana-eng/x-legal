/**
 * Analytics module — service layer (read-model use cases).
 *
 * `can(actor,'metrics','view')` is the first line of every use case. All
 * aggregation runs in Postgres (repository → analytics_* RPCs / count(head));
 * the service only resolves the period, parallelizes reads (current + previous
 * window for deltas) and assembles the DTO. No writes, ever.
 *
 * @module analytics/service
 */
import { can } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { formatInTimeZone } from "date-fns-tz";
import { resolvePeriodRange } from "@/shared/period";
import * as repo from "./repository";
import type {
  AdminOverview,
  DashboardInput,
  FinanceDashboard,
  LegalDashboard,
  ScalarKpi,
  SalesToday,
} from "./types";

/** Inclusive calendar-date bounds (yyyy-MM-dd) in tz for DATE-typed columns. */
function dateBounds(from: Date, to: Date, tz: string): { fromDate: string; toDate: string } {
  return {
    fromDate: formatInTimeZone(from, tz, "yyyy-MM-dd"),
    // `to` is the exclusive next-block midnight → last inclusive day is to-1ms.
    toDate: formatInTimeZone(new Date(to.getTime() - 1), tz, "yyyy-MM-dd"),
  };
}

function conversion(won: number, newLeads: number): number | null {
  return newLeads > 0 ? Math.round((won / newLeads) * 100) : null;
}

/**
 * Admin global overview (`/admin`) — org-wide, no role-scoping.
 *
 * @api-id API-MET-10
 */
export async function getAdminOverview(actor: Actor, input: DashboardInput): Promise<AdminOverview> {
  can(actor, "metrics", "view");

  const tz = await repo.getOrgTimezone(actor.orgId);
  const range = resolvePeriodRange(input.period, { from: input.from, to: input.to, tz });
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const prevFromIso = range.prevFrom.toISOString();
  const prevToIso = range.prevTo.toISOString();
  const cur = dateBounds(range.from, range.to, tz);
  const prev = dateBounds(range.prevFrom, range.prevTo, tz);
  const org = actor.orgId;

  const [
    byStatus,
    byStage,
    byService,
    funnel,
    funnelPrev,
    activity,
    handoffs,
    fin,
    finPrev,
    ai,
    aiPrev,
    activeCases,
    newCases,
    newCasesPrev,
  ] = await Promise.all([
    repo.casesBy(org, "status"),
    repo.casesBy(org, "stage"),
    repo.casesBy(org, "service"),
    repo.leadFunnel(org, null, fromIso, toIso),
    repo.leadFunnel(org, null, prevFromIso, prevToIso),
    repo.activityByDay(org, fromIso, toIso, tz),
    repo.handoffsByWeek(org, fromIso, toIso, tz),
    repo.financeKpis(org, cur.fromDate, cur.toDate),
    repo.financeKpis(org, prev.fromDate, prev.toDate),
    repo.aiCost(org, fromIso, toIso),
    repo.aiCost(org, prevFromIso, prevToIso),
    repo.countCases(org, { activeOnly: true }),
    repo.countCases(org, { createdFrom: fromIso, createdTo: toIso }),
    repo.countCases(org, { createdFrom: prevFromIso, createdTo: prevToIso }),
  ]);

  const incomeCents: ScalarKpi = { value: fin.incomeCents, prev: finPrev.incomeCents };
  const aiCostUsd: ScalarKpi = { value: ai.totalUsd, prev: aiPrev.totalUsd };
  const conversionPct: ScalarKpi = {
    value: conversion(funnel.won, funnel.newLeads),
    prev: conversion(funnelPrev.won, funnelPrev.newLeads),
  };

  return {
    activeCases,
    newCases: { value: newCases, prev: newCasesPrev },
    incomeCents,
    conversionPct,
    aiCostUsd,
    overdue: { cents: fin.overdueCents, count: fin.overdueCount, cases: fin.overdueCases },
    casesByStatus: byStatus,
    casesByStage: byStage,
    casesByService: byService,
    funnel,
    activity,
    handoffs,
  };
}

/**
 * Vanessa's "Mi día" live counts — today's appointments (org shared agenda),
 * docs awaiting review and closings this week, scoped to the sales rep.
 *
 * @api-id API-MET-11
 */
export async function getSalesToday(actor: Actor, tz: string): Promise<SalesToday> {
  can(actor, "metrics", "view");

  const today = resolvePeriodRange("today", { tz });
  const week = resolvePeriodRange("week", { tz });

  const [todayAppointments, waitingReview, closingsThisWeek] = await Promise.all([
    repo.countAppointmentsInRange(actor.orgId, today.from.toISOString(), today.to.toISOString()),
    repo.salesWaitingReview(actor.orgId, actor.userId),
    repo.salesClosings(actor.orgId, actor.userId, week.from.toISOString(), week.to.toISOString()),
  ]);

  return { todayAppointments, waitingReview, closingsThisWeek };
}

/**
 * Diana's legal performance dashboard — handoffs received into legal, expedientes
 * sent to finance, and own activity, period-over-period. Paralegal-scoped.
 * Gates on `cases` (paralegal lacks the `metrics` module).
 *
 * @api-id API-MET-12
 */
export async function getLegalDashboard(actor: Actor, input: DashboardInput): Promise<LegalDashboard> {
  can(actor, "cases", "view");

  const tz = await repo.getOrgTimezone(actor.orgId);
  const range = resolvePeriodRange(input.period, { from: input.from, to: input.to, tz });
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();
  const prevFromIso = range.prevFrom.toISOString();
  const prevToIso = range.prevTo.toISOString();
  const u = actor.userId;

  const [received, receivedPrev, sent, sentPrev, activity, activityPrev, casesByStatus] =
    await Promise.all([
      repo.countStageReceived(u, "legal", fromIso, toIso),
      repo.countStageReceived(u, "legal", prevFromIso, prevToIso),
      repo.countExpedientesSentToFinance(u, fromIso, toIso),
      repo.countExpedientesSentToFinance(u, prevFromIso, prevToIso),
      repo.countActorActivity(u, fromIso, toIso),
      repo.countActorActivity(u, prevFromIso, prevToIso),
      repo.casesByStatusForLegalOwner(actor.orgId, u),
    ]);

  return {
    received: { value: received, prev: receivedPrev },
    sentToFinance: { value: sent, prev: sentPrev },
    activity: { value: activity, prev: activityPrev },
    casesByStatus,
  };
}

/**
 * Andrium's finance/operations overview — income/overdue (period-over-period)
 * and the ledger balance + income-by-category. Gates on `accounting` (finance
 * lacks the `metrics` module). The page composes aging + print-queue from
 * billing module-pub.
 *
 * @api-id API-MET-13
 */
export async function getFinanceDashboard(actor: Actor, input: DashboardInput): Promise<FinanceDashboard> {
  can(actor, "accounting", "view");

  const tz = await repo.getOrgTimezone(actor.orgId);
  const range = resolvePeriodRange(input.period, { from: input.from, to: input.to, tz });
  const cur = dateBounds(range.from, range.to, tz);
  const prev = dateBounds(range.prevFrom, range.prevTo, tz);
  const org = actor.orgId;
  const todayStr = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

  const [fin, finPrev, ledger, overdueByAge] = await Promise.all([
    repo.financeKpis(org, cur.fromDate, cur.toDate),
    repo.financeKpis(org, prev.fromDate, prev.toDate),
    repo.ledgerBreakdown(org, cur.fromDate, cur.toDate),
    repo.overdueByAge(org, todayStr),
  ]);

  return {
    income: { value: fin.incomeCents, prev: finPrev.incomeCents },
    overdue: { cents: fin.overdueCents, count: fin.overdueCount, cases: fin.overdueCases },
    ledgerIncomeCents: ledger.incomeCents,
    ledgerExpenseCents: ledger.expenseCents,
    incomeByCategory: ledger.byCategory,
    overdueByAge,
  };
}
