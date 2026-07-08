/**
 * Revisión de carta IA (paralegal Diana) — `/legal/caso/[caseId]/generacion/[formId]`.
 * Thin wrapper over the shared LetterReviewLoader; back → Cartas tab.
 */

import { LetterReviewLoader } from "@/app/(staff)/(panel)/_letter-review/loader";

export const dynamic = "force-dynamic";

export default async function LegalLetterReviewPage({
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
      backHref={`/legal/caso/${caseId}?tab=cartas`}
    />
  );
}
