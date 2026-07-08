/**
 * Revisión de carta IA (admin) — `/admin/casos/[caseId]/generacion/[formId]`.
 * Thin wrapper over the shared LetterReviewLoader; back → Generaciones tab.
 */

import { LetterReviewLoader } from "@/app/(staff)/(panel)/_letter-review/loader";

export const dynamic = "force-dynamic";

export default async function AdminLetterReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  return (
    <LetterReviewLoader
      caseId={caseId}
      formId={formId}
      party={party}
      name={name}
      backHref={`/admin/casos/${caseId}?tab=generaciones`}
    />
  );
}
