/**
 * Billing service — applyBankVerifiedZellePayment (Zelle auto-reconciliation
 * tier A, migration 0111).
 *
 * Covers: domain guard before the RPC, {applied:false} mapped without throwing,
 * post-commit event emission + system audit on success, and input validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (pattern: service-ola2.test.ts)
// ---------------------------------------------------------------------------

const mockRepo = vi.hoisted(() => ({
  findInstallmentById: vi.fn(),
  updateInstallment: vi.fn().mockResolvedValue(undefined),
  findInstallmentCaseId: vi.fn(),
  callApplyZelleAutoPayment: vi.fn(),
  findPaymentById: vi.fn(),
  // Present so the service module import never blows up
  findPlanByContractId: vi.fn(),
  findPlanByCaseId: vi.fn(),
  insertPaymentPlan: vi.fn(),
  insertInstallments: vi.fn(),
  listInstallmentsForPlan: vi.fn(),
  insertPayment: vi.fn(),
  updatePayment: vi.fn(),
  findPendingZellePayment: vi.fn(),
  getAccountStatement: vi.fn(),
  findCaseNumberById: vi.fn(),
  findActiveStripePayment: vi.fn(),
  findPaymentByIntentId: vi.fn(),
  findPaymentBySessionId: vi.fn(),
  findStripeCustomer: vi.fn(),
  upsertStripeCustomer: vi.fn(),
  insertLedgerIfAbsent: vi.fn(),
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

vi.mock("@/backend/modules/audit", () => mockAudit);

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {},
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: mockAppEvents }));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/env", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://test.localhost" },
  providerEnv: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/stripe", () => ({ getStripe: vi.fn() }));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/platform/ratelimit", () => ({
  limitBillingCheckout: vi.fn().mockResolvedValue({ success: true }),
  limitBillingUploadUrl: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: vi.fn().mockResolvedValue(undefined),
  findUserById: vi.fn(),
}));

import { applyBankVerifiedZellePayment } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOTIFICATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MATCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INSTALLMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORG_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PAYMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CASE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const input = {
  notificationId: NOTIFICATION_ID,
  matchId: MATCH_ID,
  installmentId: INSTALLMENT_ID,
  amountCents: 35000,
  proofPath: `${INSTALLMENT_ID}/zelle-auto-30107053254.pdf`,
  orgId: ORG_ID,
  payerUserId: null,
};

const payableInstallment = {
  id: INSTALLMENT_ID,
  status: "pending",
  number: 3,
  is_downpayment: false,
  amount_cents: 35000,
  due_date: "2026-08-01",
  paid_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findInstallmentById.mockResolvedValue(payableInstallment);
  mockRepo.findInstallmentCaseId.mockResolvedValue(CASE_ID);
  mockRepo.findPaymentById.mockResolvedValue({
    id: PAYMENT_ID,
    amount_cents: 35000,
    method: "zelle",
    autopay: false,
  });
  // buildPaymentReceiptFacts degrades gracefully with these unset; keep minimal
  mockRepo.getAccountStatement.mockResolvedValue(null);
  mockRepo.findCaseNumberById.mockResolvedValue("U26-000107");
});

describe("applyBankVerifiedZellePayment", () => {
  it("refuses before the RPC when the installment is not payable (domain guard)", async () => {
    mockRepo.findInstallmentById.mockResolvedValue({
      ...payableInstallment,
      status: "processing",
    });

    const result = await applyBankVerifiedZellePayment(input);

    expect(result).toEqual({
      applied: false,
      reason: "INSTALLMENT_NOT_PAYABLE:processing",
    });
    expect(mockRepo.callApplyZelleAutoPayment).not.toHaveBeenCalled();
    expect(mockAppEvents.emitAndWait).not.toHaveBeenCalled();
  });

  it("maps an RPC refusal to {applied:false} without throwing, no events, no audit", async () => {
    mockRepo.callApplyZelleAutoPayment.mockResolvedValue({
      applied: false,
      reason: "STRIPE_PENDING",
    });

    const result = await applyBankVerifiedZellePayment(input);

    expect(result).toEqual({ applied: false, reason: "STRIPE_PENDING" });
    expect(mockAppEvents.emitAndWait).not.toHaveBeenCalled();
    expect(mockAudit.writeAudit).not.toHaveBeenCalled();
  });

  it("settles: emits installment.paid and audits as system actor", async () => {
    mockRepo.callApplyZelleAutoPayment.mockResolvedValue({
      applied: true,
      payment_id: PAYMENT_ID,
      case_id: CASE_ID,
    });
    mockRepo.findInstallmentById
      .mockResolvedValueOnce(payableInstallment) // pre-RPC guard read
      .mockResolvedValueOnce({ ...payableInstallment, status: "paid" }); // post-commit

    const result = await applyBankVerifiedZellePayment(input);

    expect(result).toEqual({ applied: true, paymentId: PAYMENT_ID });
    expect(mockRepo.callApplyZelleAutoPayment).toHaveBeenCalledWith(
      expect.objectContaining({ installmentId: INSTALLMENT_ID, amountCents: 35000 }),
    );

    expect(mockAppEvents.emitAndWait).toHaveBeenCalledTimes(1);
    const event = mockAppEvents.emitAndWait.mock.calls[0][0];
    expect(event.type).toBe("installment.paid");
    expect(event.payload.paymentId).toBe(PAYMENT_ID);
    expect(event.payload.caseId).toBe(CASE_ID);

    expect(mockAudit.writeAudit).toHaveBeenCalledWith(
      "system",
      "billing.zelle.auto_confirmed",
      "payments",
      PAYMENT_ID,
      expect.objectContaining({
        after: expect.objectContaining({ confirmationSource: "bank_auto" }),
      }),
    );
  });

  it("emits downpayment.confirmed when the settled installment is the down payment", async () => {
    mockRepo.callApplyZelleAutoPayment.mockResolvedValue({
      applied: true,
      payment_id: PAYMENT_ID,
      case_id: CASE_ID,
    });
    const downpayment = { ...payableInstallment, is_downpayment: true, number: 0 };
    mockRepo.findInstallmentById
      .mockResolvedValueOnce(downpayment)
      .mockResolvedValueOnce({ ...downpayment, status: "paid" });

    await applyBankVerifiedZellePayment(input);

    expect(mockAppEvents.emitAndWait.mock.calls[0][0].type).toBe("downpayment.confirmed");
  });

  it("rejects malformed input (zod) before touching anything", async () => {
    await expect(
      applyBankVerifiedZellePayment({ ...input, notificationId: "not-a-uuid" }),
    ).rejects.toThrow();
    expect(mockRepo.callApplyZelleAutoPayment).not.toHaveBeenCalled();
  });
});
