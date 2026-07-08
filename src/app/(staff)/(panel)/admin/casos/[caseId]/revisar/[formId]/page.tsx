/**
 * Revisión lado a lado (admin) — `/admin/casos/[caseId]/revisar/[formId]`.
 * Thin wrapper over the shared FormReviewLoader; back lands on the Formularios tab.
 */

import { FormReviewLoader } from "@/app/(staff)/(panel)/_form-review/loader";

export const dynamic = "force-dynamic";

export default async function AdminFormReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  return (
    <FormReviewLoader
      caseId={caseId}
      formId={formId}
      party={party}
      name={name}
      backHref={`/admin/casos/${caseId}?tab=formularios`}
    />
  );
}
