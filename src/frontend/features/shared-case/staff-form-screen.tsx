"use client";

/**
 * StaffFormScreen — mounts the shared FormWizard for a staff actor (RF-ADM-010).
 *
 * The client wrapper (FormularioScreen) hardcodes client success/exit routes, so
 * staff use this thin wrapper instead: it points onSubmitted / onExit back to the
 * case workspace (`backHref`). Save/submit/translate are the staff server actions
 * (authorized by case access — staff allowed).
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
} from "@/frontend/features/form-wizard";

export function StaffFormScreen({
  caseId,
  partyId,
  partyName,
  form,
  locale,
  labels,
  saveDraft,
  submitForm,
  translateAnswers,
  backHref,
}: {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  translateAnswers?: TranslateAnswersFn;
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
      saveDraft={saveDraft}
      submitForm={submitForm}
      translateAnswers={translateAnswers}
      onSubmitted={() => router.push(backHref)}
      onExit={() => router.push(backHref)}
    />
  );
}
