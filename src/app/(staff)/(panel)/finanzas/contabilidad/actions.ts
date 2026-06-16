"use server";

/**
 * Contabilidad — server actions (Andrium / finance surface).
 *
 * Thin "use server" wrappers around the billing module use cases (API-BIL-11/12/15).
 * Returns `{ ok, data?, error: { code } }` (mirrors the pagos/[caseId] pattern).
 */

import { requireActor } from "@/backend/modules/identity";
import {
  recordLedgerEntry,
  updateLedgerEntry,
  listLedger,
  BillingError,
  type RecordLedgerEntryInput,
  type UpdateLedgerEntryInput,
  type LedgerEntryDto,
} from "@/backend/modules/billing";

export interface BillingResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

function fail(err: unknown): BillingResult<never> {
  if (err instanceof BillingError) return { ok: false, error: { code: err.code } };
  if (err instanceof Error && err.name === "AuthzError") {
    return { ok: false, error: { code: "FORBIDDEN" } };
  }
  return { ok: false, error: { code: "UNEXPECTED" } };
}

export async function recordLedgerEntryAction(
  input: RecordLedgerEntryInput,
): Promise<BillingResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const data = await recordLedgerEntry(actor, input);
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

export async function updateLedgerEntryAction(
  entryId: string,
  patch: UpdateLedgerEntryInput,
): Promise<BillingResult> {
  try {
    const actor = await requireActor();
    await updateLedgerEntry(actor, entryId, patch);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/** Keyset "load more" for the libro — bound to the month range by the page. */
export async function listLedgerMoreAction(
  from: string,
  to: string,
  cursor: string,
): Promise<BillingResult<{ items: LedgerEntryDto[]; nextCursor: string | null }>> {
  try {
    const actor = await requireActor();
    const data = await listLedger(actor, { from, to, cursor, limit: 500 });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}
