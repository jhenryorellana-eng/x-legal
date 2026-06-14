import type { WizardLabels } from "./types";

/**
 * Resolves the full WizardLabels bundle from a next-intl translator.
 *
 * Lives in the feature but takes a plain `(key) => string` function so the engine
 * stays decoupled from next-intl — the server page passes `getTranslations(...)`
 * (cast to the loose signature). Keys live under `cliente.formWizard.*`.
 */
export function resolveWizardLabels(t: (key: string) => string): WizardLabels {
  return {
    stepCounter: t("stepCounter"),
    back: t("back"),
    saving: t("saving"),
    saved: t("saved"),
    queued: t("queued"),
    saveError: t("saveError"),
    prefillChip: t("prefillChip"),
    prefillFromDocument: t("prefillFromDocument"),
    prefillFromProfile: t("prefillFromProfile"),
    prefillFromGeneration: t("prefillFromGeneration"),
    prefillEdited: t("prefillEdited"),
    selectPlaceholder: t("selectPlaceholder"),
    textareaPlaceholder: t("textareaPlaceholder"),
    checkboxYes: t("checkboxYes"),
    errRequired: t("errRequired"),
    errRegex: t("errRegex"),
    errMin: t("errMin"),
    errMax: t("errMax"),
    next: t("next"),
    finish: t("finish"),
    submitting: t("submitting"),
    submitErrorTitle: t("submitErrorTitle"),
    submitErrorBody: t("submitErrorBody"),
    privacyNote: t("privacyNote"),
    dictateIdle: t("dictateIdle"),
    dictateActive: t("dictateActive"),
    dictateUnsupported: t("dictateUnsupported"),
    submittedPill: t("submittedPill"),
    submittedTitle: t("submittedTitle"),
    submittedBody: t("submittedBody"),
  };
}
