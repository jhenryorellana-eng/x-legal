/**
 * Identity service — F0 + F1 use cases (DOC-22 §1, §2, §6).
 *
 * Use cases implemented:
 * F0:
 * - requestClientOtp      (anonymous) — normalize, rate limit, gate, signInWithOtp
 * - verifyClientOtp       (anonymous) — rate limit, verifyOtp, re-gate post-session
 * - requestStaffPasswordReset (anonymous) — resetPasswordForEmail, uniform response
 * - updateStaffPassword   (authenticated) — zxcvbn score check, updateUser
 *
 * F1 (employee management — RF-ADM-041…045):
 * - inviteEmployee             — DOC-22 §2.2 exact flow
 * - updateEmployeePermissions  — RF-ADM-045 immediate effect
 * - deactivateEmployee         — with session revocation
 * - reactivateEmployee         — clears ban, re-enables login
 * - listEmployees              — staff panel list
 *
 * Authorization rules per DOC-22 §5.2:
 * - Anonymous use cases: no Actor required (explicitly documented here per DOC-22 §7)
 * - Authenticated use cases: requireActor() + can() as first line
 */

import crypto from "node:crypto";

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

import { getActor, requireActor, can, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { createServerClient, createServiceClient, revokeAllSessions } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import {
  limitOtpSendEmail,
  limitOtpSendIp,
  limitOtpVerifyEmail,
} from "@/backend/platform/ratelimit";
import { sendTransactional, FROM_TRANSACTIONAL } from "@/backend/platform/resend";
import { appEvents } from "@/backend/platform/events";

import type { ModuleKey } from "@/shared/constants/modules";
import { MODULE_KEYS } from "@/shared/constants/modules";
import { escapeHtml } from "@/shared/html";

import {
  normalizePhoneE164,
  normalizeEmailStrict,
  EmailValidationError,
  passwordPolicy,
} from "./domain";
import {
  checkClientEligibilityByEmail,
  checkClientEligibilityById,
  countActiveStaff,
  getStaffProfileById,
  findStaffById,
  countActiveAdminsByOrg,
  listStaffMembers,
  insertStaffRows,
  replaceStaffPermissions,
  setStaffActive,
  findClientByEmail,
  insertClientRows,
  insertPersonRecord,
  type StaffProfileRow,
  type EmployeePermissionInput,
  type EmployeeRow,
} from "./repository";

// Audit module — imported via dynamic require to avoid circular deps at module load
// (audit → platform only; identity → platform; no true cycle but dynamic avoids
// potential init ordering issues in tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _audit: { writeAudit: (...args: any[]) => Promise<void> } | null = null;
async function getAudit() {
  if (!_audit) {
    _audit = await import("@/backend/modules/audit");
  }
  return _audit;
}

// ---------------------------------------------------------------------------
// zxcvbn — lazy singleton factory
// ---------------------------------------------------------------------------

let _zxcvbnFactory: ZxcvbnFactory | null = null;

function getZxcvbnFactory(): ZxcvbnFactory {
  if (_zxcvbnFactory) return _zxcvbnFactory;
  // Build minimal options: adjacency graphs + common dictionaries.
  // We skip language-specific translations to avoid fflate decompression
  // issues in server-side ESM environments.
  // Cast via `any` because @zxcvbn-ts/core Options requires all fields but
  // the constructor accepts a partial subset at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _zxcvbnFactory = new ZxcvbnFactory({ graphs: adjacencyGraphs, dictionary } as any);
  return _zxcvbnFactory;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum latency floor for the OTP send action — anti-timing-analysis (DOC-22 §1.4) */
const OTP_LATENCY_FLOOR_MS = 800;

const ZXCVBN_MIN_SCORE = 3;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface OtpRequestResult {
  /** Always true — uniform response (DOC-22 §1.4 anti-enumeration) */
  ok: true;
}

export interface OtpVerifyResult {
  ok: true;
}

export interface PasswordResetResult {
  ok: true;
}

export interface PasswordUpdateResult {
  ok: true;
}

// ---------------------------------------------------------------------------
// Result types (F1)
// ---------------------------------------------------------------------------

export interface InviteEmployeeResult {
  ok: true;
  userId: string;
}

export interface UpdatePermissionsResult {
  ok: true;
}

export interface DeactivateEmployeeResult {
  ok: true;
}

export interface ReactivateEmployeeResult {
  ok: true;
}

export interface ListEmployeesResult {
  employees: EmployeeRow[];
}

// Re-export EmployeeRow type so callers don't need to import from repository
export type { EmployeeRow };

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class IdentityError extends Error {
  constructor(
    public readonly code:
      | "rate_limited"
      | "invalid_phone"
      | "invalid_email"
      | "invalid_otp"
      | "password_too_short"
      | "password_too_weak"
      | "unauthenticated"
      | "wrong_kind"
      | "employee_not_found"
      | "employee_already_exists"
      | "last_admin_protected",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "IdentityError";
  }
}

// ---------------------------------------------------------------------------
// requestClientOtp — anonymous use case (DOC-22 §1.3)
// No Actor required: this is a public endpoint. Documented per DOC-22 §7 rule 1.
// ---------------------------------------------------------------------------

/**
 * Requests an email OTP for a client (DOC-22 §1, SoT 2026-06-13: email auth).
 *
 * Steps:
 * 1. Normalize + validate email (server-side).
 * 2. Rate limit: email tiers (1/45s, 5/h, 8/d) + IP tiers (10/h, 30/d).
 * 3. GATE (service client): eligibility (kind=client, is_active, activated case).
 * 4. If eligible: supabase.auth.signInWithOtp({ email }) (shouldCreateUser=false).
 * 5. Apply 800ms latency floor (both branches take the same wall time — §1.4).
 * 6. Return { ok: true } ALWAYS — anti-enumeration.
 *
 * No SMS / Twilio: the 6-digit code is delivered by email (Supabase SMTP).
 *
 * @param rawEmail - Client email (the login identity captured at intake).
 * @param ip       - Request IP for per-IP rate limiting.
 */
export async function requestClientOtp(
  rawEmail: string,
  ip: string,
): Promise<OtpRequestResult> {
  const start = Date.now();

  // Step 1: Normalize + validate
  let email: string;
  try {
    email = normalizeEmailStrict(rawEmail);
  } catch (err) {
    if (err instanceof EmailValidationError) {
      await enforceFloor(start, OTP_LATENCY_FLOOR_MS);
      logger.info({ err: err.message }, "requestClientOtp: invalid email format");
      throw new IdentityError("invalid_email", err.message);
    }
    throw err;
  }

  // Step 2: Rate limit — sequential: email first, IP second (M-1 anti-timing).
  const emailRL = await limitOtpSendEmail(email);
  if (!emailRL.allowed) {
    await enforceFloor(start, OTP_LATENCY_FLOOR_MS);
    throw new IdentityError("rate_limited");
  }

  const ipRL = await limitOtpSendIp(ip);
  if (!ipRL.allowed) {
    await enforceFloor(start, OTP_LATENCY_FLOOR_MS);
    throw new IdentityError("rate_limited");
  }

  // Step 3: Gate — eligibility (always runs; result determines if we send the code)
  const { eligible } = await checkClientEligibilityByEmail(email);

  if (eligible) {
    // Step 4: Send email OTP — only when eligible (shouldCreateUser=false mandatory)
    const supabase = await createServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false, // MANDATORY — never create phantom auth users (§1.3)
      },
    });

    if (error) {
      logger.warn({ err: error.message }, "requestClientOtp: signInWithOtp returned error");
      // Still return uniform response — the client has no visibility into this failure
    }
  } else {
    // Not eligible: do NOT send the code. Latency floor ensures timing parity.
    logger.info({}, "requestClientOtp: gate check failed — no code sent (anti-enum)");
  }

  // Step 5: Enforce 800ms floor (§1.4)
  await enforceFloor(start, OTP_LATENCY_FLOOR_MS);

  // Step 6: Uniform response
  return { ok: true };
}

// ---------------------------------------------------------------------------
// verifyClientOtp — anonymous use case (DOC-22 §1.3, §1.4 re-gate)
// ---------------------------------------------------------------------------

/**
 * Verifies an email OTP and establishes a session (DOC-22 §1, email auth).
 *
 * Steps:
 * 1. Normalize + validate email.
 * 2. Rate limit: verify tier (10/h).
 * 3. supabase.auth.verifyOtp({ email, type:'email' }) → session cookies.
 * 4. RE-GATE post-session (§1.4, RF-CLI-006):
 *    If no longer eligible → signOut() + throw (caller redirects to /no-access).
 *
 * @param rawEmail - Client email.
 * @param code     - 6-digit OTP code (delivered by email).
 */
export async function verifyClientOtp(
  rawEmail: string,
  code: string,
): Promise<OtpVerifyResult> {
  // Step 1: Normalize + validate
  let email: string;
  try {
    email = normalizeEmailStrict(rawEmail);
  } catch {
    throw new IdentityError("invalid_email");
  }

  // Step 2: Rate limit
  const rl = await limitOtpVerifyEmail(email);
  if (!rl.allowed) {
    throw new IdentityError("rate_limited");
  }

  // Step 3: Verify OTP
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: code,
    type: "email",
  });

  if (error || !data.user) {
    // Uniform error — does not reveal eligibility (§1.4)
    throw new IdentityError("invalid_otp", "Ese código no coincide");
  }

  // Step 4: RE-GATE (defensa en profundidad — RF-CLI-006)
  const { eligible } = await checkClientEligibilityById(data.user.id);
  if (!eligible) {
    // Revoke session immediately
    await supabase.auth.signOut({ scope: "local" });
    logger.info(
      { userId: data.user.id },
      "verifyClientOtp: re-gate failed after verifyOtp — session revoked",
    );
    // Caller must redirect to /no-access
    throw new IdentityError("wrong_kind", "no_access");
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// requestStaffPasswordReset — anonymous use case (DOC-22 §2.4)
// ---------------------------------------------------------------------------

/**
 * Sends a password reset email to a staff member.
 * Always returns { ok: true } — does not confirm email existence (anti-enumeration).
 */
export async function requestStaffPasswordReset(
  email: string,
  redirectTo: string,
): Promise<PasswordResetResult> {
  const supabase = await createServerClient();

  // The email is sent via Supabase Auth (SMTP = Resend — DOC-22 §2.1)
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    // Log server-side only — never expose to caller
    logger.warn({ err: error.message }, "requestStaffPasswordReset: resetPasswordForEmail error");
  }

  // Uniform response — always ok (DOC-22 §2.4)
  return { ok: true };
}

// ---------------------------------------------------------------------------
// updateStaffPassword — authenticated use case (DOC-22 §2.2)
// ---------------------------------------------------------------------------

/**
 * Updates the staff member's password after validating policy.
 *
 * Authorization: requireActor() — throws IdentityError('unauthenticated') if no session.
 * (No can() check needed — this action is self-service, any authenticated staff can
 *  change their own password. The Auth session ensures it's the right user.)
 *
 * Password rules (DOC-22 §2.2):
 * - Minimum 12 characters (passwordPolicy)
 * - zxcvbn score >= 3 (@zxcvbn-ts/core)
 *
 * After a successful change:
 * - Clears must_change_password from app_metadata via service client.
 */
export async function updateStaffPassword(
  newPassword: string,
): Promise<PasswordUpdateResult> {
  // Authorization: any authenticated user can update their own password.
  // requireActor() validates the session; a null return would mean no session.
  const actor = await requireActor();

  if (actor.kind !== "staff") {
    throw new IdentityError("wrong_kind");
  }

  // Policy check — length
  const policy = passwordPolicy(newPassword);
  if (!policy.valid) {
    throw new IdentityError("password_too_short", "La contraseña debe tener al menos 12 caracteres.");
  }

  // zxcvbn score check
  const result = getZxcvbnFactory().check(newPassword);
  if (result.score < ZXCVBN_MIN_SCORE) {
    throw new IdentityError(
      "password_too_weak",
      "La contraseña es muy fácil de adivinar. Intenta con una combinación más variada.",
    );
  }

  // Update password via session client
  const supabase = await createServerClient();
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

  if (updateError) {
    throw new Error(`updateUser failed: ${updateError.message}`);
  }

  // Clear must_change_password flag via service client (admin API)
  const serviceClient = createServiceClient();
  const { error: adminError } = await serviceClient.auth.admin.updateUserById(actor.userId, {
    app_metadata: { must_change_password: false },
  });

  if (adminError) {
    // Non-fatal: log but don't fail the password update itself.
    // The user will just see the redirect again on next login.
    logger.warn(
      { err: adminError.message, userId: actor.userId },
      "updateStaffPassword: could not clear must_change_password",
    );
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// getCurrentStaffProfile — authenticated read (DOC-50 §1.3 shell header)
// ---------------------------------------------------------------------------

export interface StaffProfileResult {
  displayName: string;
  role: string;
  titleI18n: StaffProfileRow["titleI18n"];
  avatarUrl: string | null;
}

/**
 * Returns the staff profile of the currently authenticated staff member, for
 * the shell header / sidebar user-chip (name, role, title, avatar). Read-only;
 * the Actor's session guarantees it is the right user.
 *
 * Returns null when there is no staff session or no profile row.
 */
export async function getCurrentStaffProfile(): Promise<StaffProfileResult | null> {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") return null;

  const profile = await getStaffProfileById(actor.userId);
  if (!profile) return null;

  return {
    displayName: profile.displayName,
    role: profile.role,
    titleI18n: profile.titleI18n,
    avatarUrl: profile.avatarUrl,
  };
}

// ---------------------------------------------------------------------------
// countActiveEmployees — authenticated read (DOC-53 §1.1 dashboard KPI)
// ---------------------------------------------------------------------------

/**
 * Returns the number of active staff members (employees) in the actor's org,
 * for the admin dashboard KPI. Requires a staff session; returns 0 otherwise.
 */
export async function countActiveEmployees(): Promise<number> {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") return 0;
  return countActiveStaff();
}

// ---------------------------------------------------------------------------
// inviteEmployee — DOC-22 §2.2 (RF-ADM-042)
// ---------------------------------------------------------------------------

/**
 * Creates a new staff member with a temporary password.
 *
 * Exact flow per DOC-22 §2.2:
 * a. can(actor, 'employees', 'edit')
 * b. 24-char crypto-random password
 * c. auth.admin.createUser(email_confirm=true, must_change_password=true)
 * d. INSERT users(kind='staff') + staff_profiles + employee_module_permissions(preset)
 * e. Send staff-invite email via Resend (password travels ONLY here — never in logs/events)
 * f. emit staff.created + permissions.changed + audit
 *
 * API-AUT-09
 */
export async function inviteEmployee(
  actor: Actor,
  input: {
    email: string;
    displayName: string;
    titleI18n: Record<string, string> | null;
    role: "sales" | "paralegal" | "finance";
    permissionsPreset?: EmployeePermissionInput[];
  },
): Promise<InviteEmployeeResult> {
  // Step a: Authorization
  can(actor, "employees", "edit");

  // Step b: Generate 24-char cryptographically random password
  // SECURITY: This value must NEVER appear in logs, event payloads, or audit diffs.
  const tempPassword = crypto.randomBytes(18).toString("base64url").slice(0, 24);

  // Step c: Create Supabase Auth user (service client)
  const serviceClient = createServiceClient();
  const { data: authData, error: authError } =
    await serviceClient.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true, // skip verification email — we send our own
      app_metadata: {
        must_change_password: true,
      },
    });

  if (authError || !authData.user) {
    if (authError?.message?.toLowerCase().includes("already registered")) {
      throw new IdentityError("employee_already_exists", authError.message);
    }
    throw new Error(`inviteEmployee.createUser: ${authError?.message}`);
  }

  const userId = authData.user.id;

  // Step d: Insert base rows + preset permissions
  const permissions =
    input.permissionsPreset ?? buildPermissionPreset(input.role);

  try {
    await insertStaffRows({
      userId,
      orgId: actor.orgId,
      email: input.email,
      displayName: input.displayName,
      titleI18n: input.titleI18n as import("@/shared/database.types").Json,
      role: input.role,
      permissions,
    });
  } catch (err) {
    // Compensate: delete the auth user so we don't leave orphaned auth rows
    await serviceClient.auth.admin.deleteUser(userId).catch((e: unknown) =>
      logger.error({ err: e, userId }, "inviteEmployee: compensation deleteUser failed"),
    );
    throw err;
  }

  // Step e: Send staff-invite email via Resend
  // The temp password travels ONLY through this email; no event payload, no logs.
  const loginLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://panel.usalatinoprime.com"}/login`;
  const emailHtml = buildStaffInviteEmail({
    displayName: input.displayName,
    email: input.email,
    tempPassword, // passed by value into email render — not in any log
    loginLink,
  });

  try {
    await sendTransactional({
      to: input.email,
      from: FROM_TRANSACTIONAL,
      subject: "Bienvenido/a a UsaLatinoPrime — accede al panel",
      html: emailHtml,
      idempotencyKey: `staff-invite:${userId}`,
    });
  } catch (emailErr) {
    // Non-fatal: log the email failure but don't roll back the created account.
    // The admin can resend via resendInvite action.
    logger.error(
      { err: emailErr, userId },
      "inviteEmployee: email send failed — account was created",
    );
  }

  // Step f: Emit events + audit
  appEvents.emit({
    type: "staff.created",
    payload: {
      userId,
      orgId: actor.orgId,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      invitedBy: actor.userId,
      // SECURITY: tempPassword is NOT in the event payload
    },
    occurredAt: new Date(),
  });

  appEvents.emit({
    type: "permissions.changed",
    payload: {
      staffId: userId,
      orgId: actor.orgId,
      changedBy: actor.userId,
      permissions: permissions.map((p) => ({
        module_key: p.module_key,
        can_view: p.can_view,
        can_edit: p.can_edit,
      })),
    },
    occurredAt: new Date(),
  });

  const audit = await getAudit();
  await audit.writeAudit(actor, "invite", "staff", userId, {
    email: input.email,
    role: input.role,
    displayName: input.displayName,
  });

  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// updateEmployeePermissions — RF-ADM-045
// ---------------------------------------------------------------------------

/**
 * Replaces the permission matrix for a staff member.
 * Takes effect immediately on the next request (permissions are NOT in JWT — DOC-22 §3.1).
 *
 * API-AUT-10
 */
export async function updateEmployeePermissions(
  actor: Actor,
  staffId: string,
  permissions: EmployeePermissionInput[],
): Promise<UpdatePermissionsResult> {
  can(actor, "employees", "edit");

  // C-1: DOC-22 §9.3 — no self-modification of permissions
  if (actor.userId === staffId) {
    throw new AuthzError("self_permission_change_denied");
  }

  // C-1: Verify target belongs to actor's org (defense in depth)
  const target = await findStaffById(staffId);
  if (!target) {
    throw new IdentityError("employee_not_found", `Staff member ${staffId} not found.`);
  }
  if (target.orgId !== actor.orgId) {
    throw new AuthzError("cross_org_access_denied");
  }

  const prevPermissions = await (async () => {
    try {
      const supabase = createServiceClient();
      const { data } = await supabase
        .from("employee_module_permissions")
        .select("module_key, can_view, can_edit")
        .eq("staff_id", staffId);
      return data ?? [];
    } catch {
      return [];
    }
  })();

  await replaceStaffPermissions(staffId, permissions);

  appEvents.emit({
    type: "permissions.changed",
    payload: {
      staffId,
      orgId: actor.orgId,
      changedBy: actor.userId,
      permissions: permissions.map((p) => ({
        module_key: p.module_key,
        can_view: p.can_view,
        can_edit: p.can_edit,
      })),
    },
    occurredAt: new Date(),
  });

  const audit = await getAudit();
  await audit.writeAudit(actor, "update_permissions", "staff", staffId, {
    before: prevPermissions,
    after: permissions,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// deactivateEmployee — RF-ADM-043
// ---------------------------------------------------------------------------

/**
 * Deactivates a staff member: sets is_active=false, revokes all sessions,
 * and bans the Supabase auth user from future logins.
 *
 * API-AUT-11
 */
export async function deactivateEmployee(
  actor: Actor,
  staffId: string,
): Promise<DeactivateEmployeeResult> {
  can(actor, "employees", "edit");

  // C-1: DOC-22 §9.3 — cannot deactivate yourself
  if (actor.userId === staffId) {
    throw new AuthzError("self_deactivation_denied");
  }

  // C-1: Verify target belongs to actor's org
  const target = await findStaffById(staffId);
  if (!target) {
    throw new IdentityError("employee_not_found", `Staff member ${staffId} not found.`);
  }
  if (target.orgId !== actor.orgId) {
    throw new AuthzError("cross_org_access_denied");
  }

  // H-3: DOC-22 §9.3 — protect the last active admin
  if (target.role === "admin") {
    const activeAdminCount = await countActiveAdminsByOrg(actor.orgId);
    if (activeAdminCount <= 1) {
      throw new IdentityError(
        "last_admin_protected",
        "No se puede desactivar al único administrador activo del org.",
      );
    }
  }

  // Set is_active=false in public.users
  await setStaffActive(staffId, false);

  // Revoke all sessions + ban (ban=true prevents future logins)
  await revokeAllSessions(staffId, true);

  const audit = await getAudit();
  await audit.writeAudit(actor, "deactivate", "staff", staffId, {
    changedBy: actor.userId,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// reactivateEmployee — RF-ADM-043
// ---------------------------------------------------------------------------

/**
 * Reactivates a deactivated staff member: sets is_active=true and lifts
 * the Supabase auth ban so they can log in again.
 *
 * API-AUT-12
 */
export async function reactivateEmployee(
  actor: Actor,
  staffId: string,
): Promise<ReactivateEmployeeResult> {
  can(actor, "employees", "edit");

  // Re-enable the user in public.users
  await setStaffActive(staffId, true);

  // Lift the auth ban (ban=false unblocks future logins)
  // revokeAllSessions with ban=false calls updateUserById({ ban_duration: 'none' })
  await revokeAllSessions(staffId, false);

  const audit = await getAudit();
  await audit.writeAudit(actor, "reactivate", "staff", staffId, {
    changedBy: actor.userId,
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// listEmployees — RF-ADM-041
// ---------------------------------------------------------------------------

/**
 * Returns the list of all staff members with their permissions.
 * Used by the employees panel.
 *
 * API-AUT-13
 */
export async function listEmployees(
  actor: Actor,
): Promise<ListEmployeesResult> {
  can(actor, "employees", "view");

  const employees = await listStaffMembers();
  return { employees };
}

// ---------------------------------------------------------------------------
// Helpers — permission preset matrix (DOC-22 §6)
// ---------------------------------------------------------------------------

/**
 * Returns the default permission rows for a given role.
 * E = view+edit, V = view-only, — = no access.
 * Source of truth: DOC-22 §6 matrix.
 */
function buildPermissionPreset(
  role: "admin" | "sales" | "paralegal" | "finance",
): EmployeePermissionInput[] {
  if (role === "admin") {
    // Admin bypasses matrix entirely (§5.2). Return full access for completeness.
    return MODULE_KEYS.map((k) => ({
      module_key: k as ModuleKey,
      can_view: true,
      can_edit: true,
    }));
  }

  type Cell = "E" | "V" | "-";

  // Matrix from DOC-22 §6 (sales = Vanessa, paralegal = Diana, finance = Andrium)
  const matrix: Record<ModuleKey, { sales: Cell; paralegal: Cell; finance: Cell }> = {
    dashboard:   { sales: "V", paralegal: "V", finance: "V" },
    leads:       { sales: "E", paralegal: "-", finance: "-" },
    clients:     { sales: "V", paralegal: "V", finance: "V" },
    cases:       { sales: "V", paralegal: "E", finance: "V" },
    calendar:    { sales: "E", paralegal: "V", finance: "-" },
    availability: { sales: "E", paralegal: "-", finance: "-" },
    metrics:     { sales: "V", paralegal: "-", finance: "-" },
    catalog:     { sales: "-", paralegal: "-", finance: "-" },
    datasets:    { sales: "-", paralegal: "-", finance: "-" },
    employees:   { sales: "-", paralegal: "-", finance: "-" },
    billing:     { sales: "-", paralegal: "-", finance: "E" },
    collections: { sales: "-", paralegal: "-", finance: "E" },
    printing:    { sales: "-", paralegal: "-", finance: "E" },
    campaigns:   { sales: "-", paralegal: "-", finance: "E" },
    accounting:  { sales: "-", paralegal: "-", finance: "E" },
    expedientes: { sales: "-", paralegal: "E", finance: "V" },
    validations: { sales: "-", paralegal: "E", finance: "-" },
    messaging:   { sales: "E", paralegal: "E", finance: "E" },
    community:   { sales: "-", paralegal: "-", finance: "E" },
    audit:       { sales: "-", paralegal: "-", finance: "-" },
  };

  return MODULE_KEYS.flatMap((k) => {
    const cell = matrix[k as ModuleKey][role];
    if (cell === "-") return [];
    return [
      {
        module_key: k as ModuleKey,
        can_view: true,
        can_edit: cell === "E",
      },
    ];
  });
}

// escapeHtml is imported from @/shared/html (M-2 consolidation — shared with jobs layer).

/**
 * Builds the HTML body for the staff invitation email.
 * The temp password is rendered here and goes nowhere else.
 */
function buildStaffInviteEmail(opts: {
  displayName: string;
  email: string;
  tempPassword: string;
  loginLink: string;
}): string {
  // Intentionally simple HTML — no JSX dependency in this module.
  // The react-email component for staff-invite is in the notifications module (F3).
  // L-3: all user-supplied values are HTML-escaped before interpolation.
  const safeName = escapeHtml(opts.displayName);
  const safeEmail = escapeHtml(opts.email);
  const safePassword = escapeHtml(opts.tempPassword);
  const safeLink = escapeHtml(opts.loginLink);
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>Bienvenido/a a UsaLatinoPrime</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;">
  <h2>Bienvenido/a al panel, ${safeName}</h2>
  <p>El administrador te ha dado acceso al panel de UsaLatinoPrime.</p>
  <p><strong>Email:</strong> ${safeEmail}<br>
  <strong>Contraseña temporal:</strong> <code>${safePassword}</code></p>
  <p>Al ingresar por primera vez se te pedirá que cambies la contraseña.</p>
  <p><a href="${safeLink}" style="background:#0f172a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Acceder al panel</a></p>
  <p style="color:#6b7280;font-size:12px;margin-top:32px;">
    Si no esperabas este email, puedes ignorarlo.
    Este mensaje fue enviado por UsaLatinoPrime.
  </p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// provisionClientUser — DOC-22 §1.2 (H-2 resolution)
// ---------------------------------------------------------------------------

export interface ProvisionClientUserInput {
  fullName: string;
  /** Login identity (DOC-22 §1, email auth). Captured at case intake. */
  email: string;
  /** Optional contact phone (NOT the login identity). */
  phoneE164?: string | null;
  locale?: string;
  timezone?: string;
}

export interface ProvisionClientUserResult {
  userId: string;
  /** true when the user row was created; false when it already existed (idempotent). */
  created: boolean;
}

/**
 * Provisions a client user in Supabase Auth + public.users + client_profiles.
 *
 * Idempotent by EMAIL: if the user already exists, returns { userId, created:false }.
 *
 * Steps per DOC-22 §1.2 (SoT 2026-06-13: email auth, phone optional contact):
 * 1. can(actor, 'clients', 'edit')
 * 2. Normalize + validate email
 * 3. Check existing: users.email (kind=client)
 * 4. auth.admin.createUser({ email, email_confirm:true }) — no password, no session
 * 5. INSERT users(kind=client, email, phone?) + client_profiles
 * 6. audit
 *
 * Race condition: if the auth user exists but public.users is missing, look up
 * by email and upsert the rows (idempotent on id).
 *
 * @api-id API-AUT-16 (client provisioning; DOC-22 §1.2)
 */
export async function provisionClientUser(
  actor: Actor,
  input: ProvisionClientUserInput,
): Promise<ProvisionClientUserResult> {
  // Step 1: Authorization — only staff with clients:edit can create client accounts
  can(actor, "clients", "edit");

  const { fullName, locale, timezone } = input;
  const email = normalizeEmailStrict(input.email);
  const phoneE164 = input.phoneE164 ? normalizePhoneE164(input.phoneE164) : null;

  // Derive first/last name from fullName (split on first space; last = rest)
  const spaceIdx = fullName.trim().indexOf(" ");
  const firstName = spaceIdx >= 0 ? fullName.trim().slice(0, spaceIdx) : fullName.trim();
  const lastName = spaceIdx >= 0 ? fullName.trim().slice(spaceIdx + 1).trim() : "";

  // Step 3: Idempotency check — email on users(kind=client)
  const existing = await findClientByEmail(email);
  if (existing) {
    logger.info(
      { userId: existing.id },
      "provisionClientUser: email already registered — returning existing user (idempotent)",
    );
    return { userId: existing.id, created: false };
  }

  // Step 4: Create auth user (no password, email_confirm=true — no verification email)
  const serviceClient = createServiceClient();
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    // Optional contact phone stored on the auth user too (not used for login)
    ...(phoneE164 ? { phone: phoneE164, phone_confirm: true } : {}),
    // Intentionally no password — client authenticates via email OTP only
  });

  if (authError || !authData?.user) {
    // Race: auth user exists but our public.users row doesn't — look up by email.
    if (authError?.message?.toLowerCase().includes("already registered") ||
        authError?.message?.toLowerCase().includes("already been registered")) {
      const { data: userRow } = await serviceClient
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();
      const authUser: { id: string } | null = userRow ?? null;
      if (authUser) {
        await insertClientRows({
          userId: authUser.id,
          orgId: actor.orgId,
          email,
          phoneE164,
          firstName,
          lastName,
          locale,
          timezone,
        });
        const audit = await getAudit();
        await audit.writeAudit(actor, "client.provisioned", "users", authUser.id, {
          email,
          created_auth: false,
          created_rows: true,
        });
        return { userId: authUser.id, created: false };
      }
    }
    throw new Error(`provisionClientUser.createUser: ${authError?.message ?? "unknown error"}`);
  }

  const userId = authData.user.id;

  // Step 5: Insert public rows
  await insertClientRows({
    userId,
    orgId: actor.orgId,
    email,
    phoneE164,
    firstName,
    lastName,
    locale,
    timezone,
  });

  // Step 6: Audit (no welcome event here — downpayment.confirmed triggers it, DOC-41 §3.4 H-2)
  const audit = await getAudit();
  await audit.writeAudit(actor, "client.provisioned", "users", userId, {
    email,
    created_auth: true,
    created_rows: true,
  });

  return { userId, created: true };
}

// ---------------------------------------------------------------------------
// upsertPersonRecord — DOC-41 §3.1 (party provisioning for non-user parties)
// ---------------------------------------------------------------------------

export interface UpsertPersonRecordInput {
  firstName: string;
  lastName: string;
  relationship?: string | null;
}

/**
 * Creates a person_records row for a case party who is NOT a system user.
 * Used by cases.createCaseFromContract for the `parties` list.
 *
 * NOTE: person_records has no UNIQUE key across name+org (by design — multiple
 * people may share names). Each call creates a new record; callers should only
 * call this once per party in the creation flow.
 *
 * @api-id (internal — invoked by cases module via identity/index.ts boundary)
 */
export async function upsertPersonRecord(
  actor: Actor,
  input: UpsertPersonRecordInput,
): Promise<string> {
  can(actor, "clients", "edit");
  return insertPersonRecord({
    orgId: actor.orgId,
    createdBy: actor.userId,
    firstName: input.firstName,
    lastName: input.lastName,
    relationship: input.relationship ?? null,
  });
}

// ---------------------------------------------------------------------------
// insertCaseParty — thin boundary wrapper (DOC-41 §3.1)
// ---------------------------------------------------------------------------

/**
 * Inserts a case_parties row. Called exclusively by cases.createCaseFromContract
 * via the identity/index.ts boundary (cases owns case_parties; identity owns
 * person_records — this wrapper lets identity write its half atomically).
 *
 * Not exported in index.ts: used internally by cases via a dedicated wrapper.
 */
export { insertCasePartyRow } from "./repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pads the elapsed time to at least `floorMs` milliseconds.
 * Used to enforce timing parity between eligible and non-eligible branches.
 */
async function enforceFloor(startMs: number, floorMs: number): Promise<void> {
  const elapsed = Date.now() - startMs;
  const remaining = floorMs - elapsed;
  if (remaining > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}
