/**
 * Validaciones [caseId] — `/legal/validaciones/[caseId]` (paralegal Diana).
 *
 * Server component: loads all validations for the case + the compiled
 * expediente id (for gate), then mounts <ValidacionesDetailView/> with
 * the data and injected server actions.
 * IntegrationsError / ExpedienteError → friendly empty (never 500).
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import {
  getValidationsForCase,
  IntegrationsError,
  type LegalValidationRow,
} from "@/backend/modules/integrations";
import {
  getCaseExpedientes,
  ExpedienteError,
} from "@/backend/modules/expediente";
import { CaseError } from "@/backend/modules/cases";
import {
  ValidacionesDetailView,
  type ValidacionesDetailVM,
  type ValidationRowVM,
} from "@/frontend/features/legal/validaciones/validaciones-detail-view";
import {
  sendToLawyerAction,
  createCorrectionAttemptAction,
  sendToFinanceAction,
} from "./actions";

// ---------------------------------------------------------------------------
// Mapper
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

export default async function ValidacionesDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  let vm: ValidacionesDetailVM = {
    caseId,
    validations: [],
    compiledExpedienteId: null,
    handoffDone: false,
  };

  try {
    // Load validations (DESC by attempt_no via repo ordering)
    const validations = await getValidationsForCase(actor, caseId);
    // Sort DESC so index 0 = latest
    const sorted = [...validations].sort((a, b) => b.attempt_no - a.attempt_no);

    // Find the compiled expediente id for the sendToLawyer gate, and whether
    // the latest validation's expediente was already handed off to finance.
    let compiledExpedienteId: string | null = null;
    let handoffDone = false;
    try {
      const expedientes = await getCaseExpedientes(actor, caseId);
      const compiled = expedientes.find((e) => e.status === "compiled");
      compiledExpedienteId = compiled?.id ?? null;

      const latest = sorted[0];
      if (latest) {
        const latestExp = expedientes.find((e) => e.id === latest.expediente_id);
        handoffDone =
          latestExp?.status === "sent_to_finance" || latestExp?.status === "printed";
      }
    } catch {
      // Non-fatal: gate will just be disabled
    }

    vm = {
      caseId,
      validations: sorted.map(toRowVM),
      compiledExpedienteId,
      handoffDone,
    };
  } catch (err) {
    if (
      !(err instanceof IntegrationsError) &&
      !(err instanceof ExpedienteError) &&
      !(err instanceof CaseError)
    ) {
      throw err;
    }
    // Known domain errors → render empty state
  }

  return (
    <div>
      <ValidacionesDetailView
        vm={vm}
        actions={{
          sendToLawyer: sendToLawyerAction,
          createCorrectionAttempt: createCorrectionAttemptAction,
          sendToFinance: sendToFinanceAction,
        }}
      />
    </div>
  );
}
