/**
 * Billing service — F6-Ola2 security tests.
 *
 * Tests required by the two-stage review:
 *  - Cross-org isolation: actor from Org A cannot waive/reschedule/confirmZelle
 *    /registerZelle on a resource belonging to Org B → cross_org_access_denied
 *  - Fail-closed W3: waiveInstallment with null caseId → WAIVE_REQUIRES_ADMIN
 *  - requireSystemActor: markOverdues/recordReminderSent reject non-system actors
 *  - DUE_DATE_INVALID for dates > 2 years from now
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  findInstallmentById: vi.fn(),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  findInstallmentCaseId: vi.fn(),
  findPaymentById: vi.fn(),
  listOverdueUniverse: vi.fn(),
  listReminderTargets: vi.fn(),
  listDueCalendar: vi.fn(),
  listOverdueForCollections: vi.fn(),
  collectionMetrics: vi.fn(),
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
}));

const mockAppEvents = vi.hoisted(() => ({ emit: vi.fn() }));
const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

const mockSupabase = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
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

vi.mock("@/backend/platform/supabase", () => mockSupabase);

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
  confirmZellePayment,
  rejectZelleProof,
  registerZellePayment,
  markOverdues,
  recordReminderSent,
} from "../service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const INSTALLMENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAYMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** Builds a fully chainable Supabase service client mock. */
function makeChainMock(data: Record<string, unknown> | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data, error: null });
  function node(): Record<string, unknown> {
    return {
      eq: (..._: unknown[]) => node(),
      neq: (..._: unknown[]) => node(),
      in: (..._: unknown[]) => node(),
      select: (..._: unknown[]) => node(),
      maybeSingle: maybeSingleFn,
    };
  }
  return { from: vi.fn(() => node()) };
}

/** Sets up mocks so the installment belongs to ORG_B (cross-org scenario). */
function setupCrossOrg() {
  // findInstallmentCaseId returns a caseId from Org B
  mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
  // createServiceClient (findOrgIdForCase) returns Org B
  mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_B }));
}

/** Sets up mocks so the installment belongs to ORG_A (same-org, happy path). */
function setupSameOrg() {
  mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
  mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_A }));
}

const FINANCE_ACTOR_ORG_A = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: ORG_A,
  role: "finance" as const,
  kind: "staff" as const,
  permissions: new Map([["billing", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

const ADMIN_ACTOR_ORG_A = {
  ...FINANCE_ACTOR_ORG_A,
  userId: "22222222-2222-4222-8222-222222222222",
  role: "admin" as const,
};

const SYSTEM_ACTOR = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgId: "00000000-0000-0000-0000-000000000000",
  role: "admin" as const,
  kind: "staff" as const,
  permissions: new Map(),
} as import("@/backend/platform/authz").Actor;

const NON_SYSTEM_ACTOR = {
  ...FINANCE_ACTOR_ORG_A,
  userId: "33333333-3333-4333-8333-333333333333",
};

const pendingInstallment = {
  id: INSTALLMENT_ID,
  status: "pending",
  amount_cents: 50000,
  due_date: "2025-12-01",
  is_downpayment: false,
  number: 2,
  payment_plan_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  waived_by: null,
  waived_reason: null,
};

const downpaymentInstallment = { ...pendingInstallment, is_downpayment: true, number: 1 };

const pendingZellePayment = {
  id: PAYMENT_ID,
  installment_id: INSTALLMENT_ID,
  method: "zelle",
  status: "pending",
  amount_cents: 50000,
};

// ---------------------------------------------------------------------------
// CRITICAL-1: Cross-org isolation tests
// ---------------------------------------------------------------------------

describe("billing security: cross-org isolation — waiveInstallment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("throws cross_org_access_denied when actor's org differs from installment's org", async () => {
    setupCrossOrg(); // installment belongs to ORG_B, actor is ORG_A

    const err = await waiveInstallment(FINANCE_ACTOR_ORG_A, {
      installmentId: INSTALLMENT_ID,
      reason: "cross-org attempt",
    }).catch((e) => e);

    expect(err).toBeTruthy();
    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("cross_org_access_denied");
  });

  it("succeeds when actor and installment belong to the same org", async () => {
    setupSameOrg();

    await expect(
      waiveInstallment(FINANCE_ACTOR_ORG_A, {
        installmentId: INSTALLMENT_ID,
        reason: "legitimate waive",
      }),
    ).resolves.toBeUndefined();

    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "waived" }),
    );
  });
});

describe("billing security: cross-org isolation — rescheduleInstallment", () => {
  const nextYear = new Date().getFullYear() + 1;
  const FUTURE_DATE = `${nextYear}-06-15`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("throws cross_org_access_denied when actor's org differs from installment's org", async () => {
    setupCrossOrg();

    const err = await rescheduleInstallment(FINANCE_ACTOR_ORG_A, {
      installmentId: INSTALLMENT_ID,
      newDueDate: FUTURE_DATE,
    }).catch((e) => e);

    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("cross_org_access_denied");
  });

  it("succeeds when actor and installment belong to the same org", async () => {
    setupSameOrg();

    await expect(
      rescheduleInstallment(FINANCE_ACTOR_ORG_A, {
        installmentId: INSTALLMENT_ID,
        newDueDate: FUTURE_DATE,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("billing security: cross-org isolation — confirmZellePayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findPaymentById.mockResolvedValue(pendingZellePayment);
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updatePayment.mockResolvedValue(undefined);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    mockRepo.insertLedgerIfAbsent.mockResolvedValue(undefined);
  });

  it("throws cross_org_access_denied when payment belongs to a different org", async () => {
    // requirePaymentOrg: findPaymentById → findInstallmentCaseId → findOrgIdForCase
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_B }));

    const err = await confirmZellePayment(FINANCE_ACTOR_ORG_A, PAYMENT_ID).catch((e) => e);

    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("cross_org_access_denied");
  });
});

describe("billing security: cross-org isolation — rejectZelleProof", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findPaymentById.mockResolvedValue(pendingZellePayment);
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updatePayment.mockResolvedValue(undefined);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("throws cross_org_access_denied when payment belongs to a different org", async () => {
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_B }));

    const err = await rejectZelleProof(FINANCE_ACTOR_ORG_A, {
      paymentId: PAYMENT_ID,
      reason: "cross-org reject attempt",
    }).catch((e) => e);

    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("cross_org_access_denied");
  });
});

describe("billing security: cross-org isolation — registerZellePayment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    mockRepo.insertPayment.mockResolvedValue({ ...pendingZellePayment });
    mockRepo.updatePayment.mockResolvedValue(undefined);
    mockRepo.insertLedgerIfAbsent.mockResolvedValue(undefined);
  });

  it("throws cross_org_access_denied when installment belongs to a different org", async () => {
    setupCrossOrg();

    const err = await registerZellePayment(FINANCE_ACTOR_ORG_A, {
      installmentId: INSTALLMENT_ID,
    }).catch((e) => e);

    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("cross_org_access_denied");
  });
});

// ---------------------------------------------------------------------------
// MED-2: waiveInstallment fail-closed when caseId is null
// ---------------------------------------------------------------------------

describe("billing security: MED-2 — waiveInstallment fail-closed with null caseId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Downpayment installment + same-org setup
    mockRepo.findInstallmentById.mockResolvedValue(downpaymentInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("throws WAIVE_REQUIRES_ADMIN for non-admin when installment case chain is broken (caseId=null)", async () => {
    // requireInstallmentOrg: findInstallmentCaseId returns null → INSTALLMENT_NOT_FOUND
    // BUT: requireInstallmentOrg throws INSTALLMENT_NOT_FOUND when caseId is null.
    // For the W3 fail-closed path: the org guard itself enforces safety.
    // Let's test the W3 path by making requireInstallmentOrg pass (same-org) but
    // then W3 reads caseId=null from findInstallmentCaseId a second time.
    // We need two calls: first (requireInstallmentOrg) returns a caseId,
    // second (W3) returns null.
    mockRepo.findInstallmentCaseId
      .mockResolvedValueOnce(CASE_ID)   // requireInstallmentOrg call
      .mockResolvedValueOnce(null);     // W3 guard call

    mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_A }));

    const err = await waiveInstallment(FINANCE_ACTOR_ORG_A, {
      installmentId: INSTALLMENT_ID,
      reason: "test fail-closed",
    }).catch((e) => e);

    expect(err).toMatchObject({ code: "WAIVE_REQUIRES_ADMIN" });
  });

  it("admin can waive even when downpayment (no caseId check needed for admin)", async () => {
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_A }));

    await expect(
      waiveInstallment(ADMIN_ACTOR_ORG_A, {
        installmentId: INSTALLMENT_ID,
        reason: "admin override",
      }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MED-1: requireSystemActor guards
// ---------------------------------------------------------------------------

describe("billing security: MED-1 — requireSystemActor on cron endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.listOverdueUniverse.mockResolvedValue([]);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
  });

  it("markOverdues: throws forbidden_module for non-system actor", async () => {
    const err = await markOverdues(NON_SYSTEM_ACTOR, "2025-06-15").catch((e) => e);
    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_module");
  });

  it("markOverdues: succeeds for system actor", async () => {
    const result = await markOverdues(SYSTEM_ACTOR, "2025-06-15");
    expect(result).toEqual({ marked: 0 });
  });

  it("recordReminderSent: throws forbidden_module for non-system actor", async () => {
    const err = await recordReminderSent(NON_SYSTEM_ACTOR, INSTALLMENT_ID).catch((e) => e);
    expect(err.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_module");
  });

  it("recordReminderSent: succeeds for system actor", async () => {
    await expect(
      recordReminderSent(SYSTEM_ACTOR, INSTALLMENT_ID),
    ).resolves.toBeUndefined();
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ last_reminder_at: expect.any(String) }),
    );
  });
});

// ---------------------------------------------------------------------------
// LOW: rescheduleInstallment upper-bound date validation
// ---------------------------------------------------------------------------

describe("billing: rescheduleInstallment — upper bound date guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findInstallmentById.mockResolvedValue(pendingInstallment);
    mockRepo.updateInstallment.mockResolvedValue(undefined);
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockSupabase.createServiceClient.mockReturnValue(makeChainMock({ org_id: ORG_A }));
  });

  it("throws DUE_DATE_INVALID for dates more than 2 years in the future", async () => {
    const farFuture = `${new Date().getFullYear() + 3}-01-01`;

    const err = await rescheduleInstallment(FINANCE_ACTOR_ORG_A, {
      installmentId: INSTALLMENT_ID,
      newDueDate: farFuture,
    }).catch((e) => e);

    expect(err).toMatchObject({ code: "DUE_DATE_INVALID" });
  });

  it("accepts dates within 2 years in the future", async () => {
    const nearFuture = `${new Date().getFullYear() + 1}-01-01`;

    await expect(
      rescheduleInstallment(FINANCE_ACTOR_ORG_A, {
        installmentId: INSTALLMENT_ID,
        newDueDate: nearFuture,
      }),
    ).resolves.toBeUndefined();
  });
});
