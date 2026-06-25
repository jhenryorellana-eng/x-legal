"use client";

/**
 * Ruta de citas / Citas tab (DOC-52 §5.5 / DOC-53 §3.4) — the case appointment
 * route for the current phase (stepper + cita cards with objectives) plus the
 * "Añadir cita" affordance. Rendered by RutaCitas over `vm.ruta`.
 */

import { RutaCitas } from "../components/ruta-citas";
import type { CaseWorkspaceVM, CaseDetailActions } from "../types";
import type { CasosStrings } from "../strings";

export function CitasTab({
  vm,
  actions,
  strings,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
}) {
  return <RutaCitas vm={vm} actions={actions} strings={strings} />;
}
