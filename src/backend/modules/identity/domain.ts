/**
 * Identity domain — pure business logic (no I/O, no imports from platform/).
 *
 * Exports:
 * - normalizePhoneE164: mirrors the SQL normalize_phone() function (DOC-30 §15).
 * - passwordPolicy: pure validation rules for staff passwords.
 *
 * These are unit-tested independently to verify the mirroring is correct.
 */

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
