/**
 * Staff form fill (legal) — `/legal/caso/[caseId]/formulario/[formId]`
 * (RF-DIA / RF-ADM-010). Thin wrapper over the shared StaffFormFillLoader; "Ver" on
 * the Información tab lands here. Back returns to the Información/Formularios tab.
 */

import { StaffFormFillLoader } from "@/app/(staff)/(panel)/_form-fill/loader";

export const dynamic = "force-dynamic";
// web_research "Buscar" runs a synchronous Anthropic web_search Server Action — raise the
// route ceiling above Vercel's 15s Server-Action default so the search can complete.
export const maxDuration = 120;

export default async function LegalCaseFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  return (
    <StaffFormFillLoader
      caseId={caseId}
      formId={formId}
      party={party}
      name={name}
      backHref={`/legal/caso/${caseId}?tab=formularios`}
    />
  );
}
