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

/**
 * Full US mailing address captured at case intake (DOC-40 §2.7). Stored as the
 * `client_profiles.address` JSONB so resolveBySource('profile') can prefill the
 * I-589 address sub-fields (address.line1/city/state/zip/apartment).
 */
export interface ClientAddressInput {
  line1: string;
  city: string;
  state: string;
  zip: string;
  /** Apartment / unit / suite — optional. */
  apartment?: string | null;
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
// Gate: "solo teléfonos con caso" — DOC-22 §1.4
//
// A client is eligible to sign in if:
//   - users.phone_e164 = <phone> AND users.kind = 'client' AND users.is_active = true
//   - AND EXISTS at least 1 case_members row (the case may be payment_pending —
//     a client must reach their platform to PAY the initial fee; the case
//     workspace itself stays locked until the downpayment is confirmed, gated in
//     the case shell layout, not here).
//
// This query runs with the SERVICE CLIENT to bypass RLS (DOC-22 §1.4).
// ---------------------------------------------------------------------------

/**
 * Checks whether a phone number belongs to an eligible client.
 * A client is eligible if they have kind='client', is_active=true, and are a
 * member of at least one case (paid or not — the case workspace is gated
 * separately until payment).
 *
 * Anti-enumeration: always returns { eligible: false } on any error —
 * errors are logged server-side but NOT surfaced to callers.
 */
export async function checkClientEligibility(
  phoneE164: string,
): Promise<ClientEligibilityResult> {
  try {
    const supabase = createServiceClient();

    // Single query: client user that is a member of AT LEAST ONE case (paid or
    // not). The case need NOT be activated (opened_at) — a client with a
    // payment_pending case must be able to sign in to their platform precisely
    // SO THEY CAN PAY. Access to the case workspace itself stays gated until the
    // downpayment is confirmed (enforced in the case shell, not here).
    const { data, error } = await supabase
      .from("users")
      .select(
        `
        id,
        is_active,
        kind,
        case_members!inner(case_id)
      `,
      )
      .eq("phone_e164", phoneE164)
      .eq("kind", "client")
      .eq("is_active", true)
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
     
    email: (row.users as any)?.email ?? "",
     
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

// ---------------------------------------------------------------------------
// Staff identity look-ups (C-1 / H-3 guards)
// ---------------------------------------------------------------------------

export interface StaffIdentityRow {
  userId: string;
  orgId: string;
  isActive: boolean;
  role: string;
}

/**
 * Loads the minimal identity row for a staff member.
 * Used by C-1 (org membership check) and H-3 (last-admin guard).
 * Returns null if the userId does not exist or is not a staff member.
 */
export async function findStaffById(
  userId: string,
): Promise<StaffIdentityRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, org_id, is_active, staff_profiles(role)")
    .eq("id", userId)
    .eq("kind", "staff")
    .maybeSingle();

  if (!data) return null;

   
  const role = (data.staff_profiles as any)?.[0]?.role ?? (data.staff_profiles as any)?.role ?? "staff";

  return {
    userId: data.id,
    orgId: data.org_id,
    isActive: data.is_active,
    role,
  };
}

/**
 * Counts the number of active admin staff members for an org.
 * Used by H-3 (last-admin guard in deactivateEmployee).
 *
 * Strategy: fetch user_ids of all active staff in the org, then count how many
 * have role=admin in staff_profiles. Two queries; service client, no RLS.
 *
 * FAIL-CLOSED: on any error the function returns 1 ("assume the target is the
 * only admin"), which BLOCKS admin deactivation. Wrongly blocking is retryable;
 * wrongly deactivating the last admin locks the org out — never risk that.
 */
export async function countActiveAdminsByOrg(orgId: string): Promise<number> {
  try {
    const supabase = createServiceClient();

    // Step 1: active staff user IDs for the org
    const { data: activeUsers, error: usersError } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .eq("kind", "staff")
      .eq("is_active", true);

    if (usersError) return 1; // fail-closed
    if (!activeUsers || activeUsers.length === 0) return 0;

    const activeIds = activeUsers.map((u) => u.id);

    // Step 2: count how many of those are admins
    const { count, error: profileError } = await supabase
      .from("staff_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin")
      .in("user_id", activeIds);

    if (profileError || count == null) return 1; // fail-closed
    return count;
  } catch {
    return 1; // fail-closed: if the DB is unreachable, block admin deactivation
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
// provisionClientUser repo helpers (DOC-22 §1.2 — H-2 resolution)
// ---------------------------------------------------------------------------

/**
 * Looks up a client user by phone_e164. Returns { id, email, existed:true } when
 * found, null when not found. Service-client (bypass RLS). The email is the
 * Supabase Auth identity used to sign the client in during phone-only login
 * (DOC-22 §1, June 2026) — the client never types it.
 */
export async function findClientByPhone(
  phoneE164: string,
): Promise<{ id: string; email: string | null; existed: true } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, email")
    .eq("phone_e164", phoneE164)
    .eq("kind", "client")
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, email: data.email, existed: true };
}

/**
 * Looks up a client user by email (the login identity). Returns { id } when
 * found, null otherwise. Service-client (bypass RLS). Used by provisionClientUser
 * for idempotency by email (DOC-22 §1, client auth by email).
 */
export async function findClientByEmail(
  email: string,
): Promise<{ id: string; existed: true } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .eq("kind", "client")
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, existed: true };
}

/**
 * Inserts a users + client_profiles row for a newly provisioned client.
 * Called AFTER auth.admin.createUser so the auth UID is already known.
 * Idempotent: uses upsert on both tables.
 */
export async function insertClientRows(input: {
  userId: string;
  orgId: string;
  /** Login identity (DOC-22 §1, client auth by email). */
  email: string;
  /** Contact phone (also a login credential alongside email — DOC-22 §1). */
  phoneE164?: string | null;
  firstName: string;
  lastName: string;
  /** Full US mailing address — persisted to client_profiles.address (JSONB). */
  address?: ClientAddressInput | null;
  locale?: string;
  timezone?: string;
}): Promise<void> {
  const supabase = createServiceClient();

  // Upsert users row. email is the login identity; phone_e164 is optional contact.
  const { error: usersError } = await supabase
    .from("users")
    .upsert(
      {
        id: input.userId,
        org_id: input.orgId,
        kind: "client",
        email: input.email,
        phone_e164: input.phoneE164 ?? null,
        is_active: true,
        locale: input.locale ?? "en",
        timezone: input.timezone ?? "America/New_York",
      },
      { onConflict: "id" },
    );

  if (usersError) throw new Error(`insertClientRows.users: ${usersError.message}`);

  // Build the address JSONB only when an address was captured. Keys mirror the
  // address.* whitelist in PROFILE_SOURCE_FIELDS so resolveBySource can prefill.
  const addressJson: Json | undefined = input.address
    ? {
        line1: input.address.line1,
        city: input.address.city,
        state: input.address.state,
        zip: input.address.zip,
        // null (not "") when absent — resolveBySource returns null → PDF stays blank.
        apartment: input.address.apartment ?? null,
      }
    : undefined;

  // Upsert client_profiles (user_id UNIQUE). Only set `address` when provided,
  // so re-provisioning without an address doesn't wipe an existing one.
  const { error: profileError } = await supabase
    .from("client_profiles")
    .upsert(
      {
        user_id: input.userId,
        first_name: input.firstName,
        last_name: input.lastName,
        ...(addressJson !== undefined ? { address: addressJson } : {}),
      },
      { onConflict: "user_id" },
    );

  if (profileError) throw new Error(`insertClientRows.client_profiles: ${profileError.message}`);
}

// ---------------------------------------------------------------------------
// Client picker search + contact update (RF-VAN-018 — "Nuevo caso" step 1)
// ---------------------------------------------------------------------------

export interface ClientSearchRow {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phoneE164: string | null;
  address: ClientAddressInput | null;
  caseCount: number;
}

/**
 * Parses the client_profiles.address JSONB defensively into ClientAddressInput.
 * Older profiles may lack the address or hold partial shapes — return null when
 * nothing usable is present so the UI simply leaves the fields empty.
 */
function parseAddressJson(json: Json | null): ClientAddressInput | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const a = json as Record<string, unknown>;
  const line1 = typeof a.line1 === "string" ? a.line1 : "";
  const city = typeof a.city === "string" ? a.city : "";
  const state = typeof a.state === "string" ? a.state : "";
  const zip = typeof a.zip === "string" ? a.zip : "";
  if (!line1 && !city && !state && !zip) return null;
  return {
    line1,
    city,
    state,
    zip,
    apartment: typeof a.apartment === "string" && a.apartment ? a.apartment : null,
  };
}

/**
 * Searches active clients of an org by name (trigram), email, or phone digits
 * via the search_clients_for_staff RPC (migration 0062). Empty query returns
 * the most recent clients. Service-client: the RPC is service_role-only; the
 * caller (identity.searchClients) is the authz gate.
 */
export async function searchClientRows(
  orgId: string,
  query: string,
  limit: number,
): Promise<ClientSearchRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("search_clients_for_staff", {
    p_org: orgId,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw new Error(`searchClientRows: ${error.message}`);
  return (data ?? []).map((r) => ({
    userId: r.user_id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phoneE164: r.phone_e164,
    address: parseAddressJson(r.address),
    caseCount: Number(r.case_count),
  }));
}

/**
 * Looks up a client by id WITHIN an org (cross-org guard for the "existing
 * client" case-creation path). Returns null when missing, not a client, or
 * belonging to another org. Service-client (bypass RLS).
 */
export async function findClientById(
  userId: string,
  orgId: string,
): Promise<{ id: string; email: string | null; phoneE164: string | null } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, email, phone_e164")
    .eq("id", userId)
    .eq("org_id", orgId)
    .eq("kind", "client")
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, email: data.email, phoneE164: data.phone_e164 };
}

/**
 * Persists the step-1 ADDRESS edit for an existing client (RF-VAN-018).
 * Name, phone and email are IMMUTABLE in this flow — the phone is the client's
 * login credential (one account per client, DOC-22 §1) and identity fixes are
 * an explicit admin operation, never a side effect of case creation. Only
 * client_profiles.address is written (it prefills the I-589).
 */
export async function updateClientAddressRow(input: {
  userId: string;
  address: ClientAddressInput;
}): Promise<void> {
  const supabase = createServiceClient();

  const addressJson: Json = {
    line1: input.address.line1,
    city: input.address.city,
    state: input.address.state,
    zip: input.address.zip,
    apartment: input.address.apartment ?? null,
  };

  const { error } = await supabase
    .from("client_profiles")
    .update({ address: addressJson })
    .eq("user_id", input.userId);
  if (error) {
    throw new Error(`updateClientAddressRow: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// updateUserLocale — persist the user's UI language (DOC-24 i18n / DOC-47 §5)
// ---------------------------------------------------------------------------

/**
 * Updates `users.locale` for a single user. Source of truth for the language of
 * transactional emails + push (read server-side from users.locale); the
 * `ulp-locale` cookie is its operational mirror, set alongside by the action.
 */
export async function updateUserLocale(userId: string, locale: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update({ locale }).eq("id", userId);
  if (error) throw new Error(`updateUserLocale: ${error.message}`);
}

// ---------------------------------------------------------------------------
// updateUserTimezone — persist the user's IANA timezone (DOC-23 §6.5)
// ---------------------------------------------------------------------------

/**
 * Updates `users.timezone` for a single user. Source of truth for rendering
 * appointment slots/times in the client's local time; the `ulp-tz` cookie is
 * its operational mirror (read by next-intl's getTimeZone), set by the action.
 */
export async function updateUserTimezone(userId: string, timezone: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update({ timezone }).eq("id", userId);
  if (error) throw new Error(`updateUserTimezone: ${error.message}`);
}

// ---------------------------------------------------------------------------
// updateUserLocation — persist timezone + city/country (DOC-23 §6.5)
// ---------------------------------------------------------------------------

/**
 * Updates `users.timezone` + city/country/country_code and stamps
 * location_confirmed_at. Used by the "Detect my location" flow (browser
 * geolocation → reverse geocode) in Configuración.
 */
/** Reads a user's timezone + city/country (for the Configuración location card). */
export async function findUserLocation(
  userId: string,
): Promise<{ timezone: string; city: string | null; country: string | null } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("timezone, city, country")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return { timezone: data.timezone, city: data.city, country: data.country };
}

export async function updateUserLocation(
  userId: string,
  input: { timezone: string; city: string | null; country: string | null; countryCode: string | null },
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("users")
    .update({
      timezone: input.timezone,
      city: input.city,
      country: input.country,
      country_code: input.countryCode,
      location_confirmed_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) throw new Error(`updateUserLocation: ${error.message}`);
}

// ---------------------------------------------------------------------------
// User UI prefs (theme + text scale) — DOC-01 §4/§8.5, per-user persistence
// ---------------------------------------------------------------------------

/** Reads the user's stored theme + text scale (per-user appearance). */
export async function findUserUiPrefs(
  userId: string,
): Promise<{ theme: string; text_scale: number } | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("theme, text_scale")
    .eq("id", userId)
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}

/** Persists the user's theme and/or text scale (each role is independent). */
export async function updateUserUiPrefs(
  userId: string,
  patch: { theme?: string; text_scale?: number },
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) throw new Error(`updateUserUiPrefs: ${error.message}`);
}

// ---------------------------------------------------------------------------
// upsertPersonRecord repo helper (DOC-41 §3.1 — party provisioning)
// ---------------------------------------------------------------------------

/**
 * Upserts a person_records row for a case party who is NOT a user.
 * Returns the existing or newly-created row id.
 *
 * No true upsert key in the schema (no UNIQUE across first_name+last_name+org)
 * so we always INSERT and return the new id. Callers that need idempotency
 * must check before calling (the service layer handles this for bulk upsert).
 */
export async function insertPersonRecord(input: {
  orgId: string;
  createdBy: string;
  firstName: string;
  lastName: string;
  relationship?: string | null;
}): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("person_records")
    .insert({
      org_id: input.orgId,
      created_by: input.createdBy,
      first_name: input.firstName,
      last_name: input.lastName,
      relationship: input.relationship ?? null,
      pii_encrypted: {} as import("@/shared/database.types").Json,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`insertPersonRecord: ${error?.message}`);
  return data.id;
}

// ---------------------------------------------------------------------------
// case_parties repo helper
// ---------------------------------------------------------------------------

/**
 * Inserts a case_parties row. Called during createCaseFromContract.
 */
export async function insertCasePartyRow(input: {
  caseId: string;
  personRecordId: string | null;
  userId: string | null;
  partyRole: string;
  position: number;
}): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("case_parties").insert({
    case_id: input.caseId,
    person_record_id: input.personRecordId,
    user_id: input.userId,
    party_role: input.partyRole,
    position: input.position,
  });

  if (error) throw new Error(`insertCasePartyRow: ${error.message}`);
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
        case_members!inner(case_id)
      `,
      )
      .eq("id", userId)
      .eq("kind", "client")
      .eq("is_active", true)
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
