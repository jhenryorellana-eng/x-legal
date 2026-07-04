/**
 * Billing service — Stripe reconciliation (L2 + L3) unit tests.
 *
 * Covers the defense-in-depth card-confirmation layers that complement the
 * webhook (DOC-71 §3.5/§3.6):
 *   reconcileCheckoutSession        — success_url return reconcile
 *   reconcilePendingStripePayments  — cron safety net
 *
 * Both funnel through the same idempotent applyPaymentSuccess as the webhook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  // touched by reconcile + applyPaymentSuccess + resolvePaymentForSession
  findPaymentBySessionId: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findInstallmentById: vi.fn(),
  findInstallmentCaseId: vi.fn(),
  findPaymentById: vi.fn(),
  updatePayment: vi.fn().mockResolvedValue(undefined),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  insertLedgerIfAbsent: vi.fn().mockResolvedValue(undefined),
  listPendingStripeSessionsToReconcile: vi.fn(),
  listPendingIntentPaymentsToReconcile: vi.fn().mockResolvedValue([]),
  // present so the service module import does not blow up
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  listOrphanStripePayments: vi.fn(),
  findOrphanStripePaymentForInstallment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  listOverdueUniverse: vi.fn(),
  listReminderTargets: vi.fn(),
  listDueCalendar: vi.fn(),
  listOverdueForCollections: vi.fn(),
  collectionMetrics: vi.fn(),
  insertLedgerEntry: vi.fn(),
  findLedgerEntryById: vi.fn(),
  updateLedgerEntryRow: vi.fn(),
  listLedger: vi.fn(),
  monthlyLedgerSummary: vi.fn(),
  findCaseClientUserId: vi.fn(),
}));

const mockAppEvents = vi.hoisted(() => {
  const emit = vi.fn().mockResolvedValue(undefined);
  return { emit, emitAndWait: emit };
});
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

vi.mock("@/backend/platform/events", () => ({ appEvents: mockAppEvents }));
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

const ORG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockSupabase = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock("@/backend/platform/supabase", () => mockSupabase);

/** Service client mock that returns the same org (cross-org guard passes). */
function makeServiceClientMock(data: Record<string, unknown> | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data, error: null });
  function makeNode(): Record<string, unknown> {
    return {
      eq: (..._a: unknown[]) => makeNode(),
      neq: (..._a: unknown[]) => makeNode(),
      in: (..._a: unknown[]) => makeNode(),
      is: (..._a: unknown[]) => makeNode(),
      not: (..._a: unknown[]) => makeNode(),
      lt: (..._a: unknown[]) => makeNode(),
      select: (..._a: unknown[]) => makeNode(),
      maybeSingle: maybeSingleFn,
    };
  }
  return { from: vi.fn(() => makeNode()) };
}

const retrieveMock = vi.hoisted(() => vi.fn());
vi.mock("@/backend/platform/stripe", () => ({
  getStripe: vi.fn(() => ({
    checkout: { sessions: { retrieve: retrieveMock } },
  })),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));
vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ allowed: true }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/backend/modules/audit", () => mockAudit);
vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: vi.fn(),
  findUserById: vi.fn(),
}));

// Import after mocks
import {
  reconcileCheckoutSession,
  reconcilePendingStripePayments,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ACTOR = {
  userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  orgId: ORG_ID,
  kind: "client" as const,
} as unknown as import("@/backend/platform/authz").Actor;

const FINANCE_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: ORG_ID,
  role: "finance" as const,
  kind: "staff" as const,
  permissions: new Map([["billing", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

const SYSTEM_ACTOR = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgId: ORG_ID,
  role: "admin" as const,
  kind: "staff" as const,
  permissions: new Map([["billing", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

function makePayment(over: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    installment_id: "inst-1",
    method: "stripe",
    status: "pending",
    amount_cents: 30000,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: null,
    payer_user_id: CLIENT_ACTOR.userId,
    confirmed_by: null,
    confirmed_at: null,
    zelle_proof_path: null,
    ...over,
  };
}

function makeInstallment(over: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    payment_plan_id: "plan-1",
    number: 1,
    is_downpayment: true,
    amount_cents: 30000,
    due_date: "2026-06-23",
    status: "processing",
    paid_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.createServiceClient.mockReturnValue(
    makeServiceClientMock({ org_id: ORG_ID, status: null }),
  );
  mockRepo.findInstallmentCaseId.mockResolvedValue("case-1");
});

// ---------------------------------------------------------------------------
// reconcileCheckoutSession (L2)
// ---------------------------------------------------------------------------

describe("reconcileCheckoutSession (L2 — success_url return reconcile)", () => {
  it("settles a PAID session and reports settled=true", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    mockRepo.findPaymentById.mockResolvedValue(makePayment({ status: "succeeded" }));
    retrieveMock.mockResolvedValue({
      id: "cs_1",
      payment_status: "paid",
      payment_intent: "pi_1",
      status: "complete",
    });

    const res = await reconcileCheckoutSession(CLIENT_ACTOR, "cs_1");

    expect(res.settled).toBe(true);
    // confirmed the payment + marked installment paid (applyPaymentSuccess path)
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
    // linked the payment intent from the session
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ stripe_payment_intent_id: "pi_1" }),
    );
  });

  it("does NOT settle an UNPAID session (settled=false, no installment→paid)", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    mockRepo.findPaymentById.mockResolvedValue(makePayment());
    retrieveMock.mockResolvedValue({
      id: "cs_1",
      payment_status: "unpaid",
      status: "open",
    });

    const res = await reconcileCheckoutSession(CLIENT_ACTOR, "cs_1");

    expect(res.settled).toBe(false);
    expect(mockRepo.updateInstallment).not.toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
  });

  it("throws PAYMENT_NOT_PENDING for an unknown / forged session id", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(null);
    await expect(
      reconcileCheckoutSession(CLIENT_ACTOR, "cs_forged"),
    ).rejects.toMatchObject({ code: "PAYMENT_NOT_PENDING" });
  });

  it("is resilient: returns current status if Stripe retrieve throws", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    mockRepo.findPaymentById.mockResolvedValue(makePayment());
    retrieveMock.mockRejectedValue(new Error("stripe down"));

    const res = await reconcileCheckoutSession(CLIENT_ACTOR, "cs_1");

    expect(res.settled).toBe(false);
    expect(res.installmentStatus).toBe("processing");
  });
});

// ---------------------------------------------------------------------------
// reconcilePendingStripePayments (L3)
// ---------------------------------------------------------------------------

describe("reconcilePendingStripePayments (L3 — cron safety net)", () => {
  it("settles a created-but-unconfirmed session and counts it", async () => {
    mockRepo.listPendingStripeSessionsToReconcile.mockResolvedValue([makePayment()]);
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    retrieveMock.mockResolvedValue({
      id: "cs_1",
      payment_status: "paid",
      payment_intent: "pi_1",
      status: "complete",
    });

    const res = await reconcilePendingStripePayments(SYSTEM_ACTOR);

    expect(res).toEqual({ reconciled: 1, settled: 1, alreadySettled: 0, expired: 0 });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
  });

  it("counts a session already settled by the webhook as alreadySettled (no re-credit)", async () => {
    mockRepo.listPendingStripeSessionsToReconcile.mockResolvedValue([makePayment()]);
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment({ status: "succeeded" }));
    // Installment was already settled by an earlier layer (webhook / L2).
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "paid" }));
    retrieveMock.mockResolvedValue({
      id: "cs_1",
      payment_status: "paid",
      payment_intent: "pi_1",
      status: "complete",
    });

    const res = await reconcilePendingStripePayments(SYSTEM_ACTOR);

    expect(res).toEqual({ reconciled: 1, settled: 0, alreadySettled: 1, expired: 0 });
    // No re-credit: must NOT mark the installment paid again or re-link the intent.
    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
    expect(mockRepo.updatePayment).not.toHaveBeenCalled();
  });

  it("expires an EXPIRED session (installment reverted, counted as expired)", async () => {
    mockRepo.listPendingStripeSessionsToReconcile.mockResolvedValue([makePayment()]);
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    retrieveMock.mockResolvedValue({
      id: "cs_1",
      payment_status: "unpaid",
      status: "expired",
    });

    const res = await reconcilePendingStripePayments(SYSTEM_ACTOR);

    expect(res).toEqual({ reconciled: 1, settled: 0, alreadySettled: 0, expired: 1 });
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("rejects a non-system actor (cron-only)", async () => {
    await expect(
      reconcilePendingStripePayments(FINANCE_ACTOR),
    ).rejects.toMatchObject({ name: "AuthzError" });
  });
});
