/**
 * Staff form fill (ventas) — `/ventas/clientes/[caseId]/formulario/[formId]`
 * (RF-VAN-043 / RF-ADM-010). Thin wrapper over the shared StaffFormFillLoader;
 * back lands on the Información/Formularios tab.
 */

import { StaffFormFillLoader } from "@/app/(staff)/(panel)/_form-fill/loader";

export const dynamic = "force-dynamic";

export default async function VentasCaseFormPage({
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
      backHref={`/ventas/clientes/${caseId}?tab=formularios`}
    />
  );
}
