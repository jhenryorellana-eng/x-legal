/**
 * Identity service — F0 use cases (DOC-22 §1, §2).
 *
 * Use cases implemented:
 * - requestClientOtp      (anonymous) — normalize, rate limit, gate, signInWithOtp
 * - verifyClientOtp       (anonymous) — rate limit, verifyOtp, re-gate post-session
 * - requestStaffPasswordReset (anonymous) — resetPasswordForEmail, uniform response
 * - updateStaffPassword   (authenticated) — zxcvbn score check, updateUser
 *
 * Authorization rules per DOC-22 §5.2:
 * - Anonymous use cases: no Actor required (explicitly documented here per DOC-22 §7)
 * - Authenticated use cases: requireActor() + can() as first line
 */

import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import { adjacencyGraphs, dictionary } from "@zxcvbn-ts/language-common";

import { requireActor } from "@/backend/platform/authz";
import { createServerClient, createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import {
  limitOtpSendPhone,
  limitOtpSendIp,
  limitOtpVerifyPhone,
} from "@/backend/platform/ratelimit";

import { normalizePhoneE164, passwordPolicy, PhoneNormalizationError } from "./domain";
import { checkClientEligibility, checkClientEligibilityById } from "./repository";

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
// Error types
// ---------------------------------------------------------------------------

export class IdentityError extends Error {
  constructor(
    public readonly code:
      | "rate_limited"
      | "invalid_phone"
      | "invalid_otp"
      | "password_too_short"
      | "password_too_weak"
      | "unauthenticated"
      | "wrong_kind",
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
 * Requests an OTP for a client phone number.
 *
 * Steps:
 * 1. Normalize phone to E.164 (server-side — DOC-22 §1.3).
 * 2. Rate limit: phone tiers (1/45s, 5/h, 8/d) + IP tiers (10/h, 30/d).
 * 3. GATE (service client): check eligibility (kind=client, is_active, has activated case).
 * 4. If eligible: supabase.auth.signInWithOtp (shouldCreateUser=false).
 * 5. Apply 800ms latency floor (both branches take the same wall time — DOC-22 §1.4).
 * 6. Return { ok: true } ALWAYS — anti-enumeration.
 *
 * @param rawPhone - Phone in any US format; normalized server-side.
 * @param ip       - Request IP for per-IP rate limiting.
 */
export async function requestClientOtp(
  rawPhone: string,
  ip: string,
): Promise<OtpRequestResult> {
  const start = Date.now();

  // Step 1: Normalize
  let phoneE164: string;
  try {
    phoneE164 = normalizePhoneE164(rawPhone);
  } catch (err) {
    if (err instanceof PhoneNormalizationError) {
      // Pad to floor and return uniform response — invalid phones still get 800ms
      await enforceFloor(start, OTP_LATENCY_FLOOR_MS);
      // Log server-side, surface generic response
      logger.info({ err: err.message }, "requestClientOtp: invalid phone format");
      throw new IdentityError("invalid_phone", err.message);
    }
    throw err;
  }

  // Step 2: Rate limit (closed fail mode — see ratelimit.ts)
  const [phoneRL, ipRL] = await Promise.all([
    limitOtpSendPhone(phoneE164),
    limitOtpSendIp(ip),
  ]);

  if (!phoneRL.allowed || !ipRL.allowed) {
    await enforceFloor(start, OTP_LATENCY_FLOOR_MS);
    throw new IdentityError("rate_limited");
  }

  // Step 3: Gate — check eligibility (always runs; result determines if we send SMS)
  const { eligible } = await checkClientEligibility(phoneE164);

  if (eligible) {
    // Step 4: Send OTP — only when eligible (shouldCreateUser=false is mandatory)
    const supabase = await createServerClient();
    const { error } = await supabase.auth.signInWithOtp({
      phone: phoneE164,
      options: {
        shouldCreateUser: false, // MANDATORY — never create phantom auth users (DOC-22 §1.3)
        channel: "sms",
      },
    });

    if (error) {
      logger.warn({ err: error.message }, "requestClientOtp: signInWithOtp returned error");
      // Still return uniform response — the client has no visibility into this failure
    }
  } else {
    // Not eligible: do NOT send SMS. Latency floor ensures timing parity.
    logger.info({}, "requestClientOtp: gate check failed — no SMS sent (anti-enum)");
  }

  // Step 5: Enforce 800ms floor (DOC-22 §1.4)
  await enforceFloor(start, OTP_LATENCY_FLOOR_MS);

  // Step 6: Uniform response
  return { ok: true };
}

// ---------------------------------------------------------------------------
// verifyClientOtp — anonymous use case (DOC-22 §1.3, §1.4 re-gate)
// ---------------------------------------------------------------------------

/**
 * Verifies an OTP and establishes a session.
 *
 * Steps:
 * 1. Normalize phone.
 * 2. Rate limit: verify tier (10/h).
 * 3. supabase.auth.verifyOtp → creates session cookies via @supabase/ssr.
 * 4. RE-GATE post-session (DOC-22 §1.4, RF-CLI-006):
 *    If no longer eligible → signOut() + throw (caller redirects to /no-access).
 *
 * @param rawPhone - Phone in any US format.
 * @param code     - 6-digit OTP code.
 */
export async function verifyClientOtp(
  rawPhone: string,
  code: string,
): Promise<OtpVerifyResult> {
  // Step 1: Normalize
  let phoneE164: string;
  try {
    phoneE164 = normalizePhoneE164(rawPhone);
  } catch {
    throw new IdentityError("invalid_phone");
  }

  // Step 2: Rate limit
  const rl = await limitOtpVerifyPhone(phoneE164);
  if (!rl.allowed) {
    throw new IdentityError("rate_limited");
  }

  // Step 3: Verify OTP
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: phoneE164,
    token: code,
    type: "sms",
  });

  if (error || !data.user) {
    // Uniform error — does not reveal eligibility (DOC-22 §1.4)
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
