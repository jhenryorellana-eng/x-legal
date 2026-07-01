/**
 * case-tabs — repository (data access).
 *
 * Stores the org-level per-role visibility override of the case-workspace tabs
 * (case_tab_role_access). Reads apply RLS (staff of the org); writes are gated to
 * admin by RLS + the service. When a role is saved we upsert the FULL canonical
 * tab set (enabled flag per tab) so "configured but shows nothing" is
 * distinguishable from "not configured" (has rows vs no rows).
 *
 * @module case-tabs/repository
 */

import { createServerClient } from "@/backend/platform/supabase";
import { CANONICAL_TAB_ORDER, type CaseTabId, type StaffRole } from "@/shared/constants/case-tabs";

export interface TabAccessRow {
  role: string;
  tab_id: string;
  enabled: boolean;
}

/** All override rows for the caller's org (RLS-scoped). */
export async function findTabAccessRows(): Promise<TabAccessRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("case_tab_role_access")
    .select("role, tab_id, enabled");
  return (data ?? []) as TabAccessRow[];
}

/**
 * Upserts the full canonical tab set for a role (enabled = allowed). Idempotent
 * on (org_id, role, tab_id). Storing the full set keeps "role sees nothing"
 * (all disabled) distinct from "not configured" (no rows).
 */
export async function upsertRoleTabAccess(
  orgId: string,
  role: StaffRole,
  allowed: readonly CaseTabId[],
  updatedBy: string,
): Promise<void> {
  const supabase = await createServerClient();
  const allowedSet = new Set(allowed);
  const rows = CANONICAL_TAB_ORDER.map((tab) => ({
    org_id: orgId,
    role,
    tab_id: tab,
    enabled: allowedSet.has(tab),
    updated_by: updatedBy,
  }));

  const { error } = await supabase
    .from("case_tab_role_access")
    .upsert(rows, { onConflict: "org_id,role,tab_id" });

  if (error) {
    throw new Error(`case-tabs.repository: upsertRoleTabAccess failed — ${error.message}`);
  }
}
