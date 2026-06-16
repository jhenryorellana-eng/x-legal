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
import { validateUploadedObject, createSignedUploadUrl } from "@/backend/platform/storage";
import { limitBillingCheckout, limitBillingUploadUrl } from "@/backend/platform/ratelimit";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import {
  buildInstallments,
  reanchorDueDates,
  isOverdue,
  PAYABLE_STATUSES,
} from "./domain";
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
  findPaymentByIntentId,
  findPaymentBySessionId,
  findStripeCustomer,
  upsertStripeCustomer,
  insertLedgerIfAbsent,
  type PaymentPlanRow,
  type InstallmentRow,
  type PaymentRow,
  type AccountStatementDto,
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
      | "INSTALLMENT_NOT_WAIVABLE"
      | "WAIVE_REASON_REQUIRED"
      | "WAIVE_REQUIRES_ADMIN"
      | "INSTALLMENT_NOT_RESCHEDULABLE"
      | "DUE_DATE_INVALID"
      | "REFUND_NOT_ALLOWED"
      | "LEDGER_AMOUNT_INVALID"
      | "LEDGER_CATEGORY_REQUIRED"
      | "LEDGER_ENTRY_NOT_EDITABLE"
      // Rate limiting (HIGH-3)
      | "RATE_LIMITED",
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

  appEvents.emit({
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
  const existing = await findStripeCustomer(userId);
  if (existing) return existing.stripe_customer_id;

  // Fetch user info to populate customer
  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("email, phone_e164")
    .eq("id", userId)
    .maybeSingle();

  const stripe = getStripe();
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
    notes: parsed.notes ?? null,
  });

  // Build installment drafts (provisional dates — re-anchored on contract.signed)
  const today = todayIso();
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
  zelleProofPath: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type RegisterZellePaymentInput = z.infer<typeof RegisterZelleSchema>;

/**
 * Directly registers a Zelle payment (finance staff, RF-AND-012).
 * No prior proof upload required. Calls applyPaymentSuccess internally.
 */
export async function registerZellePayment(
  actor: Actor,
  input: RegisterZellePaymentInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = RegisterZelleSchema.parse(input);

  const installment = await findInstallmentById(parsed.installmentId);
  if (!installment) throw new BillingError("INSTALLMENT_NOT_FOUND");
  if (installment.status === "paid") throw new BillingError("INSTALLMENT_ALREADY_PAID");
  if (!PAYABLE_STATUSES.includes(installment.status as "pending" | "overdue")) {
    throw new BillingError("INSTALLMENT_NOT_PAYABLE");
  }

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
    zelle_proof_path: parsed.zelleProofPath ?? null,
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
  });

  await applyPaymentSuccess(payment, installment, caseId, orgId, actor.userId);

  await writeAudit(
    actor,
    "billing.zelle.registered",
    "payments",
    payment.id,
    { after: { installmentId: installment.id, amountCents: installment.amount_cents } },
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

  // Resolve plan info for product name
  const orgId = await findOrgIdForCase(caseId);
  const caseNumber = await findCaseNumber(caseId);
  const planTotal = installment.payment_plan_id
    ? await findInstallmentCountForPlan(installment.payment_plan_id)
    : null;

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

  // TODO (Ola-2): if stripe.checkout.sessions.create throws AFTER the insert above,
  // the payment row is orphaned (pending/stripe, session_id=null) and blocks further
  // checkouts for this installment via the unique index until manually cleared. Add a
  // cleanup job that expires pending stripe payments with null session_id after ~1h.
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
    },
    payment_intent_data: {
      metadata: {
        installment_id: installmentId,
        case_id: caseId ?? "",
        org_id: orgId ?? "",
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
      if (session.payment_status !== "paid") break; // not a completed payment

      const payment = await resolvePaymentForSession(session);
      if (!payment) {
        await markWebhookError(source, webhookKey, `checkout.session.completed: no payment for session ${session.id}`);
        break;
      }

      // Update payment with intent id if now known
      if (session.payment_intent && typeof session.payment_intent === "string") {
        await updatePayment(payment.id, { stripe_payment_intent_id: session.payment_intent });
      }

      const installment = await findInstallmentById(payment.installment_id);
      if (!installment) break;
      const caseId = await findInstallmentCaseId(installment.id);
      // MED-3: orgId ALWAYS from BD (findOrgIdForCase) — never from Stripe metadata
      // (metadata is controlled by whoever created the session — not a trusted source)
      const orgId = await findOrgIdForCase(caseId);

      await applyPaymentSuccess(payment, installment, caseId, orgId);
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

  appEvents.emit({
    type: "payment.proof_submitted",
    payload: {
      caseId: caseId ?? "",
      installmentId: installment.id,
      paymentId: payment.id,
    },
    occurredAt: new Date(),
  });
}

// ---------------------------------------------------------------------------
// confirmZellePayment — finance staff confirms a Zelle proof (RF-AND-011)
// ---------------------------------------------------------------------------

/**
 * Finance staff confirms a pending Zelle payment.
 * Calls applyPaymentSuccess which handles ledger + events.
 */
export async function confirmZellePayment(
  actor: Actor,
  paymentId: string,
): Promise<void> {
  can(actor, "billing", "edit");

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
 * Finance staff rejects a pending Zelle proof.
 * Payment moves to rejected (terminal); installment reverts to pending/overdue.
 */
export async function rejectZelleProof(
  actor: Actor,
  input: RejectZelleProofInput,
): Promise<void> {
  can(actor, "billing", "edit");
  // Zod schema enforces reason.min(1) — no need for a manual guard (nit removed)
  const parsed = RejectZelleSchema.parse(input);

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
    .select("id, installment_count")
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

  const reanchored = reanchorDueDates(drafts, anchorLocalDate);

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
// Internal helpers for lookups across module boundaries
// ---------------------------------------------------------------------------

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
