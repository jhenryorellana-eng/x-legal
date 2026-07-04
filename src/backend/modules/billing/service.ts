/**
 * Billing module — service layer.
 *
 * F2 scope: createPaymentPlan, registerZellePayment, getPaymentPlanForCase.
 * F6-Ola1 additions: createCheckoutSessionForInstallment, handleStripeEvent,
 *   applyPaymentFailure, applyRefund, submitZelleProof, confirmZellePayment,
 *   rejectZelleProof, getAccountStatement, onContractSigned.
 *
 * @module billing/service
 */

import { z } from "zod";

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { env } from "@/backend/platform/env";
import { logger } from "@/backend/platform/logger";
import { getStripe } from "@/backend/platform/stripe";
import { createServiceClient } from "@/backend/platform/supabase";
import { validateUploadedObject, createSignedUploadUrl, createSignedDownloadUrl } from "@/backend/platform/storage";
import { limitBillingCheckout, limitBillingUploadUrl } from "@/backend/platform/ratelimit";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import {
  buildInstallments,
  reanchorDueDates,
  isOverdue,
  daysLate,
  canTransitionInstallment,
  validateLedgerEntry,
  monthRange,
  previousMonth,
  PAYABLE_STATUSES,
  type PaymentFrequency,
} from "./domain";
import { enqueueJob } from "@/backend/platform/qstash";
import {
  insertNotificationIdempotent,
  findUserById,
} from "@/backend/modules/notifications";
import {
  findPlanByContractId,
  findPlanByCaseId,
  insertPaymentPlan,
  insertInstallments,
  findInstallmentById,
  updateInstallment,
  listInstallmentsForPlan,
  insertPayment,
  updatePayment,
  findPaymentById,
  findPendingZellePayment,
  findInstallmentCaseId,
  getAccountStatement as repoGetAccountStatement,
  findActiveStripePayment,
  listOrphanStripePayments,
  listPendingStripeSessionsToReconcile,
  findOrphanStripePaymentForInstallment,
  findPaymentByIntentId,
  findPaymentBySessionId,
  findStripeCustomer,
  upsertStripeCustomer,
  listPendingIntentPaymentsToReconcile,
  upsertStripeCustomerCard,
  findUserByStripeCustomerId,
  findPaymentPlanById,
  findCaseIdForPlan,
  findPlanIdByCaseId,
  findPlanClientUserId,
  updatePaymentPlanAutopay,
  listAutopayChargeTargets,
  countFailedAutopayPayments,
  insertLedgerIfAbsent,
  listOverdueUniverse,
  listReminderTargets as repoListReminderTargets,
  listDueCalendar as repoListDueCalendar,
  listOverdueForCollections as repoListOverdueForCollections,
  collectionMetrics as repoCollectionMetrics,
  insertLedgerEntry,
  findLedgerEntryById,
  updateLedgerEntryRow,
  listLedger as repoListLedger,
  monthlyLedgerSummary,
  findCaseClientUserId,
  type PaymentPlanRow,
  type InstallmentRow,
  type PaymentRow,
  type AccountStatementDto,
  type LedgerItemRepo,
} from "./repository";

// Re-export AccountStatementDto so index.ts can pick it up without importing repository
export type { AccountStatementDto };

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class BillingError extends Error {
  constructor(
    public readonly code:
      // F2 codes
      | "PAYMENT_PLAN_INVALID"
      | "PAYMENT_PLAN_EXISTS"
      | "INSTALLMENT_NOT_FOUND"
      | "INSTALLMENT_NOT_PAYABLE"
      | "INSTALLMENT_ALREADY_PAID"
      | "PAYMENT_NOT_PENDING"
      | "AMOUNT_MISMATCH"
      | "REJECTION_REASON_REQUIRED"
      // F6-Ola1 additions (DOC-44 §6)
      | "PAYMENT_IN_PROGRESS"
      | "PROOF_ALREADY_SUBMITTED"
      | "PROOF_INVALID_FILE"
      | "PROOF_NOT_FOUND"
      | "INSTALLMENT_NOT_WAIVABLE"
      | "WAIVE_REASON_REQUIRED"
      | "WAIVE_REQUIRES_ADMIN"
      | "INSTALLMENT_NOT_RESCHEDULABLE"
      | "DUE_DATE_INVALID"
      | "REFUND_NOT_ALLOWED"
      | "LEDGER_AMOUNT_INVALID"
      | "LEDGER_CATEGORY_REQUIRED"
      | "LEDGER_ENTRY_NOT_EDITABLE"
      // F6-Ola3 (contabilidad + recordatorio manual)
      | "LEDGER_ENTRY_NOT_FOUND"
      | "REMINDER_TOO_SOON"
      // Rate limiting (HIGH-3)
      | "RATE_LIMITED"
      // Autopay (DOC-71 §2.4)
      | "PAYMENT_PLAN_NOT_FOUND"
      | "AUTOPAY_NO_CARD"
      | "AUTOPAY_STAFF_CANNOT_ENABLE",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "BillingError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function nowIso(): string {
  return new Date().toISOString();
}

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

/**
 * Marks a webhook event with an error in webhook_events.
 * Uses raw upsert since we don't have the claimWebhookEvent signature here
 * and the Stripe webhook route already handles the initial insert.
 */
async function markWebhookError(
  source: string,
  idempotencyKey: string,
  errorMsg: string,
): Promise<void> {
  const supabase = createServiceClient();
  try {
    await supabase
      .from("webhook_events")
      .update({ error: errorMsg })
      .eq("source", source)
      .eq("idempotency_key", idempotencyKey);
  } catch (err) {
    logger.warn({ err, source, idempotencyKey }, "billing: failed to write webhook error");
  }
}

// ---------------------------------------------------------------------------
// applyPaymentSuccess — shared confirmation path (private)
// ---------------------------------------------------------------------------

/**
 * Marks a payment as succeeded, inserts ledger entry, then marks installment
 * paid. Emits domain event.
 *
 * DOC-44 §3.4. Called by: registerZellePayment, confirmZellePayment,
 * handleStripeEvent checkout.session.completed / payment_intent.succeeded.
 *
 * Guards:
 *   - If installment is already paid: no-op (idempotent, invariant I5).
 *     This guard is safe because the ledger MUST be inserted before the
 *     installment is marked paid — so if we see status="paid" here the
 *     ledger is guaranteed to exist already.
 *   - Ledger insert is idempotent via insertLedgerIfAbsent.
 *
 * Order (crash-safe — BLOCKER-1):
 *   1. updatePayment (status=succeeded)
 *   2. insertLedgerIfAbsent  ← BEFORE updateInstallment(paid)
 *   3. updateInstallment (status=paid)
 *
 * Rationale: if the process crashes between steps 2 and 3, a Stripe retry
 * arrives, claimWebhookEvent returns "retry", and we re-enter here.
 * installment.status is still "pending" (not "paid") so the guard does NOT
 * cut early — we redo steps 1-3 safely (all three are idempotent).
 * If crash happened between steps 1 and 2 (ledger missing), the guard also
 * does not cut because installment is still "pending" — ledger gets inserted.
 * Only after step 3 completes does the guard take effect on future retries.
 *
 * orgId parameter: MUST derive from findOrgIdForCase (BD-authoritative).
 * Never pass orgId from Stripe metadata directly (MED-3).
 */
async function applyPaymentSuccess(
  payment: PaymentRow,
  installment: InstallmentRow,
  caseId: string | null,
  orgId: string | null,
  confirmedBy?: string,
): Promise<void> {
  // Idempotency guard: installment already paid → no-op (I5).
  // Safe because ledger is always inserted BEFORE installment→paid (see order above).
  if (installment.status === "paid") {
    logger.info(
      { installmentId: installment.id, paymentId: payment.id },
      "billing.applyPaymentSuccess: installment already paid — skipping (idempotent)",
    );
    return;
  }

  // Step 1: mark payment succeeded
  await updatePayment(payment.id, {
    status: "succeeded",
    confirmed_by: confirmedBy ?? null,
    confirmed_at: nowIso(),
  });

  // Step 2: ledger entry (income, 'cuota') — BEFORE installment→paid (crash-safe)
  // orgId derives from BD (findOrgIdForCase) — never from Stripe metadata (MED-3)
  if (caseId && orgId) {
    await insertLedgerIfAbsent({
      paymentId: payment.id,
      kind: "income",
      category: "cuota",
      amountCents: payment.amount_cents,
      caseId,
      entryDate: todayIso(),
      orgId,
    });
  }

  // Step 3: mark installment paid — AFTER ledger (crash-safe guard relies on this order)
  await updateInstallment(installment.id, {
    status: "paid",
    paid_at: nowIso(),
  });

  if (!caseId) return;

  // Emit domain event
  if (installment.is_downpayment) {
    await appEvents.emitAndWait({
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
    await appEvents.emitAndWait({
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
// applyPaymentFailure — webhook failed/expired event handler (private)
// ---------------------------------------------------------------------------

async function applyPaymentFailure(
  payment: PaymentRow,
  installment: InstallmentRow,
): Promise<void> {
  await updatePayment(payment.id, { status: "failed" });

  // Revert cuota to pending or overdue depending on due_date
  const today = todayIso();
  const nextStatus = isOverdue({ status: installment.status, due_date: installment.due_date }, today)
    ? "overdue"
    : "pending";

  await updateInstallment(installment.id, { status: nextStatus });
}

// ---------------------------------------------------------------------------
// applyRefund — charge.refunded webhook handler (private)
// ---------------------------------------------------------------------------

async function applyRefund(
  payment: PaymentRow,
  installment: InstallmentRow,
  caseId: string | null,
  orgId: string | null,
  refundedCents: number,
  webhookSource: string,
  webhookKey: string,
): Promise<void> {
  // Guard: only refund a succeeded payment (DOC-44 §3.8)
  if (payment.status !== "succeeded") {
    await markWebhookError(webhookSource, webhookKey, "REFUND_NOT_ALLOWED: payment not succeeded");
    return;
  }

  await updatePayment(payment.id, { status: "refunded" });

  // Installment reverts to pending (DOC-71 §4.2); cron handles overdue next day
  await updateInstallment(installment.id, { status: "pending", paid_at: null });

  // A refunded AUTOPAY charge means staff intervened (dispute/agreement) —
  // never let the charge cron re-collect the reverted cuota automatically.
  if (payment.autopay && installment.payment_plan_id) {
    await disableAutopayForPlan(installment.payment_plan_id, "refund_issued");
    if (caseId && orgId) {
      await appEvents.emitAndWait({
        type: "autopay.disabled",
        payload: {
          caseId,
          orgId,
          planId: installment.payment_plan_id,
          installmentId: installment.id,
          reason: "refund_issued",
        },
        occurredAt: new Date(),
      });
    }
  }

  // Ledger entry (expense, 'reembolso') — idempotent
  if (caseId && orgId) {
    await insertLedgerIfAbsent({
      paymentId: payment.id,
      kind: "expense",
      category: "reembolso",
      amountCents: refundedCents,
      caseId,
      entryDate: todayIso(),
      orgId,
    });
  }

  if (!caseId) return;

  await appEvents.emitAndWait({
    type: "payment.refunded",
    payload: {
      caseId,
      installmentId: installment.id,
      paymentId: payment.id,
      amountCents: refundedCents,
    },
    occurredAt: new Date(),
  });

  await writeBillingTimeline({
    caseId,
    eventType: "payment.refunded",
    titleI18n: {
      en: `Payment #${installment.number} refunded`,
      es: `Pago #${installment.number} reembolsado`,
    },
    visibleToClient: true,
  });
}

// ---------------------------------------------------------------------------
// Stripe customer resolution helper
// ---------------------------------------------------------------------------

async function resolveStripeCustomer(userId: string): Promise<string> {
  const stripe = getStripe();
  const existing = await findStripeCustomer(userId);
  if (existing) {
    // Validate the stored customer still exists under the CURRENT Stripe keys.
    // A test-mode customer id is invalid once live keys are in use (and vice-versa),
    // and a customer can be deleted in the Dashboard. In those cases recreate it
    // transparently so the checkout never fails with "No such customer" — this makes
    // the test↔live switch (and Dashboard cleanups) safe without any manual DB surgery.
    try {
      const c = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!c.deleted) return existing.stripe_customer_id;
    } catch (err) {
      logger.warn(
        { userId, customerId: existing.stripe_customer_id, err },
        "billing: stored Stripe customer not usable under current keys — recreating",
      );
    }
    // fall through → create a fresh customer; upsert overwrites the stale mapping
    // (stripe_customers.user_id is the PK, so this UPDATEs the existing row).
  }

  // Fetch user info to populate the customer
  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("email, phone_e164")
    .eq("id", userId)
    .maybeSingle();

  const customer = await stripe.customers.create({
    metadata: { user_id: userId },
    ...(user?.email ? { email: user.email } : {}),
    ...(user?.phone_e164 ? { phone: user.phone_e164 } : {}),
  });

  await upsertStripeCustomer(userId, customer.id);
  return customer.id;
}

// ---------------------------------------------------------------------------
// createPaymentPlan — called by cases.createCaseFromContract
// ---------------------------------------------------------------------------

const CreatePaymentPlanSchema = z.object({
  contractId: z.string().uuid(),
  totalCents: z.number().int().positive(),
  downpaymentCents: z.number().int().positive(),
  installmentCount: z.number().int().min(1),
  frequency: z.enum(["weekly", "monthly"]).default("monthly"),
  notes: z.string().nullable().optional(),
});

export type CreatePaymentPlanInput = z.infer<typeof CreatePaymentPlanSchema>;

/**
 * Creates a payment plan with installments for a contract.
 *
 * Called by cases.createCaseFromContract — actor must have cases:edit permission.
 * Idempotency: throws if a plan already exists for the contract.
 */
export async function createPaymentPlan(
  actor: Actor,
  input: CreatePaymentPlanInput,
): Promise<PaymentPlanRow> {
  can(actor, "cases", "edit");
  const parsed = CreatePaymentPlanSchema.parse(input);

  // Validation (DOC-44 §2.1 + I2)
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
    frequency: parsed.frequency,
    notes: parsed.notes ?? null,
  });

  // Build installment drafts (provisional dates — re-anchored on contract.signed)
  const today = todayIso();
  const drafts = buildInstallments({
    totalCents: parsed.totalCents,
    downpaymentCents: parsed.downpaymentCents,
    installmentCount: parsed.installmentCount,
    startDate: today,
    frequency: parsed.frequency,
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
  zelleProofPath: z.string().min(1),
  notes: z.string().nullable().optional(),
});

export type RegisterZellePaymentInput = z.infer<typeof RegisterZelleSchema>;

/**
 * Directly registers a Zelle payment (finance staff, RF-AND-012).
 * The proof is mandatory (Henry 2026-07-02): staff uploads the comprobante via
 * getZelleProofUploadUrl first, then registers+confirms in one step.
 * Calls applyPaymentSuccess internally.
 */
export async function registerZellePayment(
  actor: Actor,
  input: RegisterZellePaymentInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = RegisterZelleSchema.parse(input);

  // CRITICAL-1 (complementary): cross-org guard for mutations that bypass requireCaseAccess
  await requireInstallmentOrg(actor, parsed.installmentId);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");
  if (installment.status === "paid") throw new BillingError("INSTALLMENT_ALREADY_PAID");
  if (!PAYABLE_STATUSES.includes(installment.status as "pending" | "overdue")) {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

  // Server-side file validation (DOC-30 §14) — same guarantee as the client path
  const validationResult = await validateUploadedObject(
    "payment-proofs",
    parsed.zelleProofPath,
    "payment-proofs",
  );
  if (!validationResult.ok) throw new BillingError("PROOF_INVALID_FILE", { reason: validationResult.reason });

  const caseId = await findInstallmentCaseId(parsed.installmentId);
  const orgId = await findOrgIdForCase(caseId);

  const payment = await insertPayment({
    installment_id: installment.id,
    method: "zelle",
    status: "pending",
    amount_cents: installment.amount_cents,
    payer_user_id: actor.userId,
    confirmed_by: actor.userId,
    confirmed_at: nowIso(),
    zelle_proof_path: parsed.zelleProofPath,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
  });

  await applyPaymentSuccess(payment, installment, caseId, orgId, actor.userId);

  await writeAudit(
    actor,
    "billing.zelle.registered",
    "payments",
    payment.id,
    {
      after: {
        installmentId: installment.id,
        amountCents: installment.amount_cents,
        notes: parsed.notes ?? null,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// getPaymentPlanForCase — read (F2)
// ---------------------------------------------------------------------------

export async function getPaymentPlanForCase(
  actor: Actor,
  caseId: string,
): Promise<(PaymentPlanRow & { installments: InstallmentRow[] }) | null> {
  await requireCaseAccess(actor, caseId);
  return findPlanByCaseId(caseId);
}

// ---------------------------------------------------------------------------
// createCheckoutSessionForInstallment — F6-Ola1 (DOC-44 §3.2 / DOC-71 §1-2)
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Checkout Session for an installment.
 *
 * Caller is responsible for authorization:
 *   - Cliente: requireCaseAccess(actor, caseId)
 *   - Staff:   can(actor, 'billing', 'edit')
 *
 * Returns { url } to redirect the payer to Stripe Checkout.
 */
export async function createCheckoutSessionForInstallment(
  actor: Actor,
  installmentId: string,
  opts?: { enrollAutopay?: boolean },
): Promise<{ url: string }> {
  const installment = await findInstallmentById(installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  // Authorization: clients check case access (fail-closed — HIGH-2); staff check billing:edit
  const caseId = await findInstallmentCaseId(installmentId);
  if (actor.kind === "client") {
    // Fail-closed: if installment has no case_id, client cannot be verified → forbid
    if (!caseId) throw new AuthzError("forbidden_case");
    await requireCaseAccess(actor, caseId);
  } else {
    can(actor, "billing", "edit");
  }

  // HIGH-3: rate limit checkout creation (5/min per userId, fail-open). Placed in
  // the service so it protects BOTH call-sites — the client inline action in
  // pagos/page.tsx AND the staff API-BIL-01 action — same pattern as
  // limitBillingUploadUrl in getZelleProofUploadUrl.
  const rl = await limitBillingCheckout(actor.userId);
  if (!rl.allowed) throw new BillingError("RATE_LIMITED");

  if (installment.status === "paid") throw new BillingError("INSTALLMENT_ALREADY_PAID");
  if (!PAYABLE_STATUSES.includes(installment.status as "pending" | "overdue")) {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

  const payerUserId = actor.userId;
  const stripeCustomerId = await resolveStripeCustomer(payerUserId);

  // Autopay opt-in (DOC-71 §2.4): only the CLIENT can consent to saving their
  // card — a staff-generated checkout never enrolls on the client's behalf.
  const enrollAutopay = opts?.enrollAutopay === true && actor.kind === "client";

  // Resolve plan info for product name
  const orgId = await findOrgIdForCase(caseId);
  const caseNumber = await findCaseNumber(caseId);
  const planTotal = installment.payment_plan_id
    ? await findInstallmentCountForPlan(installment.payment_plan_id)
    : null;

  // Lazy cleanup (Ola-2 fix): if a prior attempt orphaned a pending/stripe row
  // (insert succeeded but stripe.checkout.sessions.create threw → session_id stayed
  // null), expire it so this retry is not blocked by payments_active_stripe_unique_idx.
  // 5-min floor avoids racing a genuine concurrent checkout, whose session is created
  // within seconds. Older session_id-null rows are unambiguously orphans.
  const orphanCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const orphan = await findOrphanStripePaymentForInstallment(installmentId, orphanCutoff);
  if (orphan) {
    await updatePayment(orphan.id, { status: "failed" });
  }

  // BLOCKER-2: Insert the payment row BEFORE calling Stripe — the BD is the mutex.
  // The unique partial index payments_active_stripe_unique_idx
  // (installment_id WHERE status='pending' AND method='stripe') prevents a second
  // concurrent checkout from being created. If the insert conflicts (23505), throw
  // PAYMENT_IN_PROGRESS. This replaces the previous findActiveStripePayment TOCTOU check.
  let localPayment: PaymentRow;
  try {
    localPayment = await insertPayment({
      installment_id: installmentId,
      method: "stripe",
      status: "pending",
      amount_cents: installment.amount_cents,
      payer_user_id: payerUserId,
      stripe_checkout_session_id: null, // filled after Stripe session is created
      stripe_payment_intent_id: null,   // filled by webhook
      confirmed_by: null,
      confirmed_at: null,
      zelle_proof_path: null,
    });
  } catch (err) {
    // Unique index conflict (23505) = concurrent checkout in progress
    if ((err as { code?: string }).code === "23505") {
      throw new BillingError("PAYMENT_IN_PROGRESS");
    }
    throw err;
  }

  // NOTE: if stripe.checkout.sessions.create throws AFTER the insert above, the
  // payment row is orphaned (pending/stripe, session_id=null). Two safety nets clear
  // it: (1) the lazy cleanup at the top of this function (next retry, 5-min floor),
  // and (2) the expire-stale-checkouts cron (expireOrphanCheckouts, hourly, 60-min).
  const stripe = getStripe();
  const expiresAt = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: stripeCustomerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          // CRITICAL: amount ALWAYS from DB (DOC-71 §7)
          unit_amount: installment.amount_cents,
          product_data: {
            name: `Cuota ${installment.number}${planTotal ? ` de ${planTotal}` : ""} — ${caseNumber ?? "Caso"}`,
          },
        },
        quantity: 1,
      },
    ],
    client_reference_id: installmentId,
    metadata: {
      installment_id: installmentId,
      case_id: caseId ?? "",
      org_id: orgId ?? "",
      ...(enrollAutopay ? { autopay_optin: "1" } : {}),
    },
    payment_intent_data: {
      // off_session future usage = Stripe collects the mandate during this
      // interactive payment so later autopay charges (MIT) are authorized.
      ...(enrollAutopay ? { setup_future_usage: "off_session" as const } : {}),
      metadata: {
        installment_id: installmentId,
        case_id: caseId ?? "",
        org_id: orgId ?? "",
        ...(enrollAutopay ? { autopay_optin: "1" } : {}),
      },
    },
    expires_at: expiresAt,
    success_url: `${env.NEXT_PUBLIC_APP_URL}/pagos/confirmacion?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/pagos`,
    locale: "auto",
  });

  if (!session.url) throw new Error("billing: Stripe session has no URL");

  // Now patch the local payment row with the session id (STRONG-2: use localPayment.id)
  await updatePayment(localPayment.id, { stripe_checkout_session_id: session.id });

  await updateInstallment(installmentId, { status: "processing" });

  if (actor.kind === "staff") {
    await writeAudit(actor, "billing.checkout.created", "installments", installmentId, {
      after: { sessionId: session.id },
    });
  }

  return { url: session.url };
}

// ---------------------------------------------------------------------------
// Autopay (DOC-71 §2.4) — card capture + consent
// ---------------------------------------------------------------------------

export type AutopayDisabledReason =
  | "card_declined_max_retries"
  | "authentication_required"
  | "customer_request"
  | "staff_request"
  | "refund_issued";

/**
 * Retrieves the payment method from Stripe and persists brand/last4/exp on
 * stripe_customers as the user's default saved card.
 */
async function persistSavedCardFromPaymentMethod(
  userId: string,
  paymentMethodId: string,
): Promise<void> {
  const stripe = getStripe();
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  await upsertStripeCustomerCard(userId, {
    paymentMethodId,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
  });
}

/**
 * Enables autopay on a plan, recording the client's consent. The consent is
 * persisted HERE — after the payment/enrollment is confirmed by Stripe — never
 * at checkbox time (DOC-71 §2.4). Idempotent; timeline only on the OFF→ON edge.
 */
async function enableAutopayForPlan(planId: string, consentUserId: string): Promise<void> {
  const plan = await findPaymentPlanById(planId);
  const wasEnabled = plan?.autopay_enabled === true;

  await updatePaymentPlanAutopay(planId, {
    autopay_enabled: true,
    autopay_consented_at: nowIso(),
    autopay_consent_by: consentUserId,
    autopay_disabled_reason: null,
  });

  if (!wasEnabled) {
    const caseId = await findCaseIdForPlan(planId);
    if (caseId) {
      await writeBillingTimeline({
        caseId,
        eventType: "autopay.enabled",
        titleI18n: {
          en: "Automatic card payments enabled",
          es: "Cobro automático con tarjeta activado",
        },
        visibleToClient: true,
      });
    }
  }
}

/** Disables autopay on a plan with a reason + timeline (idempotent). */
async function disableAutopayForPlan(
  planId: string,
  reason: AutopayDisabledReason,
): Promise<void> {
  const plan = await findPaymentPlanById(planId);
  const wasEnabled = plan?.autopay_enabled === true;

  await updatePaymentPlanAutopay(planId, {
    autopay_enabled: false,
    autopay_disabled_reason: reason,
  });

  if (wasEnabled) {
    const caseId = await findCaseIdForPlan(planId);
    if (caseId) {
      await writeBillingTimeline({
        caseId,
        eventType: "autopay.disabled",
        titleI18n: {
          en: "Automatic card payments disabled",
          es: "Cobro automático con tarjeta desactivado",
        },
        visibleToClient: true,
      });
    }
  }
}

/**
 * Creates a Checkout Session in mode="setup" so the client can save a card
 * WITHOUT being charged (paid the downpayment via Zelle, or wants to replace
 * the card). Clients only — staff cannot enroll a card on someone's behalf.
 */
export async function createSetupCheckoutSession(
  actor: Actor,
  caseId: string,
): Promise<{ url: string }> {
  if (actor.kind !== "client") throw new AuthzError("wrong_kind");
  await requireCaseAccess(actor, caseId);

  const rl = await limitBillingCheckout(actor.userId);
  if (!rl.allowed) throw new BillingError("RATE_LIMITED");

  const planId = await findPlanIdByCaseId(caseId);
  if (!planId) throw new BillingError("PAYMENT_PLAN_NOT_FOUND");

  const orgId = await findOrgIdForCase(caseId);
  const stripeCustomerId = await resolveStripeCustomer(actor.userId);

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "setup",
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    metadata: {
      purpose: "autopay_enroll",
      payment_plan_id: planId,
      case_id: caseId,
      org_id: orgId ?? "",
    },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/pagos/confirmacion?setup_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/pagos`,
    locale: "auto",
  });

  if (!session.url) throw new Error("billing: Stripe setup session has no URL");
  return { url: session.url };
}

/** Saved-card summary for the payments UI (never exposes the PM id). */
export interface SavedCardDto {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
}

/**
 * Returns the actor's own saved card (clients only — staff have no card here).
 * Null when no card is enrolled.
 */
export async function getSavedCard(actor: Actor): Promise<SavedCardDto | null> {
  if (actor.kind !== "client") return null;
  const customer = await findStripeCustomer(actor.userId);
  if (!customer?.default_payment_method_id) return null;
  return {
    brand: customer.card_brand,
    last4: customer.card_last4,
    expMonth: customer.card_exp_month,
    expYear: customer.card_exp_year,
  };
}

const SetAutopaySchema = z.object({
  planId: z.string().uuid(),
  enabled: z.boolean(),
});

export type SetAutopayInput = z.infer<typeof SetAutopaySchema>;

/**
 * Toggles autopay consent on a plan. Clients (case members) may enable —
 * requires a saved card — and disable; staff (billing:edit) may only disable
 * (consent belongs to the client, DOC-71 §2.4).
 */
export async function setAutopay(
  actor: Actor,
  input: SetAutopayInput,
): Promise<void> {
  const parsed = SetAutopaySchema.parse(input);

  const plan = await findPaymentPlanById(parsed.planId);
  if (!plan) throw new BillingError("PAYMENT_PLAN_NOT_FOUND");

  const caseId = await findCaseIdForPlan(parsed.planId);

  if (actor.kind === "client") {
    if (!caseId) throw new AuthzError("forbidden_case");
    await requireCaseAccess(actor, caseId);

    if (parsed.enabled) {
      const customer = await findStripeCustomer(actor.userId);
      if (!customer?.default_payment_method_id) {
        throw new BillingError("AUTOPAY_NO_CARD");
      }
      await enableAutopayForPlan(parsed.planId, actor.userId);
    } else {
      await disableAutopayForPlan(parsed.planId, "customer_request");
    }
    return;
  }

  // Staff: billing:edit + same-org guard (CRITICAL-1 pattern)
  can(actor, "billing", "edit");
  const orgId = await findOrgIdForCase(caseId);
  if (orgId && orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");

  if (parsed.enabled) throw new BillingError("AUTOPAY_STAFF_CANNOT_ENABLE");

  await disableAutopayForPlan(parsed.planId, "staff_request");
  await writeAudit(actor, "billing.autopay.disabled", "payment_plans", parsed.planId, {
    after: { reason: "staff_request" },
  });
}

/**
 * Handles a completed mode="setup" Checkout Session: persists the captured
 * payment method as the client's saved card and enables autopay on the plan.
 *
 * All identities derive from the BD (customer→user mapping, plan→client) —
 * metadata is only used for the plan pointer and is cross-checked (MED-3 spirit).
 * `webhookKey` null = called from the L2 return-URL reconcile (no webhook row).
 */
async function handleSetupSessionCompleted(
  session: import("stripe").Stripe.Checkout.Session,
  webhookKey: string | null,
): Promise<void> {
  const source = "stripe";
  const fail = async (msg: string) => {
    if (webhookKey) await markWebhookError(source, webhookKey, msg);
    else logger.warn({ sessionId: session.id }, `billing.setupSession: ${msg}`);
  };

  if (session.metadata?.purpose !== "autopay_enroll") return; // not ours — ignore
  if (session.status !== "complete") return;

  const planId = session.metadata?.payment_plan_id ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
  const setupIntentId =
    typeof session.setup_intent === "string" ? session.setup_intent : session.setup_intent?.id ?? null;

  if (!planId || !customerId || !setupIntentId) {
    await fail(`setup session ${session.id}: missing plan/customer/setup_intent`);
    return;
  }

  const userId = await findUserByStripeCustomerId(customerId);
  if (!userId) {
    await fail(`setup session ${session.id}: no user for customer ${customerId}`);
    return;
  }

  // Defense-in-depth: the metadata plan must belong to THIS customer's client.
  const planClient = await findPlanClientUserId(planId);
  if (planClient !== userId) {
    await fail(`setup session ${session.id}: plan ${planId} does not belong to customer's client`);
    return;
  }

  const stripe = getStripe();
  const seti = await stripe.setupIntents.retrieve(setupIntentId);
  const pmId =
    typeof seti.payment_method === "string" ? seti.payment_method : seti.payment_method?.id ?? null;
  if (!pmId) {
    await fail(`setup session ${session.id}: setup intent has no payment method`);
    return;
  }

  await persistSavedCardFromPaymentMethod(userId, pmId);
  await enableAutopayForPlan(planId, userId);
}

/**
 * After a PAID checkout session with the autopay opt-in flag settles, persist
 * the card used and enable autopay. Failure here must NEVER break settlement —
 * the client can always re-enroll via the mode="setup" flow.
 */
async function maybeEnrollAutopayFromPaidSession(
  session: import("stripe").Stripe.Checkout.Session,
  payment: PaymentRow,
  installment: InstallmentRow,
): Promise<void> {
  if (session.metadata?.autopay_optin !== "1") return;
  if (!payment.payer_user_id || !installment.payment_plan_id) return;

  try {
    const intentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    if (!intentId) return;

    const stripe = getStripe();
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const pmId =
      typeof intent.payment_method === "string"
        ? intent.payment_method
        : intent.payment_method?.id ?? null;
    if (!pmId) return;

    await persistSavedCardFromPaymentMethod(payment.payer_user_id, pmId);
    await enableAutopayForPlan(installment.payment_plan_id, payment.payer_user_id);
  } catch (err) {
    logger.warn(
      { err, paymentId: payment.id, sessionId: session.id },
      "billing: autopay enrollment after settle failed — payment remains settled",
    );
  }
}

export interface ChargeDueResult {
  examined: number;
  charged: number;
  failed: number;
  skipped: number;
  killSwitched: number;
}

/** Retry policy (Henry 2026-07-03): daily retry ×3, then kill-switch. */
const MAX_AUTOPAY_ATTEMPTS = 3;

interface StripeCardErrorLike {
  type?: string;
  code?: string | null;
  decline_code?: string | null;
  payment_intent?: { id?: string } | null;
}

function isStripeCardError(err: unknown): err is StripeCardErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { type?: string }).type === "StripeCardError"
  );
}

type AutopayChargeTargetRow = Awaited<ReturnType<typeof listAutopayChargeTargets>>[number];

async function emitAutopayDisabled(
  target: AutopayChargeTargetRow,
  reason: AutopayDisabledReason,
): Promise<void> {
  await appEvents.emitAndWait({
    type: "autopay.disabled",
    payload: {
      caseId: target.caseId,
      orgId: target.orgId,
      planId: target.planId,
      installmentId: target.installmentId,
      reason,
    },
    occurredAt: new Date(),
  });
}

/**
 * Failure path of one autopay charge: mark the payment failed, revert the
 * installment, then decide — SCA disables immediately (retrying off-session is
 * pointless), the 3rd decline trips the kill-switch, otherwise notify attempt N.
 */
async function handleAutopayChargeError(
  err: unknown,
  target: AutopayChargeTargetRow,
  localPayment: PaymentRow,
  installment: InstallmentRow,
  priorAttempts: number,
): Promise<void> {
  const cardError = isStripeCardError(err) ? err : null;

  // Link the PI if Stripe created one before failing — lets payment_intent.*
  // webhooks and the reconcile sweep resolve this row.
  const intentId = cardError?.payment_intent?.id ?? null;
  if (intentId) {
    await updatePayment(localPayment.id, { stripe_payment_intent_id: intentId });
  }

  await applyPaymentFailure(localPayment, installment);

  if (cardError?.code === "authentication_required") {
    await disableAutopayForPlan(target.planId, "authentication_required");
    await emitAutopayDisabled(target, "authentication_required");
    return;
  }

  const attemptNumber = priorAttempts + 1;
  if (attemptNumber >= MAX_AUTOPAY_ATTEMPTS) {
    await disableAutopayForPlan(target.planId, "card_declined_max_retries");
    await emitAutopayDisabled(target, "card_declined_max_retries");
    return;
  }

  await appEvents.emitAndWait({
    type: "autopay.charge_failed",
    payload: {
      caseId: target.caseId,
      orgId: target.orgId,
      planId: target.planId,
      installmentId: target.installmentId,
      number: target.number,
      amountCents: target.amountCents,
      attempt: attemptNumber,
      maxAttempts: MAX_AUTOPAY_ATTEMPTS,
      reason: cardError ? (cardError.decline_code ?? cardError.code ?? "card_error") : "provider_error",
    },
    occurredAt: new Date(),
  });
}

/**
 * Daily MIT charge cron (DOC-71 §2.4): charges due installments of
 * autopay-enrolled plans off-session with the client's saved card.
 *
 * Per target:
 *   1. Derived retry count (failed autopay payments) — ≥3 → kill-switch.
 *   2. Mutex FIRST: insert the payments row (BLOCKER-2 pattern; the unique
 *      partial index rejects a concurrent manual checkout / double cron run).
 *   3. PaymentIntent off_session+confirm, amount ALWAYS from BD, idempotencyKey
 *      bound to the local payment row.
 *   4. Inline settle on success (webhook stays as idempotent backstop).
 *
 * Runs daily → a failed attempt naturally retries the next day (policy ×3).
 */
export async function chargeDueInstallments(
  actor: Actor,
  todayArg?: string,
): Promise<ChargeDueResult> {
  requireSystemActor(actor);
  const today = todayArg ?? todayIso();

  const targets = await listAutopayChargeTargets(today);
  const result: ChargeDueResult = {
    examined: targets.length,
    charged: 0,
    failed: 0,
    skipped: 0,
    killSwitched: 0,
  };

  const stripe = getStripe();

  for (const target of targets) {
    try {
      // Retry counter scoped to the CURRENT consent cycle: re-enrolling a new
      // card (which stamps a fresh autopay_consented_at) resets the count, so
      // the kill-switch never fires without trying the new card at least once.
      const priorAttempts = await countFailedAutopayPayments(
        target.installmentId,
        target.autopayConsentedAt,
      );
      if (priorAttempts >= MAX_AUTOPAY_ATTEMPTS) {
        await disableAutopayForPlan(target.planId, "card_declined_max_retries");
        await emitAutopayDisabled(target, "card_declined_max_retries");
        result.killSwitched += 1;
        continue;
      }

      let localPayment: PaymentRow;
      try {
        localPayment = await insertPayment({
          installment_id: target.installmentId,
          method: "stripe",
          status: "pending",
          autopay: true,
          amount_cents: target.amountCents, // ALWAYS from BD (DOC-71 §7)
          payer_user_id: target.clientUserId,
          stripe_checkout_session_id: null,
          stripe_payment_intent_id: null,
          confirmed_by: null,
          confirmed_at: null,
          zelle_proof_path: null,
        });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") {
          // A manual checkout (or concurrent run) holds the mutex — skip.
          result.skipped += 1;
          continue;
        }
        throw err;
      }

      const installment = await findInstallmentById(target.installmentId);
      if (!installment) {
        await updatePayment(localPayment.id, { status: "failed" });
        result.skipped += 1;
        continue;
      }

      // NOTE: the installment is NOT marked "processing" before the Stripe
      // call (same invariant as the manual checkout flow): if the process dies
      // mid-call, the cuota stays pending/overdue and remains chargeable/
      // payable; the orphan sweep only has to free the payments mutex.
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount: target.amountCents,
            currency: "usd",
            customer: target.stripeCustomerId,
            payment_method: target.paymentMethodId,
            off_session: true,
            confirm: true,
            metadata: {
              installment_id: target.installmentId,
              case_id: target.caseId,
              org_id: target.orgId,
              autopay: "1",
            },
          },
          { idempotencyKey: `autopay:${localPayment.id}` },
        );

        await updatePayment(localPayment.id, { stripe_payment_intent_id: intent.id });

        if (intent.status === "succeeded") {
          await applyPaymentSuccess(localPayment, installment, target.caseId, target.orgId);
          result.charged += 1;
        } else {
          // processing / requires_capture etc. — the payment_intent.* webhook
          // and the reconcile sweep settle or fail it later. Only NOW (with a
          // live intent) is "processing" a truthful installment state.
          await updateInstallment(target.installmentId, { status: "processing" });
          logger.info(
            { intentId: intent.id, status: intent.status, installmentId: target.installmentId },
            "billing.autopay: intent not settled inline — deferred to webhook/reconcile",
          );
        }
      } catch (err) {
        result.failed += 1;
        await handleAutopayChargeError(err, target, localPayment, installment, priorAttempts);
      }
    } catch (err) {
      logger.error(
        { err, installmentId: target.installmentId },
        "billing.autopay: unexpected error on target — continuing",
      );
    }
  }

  if (result.examined > 0) {
    logger.info(
      { job: "charge-due-installments", ...result },
      "billing.autopay: run complete",
    );
  }
  return result;
}

/**
 * L2 reconcile for the mode="setup" return URL
 * (`/pagos/confirmacion?setup_session_id=…`). Retrieves the session from
 * Stripe (authoritative — never trusts client-reported state) and runs the
 * same persistence as the webhook. Idempotent and safe to poll.
 */
export async function reconcileSetupSession(
  actor: Actor,
  sessionId: string,
): Promise<{ enrolled: boolean }> {
  const stripe = getStripe();
  let session: import("stripe").Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    throw new BillingError("PAYMENT_NOT_PENDING");
  }
  if (session.mode !== "setup" || session.metadata?.purpose !== "autopay_enroll") {
    throw new BillingError("PAYMENT_NOT_PENDING");
  }

  const planId = session.metadata?.payment_plan_id ?? null;
  const caseId = planId ? await findCaseIdForPlan(planId) : null;
  if (actor.kind === "client") {
    if (!caseId) throw new AuthzError("forbidden_case");
    await requireCaseAccess(actor, caseId);
  } else {
    can(actor, "billing", "edit");
    // Same-org guard (CRITICAL-1 pattern, mirrors setAutopay): staff must not
    // reconcile enrollment sessions of another org's case.
    const orgId = await findOrgIdForCase(caseId);
    if (orgId && orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  }

  await handleSetupSessionCompleted(session, null);

  const plan = planId ? await findPaymentPlanById(planId) : null;
  return { enrolled: plan?.autopay_enabled === true };
}

// ---------------------------------------------------------------------------
// settlePaidCheckoutSession — shared confirmation path (DOC-71 §3.2 + §3.4)
// ---------------------------------------------------------------------------

/**
 * Settles a Stripe Checkout Session against its local payment if Stripe reports
 * it as paid. This is the SINGLE confirmation path shared by all three layers:
 *   1. the webhook (checkout.session.completed) — real-time,
 *   2. reconcileCheckoutSession (success_url return) — immediate on the client,
 *   3. reconcilePendingStripePayments (cron) — safety net for abandoned tabs.
 *
 * The Session passed in must come from an authoritative source (the verified
 * webhook event, or `stripe.checkout.sessions.retrieve` on the server) — never
 * from client-supplied data. Confirmation funnels through applyPaymentSuccess,
 * which is idempotent, so calling this repeatedly / from several layers is safe.
 *
 * Returns:
 *  - "settled_now"     payment confirmed by THIS call
 *  - "already_settled" installment was already paid by another layer — no-op
 *  - "not_paid"        session.payment_status !== "paid" — nothing to do yet
 *  - "no_payment"      no local payment / installment found for the session
 */
async function settlePaidCheckoutSession(
  session: import("stripe").Stripe.Checkout.Session,
): Promise<"settled_now" | "already_settled" | "not_paid" | "no_payment"> {
  if (session.payment_status !== "paid") return "not_paid";

  const payment = await resolvePaymentForSession(session);
  if (!payment) return "no_payment";

  const installment = await findInstallmentById(payment.installment_id);
  if (!installment) return "no_payment";

  // Already settled by another layer (webhook / earlier reconcile) → true no-op.
  // We skip even the intent-link write: the intent was linked when the payment
  // was first settled. Reported distinctly so the cron telemetry does not count
  // already-confirmed rows as "settled this run".
  if (installment.status === "paid") {
    // Enrollment may still be pending if the process crashed between the
    // settle and the enroll on a prior attempt — idempotent, so re-run it.
    await maybeEnrollAutopayFromPaidSession(session, payment, installment);
    return "already_settled";
  }

  // Link payment → intent INSIDE the not-yet-paid guard (consistent with the
  // applyPaymentSuccess crash-safety contract — no writes once paid).
  if (session.payment_intent && typeof session.payment_intent === "string") {
    await updatePayment(payment.id, { stripe_payment_intent_id: session.payment_intent });
  }

  const caseId = await findInstallmentCaseId(installment.id);
  // MED-3: orgId ALWAYS from BD — never from Stripe metadata (user-controlled)
  const orgId = await findOrgIdForCase(caseId);

  // applyPaymentSuccess keeps its OWN idempotency guard + insertLedgerIfAbsent
  // (23505) race protection — the early return above is an optimisation and
  // accurate telemetry, NOT the safety mechanism against concurrent layers.
  await applyPaymentSuccess(payment, installment, caseId, orgId);

  // Autopay opt-in: enroll AFTER the money is settled (never blocks settlement).
  await maybeEnrollAutopayFromPaidSession(session, payment, installment);
  return "settled_now";
}

// ---------------------------------------------------------------------------
// handleStripeEvent — webhook dispatcher (DOC-71 §3.2)
// ---------------------------------------------------------------------------

/**
 * Dispatches a verified Stripe event to the appropriate internal handler.
 *
 * Called ONLY by the webhook route handler after signature verification and
 * idempotency check. Runs with service client (no user session).
 *
 * Handlers are idempotent and commutative — order of Stripe events not guaranteed.
 */
export async function handleStripeEvent(
  event: import("stripe").Stripe.Event,
  webhookKey: string, // event.id — used to mark errors in webhook_events
): Promise<void> {
  const source = "stripe";

  switch (event.type) {
    // -----------------------------------------------------------------------
    // Payment success paths (commutative — both may arrive; second is no-op)
    // -----------------------------------------------------------------------
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      // Autopay enrollment sessions (mode=setup) carry no money — they only
      // capture a payment method (DOC-71 §2.4).
      if (session.mode === "setup") {
        await handleSetupSessionCompleted(session, webhookKey);
        break;
      }
      // Funnel through the shared settle path (same logic used by the reconcile
      // layers). "not_paid" → no-op; "no_payment" → record a webhook error.
      const outcome = await settlePaidCheckoutSession(session);
      if (outcome === "no_payment") {
        await markWebhookError(source, webhookKey, `checkout.session.completed: no payment for session ${session.id}`);
      }
      break;
    }

    case "payment_intent.succeeded": {
      const intent = event.data.object as import("stripe").Stripe.PaymentIntent;
      const payment = await resolvePaymentForIntent(intent);
      if (!payment) {
        await markWebhookError(source, webhookKey, `payment_intent.succeeded: no payment for intent ${intent.id}`);
        break;
      }

      // Link payment → intent if not already done (STRONG-2: update before reading intent back)
      if (!payment.stripe_payment_intent_id) {
        await updatePayment(payment.id, { stripe_payment_intent_id: intent.id });
      }

      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) break;
      const caseId = await findInstallmentCaseId(installment.id);
      // MED-3: orgId ALWAYS from BD — never from Stripe metadata
      const orgId = await findOrgIdForCase(caseId);

      await applyPaymentSuccess(payment, installment, caseId, orgId);
      break;
    }

    // -----------------------------------------------------------------------
    // Payment failure paths
    // -----------------------------------------------------------------------
    case "payment_intent.payment_failed": {
      const intent = event.data.object as import("stripe").Stripe.PaymentIntent;
      const payment = await resolvePaymentForIntent(intent);
      if (!payment) {
        await markWebhookError(source, webhookKey, `payment_intent.payment_failed: no payment for intent ${intent.id}`);
        break;
      }
      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) break;
      await applyPaymentFailure(payment, installment);
      break;
    }

    case "checkout.session.expired": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      const payment = await resolvePaymentForSession(session);
      if (!payment) break; // Session may not have had a local payment registered
      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) break;
      await applyPaymentFailure(payment, installment);
      break;
    }

    // -----------------------------------------------------------------------
    // Refund path
    // -----------------------------------------------------------------------
    case "charge.refunded": {
      const charge = event.data.object as import("stripe").Stripe.Charge;
      const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : null;
      if (!intentId) {
        await markWebhookError(source, webhookKey, "charge.refunded: no payment_intent on charge");
        break;
      }

      const refundedCents = charge.amount_refunded;

      const payment = await findPaymentByIntentId(intentId);
      if (!payment) {
        await markWebhookError(source, webhookKey, `charge.refunded: no payment for intent ${intentId}`);
        break;
      }

      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) break;

      const caseId = await findInstallmentCaseId(installment.id);
      // MED-3: orgId ALWAYS from BD — never from Stripe metadata
      const orgId = await findOrgIdForCase(caseId);

      // Partial refund: not supported in V2 (DOC-71 §4.2)
      if (refundedCents < payment.amount_cents) {
        await markWebhookError(
          source,
          webhookKey,
          `charge.refunded: partial refund not supported (refunded=${refundedCents}, original=${payment.amount_cents})`,
        );
        break;
      }

      await applyRefund(payment, installment, caseId, orgId, refundedCents, source, webhookKey);
      break;
    }

    default:
      // Unknown events: silently accept (200) without error — Stripe sends many
      logger.info({ eventType: event.type }, "billing: unhandled Stripe event type — ignoring");
  }
}

// ---------------------------------------------------------------------------
// reconcileCheckoutSession — L2: success_url return reconciliation (DOC-71 §3.5)
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  installmentStatus: string;
  paymentStatus: string | null;
  /** true once the payment is confirmed (this call or a prior one). */
  settled: boolean;
}

/**
 * Reconciles a Stripe Checkout Session when the client lands back on the
 * success_url (`/pagos/confirmacion?session_id=…`). The SERVER independently
 * asks Stripe whether the session is paid (`checkout.sessions.retrieve`) and
 * settles the payment if so — it NEVER trusts a client-reported status
 * (DOC-51 §8). This makes card confirmation immediate for the user even when
 * the webhook is delayed, retrying, or not yet configured: confirmation no
 * longer depends on a single external callback.
 *
 * Idempotent and safe to poll: settling funnels through applyPaymentSuccess.
 *
 * Authorization: client must have access to the owning case (fail-closed);
 * staff need billing:edit + same-org. Throws PAYMENT_NOT_PENDING if the
 * session has no local payment row (unknown / forged session id).
 */
export async function reconcileCheckoutSession(
  actor: Actor,
  sessionId: string,
): Promise<ReconcileResult> {
  const payment = await findPaymentBySessionId(sessionId);
  if (!payment) throw new BillingError("PAYMENT_NOT_PENDING");

  // Authorize against the owning case (same guards as the rest of the module).
  const caseId = await findInstallmentCaseId(payment.installment_id);
  if (actor.kind === "client") {
    if (!caseId) throw new AuthzError("forbidden_case");
    await requireCaseAccess(actor, caseId);
  } else {
    can(actor, "billing", "edit");
    await requirePaymentOrg(actor, payment.id);
  }

  // Authoritative check: ask Stripe directly. Tolerate transient Stripe errors
  // (the webhook / cron are the backstops) — surface the current DB status.
  let outcome: Awaited<ReturnType<typeof settlePaidCheckoutSession>> = "not_paid";
  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    outcome = await settlePaidCheckoutSession(session);
  } catch (err) {
    logger.warn(
      { err, sessionId, paymentId: payment.id },
      "billing.reconcileCheckoutSession: Stripe retrieve/settle failed — returning current status",
    );
  }

  // Re-read fresh status for the UI.
  const installment = await findInstallmentById(payment.installment_id);
  const latest = await findPaymentById(payment.id);
  return {
    installmentStatus: installment?.status ?? "unknown",
    paymentStatus: latest?.status ?? null,
    settled:
      outcome === "settled_now" ||
      outcome === "already_settled" ||
      installment?.status === "paid",
  };
}

// ---------------------------------------------------------------------------
// reconcilePendingStripePayments — L3: reconciliation cron (DOC-71 §3.6)
// ---------------------------------------------------------------------------

export interface ReconcilePendingResult {
  /** rows examined */
  reconciled: number;
  /** newly confirmed by THIS sweep */
  settled: number;
  /** already confirmed by an earlier layer (webhook / L2) before the sweep ran */
  alreadySettled: number;
  /** marked failed (session expired) */
  expired: number;
}

/**
 * Sweeps pending/stripe payments whose Checkout Session was created but never
 * confirmed (older than `olderThanMinutes`), retrieves each session from Stripe,
 * and settles (paid) or fails (expired) it. Safety net for the case where the
 * webhook never arrives AND the client closed the tab before the return-URL
 * reconcile ran. Complements expireOrphanCheckouts (which handles session_id-null
 * orphans). Cron-only (systemActor). Idempotent.
 */
export async function reconcilePendingStripePayments(
  systemActor: Actor,
  opts?: { olderThanMinutes?: number },
): Promise<ReconcilePendingResult> {
  // MED-1: defense-in-depth — cron-only endpoint
  requireSystemActor(systemActor);

  // 3-min floor: the return-URL reconcile settles fresh sessions within seconds;
  // only sweep ones old enough that the immediate path has clearly not fired.
  const minutes = opts?.olderThanMinutes ?? 3;
  const cutoffIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const pending = await listPendingStripeSessionsToReconcile(cutoffIso);
  let settled = 0;
  let alreadySettled = 0;
  let expired = 0;

  const stripe = getStripe();
  for (const payment of pending) {
    if (!payment.stripe_checkout_session_id) continue;
    try {
      const session = await stripe.checkout.sessions.retrieve(
        payment.stripe_checkout_session_id,
      );
      const outcome = await settlePaidCheckoutSession(session);
      if (outcome === "settled_now") {
        settled += 1;
      } else if (outcome === "already_settled") {
        alreadySettled += 1;
      } else if (session.status === "expired") {
        // Session can no longer be paid → free the lock + revert the installment.
        const installment = await findInstallmentById(payment.installment_id);
        if (installment) {
          await applyPaymentFailure(payment, installment);
          expired += 1;
        }
      }
    } catch (err) {
      logger.warn(
        { err, paymentId: payment.id, sessionId: payment.stripe_checkout_session_id },
        "billing.reconcilePendingStripePayments: failed to reconcile one payment — continuing",
      );
    }
  }

  // Twin sweep: autopay MIT charges (intent set, session NULL) whose inline
  // settle or webhook never landed (DOC-71 §2.4).
  const pendingIntents = await listPendingIntentPaymentsToReconcile(cutoffIso);
  for (const payment of pendingIntents) {
    if (!payment.stripe_payment_intent_id) continue;
    try {
      const intent = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) continue;

      if (intent.status === "succeeded") {
        if (installment.status === "paid") {
          alreadySettled += 1;
          continue;
        }
        const caseId = await findInstallmentCaseId(installment.id);
        const orgId = await findOrgIdForCase(caseId);
        await applyPaymentSuccess(payment, installment, caseId, orgId);
        settled += 1;
      } else if (intent.status === "canceled" || intent.status === "requires_payment_method") {
        // requires_payment_method = the off-session confirm was declined and
        // the intent cannot recover without a new PM — mark the row failed so
        // tomorrow's cron can retry with a fresh payment (mutex freed).
        await applyPaymentFailure(payment, installment);
        expired += 1;
      }
      // requires_action / processing → leave pending; a later sweep resolves it.
    } catch (err) {
      logger.warn(
        { err, paymentId: payment.id, intentId: payment.stripe_payment_intent_id },
        "billing.reconcilePendingStripePayments: failed to reconcile one intent — continuing",
      );
    }
  }

  const examined = pending.length + pendingIntents.length;
  if (settled > 0 || expired > 0 || alreadySettled > 0) {
    logger.info(
      { job: "reconcile-stripe-payments", examined, settled, alreadySettled, expired },
      "billing: reconciled pending stripe payments",
    );
  }

  return { reconciled: examined, settled, alreadySettled, expired };
}

// ---------------------------------------------------------------------------
// submitZelleProof — client uploads proof (RF-CLI-046)
// ---------------------------------------------------------------------------

const SubmitZelleProofSchema = z.object({
  installmentId: z.string().uuid(),
  proofPath: z.string().min(1), // storage path after confirmed upload
});

export type SubmitZelleProofInput = z.infer<typeof SubmitZelleProofSchema>;

/**
 * Client submits a Zelle payment proof (after uploading to signed URL).
 *
 * Validates the uploaded file, registers a pending payment, moves installment
 * to processing, and emits payment.proof_submitted.
 */
export async function submitZelleProof(
  actor: Actor,
  input: SubmitZelleProofInput,
): Promise<void> {
  const parsed = SubmitZelleProofSchema.parse(input);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  const caseId = await findInstallmentCaseId(parsed.installmentId);
  // Fail-closed (HIGH-2): client with no case_id → forbidden
  if (actor.kind === "client" && !caseId) throw new AuthzError("forbidden_case");
  if (caseId) await requireCaseAccess(actor, caseId);

  if (installment.status === "paid") throw new BillingError("INSTALLMENT_ALREADY_PAID");
  if (!PAYABLE_STATUSES.includes(installment.status as "pending" | "overdue")) {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

  const existingZelle = await findPendingZellePayment(parsed.installmentId);
  if (existingZelle) throw new BillingError("PROOF_ALREADY_SUBMITTED");

  // Server-side file validation (DOC-30 §14)
  const validationResult = await validateUploadedObject(
    "payment-proofs",
    parsed.proofPath,
    "payment-proofs",
  );
  if (!validationResult.ok) throw new BillingError("PROOF_INVALID_FILE", { reason: validationResult.reason });

  const payment = await insertPayment({
    installment_id: installment.id,
    method: "zelle",
    status: "pending",
    amount_cents: installment.amount_cents,
    payer_user_id: actor.userId,
    zelle_proof_path: parsed.proofPath,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    confirmed_by: null,
    confirmed_at: null,
  });

  await updateInstallment(installment.id, { status: "processing" });

  await appEvents.emitAndWait({
    type: "payment.proof_submitted",
    payload: {
      caseId: caseId ?? "",
      installmentId: installment.id,
      paymentId: payment.id,
      isDownpayment: installment.is_downpayment,
      amountCents: installment.amount_cents,
    },
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// confirmZellePayment — finance staff confirms a Zelle proof (RF-AND-011)
// ---------------------------------------------------------------------------

/**
 * Staff confirms a pending Zelle payment.
 * Authorization: cases:edit (Henry 2026-07-02 — the assigned asesora verifies
 * proofs from the case's Pagos tab, same precedent as registerZellePayment).
 * Calls applyPaymentSuccess which handles ledger + events.
 */
export async function confirmZellePayment(
  actor: Actor,
  paymentId: string,
): Promise<void> {
  can(actor, "cases", "edit");

  // CRITICAL-1 (complementary): cross-org guard before any data access
  await requirePaymentOrg(actor, paymentId);

  const p = await findPaymentById(paymentId);

  if (!p || p.method !== "zelle" || p.status !== "pending") {
    throw new BillingError("PAYMENT_NOT_PENDING");
  }

  const installment = await findInstallmentById(p.installment_id);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  const caseId = await findInstallmentCaseId(installment.id);
  const orgId = await findOrgIdForCase(caseId);

  await applyPaymentSuccess(p, installment, caseId, orgId, actor.userId);

  await writeAudit(actor, "billing.zelle.confirmed", "payments", paymentId, {
    after: { installmentId: p.installment_id },
  });
}

// ---------------------------------------------------------------------------
// rejectZelleProof — finance staff rejects a Zelle proof (RF-AND-011)
// ---------------------------------------------------------------------------

const RejectZelleSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().min(1),
});

export type RejectZelleProofInput = z.infer<typeof RejectZelleSchema>;

/**
 * Staff rejects a pending Zelle proof. Authorization: cases:edit (see
 * confirmZellePayment). Payment moves to rejected (terminal); installment
 * reverts to pending/overdue.
 */
export async function rejectZelleProof(
  actor: Actor,
  input: RejectZelleProofInput,
): Promise<void> {
  can(actor, "cases", "edit");
  // Zod schema enforces reason.min(1) — no need for a manual guard (nit removed)
  const parsed = RejectZelleSchema.parse(input);

  // CRITICAL-1 (complementary): cross-org guard before any data access
  await requirePaymentOrg(actor, parsed.paymentId);

  const p = await findPaymentById(parsed.paymentId);

  if (!p || p.method !== "zelle" || p.status !== "pending") {
    throw new BillingError("PAYMENT_NOT_PENDING");
  }

  await updatePayment(p.id, { status: "rejected" });

  const installment = await findInstallmentById(p.installment_id);
  if (installment) {
    const nextStatus = isOverdue(
      { status: installment.status, due_date: installment.due_date },
      todayIso(),
    )
      ? "overdue"
      : "pending";
    await updateInstallment(installment.id, { status: nextStatus });
  }

  await writeAudit(actor, "billing.zelle.rejected", "payments", p.id, {
    after: { reason: parsed.reason },
  });
}

// ---------------------------------------------------------------------------
// getZelleProofUploadUrl — signed URL for client proof upload (API-BIL-04)
// ---------------------------------------------------------------------------

const ProofUploadSchema = z.object({
  installmentId: z.string().uuid(),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
});
export type GetZelleProofUploadUrlInput = z.infer<typeof ProofUploadSchema>;

/**
 * Returns a signed upload URL for a Zelle payment proof.
 *
 * Authorization: client must be a member of the case.
 * Storage path: payment-proofs/{installmentId}/{timestamp}-{sanitized}.
 *
 * Client calls this first (API-BIL-04), uploads the file directly, then
 * calls submitZelleProof (API-BIL-05) to register the payment.
 */
export async function getZelleProofUploadUrl(
  actor: Actor,
  input: GetZelleProofUploadUrlInput,
): Promise<{ signedUrl: string; path: string }> {
  const parsed = ProofUploadSchema.parse(input);

  // HIGH-3: rate limit upload URL generation (10/min per userId, fail-open)
  const rl = await limitBillingUploadUrl(actor.userId);
  if (!rl.allowed) throw new BillingError("RATE_LIMITED");

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  const caseId = await findInstallmentCaseId(parsed.installmentId);
  // Fail-closed (HIGH-2): client with no case_id → forbidden
  if (actor.kind === "client" && !caseId) throw new AuthzError("forbidden_case");
  if (caseId) await requireCaseAccess(actor, caseId);

  // Sanitize filename (prevent path traversal)
  const sanitizedFilename = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `payment-proofs/${parsed.installmentId}/${Date.now()}-${sanitizedFilename}`;

  return createSignedUploadUrl("payment-proofs", storagePath);
}

// ---------------------------------------------------------------------------
// getZelleProofViewUrl — signed read URL for staff proof verification (RF-AND-011)
// ---------------------------------------------------------------------------

export interface ZelleProofView {
  url: string;
  kind: "image" | "pdf";
}

/**
 * Returns a short-lived signed URL to view a Zelle payment proof.
 *
 * Authorization: cases:view (see confirmZellePayment). Cross-org guard via
 * requirePaymentOrg. Used by the verification panels (finance + shared-case
 * Pagos tab) to render the uploaded comprobante (image or PDF) before
 * approving/rejecting the payment.
 */
export async function getZelleProofViewUrl(
  actor: Actor,
  paymentId: string,
): Promise<ZelleProofView> {
  can(actor, "cases", "view");

  // CRITICAL-1 (complementary): cross-org guard before any data access
  await requirePaymentOrg(actor, paymentId);

  const p = await findPaymentById(paymentId);
  if (!p || p.method !== "zelle" || !p.zelle_proof_path) {
    throw new BillingError("PROOF_NOT_FOUND");
  }

  const ext = p.zelle_proof_path.split(".").pop()?.toLowerCase() ?? "";
  const kind: "image" | "pdf" = ext === "pdf" ? "pdf" : "image";

  const url = await createSignedDownloadUrl("payment-proofs", p.zelle_proof_path);
  return { url, kind };
}

// ---------------------------------------------------------------------------
// getAccountStatement — public read for client + staff (API-BIL-13)
// ---------------------------------------------------------------------------

/**
 * Returns the account statement DTO for a case.
 *
 * Authorization: requireCaseAccess (client) or billing:view (staff).
 */
export async function getAccountStatement(
  actor: Actor,
  caseId: string,
): Promise<AccountStatementDto> {
  await requireCaseAccess(actor, caseId);
  return repoGetAccountStatement(caseId);
}

// ---------------------------------------------------------------------------
// getInstallmentPaymentStatus — polling endpoint (API-BIL-03)
// ---------------------------------------------------------------------------

/**
 * Returns the current status of an installment and its active payment.
 * Used by the client for polling after returning from Stripe Checkout.
 */
export async function getInstallmentPaymentStatus(
  actor: Actor,
  installmentId: string,
): Promise<{ installmentStatus: string; paymentStatus: string | null }> {
  const installment = await findInstallmentById(installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  const caseId = await findInstallmentCaseId(installmentId);
  // Fail-closed (HIGH-2): client with no case_id → forbidden
  if (actor.kind === "client" && !caseId) throw new AuthzError("forbidden_case");
  if (caseId) await requireCaseAccess(actor, caseId);

  // Find most recent payment for status
  const supabase = createServiceClient();
  const { data: latestPayment } = await supabase
    .from("payments")
    .select("status, method")
    .eq("installment_id", installmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    installmentStatus: installment.status,
    paymentStatus: latestPayment?.status ?? null,
  };
}

// ---------------------------------------------------------------------------
// onContractSigned — consumer of contract.signed event
// ---------------------------------------------------------------------------

/**
 * Re-anchors installment due dates when the contract is signed (DOC-44 §2.1, SOT-3).
 *
 * Idempotent: only proceeds if ALL installments are pending with no payments.
 * Runs with service client (system actor — no RLS).
 */
export async function onContractSigned(payload: {
  contractId: string;
  caseId: string;
  signedAt: string; // ISO timestamp
  orgId: string;
}): Promise<void> {
  const supabase = createServiceClient();

  // Resolve plan via contractId
  const { data: plan } = await supabase
    .from("payment_plans")
    .select("id, installment_count, frequency")
    .eq("contract_id", payload.contractId)
    .maybeSingle();

  if (!plan) {
    logger.warn({ contractId: payload.contractId }, "billing.onContractSigned: no plan found");
    return;
  }

  const installments = await listInstallmentsForPlan(plan.id);
  if (installments.length === 0) return;

  // Idempotency guard: only re-anchor if ALL installments are still pending with no payments
  const allPending = installments.every((i) => i.status === "pending");
  if (!allPending) {
    logger.info({ planId: plan.id }, "billing.onContractSigned: installments not all pending — skipping re-anchor");
    return;
  }

  // Check no payments exist for any installment
  const { data: anyPayments } = await supabase
    .from("payments")
    .select("id")
    .in("installment_id", installments.map((i) => i.id))
    .limit(1)
    .maybeSingle();

  if (anyPayments) {
    logger.info({ planId: plan.id }, "billing.onContractSigned: payments exist — skipping re-anchor");
    return;
  }

  // Convert signed_at to local date in org timezone
  // For now use UTC date (timezone enrichment is Ola-2 — orgs.settings.default_timezone)
  const anchorLocalDate = payload.signedAt.split("T")[0]; // YYYY-MM-DD

  const drafts = installments.map((i) => ({
    number: i.number,
    amountCents: i.amount_cents,
    dueDate: i.due_date,
    isDownpayment: i.is_downpayment,
  }));

  const reanchored = reanchorDueDates(
    drafts,
    anchorLocalDate,
    (plan.frequency ?? "monthly") as PaymentFrequency,
  );

  // Update due dates
  for (const d of reanchored) {
    const inst = installments.find((i) => i.number === d.number);
    if (inst && inst.due_date !== d.dueDate) {
      await updateInstallment(inst.id, { due_date: d.dueDate });
    }
  }

  logger.info(
    { planId: plan.id, anchor: anchorLocalDate },
    "billing.onContractSigned: due dates re-anchored",
  );
}

// ---------------------------------------------------------------------------
// waiveInstallment — condonation by finance/admin (RF-AND-019, DOC-44 §3.7)
// ---------------------------------------------------------------------------

const WaiveInstallmentSchema = z.object({
  installmentId: z.string().uuid(),
  reason: z.string().min(1),
});

export type WaiveInstallmentInput = z.infer<typeof WaiveInstallmentSchema>;

/**
 * Waives an installment (marks it forgiven with mandatory reason).
 *
 * Gates:
 *  - can(actor, 'billing', 'edit')
 *  - status must be pending|overdue (INSTALLMENT_NOT_WAIVABLE)
 *  - reason required (WAIVE_REASON_REQUIRED)
 *  - downpayment of payment_pending case requires admin (WAIVE_REQUIRES_ADMIN)
 *
 * No domain event emitted (RF-AND-019).
 */
export async function waiveInstallment(
  actor: Actor,
  input: WaiveInstallmentInput,
): Promise<void> {
  can(actor, "billing", "edit");
  const parsed = WaiveInstallmentSchema.parse(input);

  // CRITICAL-1 (complementary): cross-org guard before any data access
  await requireInstallmentOrg(actor, parsed.installmentId);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  // W2 — reason is mandatory (Zod ensures min length = 1, but explicit guard for code clarity)
  if (!parsed.reason.trim()) throw new BillingError("WAIVE_REASON_REQUIRED");

  // Derive transition actor from role
  const transitionActor: import("./domain").InstallmentTransitionActor =
    actor.role === "admin" ? "admin" : "finance";

  if (
    !canTransitionInstallment(
      installment.status as import("./domain").InstallmentStatus,
      "waived",
      transitionActor,
    )
  ) {
    throw new BillingError("INSTALLMENT_NOT_WAIVABLE");
  }

  // W3 — downpayment of payment_pending case requires admin (MED-2: fail-closed)
  // If caseId is null (broken chain), deny non-admin as a conservative fail-safe.
  if (installment.is_downpayment && actor.role !== "admin") {
    const caseId = await findInstallmentCaseId(parsed.installmentId);
    if (!caseId) {
      // Broken chain: cannot verify case status → fail-closed for non-admin (MED-2)
      throw new BillingError("WAIVE_REQUIRES_ADMIN");
    }
    const caseStatus = await findCaseStatus(caseId);
    if (caseStatus === "payment_pending") {
      throw new BillingError("WAIVE_REQUIRES_ADMIN");
    }
  }

  await updateInstallment(installment.id, {
    status: "waived",
    waived_by: actor.userId,
    waived_reason: parsed.reason,
  });

  await writeAudit(actor, "billing.installment.waived", "installments", installment.id, {
    before: { status: installment.status },
    after: { status: "waived", waivedBy: actor.userId, reason: parsed.reason },
  });
}

// ---------------------------------------------------------------------------
// rescheduleInstallment — reprogramar vencimiento (RF-AND-022, DOC-44 §3.10)
// ---------------------------------------------------------------------------

const RescheduleInstallmentSchema = z.object({
  installmentId: z.string().uuid(),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD"),
});

export type RescheduleInstallmentInput = z.infer<typeof RescheduleInstallmentSchema>;

/**
 * Reschedules an installment's due date.
 *
 * Gates:
 *  - can(actor, 'billing', 'edit')
 *  - status must be pending|overdue (INSTALLMENT_NOT_RESCHEDULABLE)
 *  - newDueDate must be in the future (DUE_DATE_INVALID)
 *  - if was overdue and new date is future → reverts to pending
 */
export async function rescheduleInstallment(
  actor: Actor,
  input: RescheduleInstallmentInput,
): Promise<void> {
  can(actor, "billing", "edit");
  const parsed = RescheduleInstallmentSchema.parse(input);

  // CRITICAL-1 (complementary): cross-org guard before any data access
  await requireInstallmentOrg(actor, parsed.installmentId);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");

  if (installment.status !== "pending" && installment.status !== "overdue") {
    throw new BillingError("INSTALLMENT_NOT_RESCHEDULABLE");
  }

  const today = todayIso();
  if (parsed.newDueDate <= today) {
    throw new BillingError("DUE_DATE_INVALID");
  }

  // LOW: upper bound — reject dates more than 2 years in the future (unreasonable reschedule)
  const maxDate = new Date();
  maxDate.setFullYear(maxDate.getFullYear() + 2);
  const maxDateIso = maxDate.toISOString().split("T")[0];
  if (parsed.newDueDate > maxDateIso) {
    throw new BillingError("DUE_DATE_INVALID");
  }

  const patch: Record<string, unknown> = { due_date: parsed.newDueDate };

  // If overdue and new date is in the future → revert to pending
  if (installment.status === "overdue") {
    patch.status = "pending";
  }

  await updateInstallment(installment.id, patch as Parameters<typeof updateInstallment>[1]);

  await writeAudit(actor, "billing.installment.rescheduled", "installments", installment.id, {
    before: { dueDate: installment.due_date, status: installment.status },
    after: { dueDate: parsed.newDueDate, status: patch.status ?? installment.status },
  });
}

// ---------------------------------------------------------------------------
// markOverdues — cron: pending → overdue (DOC-44 §3.9)
// ---------------------------------------------------------------------------

export interface MarkOverduesResult {
  marked: number;
}

/**
 * Marks all pending installments with due_date < today as overdue.
 * Emits installment.overdue for each.
 *
 * Called ONLY by the installment-reminders cron job (systemActor).
 * Idempotent: the WHERE status='pending' filter prevents double-marking.
 */
export async function markOverdues(
  _systemActor: Actor,
  today: string, // YYYY-MM-DD
): Promise<MarkOverduesResult> {
  // MED-1: defense-in-depth — this endpoint is cron-only (systemActor)
  requireSystemActor(_systemActor);

  const due = await listOverdueUniverse(today);

  for (const inst of due) {
    await updateInstallment(inst.id, { status: "overdue" });
    await appEvents.emitAndWait({
      type: "installment.overdue",
      payload: {
        caseId: inst.caseId,
        installmentId: inst.id,
        number: inst.number,
        amountCents: inst.amountCents,
        dueDate: inst.dueDate,
        daysLate: daysLate({ due_date: inst.dueDate }, today),
        orgId: inst.orgId,
      },
      occurredAt: new Date(),
    });
  }

  return { marked: due.length };
}

// ---------------------------------------------------------------------------
// expireOrphanCheckouts — clear stuck pending/stripe payments (expire-stale-checkouts cron)
// ---------------------------------------------------------------------------

export interface ExpireOrphanCheckoutsResult {
  expired: number;
}

/**
 * Expires orphaned Stripe checkout attempts: pending/stripe payment rows whose
 * Checkout Session was never created (session_id IS NULL) and that are older than
 * `olderThanMinutes`. Each is marked `failed`, which frees the
 * payments_active_stripe_unique_idx lock so the client can start a fresh checkout.
 *
 * The installment is left untouched: on the orphan path, installment.status is set
 * to 'processing' only AFTER the Stripe session is created, so an orphan's installment
 * is still 'pending'/'overdue' (no revert needed).
 *
 * Called ONLY by the expire-stale-checkouts cron job (systemActor). Idempotent.
 */
export async function expireOrphanCheckouts(
  _systemActor: Actor,
  opts?: { olderThanMinutes?: number },
): Promise<ExpireOrphanCheckoutsResult> {
  // MED-1: defense-in-depth — this endpoint is cron-only (systemActor)
  requireSystemActor(_systemActor);

  const minutes = opts?.olderThanMinutes ?? 60;
  const cutoffIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();

  const orphans = await listOrphanStripePayments(cutoffIso);
  for (const orphan of orphans) {
    await updatePayment(orphan.id, { status: "failed" });
  }

  if (orphans.length > 0) {
    logger.info(
      { job: "expire-stale-checkouts", expired: orphans.length },
      "billing: expired orphan stripe checkouts",
    );
  }

  return { expired: orphans.length };
}

// ---------------------------------------------------------------------------
// listReminderTargets — targets for due-3d and due-day reminders
// ---------------------------------------------------------------------------

export interface ReminderTarget {
  installmentId: string;
  caseId: string;
  clientUserId: string | null;
  dueDate: string;
  number: number;
  /** Plan is autopay-enrolled — the reminders job skips due-day and uses the autopay copy for due-3d. */
  autopayEnabled: boolean;
}

export async function listReminderTargets(today: string, actor?: Actor): Promise<ReminderTarget[]> {
  // MED-1: defense-in-depth — this is a cron-only function.
  // The actor parameter is optional for backward compat but asserted when provided.
  if (actor) requireSystemActor(actor);
  return repoListReminderTargets(today);
}

// ---------------------------------------------------------------------------
// recordReminderSent — mark installment as reminded
// ---------------------------------------------------------------------------

export async function recordReminderSent(
  _systemActor: Actor,
  installmentId: string,
): Promise<void> {
  // MED-1: defense-in-depth — this endpoint is cron-only (systemActor)
  requireSystemActor(_systemActor);
  await updateInstallment(installmentId, { last_reminder_at: nowIso() });
}

// ---------------------------------------------------------------------------
// getCollectionMetrics — cobranza dashboard (RF-AND-044, DOC-44 §3.12)
// ---------------------------------------------------------------------------

export interface CollectionMetricsDto {
  collectedMonthCents: number;
  collectedPrevMonthCents: number;
  onTimePct: number;
  overdue: { cuotas: number; montoCents: number; casos: number };
}

/**
 * Returns collection metrics for Andrium's dashboard.
 *
 * Formulas (DOC-44 §3.12):
 *   collectedMonthCents = Σ ledger_entries.amount_cents (kind=income, entry_date in month)
 *   onTimePct = al_dia / exigibles * 100
 *     exigibles = installments with due_date <= today AND status != 'waived'
 *     al_dia    = exigibles with status = 'paid'
 *     if exigibles = 0 → 100%
 *   overdue = count/sum/distinct-cases with status='overdue'
 *
 * @api-id API-BIL-17
 */
export async function getCollectionMetrics(
  actor: Actor,
  today: string, // YYYY-MM-DD
  month: string, // YYYY-MM (first day = month start, last day = month end)
): Promise<CollectionMetricsDto> {
  can(actor, "billing", "view");
  return repoCollectionMetrics(actor.orgId, today, month);
}

// ---------------------------------------------------------------------------
// listDueCalendar — vencimientos de Andrium (RF-AND-014, DOC-44 §4)
// ---------------------------------------------------------------------------

export interface DueCalendarItemDto {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  installmentCount: number;
  amountCents: number;
  status: string;
  isDownpayment: boolean;
  dueDate: string; // YYYY-MM-DD
}

export interface DueCalendarInput {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  status?: string;
  serviceId?: string;
}

/**
 * Lists installments in a due-date range with case/client info.
 *
 * @api-id API-BIL-14
 */
export async function listDueCalendar(
  actor: Actor,
  input: DueCalendarInput,
): Promise<DueCalendarItemDto[]> {
  can(actor, "billing", "view");
  return repoListDueCalendar(actor.orgId, input);
}

// ---------------------------------------------------------------------------
// listOverdueForCollections — morosidad (RF-AND-020)
// ---------------------------------------------------------------------------

export interface OverdueItemDto {
  installmentId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  number: number;
  amountCents: number;
  dueDate: string; // YYYY-MM-DD
  daysLate: number;
}

/**
 * Lists overdue installments ordered by due_date ASC with case/client info.
 *
 * @api-id Used by Andrium morosidad view
 */
export async function listOverdueForCollections(
  actor: Actor,
): Promise<OverdueItemDto[]> {
  can(actor, "billing", "view");
  const rows = await repoListOverdueForCollections(actor.orgId);
  return rows.map((r) => ({
    installmentId: r.installmentId,
    caseId: r.caseId,
    caseNumber: r.caseNumber,
    clientName: r.clientName,
    number: r.number,
    amountCents: r.amountCents,
    dueDate: r.dueDate,
    daysLate: r.daysLateVal,
  }));
}

// ---------------------------------------------------------------------------
// F6-Ola3: Contabilidad — libro + gasto manual + resumen (DOC-44 §3.11)
// ---------------------------------------------------------------------------

/** Ledger entry as shown in the libro (RF-AND-028). */
export type LedgerEntryDto = LedgerItemRepo;

const RecordLedgerEntrySchema = z.object({
  kind: z.enum(["income", "expense"]),
  category: z.string().min(1),
  amountCents: z.number().int(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(500).nullable().optional(),
  caseId: z.string().uuid().nullable().optional(),
});

export type RecordLedgerEntryInput = z.infer<typeof RecordLedgerEntrySchema>;

/**
 * Records a manual ledger entry (gasto/ingreso libre, payment_id = null).
 *
 * Gates: can(actor, 'billing', 'edit'). Amount + category validated in domain.
 * If a case is linked, it must belong to the actor's org (cross-org guard).
 *
 * @api-id API-BIL-11
 */
export async function recordLedgerEntry(
  actor: Actor,
  input: RecordLedgerEntryInput,
): Promise<{ id: string }> {
  can(actor, "billing", "edit");
  const parsed = RecordLedgerEntrySchema.parse(input);

  const verr = validateLedgerEntry({ amountCents: parsed.amountCents, category: parsed.category });
  if (verr) throw new BillingError(verr);

  if (parsed.caseId) {
    const orgId = await findOrgIdForCase(parsed.caseId);
    if (!orgId || orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  }

  const row = await insertLedgerEntry({
    orgId: actor.orgId,
    kind: parsed.kind,
    category: parsed.category.trim(),
    amountCents: parsed.amountCents,
    entryDate: parsed.entryDate ?? todayIso(),
    description: parsed.description?.trim() || null,
    caseId: parsed.caseId ?? null,
    recordedBy: actor.userId,
  });

  await writeAudit(actor, "billing.ledger.recorded", "ledger_entries", row.id, {
    after: { kind: row.kind, category: row.category, amountCents: row.amount_cents },
  });

  return { id: row.id };
}

const UpdateLedgerEntrySchema = z.object({
  category: z.string().min(1).optional(),
  amountCents: z.number().int().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().max(500).nullable().optional(),
});

export type UpdateLedgerEntryInput = z.infer<typeof UpdateLedgerEntrySchema>;

/**
 * Edits a MANUAL ledger entry. Automatic entries (payment_id != null) are
 * locked (LEDGER_ENTRY_NOT_EDITABLE) — the truth of an income is its payment.
 *
 * @api-id API-BIL-12
 */
export async function updateLedgerEntry(
  actor: Actor,
  entryId: string,
  input: UpdateLedgerEntryInput,
): Promise<void> {
  can(actor, "billing", "edit");
  const parsed = UpdateLedgerEntrySchema.parse(input);

  const entry = await findLedgerEntryById(entryId);
  if (!entry) throw new BillingError("LEDGER_ENTRY_NOT_FOUND");
  // ledger_entries.org_id is authoritative for the cross-org guard
  if (entry.org_id !== actor.orgId) throw new AuthzError("cross_org_access_denied");
  // Candado: automatic (payment-linked) entries are not editable (RF-AND-029)
  if (entry.payment_id !== null) throw new BillingError("LEDGER_ENTRY_NOT_EDITABLE");

  const mergedAmount = parsed.amountCents ?? entry.amount_cents;
  const mergedCategory = parsed.category ?? entry.category;
  const verr = validateLedgerEntry({ amountCents: mergedAmount, category: mergedCategory });
  if (verr) throw new BillingError(verr);

  const patch: Record<string, unknown> = {};
  if (parsed.category !== undefined) patch.category = parsed.category.trim();
  if (parsed.amountCents !== undefined) patch.amount_cents = parsed.amountCents;
  if (parsed.entryDate !== undefined) patch.entry_date = parsed.entryDate;
  if (parsed.description !== undefined) patch.description = parsed.description?.trim() || null;

  const updated = await updateLedgerEntryRow(
    entryId,
    patch as Parameters<typeof updateLedgerEntryRow>[1],
  );

  await writeAudit(actor, "billing.ledger.updated", "ledger_entries", entryId, {
    before: {
      category: entry.category,
      amountCents: entry.amount_cents,
      entryDate: entry.entry_date,
      description: entry.description,
    },
    after: {
      category: updated.category,
      amountCents: updated.amount_cents,
      entryDate: updated.entry_date,
      description: updated.description,
    },
  });
}

export interface MonthlySummaryDto {
  month: string; // YYYY-MM
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  byCategory: Array<{ kind: "income" | "expense"; category: string; totalCents: number }>;
  previous: { incomeCents: number; expenseCents: number; balanceCents: number };
}

const YearMonthSchema = z.string().regex(/^\d{4}-\d{2}$/);

/**
 * Monthly income/expense/balance summary + per-category breakdown + previous
 * month comparison. Pure aggregation of the libro (RF-AND-032).
 *
 * @api-id API-BIL-16
 */
export async function getMonthlySummary(
  actor: Actor,
  yearMonth: string,
): Promise<MonthlySummaryDto> {
  can(actor, "billing", "view");
  const ym = YearMonthSchema.parse(yearMonth);

  const [cur, prev] = await Promise.all([
    monthlyLedgerSummary(actor.orgId, monthRange(ym)),
    monthlyLedgerSummary(actor.orgId, monthRange(previousMonth(ym))),
  ]);

  return {
    month: ym,
    incomeCents: cur.incomeCents,
    expenseCents: cur.expenseCents,
    balanceCents: cur.incomeCents - cur.expenseCents,
    byCategory: cur.byCategory,
    previous: {
      incomeCents: prev.incomeCents,
      expenseCents: prev.expenseCents,
      balanceCents: prev.incomeCents - prev.expenseCents,
    },
  };
}

const ListLedgerSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(["income", "expense"]).optional(),
  category: z.string().min(1).optional(),
  caseId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export type ListLedgerInput = z.infer<typeof ListLedgerSchema>;

/**
 * Lists ledger entries (the libro) for the actor's org with keyset pagination.
 *
 * @api-id API-BIL-15
 */
export async function listLedger(
  actor: Actor,
  input: ListLedgerInput,
): Promise<{ items: LedgerEntryDto[]; nextCursor: string | null }> {
  can(actor, "billing", "view");
  const parsed = ListLedgerSchema.parse(input ?? {});
  return repoListLedger(actor.orgId, parsed);
}

// ---------------------------------------------------------------------------
// F6-Ola3: Manual payment reminder (P-55-1 / RF-AND-016)
// ---------------------------------------------------------------------------

/**
 * Sends a manual payment reminder for an installment (staff "Recordar" button).
 *
 * Reuses the notification + email pipeline. Anti-spam: at most one manual
 * reminder per 12h (REMINDER_TOO_SOON). Records last_reminder_at.
 *
 * @api-id API-BIL-18
 */
export async function sendInstallmentReminder(
  actor: Actor,
  installmentId: string,
): Promise<void> {
  can(actor, "billing", "edit");
  await requireInstallmentOrg(actor, installmentId);

  const installment = await findInstallmentById(installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");
  if (installment.status !== "pending" && installment.status !== "overdue") {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

  // Anti-spam: no more than one manual reminder per 12h
  if (installment.last_reminder_at) {
    const elapsed = Date.now() - new Date(installment.last_reminder_at).getTime();
    if (elapsed < 12 * 60 * 60 * 1000) throw new BillingError("REMINDER_TOO_SOON");
  }

  const caseId = await findInstallmentCaseId(installmentId);
  if (!caseId) throw new BillingError("INSTALLMENT_NOT_FOUND");

  const clientUserId = await findCaseClientUserId(caseId);
  if (clientUserId) {
    const overdue = installment.status === "overdue";
    const templateKey = overdue ? "installment-overdue" : "installment-reminder-due";
    const titleI18n = overdue
      ? { en: "You have an overdue installment", es: "Tienes una cuota vencida" }
      : { en: "Payment reminder", es: "Recordatorio de pago" };
    const bodyI18n = overdue
      ? {
          en: `Installment #${installment.number} is overdue. Please make your payment.`,
          es: `La cuota #${installment.number} está vencida. Por favor realiza tu pago.`,
        }
      : {
          en: `Reminder: installment #${installment.number} is pending payment.`,
          es: `Recordatorio: la cuota #${installment.number} está pendiente de pago.`,
        };
    const dedupeKey = `installment.manual_reminder:${installmentId}:${clientUserId}:${todayIso()}`;

    const result = await insertNotificationIdempotent({
      userId: clientUserId,
      type: "installment.manual_reminder",
      titleI18n,
      bodyI18n,
      icon: overdue ? "alert-circle" : "bell",
      color: overdue ? "red" : "gold",
      actionUrl: "/pagos",
      dedupeKey,
    });

    // Always (re-)enqueue the email, even when the notification already existed
    // (result.created=false). The job dedupeId `email:${notificationId}` makes QStash
    // idempotent, so a retry after a crash between insert and enqueue still delivers (STRONG-3).
    const notificationId = result.row.id;
    const user = await findUserById(clientUserId);
    if (user?.email && !user.emailBouncedAt) {
      try {
        await enqueueJob({
          jobKey: "deliver-notification",
          entityId: notificationId,
          attempt: 1,
          dedupeId: `email:${notificationId}`,
          channel: "email",
          notificationId,
          templateKey,
          recipientEmail: user.email,
          locale: user.locale ?? "es",
        });
      } catch (err) {
        logger.warn(
          { err, notificationId },
          "billing.sendInstallmentReminder: failed to enqueue email — continuing",
        );
      }
    }
  }

  await updateInstallment(installmentId, { last_reminder_at: nowIso() });
  await writeAudit(actor, "billing.reminder.sent", "installments", installmentId, {
    after: { manual: true, status: installment.status },
  });
}

// ---------------------------------------------------------------------------
// Internal security helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that the actor is the system actor (userId === systemActor().userId).
 * Used as defense-in-depth on cron-only endpoints (MED-1).
 *
 * @throws AuthzError('wrong_kind') if actor is a client
 * @throws AuthzError('forbidden_module') if actor is not the system actor
 */
function requireSystemActor(actor: Actor): void {
  // systemActor() has userId=00000000-0000-0000-0000-000000000000 and role=admin
  // Import inline to avoid circular dep at module level (authz ← supabase)
  const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  if (actor.kind !== "staff") {
    throw new AuthzError("wrong_kind");
  }
  if (actor.userId !== SYSTEM_USER_ID) {
    // Non-system callers should use can() gates, not cron endpoints
    throw new AuthzError("forbidden_module");
  }
}

/**
 * Resolves the org_id for the case that owns the given installment,
 * then asserts the actor belongs to that org (cross-org IDOR guard).
 *
 * Used for billing mutations that do NOT go through requireCaseAccess:
 * waiveInstallment, rescheduleInstallment, confirmZellePayment,
 * rejectZelleProof, registerZellePayment.
 *
 * @throws AuthzError('cross_org_access_denied') on org mismatch
 * @throws BillingError('INSTALLMENT_NOT_FOUND') if case chain is broken
 */
async function requireInstallmentOrg(
  actor: Actor,
  installmentId: string,
): Promise<void> {
  const caseId = await findInstallmentCaseId(installmentId);
  if (!caseId) throw new BillingError("INSTALLMENT_NOT_FOUND");
  const orgId = await findOrgIdForCase(caseId);
  if (!orgId || orgId !== actor.orgId) {
    throw new AuthzError("cross_org_access_denied");
  }
}

/**
 * Resolves the org_id for the case that owns the given payment,
 * then asserts the actor belongs to that org (cross-org IDOR guard).
 *
 * Used for rejectZelleProof and confirmZellePayment which receive a paymentId.
 *
 * @throws AuthzError('cross_org_access_denied') on org mismatch
 * @throws BillingError('PAYMENT_NOT_PENDING') if payment/chain is not found
 */
async function requirePaymentOrg(
  actor: Actor,
  paymentId: string,
): Promise<void> {
  const p = await findPaymentById(paymentId);
  if (!p) throw new BillingError("PAYMENT_NOT_PENDING");
  const caseId = await findInstallmentCaseId(p.installment_id);
  if (!caseId) throw new BillingError("PAYMENT_NOT_PENDING");
  const orgId = await findOrgIdForCase(caseId);
  if (!orgId || orgId !== actor.orgId) {
    throw new AuthzError("cross_org_access_denied");
  }
}

// ---------------------------------------------------------------------------
// Internal helpers for lookups across module boundaries
// ---------------------------------------------------------------------------

async function findCaseStatus(caseId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("status")
    .eq("id", caseId)
    .maybeSingle();
  return data?.status ?? null;
}

async function findOrgIdForCase(caseId: string | null): Promise<string | null> {
  if (!caseId) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("org_id")
    .eq("id", caseId)
    .maybeSingle();
  return data?.org_id ?? null;
}

async function findCaseNumber(caseId: string | null): Promise<string | null> {
  if (!caseId) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("case_number")
    .eq("id", caseId)
    .maybeSingle();
  return data?.case_number ?? null;
}

async function findInstallmentCountForPlan(planId: string): Promise<number | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payment_plans")
    .select("installment_count")
    .eq("id", planId)
    .maybeSingle();
  return data?.installment_count ?? null;
}

// ---------------------------------------------------------------------------
// Webhook resolution helpers
// ---------------------------------------------------------------------------

async function resolvePaymentForSession(
  session: import("stripe").Stripe.Checkout.Session,
): Promise<PaymentRow | null> {
  // Strategy 1: by session_id
  if (session.id) {
    const p = await findPaymentBySessionId(session.id);
    if (p) return p;
  }

  // Strategy 2: by metadata.installment_id + pending stripe payment
  const installmentId = session.metadata?.installment_id ?? session.client_reference_id;
  if (installmentId) {
    return findActiveStripePayment(installmentId);
  }

  return null;
}

async function resolvePaymentForIntent(
  intent: import("stripe").Stripe.PaymentIntent,
): Promise<PaymentRow | null> {
  // Strategy 1: by intent id
  const p = await findPaymentByIntentId(intent.id);
  if (p) return p;

  // Strategy 2: by metadata.installment_id
  const installmentId = intent.metadata?.installment_id;
  if (installmentId) {
    return findActiveStripePayment(installmentId);
  }

  return null;
}
