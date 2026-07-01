/**
 * case-tabs module — public border (module-pub).
 *
 * Org-level, admin-configurable per-role visibility of the case-workspace tabs.
 * Pages read `getCaseTabAccess` to resolve the override; the admin matrix uses
 * the server actions. Order + state-gating stay in code (shared/constants).
 *
 * @module case-tabs
 */

export { getCaseTabAccess, type CaseTabAccessDto, type SetCaseTabAccessInput } from "./service";
