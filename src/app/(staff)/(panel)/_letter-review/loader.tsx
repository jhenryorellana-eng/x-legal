/**
 * Shared side-by-side AI-letter review loader (Ola 2). Reused by the admin/legal/
 * ventas `generacion/[formId]` routes. `formId` is the ai_letter definition; the
 * companion questionnaire (what Diana edits) is resolved from it. Private folder
 * (`_letter-review`) — colocation only, never a route.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor, allows } from "@/backend/modules/identity";
import { getClientFormsForCase, getFormForClient, CaseError } from "@/backend/modules/cases";
import { getRunsForCase } from "@/backend/modules/ai-engine";
import { type WizardForm, type Locale, resolveWizardLabels } from "@/frontend/features/form-wizard";
import { LetterReviewScreen, type LetterReviewStrings } from "@/frontend/features/legal/revision/letter-review-screen";
import {
  saveFormDraftAction,
  submitFormResponseAction,
  translateFormAnswersAction,
} from "@/app/(staff)/(panel)/admin/casos/actions";
import { staffUpdateFormAnswersAction } from "@/app/(staff)/(panel)/admin/casos/form-actions";
import {
  getGenerationOutputUrlAction,
  startLetterGenerationAction,
  getRunStatusAction,
} from "@/app/(staff)/(panel)/admin/casos/generation-actions";

export async function LetterReviewLoader({
  caseId,
  formId,
  party,
  name,
  backHref,
}: {
  caseId: string;
  /** The ai_letter form definition id. */
  formId: string;
  party?: string;
  name?: string;
  backHref: string;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const tWizard = await getTranslations("cliente.formWizard");
  const t = await getTranslations("staff_ensamblador");
  const partyId = party ?? null;

  // Resolve the ai_letter → its companion questionnaire (the fill target).
  const forms = await getClientFormsForCase(actor, caseId).catch(() => []);
  const item = forms.find((f) => f.formDefinitionId === formId);
  if (!item) redirect(backHref);
  const companionId = item!.fillFormDefinitionId;

  let dto;
  try {
    dto = await getFormForClient(actor, { caseId, formDefinitionId: companionId, partyId });
  } catch (err) {
    if (err instanceof CaseError) redirect(backHref);
    throw err;
  }
  if (!dto.versionId || dto.groups.length === 0) redirect(backHref);

  // Current generated letter (highest completed version) for the left PDF.
  const runs = await getRunsForCase(actor, caseId).catch(() => []);
  const current = runs.find(
    (r) => r.form_definition_id === formId && r.isCurrent && (partyId ? r.party_id === partyId : r.party_id === null),
  );

  const form = dto as WizardForm;
  const labels = resolveWizardLabels(tWizard as unknown as (key: string) => string);

  // Same rule as the form review (Ola 1): staff-fillable draft → normal fill;
  // otherwise a correction gated by `formEdit`.
  const isEditableStaffDraft = (form.status === "draft" || form.status === null) && form.filledBy !== "client";
  const editable = isEditableStaffDraft || allows(actor, "formEdit", "edit");
  const saveDraft = isEditableStaffDraft ? saveFormDraftAction : staffUpdateFormAnswersAction;

  const strings: LetterReviewStrings = {
    letterTitle: t("letterTitle"),
    letterEmpty: t("letterEmpty"),
    loading: t("reviewLoadingDoc"),
    reviewHint: t("reviewHint"),
    regenerateBtn: t("letterRegenerate"),
    regenerating: t("letterRegenerating"),
    regenError: t("letterRegenError"),
    viewLetter: t("letterView"),
    back: t("reviewBack"),
  };

  return (
    <LetterReviewScreen
      caseId={caseId}
      partyId={partyId}
      partyName={name ?? null}
      aiLetterFormDefinitionId={formId}
      form={form}
      locale={locale}
      labels={labels}
      editable={editable}
      initialRunId={current?.id ?? null}
      strings={strings}
      actions={{
        saveDraft,
        submitForm: submitFormResponseAction,
        translateAnswers: translateFormAnswersAction,
        getGenerationOutputUrl: getGenerationOutputUrlAction,
        startLetterGeneration: startLetterGenerationAction,
        getRunStatus: getRunStatusAction,
      }}
      backHref={backHref}
    />
  );
}
