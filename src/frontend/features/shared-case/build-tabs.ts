/**
 * buildTabs — role-aware, data-driven tab materialization (DOC-52 §5 / DOC-53 §3).
 *
 * Vanessa (sales + paralegal/finance) sees the asesora set; Henry (admin) sees
 * the full admin set + Historial. Validación only shows for with_lawyer plans.
 * Mensajes only shows when chat actions are wired. Adding/reordering a tab is a
 * config change here — the shell renders whatever this returns.
 */

import type { CaseTabId } from "./types";
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
  documentsToReview: number;
  hasChat: boolean;
  requiresLawyerValidation: boolean;
}

export function buildTabs(input: BuildTabsInput): TabConfig[] {
  const tb = input.strings.detail.tabs;
  const tabs: TabConfig[] = [];

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
    tabs.push(
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
    { id: "traspaso", label: tb.traspaso },
    { id: "historial", label: tb.historial },
  );
  if (input.hasChat) tabs.push({ id: "mensajes", label: tb.mensajes });
  return tabs;
}
