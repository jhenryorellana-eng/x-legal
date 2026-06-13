/**
 * Tests for identity/domain.ts
 *
 * Covers:
 * - normalizePhoneE164: mirrors SQL normalize_phone() (DOC-30 §15)
 * - passwordPolicy: structural password validation
 */

import { describe, it, expect } from "vitest";
import {
  normalizePhoneE164,
  PhoneNormalizationError,
  normalizeEmail,
  normalizeEmailStrict,
  isValidEmail,
  EmailValidationError,
  passwordPolicy,
  PASSWORD_MIN_LENGTH,
} from "../domain";

// ---------------------------------------------------------------------------
// Email normalization + validation (DOC-22 §1 — client auth by email)
// ---------------------------------------------------------------------------

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Maria.Lopez@Example.COM ")).toBe("maria.lopez@example.com");
  });
});

describe("isValidEmail", () => {
  it("accepts well-formed emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.domain.com")).toBe(true);
    expect(isValidEmail("  USER@Example.COM ")).toBe(true); // normalized first
  });
  it("rejects malformed emails", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("no@domain")).toBe(false);
    expect(isValidEmail("two@@at.com")).toBe(false);
    expect(isValidEmail("spaces in@email.com")).toBe(false);
    expect(isValidEmail("@nolocal.com")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("normalizeEmailStrict", () => {
  it("returns the normalized email when valid", () => {
    expect(normalizeEmailStrict(" Foo@Bar.com ")).toBe("foo@bar.com");
  });
  it("throws EmailValidationError on invalid shape", () => {
    expect(() => normalizeEmailStrict("nope")).toThrow(EmailValidationError);
  });
});

// ---------------------------------------------------------------------------
// normalizePhoneE164
// ---------------------------------------------------------------------------

describe("normalizePhoneE164", () => {
  describe("valid US 10-digit inputs", () => {
    it("normalizes 10-digit string", () => {
      expect(normalizePhoneE164("3055550100")).toBe("+13055550100");
    });

    it("normalizes formatted (XXX) XXX-XXXX", () => {
      expect(normalizePhoneE164("(305) 555-0100")).toBe("+13055550100");
    });

    it("normalizes formatted with dots (XXX.XXX.XXXX)", () => {
      expect(normalizePhoneE164("305.555.0100")).toBe("+13055550100");
    });

    it("normalizes formatted with spaces", () => {
      expect(normalizePhoneE164("305 555 0100")).toBe("+13055550100");
    });

    it("normalizes formatted with dashes only (XXX-XXX-XXXX)", () => {
      expect(normalizePhoneE164("305-555-0100")).toBe("+13055550100");
    });

    it("normalizes partial parentheses (305) 555 0100", () => {
      expect(normalizePhoneE164("(305) 555 0100")).toBe("+13055550100");
    });
  });

  describe("valid US 11-digit inputs (country code included)", () => {
    it("normalizes 11-digit string starting with 1", () => {
      expect(normalizePhoneE164("13055550100")).toBe("+13055550100");
    });

    it("normalizes E.164 with + prefix", () => {
      expect(normalizePhoneE164("+13055550100")).toBe("+13055550100");
    });

    it("normalizes +1 (XXX) XXX-XXXX format", () => {
      expect(normalizePhoneE164("+1 (305) 555-0100")).toBe("+13055550100");
    });

    it("normalizes 1-XXX-XXX-XXXX format", () => {
      expect(normalizePhoneE164("1-305-555-0100")).toBe("+13055550100");
    });
  });

  describe("invalid inputs — throws PhoneNormalizationError", () => {
    it("throws for empty string", () => {
      expect(() => normalizePhoneE164("")).toThrow(PhoneNormalizationError);
    });

    it("throws for 9 digits (too short)", () => {
      expect(() => normalizePhoneE164("305555010")).toThrow(PhoneNormalizationError);
    });

    it("throws for 11 digits NOT starting with 1", () => {
      // e.g. a Mexican number prefix +52
      expect(() => normalizePhoneE164("52305555010")).toThrow(PhoneNormalizationError);
    });

    it("throws for 12 digits (too long)", () => {
      expect(() => normalizePhoneE164("123055550100")).toThrow(PhoneNormalizationError);
    });

    it("throws for non-US country code (e.g., +447911123456)", () => {
      expect(() => normalizePhoneE164("+447911123456")).toThrow(PhoneNormalizationError);
    });

    it("throws for letters-only input", () => {
      expect(() => normalizePhoneE164("not-a-phone")).toThrow(PhoneNormalizationError);
    });

    it("throws for random short string", () => {
      expect(() => normalizePhoneE164("12345")).toThrow(PhoneNormalizationError);
    });

    it("PhoneNormalizationError is an instance of Error", () => {
      try {
        normalizePhoneE164("bad");
      } catch (err) {
        expect(err).toBeInstanceOf(PhoneNormalizationError);
        expect(err).toBeInstanceOf(Error);
      }
    });
  });

  describe("idempotency", () => {
    it("is idempotent: normalizing an already-normalized E.164 returns the same value", () => {
      const normalized = "+13055550100";
      expect(normalizePhoneE164(normalized)).toBe(normalized);
    });
  });
});

// ---------------------------------------------------------------------------
// passwordPolicy
// ---------------------------------------------------------------------------

describe("passwordPolicy", () => {
  it("accepts a password of exactly 12 characters", () => {
    const result = passwordPolicy("Abcdefghij12");
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("accepts a long password", () => {
    const result = passwordPolicy("This-is-a-long-and-secure-passphrase-2026!");
    expect(result.valid).toBe(true);
  });

  it("rejects a password shorter than 12 characters", () => {
    const result = passwordPolicy("short");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("rejects an 11-character password", () => {
    const result = passwordPolicy("abcdefghij1");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("rejects an empty password", () => {
    const result = passwordPolicy("");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it(`PASSWORD_MIN_LENGTH constant is ${PASSWORD_MIN_LENGTH}`, () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });
});
