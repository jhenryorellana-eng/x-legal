/**
 * Structured logger — DOC-27 §2.6 (RNF-020).
 *
 * Outputs newline-delimited JSON to stdout (Vercel captures it for log drains).
 * Applies automatic PII redaction BEFORE serialization:
 * - Keys in ALWAYS_REDACT → value replaced with "[REDACTED]"
 * - Phone-shaped strings → masked to "****XXXX" (last 4 digits)
 * - Deep objects are recursively cleaned.
 *
 * Never logs: SSN, A-number, passport, OTP codes, tokens, passwords, raw
 * webhook bodies, AI prompts with case data, or any PII.
 *
 * Usage:
 *   import { logger } from '@/backend/platform/logger';
 *   logger.info({ requestId, userId }, 'Actor resolved');
 *   logger.warn({ source, ip }, 'Invalid webhook signature');
 *   logger.error({ err, code }, 'Handler failed');
 */

// Keys whose values are ALWAYS replaced with "[REDACTED]" (DOC-27 §2.6)
const ALWAYS_REDACT = new Set([
  "ssn",
  "a_number",
  "passport",
  "pii_encrypted",
  "otp",
  "code",
  "token",
  "signature",
  "authorization",
  "password",
  "answers",
  "raw_text",
  "body",
]);

// Matches phone numbers conservatively to avoid false positives with UUIDs.
// Requirements: must either start with '+' (E.164) or be a standalone
// 10-digit US format (area code + number, with optional separators).
// The negative lookbehind/ahead prevent matching digit sequences embedded
// inside UUID hex strings (which have hex chars a-f around them).
const PHONE_RE = /(?<![0-9a-fA-F])(\+\d{1,3}[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}(?![0-9a-fA-F])/g;

type LogLevel = "info" | "warn" | "error";

// ---------------------------------------------------------------------------
// Redaction engine
// ---------------------------------------------------------------------------

function redactPhone(value: string): string {
  return value.replace(PHONE_RE, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 4) return match;
    return "****" + digits.slice(-4);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Error) &&
    !(value instanceof Date)
  );
}

/**
 * Recursively redacts a value before it is written to the log.
 * Called with the key of the parent object so we know if this field is sensitive.
 */
function redactValue(key: string, value: unknown): unknown {
  if (ALWAYS_REDACT.has(key.toLowerCase())) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    // Phone number partial masking
    return redactPhone(value);
  }
  if (isPlainObject(value)) {
    return redactObject(value);
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => redactValue(String(idx), item));
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
      stack: err.stack,
    };
  }
  return { raw: String(err) };
}

function buildLogLine(
  level: LogLevel,
  context: Record<string, unknown>,
  message: string,
): string {
  // Pull out `err` before redacting so we serialize it properly
  const { err, ...rest } = context;

  const base: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...redactObject(rest),
  };

  if (err !== undefined) {
    base["err"] = serializeError(err);
  }

  return JSON.stringify(base);
}

// ---------------------------------------------------------------------------
// Public logger
// ---------------------------------------------------------------------------
// console.* (not process.stdout) on purpose: the logger is imported by
// src/middleware.ts, which runs on the Edge Runtime where process.stdout does
// not exist (Turbopack fails the build on any static reference to it).
// In Node, console.log/warn/error write the JSON line to stdout/stderr just
// the same — one logger, both runtimes.

export const logger = {
  info(context: Record<string, unknown>, message: string): void {
    console.log(buildLogLine("info", context, message));
  },

  warn(context: Record<string, unknown>, message: string): void {
    console.warn(buildLogLine("warn", context, message));
  },

  error(context: Record<string, unknown>, message: string): void {
    console.error(buildLogLine("error", context, message));
  },
};
