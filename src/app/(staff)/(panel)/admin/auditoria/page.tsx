/**
 * Audit log — /admin/auditoria (DOC-53 §8).
 *
 * Server Component: guards the actor, reads the first audit page + the staff
 * roster (to resolve actor names) via module-pub, and passes them + the server
 * actions (load-more, CSV export) to the client orchestrator. Filters + cursor
 * pagination live client-side over the load-more action (P-53-3).
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listEmployeesAction } from "@/backend/modules/identity/actions";
import { AuditClient } from "@/frontend/features/admin/audit/audit-client";
import { loadAuditPageAction, exportAuditCsvAction } from "./actions";

export default async function AuditPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const t = await getTranslations("staff.admin");
  const tt = t as unknown as (key: string) => string;

  // First page + staff roster (for actor names) in parallel.
  const [first, roster] = await Promise.all([
    loadAuditPageAction({ limit: 50 }),
    listEmployeesAction(),
  ]);

  const actors = roster.ok
    ? roster.data.employees.map((e) => ({ id: e.userId, name: e.displayName, avatar: e.avatarUrl }))
    : [];

  const rows = first.ok ? (first.items ?? []) : [];
  const entityTypes = Array.from(new Set(rows.map((r) => r.entity_type))).sort();

  const messages = buildAuditStrings(tt);

  return (
    <AuditClient
      initialRows={rows}
      initialNextCursor={first.ok ? (first.nextCursor ?? null) : null}
      actors={actors}
      entityTypes={entityTypes}
      messages={messages}
      actions={{
        loadPage: loadAuditPageAction,
        exportCsv: exportAuditCsvAction,
      }}
    />
  );
}

function buildAuditStrings(tt: (k: string) => string): Record<string, string> {
  const keys = [
    "title", "sub", "readOnly", "filterActor", "filterEntity", "filterAction",
    "filterFrom", "filterTo", "exportCsv", "colWhen", "colWho", "colAction",
    "colEntity", "colIp", "systemActor", "detailTitle", "diffField", "diffBefore",
    "diffAfter", "noDiff", "encryptedNote", "viewRawJson", "viewEntityHistory",
    "emptyTitle", "emptySub", "emptyFiltered",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = tt(`audit.${k}`);
  out.loadMore = tt("common.loadMore");
  return out;
}
