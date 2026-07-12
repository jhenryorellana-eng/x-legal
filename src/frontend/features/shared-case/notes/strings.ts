/**
 * buildNotesStrings — plain NotesStrings map from the canonical
 * `staff.casos.detail.notes` namespace (same buildStrings pattern as the rest of
 * shared-case). Used by board pages (leads/casos note modals); the case tab reads
 * the same block via CasosStrings.
 */

import es from "@/frontend/i18n/messages/es.json";
import en from "@/frontend/i18n/messages/en.json";
import type { NotesStrings } from "./notes-panel";

export function buildNotesStrings(locale: "es" | "en"): NotesStrings {
  const n = (locale === "en" ? en : es).staff.casos.detail.notes;
  return {
    composerPlaceholder: n.composerPlaceholder,
    save: n.save,
    empty: n.empty,
    fromLead: n.fromLead,
    delete: n.delete,
    confirmDelete: n.confirmDelete,
    cancel: n.cancel,
    loading: n.loading,
    errorGeneric: n.errorGeneric,
    filterAll: n.filterAll,
    visibility: {
      general: { label: n.visibility.general.label, hint: n.visibility.general.hint },
      team: { label: n.visibility.team.label, hint: n.visibility.team.hint },
      personal: { label: n.visibility.personal.label, hint: n.visibility.personal.hint },
    },
  };
}
