/**
 * Billing module — service layer (F2 minimum).
 *
 * F2 scope: createPaymentPlan, registerZellePayment (direct registration),
 * getPaymentPlanForCase.
 *
 * Stripe flows (Checkout Sessions, webhook consumption) are F5.
 *
 * @module billing/service
 */

import { z } from "zod";

import { can, requireCaseAccess } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import { buildInstallments } from "./domain";
import {
  findPlanByContractId,
  findPlanByCaseId,
  insertPaymentPlan,
  insertInstallments,
  findInstallmentById,
  updateInstallment,
  insertPayment,
  updatePayment,
  findInstallmentCaseId,
  type PaymentPlanRow,
  type InstallmentRow,
} from "./repository";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class BillingError extends Error {
  constructor(
    public readonly code:
      | "PAYMENT_PLAN_INVALID"
      | "PAYMENT_PLAN_EXISTS"
      | "INSTALLMENT_NOT_FOUND"
      | "INSTALLMENT_NOT_PAYABLE"
      | "INSTALLMENT_ALREADY_PAID"
      | "PAYMENT_NOT_PENDING"
      | "AMOUNT_MISMATCH"
      | "REJECTION_REASON_REQUIRED",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "BillingError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function writeBillingTimeline(entry: {
  caseId: string;
  eventType: string;
  titleI18n: { en: string; es: string };
  visibleToClient: boolean;
}): Promise<void> {
  await appendCaseTimeline({
    caseId: entry.caseId,
    eventType: entry.eventType,
    actorKind: "system",
    actorUserId: null,
    titleI18n: entry.titleI18n,
    icon: "dollar-sign",
    color: "green",
    visibleToClient: entry.visibleToClient,
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// createPaymentPlan — called by cases.createCaseFromContract
// ---------------------------------------------------------------------------

const CreatePaymentPlanSchema = z.object({
  contractId: z.string().uuid(),
  totalCents: z.number().int().positive(),
  downpaymentCents: z.number().int().positive(),
  installmentCount: z.number().int().min(1),
  notes: z.string().nullable().optional(),
});

export type CreatePaymentPlanInput = z.infer<typeof CreatePaymentPlanSchema>;

/**
 * Creates a payment plan with installments for a contract.
 *
 * Called by cases.createCaseFromContract — actor must have cases:edit permission.
 * Idempotency: throws if a plan already exists for the contract.
 *
 * @api-id API-BIL-01 (internal, called from cases module)
 */
export async function createPaymentPlan(
  actor: Actor,
  input: CreatePaymentPlanInput,
): Promise<PaymentPlanRow> {
  can(actor, "cases", "edit");
  const parsed = CreatePaymentPlanSchema.parse(input);

  // Validation (DOC-44 §3.1)
  if (
    parsed.downpaymentCents <= 0 ||
    parsed.downpaymentCents > parsed.totalCents ||
    parsed.installmentCount < 1 ||
    (parsed.installmentCount === 1 &&
      parsed.downpaymentCents !== parsed.totalCents)
  ) {
    throw new BillingError("PAYMENT_PLAN_INVALID");
  }

  // Idempotency: 1 contract = 1 plan
  const existing = await findPlanByContractId(parsed.contractId);
  if (existing) throw new BillingError("PAYMENT_PLAN_EXISTS");

  const plan = await insertPaymentPlan({
    contract_id: parsed.contractId,
    total_cents: parsed.totalCents,
    downpayment_cents: parsed.downpaymentCents,
    installment_count: parsed.installmentCount,
    notes: parsed.notes ?? null,
  });

  // Build installment drafts (provisional dates — re-anchored on contract.signed)
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const drafts = buildInstallments({
    totalCents: parsed.totalCents,
    downpaymentCents: parsed.downpaymentCents,
    installmentCount: parsed.installmentCount,
    startDate: today,
  });

  const installmentRows = drafts.map((d) => ({
    payment_plan_id: plan.id,
    number: d.number,
    amount_cents: d.amountCents,
    due_date: d.dueDate,
    status: "pending" as const,
    is_downpayment: d.isDownpayment,
    paid_at: null,
    waived_by: null,
    waived_reason: null,
    last_reminder_at: null,
  }));

  await insertInstallments(installmentRows);

  return plan;
}

// ---------------------------------------------------------------------------
// registerZellePayment — direct registration by finance (RF-AND-012)
// ---------------------------------------------------------------------------

const RegisterZelleSchema = z.object({
  installmentId: z.string().uuid(),
  /** Optional proof path if uploaded separately; not required for direct registration */
  zelleProofPath: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type RegisterZellePaymentInput = z.infer<typeof RegisterZelleSchema>;

/**
 * Directly registers a Zelle payment (finance staff, RF-AND-012).
 *
 * No prior proof upload required. Calls applyPaymentSuccess internally.
 * Emits downpayment.confirmed if the installment is the downpayment.
 *
 * @api-id API-BIL-08 (cases:edit permission per DOC-48)
 */
export async function registerZellePayment(
  actor: Actor,
  input: RegisterZellePaymentInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = RegisterZelleSchema.parse(input);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  if (installment.status === "paid") {
    throw new BillingError("INSTALLMENT_ALREADY_PAID");
  }

  if (!["pending", "overdue"].includes(installment.status)) {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

  const caseId = await findInstallmentCaseId(parsed.installmentId);

  // Create payment record
  const payment = await insertPayment({
    installment_id: installment.id,
    method: "zelle",
    status: "pending",
    amount_cents: installment.amount_cents,
    payer_user_id: actor.userId,
    confirmed_by: actor.userId,
    confirmed_at: new Date().toISOString(),
    zelle_proof_path: parsed.zelleProofPath ?? null,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
  });

  // Apply payment success (mark installment paid, emit events)
  await applyPaymentSuccess(payment, installment, caseId, actor.userId);

  await writeAudit(
    actor,
    "billing.zelle.registered",
    "payments",
    payment.id,
    { after: { installmentId: installment.id, amountCents: installment.amount_cents } },
  );
}

// ---------------------------------------------------------------------------
// applyPaymentSuccess — shared confirmation path
// ---------------------------------------------------------------------------

/**
 * Marks a payment as succeeded, updates installment to paid, emits events.
 *
 * Internal helper — not exported.
 */
async function applyPaymentSuccess(
  payment: import("./repository").PaymentRow,
  installment: InstallmentRow,
  caseId: string | null,
  confirmedBy: string,
): Promise<void> {
  // Idempotency: if installment is already paid, skip
  if (installment.status === "paid") {
    return;
  }

  await updatePayment(payment.id, {
    status: "succeeded",
    confirmed_by: confirmedBy,
    confirmed_at: new Date().toISOString(),
  });

  await updateInstallment(installment.id, {
    status: "paid",
    paid_at: new Date().toISOString(),
  });

  if (!caseId) return;

  // Emit domain event
  if (installment.is_downpayment) {
    appEvents.emit({
      type: "downpayment.confirmed",
      payload: {
        caseId,
        installmentId: installment.id,
        paymentId: payment.id,
        amountCents: payment.amount_cents,
        method: payment.method,
      },
      occurredAt: new Date(),
    });
  } else {
    appEvents.emit({
      type: "installment.paid",
      payload: {
        caseId,
        installmentId: installment.id,
        paymentId: payment.id,
        number: installment.number,
        amountCents: payment.amount_cents,
        method: payment.method,
      },
      occurredAt: new Date(),
    });
  }

  await writeBillingTimeline({
    caseId,
    eventType: "payment.received",
    titleI18n: {
      en: installment.is_downpayment
        ? "Down payment received"
        : `Payment #${installment.number} received`,
      es: installment.is_downpayment
        ? "Pago inicial recibido"
        : `Pago #${installment.number} recibido`,
    },
    visibleToClient: true,
  });
}

// ---------------------------------------------------------------------------
// getPaymentPlanForCase — read
// ---------------------------------------------------------------------------

/**
 * Returns the payment plan with installments for a case.
 *
 * @api-id API-BIL-02
 */
export async function getPaymentPlanForCase(
  actor: Actor,
  caseId: string,
): Promise<(PaymentPlanRow & { installments: InstallmentRow[] }) | null> {
  await requireCaseAccess(actor, caseId);
  return findPlanByCaseId(caseId);
}
