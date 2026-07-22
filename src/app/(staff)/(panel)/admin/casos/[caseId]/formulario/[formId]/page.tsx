/**
 * Staff form fill (admin) — `/admin/casos/[caseId]/formulario/[formId]` (RF-ADM-010).
 * Thin wrapper over the shared StaffFormFillLoader; back lands on the Formularios tab.
 */

import { StaffFormFillLoader } from "@/app/(staff)/(panel)/_form-fill/loader";

export const dynamic = "force-dynamic";
// web_research "Buscar" runs a synchronous Anthropic web_search Server Action — raise the
// route ceiling above Vercel's 15s Server-Action default so the search can complete.
export const maxDuration = 120;

export default async function AdminCaseFormPage({
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
      backHref={`/admin/casos/${caseId}?tab=formularios`}
    />
  );
}
