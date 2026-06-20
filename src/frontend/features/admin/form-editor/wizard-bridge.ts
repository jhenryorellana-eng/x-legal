/**
 * Maps the admin form-editor VM (QuestionGroupVM/QuestionVM) onto the shared
 * FormWizard engine shapes (WizardForm/WizardGroup/WizardQuestion).
 *
 * This is what makes the editor's "preview fiel" use the SAME motor the client
 * app uses (DOC-53 §5.1.3 "render real, no captura"; SOT-3 — one engine, two
 * surfaces). No autosave/submit happens in the preview — the page injects no-op
 * actions and the read-only/version states never apply (status = null).
 */

import type { WizardForm, WizardGroup, WizardQuestion } from "@/frontend/features/form-wizard";
import type { QuestionGroupVM } from "./types";
import type { I18nValue as EditorI18n } from "../shared/i18n-field";

function i18n(v: EditorI18n | null | undefined): { en: string; es: string } {
  return { en: v?.en ?? "", es: v?.es ?? "" };
}

function mapQuestion(q: QuestionGroupVM["questions"][number], groupId: string): WizardQuestion {
  const raw = q.validation as { regex?: string; min?: number; max?: number } | null | undefined;
  const validation =
    raw && (raw.regex !== undefined || raw.min !== undefined || raw.max !== undefined)
      ? {
          ...(raw.regex !== undefined ? { regex: raw.regex } : {}),
          ...(raw.min !== undefined ? { min: raw.min } : {}),
          ...(raw.max !== undefined ? { max: raw.max } : {}),
        }
      : null;
  const isPrefilled = q.source !== "client_answer";
  return {
    id: q.id,
    groupId,
    questionI18n: i18n(q.question_i18n),
    helpI18n: q.help_i18n ? i18n(q.help_i18n) : null,
    fieldType: q.field_type,
    options: q.options ? q.options.map((o) => ({ value: o.value, labelI18n: i18n(o.label_i18n) })) : null,
    isRequired: q.is_required,
    position: q.position,
    source: q.source,
    validation,
    // Preview: seed a placeholder so the "Ya lo tenemos" chip shows correctly
    // (the real client gets the resolved value from the backend).
    prefillValue: isPrefilled ? "—" : null,
    isPrefilled,
    currentAnswer: null,
    // Carry the condition so the preview honors show/lock/require like the client.
    condition: q.condition ?? null,
  };
}

/** Builds a previewable WizardForm from the editor groups + form label. */
export function buildPreviewForm(
  groups: QuestionGroupVM[],
  versionId: string,
  labelI18n: { en: string; es: string },
): WizardForm {
  const wizardGroups: WizardGroup[] = groups.map((g) => ({
    id: g.id,
    titleI18n: i18n(g.title_i18n),
    position: g.position,
    questions: g.questions.map((q) => mapQuestion(q, g.id)).sort((a, b) => a.position - b.position),
  }));
  wizardGroups.sort((a, b) => a.position - b.position);

  return {
    responseId: null,
    formDefinitionId: "preview",
    labelI18n,
    kind: "pdf_automation",
    isPerParty: false,
    versionId,
    status: null, // never read-only in preview
    sourceLanguage: "en",
    submittedAt: null,
    filledPdfPath: null,
    filledBy: "client",
    groups: wizardGroups,
  };
}
