"use client";

/**
 * Leads client wrapper — provides the Lex prefs context and wires the three
 * modals (Nuevo lead = Vanessa's, Nuevo caso = reused admin NewCaseModal,
 * Gestionar categorías = category CRUD). The board view raises onNewLead /
 * onNewCase / onManageCategories; this shell opens the right modal. After a
 * category mutation it refreshes the route so chips + cards re-hydrate.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  LeadsView,
  NuevoLeadModal,
  CategoryManager,
  NuevaCitaModal,
  LexPrefsProvider,
  type LeadColumnVM,
  type LeadCardVM,
  type EditLeadPreset,
  type LeadsStrings,
  type NuevoLeadStrings,
  type SourceOption,
  type ServiceOption,
  type CategoryOption,
  type CategoryManagerStrings,
  type CategoryManagerActions,
  type NuevaCitaStrings,
  type NuevaCitaActions,
  type ProspectSearchResult,
} from "@/frontend/features/vanessa";
import {
  NewCaseModal,
  type NewCaseService,
  type NewCaseActions,
} from "@/frontend/features/admin/casos/new-case-modal";
import type { CasosStrings } from "@/frontend/features/shared-case";

export interface LeadsClientProps {
  columns: LeadColumnVM[];
  cards: LeadCardVM[];
  strings: LeadsStrings;
  viewingAs?: string | null;
  notesStrings: LeadsNotesStrings;
  noteActions: LeadsNoteActions;
  newLeadStrings: NuevoLeadStrings;
  manageCatsStrings: CategoryManagerStrings;
  nuevaCitaStrings: NuevaCitaStrings;
  staffTz: string;
  locale: "es" | "en";
  sources: SourceOption[];
  services: ServiceOption[];
  categories: CategoryOption[];
  newCaseServices: NewCaseService[];
  casosStrings: CasosStrings;
  boardId: string;
  moveAction: LeadsViewMove;
  contactAction: LeadsViewContact;
  columnActions: LeadsColumnActions;
  columnStrings: LeadsColumnStrings;
  createLeadAction: CreateLead;
  updateLeadAction: UpdateLead;
  createCategoryAction: CreateCategory;
  categoryActions: Omit<CategoryManagerActions, "create">;
  citaActions: NuevaCitaActions;
  createCaseAction: NewCaseActions["createCase"];
  searchClientsAction: NewCaseActions["searchClients"];
  getClientCasesAction: NewCaseActions["getClientCases"];
}

type LeadsViewMove = React.ComponentProps<typeof LeadsView>["actions"]["moveCard"];
type LeadsViewContact = NonNullable<React.ComponentProps<typeof LeadsView>["actions"]["contactLead"]>;
type LeadsNotesStrings = React.ComponentProps<typeof LeadsView>["notesStrings"];
type LeadsNoteActions = Pick<
  React.ComponentProps<typeof LeadsView>["actions"],
  "addNote" | "listNotes" | "deleteNote"
>;
type LeadsColumnActions = React.ComponentProps<typeof LeadsView>["columnActions"];
type LeadsColumnStrings = React.ComponentProps<typeof LeadsView>["columnStrings"];
type UpdateLead = NonNullable<React.ComponentProps<typeof NuevoLeadModal>["actions"]["updateLead"]>;
type CreateLead = React.ComponentProps<typeof NuevoLeadModal>["actions"]["createLead"];
type CreateCategory = React.ComponentProps<typeof NuevoLeadModal>["actions"]["createCategory"];

export function LeadsClient({
  columns,
  cards,
  strings,
  viewingAs,
  notesStrings,
  noteActions,
  newLeadStrings,
  manageCatsStrings,
  nuevaCitaStrings,
  staffTz,
  locale,
  sources,
  services,
  categories,
  newCaseServices,
  casosStrings,
  boardId,
  moveAction,
  contactAction,
  columnActions,
  columnStrings,
  createLeadAction,
  updateLeadAction,
  createCategoryAction,
  categoryActions,
  citaActions,
  createCaseAction,
  searchClientsAction,
  getClientCasesAction,
}: LeadsClientProps) {
  const router = useRouter();
  const [leadModal, setLeadModal] = React.useState<{ open: boolean; columnId?: string }>({ open: false });
  const [caseModal, setCaseModal] = React.useState<{ open: boolean; leadId?: string; name?: string | null; phone?: string }>({ open: false });
  const [editLead, setEditLead] = React.useState<EditLeadPreset | null>(null);
  const [catsOpen, setCatsOpen] = React.useState(false);
  const [scheduleProspect, setScheduleProspect] = React.useState<ProspectSearchResult | null>(null);

  // The board is server-rendered; a freshly created lead only shows after the
  // route re-hydrates. Refresh on success so the new card appears immediately.
  const createLeadWithRefresh: CreateLead = React.useCallback(
    async (input) => {
      const res = await createLeadAction(input);
      if (res.ok) router.refresh();
      return res;
    },
    [createLeadAction, router],
  );

  return (
    <LexPrefsProvider>
      <LeadsView
        boardId={boardId}
        columns={columns}
        cards={cards}
        strings={strings}
        viewingAs={viewingAs}
        notesStrings={notesStrings}
        locale={locale}
        columnStrings={columnStrings}
        actions={{
          moveCard: moveAction,
          contactLead: contactAction,
          addNote: noteActions.addNote,
          listNotes: noteActions.listNotes,
          deleteNote: noteActions.deleteNote,
        }}
        columnActions={columnActions}
        onNewLead={(columnId) => setLeadModal({ open: true, columnId })}
        onNewCase={(preset) => setCaseModal({ open: true, leadId: preset.leadId, name: preset.name, phone: preset.phone })}
        onScheduleLead={(lead) => setScheduleProspect({ ...lead })}
        onEditLead={(card) =>
          setEditLead({
            id: card.leadId,
            phone: card.phone,
            name: card.name,
            source: card.source,
            serviceId: card.serviceId,
            categoryId: card.categoryId,
            note: card.note,
          })
        }
        onOpenFilters={() => {}}
        onManageCategories={() => setCatsOpen(true)}
      />

      <NuevoLeadModal
        open={leadModal.open}
        onOpenChange={(o) => setLeadModal({ open: o })}
        sources={sources}
        services={services}
        categories={categories}
        strings={newLeadStrings}
        actions={{ createLead: createLeadWithRefresh, createCategory: createCategoryAction }}
      />

      {/* Edit lead — reuses the lead modal in edit mode (click a card). */}
      <NuevoLeadModal
        open={editLead != null}
        onOpenChange={(o) => {
          if (!o) {
            setEditLead(null);
            router.refresh();
          }
        }}
        editLead={editLead}
        sources={sources}
        services={services}
        categories={categories}
        strings={newLeadStrings}
        actions={{ createLead: createLeadWithRefresh, updateLead: updateLeadAction, createCategory: createCategoryAction }}
      />

      <CategoryManager
        open={catsOpen}
        onOpenChange={setCatsOpen}
        strings={manageCatsStrings}
        actions={{ ...categoryActions, create: createCategoryAction }}
        onChanged={() => router.refresh()}
      />

      <NuevaCitaModal
        open={scheduleProspect != null}
        onOpenChange={(o) => { if (!o) setScheduleProspect(null); }}
        staffTz={staffTz}
        locale={locale}
        strings={nuevaCitaStrings}
        actions={citaActions}
        presetProspect={scheduleProspect}
      />

      <NewCaseModal
        open={caseModal.open}
        onOpenChange={(o) => {
          setCaseModal((prev) => (o ? { ...prev, open: true } : { open: false }));
          // On close, re-hydrate the board so a just-converted lead disappears.
          if (!o) router.refresh();
        }}
        leadId={caseModal.leadId}
        presetName={caseModal.name ?? undefined}
        presetPhone={caseModal.phone}
        services={newCaseServices}
        strings={casosStrings}
        actions={{
          createCase: createCaseAction,
          searchClients: searchClientsAction,
          getClientCases: getClientCasesAction,
        }}
        caseLinkBase="/ventas/clientes"
      />
    </LexPrefsProvider>
  );
}
