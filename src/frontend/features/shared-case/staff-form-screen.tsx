"use client";

/**
 * StaffFormScreen — mounts the shared FormWizard for a staff actor (RF-ADM-010).
 *
 * The client wrapper (FormularioScreen) hardcodes client success/exit routes, so
 * staff use this thin wrapper instead: it points onSubmitted / onExit back to the
 * case workspace (`backHref`). Save/submit/translate are the staff server actions
 * (authorized by case access — staff allowed).
 *
 * `editable` + `allowStaffSubmit` are resolved by the fill loader
 * (resolveStaffFormEditability): with edit rights the staff can fill/correct the
 * client's answers (and, on a not-yet-submitted form, complete + submit on their
 * behalf) using the SAME durable autosave engine as the client. Without them the
 * screen stays read-only ("Ver").
 */

import { useRouter } from "next/navigation";
import {
  FormWizard,
  type WizardForm,
  type WizardLabels,
  type Locale,
  type SaveDraftFn,
  type SubmitFormFn,
  type TranslateAnswersFn,
  type ImproveAnswerFn,
  type ResearchAnswerFn,
} from "@/frontend/features/form-wizard";

export function StaffFormScreen({
  caseId,
  partyId,
  partyName,
  form,
  locale,
  labels,
  editable = false,
  allowStaffSubmit = false,
  saveDraft,
  submitForm,
  translateAnswers,
  improveAnswer,
  researchField,
  backHref,
}: {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  /** Enable editing the answers (formEdit / staff-fillable draft). Default read-only. */
  editable?: boolean;
  /** Allow completing + submitting a not-yet-submitted client form on their behalf. */
  allowStaffSubmit?: boolean;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  translateAnswers?: TranslateAnswersFn;
  /** "Mejorar con IA" server action (per-question gating via aiImproveEnabled). */
  improveAnswer?: ImproveAnswerFn;
  /** web_research "Buscar" server action (per-question gating via source). */
  researchField?: ResearchAnswerFn;
  backHref: string;
}) {
  const router = useRouter();
  return (
    <FormWizard
      caseId={caseId}
      partyId={partyId}
      partyName={partyName}
      form={form}
      locale={locale}
      labels={labels}
      audience="staff"
      editable={editable}
      allowStaffSubmit={allowStaffSubmit}
      saveDraft={saveDraft}
      submitForm={submitForm}
      translateAnswers={translateAnswers}
      improveAnswer={improveAnswer}
      researchField={researchField}
      onSubmitted={() => router.push(backHref)}
      onExit={() => router.push(backHref)}
    />
  );
}
