/**
 * Tests for identity/service.ts
 *
 * Strategy: mock all I/O (Supabase, ratelimit, repository) so tests are pure.
 * Covers:
 * - loginClientByPhone: happy path, not-found/ineligible (uniform), legacy retry,
 *   re-gate expulsion, rate limit, invalid phone
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
}));

// platform/env — phone-login password derivation reads SUPABASE_SERVICE_ROLE_KEY
vi.mock("@/backend/platform/env", () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-key" },
  providerEnv: vi.fn(),
}));

// platform/logger
vi.mock("@/backend/platform/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// platform/authz
vi.mock("@/backend/platform/authz.js", () => ({
  requireActor: vi.fn(),
  can: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); this.name = "AuthzError"; }
  },
}));

// identity/repository
vi.mock("../repository.js", () => ({
  checkClientEligibility: vi.fn(),
  checkClientEligibilityById: vi.fn(),
  findClientByPhone: vi.fn(),
  searchClientRows: vi.fn().mockResolvedValue([]),
  insertStaffRows: vi.fn(),
  replaceStaffPermissions: vi.fn(),
  setStaffActive: vi.fn(),
  listStaffMembers: vi.fn(),
  getStaffProfileById: vi.fn(),
  findStaffById: vi.fn(),
  countActiveAdminsByOrg: vi.fn(),
  countActiveStaff: vi.fn().mockResolvedValue(0),
}));

// platform/resend — mock to avoid env validation
vi.mock("@/backend/platform/resend.js", () => ({
  sendTransactional: vi.fn().mockResolvedValue({ id: "email-id-1" }),
  FROM_TRANSACTIONAL: "test@mail.example.com",
}));

// platform/events — mock to avoid initialization
vi.mock("@/backend/platform/events.js", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn() },
}));

// audit module — mock dynamic import target
vi.mock("@/backend/modules/audit/index.js", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

// platform/supabase — factory uses vi.fn() without referencing hoisted vars
vi.mock("@/backend/platform/supabase.js", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
  revokeAllSessions: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT and mocks AFTER vi.mock declarations
// ---------------------------------------------------------------------------

import {
  loginClientByPhone,
  lookupClientByPhone,
  requestStaffPasswordReset,
  updateStaffPassword,
} from "../service";

import {
  limitOtpSendPhone,
  limitOtpSendIp,
} from "@/backend/platform/ratelimit";
import { requireActor } from "@/backend/platform/authz";
import {
  checkClientEligibility,
  checkClientEligibilityById,
  findClientByPhone,
  searchClientRows,
} from "../repository";
import { derivePhonePassword } from "../domain";
import { createServerClient, createServiceClient } from "@/backend/platform/supabase";

// ---------------------------------------------------------------------------
// Helper: build a minimal mock Supabase server client
// ---------------------------------------------------------------------------

function buildServerClient(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    auth: {
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "u-001" } }, error: null }),
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
// loginClientByPhone
// ---------------------------------------------------------------------------

describe("loginClientByPhone", () => {
  const validPhone = "(305) 555-0100";
  const normalized = "+13055550100";
  const email = "maria@example.com";
  const userId = "u-001";
  const ip = "1.2.3.4";

  beforeEach(() => {
    vi.mocked(limitOtpSendPhone).mockResolvedValue({ allowed: true, reset: 0 });
    vi.mocked(limitOtpSendIp).mockResolvedValue({ allowed: true, reset: 0 });
    vi.mocked(findClientByPhone).mockResolvedValue({ id: userId, email, existed: true });
    vi.mocked(checkClientEligibility).mockResolvedValue({ eligible: true });
    vi.mocked(checkClientEligibilityById).mockResolvedValue({ eligible: true });
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);
    const serviceClient = buildServiceClient();
    vi.mocked(createServiceClient).mockReturnValue( 
serviceClient as any);
  });

  it("signs the client in by PHONE with the derived password (happy path)", async () => {
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue(
client as any);

    const result = await loginClientByPhone(validPhone, ip);
    expect(result).toEqual({ ok: true });
    // signInWithPassword called with the PHONE (not the email) + derived password.
    // The email is decoupled from Auth — the phone is the identity.
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: normalized,
      password: derivePhonePassword(normalized, "test-service-key"),
    });
    // post-session re-gate ran with the user id
    expect(checkClientEligibilityById).toHaveBeenCalledWith(userId);
  }, 2000);

  it("resolves the client by the NORMALIZED phone", async () => {
    await loginClientByPhone(validPhone, ip);
    expect(findClientByPhone).toHaveBeenCalledWith(normalized);
    expect(checkClientEligibility).toHaveBeenCalledWith(normalized);
  }, 2000);

  it("signs in a client with NO email (phone is the identity; email is optional)", async () => {
    // 2026-07: the email is optional/repeatable contact data — a client
    // provisioned without one must still be able to log in with their phone.
    vi.mocked(findClientByPhone).mockResolvedValue({ id: userId, email: null, existed: true });
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue(client as never);

    const result = await loginClientByPhone(validPhone, ip);
    expect(result).toEqual({ ok: true });
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: normalized,
      password: derivePhonePassword(normalized, "test-service-key"),
    });
  }, 2000);

  it("throws wrong_kind (uniform) when no client has that phone — no sign-in attempt", async () => {
    vi.mocked(findClientByPhone).mockResolvedValue(null);
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);

    await expect(loginClientByPhone(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "wrong_kind", message: "no_access" }),
    );
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  }, 2000);

  it("throws wrong_kind (uniform) when the client exists but is NOT eligible", async () => {
    vi.mocked(checkClientEligibility).mockResolvedValue({ eligible: false });
    const client = buildServerClient();
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);

    await expect(loginClientByPhone(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "wrong_kind", message: "no_access" }),
    );
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
  }, 2000);

  it("self-heal: sets phone + password via admin then retries sign-in once", async () => {
    // First sign-in by phone fails (a legacy user without phone/password set on
    // Auth), then succeeds after the admin backfill. This auto-migrates any
    // client not yet covered by the batch backfill.
    const signInMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: "Invalid login credentials" } })
      .mockResolvedValueOnce({ data: { user: { id: userId } }, error: null });
    const client = buildServerClient({ signInWithPassword: signInMock });
    vi.mocked(createServerClient).mockResolvedValue(
client as any);
    const updateByIdMock = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({
      auth: { admin: { updateUserById: updateByIdMock } },

    } as any);

    const result = await loginClientByPhone(validPhone, ip);
    expect(result).toEqual({ ok: true });
    // Backfills the phone identity + confirmation + derived password on Auth.
    expect(updateByIdMock).toHaveBeenCalledWith(userId, {
      phone: normalized,
      phone_confirm: true,
      password: derivePhonePassword(normalized, "test-service-key"),
    });
    expect(signInMock).toHaveBeenCalledTimes(2);
  }, 2000);

  it("re-gate: signs out and throws when no longer eligible after sign-in", async () => {
    const signOutMock = vi.fn().mockResolvedValue({ error: null });
    const client = buildServerClient({ signOut: signOutMock });
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);
    vi.mocked(checkClientEligibilityById).mockResolvedValue({ eligible: false });

    await expect(loginClientByPhone(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "wrong_kind", message: "no_access" }),
    );
    expect(signOutMock).toHaveBeenCalledWith({ scope: "local" });
  }, 2000);

  it("throws rate_limited when the phone tier is exceeded", async () => {
    vi.mocked(limitOtpSendPhone).mockResolvedValue({ allowed: false, reset: Date.now() + 30_000 });
    await expect(loginClientByPhone(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }),
    );
  }, 2000);

  it("throws rate_limited when the IP tier is exceeded", async () => {
    vi.mocked(limitOtpSendIp).mockResolvedValue({ allowed: false, reset: Date.now() + 30_000 });
    await expect(loginClientByPhone(validPhone, ip)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }),
    );
  }, 2000);

  it("throws invalid_phone for a malformed phone", async () => {
    await expect(loginClientByPhone("123", ip)).rejects.toThrow(
      expect.objectContaining({ code: "invalid_phone" }),
    );
  }, 2000);
});

// ---------------------------------------------------------------------------
// lookupClientByPhone — the "Nuevo caso" step-1 duplicate-phone check. The
// phone is the unique identity: warn the operator (and offer the existing
// client) instead of silently merging cases into the wrong account.
// ---------------------------------------------------------------------------

describe("lookupClientByPhone", () => {
  const ACTOR = {
    userId: "staff-1",
    orgId: "org-1",
    kind: "staff" as const,
    role: "admin" as const,
    permissions: new Map(),
  };

  const row = {
    userId: "client-9",
    firstName: "Ivis",
    lastName: "Palma",
    email: "shared@example.com",
    phoneE164: "+13466094183",
    address: null,
    caseCount: 1,
  };

  beforeEach(() => {
    vi.mocked(requireActor).mockResolvedValue(ACTOR as never);
  });

  it("returns the existing client on an EXACT normalized-phone match", async () => {
    vi.mocked(searchClientRows).mockResolvedValue([row]);

    const result = await lookupClientByPhone(ACTOR as never, "(346) 609-4183");

    expect(result).toMatchObject({ userId: "client-9", phoneE164: "+13466094183", caseCount: 1 });
    // Searched within the actor's org using the normalized phone
    expect(searchClientRows).toHaveBeenCalledWith("org-1", "+13466094183", expect.any(Number));
  });

  it("returns null when the RPC only surfaces a PARTIAL (different) phone match", async () => {
    // The RPC does a LIKE on phone digits, so a substring can come back — we must
    // keep only an exact match, never warn on a near-miss.
    vi.mocked(searchClientRows).mockResolvedValue([{ ...row, phoneE164: "+13466094999" }]);

    const result = await lookupClientByPhone(ACTOR as never, "+13466094183");
    expect(result).toBeNull();
  });

  it("returns null (without querying) for an invalid / incomplete phone", async () => {
    vi.mocked(searchClientRows).mockClear();

    const result = await lookupClientByPhone(ACTOR as never, "346");
    expect(result).toBeNull();
    expect(searchClientRows).not.toHaveBeenCalled();
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
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);

    const result = await requestStaffPasswordReset("anyone@example.com", "https://app/reset");
    expect(result).toEqual({ ok: true });
  });

  it("still returns { ok: true } when resetPasswordForEmail returns an error (anti-enum)", async () => {
    const client = buildServerClient({
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: { message: "User not found" } }),
    });
    vi.mocked(createServerClient).mockResolvedValue( 
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
    vi.mocked(createServiceClient).mockReturnValue( 
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
    vi.mocked(createServerClient).mockResolvedValue( 
client as any);

    const updateByIdMock = vi.fn().mockResolvedValue({ error: null });
    vi.mocked(createServiceClient).mockReturnValue({
      auth: { admin: { updateUserById: updateByIdMock } },
       
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
