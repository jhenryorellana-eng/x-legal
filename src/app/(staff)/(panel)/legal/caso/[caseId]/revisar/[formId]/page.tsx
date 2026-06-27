/**
 * Revisión lado a lado — `/legal/caso/[caseId]/revisar/[formId]` (paralegal Diana).
 *
 * LEFT: a client-uploaded document (selectable). RIGHT: the SAME FormWizard with
 * the fields autocompleted from the client's data, editable. After review Diana
 * approves + generates the official filled PDF. Reuses the case form runtime +
 * the shared staff actions.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFormForClient, getCaseDocuments, getCaseWorkspace, CaseError } from "@/backend/modules/cases";
import { type WizardForm, type Locale, resolveWizardLabels } from "@/frontend/features/form-wizard";
import { FormReviewScreen, type ReviewDocOption, type FormReviewStrings } from "@/frontend/features/legal/revision/form-review-screen";
import {
  saveFormDraftAction,
  submitFormResponseAction,
  translateFormAnswersAction,
  getDocumentUrlAction,
} from "../../../../../admin/casos/actions";
import {
  approveFormResponseAction,
  generateFilledPdfAction,
  getFormResponsePdfUrlAction,
} from "../../../../../admin/casos/[caseId]/formularios/actions";

export const dynamic = "force-dynamic";

export default async function LegalFormReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string; formId: string }>;
  searchParams: Promise<{ party?: string; name?: string }>;
}) {
  const { caseId, formId } = await params;
  const { party, name } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const back = `/legal/caso/${caseId}/formularios`;
  const locale = (await getLocale()) as Locale;
  const tWizard = await getTranslations("cliente.formWizard");
  const t = await getTranslations("staff_ensamblador");
  const partyId = party ?? null;

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: formId, partyId });
  } catch (err) {
    if (err instanceof CaseError) redirect(back);
    throw err;
  }
  if (!dto.versionId || dto.groups.length === 0) redirect(back);

  // Documents to compare against (client uploads, approved or pending review).
  const [docs, workspace] = await Promise.all([
    getCaseDocuments(actor, caseId).catch(() => []),
    getCaseWorkspace(actor, caseId).catch(() => null),
  ]);
  const partyNameById = new Map((workspace?.parties ?? []).map((p) => [p.id, p.name ?? null]));
  const documents: ReviewDocOption[] = docs
    .filter((d) => d.status === "approved" || d.status === "uploaded")
    .map((d) => ({
      id: d.id,
      label: d.display_name ?? d.original_filename,
      partyName: d.party_id ? (partyNameById.get(d.party_id) ?? null) : null,
    }));

  const form = dto as WizardForm;
  const labels = resolveWizardLabels(tWizard as unknown as (key: string) => string);

  const strings: FormReviewStrings = {
    officialTitle: t("reviewOfficialTitle"),
    officialEmpty: t("reviewOfficialEmpty"),
    tabDocs: t("reviewTabDocs"),
    tabAnswers: t("reviewTabAnswers"),
    docSelectPlaceholder: t("reviewDocSelect"),
    noDocs: t("reviewNoDocs"),
    loadingDoc: t("reviewLoadingDoc"),
    openDoc: t("reviewOpenDoc"),
    reviewHint: t("reviewHint"),
    approveTitle: t("reviewApproveTitle"),
    approveBtn: t("reviewApproveBtn"),
    approving: t("reviewApproving"),
    approvedToast: t("reviewApprovedToast"),
    viewPdf: t("reviewViewPdf"),
    approveError: t("reviewApproveError"),
    back: t("reviewBack"),
  };

  return (
    <FormReviewScreen
      caseId={caseId}
      partyId={partyId}
      partyName={name ?? null}
      form={form}
      locale={locale}
      labels={labels}
      documents={documents}
      strings={strings}
      actions={{
        saveDraft: saveFormDraftAction,
        submitForm: submitFormResponseAction,
        translateAnswers: translateFormAnswersAction,
        getDocumentUrl: getDocumentUrlAction,
        getFilledPdfUrl: getFormResponsePdfUrlAction,
        approve: approveFormResponseAction,
        generatePdf: generateFilledPdfAction,
      }}
      backHref={back}
    />
  );
}
