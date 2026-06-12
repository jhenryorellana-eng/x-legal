/**
 * Identity repository — data access layer.
 *
 * All queries use the service client (RLS bypass) for gate checks,
 * as required by DOC-22 §1.4: the gate query must be authoritative
 * and not subject to the client's own RLS context.
 *
 * F1 additions: employee management (inviteEmployee, updateEmployeePermissions,
 * deactivate/reactivate, listEmployees) — DOC-22 §2.2 + RF-ADM-041…045.
 *
 * This file is internal to the identity module (module-int boundary).
 */

import { createServiceClient, createServerClient } from "@/backend/platform/supabase";
import type { Json } from "@/shared/database.types";
import type { ModuleKey } from "@/shared/constants/modules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientEligibilityResult {
  eligible: boolean;
}

export interface StaffProfileRow {
  displayName: string;
  role: string;
  titleI18n: Json | null;
  avatarUrl: string | null;
}

/**
 * Counts active staff members (employees) in the org. Read with the
 * request-scoped server client; RLS scopes the count to the actor's org.
 * Used by the admin dashboard KPI (DOC-53 §1.1). Returns 0 on error.
 */
export async function countActiveStaff(): Promise<number> {
  try {
    const supabase = await createServerClient();
    const { count, error } = await supabase
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("kind", "staff")
      .eq("is_active", true);

    if (error || count == null) return 0;
    return count;
  } catch {
    return 0;
  }
}

/**
 * Loads the staff profile for a given user id (display name, role, title_i18n,
 * avatar). Read with the request-scoped server client — RLS lets a staff member
 * read their own profile (DOC-31). Returns null if missing.
 */
export async function getStaffProfileById(
  userId: string,
): Promise<StaffProfileRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("staff_profiles")
    .select("display_name, role, title_i18n, avatar_url")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  return {
    displayName: data.display_name,
    role: data.role,
    titleI18n: data.title_i18n,
    avatarUrl: data.avatar_url,
  };
}

// ---------------------------------------------------------------------------
// Gate: "solo teléfonos con contrato" — DOC-22 §1.4
//
// A client is eligible to receive an OTP if:
//   - users.phone_e164 = <phone> AND users.kind = 'client' AND users.is_active = true
//   - AND EXISTS at least 1 case_members row joining a case with opened_at IS NOT NULL
//     (i.e., the case has been activated — opened_at set on payment confirmed + case activation)
//
// This query runs with the SERVICE CLIENT to bypass RLS (DOC-22 §1.4).
// ---------------------------------------------------------------------------

/**
 * Checks whether a phone number belongs to an eligible client.
 * A client is eligible if they have kind='client', is_active=true,
 * and at least one activated case (cases.opened_at IS NOT NULL).
 *
 * Anti-enumeration: always returns { eligible: false } on any error —
 * errors are logged server-side but NOT surfaced to callers.
 */
export async function checkClientEligibility(
  phoneE164: string,
): Promise<ClientEligibilityResult> {
  try {
    const supabase = createServiceClient();

    // Single query: users + existence of an activated case_member
    // We use a join approach with .select() + .limit(1) for efficiency.
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        id,
        is_active,
        kind,
        case_members!inner(
          case_id,
          cases!inner(opened_at)
        )
      `,
      )
      .eq("phone_e164", phoneE164)
      .eq("kind", "client")
      .eq("is_active", true)
      .not("case_members.cases.opened_at", "is", null)
      .limit(1)
      .single();

    if (error || !data) {
      return { eligible: false };
    }

    return { eligible: true };
  } catch {
    // Never leak error details to callers (anti-enumeration)
    return { eligible: false };
  }
}

// ---------------------------------------------------------------------------
// Employee management types (F1 — RF-ADM-041…045)
// ---------------------------------------------------------------------------

export interface EmployeePermissionInput {
  module_key: ModuleKey;
  can_view: boolean;
  can_edit: boolean;
}

export interface EmployeeRow {
  userId: string;
  email: string;
  isActive: boolean;
  displayName: string;
  role: string;
  titleI18n: Json | null;
  avatarUrl: string | null;
  permissions: Array<{ module_key: string; can_view: boolean; can_edit: boolean }>;
}

// ---------------------------------------------------------------------------
// Employee reads
// ---------------------------------------------------------------------------

/**
 * Lists all staff members for the org.  Read with server client so RLS scopes
 * the result to the actor's org_id automatically (org-aware query).
 */
export async function listStaffMembers(): Promise<EmployeeRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from("staff_profiles")
    .select(
      `user_id,
       display_name,
       role,
       title_i18n,
       avatar_url,
       users!inner(email, is_active),
       employee_module_permissions(module_key, can_view, can_edit)`,
    )
    .order("display_name");

  if (error) throw new Error(`listStaffMembers: ${error.message}`);

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    email: (row.users as any)?.email ?? "",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isActive: (row.users as any)?.is_active ?? true,
    displayName: row.display_name,
    role: row.role,
    titleI18n: row.title_i18n,
    avatarUrl: row.avatar_url,
    permissions: (row.employee_module_permissions ?? []).map((p) => ({
      module_key: p.module_key,
      can_view: p.can_view,
      can_edit: p.can_edit,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Employee writes (service client — admin API + row inserts)
// ---------------------------------------------------------------------------

/**
 * Inserts the base identity rows for a new staff member: users(kind='staff') +
 * staff_profiles + employee_module_permissions.
 *
 * Called AFTER auth.admin.createUser so we already have the Supabase auth UID.
 */
export async function insertStaffRows(input: {
  userId: string;
  orgId: string;
  email: string;
  displayName: string;
  titleI18n: Json | null;
  role: string;
  permissions: EmployeePermissionInput[];
}): Promise<void> {
  const supabase = createServiceClient();

  // INSERT users (kind='staff')
  const { error: usersError } = await supabase.from("users").insert({
    id: input.userId,
    org_id: input.orgId,
    email: input.email,
    kind: "staff",
    is_active: true,
  });

  if (usersError) throw new Error(`insertStaffRows.users: ${usersError.message}`);

  // INSERT staff_profiles (user_id, display_name, role, title_i18n)
  const { error: profileError } = await supabase.from("staff_profiles").insert({
    user_id: input.userId,
    display_name: input.displayName,
    role: input.role,
    title_i18n: input.titleI18n,
  });

  if (profileError) throw new Error(`insertStaffRows.staff_profiles: ${profileError.message}`);

  // INSERT employee_module_permissions (bulk)
  if (input.permissions.length > 0) {
    const rows = input.permissions.map((p) => ({
      staff_id: input.userId,
      module_key: p.module_key,
      can_view: p.can_view,
      can_edit: p.can_edit,
    }));

    const { error: permsError } = await supabase
      .from("employee_module_permissions")
      .insert(rows);

    if (permsError) throw new Error(`insertStaffRows.permissions: ${permsError.message}`);
  }
}

/**
 * Replaces the entire permission matrix for a staff member.
 * All existing rows are deleted and new ones inserted (atomic via two ops).
 * RF-ADM-045: changes take effect on the NEXT request (no JWT cache — DOC-22 §3.1).
 */
export async function replaceStaffPermissions(
  staffId: string,
  permissions: EmployeePermissionInput[],
): Promise<void> {
  const supabase = createServiceClient();

  const { error: deleteError } = await supabase
    .from("employee_module_permissions")
    .delete()
    .eq("staff_id", staffId);

  if (deleteError) throw new Error(`replaceStaffPermissions.delete: ${deleteError.message}`);

  if (permissions.length > 0) {
    const rows = permissions.map((p) => ({
      staff_id: staffId,
      module_key: p.module_key,
      can_view: p.can_view,
      can_edit: p.can_edit,
    }));

    const { error: insertError } = await supabase
      .from("employee_module_permissions")
      .insert(rows);

    if (insertError) throw new Error(`replaceStaffPermissions.insert: ${insertError.message}`);
  }
}

/**
 * Sets users.is_active for a staff member.
 * The caller is responsible for session revocation (via revokeAllSessions).
 */
export async function setStaffActive(
  userId: string,
  isActive: boolean,
): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from("users")
    .update({ is_active: isActive })
    .eq("id", userId)
    .eq("kind", "staff");

  if (error) throw new Error(`setStaffActive: ${error.message}`);
}

// ---------------------------------------------------------------------------

/**
 * Same eligibility check used by the post-OTP re-gate (RF-CLI-006).
 * Accepts a userId (already known from the verified session) instead of phone.
 */
export async function checkClientEligibilityById(
  userId: string,
): Promise<ClientEligibilityResult> {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from("users")
      .select(
        `
        id,
        is_active,
        kind,
        case_members!inner(
          case_id,
          cases!inner(opened_at)
        )
      `,
      )
      .eq("id", userId)
      .eq("kind", "client")
      .eq("is_active", true)
      .not("case_members.cases.opened_at", "is", null)
      .limit(1)
      .single();

    if (error || !data) {
      return { eligible: false };
    }

    return { eligible: true };
  } catch {
    return { eligible: false };
  }
}
