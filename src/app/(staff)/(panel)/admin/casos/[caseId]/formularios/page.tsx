/**
 * Staff Formularios — `/admin/casos/[caseId]/formularios` (RF-ADM-010 / DOC-53 §3.4.3).
 *
 * Server component: lists the case's form RESPONSES via getCaseFormResponsesForStaff
 * (cases module-pub) and mounts CaseFormsManager with the approve/generate-PDF server
 * actions injected. CaseError → friendly empty (never a 500).
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseFormResponsesForStaff, getCaseWorkspace, CaseError } from "@/backend/modules/cases";
import { CaseFormsManager, type CaseFormItemVM } from "@/frontend/features/admin/case-forms/case-forms-manager";
import { approveFormResponseAction, generateFilledPdfAction } from "./actions";

export default async function CaseFormulariosPage({
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
      partyName: r.partyName,
      hasPdf: r.filledPdfPath !== null,
      submittedAt: r.submittedAt,
    }));
  } catch (err) {
    if (!(err instanceof CaseError)) throw err;
    // Membership / not-found → render the empty manager rather than a 500.
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <Link href={`/admin/casos/${caseId}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-3)", textDecoration: "none" }}>
          ← Volver al caso
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "var(--ink)", margin: "8px 0 2px", fontFamily: "var(--font-title)" }}>
          Formularios{caseNumber ? ` · ${caseNumber}` : ""}
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)" }}>Revisa los formularios enviados, apruébalos y genera el PDF oficial llenado.</p>
      </div>

      <CaseFormsManager
        items={items}
        actions={{ approve: approveFormResponseAction, generatePdf: generateFilledPdfAction }}
      />
    </div>
  );
}
