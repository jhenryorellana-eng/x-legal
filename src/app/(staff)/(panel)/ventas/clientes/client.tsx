"use client";

/**
 * Clientes client wrapper — provides Lex prefs and opens the "Nuevo caso" modal
 * in place (DOC-52 §2.7: "Mis clientes" launches the same NewCaseModal as the
 * Leads board, with no preset). The list view itself navigates to the
 * shared-case workspace on row click.
 */

import * as React from "react";
import {
  ClientesListView,
  LexPrefsProvider,
  type CaseRowVM,
  type ClientesStrings,
} from "@/frontend/features/vanessa";
import {
  NewCaseModal,
  type NewCaseService,
  type NewCaseActions,
} from "@/frontend/features/admin/casos/new-case-modal";
import type { CasosStrings } from "@/frontend/features/shared-case";

export function ClientesClient({
  cases,
  strings,
  readyClientName,
  readyCaseId,
  newCaseServices,
  casosStrings,
  createCaseAction,
  signingBaseUrl,
}: {
  cases: CaseRowVM[];
  strings: ClientesStrings;
  readyClientName: string | null;
  readyCaseId: string | null;
  newCaseServices: NewCaseService[];
  casosStrings: CasosStrings;
  createCaseAction: NewCaseActions["createCase"];
  signingBaseUrl: string;
}) {
  const [caseModal, setCaseModal] = React.useState(false);

  return (
    <LexPrefsProvider>
      <ClientesListView
        cases={cases}
        strings={strings}
        basePath="/ventas/clientes"
        onNewCase={() => setCaseModal(true)}
        readyClientName={readyClientName}
        readyCaseId={readyCaseId}
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
