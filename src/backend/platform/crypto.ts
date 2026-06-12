/**
 * PII field encryption — DOC-27 §2.
 *
 * AES-256-GCM with a random 12-byte IV per write.
 * Stored format per field: { iv: base64(12B), ct: base64, tag: base64(16B) }
 *
 * Key rotation (§2.5): decrypt first tries ENCRYPTION_KEY; if the GCM auth tag
 * fails (wrong key), retries with ENCRYPTION_KEY_PREVIOUS before propagating.
 *
 * BOUNDARIES: import only from repository.ts / service.ts (rule R5, DOC-21).
 * Never import in frontend or app routes.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncryptedField {
  /** Base64-encoded 12-byte IV (random per write). */
  iv: string;
  /** Base64-encoded ciphertext. */
  ct: string;
  /** Base64-encoded 16-byte GCM authentication tag. */
  tag: string;
}

/** Allowed keys inside `pii_encrypted` jsonb (DOC-30 §1 / DOC-27 §2.2). */
export const ALLOWED_PII_KEYS = ["ssn", "a_number", "passport"] as const;
export type PiiFieldKey = (typeof ALLOWED_PII_KEYS)[number];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getKey(keyBase64: string): Buffer {
  return Buffer.from(keyBase64, "base64");
}

function tryDecrypt(ciphertext: EncryptedField, keyBase64: string): string {
  const key = getKey(keyBase64);
  const iv = Buffer.from(ciphertext.iv, "base64");
  const ct = Buffer.from(ciphertext.ct, "base64");
  const tag = Buffer.from(ciphertext.tag, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString("utf8");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encrypts a plain-text PII value with AES-256-GCM using ENCRYPTION_KEY.
 * A random 12-byte IV is generated per call — same input yields different output.
 */
export function encryptPiiField(plaintext: string): EncryptedField {
  const key = getKey(env.ENCRYPTION_KEY);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag(); // always 16 bytes in GCM

  return {
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypts an EncryptedField produced by `encryptPiiField`.
 *
 * Key rotation fallback: if decryption with ENCRYPTION_KEY fails (bad auth tag),
 * retries with ENCRYPTION_KEY_PREVIOUS. Throws if both fail or if the previous
 * key is not configured.
 */
export function decryptPiiField(ciphertext: EncryptedField): string {
  try {
    return tryDecrypt(ciphertext, env.ENCRYPTION_KEY);
  } catch (primaryErr) {
    if (!env.ENCRYPTION_KEY_PREVIOUS) {
      throw primaryErr;
    }
    // Only a GCM auth-tag failure means "wrong key" (rotation window —
    // DOC-27 §2.5). Any other error (bad IV length, malformed input) is a
    // programming error and must surface, not be masked by a retry.
    const isAuthFailure =
      primaryErr instanceof Error &&
      /unable to authenticate|auth/i.test(primaryErr.message);
    if (!isAuthFailure) {
      throw primaryErr;
    }
    return tryDecrypt(ciphertext, env.ENCRYPTION_KEY_PREVIOUS);
  }
}

/**
 * Returns a masked representation of a PII value for UI display.
 * Shows only the last 4 characters; everything else becomes `*`.
 *
 * Examples:
 *   "123-45-6789"  → "***-**-6789"
 *   "A12345678"    → "*****5678"
 *   "123"          → "***"          (shorter than 4 chars — full mask)
 *
 * DOC-27 §2.4: the masked value is calculated server-side on the fly and is
 * never persisted.
 */
export function maskValue(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return "*".repeat(value.length);
  const last4 = value.slice(-4);
  const masked = value.slice(0, -4).replace(/[^\s\-]/g, "*");
  return masked + last4;
}

/**
 * Validates that a given string is an allowed PII field key.
 * Use before accepting user-supplied field names for encrypt/decrypt operations.
 */
export function isAllowedPiiKey(key: string): key is PiiFieldKey {
  return (ALLOWED_PII_KEYS as readonly string[]).includes(key);
}
