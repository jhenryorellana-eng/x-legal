/**
 * Identity service — F0 + F1 use cases (DOC-22 §1, §2, §6).
 *
 * Use cases implemented:
 * F0:
 * - loginClientByPhone    (anonymous) — phone-only login: normalize, rate limit,
 *                          resolve+gate, signInWithPassword (derived), re-gate
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
import { env } from "@/backend/platform/env";
import {
  limitOtpSendPhone,
  limitOtpSendIp,
} from "@/backend/platform/ratelimit";
import { sendTransactional, FROM_TRANSACTIONAL } from "@/backend/platform/resend";
import { appEvents } from "@/backend/platform/events";

import type { ModuleKey } from "@/shared/constants/modules";
import { MODULE_KEYS } from "@/shared/constants/modules";
import { ROLE_PRESETS } from "@/shared/constants/role-presets";
import { escapeHtml } from "@/shared/html";

import {
  normalizePhoneE164,
  normalizeEmailStrict,
  derivePhonePassword,
  syntheticAuthEmail,
  passwordPolicy,
} from "./domain";
import {
  checkClientEligibility,
  checkClientEligibilityById,
  countActiveStaff,
  getStaffProfileById,
  findStaffById,
  countActiveAdminsByOrg,
  listStaffMembers,
  insertStaffRows,
  replaceStaffPermissions,
  setStaffActive,
  findClientByPhone,
  findClientById,
  searchClientRows,
  updateClientAddressRow,
  insertClientRows,
  insertPersonRecord,
  updateUserLocale,
  updateUserTimezone,
  updateUserLocation,
  findUserLocation,
  findUserUiPrefs,
  updateUserUiPrefs,
  findClientTutorialSeen,
  markClientTutorialSeen,
  type StaffProfileRow,
  type EmployeePermissionInput,
  type EmployeeRow,
  type ClientAddressInput,
} from "./repository";

// Audit module — imported via dynamic require to avoid circular deps at module load
// (audit → platform only; identity → platform; no true cycle but dynamic avoids
// potential init ordering issues in tests)
 
let _audit: { writeAudit: (...args: any[]) => Promise<void> } | null = null;
async function getAudit() {
  if (!_audit) {
    _audit = await import("@/backend/modules/audit");
  }
  return _audit;
}

// ---------------------------------------------------------------------------
// setUserLocale — persist the actor's own UI language (DOC-24 i18n)
// ---------------------------------------------------------------------------

const SUPPORTED_LOCALES = ["es", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Persists the authenticated user's own UI language to `users.locale`. Any
 * authenticated user (client or staff) may set their own locale — no `can()`
 * gate beyond authentication. The caller (action) mirrors it to the `ulp-locale`
 * cookie so next-intl picks it up on the next request.
 */
export async function setUserLocale(actor: Actor, rawLocale: string): Promise<SupportedLocale> {
  const locale: SupportedLocale = (SUPPORTED_LOCALES as readonly string[]).includes(rawLocale)
    ? (rawLocale as SupportedLocale)
    : "es";
  await updateUserLocale(actor.userId, locale);
  return locale;
}

// ---------------------------------------------------------------------------
// setUserTimezone — persist the actor's own IANA timezone (DOC-23 §6.5)
// ---------------------------------------------------------------------------

/** Validates a candidate IANA timezone string via the Intl engine. */
function isValidIanaTimezone(tz: string): boolean {
  try {
    // Throws RangeError for unknown zones; cheap and dependency-free.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Persists the authenticated user's own timezone to `users.timezone`. Any
 * authenticated user (client or staff) may set their own — no `can()` gate
 * beyond authentication. The caller (action) mirrors it to the `ulp-tz` cookie
 * so SSR (getTimeZone) renders times in the new zone on the next request.
 * Invalid zones fall back to America/New_York (the product default).
 */
export async function setUserTimezone(actor: Actor, rawTz: string): Promise<string> {
  const tz = isValidIanaTimezone(rawTz) ? rawTz : "America/New_York";
  await updateUserTimezone(actor.userId, tz);
  return tz;
}

/**
 * Reads the actor's current location (timezone + city/country) for the
 * Configuración location card. Falls back to America/New_York timezone.
 */
export async function getCurrentUserLocation(
  actor: Actor,
): Promise<{ timezone: string; city: string | null; country: string | null }> {
  const loc = await findUserLocation(actor.userId);
  return {
    timezone: loc?.timezone ?? "America/New_York",
    city: loc?.city ?? null,
    country: loc?.country ?? null,
  };
}

/**
 * Persists the authenticated user's full location (timezone + city/country),
 * as detected by the browser geolocation + reverse geocode flow. The timezone
 * is validated (falls back to America/New_York); city/country are stored as-is.
 * Returns the persisted timezone (the action mirrors it to the ulp-tz cookie).
 */
export async function setUserLocation(
  actor: Actor,
  input: { timezone: string; city?: string | null; country?: string | null; countryCode?: string | null },
): Promise<string> {
  const tz = isValidIanaTimezone(input.timezone) ? input.timezone : "America/New_York";
  await updateUserLocation(actor.userId, {
    timezone: tz,
    city: input.city ?? null,
    country: input.country ?? null,
    countryCode: input.countryCode ?? null,
  });
  return tz;
}

// ---------------------------------------------------------------------------
// setUserUiPrefs / getCurrentUserUiPrefs — per-user appearance (DOC-01 §4/§8.5)
//
// theme ("light"|"dark") and text scale ("sm"|"md"|"lg" ↔ 0.92|1|1.12) live on
// `users.theme` / `users.text_scale`, so each role's appearance is independent
// and persists across devices. Any authenticated user may set their own.
// ---------------------------------------------------------------------------

export type UiTheme = "light" | "dark";
export type UiTextScale = "sm" | "md" | "lg";

const SCALE_KEY_TO_NUM: Record<UiTextScale, number> = { sm: 0.92, md: 1, lg: 1.12 };

function scaleNumToKey(n: number): UiTextScale {
  if (n <= 0.96) return "sm";
  if (n >= 1.06) return "lg";
  return "md";
}

/** Persists the authenticated user's own theme and/or text scale. */
export async function setUserUiPrefs(
  actor: Actor,
  input: { theme?: string; textScale?: string },
): Promise<void> {
  const patch: { theme?: string; text_scale?: number } = {};
  if (input.theme === "light" || input.theme === "dark") patch.theme = input.theme;
  if (input.textScale === "sm" || input.textScale === "md" || input.textScale === "lg") {
    patch.text_scale = SCALE_KEY_TO_NUM[input.textScale];
  }
  await updateUserUiPrefs(actor.userId, patch);
}

/**
 * Resolves the current actor's appearance for SSR (root layout) so each user's
 * theme + text size renders with no flash. Anonymous → light/md defaults.
 */
export async function getCurrentUserUiPrefs(): Promise<{ theme: UiTheme; textScale: UiTextScale }> {
  const actor = await getActor();
  if (!actor) return { theme: "light", textScale: "md" };
  const row = await findUserUiPrefs(actor.userId);
  if (!row) return { theme: "light", textScale: "md" };
  return {
    theme: row.theme === "dark" ? "dark" : "light",
    textScale: scaleNumToKey(typeof row.text_scale === "number" ? row.text_scale : 1),
  };
}

// ---------------------------------------------------------------------------
// First-visit Tutorial (coach-mark) — seen flag on client_profiles (DOC-29 §34)
//
// Persisting "seen" in the DB (not a query param / localStorage) makes the tour
// fire until the client dismisses it, then never again — including on another
// device. Non-client actors never see it → treated as already seen.
// ---------------------------------------------------------------------------

/** Whether the client actor already dismissed the first-visit Tutorial. */
export async function hasSeenTutorial(actor: Actor): Promise<boolean> {
  if (actor.kind !== "client") return true;
  return findClientTutorialSeen(actor.userId);
}

/** Marks the client actor's first-visit Tutorial as seen (idempotent, best-effort). */
export async function markTutorialSeen(actor: Actor): Promise<void> {
  if (actor.kind !== "client") return;
  await markClientTutorialSeen(actor.userId, new Date().toISOString());
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
   
  _zxcvbnFactory = new ZxcvbnFactory({ graphs: adjacencyGraphs, dictionary } as any);
  return _zxcvbnFactory;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum latency floor for the login action — anti-timing-analysis (DOC-22 §1.4) */
const LOGIN_LATENCY_FLOOR_MS = 800;

const ZXCVBN_MIN_SCORE = 3;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface PhoneLoginResult {
  /** Always true — failures throw IdentityError (uniform, anti-enumeration). */
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
// loginClientByPhone — anonymous use case (DOC-22 §1, phone-only login)
// No Actor required: this is a public endpoint. Documented per DOC-22 §7 rule 1.
// ---------------------------------------------------------------------------

/**
 * Logs a client in with ONLY their phone number (DOC-22 §1, June 2026).
 *
 * No OTP, no SMS, no code — TEMPORARY: SMS-OTP lands on top of this later. The
 * client types only their phone; we resolve them, derive their deterministic
 * password (set at provisioning), and sign them in by email (the Supabase Auth
 * identity they never see). The session cookie is set via the SSR server client,
 * exactly like signInStaffAction.
 *
 * SECURITY: anyone who knows a client's phone can log in (no second factor). A
 * conscious temporary product decision (Henry). This function is the single
 * insertion point for the future SMS-OTP verify step.
 *
 * Steps:
 * 1. Normalize + validate phone.
 * 2. Rate limit: phone tiers (1/45s, 5/h, 8/d) + IP tiers (10/h, 30/d).
 * 3. Resolve client by phone (id + email) + eligibility gate (kind=client,
 *    is_active, activated case).
 * 4. signInWithPassword({ email, password: derived }) on the SSR client.
 *    Legacy resilience: if it fails (client provisioned before passwords were
 *    set), set the derived password via the admin API and retry ONCE.
 * 5. Re-gate post-session by id (RF-CLI-006) → signOut on failure.
 * 6. 800ms latency floor on every branch — anti-enumeration timing parity.
 *
 * @param rawPhone - The phone the client typed (their login credential).
 * @param ip       - Request IP for per-IP rate limiting.
 */
export async function loginClientByPhone(
  rawPhone: string,
  ip: string,
): Promise<PhoneLoginResult> {
  const start = Date.now();

  // Step 1: Normalize + validate phone
  let phoneE164: string;
  try {
    phoneE164 = normalizePhoneE164(rawPhone);
  } catch {
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    logger.info({}, "loginClientByPhone: invalid phone format");
    throw new IdentityError("invalid_phone");
  }

  // Step 2: Rate limit — sequential: phone first, IP second (M-1 anti-timing).
  const phoneRL = await limitOtpSendPhone(phoneE164);
  if (!phoneRL.allowed) {
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    throw new IdentityError("rate_limited");
  }
  const ipRL = await limitOtpSendIp(ip);
  if (!ipRL.allowed) {
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    throw new IdentityError("rate_limited");
  }

  // Step 3: Resolve + gate. A missing client or an ineligible one collapse to the
  // SAME uniform failure (anti-enum). The email is NOT checked: it is optional
  // contact data (2026-07 phone-as-identity), and login signs in by phone — a
  // client provisioned without an email must still be able to log in.
  const client = await findClientByPhone(phoneE164);
  const { eligible } = client
    ? await checkClientEligibility(phoneE164)
    : { eligible: false };

  if (!client || !eligible) {
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    logger.info({}, "loginClientByPhone: gate check failed — no session (anti-enum)");
    throw new IdentityError("wrong_kind", "no_access");
  }

  // Step 4: Sign in by PHONE with the derived password (sets the SSR cookie).
  // The phone is the client's identity in Auth (2026-07 refactor) — the email is
  // decoupled, so it may repeat / be null without affecting login.
  const password = derivePhonePassword(phoneE164, env.SUPABASE_SERVICE_ROLE_KEY);
  const supabase = await createServerClient();
  let signIn = await supabase.auth.signInWithPassword({ phone: phoneE164, password });

  if (signIn.error || !signIn.data.user) {
    // Self-heal: a legacy client provisioned before the phone-identity refactor
    // (email-only Auth, no phone/password), or after a secret rotation. Backfill
    // the phone + confirmation + derived password via the admin API and retry
    // ONCE. Auto-migrates any client the batch backfill hasn't covered yet.
    const admin = createServiceClient();
    const { error: setErr } = await admin.auth.admin.updateUserById(client.id, {
      phone: phoneE164,
      phone_confirm: true,
      password,
    });
    if (!setErr) {
      signIn = await supabase.auth.signInWithPassword({ phone: phoneE164, password });
    }
  }

  if (signIn.error || !signIn.data.user) {
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    logger.warn(
      { err: signIn.error?.message },
      "loginClientByPhone: signInWithPassword failed after retry",
    );
    throw new IdentityError("wrong_kind", "no_access");
  }

  // Step 5: RE-GATE post-session (defensa en profundidad — RF-CLI-006)
  const regate = await checkClientEligibilityById(signIn.data.user.id);
  if (!regate.eligible) {
    await supabase.auth.signOut({ scope: "local" });
    logger.info(
      { userId: signIn.data.user.id },
      "loginClientByPhone: re-gate failed after sign-in — session revoked",
    );
    await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
    throw new IdentityError("wrong_kind", "no_access");
  }

  // Step 6: Latency floor (timing parity with the failure branches)
  await enforceFloor(start, LOGIN_LATENCY_FLOOR_MS);
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
  const loginLink = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://x-legal.usalatinoprime.com"}/login`;
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
  // Single source of truth: shared ROLE_PRESETS (DOC-22 §6). Admin = full access.
  // Kept in shared/ so the admin UI and the backend never drift apart.
  const preset = ROLE_PRESETS[role];
  return MODULE_KEYS.flatMap((k) => {
    const cell = preset[k as ModuleKey];
    if (!cell.view && !cell.edit) return [];
    return [
      {
        module_key: k as ModuleKey,
        can_view: cell.view,
        can_edit: cell.edit,
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
  /**
   * The client's UNIQUE identity + login credential (DOC-22 §1). Captured at
   * case intake. REQUIRED — the client logs in with the phone only, and it is
   * the dedup key (public.users.phone_e164 is unique).
   */
  phoneE164?: string | null;
  /**
   * OPTIONAL, REPEATABLE contact email (a family may share one inbox, or have
   * none). NEVER the identity: it is stored only on the public rows, and the
   * Supabase Auth identity uses a synthetic per-phone email instead.
   */
  email?: string | null;
  /** Full US mailing address — persisted to client_profiles.address (prefills I-589). */
  address?: ClientAddressInput | null;
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
 * Identity model (DOC-22 §1, 2026-07 refactor — PHONE is the identity):
 *  - The phone is the client's UNIQUE identity and sole login credential.
 *    Idempotent by PHONE: if a client with this phone already exists, returns
 *    { userId, created:false } without touching Auth.
 *  - The real email is OPTIONAL, REPEATABLE contact data — it is stored only on
 *    public.users/client_profiles (no unique constraint), so several clients may
 *    share one inbox or have none. It is NEVER the dedup key.
 *  - Supabase Auth (which enforces a unique email) gets a SYNTHETIC, unique-per-
 *    phone email (syntheticAuthEmail) + the phone + the derived phone password.
 *    The client signs in by phone (loginClientByPhone) — never with this email.
 *
 * Steps:
 * 1. can(actor, 'clients', 'edit')
 * 2. Normalize + validate phone (mandatory); normalize the optional email
 * 3. Idempotency: findClientByPhone
 * 4. auth.admin.createUser({ email: synthetic, phone, *_confirm, password })
 * 5. INSERT users(kind=client, email?, phone) + client_profiles
 * 6. audit
 *
 * Recovery: on a duplicate error, resolve a concurrent race (public.users
 * already has the phone) or reuse a leftover auth shell that collides by phone.
 *
 * @api-id API-AUT-16 (client provisioning; DOC-22 §1.2)
 */
export async function provisionClientUser(
  actor: Actor,
  input: ProvisionClientUserInput,
): Promise<ProvisionClientUserResult> {
  // Step 1: Authorization — only staff with clients:edit can create client accounts
  can(actor, "clients", "edit");

  const { fullName, locale, timezone, address } = input;

  // Step 2: The phone is the identity — mandatory. normalizePhoneE164 throws
  // (PhoneNormalizationError) on a missing / blank / invalid phone.
  const phoneE164 = normalizePhoneE164(input.phoneE164 ?? "");
  // The real email is OPTIONAL contact data — normalize when present, else null.
  const email = input.email && input.email.trim() ? normalizeEmailStrict(input.email) : null;

  // Derive first/last name from fullName (split on first space; last = rest)
  const spaceIdx = fullName.trim().indexOf(" ");
  const firstName = spaceIdx >= 0 ? fullName.trim().slice(0, spaceIdx) : fullName.trim();
  const lastName = spaceIdx >= 0 ? fullName.trim().slice(spaceIdx + 1).trim() : "";

  // Step 3: Idempotency — by PHONE (the unique identity), never by email.
  const existing = await findClientByPhone(phoneE164);
  if (existing) {
    logger.info(
      { userId: existing.id },
      "provisionClientUser: phone already registered — returning existing client (idempotent)",
    );
    return { userId: existing.id, created: false };
  }

  // Step 4: Create the auth user. Identity = phone + a synthetic, unique-per-phone
  // email (the real email is NOT the Auth identity, so it may repeat / be null).
  // email_confirm=true → no verification mail; the synthetic subdomain has no MX.
  // The derived phone password lets the client sign in with just their phone.
  const authEmail = syntheticAuthEmail(phoneE164);
  const password = derivePhonePassword(phoneE164, env.SUPABASE_SERVICE_ROLE_KEY);
  const serviceClient = createServiceClient();
  const { data: authData, error: authError } = await serviceClient.auth.admin.createUser({
    email: authEmail,
    email_confirm: true,
    phone: phoneE164,
    phone_confirm: true,
    password,
  });

  if (authError || !authData?.user) {
    // A duplicate error means an auth user already exists for this PHONE (or its
    // synthetic email) while our public rows may be missing — a prior partial
    // provision, a concurrent request, or a leftover shell after a data wipe.
    const dup = (authError?.message ?? "").toLowerCase();
    const isDuplicate =
      dup.includes("already registered") ||
      dup.includes("already been registered") ||
      dup.includes("already exists") ||
      dup.includes("duplicate");
    if (isDuplicate) {
      // First: a concurrent request may have already inserted the public.users
      // row for this phone — fully provisioned, so return it (idempotent, no
      // re-insert). Kept off listUsers (silently misses users in >1000-account orgs).
      const { data: publicByPhone } = await serviceClient
        .from("users")
        .select("id")
        .eq("phone_e164", phoneE164)
        .eq("kind", "client")
        .maybeSingle();
      if (publicByPhone?.id) {
        return { userId: publicByPhone.id, created: false };
      }

      // Otherwise: a leftover auth shell with NO public.users row collides by
      // phone (or synthetic email). Find it via the admin list and reuse it so
      // case creation doesn't hard-fail.
      const phoneDigits = phoneE164.replace(/^\+/, "");
      let existingAuthId: string | null = null;
      for (let page = 1; page <= 50 && !existingAuthId; page++) {
        const { data: list } = await serviceClient.auth.admin.listUsers({ page, perPage: 200 });
        const users = list?.users ?? [];
        const found = users.find((u) => u.phone === phoneDigits || u.email === authEmail);
        if (found) existingAuthId = found.id;
        if (users.length < 200) break; // reached the last page
      }
      if (existingAuthId) {
        // Make the reused auth shell a valid client login (phone identity +
        // synthetic email + derived phone password).
        await serviceClient.auth.admin.updateUserById(existingAuthId, {
          email: authEmail,
          email_confirm: true,
          phone: phoneE164,
          phone_confirm: true,
          password,
        });
        await insertClientRows({
          userId: existingAuthId,
          orgId: actor.orgId,
          email,
          phoneE164,
          firstName,
          lastName,
          address,
          locale,
          timezone,
        });
        const audit = await getAudit();
        await audit.writeAudit(actor, "client.provisioned", "users", existingAuthId, {
          phone: phoneE164,
          created_auth: false,
          created_rows: true,
        });
        return { userId: existingAuthId, created: false };
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
    address,
    locale,
    timezone,
  });

  // Step 6: Audit (no welcome event here — downpayment.confirmed triggers it, DOC-41 §3.4 H-2)
  const audit = await getAudit();
  await audit.writeAudit(actor, "client.provisioned", "users", userId, {
    phone: phoneE164,
    created_auth: true,
    created_rows: true,
  });

  return { userId, created: true };
}

// ---------------------------------------------------------------------------
// searchClients — RF-VAN-018 (client picker for the "Nuevo caso" modal step 1)
// ---------------------------------------------------------------------------

export interface SearchClientsInput {
  query: string;
  /** Result cap — clamped to 1..20, default 8 (RF-VAN-018 picker size). */
  limit?: number;
}

export interface ClientSearchResultDto {
  userId: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
  address: ClientAddressInput | null;
  /** Number of cases where this client is the primary — shown as "N casos". */
  caseCount: number;
}

/**
 * Searches existing clients of the actor's org by name / email / phone for the
 * "¿Para quién es el caso?" picker (RF-VAN-018). Empty query → most recent
 * clients. Delegates the heavy lifting to the search_clients_for_staff RPC
 * (trigram index, one round-trip including the per-client case count).
 *
 * @api-id API-AUT-20 (staff search — clients slice)
 */
export async function searchClients(
  actor: Actor,
  input: SearchClientsInput,
): Promise<ClientSearchResultDto[]> {
  can(actor, "clients", "view");

  const query = input.query.trim();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 8), 1), 20);

  const rows = await searchClientRows(actor.orgId, query, limit);
  return rows.map((r) => ({
    userId: r.userId,
    fullName: `${r.firstName} ${r.lastName}`.trim(),
    email: r.email,
    phoneE164: r.phoneE164,
    address: r.address,
    caseCount: r.caseCount,
  }));
}

/**
 * Duplicate-phone check for the "Nuevo caso" step 1 (2026-07). The phone is the
 * client's UNIQUE identity, so when the operator types a phone that already
 * belongs to a client we surface that client — the UI warns and offers the
 * existing-client flow instead of silently creating a case under the wrong
 * account. Returns null for an invalid/incomplete phone (nothing to warn about
 * yet) or when there is no exact match. Reuses searchClients (org-scoped, gated
 * by clients:view) and keeps only an EXACT phone match — the underlying RPC
 * matches a substring of the phone digits, so a near-miss must not warn.
 *
 * @api-id API-AUT-20 (staff search — clients slice)
 */
export async function lookupClientByPhone(
  actor: Actor,
  rawPhone: string,
): Promise<ClientSearchResultDto | null> {
  let phoneE164: string;
  try {
    phoneE164 = normalizePhoneE164(rawPhone);
  } catch {
    return null;
  }
  const rows = await searchClients(actor, { query: phoneE164, limit: 10 });
  return rows.find((r) => r.phoneE164 === phoneE164) ?? null;
}

// ---------------------------------------------------------------------------
// updateClientAddress — RF-VAN-018 ("existing client" path of Nuevo caso)
// ---------------------------------------------------------------------------

export interface UpdateClientAddressInput {
  userId: string;
  /** Full US mailing address — persisted to client_profiles.address (I-589 prefill). */
  address: ClientAddressInput;
}

export type UpdateClientAddressResult =
  | { ok: true; userId: string }
  | { ok: false; code: "CLIENT_NOT_FOUND" };

/**
 * Persists the ADDRESS edited in the "Nuevo caso" step 1 for an EXISTING
 * client. Name, phone and email are deliberately IMMUTABLE in this flow: the
 * phone is the client's login credential and the password derives from it
 * (DOC-22 §1) — one account per client, so identity fields never change as a
 * side effect of case creation. Only the address may drift (the client moved)
 * and it feeds the I-589 prefill, so only it is updated.
 */
export async function updateClientAddress(
  actor: Actor,
  input: UpdateClientAddressInput,
): Promise<UpdateClientAddressResult> {
  can(actor, "clients", "edit");

  const existing = await findClientById(input.userId, actor.orgId);
  if (!existing) return { ok: false, code: "CLIENT_NOT_FOUND" };

  await updateClientAddressRow({ userId: input.userId, address: input.address });

  const audit = await getAudit();
  await audit.writeAudit(actor, "client.updated", "users", input.userId, {
    fields: ["address"],
  });

  return { ok: true, userId: input.userId };
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
