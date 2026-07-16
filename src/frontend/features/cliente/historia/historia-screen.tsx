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
  ImproveAnswerFn,
} from "@/frontend/features/form-wizard";

/**
 * HistoriaScreen — "Mi Historia" (DOC-51 §20). The narration wizard with Lex
 * "atento", a listening chip and per-textarea dictation. It is the SAME engine
 * as the generic form wizard (chasis idéntico, DOC-51 §20/§21) — only the header
 * decoration (Lex + chip) and the back-to-Camino exit differ.
 */
export interface HistoriaScreenProps {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  lexChip: string;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  /** "Mejorar con IA" server action (per-question gating via aiImproveEnabled). */
  improveAnswer?: ImproveAnswerFn;
}

export function HistoriaScreen({
  caseId,
  partyId,
  partyName,
  form,
  locale,
  labels,
  lexChip,
  saveDraft,
  submitForm,
  improveAnswer,
}: HistoriaScreenProps) {
  const router = useRouter();
  return (
    <FormWizard
      caseId={caseId}
      partyId={partyId}
      partyName={partyName}
      form={form}
      locale={locale}
      labels={labels}
      withLex
      lexChip={lexChip}
      saveDraft={saveDraft}
      submitForm={submitForm}
      improveAnswer={improveAnswer}
      onSubmitted={() => router.replace(`/caso/${caseId}/exito?from=historia`)}
      onExit={() => router.push(`/caso/${caseId}/camino`)}
    />
  );
}
