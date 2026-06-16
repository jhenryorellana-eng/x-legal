/**
 * Billing service — F6-Ola2 unit tests.
 *
 * Covers:
 *  waiveInstallment, rescheduleInstallment, markOverdues,
 *  listReminderTargets, recordReminderSent, getCollectionMetrics,
 *  listDueCalendar, listOverdueForCollections
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingError } from "../service";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  findInstallmentById: vi.fn(),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  findInstallmentCaseId: vi.fn(),
  listOverdueUniverse: vi.fn(),
  listReminderTargets: vi.fn(),
  listDueCalendar: vi.fn(),
  listOverdueForCollections: vi.fn(),
  collectionMetrics: vi.fn(),
  // F6-Ola1 — must be present or service import blows up
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn(),
  findPaymentById: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
  findOrgIdForCase: vi.fn(),
}));

const mockAppEvents = vi.hoisted(() => ({ emit: vi.fn() }));
const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository.js", () => mockRepo);

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: mockAppEvents,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/env", () => ({
  env: {
    STRIPE_SECRET_KEY: "sk_test_stub",
    STRIPE_WEBHOOK_SECRET: "whsec_stub",
    NEXT_PUBLIC_APP_URL: "https://test.localhost",
  },
}));

// createServiceClient is used by service-internal helpers (findOrgIdForCase,
// findCaseStatus). It must return the actor's orgId so the cross-org guard passes
// for happy-path tests. Individual tests override this where needed.
// ORG_ID matches FINANCE_ACTOR.orgId / ADMIN_ACTOR.orgId.
const ORG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockSupabase = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => mockSupabase);

/** Builds a fully chainable Supabase service client mock. */
function makeServiceClientMock(data: Record<string, unknown> | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data, error: null });
  function makeNode(): Record<string, unknown> {
    return {
      eq: (..._a: unknown[]) => makeNode(),
      neq: (..._a: unknown[]) => makeNode(),
      in: (..._a: unknown[]) => makeNode(),
      select: (..._a: unknown[]) => makeNode(),
      maybeSingle: maybeSingleFn,
    };
  }
  return { from: vi.fn(() => makeNode()) };
}

/** Resets createServiceClient to return the actor's own org (cross-org guard passes). */
function resetServiceClientToSameOrg() {
  mockSupabase.createServiceClient.mockReturnValue(
    makeServiceClientMock({ org_id: ORG_ID, status: null }),
  );
}

vi.mock("@/backend/platform/stripe", () => ({
  getStripe: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ success: true }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/backend/modules/audit", () => mockAudit);

// Import after mocks
import {
  waiveInstallment,
  rescheduleInstallment,
  markOverdues,
  listReminderTargets,
  recordReminderSent,
  getCollectionMetrics,
  listDueCalendar,
  listOverdueForCollections,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_PERMISSIONS = new Map([
  ["billing",  { view: true, edit: true }],
  ["printing", { view: true, edit: true }],
]);

const FINANCE_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "finance" as const,
  kind: "staff" as const,
  permissions: FULL_PERMISSIONS,
} as import("@/backend/platform/authz").Actor;

const ADMIN_ACTOR = {
  userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "admin" as const,
  kind: "staff" as const,
  permissions: FULL_PERMISSIONS,
} as import("@/backend/platform/authz").Actor;

const SYSTEM_ACTOR = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "admin" as const,
  kind: "staff" as const,
  permissions: FULL_PERMISSIONS,
} as import("@/backend/platform/authz").Actor;

const pendingInstallment = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  status: "pending",
  amount_cents: 50000,
  due_date: "2025-12-01",
  is_downpayment: false,
  number: 2,
  payment_plan_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  waived_by: null,
  waived_reason: null,
};

const overdueInstallment = { ...pendingInstallment, status: "overdue" };
const downpaymentInstallment = { ...pendingInstallment, is_downpayment: true, number: 1 };

// ---------------------------------------------------------------------------
// waiveInstallment
// ---------------------------------------------------------------------------

describe("billing: waiveInstallment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    mockRepo.findInstallmentCaseId.mockResolvedValue("ffffffff-ffff-4fff-8fff-ffffffffffff");
  });

  it("waives a pending installment with a reason", async () => {
    await waiveInstallment(FINANCE_ACTOR, {
      installmentId: pendingInstallment.id,
      reason: "Client hardship exemption",
    });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      pendingInstallment.id,
      expect.objectContaining({ status: "waived", waived_reason: "Client hardship exemption" }),
    );
  });

  it("waives an overdue installment", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(overdueInstallment);
    await waiveInstallment(FINANCE_ACTOR, {
      installmentId: overdueInstallment.id,
      reason: "Settlement agreement",
    });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      overdueInstallment.id,
      expect.objectContaining({ status: "waived" }),
    );
  });

  it("throws INSTALLMENT_NOT_FOUND when not found", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(null);
    await expect(
      waiveInstallment(FINANCE_ACTOR, { installmentId: pendingInstallment.id, reason: "ok" }),
    ).rejects.toThrow(BillingError);
  });

  it("throws INSTALLMENT_NOT_WAIVABLE for paid installment", async () => {
    mockRepo.findInstallmentById.mockResolvedValue({ ...pendingInstallment, status: "paid" });
    await expect(
      waiveInstallment(FINANCE_ACTOR, { installmentId: pendingInstallment.id, reason: "ok" }),
    ).rejects.toMatchObject({ code: "INSTALLMENT_NOT_WAIVABLE" });
  });

  it("throws WAIVE_REQUIRES_ADMIN for finance trying to waive downpayment on payment_pending case", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(downpaymentInstallment);
    mockRepo.findInstallmentCaseId.mockResolvedValue("ffffffff-ffff-4fff-8fff-ffffffffffff");

    // Override createServiceClient to return same-org for requireInstallmentOrg
    // AND payment_pending for findCaseStatus. We do this by returning a mock where:
    // - queries for "cases" with select "org_id" → { org_id: ORG_ID }
    // - queries for "cases" with select "status" → { status: "payment_pending" }
    // Since both calls go through .from("cases"), we use a call-count approach:
    // first call = org lookup (requireInstallmentOrg), second = status lookup (W3).
    let callCount = 0;
    mockSupabase.createServiceClient.mockReturnValue({
      from: vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // requireInstallmentOrg → findOrgIdForCase: return same org
          return makeServiceClientMock({ org_id: ORG_ID }).from();
        }
        // W3 → findCaseStatus: return payment_pending
        return makeServiceClientMock({ status: "payment_pending" }).from();
      }),
    });

    await expect(
      waiveInstallment(FINANCE_ACTOR, { installmentId: downpaymentInstallment.id, reason: "ok" }),
    ).rejects.toMatchObject({ code: "WAIVE_REQUIRES_ADMIN" });
  });

  it("allows admin to waive downpayment on payment_pending case", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(downpaymentInstallment);
    await waiveInstallment(ADMIN_ACTOR, {
      installmentId: downpaymentInstallment.id,
      reason: "Admin exception",
    });
    expect(mockRepo.updateInstallment).toHaveBeenCalled();
  });

  it("writes an audit entry", async () => {
    await waiveInstallment(FINANCE_ACTOR, {
      installmentId: pendingInstallment.id,
      reason: "Test reason",
    });
    expect(mockAudit.writeAudit).toHaveBeenCalledWith(
      FINANCE_ACTOR,
      "billing.installment.waived",
      "installments",
      pendingInstallment.id,
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// rescheduleInstallment
// ---------------------------------------------------------------------------

describe("billing: rescheduleInstallment", () => {
  // Use a future date within 2 years (upper-bound guard added in F6-Ola2 review)
  const nextYear = new Date().getFullYear() + 1;
  const FUTURE_DATE = `${nextYear}-06-15`;

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    // requireInstallmentOrg resolves via findInstallmentCaseId → findOrgIdForCase
    mockRepo.findInstallmentCaseId.mockResolvedValue("ffffffff-ffff-4fff-8fff-ffffffffffff");
  });

  it("reschedules a pending installment to a future date", async () => {
    await rescheduleInstallment(FINANCE_ACTOR, {
      installmentId: pendingInstallment.id,
      newDueDate: FUTURE_DATE,
    });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      pendingInstallment.id,
      expect.objectContaining({ due_date: FUTURE_DATE }),
    );
  });

  it("reverts overdue installment to pending when rescheduled", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(overdueInstallment);
    await rescheduleInstallment(FINANCE_ACTOR, {
      installmentId: overdueInstallment.id,
      newDueDate: FUTURE_DATE,
    });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      overdueInstallment.id,
      expect.objectContaining({ status: "pending", due_date: FUTURE_DATE }),
    );
  });

  it("throws INSTALLMENT_NOT_FOUND when not found", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(null);
    await expect(
      rescheduleInstallment(FINANCE_ACTOR, {
        installmentId: pendingInstallment.id,
        newDueDate: FUTURE_DATE,
      }),
    ).rejects.toThrow(BillingError);
  });

  it("throws INSTALLMENT_NOT_RESCHEDULABLE for paid status", async () => {
    mockRepo.findInstallmentById.mockResolvedValue({ ...pendingInstallment, status: "paid" });
    await expect(
      rescheduleInstallment(FINANCE_ACTOR, {
        installmentId: pendingInstallment.id,
        newDueDate: FUTURE_DATE,
      }),
    ).rejects.toMatchObject({ code: "INSTALLMENT_NOT_RESCHEDULABLE" });
  });

  it("throws DUE_DATE_INVALID when new date is in the past", async () => {
    await expect(
      rescheduleInstallment(FINANCE_ACTOR, {
        installmentId: pendingInstallment.id,
        newDueDate: "2020-01-01",
      }),
    ).rejects.toMatchObject({ code: "DUE_DATE_INVALID" });
  });

  it("throws DUE_DATE_INVALID when new date is today (not strictly future)", async () => {
    const today = new Date().toISOString().split("T")[0];
    await expect(
      rescheduleInstallment(FINANCE_ACTOR, {
        installmentId: pendingInstallment.id,
        newDueDate: today,
      }),
    ).rejects.toMatchObject({ code: "DUE_DATE_INVALID" });
  });

  it("writes an audit entry", async () => {
    await rescheduleInstallment(FINANCE_ACTOR, {
      installmentId: pendingInstallment.id,
      newDueDate: FUTURE_DATE,
    });
    expect(mockAudit.writeAudit).toHaveBeenCalledWith(
      FINANCE_ACTOR,
      "billing.installment.rescheduled",
      "installments",
      pendingInstallment.id,
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// markOverdues
// ---------------------------------------------------------------------------

describe("billing: markOverdues", () => {
  const TODAY = "2025-06-15";

  const dueRows = [
    { id: "inst-1", number: 1, amountCents: 10000, dueDate: "2025-06-10", caseId: "case-1", orgId: FINANCE_ACTOR.orgId },
    { id: "inst-2", number: 2, amountCents: 20000, dueDate: "2025-06-12", caseId: "case-2", orgId: FINANCE_ACTOR.orgId },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.listOverdueUniverse.mockResolvedValue(dueRows);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    mockAppEvents.emit.mockResolvedValue(undefined);
  });

  it("marks each pending-overdue installment as overdue", async () => {
    await markOverdues(SYSTEM_ACTOR, TODAY);
    expect(mockRepo.updateInstallment).toHaveBeenCalledTimes(2);
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith("inst-1", { status: "overdue" });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith("inst-2", { status: "overdue" });
  });

  it("emits installment.overdue for each installment", async () => {
    await markOverdues(SYSTEM_ACTOR, TODAY);
    expect(mockAppEvents.emit).toHaveBeenCalledTimes(2);
    expect(mockAppEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "installment.overdue",
        payload: expect.objectContaining({ caseId: "case-1", installmentId: "inst-1" }),
      }),
    );
  });

  it("returns the count of marked installments", async () => {
    const result = await markOverdues(SYSTEM_ACTOR, TODAY);
    expect(result).toEqual({ marked: 2 });
  });

  it("is idempotent with 0 rows (no errors)", async () => {
    mockRepo.listOverdueUniverse.mockResolvedValue([]);
    const result = await markOverdues(SYSTEM_ACTOR, TODAY);
    expect(result).toEqual({ marked: 0 });
    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listReminderTargets & recordReminderSent
// ---------------------------------------------------------------------------

describe("billing: listReminderTargets", () => {
  const TODAY = "2025-06-15";

  const reminderRows = [
    { installmentId: "inst-3", caseId: "case-3", clientUserId: "user-3", dueDate: TODAY, number: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.listReminderTargets.mockResolvedValue(reminderRows);
  });

  it("returns reminder targets from repo", async () => {
    const targets = await listReminderTargets(TODAY);
    expect(targets).toEqual(reminderRows);
    expect(mockRepo.listReminderTargets).toHaveBeenCalledWith(TODAY);
  });
});

describe("billing: recordReminderSent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("updates last_reminder_at on the installment", async () => {
    await recordReminderSent(SYSTEM_ACTOR, "inst-4");
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-4",
      expect.objectContaining({ last_reminder_at: expect.any(String) }),
    );
  });
});

// ---------------------------------------------------------------------------
// getCollectionMetrics
// ---------------------------------------------------------------------------

describe("billing: getCollectionMetrics", () => {
  const TODAY = "2025-06-15";
  const MONTH = "2025-06";

  const metricsResult = {
    collectedMonthCents: 150000,
    onTimePct: 85,
    overdue: { cuotas: 3, montoCents: 90000, casos: 2 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.collectionMetrics.mockResolvedValue(metricsResult);
  });

  it("returns metrics delegated from repo", async () => {
    const result = await getCollectionMetrics(FINANCE_ACTOR, TODAY, MONTH);
    expect(result).toEqual(metricsResult);
    expect(mockRepo.collectionMetrics).toHaveBeenCalledWith(FINANCE_ACTOR.orgId, TODAY, MONTH);
  });
});

// ---------------------------------------------------------------------------
// listDueCalendar
// ---------------------------------------------------------------------------

describe("billing: listDueCalendar", () => {
  const dueItems = [
    {
      installmentId: "inst-5",
      caseId: "case-5",
      caseNumber: "2025-001",
      clientName: "John Doe",
      number: 1,
      installmentCount: 12,
      amountCents: 25000,
      status: "pending",
      isDownpayment: false,
      dueDate: "2025-06-20",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.listDueCalendar.mockResolvedValue(dueItems);
  });

  it("delegates to repo and returns DTO list", async () => {
    const result = await listDueCalendar(FINANCE_ACTOR, { from: "2025-06-01", to: "2025-06-30" });
    expect(result).toEqual(dueItems);
    expect(mockRepo.listDueCalendar).toHaveBeenCalledWith(
      FINANCE_ACTOR.orgId,
      expect.objectContaining({ from: "2025-06-01", to: "2025-06-30" }),
    );
  });
});

// ---------------------------------------------------------------------------
// listOverdueForCollections
// ---------------------------------------------------------------------------

describe("billing: listOverdueForCollections", () => {
  const overdueItems = [
    {
      installmentId: "inst-6",
      caseId: "case-6",
      caseNumber: "2025-002",
      clientName: "Jane Smith",
      number: 3,
      amountCents: 30000,
      dueDate: "2025-05-01",
      daysLateVal: 45,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.listOverdueForCollections.mockResolvedValue(overdueItems);
  });

  it("delegates to repo and maps daysLateVal → daysLate", async () => {
    const result = await listOverdueForCollections(FINANCE_ACTOR);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      installmentId: "inst-6",
      daysLate: 45, // mapped from daysLateVal
    });
    expect(mockRepo.listOverdueForCollections).toHaveBeenCalledWith(FINANCE_ACTOR.orgId);
  });
});
