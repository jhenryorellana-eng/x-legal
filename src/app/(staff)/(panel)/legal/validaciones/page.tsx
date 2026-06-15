/**
 * Validaciones — `/legal/validaciones` (paralegal Diana).
 *
 * Server component: loads all legal_validations via listValidationsAdmin
 * and mounts <ValidacionesListView/> with the data.
 * IntegrationsError → friendly empty (never 500).
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import {
  listValidationsAdmin,
  IntegrationsError,
  type LegalValidationRow,
} from "@/backend/modules/integrations";
import {
  ValidacionesListView,
  type ValidacionesListVM,
  type ValidationRowVM,
} from "@/frontend/features/legal/validaciones/validaciones-list-view";

// ---------------------------------------------------------------------------
// Mapper: backend row → frontend VM (strips server-only fields if needed)
// ---------------------------------------------------------------------------

function toRowVM(r: LegalValidationRow): ValidationRowVM {
  return {
    id: r.id,
    case_id: r.case_id,
    expediente_id: r.expediente_id,
    attempt_no: r.attempt_no,
    status: r.status as ValidationRowVM["status"],
    semaforo: r.semaforo ?? null,
    ai_score: r.ai_score ?? null,
    verdict: r.verdict ?? null,
    verdict_notes: r.verdict_notes ?? null,
    verdict_findings: r.verdict_findings ?? null,
    verdict_at: r.verdict_at ?? null,
    return_to: r.return_to ?? null,
    sent_at: r.sent_at ?? null,
    error: r.error ?? null,
    created_at: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ValidacionesPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  let vm: ValidacionesListVM = { rows: [] };

  try {
    const rows = await listValidationsAdmin(actor, { pageSize: 100 });
    vm = { rows: rows.map(toRowVM) };
  } catch (err) {
    if (!(err instanceof IntegrationsError)) throw err;
    // IntegrationsError (e.g. permission denied) → render empty
  }

  return (
    <div>
      <ValidacionesListView vm={vm} />
    </div>
  );
}
