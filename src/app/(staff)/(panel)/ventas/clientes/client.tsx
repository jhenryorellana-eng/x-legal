"use client";

/**
 * Clientes client wrapper — provides Lex prefs and routes "Nuevo caso" to the
 * leads board (where the Nuevo caso modal lives) in F3. The list view itself
 * navigates to the shared-case workspace on row click.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ClientesListView,
  LexPrefsProvider,
  type CaseRowVM,
  type ClientesStrings,
} from "@/frontend/features/vanessa";

export function ClientesClient({
  cases,
  strings,
  readyClientName,
  readyCaseId,
}: {
  cases: CaseRowVM[];
  strings: ClientesStrings;
  readyClientName: string | null;
  readyCaseId: string | null;
}) {
  const router = useRouter();
  return (
    <LexPrefsProvider>
      <ClientesListView
        cases={cases}
        strings={strings}
        basePath="/ventas/clientes"
        onNewCase={() => router.push("/ventas/leads")}
        readyClientName={readyClientName}
        readyCaseId={readyCaseId}
      />
    </LexPrefsProvider>
  );
}
