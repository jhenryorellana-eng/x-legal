/**
 * Copy for the "questionnaire is waiting on a prerequisite form" gate.
 *
 * WHY THIS EXISTS. `/historia` and `/formulario/[formId]` are SERVICE-AGNOSTIC
 * screens: the same gate renders for Asilo, Reforzar Asilo, Apelación and every
 * service added later. The copy nonetheless hardcoded "el formulario I-589" — an
 * Asilo form — so an Apelación client (whose entry form is the EOIR-26) was told
 * to complete a form their case does not contain.
 *
 * The prerequisite is already declared as data (the questionnaire's
 * `prerequisite_form_slugs`) and its label travels in the DTO as
 * `missingPrereqs.formLabels`. This resolves that label for the reader's locale
 * and degrades to a generic sentence — never to a guessed form name — when the
 * list is empty (a prerequisite that is documents-only, or a label we could not
 * resolve).
 */

import { resolveI18n, type Locale } from "@/shared/i18n";

export interface MissingPrereqs {
  forms: string[];
  documents: string[];
  /** `*_i18n` label objects; `resolveI18n` accepts them untyped and degrades safely. */
  formLabels: readonly unknown[];
}

/**
 * Formats the pending forms as a readable list: "A", "A y B", "A, B y C".
 *
 * Returns null when nothing can be named — the caller must then fall back to the
 * generic copy (`qPendingBodyGeneric`) rather than invent a form name. Kept as a
 * pure string builder (instead of taking the translator) so next-intl's key
 * typing stays intact at each call site.
 *
 * @param missing the DTO's `missingPrereqs` (null when the gate is not about prereqs)
 * @param locale  reader's locale — also picks the list conjunction
 */
export function formatPendingPrereqForms(
  missing: MissingPrereqs | null | undefined,
  locale: Locale,
): string | null {
  const names = (missing?.formLabels ?? [])
    .map((l) => resolveI18n(l, locale).trim())
    .filter(Boolean);

  if (names.length === 0) return null;
  if (names.length === 1) return names[0];

  const and = locale === "en" ? "and" : "y";
  return `${names.slice(0, -1).join(", ")} ${and} ${names[names.length - 1]}`;
}
