"use server";

/**
 * Pagos globales — server actions (Andrium / finance surface).
 *
 * Thin wrappers around the zelle-recon module (reconciliation inbox) —
 * mirror pattern: finanzas/pagos/caso/[caseId]/actions.ts.
 * Returns `{ ok: true, data? }` or `{ ok: false, error: { code } }`.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  confirmZelleMatch,
  reassignZelleNotification,
  dismissZelleNotification,
  getZelleEvidenceUrl,
  listReconTargets,
  updateReconConfig,
  ZelleReconError,
  type ReconTargetVM,
} from "@/backend/modules/zelle-recon";
import { BillingError } from "@/backend/modules/billing";

export interface ReconResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

function toError(err: unknown): { code: string } {
  if (err instanceof ZelleReconError) return { code: err.code };
  if (err instanceof BillingError) return { code: err.code };
  return { code: "UNEXPECTED" };
}

export type ZelleRelationship = "self" | "family" | "third_party";

/** Confirms a suggested match (1 click) and teaches the payer alias. */
export async function confirmZelleMatchAction(input: {
  matchId: string;
  relationship: ZelleRelationship;
}): Promise<ReconResult<{ paymentId: string }>> {
  try {
    const actor = await requireActor();
    const data = await confirmZelleMatch(actor, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Assigns an unidentified payment to a payable installment. */
export async function reassignZelleNotificationAction(input: {
  notificationId: string;
  installmentId: string;
  relationship: ZelleRelationship;
}): Promise<ReconResult<{ paymentId: string }>> {
  try {
    const actor = await requireActor();
    const data = await reassignZelleNotification(actor, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Dismisses a bank alert that belongs to no client payment. */
export async function dismissZelleNotificationAction(input: {
  notificationId: string;
  reason: string;
}): Promise<ReconResult> {
  try {
    const actor = await requireActor();
    await dismissZelleNotification(actor, input);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Short-lived signed URL of the raw .eml evidence. */
export async function getZelleEvidenceUrlAction(
  notificationId: string,
): Promise<ReconResult<{ url: string }>> {
  try {
    const actor = await requireActor();
    const data = await getZelleEvidenceUrl(actor, notificationId);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Searches payable installments for the reassign panel. */
export async function searchReconTargetsAction(input: {
  query: string;
  amountCents?: number;
}): Promise<ReconResult<ReconTargetVM[]>> {
  try {
    const actor = await requireActor();
    const data = await listReconTargets(actor, input);
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}

/** Updates the reconciliation circuit breakers (kill switch, caps, tier B). */
export async function updateZelleReconConfigAction(patch: {
  enabled?: boolean;
  tier_a_max_amount_cents?: number;
  daily_auto_max_cents?: number;
  daily_auto_max_count?: number;
  per_payer_daily_max?: number;
  tier_b_mode?: "review_only" | "auto";
}): Promise<ReconResult> {
  try {
    const actor = await requireActor();
    await updateReconConfig(actor, patch);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: toError(err) };
  }
}
