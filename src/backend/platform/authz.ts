/**
 * Authorization layer — DOC-22 §5.2 and §7 (Actor model).
 *
 * Three exports for the common authorization patterns:
 *
 * 1. `can(actor, moduleKey, action)` — module-level staff authorization.
 *    Always throws AuthzError; never returns false silently.
 *    Admin role bypasses the permissions map entirely (RF-ADM-045 A2).
 *    `edit` action implies `view` (RF-ADM-045).
 *
 * 2. `getActor()` — React cache()-memoized Actor construction per request.
 *    One DB query per request (users.is_active + employee_module_permissions).
 *
 * 3. `requireActor()` — like getActor() but throws AuthzError('unauthenticated')
 *    instead of returning null.
 *
 * 4. `systemActor()` — synthetic Actor for QStash jobs / webhooks.
 *
 * Wiring rule (DOC-22 §7):
 *   - actions.ts / route handlers → call requireActor() → pass Actor to service.ts
 *   - service.ts → call can() as first line
 *   - service.ts NEVER touches cookies, headers, or auth.*
 */

import { cache } from "react";
import type { ModuleKey } from "@/shared/constants/modules";
import { createServerClient } from "./supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Action = "view" | "edit";

export interface Actor {
  userId: string;
  orgId: string;
  kind: "client" | "staff";
  /** null for clients */
  role: "admin" | "sales" | "paralegal" | "finance" | null;
  /** Empty map for clients; populated per request from employee_module_permissions */
  permissions: ReadonlyMap<ModuleKey, { view: boolean; edit: boolean }>;
}

// ---------------------------------------------------------------------------
// AuthzError
// ---------------------------------------------------------------------------

export class AuthzError extends Error {
  constructor(
    public readonly reason:
      | "unauthenticated"
      | "inactive"
      | "forbidden_module"
      | "forbidden_case"
      | "wrong_kind",
  ) {
    super(reason);
    this.name = "AuthzError";
    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthzError);
    }
  }
}

// ---------------------------------------------------------------------------
// can() — module-level authorization (staff only)
// ---------------------------------------------------------------------------

/**
 * Authorizes a staff Actor against a module and action.
 *
 * - Admin role: bypasses the permissions map entirely (RF-ADM-045 A2).
 * - edit implies view (RF-ADM-045): `can(actor, 'cases', 'view')` passes if
 *   the actor has `edit=true` on 'cases'.
 * - Never returns false — throws AuthzError on denial.
 *
 * @throws AuthzError('wrong_kind') — actor is a client (use requireCaseAccess instead)
 * @throws AuthzError('forbidden_module') — no permission or insufficient action
 */
export function can(actor: Actor, moduleKey: ModuleKey, action: Action): void {
  // Rule: can() is for staff only (DOC-22 §5.2)
  if (actor.kind !== "staff") {
    throw new AuthzError("wrong_kind");
  }

  // Admin role: total bypass — the matrix does NOT restrict admin (RF-ADM-045 A2)
  if (actor.role === "admin") {
    return;
  }

  const p = actor.permissions.get(moduleKey);

  // Module not in the permissions map at all → denied
  if (!p) {
    throw new AuthzError("forbidden_module");
  }

  // edit implies view: if the actor has edit, view is implicitly granted
  if (action === "view" && (p.view || p.edit)) {
    return;
  }

  if (action === "edit" && p.edit) {
    return;
  }

  throw new AuthzError("forbidden_module");
}

// ---------------------------------------------------------------------------
// Internal helpers for getActor
// ---------------------------------------------------------------------------

interface CustomClaims {
  org_id: string;
  user_kind: "client" | "staff" | "unprovisioned";
  /** user_role claim (NOT 'role' — that's reserved by Supabase, DOC-22 §3.1) */
  user_role: "admin" | "sales" | "paralegal" | "finance" | null;
}

function readCustomClaims(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any,
): CustomClaims | null {
  // Custom claims from the Access Token Hook (DOC-22 §3.2):
  // The hook sets {org_id, user_kind, user_role} at the TOP LEVEL of the JWT
  // (NOT inside app_metadata). When getUser() validates against the Auth server,
  // Supabase JS SDK v2 returns the user object which merges the validated JWT
  // payload. Top-level JWT claims are accessible directly on the user object.
  //
  // getClaims() (available in @supabase/supabase-js 2.67+) reads these directly
  // from the JWT without a server round-trip. In middleware we use getClaims();
  // here in getActor() we use getUser() (authoritative server validation) and
  // read from the merged user object.
  //
  // Fallback to user.app_metadata for backward compatibility during hook activation
  // ramp-up (the hook is not yet activated — claims may be absent).
  //
  // Hook NOT activated (DOC-22 §3.2 TODO): all three claims will be null →
  // readCustomClaims returns null → getActor() returns null → no guard passes.
  // Safe degradation confirmed.
  const topLevel = (user as Record<string, unknown>) ?? {};
  const appMeta = (user?.app_metadata as Record<string, unknown>) ?? {};

  const org_id =
    (topLevel["org_id"] as string) ??
    (appMeta["org_id"] as string) ??
    null;
  const user_kind =
    (topLevel["user_kind"] as string) ??
    (appMeta["user_kind"] as string) ??
    null;
  const user_role =
    (topLevel["user_role"] as string | null) ??
    (appMeta["user_role"] as string | null) ??
    null;

  if (!org_id || !user_kind) return null;

  return {
    org_id,
    user_kind: user_kind as CustomClaims["user_kind"],
    user_role: (user_role ?? null) as CustomClaims["user_role"],
  };
}

interface ActorRow {
  is_active: boolean;
  kind: "client" | "staff";
  permissions: Array<{
    module_key: string;
    can_view: boolean;
    can_edit: boolean;
  }>;
}

async function loadActorRow(
  userId: string,
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<ActorRow | null> {
  const { data: userRow, error: userErr } = await supabase
    .from("users")
    .select("is_active, kind")
    .eq("id", userId)
    .single();

  if (userErr || !userRow) return null;

  if (userRow.kind !== "staff") {
    // Clients have no module permissions
    return {
      is_active: userRow.is_active,
      kind: "client",
      permissions: [],
    };
  }

  // Staff: fetch module permissions
  const { data: perms } = await supabase
    .from("employee_module_permissions")
    .select("module_key, can_view, can_edit")
    .eq("staff_id", userId);

  return {
    is_active: userRow.is_active,
    kind: "staff",
    permissions: perms ?? [],
  };
}

function toPermissionMap(
  permissions: ActorRow["permissions"],
): ReadonlyMap<ModuleKey, { view: boolean; edit: boolean }> {
  const map = new Map<ModuleKey, { view: boolean; edit: boolean }>();
  for (const p of permissions) {
    map.set(p.module_key as ModuleKey, { view: p.can_view, edit: p.can_edit });
  }
  return map;
}

// ---------------------------------------------------------------------------
// getActor — memoized per request (React cache)
// ---------------------------------------------------------------------------

/**
 * Builds and memoizes the Actor for the current request.
 *
 * Uses React `cache()` so this is computed at most once per request regardless
 * of how many modules call it.
 *
 * Always uses `supabase.auth.getUser()` (validates against the Auth server;
 * never trusts `getSession()` alone — DOC-22 §7).
 *
 * Returns null if:
 * - No session
 * - user_kind === 'unprovisioned'
 * - users.is_active === false (desactivated user with live token — DOC-22 §9.2)
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const claims = readCustomClaims(user);
  if (!claims || claims.user_kind === "unprovisioned") return null;

  const row = await loadActorRow(user.id, supabase);
  if (!row || !row.is_active) return null;

  return {
    userId: user.id,
    orgId: claims.org_id,
    kind: claims.user_kind as "client" | "staff",
    role: claims.user_role,
    permissions:
      row.kind === "staff"
        ? toPermissionMap(row.permissions)
        : new Map(),
  };
});

// ---------------------------------------------------------------------------
// requireActor — throws on unauthenticated
// ---------------------------------------------------------------------------

/**
 * Like getActor() but throws AuthzError('unauthenticated') instead of null.
 *
 * Use in actions.ts / route handlers that require a logged-in user.
 */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new AuthzError("unauthenticated");
  return actor;
}

// ---------------------------------------------------------------------------
// requireCaseAccess — client-side case authorization
// ---------------------------------------------------------------------------

/**
 * Authorizes access to a specific case.
 *
 * - Staff: delegates to can(actor, 'cases', 'view')
 * - Client: verifies case_members membership via a DB query
 *
 * @throws AuthzError('forbidden_case') if client is not a case member
 */
export async function requireCaseAccess(
  actor: Actor,
  caseId: string,
): Promise<void> {
  if (actor.kind === "staff") {
    can(actor, "cases", "view");
    return;
  }

  // Client: check case_members
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("case_members")
    .select("id")
    .eq("user_id", actor.userId)
    .eq("case_id", caseId)
    .single();

  if (error || !data) {
    throw new AuthzError("forbidden_case");
  }
}

// ---------------------------------------------------------------------------
// systemActor — for QStash jobs and webhooks
// ---------------------------------------------------------------------------

/**
 * Returns a synthetic Actor for system-level operations (jobs, webhooks).
 *
 * Jobs MUST NOT skip authorization (DOC-22 §7 rule 3). They construct a
 * system actor and still call can() to keep the authorization contract uniform.
 *
 * Note: the systemActor has no real userId — use the `requested_by` field
 * from the job payload when you need to attribute an action to a user.
 */
export function systemActor(): Actor {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    orgId: "00000000-0000-0000-0000-000000000000",
    kind: "staff",
    role: "admin",
    permissions: new Map(),
  };
}
