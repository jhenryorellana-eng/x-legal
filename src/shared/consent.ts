/**
 * Consent document snapshot — the exact text the client read and accepted on the
 * in-app disclaimer (DOC-51 §12), frozen at acceptance time for non-repudiation.
 *
 * Shared shape: the frontend (disclaimer page + accept action) builds it from
 * i18n, the backend persists it in contract_terms_acceptances.document_snapshot
 * and renders it (text + signature) into the downloadable signed consent PDF.
 */

export interface ConsentSection {
  title: string;
  body: string;
}

export interface ConsentDocumentSnapshot {
  /** Locale the client viewed/accepted ("es" | "en"). */
  locale: string;
  /** Document title (e.g. "Antes de empezar"). */
  title: string;
  /** Numbered consent sections, in display order. */
  sections: ConsentSection[];
  /** Closing paragraph shown under the sections. */
  closing: string;
}
