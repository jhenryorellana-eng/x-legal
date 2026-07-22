"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FormWizard } from "@/frontend/features/form-wizard";
import type {
  WizardForm,
  WizardLabels,
  Locale,
  SaveDraftFn,
  SubmitFormFn,
  TranslateAnswersFn,
  ImproveAnswerFn,
  ResearchAnswerFn,
  GetAiPrefillFn,
} from "@/frontend/features/form-wizard";

/**
 * FormularioScreen — cliente wrapper for the shared FormWizard (DOC-51 §21).
 *
 * Client component: owns navigation (router) and injects the server actions into
 * the surface-agnostic engine. On submit → `/caso/[caseId]/exito`; back from
 * step 0 → the Camino (or the forms list when there are several forms).
 */
export interface FormularioScreenProps {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  /** Ola perf — cache poll that patches pending ai_field prefills in. */
  getAiPrefill?: GetAiPrefillFn;
  /** Server-side translator fallback (Gemini) for the answer-translation flow. */
  translateAnswers?: TranslateAnswersFn;
  /** "Mejorar con IA" server action (per-question gating via aiImproveEnabled). */
  improveAnswer?: ImproveAnswerFn;
  /** web_research "Buscar" server action (per-question gating via source). */
  researchField?: ResearchAnswerFn;
  /** Where "back" from step 0 lands (Camino or the forms list). */
  exitHref: string;
}

export function FormularioScreen({
  caseId,
  partyId,
  partyName,
  form,
  locale,
  labels,
  saveDraft,
  submitForm,
  getAiPrefill,
  translateAnswers,
  improveAnswer,
  researchField,
  exitHref,
}: FormularioScreenProps) {
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
      getAiPrefill={getAiPrefill}
      translateAnswers={translateAnswers}
      improveAnswer={improveAnswer}
      researchField={researchField}
      onSubmitted={() => router.replace(`/caso/${caseId}/exito?from=formulario`)}
      onExit={() => router.push(exitHref)}
    />
  );
}
