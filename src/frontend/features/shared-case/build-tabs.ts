/**
 * buildTabs — data-driven tab materialization (DOC-50 §4.1).
 *
 * Pure function (testable). For F2-W2-b only the first three tabs of the
 * canonical order are implemented (Resumen · Documentos · Partes); the rest of
 * the workspace (Generaciones, Citas, Expediente, Validación, Pagos, Contrato,
 * Mensajes, Bitácora) arrive in future phases. The registry below is the seam:
 * adding a future tab is a config entry, not a fork.
 *
 * Future filtering hooks (kept as comments to mirror RF-TRX-025 CA2):
 * - Validación only if the plan requires lawyer validation.
 * - Citas only if a phase defines an appointment policy.
 * - per-actor `canUi(permissions, module, 'view')`.
 */

import type { CaseTabId } from "./types";

export interface TabConfig {
  id: CaseTabId;
  label: string;
  /** badge count (e.g. documents to review), 0 = hidden. */
  badge?: number;
}

export interface BuildTabsInput {
  labels: { resumen: string; documentos: string; partes: string };
  documentsToReview: number;
}

export function buildTabs(input: BuildTabsInput): TabConfig[] {
  return [
    { id: "resumen", label: input.labels.resumen },
    {
      id: "documentos",
      label: input.labels.documentos,
      badge: input.documentsToReview,
    },
    { id: "partes", label: input.labels.partes },
  ];
}
