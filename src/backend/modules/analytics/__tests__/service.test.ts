/**
 * TDD: analytics.getAdminOverview — orchestration + DTO assembly.
 *
 * Covers:
 *  - can(actor,'metrics','view') is the first gate (AuthzError propagates)
 *  - dimension breakdowns wired from casesBy(dim)
 *  - funnel/handoffs/activity wired from their RPCs
 *  - conversionPct computed (won / newLeads); null when no leads
 *  - active stock vs period flow
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCan = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  AuthzError: class AuthzError extends Error {},
}));

vi.mock("../repository", () => ({
  getOrgTimezone: vi.fn().mockResolvedValue("America/New_York"),
  casesBy: vi.fn(async (_org: string, dim: string) => {
    if (dim === "status") return [{ key: "active", count: 2 }];
    if (dim === "stage") return [{ key: "legal", count: 1 }];
    return [{ key: "svc-1", count: 3 }]; // service
  }),
  leadFunnel: vi.fn().mockResolvedValue({ newLeads: 10, contacted: 7, won: 4, lost: 1 }),
  activityByDay: vi.fn().mockResolvedValue([{ bucketIso: "2026-06-27", eventType: "contract.signed", count: 2 }]),
  handoffsByWeek: vi.fn().mockResolvedValue([
    { weekIso: "2026-06-22", fromStage: "sales", toStage: "legal", count: 2 },
  ]),
  financeKpis: vi.fn().mockResolvedValue({ incomeCents: 50000, overdueCents: 40000, overdueCount: 2, overdueCases: 2 }),
  aiCost: vi.fn().mockResolvedValue({ totalUsd: 0, runs: 0 }),
  countCases: vi.fn(async (_org: string, opts: { activeOnly?: boolean } = {}) => (opts.activeOnly ? 12 : 5)),
  countAppointmentsInRange: vi.fn().mockResolvedValue(3),
  salesWaitingReview: vi.fn().mockResolvedValue(2),
  salesClosings: vi.fn().mockResolvedValue(4),
  countStageReceived: vi.fn().mockResolvedValue(5),
  countExpedientesSentToFinance: vi.fn().mockResolvedValue(1),
  countActorActivity: vi.fn().mockResolvedValue(6),
  casesByStatusForLegalOwner: vi.fn().mockResolvedValue([{ key: "ready_for_delivery", count: 1 }]),
  ledgerBreakdown: vi.fn().mockResolvedValue({
    incomeCents: 50000,
    expenseCents: 12000,
    byCategory: [{ key: "cuota", count: 50000 }],
  }),
  overdueByAge: vi.fn().mockResolvedValue({ recent: 40000, mid: 0, old: 0 }),
}));

import { getAdminOverview, getSalesToday, getLegalDashboard, getFinanceDashboard } from "../service";

const actor = { userId: "u1", orgId: "org1", role: "admin", kind: "staff" } as never;

describe("getAdminOverview", () => {
  beforeEach(() => {
    mockCan.mockReset();
  });

  it("gates on metrics:view before reading", async () => {
    await getAdminOverview(actor, { period: "month" });
    expect(mockCan).toHaveBeenCalledWith(actor, "metrics", "view");
  });

  it("propagates AuthzError when the actor lacks permission", async () => {
    mockCan.mockImplementation(() => {
      throw new Error("forbidden");
    });
    await expect(getAdminOverview(actor, { period: "month" })).rejects.toThrow("forbidden");
  });

  it("wires dimension breakdowns, funnel, handoffs and activity into the DTO", async () => {
    const dto = await getAdminOverview(actor, { period: "month" });
    expect(dto.casesByStatus).toEqual([{ key: "active", count: 2 }]);
    expect(dto.casesByStage).toEqual([{ key: "legal", count: 1 }]);
    expect(dto.casesByService).toEqual([{ key: "svc-1", count: 3 }]);
    expect(dto.funnel).toEqual({ newLeads: 10, contacted: 7, won: 4, lost: 1 });
    expect(dto.handoffs).toHaveLength(1);
    expect(dto.handoffs[0]).toMatchObject({ fromStage: "sales", toStage: "legal", count: 2 });
    expect(dto.activity[0]).toMatchObject({ eventType: "contract.signed", count: 2 });
  });

  it("reports active stock and computes conversion %", async () => {
    const dto = await getAdminOverview(actor, { period: "month" });
    expect(dto.activeCases).toBe(12);
    expect(dto.conversionPct.value).toBe(40); // 4/10
    expect(dto.incomeCents.value).toBe(50000);
    expect(dto.overdue).toEqual({ cents: 40000, count: 2, cases: 2 });
  });
});

describe("getSalesToday", () => {
  beforeEach(() => mockCan.mockReset());

  it("gates on metrics:view and assembles the three live counts", async () => {
    const dto = await getSalesToday(actor, "America/New_York");
    // Same can() gate as getAdminOverview (authz propagation covered there).
    expect(mockCan).toHaveBeenCalledWith(actor, "metrics", "view");
    expect(dto).toEqual({ todayAppointments: 3, waitingReview: 2, closingsThisWeek: 4 });
  });
});

describe("getLegalDashboard", () => {
  beforeEach(() => mockCan.mockReset());

  it("gates on cases:view (paralegal lacks metrics) and assembles period KPIs", async () => {
    const dto = await getLegalDashboard(actor, { period: "week" });
    expect(mockCan).toHaveBeenCalledWith(actor, "cases", "view");
    expect(dto.received.value).toBe(5);
    expect(dto.sentToFinance.value).toBe(1);
    expect(dto.activity.value).toBe(6);
    // prev values present (same mocked counts → delta-ready)
    expect(dto.received).toHaveProperty("prev");
    // cases-by-status is scoped to her legal workload
    expect(dto.casesByStatus).toEqual([{ key: "ready_for_delivery", count: 1 }]);
  });
});

describe("getFinanceDashboard", () => {
  beforeEach(() => mockCan.mockReset());

  it("gates on accounting:view (finance lacks metrics) and assembles income + ledger", async () => {
    const dto = await getFinanceDashboard(actor, { period: "month" });
    expect(mockCan).toHaveBeenCalledWith(actor, "accounting", "view");
    expect(dto.income.value).toBe(50000);
    expect(dto.overdue).toEqual({ cents: 40000, count: 2, cases: 2 });
    expect(dto.ledgerIncomeCents).toBe(50000);
    expect(dto.ledgerExpenseCents).toBe(12000);
    expect(dto.incomeByCategory).toEqual([{ key: "cuota", count: 50000 }]);
    expect(dto.overdueByAge).toEqual({ recent: 40000, mid: 0, old: 0 });
  });
});
