"use server";

/**
 * Audit server actions for the admin panel (DOC-53 §8, P-53-3).
 *
 * The audit module exposes listAuditLog / exportAuditCsv taking an Actor; here
 * we wrap them with requireActor() so the client view can paginate ("Cargar
 * más") and trigger the CSV export without crossing the app→module-int boundary.
 */

import { requireActor } from "@/backend/modules/identity";
import { listAuditLog, exportAuditCsv, type ListAuditFilters } from "@/backend/modules/audit";

export interface AuditPageResult {
  ok: boolean;
  items?: Array<{
    id: string;
    created_at: string;
    actor_user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    ip: unknown;
    diff: unknown;
  }>;
  nextCursor?: string | null;
  error?: { code: string; message: string };
}

/** Loads the next page of audit entries (cursor pagination). */
export async function loadAuditPageAction(
  filters: ListAuditFilters,
): Promise<AuditPageResult> {
  try {
    const actor = await requireActor();
    const page = await listAuditLog(actor, filters);
    return { ok: true, items: page.items, nextCursor: page.nextCursor };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return { ok: false, error: { code: "AUDIT_LIST_FAILED", message } };
  }
}

/**
 * Returns the filtered audit log as CSV text (P-53-3 — the download itself is
 * assembled client-side from this string via a Blob).
 */
export async function exportAuditCsvAction(
  filters: ListAuditFilters,
): Promise<{ ok: boolean; csv?: string; error?: { code: string; message: string } }> {
  try {
    const actor = await requireActor();
    const csv = await exportAuditCsv(actor, filters);
    return { ok: true, csv };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error";
    return { ok: false, error: { code: "AUDIT_EXPORT_FAILED", message } };
  }
}
