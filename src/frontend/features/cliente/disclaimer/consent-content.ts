/**
 * Consent content resolver — single source for the disclaimer text (DOC-51 §12).
 *
 * The disclaimer PAGE renders these sections and the accept ACTION snapshots the
 * exact same text into the acceptance record, so the downloadable signed consent
 * always matches what the client read. Both call this helper (no drift).
 *
 * The text still lives in i18n (`cliente.disclaimer.*`); this only shapes it.
 */

import type { ConsentDocumentSnapshot } from "@/shared/consent";

/** Number of numbered sections in the disclaimer (section1..section5). */
const SECTION_COUNT = 5;

/**
 * Builds the consent document from a `cliente.disclaimer` translator.
 * `t` is the next-intl translator scoped to that namespace (dynamic keys).
 */
export function buildConsentDocument(
  t: (key: string) => string,
  locale: string,
): ConsentDocumentSnapshot {
  return {
    locale,
    title: t("title"),
    sections: Array.from({ length: SECTION_COUNT }, (_, i) => {
      const n = i + 1;
      return { title: t(`section${n}.title`), body: t(`section${n}.body`) };
    }),
    closing: t("closing"),
  };
}
