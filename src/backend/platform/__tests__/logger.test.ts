/**
 * TDD tests for platform/logger.ts — DOC-27 §2.6 (RNF-020).
 *
 * Mandatory gate: an object containing PII must produce redacted output.
 * Tests:
 * - Direct PII keys are redacted in the serialized log line
 * - Nested PII keys (deep object) are redacted
 * - Phone numbers are partially redacted (****1234)
 * - Non-PII fields pass through unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Set up minimal env before importing (env.ts parses at load)
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://test.example.com";
process.env.ENCRYPTION_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

const { logger } = await import("../logger.js");

describe("logger — PII redaction (RNF-020)", () => {
  let writtenLines: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    writtenLines = [];
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => {
      if (typeof chunk === "string") writtenLines.push(chunk);
      else if (Buffer.isBuffer(chunk)) writtenLines.push(chunk.toString());
      return true;
    };
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("redacts top-level ssn field", () => {
    logger.info({ ssn: "123-45-6789", name: "John" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("123-45-6789");
    expect(line).toContain("[REDACTED]");
    expect(line).toContain("John"); // non-PII passes through
  });

  it("redacts a_number field", () => {
    logger.info({ a_number: "A123456789" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("A123456789");
    expect(line).toContain("[REDACTED]");
  });

  it("redacts passport field", () => {
    logger.info({ passport: "AB1234567" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("AB1234567");
    expect(line).toContain("[REDACTED]");
  });

  it("redacts otp field", () => {
    logger.info({ otp: "123456" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain('"123456"');
    expect(line).toContain("[REDACTED]");
  });

  it("redacts token field", () => {
    logger.info({ token: "secret-jwt-token" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("secret-jwt-token");
    expect(line).toContain("[REDACTED]");
  });

  it("redacts password field", () => {
    logger.info({ password: "super-secret-password" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("super-secret-password");
    expect(line).toContain("[REDACTED]");
  });

  it("redacts pii_encrypted field", () => {
    logger.info({ pii_encrypted: { iv: "abc", ct: "def", tag: "ghi" } }, "test");
    const line = writtenLines.join("");
    // The nested object should be replaced with "[REDACTED]", not expanded
    expect(line).toContain("[REDACTED]");
    // The inner keys should NOT appear
    expect(line).not.toContain('"iv":"abc"');
  });

  it("redacts authorization header", () => {
    logger.info({ authorization: "Bearer eyJhbGciOiJIUzI1NiJ9" }, "test");
    const line = writtenLines.join("");
    expect(line).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(line).toContain("[REDACTED]");
  });

  it("redacts deeply nested PII (ssn inside user.profile)", () => {
    logger.info(
      { user: { profile: { ssn: "999-88-7777", city: "LA" } } },
      "nested test",
    );
    const line = writtenLines.join("");
    expect(line).not.toContain("999-88-7777");
    expect(line).toContain("[REDACTED]");
    expect(line).toContain("LA"); // non-PII sibling passes through
  });

  it("partially redacts phone numbers in E.164 format (keeps last 4 digits)", () => {
    // +1 (310) 555-7890 — must keep "7890", mask the rest
    logger.info({ phone: "+1 310-555-7890", action: "login" }, "test");
    const line = writtenLines.join("");
    // Last 4 digits must appear
    expect(line).toContain("7890");
    // Full phone must NOT appear
    expect(line).not.toContain("+1 310-555-7890");
    // Must follow ****XXXX or similar pattern
    expect(line).toMatch(/\*{4}\d{4}/);
  });

  it("does not redact userId (UUID) or orgId fields", () => {
    const uid = "550e8400-e29b-41d4-a716-446655440000";
    logger.info({ userId: uid, action: "view" }, "access");
    const line = writtenLines.join("");
    expect(line).toContain(uid);
  });

  it("does not redact action or status fields", () => {
    logger.info({ action: "case.created", status: "active" }, "event");
    const line = writtenLines.join("");
    expect(line).toContain("case.created");
    expect(line).toContain("active");
  });

  it("outputs valid JSON (structured logging)", () => {
    logger.info({ requestId: "req-001", status: 200 }, "response sent");
    const line = writtenLines.find((l) => l.includes("req-001")) ?? "";
    expect(() => JSON.parse(line.trim())).not.toThrow();
  });

  it("error level includes error message in output", () => {
    logger.error({ err: new Error("boom"), code: "E001" }, "handler failed");
    const line = writtenLines.join("");
    expect(line).toContain("boom");
  });

  it("includes level field in every log line", () => {
    logger.warn({ source: "stripe" }, "invalid sig");
    const line = writtenLines.join("");
    const parsed = JSON.parse(line.trim());
    expect(parsed.level).toBe("warn");
  });
});
