/**
 * buildTabs — role-aware, DECLARATIVE tab materialization (DOC-52 §5 / DOC-53 §3).
 *
 * Data source of truth is shared/constants/case-tabs.ts (ids, per-role default
 * order, canonical order, gating). This file adds the LABELS (TAB_META) and the
 * runtime assembly:
 *   1. order + role visibility  → resolveRoleTabIds(role, allowedOverride)
 *   2. per-tab visibility gate   → TAB_META.visible (conditional tabs)
 *   3. state gate                → locked when payment_pending (non-admin)
 *
 * `allowedTabIds` is the org admin's per-role override (visibility only, from the
 * case_tab_role_access table). `null`/absent → the role's code default set.
 * Order + the "locked until active" gating always come from code.
 */

import {
  resolveRoleTabIds,
  TAB_LOCKED_UNTIL_ACTIVE,
  type CaseTabId,
  type StaffRole,
} from "@/shared/constants/case-tabs";
import type { StaffRoleVM } from "./types";
import type { CasosStrings } from "./strings";

export interface TabConfig {
  id: CaseTabId;
  label: string;
  /** badge count (e.g. documents to review), 0/undefined = hidden. */
  badge?: number;
  /** Locked (shown greyed with a padlock) — click shows the "case not active" hint. */
  locked?: boolean;
}

export interface BuildTabsInput {
  strings: CasosStrings;
  isAdmin: boolean;
  /** Staff role — drives the per-role tab set + order. */
  role: StaffRoleVM;
  documentsToReview: number;
  /** Case not yet active (status === 'payment_pending') → gate the operativo tabs. */
  isPaymentPending: boolean;
  requiresLawyerValidation: boolean;
  /** The case has materials in already-passed phases → show the read-only tab. */
  hasPriorPhases: boolean;
  /** The case's service has an ai_letter with Pre-Mortem enabled → show the tab. */
  hasPreMortem: boolean;
  /**
   * Org admin override of the visible tabs for THIS effective role (from
   * case_tab_role_access). `null`/absent → the role's code default set.
   */
  allowedTabIds?: readonly CaseTabId[] | null;
}

type TabsStrings = CasosStrings["detail"]["tabs"];

interface TabMeta {
  /** Label resolver. Some ids read a different string for admin vs asesora. */
  label: (tb: TabsStrings, isAdmin: boolean) => string;
  /** Extra visibility predicate (conditional tabs). Absent → always visible. */
  visible?: (input: BuildTabsInput) => boolean;
  /** Optional badge count. */
  badge?: (input: BuildTabsInput) => number | undefined;
}

const LOCKED = new Set<CaseTabId>(TAB_LOCKED_UNTIL_ACTIVE);

/**
 * Per-tab metadata (labels + conditional/badge gates). The label for
 * `citas`/`formularios` differs by surface: the asesora set says "Ruta de citas"
 * / "Información", the admin set says "Citas" / "Formularios" — same id.
 */
const TAB_META: Record<CaseTabId, TabMeta> = {
  resumen: { label: (tb) => tb.resumen },
  contrato: { label: (tb) => tb.contrato },
  citas: { label: (tb, isAdmin) => (isAdmin ? tb.citas : tb.citasRoute) },
  documentos: {
    label: (tb) => tb.documentos,
    badge: (input) => input.documentsToReview,
  },
  formularios: { label: (tb, isAdmin) => (isAdmin ? tb.formularios : tb.informacion) },
  generaciones: { label: (tb) => tb.generaciones },
  traspaso: { label: (tb) => tb.traspaso },
  notas: { label: (tb) => tb.notas },
  historial: { label: (tb) => tb.historial },
  pagos: { label: (tb) => tb.pagos },
  expediente: { label: (tb) => tb.expediente },
  validacion: {
    label: (tb) => tb.validacion,
    visible: (input) => input.requiresLawyerValidation,
  },
  fasesAnteriores: {
    label: (tb) => tb.fasesAnteriores,
    visible: (input) => input.hasPriorPhases,
  },
  preMortem: {
    label: (tb) => tb.preMortem,
    visible: (input) => input.hasPreMortem,
  },
};

export function buildTabs(input: BuildTabsInput): TabConfig[] {
  const tb = input.strings.detail.tabs;
  const effectiveRole: StaffRole = input.isAdmin ? "admin" : (input.role as StaffRole);
  const order = resolveRoleTabIds(effectiveRole, input.allowedTabIds ?? null);

  const tabs: TabConfig[] = [];
  for (const id of order) {
    const meta = TAB_META[id];
    if (!meta) continue;
    if (meta.visible && !meta.visible(input)) continue;
    tabs.push({
      id,
      label: meta.label(tb, input.isAdmin),
      badge: meta.badge?.(input),
      locked: LOCKED.has(id) && input.isPaymentPending && !input.isAdmin,
    });
  }
  return tabs;
}
