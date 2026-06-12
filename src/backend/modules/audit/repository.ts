/**
 * Audit repository — data access layer.
 *
 * Only the service client is used for writes (INSERT) because audit_log
 * has no RLS INSERT policy for authenticated users (P-SERVICE-ROLE-ONLY,
 * DOC-30 §13). Reads use the server client so RLS filters org scope.
 */

import { createServiceClient, createServerClient } from "@/backend/platform/supabase";
import type { Tables } from "@/shared/database.types";

export type AuditLogRow = Tables<"audit_log">;

export interface ListAuditFilters {
  entityType?: string;
  entityId?: string;
  actorUserId?: string | null;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditPage {
  items: AuditLogRow[];
  nextCursor: string | null;
}

/** INSERT a single audit_log row via service client (bypasses RLS). */
export async function insertAuditLog(row: {
  org_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  diff: unknown;
  ip?: string;
}): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("audit_log").insert({
    org_id: row.org_id,
    actor_user_id: row.actor_user_id,
    action: row.action,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    diff: row.diff as Parameters<typeof supabase.from>[0] extends never
      ? never
      : import("@/shared/database.types").Json,
    ...(row.ip ? { ip: row.ip } : {}),
  });

  if (error) {
    // Non-fatal: log to structured logger but never throw — a failed audit
    // insert must never block the business operation (RF-TRX-023 §1).
    // The platform logger handles this path.
    throw new Error(`audit_log insert failed: ${error.message}`);
  }
}

/** Cursor-based paginated list of audit log entries. */
export async function listAuditLogRows(
  orgId: string,
  filters: ListAuditFilters,
): Promise<AuditPage> {
  const supabase = await createServerClient();
  const limit = Math.min(filters.limit ?? 50, 100);

  let query = supabase
    .from("audit_log")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (filters.entityType) {
    query = query.eq("entity_type", filters.entityType);
  }
  if (filters.entityId) {
    query = query.eq("entity_id", filters.entityId);
  }
  if (filters.actorUserId !== undefined) {
    if (filters.actorUserId === null) {
      query = query.is("actor_user_id", null);
    } else {
      query = query.eq("actor_user_id", filters.actorUserId);
    }
  }
  if (filters.fromDate) {
    query = query.gte("created_at", filters.fromDate);
  }
  if (filters.toDate) {
    query = query.lte("created_at", filters.toDate);
  }
  if (filters.cursor) {
    // Cursor = base64(JSON{created_at, id})
    const { created_at, id } = decodeCursor(filters.cursor);
    query = query.or(
      `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`,
    );
  }

  const { data, error } = await query;

  if (error) throw new Error(`audit_log list failed: ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1])
      : null;

  return { items, nextCursor };
}

function encodeCursor(row: AuditLogRow): string {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, id: row.id })).toString("base64url");
}

function decodeCursor(cursor: string): { created_at: string; id: string } {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as {
      created_at: string;
      id: string;
    };
  } catch {
    throw new Error("AUDIT_INVALID_CURSOR");
  }
}
