/**
 * Shared side-by-side form review loader (Diana's screen — DOC-54 §2.4).
 *
 * One async server component reused by the admin / legal / ventas `revisar/[formId]`
 * routes so the data-loading + action wiring lives in a single place. Each route is
 * a thin wrapper that only supplies its `backHref` (the case's Formularios tab).
 *
 * `_form-review` is a Next.js private folder (underscore) — colocation only, never
 * a route. Boundary R1/R2: app → module-pub (cases/index) + app server actions.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getFormForClient, getCaseDocuments, getCaseWorkspace, CaseError } from "@/backend/modules/cases";
import { type WizardForm, type Locale, resolveWizardLabels } from "@/frontend/features/form-wizard";
import {
  FormReviewScreen,
  type ReviewDocOption,
  type FormReviewStrings,
} from "@/frontend/features/legal/revision/form-review-screen";
import { resolveStaffFormEditability } from "@/app/(staff)/(panel)/_case-forms/editability";
import {
  submitFormResponseAction,
  translateFormAnswersAction,
  getDocumentUrlAction,
} from "@/app/(staff)/(panel)/admin/casos/actions";
import {
  approveFormResponseAction,
  rejectFormResponseAction,
  generateFilledPdfAction,
  getFormResponsePdfUrlAction,
  getFormCompletenessAction,
} from "@/app/(staff)/(panel)/admin/casos/form-actions";

export async function FormReviewLoader({
  caseId,
  formId,
  party,
  name,
  backHref,
}: {
  caseId: string;
  formId: string;
  party?: string;
  name?: string;
  /** Where "back" lands — the case's Formularios tab (`/…/{caseId}?tab=formularios`). */
  backHref: string;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const tWizard = await getTranslations("cliente.formWizard");
  const t = await getTranslations("staff_ensamblador");
  // ICU templates interpolated CLIENT-side (pdf-error mapper) — echo the
  // placeholders back so next-intl returns the raw template.
  const tWithVars = t as unknown as (key: string, values: Record<string, string>) => string;
  const partyId = party ?? null;

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: formId, partyId });
  } catch (err) {
    if (err instanceof CaseError) redirect(backHref);
    throw err;
  }
  if (!dto.versionId || dto.groups.length === 0) redirect(backHref);

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

  // Editability of the review answers (shared rule — see resolveStaffFormEditability).
  const { editable, saveDraft } = resolveStaffFormEditability(actor, form);

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
    updatePdf: t("reviewUpdatePdf"),
    updatingPdf: t("reviewUpdatingPdf"),
    pdfUpdatedToast: t("reviewPdfUpdatedToast"),
    pdfError: t("reviewPdfError"),
    pdfBlockedApproval: t("reviewPdfBlockedApproval"),
    pdfErrRequiredMissing: tWithVars("reviewPdfErrRequiredMissing", { count: "{count}", fields: "{fields}" }),
    pdfErrVersionMismatch: t("reviewPdfErrVersionMismatch"),
    pdfErrValidation: t("reviewPdfErrValidation"),
    verifyIncomplete: tWithVars("reviewVerifyIncomplete", { count: "{count}", fields: "{fields}" }),
    pendingRequiredTitle: t("reviewPendingRequiredTitle"),
    approvedPdfFailed: t("reviewApprovedPdfFailed"),
    rejectBtn: t("reviewRejectBtn"),
    rejectTitle: t("reviewRejectTitle"),
    rejectReasonLabel: t("reviewRejectReasonLabel"),
    rejectReasonPlaceholder: t("reviewRejectReasonPlaceholder"),
    rejectConfirm: t("reviewRejectConfirm"),
    rejectCancel: t("reviewRejectCancel"),
    rejecting: t("reviewRejecting"),
    rejectedToast: t("reviewRejectedToast"),
    rejectReasonRequired: t("reviewRejectReasonRequired"),
    rejectError: t("reviewRejectError"),
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
      editable={editable}
      actions={{
        saveDraft,
        submitForm: submitFormResponseAction,
        translateAnswers: translateFormAnswersAction,
        getDocumentUrl: getDocumentUrlAction,
        getFilledPdfUrl: getFormResponsePdfUrlAction,
        approve: approveFormResponseAction,
        reject: rejectFormResponseAction,
        generatePdf: generateFilledPdfAction,
        getCompleteness: getFormCompletenessAction,
      }}
      backHref={backHref}
    />
  );
}
