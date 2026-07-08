import type { WizardLabels } from "./types";

/**
 * Resolves the full WizardLabels bundle from a next-intl translator.
 *
 * Lives in the feature but takes a plain `(key) => string` function so the engine
 * stays decoupled from next-intl — the server page passes `getTranslations(...)`
 * (cast to the loose signature). Keys live under `cliente.formWizard.*`.
 */
export function resolveWizardLabels(t: (key: string) => string): WizardLabels {
  // `stepCounter` is an ICU template ("Paso {n} de {total}") interpolated CLIENT-side
  // via .replace(); echo the placeholders back so next-intl returns the raw template
  // instead of throwing FORMATTING_ERROR for the missing {n}/{total} values.
  const tWithValues = t as (key: string, values?: Record<string, string>) => string;
  return {
    stepCounter: tWithValues("stepCounter", { n: "{n}", total: "{total}" }),
    back: t("back"),
    saving: t("saving"),
    saved: t("saved"),
    queued: t("queued"),
    saveError: t("saveError"),
    saveBlocked: t("saveBlocked"),
    saveBlockedSubmitted: t("saveBlockedSubmitted"),
    offlineBanner: t("offlineBanner"),
    prefillChip: t("prefillChip"),
    prefillFromDocument: t("prefillFromDocument"),
    prefillFromProfile: t("prefillFromProfile"),
    prefillFromGeneration: t("prefillFromGeneration"),
    prefillEdited: t("prefillEdited"),
    prefillAiBadge: t("prefillAiBadge"),
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
    approvedPill: t("approvedPill"),
    reviewClientBanner: t("reviewClientBanner"),
  };
}
