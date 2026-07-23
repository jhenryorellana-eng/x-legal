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
  holidays,
  todayYmd,
  createCaseAction,
  searchClientsAction,
  getClientCasesAction,
  checkClientPhoneAction,
}: {
  cases: CaseRowVM[];
  strings: ClientesStrings;
  readyClientName: string | null;
  readyCaseId: string | null;
  newCaseServices: NewCaseService[];
  casosStrings: CasosStrings;
  holidays?: string[];
  todayYmd?: string;
  createCaseAction: NewCaseActions["createCase"];
  searchClientsAction: NewCaseActions["searchClients"];
  getClientCasesAction: NewCaseActions["getClientCases"];
  checkClientPhoneAction: NonNullable<NewCaseActions["checkClientPhone"]>;
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
        holidays={holidays}
        todayYmd={todayYmd}
        strings={casosStrings}
        actions={{
          createCase: createCaseAction,
          searchClients: searchClientsAction,
          getClientCases: getClientCasesAction,
          checkClientPhone: checkClientPhoneAction,
        }}
        caseLinkBase="/ventas/clientes"
      />
    </LexPrefsProvider>
  );
}
