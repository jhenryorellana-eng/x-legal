"use client";

/**
 * Leads client wrapper — provides the Lex prefs context and wires the two
 * modals (Nuevo lead = Vanessa's, Nuevo caso = reused admin NewCaseModal). The
 * board view raises onNewLead / onNewCase; this shell opens the right modal with
 * the preset. Column CRUD / filters are F3-deferred to a toast (degradation).
 */

import * as React from "react";
import {
  LeadsView,
  NuevoLeadModal,
  LexPrefsProvider,
  type LeadColumnVM,
  type LeadCardVM,
  type LeadsStrings,
  type NuevoLeadStrings,
  type SourceOption,
  type ServiceOption,
  type CategoryOption,
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
  sources: SourceOption[];
  services: ServiceOption[];
  newCaseServices: NewCaseService[];
  casosStrings: CasosStrings;
  signingBaseUrl: string;
  moveAction: LeadsViewMove;
  createLeadAction: CreateLead;
  createCategoryAction: CreateCategory;
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
  sources,
  services,
  newCaseServices,
  casosStrings,
  signingBaseUrl,
  moveAction,
  createLeadAction,
  createCategoryAction,
  createCaseAction,
}: LeadsClientProps) {
  const [leadModal, setLeadModal] = React.useState<{ open: boolean; columnId?: string }>({ open: false });
  const [caseModal, setCaseModal] = React.useState(false);

  const categories: CategoryOption[] = [
    { id: "caliente", label: "Caliente", color: "#E4002B" },
    { id: "tibio", label: "Tibio", color: "#F59E0B" },
    { id: "frio", label: "Frío", color: "#5B8CFF" },
    { id: "vip", label: "VIP", color: "#FFC629" },
  ];

  return (
    <LexPrefsProvider>
      <LeadsView
        columns={columns}
        cards={cards}
        strings={strings}
        actions={{ moveCard: moveAction }}
        onNewLead={(columnId) => setLeadModal({ open: true, columnId })}
        onNewCase={() => setCaseModal(true)}
        onOpenColumnMenu={() => {}}
        onOpenFilters={() => {}}
      />

      <NuevoLeadModal
        open={leadModal.open}
        onOpenChange={(o) => setLeadModal({ open: o })}
        sources={sources}
        services={services}
        categories={categories}
        strings={newLeadStrings}
        actions={{ createLead: createLeadAction, createCategory: createCategoryAction }}
      />

      <NewCaseModal
        open={caseModal}
        onOpenChange={setCaseModal}
        services={newCaseServices}
        strings={casosStrings}
        actions={{ createCase: createCaseAction }}
        signingBaseUrl={signingBaseUrl}
      />
    </LexPrefsProvider>
  );
}
