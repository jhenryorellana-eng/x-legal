/**
 * Identity domain — pure business logic (no I/O, no imports from platform/).
 *
 * Exports:
 * - normalizePhoneE164: mirrors the SQL normalize_phone() function (DOC-30 §15).
 * - derivePhonePassword: deterministic per-phone password for phone-only login.
 * - passwordPolicy: pure validation rules for staff passwords.
 *
 * These are unit-tested independently to verify the mirroring is correct.
 */

import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// Phone normalization (E.164) — DOC-22 §1.3, DOC-30 §15
//
// Mirrors the SQL function `normalize_phone(raw text) RETURNS text`.
// Rules (US-first, +1 default):
//   1. Strip all non-digit characters.
//   2. If the result is 10 digits → prepend "1" → "+1XXXXXXXXXX"
//   3. If the result is 11 digits starting with "1" → "+1XXXXXXXXXX"
//   4. Anything else → throw (invalid phone)
//
// Accepts input in formats like:
//   "(305) 555-0100"  → "+13055550100"
//   "3055550100"      → "+13055550100"
//   "+13055550100"    → "+13055550100"
//   "13055550100"     → "+13055550100"
// ---------------------------------------------------------------------------

export class PhoneNormalizationError extends Error {
  constructor(raw: string) {
    super(`Invalid phone number: "${raw}". Expected a 10-digit US number.`);
    this.name = "PhoneNormalizationError";
  }
}

/**
 * Normalizes a phone number to E.164 format (+1XXXXXXXXXX for US numbers).
 * Mirrors the SQL `normalize_phone()` function in DOC-30 §15.
 * Throws PhoneNormalizationError on invalid input.
 */
export function normalizePhoneE164(raw: string): string {
  // Remove everything that isn't a digit
  const digits = raw.replace(/\D/g, "");

  if (digits.length === 10) {
    // 10 digits → US number, prepend country code
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    // 11 digits starting with 1 → US number with country code included
    return `+${digits}`;
  }

  throw new PhoneNormalizationError(raw);
}

// ---------------------------------------------------------------------------
// Phone-only login — deterministic password derivation (DOC-22 §1, June 2026)
//
// The client logs in with ONLY their phone number (no OTP, no SMS — temporary,
// SMS-OTP comes later). To establish a real Supabase session we sign the client
// in with email + a backend-derived password they never see or set. The password
// is a stable HMAC of the E.164 phone keyed by a server-only secret, so the same
// phone always yields the same password (set at provisioning, re-derivable on
// login). The secret is passed in by the caller (service layer reads it from env)
// to keep this module pure (no platform/ imports).
//
// SECURITY: anyone who knows a client's phone can log in (no second factor). This
// is a conscious TEMPORARY product decision; the SMS-OTP step lands on top later.
// ---------------------------------------------------------------------------

/**
 * Derives the deterministic login password for a client from their E.164 phone.
 * `secret` is a stable server-only key (the service-role key). Returns a base64
 * HMAC-SHA256 — a 44-char high-entropy string that satisfies Supabase's password
 * requirements. Pure + deterministic: same (phone, secret) → same password.
 */
export function derivePhonePassword(phoneE164: string, secret: string): string {
  return createHmac("sha256", secret).update(phoneE164).digest("base64");
}

// ---------------------------------------------------------------------------
// Synthetic Auth email — phone-as-identity (DOC-22 §1, 2026-07 refactor)
//
// The client's UNIQUE identity is their phone (public.users.phone_e164 is the
// unique key; the client logs in with the phone only). The real email is
// OPTIONAL, REPEATABLE contact data (a family may share one inbox, or have
// none), so it can NOT be the Supabase Auth identity — Auth enforces a unique
// email. We therefore give Auth a synthetic email derived deterministically
// from the phone: unique per phone, stable, and never used to send mail
// (created with email_confirm:true; the subdomain has no MX). The real email
// lives only in public.users/client_profiles, where it may repeat or be null.
// ---------------------------------------------------------------------------

/**
 * A real subdomain we own that has no mail delivery configured. Synthetic Auth
 * emails live here so they (a) satisfy Supabase's email-format check, (b) are
 * guaranteed not to collide with any real inbox, and (c) never deliver mail.
 */
export const SYNTHETIC_CLIENT_EMAIL_DOMAIN = "clients.usalatinoprime.com";

/**
 * Builds the deterministic, unique-per-phone synthetic Supabase Auth email for
 * a client. The phone is normalized first, so any accepted input format maps to
 * the same canonical address. Pure + deterministic: same phone → same email.
 * Throws PhoneNormalizationError on an invalid phone (identity is mandatory).
 */
export function syntheticAuthEmail(rawPhone: string): string {
  const digits = normalizePhoneE164(rawPhone).replace(/^\+/, "");
  return `${digits}@${SYNTHETIC_CLIENT_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Email normalization + validation — DOC-22 §1 (client auth by email)
//
// SoT decision (2026-06-13): clients authenticate with the EMAIL captured at
// case intake (the "Nuevo caso" modal), NOT phone OTP. The phone is kept as
// contact data only. normalizeEmail lowercases + trims; isValidEmail does a
// pragmatic RFC-5321-ish shape check (Supabase enforces the real validation
// on signInWithOtp). No SMS / Twilio involved.
// ---------------------------------------------------------------------------

export class EmailValidationError extends Error {
  constructor(raw: string) {
    super(`Invalid email address: "${raw}".`);
    this.name = "EmailValidationError";
  }
}

/** Trims and lowercases an email for use as the stable login identity. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Pragmatic email shape: local@domain.tld, no spaces, one @, a dot in domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns true when the email has a plausible shape. */
export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(normalizeEmail(raw));
}

/**
 * Normalizes and validates an email. Throws EmailValidationError on bad shape.
 * Mirror of normalizePhoneE164's throw-on-invalid contract.
 */
export function normalizeEmailStrict(raw: string): string {
  const email = normalizeEmail(raw);
  if (!EMAIL_RE.test(email)) throw new EmailValidationError(raw);
  return email;
}

// ---------------------------------------------------------------------------
// Password policy — DOC-22 §2.2, §2.4
//
// Rules (staff passwords only — clients use OTP):
//   - Minimum length: 12 characters
//   - zxcvbn score >= 3 (validated by the caller using @zxcvbn-ts/core)
//
// passwordPolicy() checks the structural rule only (length).
// The zxcvbn check is async (requires loading language data) and is done
// in service.ts where the zxcvbn instance is already initialized.
// ---------------------------------------------------------------------------

export interface PasswordPolicyResult {
  valid: boolean;
  reason?: "too_short";
}

const PASSWORD_MIN_LENGTH = 12;

/**
 * Checks structural password policy (length).
 * The zxcvbn score check is done separately in service.ts (async).
 */
export function passwordPolicy(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, reason: "too_short" };
  }
  return { valid: true };
}

export { PASSWORD_MIN_LENGTH };
