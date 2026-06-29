/**
 * buildTabs — role-aware, data-driven tab materialization (DOC-52 §5 / DOC-53 §3).
 *
 * Vanessa (sales + paralegal/finance) sees the asesora set; Henry (admin) sees
 * the full admin set + Historial. Validación only shows for with_lawyer plans.
 * Mensajes only shows when chat actions are wired. Adding/reordering a tab is a
 * config change here — the shell renders whatever this returns.
 */

import type { CaseTabId, StaffRoleVM } from "./types";
import type { CasosStrings } from "./strings";

export interface TabConfig {
  id: CaseTabId;
  label: string;
  /** badge count (e.g. documents to review), 0/undefined = hidden. */
  badge?: number;
}

export interface BuildTabsInput {
  strings: CasosStrings;
  isAdmin: boolean;
  /** Staff role — drives the paralegal (Diana) tab set distinctly from sales. */
  role: StaffRoleVM;
  documentsToReview: number;
  hasChat: boolean;
  requiresLawyerValidation: boolean;
  /** The case has materials in already-passed phases → show the read-only tab. */
  hasPriorPhases: boolean;
}

export function buildTabs(input: BuildTabsInput): TabConfig[] {
  const tb = input.strings.detail.tabs;
  const tabs: TabConfig[] = [];

  if (input.role === "paralegal") {
    // Diana (paralegal) — DOC-54 §2 canonical order. She produces the case:
    // reviews docs, generates letters/forms, assembles + sends the expediente.
    tabs.push(
      { id: "resumen", label: tb.resumen },
      { id: "documentos", label: tb.documentos, badge: input.documentsToReview },
      { id: "formularios", label: tb.informacion },
      { id: "cartas", label: tb.cartas },
      { id: "expediente", label: tb.expediente },
    );
    if (input.requiresLawyerValidation) tabs.push({ id: "validacion", label: tb.validacion });
    if (input.hasPriorPhases) tabs.push({ id: "fasesAnteriores", label: tb.fasesAnteriores });
    tabs.push(
      { id: "citas", label: tb.citasRoute },
      { id: "traspaso", label: tb.traspaso },
      { id: "contrato", label: tb.contrato },
      { id: "historial", label: tb.historial },
    );
    if (input.hasChat) tabs.push({ id: "mensajes", label: tb.mensajes });
    return tabs;
  }

  if (input.isAdmin) {
    // Henry (admin) — DOC-53 §3 canonical order.
    tabs.push(
      { id: "resumen", label: tb.resumen },
      { id: "documentos", label: tb.documentos, badge: input.documentsToReview },
      { id: "formularios", label: tb.formularios },
      { id: "generaciones", label: tb.generaciones },
      { id: "citas", label: tb.citas },
      { id: "expediente", label: tb.expediente },
    );
    if (input.requiresLawyerValidation) tabs.push({ id: "validacion", label: tb.validacion });
    if (input.hasPriorPhases) tabs.push({ id: "fasesAnteriores", label: tb.fasesAnteriores });
    tabs.push(
      { id: "traspaso", label: tb.traspaso },
      { id: "pagos", label: tb.pagos },
      { id: "contrato", label: tb.contrato },
    );
    if (input.hasChat) tabs.push({ id: "mensajes", label: tb.mensajes });
    tabs.push({ id: "historial", label: tb.historial });
    return tabs;
  }

  // Vanessa (sales) — DOC-52 §5 canonical order.
  tabs.push(
    { id: "resumen", label: tb.resumen },
    { id: "contrato", label: tb.contrato },
    { id: "citas", label: tb.citasRoute },
    { id: "documentos", label: tb.documentos, badge: input.documentsToReview },
    { id: "formularios", label: tb.informacion },
    { id: "cartas", label: tb.cartas },
  );
  if (input.hasPriorPhases) tabs.push({ id: "fasesAnteriores", label: tb.fasesAnteriores });
  tabs.push(
    { id: "traspaso", label: tb.traspaso },
    { id: "historial", label: tb.historial },
  );
  if (input.hasChat) tabs.push({ id: "mensajes", label: tb.mensajes });
  return tabs;
}
