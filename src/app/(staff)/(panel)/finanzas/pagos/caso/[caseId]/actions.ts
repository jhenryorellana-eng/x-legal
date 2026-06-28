"use server";

/**
 * Pagos/cuotas [caseId] — server actions (Andrium / finance surface).
 *
 * Thin wrappers around the billing module use cases.
 * Returns `{ ok: true, data? }` or `{ ok: false, error: { code } }`.
 * Mirror pattern: legal/validaciones/[caseId]/actions.ts.
 *
 * Billing use cases wired here: Stripe checkout, Zelle confirm/reject/register,
 * proof upload/view, reschedule (RF-AND-022) and waive (RF-AND-019). All are
 * exported from @/backend/modules/billing and fully functional.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  createCheckoutSessionForInstallment,
  confirmZellePayment,
  rejectZelleProof,
  registerZellePayment,
  getZelleProofUploadUrl,
  getZelleProofViewUrl,
  waiveInstallment,
  rescheduleInstallment,
  BillingError,
  type RejectZelleProofInput,
  type RegisterZellePaymentInput,
  type GetZelleProofUploadUrlInput,
  type ZelleProofView,
} from "@/backend/modules/billing";

// ---------------------------------------------------------------------------
// Shared result shape (mirrors ValidacionResult pattern)
// ---------------------------------------------------------------------------

export interface BillingResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

// ---------------------------------------------------------------------------
// createInstallmentCheckoutAction (RF-AND-009 / API-BIL-02)
// Generates a Stripe Checkout link for an installment.
// ---------------------------------------------------------------------------

export async function createInstallmentCheckoutAction(
  installmentId: string,
): Promise<BillingResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    const data = await createCheckoutSessionForInstallment(actor, installmentId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// confirmZellePaymentAction (RF-AND-011 / API-BIL-06)
// Finance staff approves a pending Zelle proof.
// ---------------------------------------------------------------------------

export async function confirmZellePaymentAction(
  paymentId: string,
): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await confirmZellePayment(actor, paymentId);
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// rejectZelleProofAction (RF-AND-011 / API-BIL-07)
// Finance staff rejects a Zelle proof with a mandatory reason.
// ---------------------------------------------------------------------------

export async function rejectZelleProofAction(
  input: RejectZelleProofInput,
): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await rejectZelleProof(actor, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// registerZellePaymentAction (RF-AND-012 / API-BIL-08)
// Finance staff directly registers a Zelle payment.
// ---------------------------------------------------------------------------

export async function registerZellePaymentAction(
  input: RegisterZellePaymentInput,
): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await registerZellePayment(actor, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// getZelleProofUploadUrlAction (API-BIL-04)
// Returns a signed upload URL for attaching a Zelle proof.
// ---------------------------------------------------------------------------

export async function getZelleProofUploadUrlAction(
  input: GetZelleProofUploadUrlInput,
): Promise<BillingResult<{ signedUrl: string; path: string }>> {
  try {
    const actor = await requireActor();
    const data = await getZelleProofUploadUrl(actor, input);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// getZelleProofViewUrlAction (RF-AND-011)
// Returns a short-lived signed URL to view an uploaded Zelle proof.
// ---------------------------------------------------------------------------

export async function getZelleProofViewUrlAction(
  paymentId: string,
): Promise<BillingResult<ZelleProofView>> {
  try {
    const actor = await requireActor();
    const data = await getZelleProofViewUrl(actor, paymentId);
    return { ok: true, data };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// rescheduleInstallmentAction (RF-AND-022 / API-BIL-10)
// ---------------------------------------------------------------------------

export async function rescheduleInstallmentAction(input: {
  installmentId: string;
  newDueDate: string;
}): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await rescheduleInstallment(actor, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}

// ---------------------------------------------------------------------------
// waiveInstallmentAction (RF-AND-019 / API-BIL-09)
// ---------------------------------------------------------------------------

export async function waiveInstallmentAction(input: {
  installmentId: string;
  reason: string;
}): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await waiveInstallment(actor, input);
    return { ok: true };
  } catch (err) {
    if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
    return { ok: false, error: { code: "UNEXPECTED" } };
  }
}
