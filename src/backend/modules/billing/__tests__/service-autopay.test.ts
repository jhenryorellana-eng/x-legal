/**
 * Billing service — Stripe autopay (F-autopay 2026-07): card capture,
 * setup-session webhook handling, consent toggling.
 *
 * Covers DOC-71 §2.4:
 *   createCheckoutSessionForInstallment({ enrollAutopay }) — save card on pay
 *   createSetupCheckoutSession                             — enroll w/o charge
 *   handleStripeEvent (mode=setup + optin settle)          — persistence path
 *   setAutopay                                             — consent on/off
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  findPaymentBySessionId: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findInstallmentById: vi.fn(),
  findInstallmentCaseId: vi.fn(),
  findPaymentById: vi.fn(),
  updatePayment: vi.fn().mockResolvedValue(undefined),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  insertLedgerIfAbsent: vi.fn().mockResolvedValue(undefined),
  listPendingStripeSessionsToReconcile: vi.fn(),
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
  // autopay additions
  upsertStripeCustomerCard: vi.fn().mockResolvedValue(undefined),
  updatePaymentPlanAutopay: vi.fn().mockResolvedValue(undefined),
  findPaymentPlanById: vi.fn(),
  findCaseIdForPlan: vi.fn(),
  findPlanIdByCaseId: vi.fn(),
  findPlanClientUserId: vi.fn(),
  findUserByStripeCustomerId: vi.fn(),
  listAutopayChargeTargets: vi.fn(),
  countFailedAutopayPayments: vi.fn(),
  listPendingIntentPaymentsToReconcile: vi.fn().mockResolvedValue([]),
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

const stripeMocks = vi.hoisted(() => ({
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  customerRetrieve: vi.fn(),
  customerCreate: vi.fn(),
  setupIntentRetrieve: vi.fn(),
  paymentMethodRetrieve: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
  paymentIntentCreate: vi.fn(),
}));
vi.mock("@/backend/platform/stripe", () => ({
  getStripe: vi.fn(() => ({
    checkout: {
      sessions: { create: stripeMocks.sessionCreate, retrieve: stripeMocks.sessionRetrieve },
    },
    customers: { retrieve: stripeMocks.customerRetrieve, create: stripeMocks.customerCreate },
    setupIntents: { retrieve: stripeMocks.setupIntentRetrieve },
    paymentMethods: { retrieve: stripeMocks.paymentMethodRetrieve },
    paymentIntents: { retrieve: stripeMocks.paymentIntentRetrieve, create: stripeMocks.paymentIntentCreate },
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
  createCheckoutSessionForInstallment,
  createSetupCheckoutSession,
  handleStripeEvent,
  setAutopay,
  chargeDueInstallments,
  reconcilePendingStripePayments,
  BillingError,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const CLIENT_ACTOR = {
  userId: CLIENT_USER,
  orgId: ORG_ID,
  kind: "client" as const,
} as unknown as import("@/backend/platform/authz").Actor;

const FINANCE_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: ORG_ID,
  role: "finance" as const,
  kind: "staff" as const,
  permissions: new Map([["billing", { view: true, edit: true }], ["cases", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

const PLAN_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeInstallment(over: Record<string, unknown> = {}) {
  return {
    id: "inst-1",
    payment_plan_id: PLAN_ID,
    number: 0,
    is_downpayment: true,
    amount_cents: 50000,
    due_date: "2026-07-03",
    status: "pending",
    paid_at: null,
    ...over,
  };
}

function makePayment(over: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    installment_id: "inst-1",
    method: "stripe",
    status: "pending",
    amount_cents: 50000,
    autopay: false,
    stripe_checkout_session_id: "cs_1",
    stripe_payment_intent_id: null,
    payer_user_id: CLIENT_USER,
    confirmed_by: null,
    confirmed_at: null,
    zelle_proof_path: null,
    ...over,
  };
}

function makePlanRow(over: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    contract_id: "ct-1",
    total_cents: 350000,
    downpayment_cents: 50000,
    installment_count: 11,
    frequency: "monthly",
    autopay_enabled: false,
    autopay_consented_at: null,
    autopay_consent_by: null,
    autopay_disabled_reason: null,
    notes: null,
    ...over,
  };
}

const PM_CARD = {
  id: "pm_1",
  card: { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2030 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.createServiceClient.mockReturnValue(
    makeServiceClientMock({ org_id: ORG_ID, status: null }),
  );
  mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
  mockRepo.findCaseIdForPlan.mockResolvedValue(CASE_ID);
  mockRepo.findStripeCustomer.mockResolvedValue({
    user_id: CLIENT_USER,
    stripe_customer_id: "cus_1",
    default_payment_method_id: null,
    card_brand: null,
    card_last4: null,
    card_exp_month: null,
    card_exp_year: null,
  });
  stripeMocks.customerRetrieve.mockResolvedValue({ id: "cus_1", deleted: false });
  stripeMocks.paymentMethodRetrieve.mockResolvedValue(PM_CARD);
});

// ---------------------------------------------------------------------------
// createCheckoutSessionForInstallment — enrollAutopay opt-in
// ---------------------------------------------------------------------------

describe("createCheckoutSessionForInstallment({ enrollAutopay: true })", () => {
  beforeEach(() => {
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment());
    mockRepo.findOrphanStripePaymentForInstallment.mockResolvedValue(null);
    mockRepo.insertPayment.mockResolvedValue(makePayment());
    stripeMocks.sessionCreate.mockResolvedValue({ id: "cs_1", url: "https://stripe.test/cs_1" });
  });

  it("adds setup_future_usage=off_session + optin metadata for a client", async () => {
    await createCheckoutSessionForInstallment(CLIENT_ACTOR, "inst-1", { enrollAutopay: true });

    const args = stripeMocks.sessionCreate.mock.calls[0][0];
    expect(args.mode).toBe("payment");
    expect(args.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(args.metadata.autopay_optin).toBe("1");
  });

  it("does NOT add setup_future_usage without the opt-in", async () => {
    await createCheckoutSessionForInstallment(CLIENT_ACTOR, "inst-1");

    const args = stripeMocks.sessionCreate.mock.calls[0][0];
    expect(args.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(args.metadata.autopay_optin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Autopay active → block CLIENT manual payment (card + Zelle); allow staff
// ---------------------------------------------------------------------------

describe("manual payment blocked while autopay is active", () => {
  beforeEach(() => {
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "pending" }));
    mockRepo.findOrphanStripePaymentForInstallment.mockResolvedValue(null);
    mockRepo.insertPayment.mockResolvedValue(makePayment());
    stripeMocks.sessionCreate.mockResolvedValue({ id: "cs_x", url: "https://stripe.test/cs_x" });
  });

  it("blocks a CLIENT card checkout when autopay is enabled", async () => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: true }));
    await expect(
      createCheckoutSessionForInstallment(CLIENT_ACTOR, "inst-1"),
    ).rejects.toThrow(BillingError);
    expect(stripeMocks.sessionCreate).not.toHaveBeenCalled();
  });

  it("ALLOWS a STAFF checkout even with autopay enabled (reconciliation)", async () => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: true }));
    await createCheckoutSessionForInstallment(FINANCE_ACTOR, "inst-1");
    expect(stripeMocks.sessionCreate).toHaveBeenCalled();
  });

  it("allows a CLIENT checkout when autopay is NOT enabled", async () => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: false }));
    await createCheckoutSessionForInstallment(CLIENT_ACTOR, "inst-1");
    expect(stripeMocks.sessionCreate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createSetupCheckoutSession — enroll without charging (mode=setup)
// ---------------------------------------------------------------------------

describe("createSetupCheckoutSession", () => {
  it("creates a mode=setup session bound to the case's plan", async () => {
    mockRepo.findPlanIdByCaseId.mockResolvedValue(PLAN_ID);
    stripeMocks.sessionCreate.mockResolvedValue({ id: "cs_setup_1", url: "https://stripe.test/setup" });

    const res = await createSetupCheckoutSession(CLIENT_ACTOR, CASE_ID);

    expect(res.url).toBe("https://stripe.test/setup");
    const args = stripeMocks.sessionCreate.mock.calls[0][0];
    expect(args.mode).toBe("setup");
    expect(args.customer).toBe("cus_1");
    expect(args.metadata.purpose).toBe("autopay_enroll");
    expect(args.metadata.payment_plan_id).toBe(PLAN_ID);
    expect(args.success_url).toContain("setup_session_id=");
  });

  it("throws when the case has no payment plan", async () => {
    mockRepo.findPlanIdByCaseId.mockResolvedValue(null);
    await expect(createSetupCheckoutSession(CLIENT_ACTOR, CASE_ID)).rejects.toThrow(BillingError);
  });
});

// ---------------------------------------------------------------------------
// handleStripeEvent — checkout.session.completed mode=setup
// ---------------------------------------------------------------------------

function makeSetupSessionEvent() {
  return {
    id: "evt_setup_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_setup_1",
        mode: "setup",
        status: "complete",
        customer: "cus_1",
        setup_intent: "seti_1",
        metadata: { purpose: "autopay_enroll", payment_plan_id: PLAN_ID, org_id: ORG_ID },
      },
    },
  } as unknown as import("stripe").Stripe.Event;
}

describe("handleStripeEvent — setup session completed", () => {
  beforeEach(() => {
    stripeMocks.setupIntentRetrieve.mockResolvedValue({ id: "seti_1", payment_method: "pm_1" });
    mockRepo.findUserByStripeCustomerId.mockResolvedValue(CLIENT_USER);
    mockRepo.findPlanClientUserId.mockResolvedValue(CLIENT_USER);
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow());
  });

  it("persists the card and enables autopay on the plan", async () => {
    await handleStripeEvent(makeSetupSessionEvent(), "evt_setup_1");

    expect(mockRepo.upsertStripeCustomerCard).toHaveBeenCalledWith(
      CLIENT_USER,
      expect.objectContaining({ paymentMethodId: "pm_1", brand: "visa", last4: "4242" }),
    );
    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: true,
        autopay_consent_by: CLIENT_USER,
        autopay_disabled_reason: null,
      }),
    );
  });

  it("is idempotent — processing the same event twice is safe", async () => {
    await handleStripeEvent(makeSetupSessionEvent(), "evt_setup_1");
    await handleStripeEvent(makeSetupSessionEvent(), "evt_setup_1");

    expect(mockRepo.upsertStripeCustomerCard).toHaveBeenCalledTimes(2); // upsert = safe
    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledTimes(2);
  });

  it("rejects a plan that belongs to a different client (defense-in-depth)", async () => {
    mockRepo.findPlanClientUserId.mockResolvedValue("other-user");

    await handleStripeEvent(makeSetupSessionEvent(), "evt_setup_1");

    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleStripeEvent — payment session with autopay_optin enrolls after settle
// ---------------------------------------------------------------------------

describe("handleStripeEvent — payment session with autopay_optin", () => {
  it("settles the payment AND persists card + enables autopay", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "processing" }));
    stripeMocks.paymentIntentRetrieve.mockResolvedValue({ id: "pi_1", payment_method: "pm_1" });
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow());

    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_1",
          metadata: { autopay_optin: "1", installment_id: "inst-1" },
        },
      },
    } as unknown as import("stripe").Stripe.Event;

    await handleStripeEvent(event, "evt_1");

    // settled
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
    // enrolled under the payer
    expect(mockRepo.upsertStripeCustomerCard).toHaveBeenCalledWith(
      CLIENT_USER,
      expect.objectContaining({ paymentMethodId: "pm_1" }),
    );
    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ autopay_enabled: true }),
    );
  });

  it("does not enroll without the optin flag", async () => {
    mockRepo.findPaymentBySessionId.mockResolvedValue(makePayment());
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "processing" }));

    const event = {
      id: "evt_2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_1",
          metadata: { installment_id: "inst-1" },
        },
      },
    } as unknown as import("stripe").Stripe.Event;

    await handleStripeEvent(event, "evt_2");

    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setAutopay — consent on/off
// ---------------------------------------------------------------------------

describe("setAutopay", () => {
  beforeEach(() => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: true }));
    mockRepo.findPlanClientUserId.mockResolvedValue(CLIENT_USER);
  });

  it("client can disable (customer_request)", async () => {
    await setAutopay(CLIENT_ACTOR, { planId: PLAN_ID, enabled: false });

    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: false,
        autopay_disabled_reason: "customer_request",
      }),
    );
  });

  it("client can re-enable when a saved card exists", async () => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: false }));
    mockRepo.findStripeCustomer.mockResolvedValue({
      user_id: CLIENT_USER,
      stripe_customer_id: "cus_1",
      default_payment_method_id: "pm_1",
      card_brand: "visa",
      card_last4: "4242",
    });

    await setAutopay(CLIENT_ACTOR, { planId: PLAN_ID, enabled: true });

    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({ autopay_enabled: true, autopay_consent_by: CLIENT_USER }),
    );
  });

  it("client cannot enable without a saved card", async () => {
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: false }));
    mockRepo.findStripeCustomer.mockResolvedValue({
      user_id: CLIENT_USER,
      stripe_customer_id: "cus_1",
      default_payment_method_id: null,
    });

    await expect(
      setAutopay(CLIENT_ACTOR, { planId: PLAN_ID, enabled: true }),
    ).rejects.toThrow(BillingError);
    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });

  it("staff can disable (staff_request) but NOT enable", async () => {
    await setAutopay(FINANCE_ACTOR, { planId: PLAN_ID, enabled: false });
    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: false,
        autopay_disabled_reason: "staff_request",
      }),
    );

    mockRepo.updatePaymentPlanAutopay.mockClear();
    await expect(
      setAutopay(FINANCE_ACTOR, { planId: PLAN_ID, enabled: true }),
    ).rejects.toThrow();
    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// chargeDueInstallments — daily MIT charge cron (DOC-71 §2.4)
// ---------------------------------------------------------------------------

const SYSTEM_ACTOR = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgId: "00000000-0000-0000-0000-000000000000",
  kind: "staff" as const,
  role: "admin" as const,
  permissions: new Map(),
} as import("@/backend/platform/authz").Actor;

function makeChargeTarget(over: Record<string, unknown> = {}) {
  return {
    installmentId: "inst-1",
    number: 1,
    isDownpayment: false,
    amountCents: 30000,
    dueDate: "2026-07-03",
    planId: PLAN_ID,
    caseId: CASE_ID,
    orgId: ORG_ID,
    clientUserId: CLIENT_USER,
    stripeCustomerId: "cus_1",
    paymentMethodId: "pm_1",
    autopayConsentedAt: "2026-07-01T00:00:00Z",
    ...over,
  };
}

function stripeCardError(code: string, declineCode?: string) {
  return Object.assign(new Error(code), {
    type: "StripeCardError",
    code,
    decline_code: declineCode ?? null,
    payment_intent: { id: "pi_fail_1" },
  });
}

describe("chargeDueInstallments", () => {
  beforeEach(() => {
    mockRepo.listAutopayChargeTargets.mockResolvedValue([makeChargeTarget()]);
    mockRepo.countFailedAutopayPayments.mockResolvedValue(0);
    mockRepo.findInstallmentById.mockResolvedValue(
      makeInstallment({ number: 1, is_downpayment: false, amount_cents: 30000, status: "pending" }),
    );
    mockRepo.insertPayment.mockResolvedValue(
      makePayment({ autopay: true, stripe_checkout_session_id: null }),
    );
  });

  it("rejects non-system actors (cron-only)", async () => {
    await expect(chargeDueInstallments(FINANCE_ACTOR, "2026-07-03")).rejects.toThrow();
  });

  it("charges a due installment off-session and settles inline on success", async () => {
    stripeMocks.paymentIntentCreate.mockResolvedValue({ id: "pi_ok_1", status: "succeeded" });

    const res = await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(res.charged).toBe(1);
    // mutex row inserted BEFORE the PaymentIntent
    expect(mockRepo.insertPayment.mock.invocationCallOrder[0]).toBeLessThan(
      stripeMocks.paymentIntentCreate.mock.invocationCallOrder[0],
    );
    expect(mockRepo.insertPayment).toHaveBeenCalledWith(
      expect.objectContaining({ autopay: true, method: "stripe", amount_cents: 30000 }),
    );
    const [piArgs, piOpts] = stripeMocks.paymentIntentCreate.mock.calls[0];
    expect(piArgs).toMatchObject({
      amount: 30000,
      currency: "usd",
      customer: "cus_1",
      payment_method: "pm_1",
      off_session: true,
      confirm: true,
    });
    expect(piOpts.idempotencyKey).toBe("autopay:pay-1");
    // settled inline
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
  });

  it("marks failure + emits autopay.charge_failed on a normal decline (attempt < 3)", async () => {
    stripeMocks.paymentIntentCreate.mockRejectedValue(
      stripeCardError("card_declined", "insufficient_funds"),
    );

    const res = await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(res.failed).toBe(1);
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ status: "failed" }),
    );
    expect(mockAppEvents.emitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ type: "autopay.charge_failed" }),
    );
    // plan NOT disabled on the first decline
    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });

  it("never marks the installment 'processing' before Stripe answers (crash-window invariant)", async () => {
    // If the process dies between updateInstallment and paymentIntents.create,
    // a premature 'processing' would strand the cuota forever (not chargeable,
    // not manually payable). The status must only move on a Stripe response.
    stripeMocks.paymentIntentCreate.mockRejectedValue(
      stripeCardError("card_declined", "insufficient_funds"),
    );

    await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(mockRepo.updateInstallment).not.toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "processing" }),
    );
  });

  it("defers to the webhook (installment 'processing') when the intent is not settled inline", async () => {
    stripeMocks.paymentIntentCreate.mockResolvedValue({ id: "pi_slow", status: "processing" });

    const res = await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(res.charged).toBe(0);
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "processing" }),
    );
  });

  it("scopes the retry counter to the current consent cycle (re-enrollment resets it)", async () => {
    stripeMocks.paymentIntentCreate.mockResolvedValue({ id: "pi_ok_2", status: "succeeded" });

    await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(mockRepo.countFailedAutopayPayments).toHaveBeenCalledWith(
      "inst-1",
      "2026-07-01T00:00:00Z",
    );
  });

  it("kill-switch: SCA (authentication_required) disables autopay immediately", async () => {
    stripeMocks.paymentIntentCreate.mockRejectedValue(stripeCardError("authentication_required"));

    await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: false,
        autopay_disabled_reason: "authentication_required",
      }),
    );
    expect(mockAppEvents.emitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ type: "autopay.disabled" }),
    );
  });

  it("kill-switch: 3 failed attempts disables autopay without charging again", async () => {
    mockRepo.countFailedAutopayPayments.mockResolvedValue(3);

    const res = await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(res.killSwitched).toBe(1);
    expect(stripeMocks.paymentIntentCreate).not.toHaveBeenCalled();
    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: false,
        autopay_disabled_reason: "card_declined_max_retries",
      }),
    );
  });

  it("skips when a concurrent payment holds the mutex (23505)", async () => {
    mockRepo.insertPayment.mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));

    const res = await chargeDueInstallments(SYSTEM_ACTOR, "2026-07-03");

    expect(res.skipped).toBe(1);
    expect(stripeMocks.paymentIntentCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// reconcilePendingStripePayments — intent-only sweep (autopay PIs, no session)
// ---------------------------------------------------------------------------

describe("reconcilePendingStripePayments — autopay intent sweep", () => {
  beforeEach(() => {
    mockRepo.listPendingStripeSessionsToReconcile.mockResolvedValue([]);
  });

  it("settles a succeeded off-session intent that has no checkout session", async () => {
    mockRepo.listPendingIntentPaymentsToReconcile.mockResolvedValue([
      makePayment({ autopay: true, stripe_checkout_session_id: null, stripe_payment_intent_id: "pi_auto_1" }),
    ]);
    mockRepo.findInstallmentById.mockResolvedValue(
      makeInstallment({ status: "processing", is_downpayment: false, number: 2 }),
    );
    stripeMocks.paymentIntentRetrieve.mockResolvedValue({ id: "pi_auto_1", status: "succeeded" });

    const res = await reconcilePendingStripePayments(SYSTEM_ACTOR);

    expect(res.settled).toBe(1);
    expect(mockRepo.updateInstallment).toHaveBeenCalledWith(
      "inst-1",
      expect.objectContaining({ status: "paid" }),
    );
  });

  it("fails an off-session intent Stripe reports as unpayable", async () => {
    mockRepo.listPendingIntentPaymentsToReconcile.mockResolvedValue([
      makePayment({ autopay: true, stripe_checkout_session_id: null, stripe_payment_intent_id: "pi_auto_2" }),
    ]);
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "processing" }));
    stripeMocks.paymentIntentRetrieve.mockResolvedValue({
      id: "pi_auto_2",
      status: "requires_payment_method",
    });

    const res = await reconcilePendingStripePayments(SYSTEM_ACTOR);

    expect(res.expired).toBe(1);
    expect(mockRepo.updatePayment).toHaveBeenCalledWith(
      "pay-1",
      expect.objectContaining({ status: "failed" }),
    );
  });
});

// ---------------------------------------------------------------------------
// charge.refunded on an autopay payment → autopay disabled (refund_issued)
// ---------------------------------------------------------------------------

describe("handleStripeEvent — charge.refunded on autopay payment", () => {
  it("disables autopay on the plan (a refund means staff must intervene)", async () => {
    mockRepo.findPaymentByIntentId.mockResolvedValue(
      makePayment({ autopay: true, status: "succeeded", stripe_payment_intent_id: "pi_1" }),
    );
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "paid" }));
    mockRepo.findPaymentPlanById.mockResolvedValue(makePlanRow({ autopay_enabled: true }));

    const event = {
      id: "evt_refund_1",
      type: "charge.refunded",
      data: {
        object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 50000 },
      },
    } as unknown as import("stripe").Stripe.Event;

    await handleStripeEvent(event, "evt_refund_1");

    expect(mockRepo.updatePaymentPlanAutopay).toHaveBeenCalledWith(
      PLAN_ID,
      expect.objectContaining({
        autopay_enabled: false,
        autopay_disabled_reason: "refund_issued",
      }),
    );
  });

  it("does NOT touch autopay when the refunded payment was a manual checkout", async () => {
    mockRepo.findPaymentByIntentId.mockResolvedValue(
      makePayment({ autopay: false, status: "succeeded", stripe_payment_intent_id: "pi_1" }),
    );
    mockRepo.findInstallmentById.mockResolvedValue(makeInstallment({ status: "paid" }));

    const event = {
      id: "evt_refund_2",
      type: "charge.refunded",
      data: {
        object: { id: "ch_2", payment_intent: "pi_1", amount_refunded: 50000 },
      },
    } as unknown as import("stripe").Stripe.Event;

    await handleStripeEvent(event, "evt_refund_2");

    expect(mockRepo.updatePaymentPlanAutopay).not.toHaveBeenCalled();
  });
});
