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
  signingBaseUrl: string;
  moveAction: LeadsViewMove;
  createLeadAction: CreateLead;
  createCategoryAction: CreateCategory;
  categoryActions: Omit<CategoryManagerActions, "create">;
  citaActions: NuevaCitaActions;
  createCaseAction: NewCaseActions["createCase"];
}

type LeadsViewMove = React.ComponentProps<typeof LeadsView>["actions"]["moveCard"];
type CreateLead = React.ComponentProps<typeof NuevoLeadModal>["actions"]["createLead"];
type CreateCategory = React.ComponentProps<typeof NuevoLeadModal>["actions"]["createCategory"];

export function LeadsClient({
  columns,
  cards,
  strings,
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
  signingBaseUrl,
  moveAction,
  createLeadAction,
  createCategoryAction,
  categoryActions,
  citaActions,
  createCaseAction,
}: LeadsClientProps) {
  const router = useRouter();
  const [leadModal, setLeadModal] = React.useState<{ open: boolean; columnId?: string }>({ open: false });
  const [caseModal, setCaseModal] = React.useState<{ open: boolean; leadId?: string }>({ open: false });
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
        columns={columns}
        cards={cards}
        strings={strings}
        actions={{ moveCard: moveAction }}
        onNewLead={(columnId) => setLeadModal({ open: true, columnId })}
        onNewCase={(preset) => setCaseModal({ open: true, leadId: preset.leadId })}
        onScheduleLead={(lead) => setScheduleProspect({ ...lead })}
        onOpenColumnMenu={() => {}}
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
          setCaseModal({ open: o, leadId: o ? caseModal.leadId : undefined });
          // On close, re-hydrate the board so a just-converted lead disappears.
          if (!o) router.refresh();
        }}
        leadId={caseModal.leadId}
        services={newCaseServices}
        strings={casosStrings}
        actions={{ createCase: createCaseAction }}
        signingBaseUrl={signingBaseUrl}
      />
    </LexPrefsProvider>
  );
}
