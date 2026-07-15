/**
 * Staff form fill (admin) — `/admin/casos/[caseId]/formulario/[formId]` (RF-ADM-010).
 * Thin wrapper over the shared StaffFormFillLoader; back lands on the Formularios tab.
 */

import { StaffFormFillLoader } from "@/app/(staff)/(panel)/_form-fill/loader";

export const dynamic = "force-dynamic";

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
