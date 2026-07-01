/**
 * case-tabs — service (business logic + authorization).
 *
 * getCaseTabAccess: staff read of the org's per-role tab overrides. Roles WITH
 * rows appear in `allowedByRole` (their enabled tabs — possibly []); roles
 * WITHOUT rows are absent → the consumer uses the code default set.
 *
 * setCaseTabAccess: admin-only write of the visible tab set per role.
 *
 * @module case-tabs/service
 */

import { AuthzError, type Actor } from "@/backend/platform/authz";
import { writeAudit } from "@/backend/modules/audit";
import {
  isCaseTabId,
  isStaffRole,
  type CaseTabId,
  type StaffRole,
} from "@/shared/constants/case-tabs";
import { findTabAccessRows, upsertRoleTabAccess } from "./repository";

export interface CaseTabAccessDto {
  /**
   * Enabled tabs per CONFIGURED role. A role present here (even with []) means an
   * override exists → use exactly this set. A role ABSENT means no override →
   * use the code default (resolveRoleTabIds with null).
   */
  allowedByRole: Partial<Record<StaffRole, CaseTabId[]>>;
}

/** Reads the org's per-role tab overrides (RLS-scoped to the caller's org). */
export async function getCaseTabAccess(actor: Actor): Promise<CaseTabAccessDto> {
  if (actor.kind !== "staff") return { allowedByRole: {} };

  const rows = await findTabAccessRows();
  const allowedByRole: Partial<Record<StaffRole, CaseTabId[]>> = {};

  for (const r of rows) {
    if (!isStaffRole(r.role)) continue;
    // Presence of any row marks the role as configured (default to [] = show nothing).
    const list = (allowedByRole[r.role] ??= []);
    if (r.enabled && isCaseTabId(r.tab_id)) list.push(r.tab_id);
  }

  return { allowedByRole };
}

export interface SetCaseTabAccessInput {
  access: Array<{ role: StaffRole; tabIds: CaseTabId[] }>;
}

/** Admin-only: replaces the visible tab set per role for the caller's org. */
export async function setCaseTabAccess(
  actor: Actor,
  input: SetCaseTabAccessInput,
): Promise<void> {
  if (actor.kind !== "staff" || actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }

  const saved: StaffRole[] = [];
  for (const entry of input.access) {
    if (!isStaffRole(entry.role)) continue;
    const allowed = entry.tabIds.filter(isCaseTabId);
    await upsertRoleTabAccess(actor.orgId, entry.role, allowed, actor.userId);
    saved.push(entry.role);
  }

  await writeAudit(actor, "case_tabs.access.updated", "case_tab_role_access", actor.orgId, {
    after: { roles: saved },
  });
}
