/**
 * Case-workspace tabs — SHARED source of truth (data only, no labels).
 *
 * The frontend (build-tabs.ts) resolves labels + renders; the backend
 * (case-tabs module) validates admin overrides against these ids. Keeping the
 * ids / order / per-role defaults / gating here lets both sides agree without
 * crossing the boundary (frontend↛backend).
 *
 * Role access to each tab is: the per-role default set (ROLE_DEFAULT_TAB_ORDER)
 * UNLESS an org admin configured an override (case_tab_role_access table). Order
 * always comes from code; the override only decides visibility. The
 * "locked until the case is active" gating (TAB_LOCKED_UNTIL_ACTIVE) is a
 * product/state rule, not a role rule — it is never admin-configurable.
 */

export const STAFF_ROLES = ["admin", "sales", "paralegal", "finance"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const CASE_TAB_IDS = [
  "resumen",
  "contrato",
  "pagos",
  "documentos",
  "formularios",
  "generaciones",
  "lex",
  "citas",
  "preMortem",
  "expediente",
  "validacion",
  "fasesAnteriores",
  "traspaso",
  "notas",
  "historial",
] as const;

export type CaseTabId = (typeof CASE_TAB_IDS)[number];

export function isCaseTabId(value: string): value is CaseTabId {
  return (CASE_TAB_IDS as readonly string[]).includes(value);
}

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Master order — used to place any override-enabled tab that isn't in a role's
 * default order, and as the row order of the admin matrix.
 */
export const CANONICAL_TAB_ORDER: readonly CaseTabId[] = [
  "resumen",
  "contrato",
  "pagos",
  "documentos",
  "formularios",
  "generaciones",
  "lex",
  "citas",
  "preMortem",
  "expediente",
  "validacion",
  "fasesAnteriores",
  "traspaso",
  "notas",
  "historial",
];

/**
 * Per-role default tab set AND canonical order (DOC-52 §5 / DOC-53 §3 / DOC-54 §2).
 * `pagos` is admin + sales + finance; `generaciones` (canonical "Generaciones",
 * formerly "Cartas") is the AI-letters tab for paralegal + admin; `lex` (the case
 * AI chat) is available to every staff role; messaging is a header button, not a
 * tab. Admin sees the full set.
 */
export const ROLE_DEFAULT_TAB_ORDER: Record<StaffRole, CaseTabId[]> = {
  sales: [
    "resumen",
    "contrato",
    "pagos",
    "citas",
    "documentos",
    "formularios",
    "lex",
    "fasesAnteriores",
    "traspaso",
    "notas",
    "historial",
  ],
  admin: [
    "resumen",
    "documentos",
    "formularios",
    "generaciones",
    "lex",
    "citas",
    "preMortem",
    "expediente",
    "validacion",
    "fasesAnteriores",
    "traspaso",
    "pagos",
    "contrato",
    "notas",
    "historial",
  ],
  paralegal: [
    "resumen",
    "documentos",
    "formularios",
    "generaciones",
    "lex",
    "preMortem",
    "expediente",
    "validacion",
    "fasesAnteriores",
    "citas",
    "traspaso",
    "contrato",
    "notas",
    "historial",
  ],
  finance: ["resumen", "contrato", "pagos", "documentos", "lex", "notas", "historial"],
};

/** Tabs locked (padlock) while the case is not active — never admin-configurable. */
export const TAB_LOCKED_UNTIL_ACTIVE: readonly CaseTabId[] = [
  "citas",
  "documentos",
  "formularios",
  "traspaso",
];

/**
 * Resolves the ordered, visible tab ids for a role.
 *
 * @param role            effective role (admin uses the admin set)
 * @param allowedOverride when the org admin configured this role → the allow-set
 *                        (visibility only). `null`/`undefined` → use the default set.
 *
 * Order = the role's default order, then any override-enabled extra appended in
 * CANONICAL_TAB_ORDER. Pure — safe to call on server or client.
 */
export function resolveRoleTabIds(
  role: StaffRole,
  allowedOverride?: readonly CaseTabId[] | null,
): CaseTabId[] {
  const defaultOrder = ROLE_DEFAULT_TAB_ORDER[role] ?? ROLE_DEFAULT_TAB_ORDER.sales;
  if (!allowedOverride) return [...defaultOrder];

  const allowed = new Set(allowedOverride);
  const ordered = defaultOrder.filter((id) => allowed.has(id));
  // Append override-enabled tabs that aren't in the role's default order.
  for (const id of CANONICAL_TAB_ORDER) {
    if (allowed.has(id) && !defaultOrder.includes(id)) ordered.push(id);
  }
  return ordered;
}
