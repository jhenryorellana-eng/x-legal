/**
 * Billing service — F6-Ola1 unit tests.
 *
 * Tests: createCheckoutSessionForInstallment, handleStripeEvent,
 *   submitZelleProof, confirmZellePayment, rejectZelleProof,
 *   getAccountStatement, onContractSigned,
 *   + F6-Ola1 two-stage review fixes:
 *     - webhook retry (HIGH-1 / BLOCKER-1)
 *     - applyPaymentSuccess crash-safe order (BLOCKER-1)
 *     - IDOR fail-closed for client with null caseId (HIGH-2)
 *     - double-checkout TOCTOU prevention (BLOCKER-2)
 *     - orgId from BD not from Stripe metadata (MED-3)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingError } from "../service";
import type { InstallmentRow, PaymentRow } from "../repository";

// AuthzError imported after mocks (class re-exported from authz mock below)
// We capture the constructor reference via the mock setup.

// ---------------------------------------------------------------------------
// Hoisted mocks (Vitest F2 pattern from MEMORY.md)
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  findInstallmentById: vi.fn(),
  updateInstallment: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn(),
  findPaymentById: vi.fn(),
  findPendingZellePayment: vi.fn(),
  findInstallmentCaseId: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
  getAccountStatement: vi.fn(),
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
}));

const mockAppEvents = vi.hoisted(() => {
  // emit + emitAndWait share one spy so assertions on `.emit` still observe the
  // converted (awaited) emit path (downpayment/installment/payment events).
  const emit = vi.fn();
  return { emit, emitAndWait: emit };
});

const mockStripe = vi.hoisted(() => ({
  checkout: {
    sessions: {
      create: vi.fn(),
    },
  },
  customers: {
    create: vi.fn(),
  },
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
  appendCaseTimeline: vi.fn(),
}));

const mockAuthz = vi.hoisted(() => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
}));

const mockStorage = vi.hoisted(() => ({
  validateUploadedObject: vi.fn(),
}));

const mockSupabase = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  chain.from.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  return { createServiceClient: vi.fn(() => chain), chain };
});

vi.mock("../repository", () => mockRepo);
vi.mock("@/backend/platform/events", () => ({ appEvents: mockAppEvents }));
vi.mock("@/backend/platform/stripe", () => ({ getStripe: () => mockStripe }));
vi.mock("@/backend/modules/audit", () => mockAudit);
vi.mock("@/backend/platform/authz", () => ({
  ...mockAuthz,
  // AuthzError mock must store the reason passed to constructor (HIGH-2 tests check .reason)
  AuthzError: class AuthzError extends Error {
    reason: string;
    constructor(reason: string) { super(reason); this.reason = reason; this.name = "AuthzError"; }
  },
}));
vi.mock("@/backend/platform/storage", () => mockStorage);
vi.mock("@/backend/platform/supabase", () => mockSupabase);
// Mock ratelimit — default: allow (tests focus on billing logic, not rate limit behavior)
vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ allowed: true, reset: 0 }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ allowed: true, reset: 0 }),
}));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "http://localhost:3000" },
  providerEnv: vi.fn(() => ({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" })),
}));

// Import AFTER mocks
import {
  createCheckoutSessionForInstallment,
  handleStripeEvent,
  submitZelleProof,
  confirmZellePayment,
  rejectZelleProof,
  getAccountStatement,
  onContractSigned,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INSTALLMENT_ID = "11111111-1111-4111-8111-111111111111";
const PAYMENT_ID     = "22222222-2222-4222-8222-222222222222";
const CASE_ID        = "33333333-3333-4333-8333-333333333333";
const ORG_ID         = "44444444-4444-4444-8444-444444444444";
const USER_ID        = "55555555-5555-4555-8555-555555555555";
const CONTRACT_ID    = "66666666-6666-4666-8666-666666666666";
const PLAN_ID        = "77777777-7777-4777-8777-777777777777";

const makeActor = (kind: "client" | "staff" = "staff", role = "finance") => ({
  userId: USER_ID,
  orgId: ORG_ID,
  kind,
  role,
  permissions: new Map([["billing", { view: true, edit: true }]]),
}) as import("@/backend/platform/authz").Actor;

const makePendingInstallment = (overrides?: Partial<InstallmentRow>): InstallmentRow =>
  ({
    id: INSTALLMENT_ID,
    payment_plan_id: PLAN_ID,
    number: 1,
    amount_cents: 50000,
    due_date: "2026-07-01",
    status: "pending",
    is_downpayment: true,
    paid_at: null,
    waived_by: null,
    waived_reason: null,
    last_reminder_at: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  } as InstallmentRow);

const makePendingPayment = (overrides?: Partial<PaymentRow>): PaymentRow =>
  ({
    id: PAYMENT_ID,
    installment_id: INSTALLMENT_ID,
    method: "zelle",
    status: "pending",
    amount_cents: 50000,
    payer_user_id: USER_ID,
    confirmed_by: null,
    confirmed_at: null,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    zelle_proof_path: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  } as PaymentRow);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthz.can.mockReturnValue(undefined); // can() throws on failure
  mockAuthz.requireCaseAccess.mockResolvedValue(undefined);
  mockAudit.writeAudit.mockResolvedValue(undefined);
  mockAudit.appendCaseTimeline.mockResolvedValue(undefined);
  mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
  mockRepo.updateInstallment.mockResolvedValue(undefined);
  mockRepo.updatePayment.mockResolvedValue(undefined);
  mockRepo.insertPayment.mockResolvedValue(makePendingPayment());
  mockRepo.insertLedgerIfAbsent.mockResolvedValue(undefined);
  mockRepo.findActiveStripePayment.mockResolvedValue(null);
  mockRepo.findPendingZellePayment.mockResolvedValue(null);
  mockRepo.findStripeCustomer.mockResolvedValue({ user_id: USER_ID, stripe_customer_id: "cus_123", created_at: "", updated_at: "" });
  mockStorage.validateUploadedObject.mockResolvedValue({ ok: true });

  // supabase chain for findOrgIdForCase / findCaseNumber / etc.
  mockSupabase.chain.maybeSingle.mockResolvedValue({
    data: { org_id: ORG_ID, case_number: "2026-001" },
    error: null,
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSessionForInstallment
// ---------------------------------------------------------------------------

describe("createCheckoutSessionForInstallment", () => {
  it("returns {url} on success", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/pay/cs_test_123",
    });

    const actor = makeActor("client");
    const result = await createCheckoutSessionForInstallment(actor, INSTALLMENT_ID);

    expect(result).toEqual({ url: "https://checkout.stripe.com/pay/cs_test_123" });
    // BLOCKER-2: insertPayment is called with session_id=null (before Stripe call)
    // then updatePayment patches session_id after Stripe returns
    expect(mockRepo.insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        installment_id: INSTALLMENT_ID,
        method: "stripe",
        status: "pending",
        amount_cents: 50000,
        stripe_checkout_session_id: null, // patched after Stripe call
      }),
    );
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ stripe_checkout_session_id: "cs_test_123" }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(INSTALLMENT_ID, { status: "processing" });
  });

  it("throws INSTALLMENT_NOT_FOUND when installment doesn't exist", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(null);

    await expect(
      createCheckoutSessionForInstallment(makeActor(), INSTALLMENT_ID),
    ).rejects.toThrow(BillingError);

    const error = await createCheckoutSessionForInstallment(makeActor(), INSTALLMENT_ID).catch((e) => e);
    expect(error.code).toBe("INSTALLMENT_NOT_FOUND");
  });

  it("throws INSTALLMENT_ALREADY_PAID for paid installment", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    const error = await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID).catch((e) => e);
    expect(error).toBeInstanceOf(BillingError);
    expect(error.code).toBe("INSTALLMENT_ALREADY_PAID");
  });

  it("throws INSTALLMENT_NOT_PAYABLE for processing installment", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "processing" }));

    const error = await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID).catch((e) => e);
    expect(error.code).toBe("INSTALLMENT_NOT_PAYABLE");
  });

  it("throws PAYMENT_IN_PROGRESS when BD unique index conflicts (concurrent checkout)", async () => {
    // BLOCKER-2: detection now via BD constraint (23505) on insertPayment,
    // not via findActiveStripePayment (TOCTOU). Simulate the constraint conflict.
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.insertPayment.mockRejectedValue({ code: "23505", message: "unique_violation" });

    const error = await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID).catch((e) => e);
    expect(error.code).toBe("PAYMENT_IN_PROGRESS");
    // Stripe must NOT have been called when the BD gate fires
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("uses amount from BD (never from client)", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ amount_cents: 75000 }));
    mockStripe.checkout.sessions.create.mockResolvedValue({ id: "cs_abc", url: "https://checkout.stripe.com/pay/cs_abc" });

    await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID);

    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: expect.arrayContaining([
          expect.objectContaining({
            price_data: expect.objectContaining({ unit_amount: 75000 }), // FROM BD
          }),
        ]),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleStripeEvent — idempotency and dispatch
// ---------------------------------------------------------------------------

describe("handleStripeEvent", () => {
  const makeSessionCompletedEvent = () => ({
    id: "evt_test_session",
    type: "checkout.session.completed" as const,
    data: {
      object: {
        id: "cs_test_123",
        payment_status: "paid",
        payment_intent: "pi_test_123",
        metadata: { installment_id: INSTALLMENT_ID, case_id: CASE_ID, org_id: ORG_ID },
        client_reference_id: INSTALLMENT_ID,
      },
    },
  } as unknown as import("stripe").Stripe.Event);

  const makeIntentSucceededEvent = () => ({
    id: "evt_test_intent",
    type: "payment_intent.succeeded" as const,
    data: {
      object: {
        id: "pi_test_123",
        metadata: { installment_id: INSTALLMENT_ID, case_id: CASE_ID, org_id: ORG_ID },
      },
    },
  } as unknown as import("stripe").Stripe.Event);

  it("checkout.session.completed: marks payment succeeded + installment paid", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_test_123" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());

    await handleStripeEvent(makeSessionCompletedEvent(), "evt_test_session");

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "paid" }),
    );
    expect(mockRepo.insertLedgerIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "income", category: "cuota" }),
    );
    expect(mockAppEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "downpayment.confirmed" }),
    );
  });

  it("is idempotent: second handler for already-paid installment is no-op", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_test_123" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    // Installment already paid
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    await handleStripeEvent(makeSessionCompletedEvent(), "evt_test_session");

    // Should NOT re-update installment or insert duplicate ledger entry
    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
    expect(mockRepo.insertLedgerIfAbsent).not.toHaveBeenCalled();
    expect(mockAppEvents.emit).not.toHaveBeenCalled();
  });

  it("payment_intent.payment_failed: marks payment failed, reverts installment to pending", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_payment_intent_id: "pi_test_fail" });
    mockRepo.findPaymentByIntentId.mockResolvedValue(payment);
    mockRepo.findActiveStripePayment.mockResolvedValue(null);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "processing" }));

    await handleStripeEvent({
      id: "evt_fail",
      type: "payment_intent.payment_failed" as const,
      data: { object: { id: "pi_test_fail", metadata: {} } },
    } as unknown as import("stripe").Stripe.Event, "evt_fail");

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(PAYMENT_ID, { status: "failed" });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("checkout.session.expired: marks payment failed, reverts installment", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_expired" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "processing" }));

    await handleStripeEvent({
      id: "evt_expired",
      type: "checkout.session.expired" as const,
      data: {
        object: {
          id: "cs_expired",
          metadata: { installment_id: INSTALLMENT_ID },
          client_reference_id: INSTALLMENT_ID,
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_expired");

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(PAYMENT_ID, { status: "failed" });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "pending" }),
    );
  });

  it("charge.refunded: marks payment refunded, reverts installment, inserts expense ledger", async () => {
    const payment = makePendingPayment({ method: "stripe", status: "succeeded", stripe_payment_intent_id: "pi_refund" });
    mockRepo.findPaymentByIntentId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    await handleStripeEvent({
      id: "evt_refund",
      type: "charge.refunded" as const,
      data: {
        object: {
          id: "ch_123",
          payment_intent: "pi_refund",
          amount_refunded: 50000,
          metadata: { org_id: ORG_ID },
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_refund");

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(PAYMENT_ID, { status: "refunded" });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "pending", paid_at: null }),
    );
    expect(mockRepo.insertLedgerIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "expense", category: "reembolso" }),
    );
    expect(mockAppEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.refunded" }),
    );
  });

  it("payment_intent.succeeded commutes with checkout.session.completed (second is no-op)", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_payment_intent_id: "pi_test_123" });
    mockRepo.findPaymentByIntentId.mockResolvedValue(payment);
    // Installment already paid (session.completed arrived first)
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    await handleStripeEvent(makeIntentSucceededEvent(), "evt_test_intent");

    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
    expect(mockRepo.insertLedgerIfAbsent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// submitZelleProof
// ---------------------------------------------------------------------------

describe("submitZelleProof", () => {
  it("inserts pending payment + sets installment to processing + emits event", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());

    await submitZelleProof(makeActor("client"), {
      installmentId: INSTALLMENT_ID,
      proofPath: "payment-proofs/11111111-1111-4111-8111-111111111111/1234-proof.jpg",
    });

    expect(mockRepo.insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "zelle",
        status: "pending",
        zelle_proof_path: "payment-proofs/11111111-1111-4111-8111-111111111111/1234-proof.jpg",
      }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      { status: "processing" },
    );
    expect(mockAppEvents.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "payment.proof_submitted" }),
    );
  });

  it("throws PROOF_ALREADY_SUBMITTED if pending Zelle payment exists", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findPendingZellePayment.mockResolvedValue(makePendingPayment());

    const error = await submitZelleProof(makeActor("client"), {
      installmentId: INSTALLMENT_ID,
      proofPath: "payment-proofs/x/y.jpg",
    }).catch((e) => e);

    expect(error.code).toBe("PROOF_ALREADY_SUBMITTED");
  });

  it("throws PROOF_INVALID_FILE when storage validation fails", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockStorage.validateUploadedObject.mockResolvedValue({ ok: false, reason: "Bad file" });

    const error = await submitZelleProof(makeActor("client"), {
      installmentId: INSTALLMENT_ID,
      proofPath: "payment-proofs/x/bad.exe",
    }).catch((e) => e);

    expect(error.code).toBe("PROOF_INVALID_FILE");
  });

  it("throws INSTALLMENT_ALREADY_PAID for paid installment", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    const error = await submitZelleProof(makeActor("client"), {
      installmentId: INSTALLMENT_ID,
      proofPath: "payment-proofs/x/proof.jpg",
    }).catch((e) => e);

    expect(error.code).toBe("INSTALLMENT_ALREADY_PAID");
  });
});

// ---------------------------------------------------------------------------
// confirmZellePayment
// ---------------------------------------------------------------------------

describe("confirmZellePayment", () => {
  it("applies payment success on pending zelle payment", async () => {
    const payment = makePendingPayment({ method: "zelle" });
    mockRepo.findPaymentById.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "processing" }));

    await confirmZellePayment(makeActor("staff", "finance"), PAYMENT_ID);

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ status: "succeeded" }),
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "paid" }),
    );
    expect(mockAudit.writeAudit).toHaveBeenCalledWith(
      expect.any(Object),
      "billing.zelle.confirmed",
      "payments",
      PAYMENT_ID,
      expect.any(Object),
    );
  });

  it("throws PAYMENT_NOT_PENDING for non-pending payment", async () => {
    mockRepo.findPaymentById.mockResolvedValue(
      makePendingPayment({ method: "zelle", status: "succeeded" }),
    );

    const error = await confirmZellePayment(makeActor(), PAYMENT_ID).catch((e) => e);
    expect(error.code).toBe("PAYMENT_NOT_PENDING");
  });

  it("throws PAYMENT_NOT_PENDING for stripe payment", async () => {
    mockRepo.findPaymentById.mockResolvedValue(
      makePendingPayment({ method: "stripe", status: "pending" }),
    );

    const error = await confirmZellePayment(makeActor(), PAYMENT_ID).catch((e) => e);
    expect(error.code).toBe("PAYMENT_NOT_PENDING");
  });
});

// ---------------------------------------------------------------------------
// rejectZelleProof
// ---------------------------------------------------------------------------

describe("rejectZelleProof", () => {
  it("marks payment rejected, reverts installment to pending", async () => {
    mockRepo.findPaymentById.mockResolvedValue(makePendingPayment({ method: "zelle" }));
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "processing" }));

    await rejectZelleProof(makeActor(), {
      paymentId: PAYMENT_ID,
      reason: "El comprobante es ilegible",
    });

    expect(mockRepo.updatePayment).toHaveBeenCalledWith(PAYMENT_ID, { status: "rejected" });
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      { status: "pending" },
    );
    expect(mockAudit.writeAudit).toHaveBeenCalled();
  });

  it("throws REJECTION_REASON_REQUIRED when reason is empty", async () => {
    const error = await rejectZelleProof(makeActor(), {
      paymentId: PAYMENT_ID,
      reason: "",
    }).catch((e) => e);

    // Zod min(1) validation
    expect(error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getAccountStatement — delegates to repo + requireCaseAccess
// ---------------------------------------------------------------------------

describe("getAccountStatement", () => {
  it("calls requireCaseAccess then returns repo result", async () => {
    const dto = {
      plan: { totalCents: 100000, downpaymentCents: 20000, installmentCount: 4, notes: null },
      installments: [],
      nextDue: null,
      aggregates: { paidCents: 0, pendingCents: 100000, overdueCents: 0, waivedCents: 0, totalCents: 100000 },
    };
    mockRepo.getAccountStatement.mockResolvedValue(dto);

    const result = await getAccountStatement(makeActor("client"), CASE_ID);

    expect(mockAuthz.requireCaseAccess).toHaveBeenCalledWith(expect.any(Object), CASE_ID);
    expect(result).toEqual(dto);
  });
});

// ---------------------------------------------------------------------------
// onContractSigned — re-anchor idempotency
// ---------------------------------------------------------------------------

describe("onContractSigned", () => {
  const makeInstallments = (): InstallmentRow[] => [
    { id: "inst-1", payment_plan_id: PLAN_ID, number: 1, amount_cents: 20000, due_date: "2026-06-01", status: "pending", is_downpayment: true, paid_at: null, waived_by: null, waived_reason: null, last_reminder_at: null, created_at: "", updated_at: "" } as InstallmentRow,
    { id: "inst-2", payment_plan_id: PLAN_ID, number: 2, amount_cents: 20000, due_date: "2026-07-01", status: "pending", is_downpayment: false, paid_at: null, waived_by: null, waived_reason: null, last_reminder_at: null, created_at: "", updated_at: "" } as InstallmentRow,
  ];

  it("updates due dates when all installments are pending and no payments exist", async () => {
    // supabase chain for plan lookup + payment check
    mockSupabase.chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: PLAN_ID, installment_count: 2 }, error: null })
      .mockResolvedValueOnce({ data: null, error: null }); // no payments

    mockRepo.listInstallmentsForPlan.mockResolvedValue(makeInstallments());

    await onContractSigned({
      contractId: CONTRACT_ID,
      caseId: CASE_ID,
      signedAt: "2026-06-15T14:00:00Z",
      orgId: ORG_ID,
    });

    // Both installments should be updated with re-anchored dates
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ due_date: "2026-06-15" }), // anchor
    );
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-2",
      expect.objectContaining({ due_date: "2026-07-15" }), // anchor + 1 month
    );
  });

  it("is idempotent: skips re-anchor if any installment is not pending", async () => {
    mockSupabase.chain.maybeSingle.mockResolvedValueOnce({
      data: { id: PLAN_ID, installment_count: 2 },
      error: null,
    });

    const installments = makeInstallments();
    installments[0].status = "paid"; // downpayment already paid
    mockRepo.listInstallmentsForPlan.mockResolvedValue(installments);

    await onContractSigned({
      contractId: CONTRACT_ID,
      caseId: CASE_ID,
      signedAt: "2026-06-15T14:00:00Z",
      orgId: ORG_ID,
    });

    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
  });

  it("is idempotent: skips re-anchor if payments already exist", async () => {
    mockSupabase.chain.maybeSingle
      .mockResolvedValueOnce({ data: { id: PLAN_ID, installment_count: 2 }, error: null })
      .mockResolvedValueOnce({ data: { id: "pmt-1" }, error: null }); // payment exists

    mockRepo.listInstallmentsForPlan.mockResolvedValue(makeInstallments());

    await onContractSigned({
      contractId: CONTRACT_ID,
      caseId: CASE_ID,
      signedAt: "2026-06-15T14:00:00Z",
      orgId: ORG_ID,
    });

    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// F6-Ola1 two-stage review fixes — NEW TESTS
// ===========================================================================

// ---------------------------------------------------------------------------
// BLOCKER-1: applyPaymentSuccess — crash-safe ordering
// The ledger must be inserted BEFORE the installment is marked paid.
// Verified via call order of mock calls.
// ---------------------------------------------------------------------------

describe("applyPaymentSuccess ordering (BLOCKER-1 — crash-safe)", () => {
  it("inserts ledger BEFORE marking installment paid on first delivery", async () => {
    const callOrder: string[] = [];
    mockRepo.insertLedgerIfAbsent.mockImplementation(async () => {
      callOrder.push("ledger");
    });
    mockRepo.updateInstallment.mockImplementation(async () => {
      callOrder.push("installment-paid");
    });
    mockRepo.updatePayment.mockImplementation(async () => {
      callOrder.push("payment-succeeded");
    });

    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_order_test" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    // supabase for findOrgIdForCase
    mockSupabase.chain.maybeSingle.mockResolvedValue({
      data: { org_id: ORG_ID, case_number: "2026-001" },
      error: null,
    });

    await handleStripeEvent({
      id: "evt_order",
      type: "checkout.session.completed" as const,
      data: {
        object: {
          id: "cs_order_test",
          payment_status: "paid",
          payment_intent: null,
          metadata: { installment_id: INSTALLMENT_ID, case_id: CASE_ID, org_id: ORG_ID },
          client_reference_id: INSTALLMENT_ID,
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_order");

    // Invariant: ledger before installment-paid
    const ledgerIdx = callOrder.indexOf("ledger");
    const paidIdx = callOrder.indexOf("installment-paid");
    expect(ledgerIdx).toBeGreaterThanOrEqual(0);
    expect(paidIdx).toBeGreaterThan(ledgerIdx);
  });

  it("is idempotent on retry when installment is already paid (ledger already exists)", async () => {
    // Simulate: first delivery crashed after step 3 (installment=paid).
    // Retry: claim=retry, handler runs, installment.status='paid' → early return.
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_retry" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    // Installment already paid (step 3 completed on prior run)
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));

    await handleStripeEvent({
      id: "evt_retry",
      type: "checkout.session.completed" as const,
      data: {
        object: {
          id: "cs_retry",
          payment_status: "paid",
          payment_intent: null,
          metadata: { installment_id: INSTALLMENT_ID, case_id: CASE_ID, org_id: ORG_ID },
          client_reference_id: INSTALLMENT_ID,
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_retry");

    // idempotency guard fires — no redundant inserts
    expect(mockRepo.updateInstallment).not.toHaveBeenCalled();
    expect(mockRepo.insertLedgerIfAbsent).not.toHaveBeenCalled();
    expect(mockAppEvents.emit).not.toHaveBeenCalled();
  });

  it("retries ledger insert when installment is still pending (crash between steps 1-2)", async () => {
    // Simulate: prior delivery crashed after updatePayment but before insertLedger.
    // installment.status is still 'pending' → guard does NOT fire → ledger + paid run.
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_crash12" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "pending" }));

    await handleStripeEvent({
      id: "evt_crash12",
      type: "checkout.session.completed" as const,
      data: {
        object: {
          id: "cs_crash12",
          payment_status: "paid",
          payment_intent: null,
          metadata: { installment_id: INSTALLMENT_ID, case_id: CASE_ID, org_id: ORG_ID },
          client_reference_id: INSTALLMENT_ID,
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_crash12");

    // Both ledger and installment-paid must be called (full re-run)
    expect(mockRepo.insertLedgerIfAbsent).toHaveBeenCalledTimes(1);
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      INSTALLMENT_ID,
      expect.objectContaining({ status: "paid" }),
    );
  });
});

// ---------------------------------------------------------------------------
// HIGH-2: IDOR fail-closed — client with null caseId → forbidden
// ---------------------------------------------------------------------------

describe("IDOR fail-closed (HIGH-2) — client with null caseId", () => {
  it("createCheckoutSessionForInstallment: throws AuthzError for client when caseId is null", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(null); // no case

    const clientActor = makeActor("client");
    const err = await createCheckoutSessionForInstallment(clientActor, INSTALLMENT_ID).catch((e) => e);

    // Must be an AuthzError (forbidden), NOT a BillingError or silent success
    expect(err).toBeDefined();
    expect(err.constructor.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_case");
  });

  it("submitZelleProof: throws AuthzError for client when caseId is null", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(null);

    const clientActor = makeActor("client");
    const err = await submitZelleProof(clientActor, {
      installmentId: INSTALLMENT_ID,
      proofPath: "payment-proofs/x/proof.jpg",
    }).catch((e) => e);

    expect(err.constructor.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_case");
  });

  it("getZelleProofUploadUrl: throws AuthzError for client when caseId is null", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(null);

    const clientActor = makeActor("client");
    const { getZelleProofUploadUrl: getUrl } = await import("../service");
    const err = await getUrl(clientActor, {
      installmentId: INSTALLMENT_ID,
      filename: "proof.jpg",
      contentType: "image/jpeg",
    }).catch((e) => e);

    expect(err.constructor.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_case");
  });

  it("getInstallmentPaymentStatus: throws AuthzError for client when caseId is null", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(null);

    const clientActor = makeActor("client");
    const { getInstallmentPaymentStatus } = await import("../service");
    const err = await getInstallmentPaymentStatus(clientActor, INSTALLMENT_ID).catch((e) => e);

    expect(err.constructor.name).toBe("AuthzError");
    expect(err.reason).toBe("forbidden_case");
  });

  it("staff with null caseId can still proceed (only clients are fail-closed)", async () => {
    // Staff goes through can(actor, 'billing', 'edit') — caseId null does not block
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(null);
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_staff",
      url: "https://checkout.stripe.com/pay/cs_staff",
    });
    // insertPayment returns payment for updatePayment call
    const localPmt = makePendingPayment({ method: "stripe", stripe_checkout_session_id: null });
    mockRepo.insertPayment.mockResolvedValue(localPmt);
    mockSupabase.chain.maybeSingle.mockResolvedValue({ data: { org_id: null, case_number: null }, error: null });

    const staffActor = makeActor("staff", "finance");
    const result = await createCheckoutSessionForInstallment(staffActor, INSTALLMENT_ID).catch((e) => e);

    // Staff does not get AuthzError — they get a URL (or at worst a non-authz error)
    if (result && "reason" in result) {
      expect(result.reason).not.toBe("forbidden_case");
    } else {
      expect(result).toHaveProperty("url");
    }
  });
});

// ---------------------------------------------------------------------------
// BLOCKER-2: double-checkout prevention via BD insert-first mutex
// ---------------------------------------------------------------------------

describe("createCheckoutSessionForInstallment — BLOCKER-2 (TOCTOU prevention)", () => {
  it("throws PAYMENT_IN_PROGRESS when insertPayment conflicts with unique partial index", async () => {
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    // Simulate BD unique index conflict (23505)
    mockRepo.insertPayment.mockRejectedValue({ code: "23505", message: "unique_violation" });
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_dup",
      url: "https://checkout.stripe.com/pay/cs_dup",
    });

    const err = await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID).catch((e) => e);

    expect(err).toBeInstanceOf(BillingError);
    expect(err.code).toBe("PAYMENT_IN_PROGRESS");
    // Stripe must NOT have been called (BD is the gate)
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("inserts payment row BEFORE calling Stripe (verify call order)", async () => {
    const callOrder: string[] = [];
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockRepo.insertPayment.mockImplementation(async () => {
      callOrder.push("insertPayment");
      return makePendingPayment({ method: "stripe" });
    });
    mockStripe.checkout.sessions.create.mockImplementation(async () => {
      callOrder.push("stripe.create");
      return { id: "cs_order", url: "https://checkout.stripe.com/pay/cs_order" };
    });
    mockSupabase.chain.maybeSingle.mockResolvedValue({ data: { org_id: ORG_ID, case_number: "2026-001" }, error: null });

    await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID);

    expect(callOrder.indexOf("insertPayment")).toBeLessThan(callOrder.indexOf("stripe.create"));
  });

  it("updates payment with session_id after Stripe session is created", async () => {
    const localPmt = makePendingPayment({ method: "stripe", stripe_checkout_session_id: null });
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockRepo.insertPayment.mockResolvedValue(localPmt);
    mockStripe.checkout.sessions.create.mockResolvedValue({
      id: "cs_patched",
      url: "https://checkout.stripe.com/pay/cs_patched",
    });
    mockSupabase.chain.maybeSingle.mockResolvedValue({ data: { org_id: ORG_ID, case_number: "2026-001" }, error: null });

    await createCheckoutSessionForInstallment(makeActor("client"), INSTALLMENT_ID);

    // updatePayment must be called with the session id
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      localPmt.id,
      expect.objectContaining({ stripe_checkout_session_id: "cs_patched" }),
    );
  });
});

// ---------------------------------------------------------------------------
// MED-3: orgId from BD, not from Stripe metadata
// ---------------------------------------------------------------------------

describe("orgId derivation (MED-3) — from BD not Stripe metadata", () => {
  it("checkout.session.completed: orgId comes from findOrgIdForCase, not metadata", async () => {
    const payment = makePendingPayment({ method: "stripe", stripe_checkout_session_id: "cs_orgtest" });
    mockRepo.findPaymentBySessionId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment());
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);

    // BD returns REAL org (ORG_ID_BD). Event metadata carries a DIFFERENT org (attacker-supplied).
    const ORG_ID_BD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockSupabase.chain.maybeSingle.mockResolvedValue({
      data: { org_id: ORG_ID_BD, case_number: "2026-999" },
      error: null,
    });

    await handleStripeEvent({
      id: "evt_org",
      type: "checkout.session.completed" as const,
      data: {
        object: {
          id: "cs_orgtest",
          payment_status: "paid",
          payment_intent: null,
          metadata: {
            installment_id: INSTALLMENT_ID,
            case_id: CASE_ID,
            // Attacker-supplied org_id in metadata — must NOT be used for ledger
            org_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          },
          client_reference_id: INSTALLMENT_ID,
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_org");

    // Ledger must have been inserted with BD org_id (ORG_ID_BD), not the metadata one
    expect(mockRepo.insertLedgerIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID_BD }),
    );
    // Must NOT contain the attacker-supplied org
    expect(mockRepo.insertLedgerIfAbsent).not.toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }),
    );
  });

  it("charge.refunded: orgId from BD, not charge.metadata", async () => {
    const payment = makePendingPayment({ method: "stripe", status: "succeeded", stripe_payment_intent_id: "pi_refund_org" });
    mockRepo.findPaymentByIntentId.mockResolvedValue(payment);
    mockRepo.findInstallmentById.mockResolvedValue(makePendingInstallment({ status: "paid" }));
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);

    const ORG_ID_BD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mockSupabase.chain.maybeSingle.mockResolvedValue({
      data: { org_id: ORG_ID_BD, case_number: "2026-001" },
      error: null,
    });

    await handleStripeEvent({
      id: "evt_refund_org",
      type: "charge.refunded" as const,
      data: {
        object: {
          id: "ch_orgtest",
          payment_intent: "pi_refund_org",
          amount_refunded: 50000,
          // Attacker-supplied org in charge metadata — must NOT be used
          metadata: { org_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
        },
      },
    } as unknown as import("stripe").Stripe.Event, "evt_refund_org");

    expect(mockRepo.insertLedgerIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID_BD }),
    );
    expect(mockRepo.insertLedgerIfAbsent).not.toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }),
    );
  });
});
