/**
 * Billing module server actions — public API surface (module-pub boundary).
 *
 * Each action:
 * 1. Calls requireActor() to build the Actor.
 * 2. Delegates to service.ts (which calls can()/requireCaseAccess() as first line).
 * 3. Returns typed ActionResult or wraps error.
 *
 * API-IDs per DOC-48 §3.5:
 *   API-BIL-01: createInstallmentCheckoutAction
 *   API-BIL-06: confirmZellePaymentAction
 *   API-BIL-07: rejectZelleProofAction
 *   API-BIL-08: registerZellePaymentAction (F2)
 *   API-BIL-13: getAccountStatementAction
 */

import { requireActor } from "@/backend/platform/authz";
import { AuthzError } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { BillingError } from "./service";
import * as svc from "./service";
import type {
  AccountStatementDto,
  RecordLedgerEntryInput,
  UpdateLedgerEntryInput,
  ListLedgerInput,
  LedgerEntryDto,
  MonthlySummaryDto,
} from "./service";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(err: unknown): ActionResult<never> {
  if (err instanceof BillingError) {
    return { success: false, error: { code: err.code, message: err.code } };
  }
  if (err instanceof AuthzError) {
    return {
      success: false,
      error: { code: err.reason ?? "UNAUTHORIZED", message: "Unauthorized" },
    };
  }
  // LOW-1: never expose raw error message (may contain Postgres internals / PII).
  // Log the detail server-side; return a generic message to the client.
  logger.error({ err }, "billing action: unexpected error");
  return {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred. Please try again." },
  };
}

// ---------------------------------------------------------------------------
// API-BIL-01 — createInstallmentCheckoutAction (cliente, miembro del caso)
// ---------------------------------------------------------------------------

/**
 * Creates a Stripe Checkout Session for an installment and returns the redirect URL.
 * Actor: cliente (requireCaseAccess via service) or staff (billing:edit via service).
 */
export async function createInstallmentCheckoutAction(
  installmentId: string,
): Promise<ActionResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    // Rate limiting now lives inside createCheckoutSessionForInstallment (service
    // layer) so it covers the real client path (pagos/page.tsx) too — it throws
    // BillingError("RATE_LIMITED"), mapped by fail() below.
    const result = await svc.createCheckoutSessionForInstallment(actor, installmentId);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// API-BIL-06 — confirmZellePaymentAction (staff billing:edit)
// ---------------------------------------------------------------------------

export async function confirmZellePaymentAction(
  paymentId: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.confirmZellePayment(actor, paymentId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// API-BIL-07 — rejectZelleProofAction (staff billing:edit)
// ---------------------------------------------------------------------------

export async function rejectZelleProofAction(
  paymentId: string,
  reason: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.rejectZelleProof(actor, { paymentId, reason });
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// API-BIL-08 — registerZellePaymentAction (staff billing:edit, RF-AND-012)
// ---------------------------------------------------------------------------

export async function registerZellePaymentAction(input: {
  installmentId: string;
  zelleProofPath?: string | null;
  notes?: string | null;
}): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.registerZellePayment(actor, input);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// API-BIL-13 — getAccountStatementAction (cliente/staff)
// ---------------------------------------------------------------------------

export async function getAccountStatementAction(
  caseId: string,
): Promise<ActionResult<AccountStatementDto>> {
  try {
    const actor = await requireActor();
    const result = await svc.getAccountStatement(actor, caseId);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// F6-Ola3 — Contabilidad (API-BIL-11/12/15/16) + recordatorio manual (API-BIL-18)
// ---------------------------------------------------------------------------

/** API-BIL-11 — record a manual ledger entry (staff billing:edit). */
export async function recordLedgerEntryAction(
  input: RecordLedgerEntryInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const result = await svc.recordLedgerEntry(actor, input);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** API-BIL-12 — edit a manual ledger entry (staff billing:edit). */
export async function updateLedgerEntryAction(
  entryId: string,
  input: UpdateLedgerEntryInput,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.updateLedgerEntry(actor, entryId, input);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}

/** API-BIL-15 — list ledger entries (the libro) for the actor's org. */
export async function listLedgerAction(
  input: ListLedgerInput,
): Promise<ActionResult<{ items: LedgerEntryDto[]; nextCursor: string | null }>> {
  try {
    const actor = await requireActor();
    const result = await svc.listLedger(actor, input);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** API-BIL-16 — monthly income/expense/balance summary. */
export async function getMonthlySummaryAction(
  yearMonth: string,
): Promise<ActionResult<MonthlySummaryDto>> {
  try {
    const actor = await requireActor();
    const result = await svc.getMonthlySummary(actor, yearMonth);
    return ok(result);
  } catch (err) {
    return fail(err);
  }
}

/** API-BIL-18 — send a manual payment reminder for an installment (P-55-1). */
export async function sendInstallmentReminderAction(
  installmentId: string,
): Promise<ActionResult<void>> {
  try {
    const actor = await requireActor();
    await svc.sendInstallmentReminder(actor, installmentId);
    return ok(undefined);
  } catch (err) {
    return fail(err);
  }
}
