/**
 * Pure helpers shared by the FormWizard engine (i18n + value coercion).
 * No React, no next-intl — surface-agnostic (cliente + staff preview).
 */

import type { I18nValue, Locale, WizardQuestion, AnswersMap } from "./types";

/** Resolves an `{en,es}` value for the active locale, with the other as fallback. */
export function pickI18n(value: I18nValue | null | undefined, locale: Locale): string {
  if (!value) return "";
  const primary = value[locale];
  if (primary) return primary;
  return locale === "es" ? value.en : value.es;
}

/** Coerces an unknown backend value to the string/boolean a control expects. */
export function coerceInitialValue(question: WizardQuestion, raw: unknown): unknown {
  if (question.fieldType === "checkbox") {
    if (raw === true || raw === "true" || raw === 1) return true;
    if (raw === false || raw === "false" || raw === 0) return false;
    return false;
  }
  if (raw == null) return "";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/**
 * Builds the initial answers map for the whole form: the saved answer wins; if
 * absent, a non-client prefill value seeds the field ("Ya lo tenemos"). Returns
 * both the answers and the set of question ids that started pre-filled (so the
 * UI can show the gold chip until the user edits).
 */
export function buildInitialAnswers(groups: { questions: WizardQuestion[] }[]): {
  answers: AnswersMap;
  prefilledIds: Set<string>;
} {
  const answers: AnswersMap = {};
  const prefilledIds = new Set<string>();
  for (const g of groups) {
    for (const q of g.questions) {
      const hasSaved = q.currentAnswer !== null && q.currentAnswer !== undefined && q.currentAnswer !== "";
      if (hasSaved) {
        answers[q.id] = coerceInitialValue(q, q.currentAnswer);
      } else if (q.isPrefilled && q.prefillValue != null && q.prefillValue !== "") {
        answers[q.id] = coerceInitialValue(q, q.prefillValue);
        prefilledIds.add(q.id);
      } else {
        answers[q.id] = coerceInitialValue(q, null);
      }
    }
  }
  return { answers, prefilledIds };
}

/**
 * True when the form is read-only for the client. A case_form_responses row can
 * only be draft/submitted/approved (DB CHECK) — 'in_validation' is a CASE status,
 * never a form-response status, so it's not checked here.
 */
export function isReadOnly(status: string | null): boolean {
  return status === "submitted" || status === "approved";
}
