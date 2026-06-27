/**
 * Formularios de Diana — `/legal/caso/[caseId]/formularios` (paralegal).
 *
 * Espejo de la página admin: lista las RESPUESTAS de formularios del caso vía
 * getCaseFormResponsesForStaff (cases module-pub) y monta CaseFormsManager con
 * las acciones de aprobar / generar PDF llenado / generar carta IA inyectadas.
 * Reusa las server actions de la ruta admin (convención del repo). CaseError →
 * empty amable (nunca 500).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseFormResponsesForStaff, getCaseWorkspace, CaseError } from "@/backend/modules/cases";
import { CaseFormsManager, type CaseFormItemVM } from "@/frontend/features/admin/case-forms/case-forms-manager";
import {
  approveFormResponseAction,
  generateFilledPdfAction,
  startGenerationAction,
} from "../../../../admin/casos/[caseId]/formularios/actions";

export const dynamic = "force-dynamic";

export default async function LegalCaseFormulariosPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = await getLocale();
  const pick = (v: { es: string; en: string }) => (locale === "en" ? v.en || v.es : v.es || v.en);

  let caseNumber = "";
  let items: CaseFormItemVM[] = [];
  try {
    const [ws, rows] = await Promise.all([
      getCaseWorkspace(actor, caseId).catch(() => null),
      getCaseFormResponsesForStaff(actor, caseId),
    ]);
    caseNumber = (ws as { caseNumber?: string } | null)?.caseNumber ?? "";
    items = rows.map((r) => ({
      responseId: r.responseId,
      formDefinitionId: r.formDefinitionId,
      label: pick(r.labelI18n),
      kind: r.kind,
      filledBy: r.filledBy,
      status: r.status,
      partyId: r.partyId,
      partyName: r.partyName,
      hasPdf: r.filledPdfPath !== null,
      submittedAt: r.submittedAt,
    }));
  } catch (err) {
    if (!(err instanceof CaseError)) throw err;
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <Link href={`/legal/caso/${caseId}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", textDecoration: "none" }}>
          ← Volver al caso
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "var(--ink)", margin: "8px 0 2px", fontFamily: "var(--font-title)" }}>
          Formularios{caseNumber ? ` · ${caseNumber}` : ""}
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)" }}>
          Revisa los formularios enviados, apruébalos, genera el PDF oficial llenado y lanza las cartas IA.
        </p>
      </div>

      <CaseFormsManager
        items={items}
        caseId={caseId}
        reviewBasePath={`/legal/caso/${caseId}/revisar`}
        actions={{
          approve: approveFormResponseAction,
          generatePdf: generateFilledPdfAction,
          startGeneration: startGenerationAction,
        }}
      />
    </div>
  );
}
