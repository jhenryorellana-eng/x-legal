/**
 * Audit service — use cases.
 *
 * writeAudit() is the ergonomic entry point for every mutating use case.
 * Actor | "system" signature: "system" = actor_user_id IS NULL (RF-TRX-023).
 *
 * Ergonomic pattern (call at end of every mutation):
 *   await writeAudit(actor, 'catalog.service.created', 'services', service.id, { after: service });
 */

import { can } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import type { Actor } from "@/backend/platform/authz";
import { insertAuditLog, listAuditLogRows } from "./repository";
import type { ListAuditFilters, AuditPage } from "./repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditActorOrSystem = Actor | "system";

export interface AuditDiff {
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// writeAudit — core helper
// ---------------------------------------------------------------------------

/**
 * Inserts a row in audit_log.
 *
 * Never throws on DB failure — audit must never block the business operation.
 * Errors are captured with the structured logger only.
 *
 * @param actorOrSystem - Actor for staff mutations; "system" for automated ops.
 * @param action        - Canonical action string (e.g. 'catalog.service.created').
 * @param entityType    - Table name (e.g. 'services').
 * @param entityId      - Row UUID or null for bulk ops.
 * @param diff          - { before?, after? } or any JSON.
 * @param ip            - Optional request IP (passed from route handlers).
 */
export async function writeAudit(
  actorOrSystem: AuditActorOrSystem,
  action: string,
  entityType: string,
  entityId: string | null,
  diff: AuditDiff,
  ip?: string,
): Promise<void> {
  const isSystem = actorOrSystem === "system";
  const actor = isSystem ? null : (actorOrSystem as Actor);

  // System actor: actor_user_id IS NULL (DOC-30 §13, RF-TRX-023 rule).
  const actorUserId = actor?.userId ?? null;
  const orgId = actor?.orgId ?? "00000000-0000-0000-0000-000000000000";

  try {
    await insertAuditLog({
      org_id: orgId,
      actor_user_id: actorUserId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      diff,
      ip,
    });
  } catch (err) {
    // Non-fatal: log but never propagate (RF-TRX-023 §1)
    logger.error(
      { err, action, entityType, entityId },
      "audit: writeAudit failed — operation continues",
    );
  }
}

// ---------------------------------------------------------------------------
// listAuditLog — with authorization
// ---------------------------------------------------------------------------

/**
 * Lists audit log entries for the actor's org.
 * Requires can(actor, 'audit', 'view').
 *
 * @api-id API-AUD-01 (implicit — not yet in DOC-48 catalog; listed for tracking)
 */
export async function listAuditLog(
  actor: Actor,
  filters: ListAuditFilters,
): Promise<AuditPage> {
  can(actor, "audit", "view");
  return listAuditLogRows(actor.orgId, filters);
}

// ---------------------------------------------------------------------------
// exportAuditCsv — CSV generation
// ---------------------------------------------------------------------------

/**
 * Exports audit log entries as a CSV string.
 * Requires can(actor, 'audit', 'view').
 *
 * Returns CSV with header row. Date format: ISO UTC.
 *
 * @api-id API-AUD-02
 */
export async function exportAuditCsv(
  actor: Actor,
  filters: ListAuditFilters,
): Promise<string> {
  can(actor, "audit", "view");

  // Fetch up to 10,000 rows (export cap)
  const { items } = await listAuditLogRows(actor.orgId, {
    ...filters,
    limit: 10_000,
  });

  const CSV_HEADERS = ["id", "created_at", "actor_user_id", "action", "entity_type", "entity_id", "diff"];
  const rows = [
    CSV_HEADERS.join(","),
    ...items.map((row) =>
      [
        csvEscape(row.id),
        csvEscape(row.created_at),
        csvEscape(row.actor_user_id ?? ""),
        csvEscape(row.action),
        csvEscape(row.entity_type),
        csvEscape(row.entity_id ?? ""),
        csvEscape(JSON.stringify(row.diff ?? {})),
      ].join(","),
    ),
  ];

  return rows.join("\n");
}

/**
 * RFC 4180 CSV escape with Excel formula-injection prefix neutralization (H-1).
 *
 * Cells starting with =, +, -, @, tab (0x09) or CR (0x0D) are prefixed with
 * a tab character so spreadsheet parsers do not interpret them as formulas.
 * The tab-prefixed cell is then wrapped in quotes per RFC 4180.
 *
 * Reference: OWASP CSV Injection.
 */
function csvEscape(value: string): string {
  const s = String(value);

  // Neutralize Excel/LibreOffice formula injection prefixes
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;
  const neutralized = FORMULA_PREFIX.test(s) ? `\t${s}` : s;

  // RFC 4180: wrap in double quotes when the cell contains commas, quotes or newlines
  if (neutralized.includes(",") || neutralized.includes('"') || neutralized.includes("\n") || neutralized !== s) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}
