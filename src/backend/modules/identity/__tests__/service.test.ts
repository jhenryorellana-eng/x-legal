/**
 * Tests for identity/service.ts
 *
 * Strategy: mock all I/O (Supabase, ratelimit, repository) so tests are pure.
 * Covers:
 * - requestClientOtp: eligible vs not-eligible same response, rate limit, invalid phone
 * - verifyClientOtp: valid code, invalid code, re-gate expulsion
 * - requestStaffPasswordReset: uniform response
 * - updateStaffPassword: length policy, zxcvbn score
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before any import of the SUT
// ---------------------------------------------------------------------------

// @zxcvbn-ts — avoid fflate/decompress ESM issue in Vitest.
// ZxcvbnFactory mock: check() returns score=0 for weak patterns, 4 otherwise.
vi.mock("@zxcvbn-ts/core", () => {
  function ZxcvbnFactory() {
    return {
      check: (password: string) => {
        const weakPatterns = ["password", "123456", "qwerty"];
        const isWeak = weakPatterns.some((w) => password.toLowerCase().includes(w));
        return { score: isWeak ? 0 : 4 };
      },
    };
  }
  return { ZxcvbnFactory };
});
vi.mock("@zxcvbn-ts/language-common", () => ({ adjacencyGraphs: {}, dictionary: {} }));

// platform/ratelimit
vi.mock("@/backend/platform/ratelimit.js", () => ({
  limitOtpSendPhone: vi.fn(),
  limitOtpSendIp: vi.fn(),
  limitOtpVerifyPhone: vi.fn(),
}));

// platform/logger
vi.mock("@/backend/platform/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// platform/authz
vi.mock("@/backend/platform/authz.js", () => ({
  requireActor: vi.fn(),
}));

// identity/repository
vi.mock("../repository.js", () => ({
  checkClientEligibility: vi.fn(),
  checkClientEligibilityById: vi.fn(),
}));

// platform/supabase — factory uses vi.fn() without referencing hoisted vars
vi.mock("@/backend/platform/supabase.js", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT and mocks AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import {
  requestClientOtp,
  verifyClientOtp,
  requestStaffPasswordReset,
  updateStaffPassword,
} from "../service";

import {
  limitOtpSendPhone,
  limitOtpSendIp,
  limitOtpVerifyPhone,
} from "@/backend/platform/ratelimit";
import { requireActor } from "@/backend/platform/authz";
import { checkClientEligibility, checkClientEligibilityById } from "../repository";
import { createServerClient, createServiceClient } from "@/backend/platform/supabase";

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Supabase server client
// ---------------------------------------------------------------------------

function buildServerClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: "u-001" } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      updateUser: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      ...overrides,
    },
  };
}

function buildServiceClient(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      admin: {
        updateUserById: vi.fn().mockResolvedValue({ error: null }),
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// requestClientOtp
// ---------------------------------------------------------------------------

describe("requestClientOtp", () => {
  const validPhone = "(305) 555-0100"; // normalizes to +13055550100
  const ip = "1.2.3.4";

  beforeEach(() => {
    vi.mocked(limitOtpSendPhone).mockResolvedValue({ allowed: true, reset: 0 });
    vi.mocked(limitOtpSendIp).mockResolvedValue({ allowed: true, reset: 0 });
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);
  });

  it("returns { ok: true } when phone is eligible", async () => {
    vi.mocked(checkClientEligibility).mockResolvedValue({ eligible: true });
    const result = await requestClientOtp(validPhone, ip);
    expect(result).toEqual({ ok: true });
  }, 2000);

  it("returns { ok: true } when phone is NOT eligible (anti-enumeration — same response)", async () => {
    vi.mocked(checkClientEligibility).mockResolvedValue({ eligible: false });

    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    const result = await requestClientOtp(validPhone, ip);
    expect(result).toEqual({ ok: true });
    // MUST NOT call signInWithOtp for ineligible phones
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  }, 2000);

  it("calls signInWithOtp with shouldCreateUser=false when eligible", async () => {
    vi.mocked(checkClientEligibility).mockResolvedValue({ eligible: true });
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    await requestClientOtp(validPhone, ip);

    expect(client.auth.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+13055550100",
        options: expect.objectContaining({ shouldCreateUser: false, channel: "sms" }),
      }),
    );
  }, 2000);

  it("throws IdentityError('rate_limited') when phone rate limit exceeded", async () => {
    vi.mocked(limitOtpSendPhone).mockResolvedValue({ allowed: false, reset: Date.now() + 30_000 });
    await expect(requestClientOtp(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }),
    );
  }, 2000);

  it("throws IdentityError('rate_limited') when IP rate limit exceeded", async () => {
    vi.mocked(limitOtpSendIp).mockResolvedValue({ allowed: false, reset: Date.now() + 30_000 });
    await expect(requestClientOtp(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }),
    );
  }, 2000);

  it("throws IdentityError('invalid_phone') for an invalid phone", async () => {
    await expect(requestClientOtp("not-a-phone", ip)).rejects.toThrow(
      expect.objectContaining({ code: "invalid_phone" }),
    );
  }, 2000);
});

// ---------------------------------------------------------------------------
// verifyClientOtp
// ---------------------------------------------------------------------------

describe("verifyClientOtp", () => {
  const validPhone = "(305) 555-0100";
  const validCode = "123456";

  beforeEach(() => {
    vi.mocked(limitOtpVerifyPhone).mockResolvedValue({ allowed: true, reset: 0 });
  });

  it("returns { ok: true } when OTP is valid and re-gate passes", async () => {
    const userId = "user-uuid-001";
    const client = buildServerClient({
      verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);
    vi.mocked(checkClientEligibilityById).mockResolvedValue({ eligible: true });

    const result = await verifyClientOtp(validPhone, validCode);
    expect(result).toEqual({ ok: true });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("throws IdentityError('invalid_otp') on wrong code", async () => {
    const client = buildServerClient({
      verifyOtp: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } }),
    });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    await expect(verifyClientOtp(validPhone, validCode)).rejects.toThrow(
      expect.objectContaining({ code: "invalid_otp" }),
    );
  });

  it("re-gate: signs out and throws when client is no longer eligible after verifyOtp", async () => {
    const userId = "user-uuid-002";
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    const client = buildServerClient({
      verifyOtp: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      signOut: signOutMock,
    });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);
    vi.mocked(checkClientEligibilityById).mockResolvedValue({ eligible: false });

    await expect(verifyClientOtp(validPhone, validCode)).rejects.toThrow(
      expect.objectContaining({ code: "wrong_kind", message: "no_access" }),
    );
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  });

  it("throws IdentityError('rate_limited') when verify rate limit exceeded", async () => {
    vi.mocked(limitOtpVerifyPhone).mockResolvedValue({ allowed: false, reset: Date.now() + 30_000 });

    await expect(verifyClientOtp(validPhone, validCode)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }),
    );
  });

  it("throws IdentityError('invalid_phone') for an invalid phone", async () => {
    await expect(verifyClientOtp("bad", "123456")).rejects.toThrow(
      expect.objectContaining({ code: "invalid_phone" }),
    );
  });
});

// ---------------------------------------------------------------------------
// requestStaffPasswordReset
// ---------------------------------------------------------------------------

describe("requestStaffPasswordReset", () => {
  it("always returns { ok: true } regardless of whether the email exists", async () => {
    const client = buildServerClient({
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    const result = await requestStaffPasswordReset("anyone@example.com", "https://app/reset");
    expect(result).toEqual({ ok: true });
  });

  it("still returns { ok: true } when resetPasswordForEmail returns an error (anti-enum)", async () => {
    const client = buildServerClient({
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { message: "User not found" } }),
    });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    const result = await requestStaffPasswordReset("unknown@example.com", "https://app/reset");
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// updateStaffPassword
// ---------------------------------------------------------------------------

describe("updateStaffPassword", () => {
  beforeEach(() => {
    const serviceClient = buildServiceClient();
    vi.mocked(createServiceClient).mockReturnValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
serviceClient as any);
  });

  it("throws IdentityError('wrong_kind') when actor is a client", async () => {
    vi.mocked(requireActor).mockResolvedValue({
      userId: "client-001",
      orgId: "org-001",
      kind: "client",
      role: null,
      permissions: new Map(),
    });

    await expect(updateStaffPassword("Correct-password-2026!")).rejects.toThrow(
      expect.objectContaining({ code: "wrong_kind" }),
    );
  });

  it("throws IdentityError('password_too_short') for a password under 12 chars", async () => {
    vi.mocked(requireActor).mockResolvedValue({
      userId: "staff-001",
      orgId: "org-001",
      kind: "staff",
      role: "admin",
      permissions: new Map(),
    });

    await expect(updateStaffPassword("short")).rejects.toThrow(
      expect.objectContaining({ code: "password_too_short" }),
    );
  });

  it("throws IdentityError('password_too_weak') for a weak password (zxcvbn score < 3)", async () => {
    vi.mocked(requireActor).mockResolvedValue({
      userId: "staff-001",
      orgId: "org-001",
      kind: "staff",
      role: "admin",
      permissions: new Map(),
    });

    // "password1234" matches the weak pattern in our mock zxcvbn
    await expect(updateStaffPassword("password1234")).rejects.toThrow(
      expect.objectContaining({ code: "password_too_weak" }),
    );
  });

  it("succeeds for a strong password and clears must_change_password", async () => {
    const staffActor = {
      userId: "staff-001",
      orgId: "org-001",
      kind: "staff" as const,
      role: "admin" as const,
      permissions: new Map(),
    };
    vi.mocked(requireActor).mockResolvedValue(staffActor);

    const updateUserMock = vi.fn().mockResolvedValue({ error: null });
    const client = buildServerClient({ updateUser: updateUserMock });
    vi.mocked(createServerClient).mockResolvedValue(// eslint-disable-next-line @typescript-eslint/no-explicit-any
client as any);

    const updateByIdMock = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({
      auth: { admin: { updateUserById: updateByIdMock } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // A password that doesn't match weak patterns and is >= 12 chars
    const result = await updateStaffPassword("Tr0ub4dor&3!Stapl3");
    expect(result).toEqual({ ok: true });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "Tr0ub4dor&3!Stapl3" });
    expect(updateByIdMock).toHaveBeenCalledWith(
      "staff-001",
      { app_metadata: { must_change_password: false } },
    );
  });
});
