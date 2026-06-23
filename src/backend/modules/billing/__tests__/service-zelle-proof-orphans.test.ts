/**
 * Billing service — unit tests for the payment-flow review additions.
 *
 * Covers:
 *  - getZelleProofViewUrl (signed read URL for staff proof verification)
 *  - expireOrphanCheckouts (clear stuck pending/stripe payments — cron)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (mirror service-ola2.test.ts)
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
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn().mockResolvedValue(undefined),
  findPaymentById: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  findActiveStripePayment: vi.fn(),
  listOrphanStripePayments: vi.fn(),
  findOrphanStripePaymentForInstallment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
  findOrgIdForCase: vi.fn(),
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

const mockStorage = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
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
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn() },
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

const ORG_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockSupabase = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => mockSupabase);

/** Builds a chainable Supabase service client mock returning `data`. */
function makeServiceClientMock(data: Record<string, unknown> | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({ data, error: null });
  function makeNode(): Record<string, unknown> {
    return {
      eq: (..._a: unknown[]) => makeNode(),
      neq: (..._a: unknown[]) => makeNode(),
      in: (..._a: unknown[]) => makeNode(),
      is: (..._a: unknown[]) => makeNode(),
      lt: (..._a: unknown[]) => makeNode(),
      select: (..._a: unknown[]) => makeNode(),
      maybeSingle: maybeSingleFn,
    };
  }
  return { from: vi.fn(() => makeNode()) };
}

/** createServiceClient returns the actor's own org → cross-org guard passes. */
function resetServiceClientToSameOrg() {
  mockSupabase.createServiceClient.mockReturnValue(
    makeServiceClientMock({ org_id: ORG_ID, status: null }),
  );
}

vi.mock("@/backend/platform/stripe", () => ({ getStripe: vi.fn() }));
vi.mock("@/backend/platform/storage", () => mockStorage);
vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ allowed: true }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/backend/modules/audit", () => mockAudit);
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: vi.fn(),
  findUserById: vi.fn(),
}));

// Import after mocks
import { getZelleProofViewUrl, expireOrphanCheckouts } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FULL_PERMISSIONS = new Map([["billing", { view: true, edit: true }]]);

const FINANCE_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: ORG_ID,
  role: "finance" as const,
  kind: "staff" as const,
  permissions: FULL_PERMISSIONS,
} as import("@/backend/platform/authz").Actor;

const SYSTEM_ACTOR = {
  userId: "00000000-0000-0000-0000-000000000000",
  orgId: ORG_ID,
  role: "admin" as const,
  kind: "staff" as const,
  permissions: FULL_PERMISSIONS,
} as import("@/backend/platform/authz").Actor;

const PAYMENT_ID = "11111111-1111-4111-8111-111111111111";
const INSTALLMENT_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";

function zellePayment(proofPath: string | null) {
  return {
    id: PAYMENT_ID,
    installment_id: INSTALLMENT_ID,
    method: "zelle",
    status: "pending",
    amount_cents: 30000,
    zelle_proof_path: proofPath,
  };
}

// ---------------------------------------------------------------------------
// getZelleProofViewUrl
// ---------------------------------------------------------------------------

describe("billing: getZelleProofViewUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
    mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
    mockStorage.createSignedDownloadUrl.mockResolvedValue("https://signed.example/proof");
  });

  it("returns a signed URL with kind 'image' for an image proof", async () => {
    mockRepo.findPaymentById.mockResolvedValue(
      zellePayment("payment-proofs/22222222/171-proof.jpg"),
    );

    const res = await getZelleProofViewUrl(FINANCE_ACTOR, PAYMENT_ID);

    expect(res).toEqual({ url: "https://signed.example/proof", kind: "image" });
    expect(mockStorage.createSignedDownloadUrl).toHaveBeenCalledWith(
      "payment-proofs",
      "payment-proofs/22222222/171-proof.jpg",
    );
  });

  it("returns kind 'pdf' for a PDF proof", async () => {
    mockRepo.findPaymentById.mockResolvedValue(
      zellePayment("payment-proofs/22222222/171-proof.pdf"),
    );

    const res = await getZelleProofViewUrl(FINANCE_ACTOR, PAYMENT_ID);

    expect(res.kind).toBe("pdf");
  });

  it("throws PROOF_NOT_FOUND when the payment has no proof path", async () => {
    mockRepo.findPaymentById.mockResolvedValue(zellePayment(null));

    await expect(getZelleProofViewUrl(FINANCE_ACTOR, PAYMENT_ID)).rejects.toMatchObject({
      code: "PROOF_NOT_FOUND",
    });
    expect(mockStorage.createSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("rejects cross-org access (IDOR guard)", async () => {
    mockRepo.findPaymentById.mockResolvedValue(
      zellePayment("payment-proofs/22222222/171-proof.jpg"),
    );
    // Payment belongs to a different org.
    mockSupabase.createServiceClient.mockReturnValue(
      makeServiceClientMock({ org_id: "99999999-9999-4999-8999-999999999999" }),
    );

    await expect(getZelleProofViewUrl(FINANCE_ACTOR, PAYMENT_ID)).rejects.toMatchObject({
      name: "AuthzError",
    });
  });
});

// ---------------------------------------------------------------------------
// expireOrphanCheckouts
// ---------------------------------------------------------------------------

describe("billing: expireOrphanCheckouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetServiceClientToSameOrg();
  });

  it("marks each orphan payment as failed and returns the count", async () => {
    mockRepo.listOrphanStripePayments.mockResolvedValue([
      { id: "p1" },
      { id: "p2" },
    ]);

    const res = await expireOrphanCheckouts(SYSTEM_ACTOR, { olderThanMinutes: 60 });

    expect(res).toEqual({ expired: 2 });
    expect(mockRepo.updatePayment).toHaveBeenCalledTimes(2);
    expect(mockRepo.updatePayment).toHaveBeenCalledWith("p1", { status: "failed" });
    expect(mockRepo.updatePayment).toHaveBeenCalledWith("p2", { status: "failed" });
  });

  it("returns 0 and does nothing when there are no orphans", async () => {
    mockRepo.listOrphanStripePayments.mockResolvedValue([]);

    const res = await expireOrphanCheckouts(SYSTEM_ACTOR);

    expect(res).toEqual({ expired: 0 });
    expect(mockRepo.updatePayment).not.toHaveBeenCalled();
  });

  it("rejects a non-system actor (cron-only guard)", async () => {
    await expect(expireOrphanCheckouts(FINANCE_ACTOR)).rejects.toMatchObject({
      name: "AuthzError",
    });
    expect(mockRepo.listOrphanStripePayments).not.toHaveBeenCalled();
  });
});
