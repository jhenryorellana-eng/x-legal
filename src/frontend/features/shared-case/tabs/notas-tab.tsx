"use client";

/**
 * Notas tab — the case's notes (case + originating-lead union) with the 3
 * visibility levels. Wraps the reusable NotesPanel; notes are preloaded by the
 * RSC page (vm.notes) and the add/delete actions are injected via CaseDetailActions.
 */

import * as React from "react";
import { Card } from "@/frontend/components/brand/card";
import { NotesPanel, type NoteView, type NotesStrings } from "../notes";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";

export function NotasTab({
  vm,
  actions,
  strings,
  locale,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  locale: "es" | "en";
}) {
  const t = strings.detail;
  const n = t.notes;
  const panelStrings: NotesStrings = {
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

  const addNote = actions.addNote;
  const deleteNote = actions.deleteNote;

  return (
    <Card>
      <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 18, color: "var(--ink)" }}>
        {n.title}
      </h2>
      <p style={{ margin: "4px 0 18px", fontSize: 13.5, color: "var(--ink-2)" }}>{n.subtitle}</p>

      <NotesPanel
        notes={vm.notes ?? []}
        strings={panelStrings}
        locale={locale}
        onAdd={async (body, visibility): Promise<NoteView | null> => {
          if (!addNote) return null;
          const res = await addNote({ caseId: vm.header.caseId, body, visibility });
          return res.ok && res.note ? res.note : null;
        }}
        onRemove={async (noteId): Promise<boolean> => {
          if (!deleteNote) return false;
          const res = await deleteNote({ noteId });
          return res.ok;
        }}
      />
    </Card>
  );
}
