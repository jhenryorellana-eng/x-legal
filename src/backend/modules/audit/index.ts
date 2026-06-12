/**
 * Audit module — public API (module-pub boundary).
 *
 * Other modules must import writeAudit from here, not from service.ts directly.
 * The type AuditActorOrSystem and AuditDiff are re-exported for callers.
 */

export { writeAudit, listAuditLog, exportAuditCsv } from "./service";
export type { AuditActorOrSystem, AuditDiff } from "./service";
export type { AuditPage, ListAuditFilters } from "./repository";
