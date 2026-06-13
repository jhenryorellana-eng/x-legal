/**
 * Tests for identity/service.ts — provisionClientUser (DOC-22 §1, email auth).
 *
 * Covers:
 * - Idempotent by email: returns existing userId when email already registered
 * - Creates auth user (email + email_confirm) + public rows when email is new
 * - Derives first/last name correctly from fullName
 * - Handles race condition: auth user exists but public.users row is missing
 * - Requires clients:edit permission
 * - Phone is optional contact data (not the login identity)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock references
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockFindClientByEmail,
  mockInsertClientRows,
  mockCreateUser,
  mockListUsers,
  mockWriteAudit,
  mockDbQueryChain,
} = vi.hoisted(() => {
  // Chainable Supabase query-builder stub (used by the race-recovery path)
  const chain = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
  chain.from.mockReturnValue(chain);
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);

  return {
    mockCan: vi.fn(),
    mockFindClientByEmail: vi.fn(),
    mockInsertClientRows: vi.fn().mockResolvedValue(undefined),
    mockCreateUser: vi.fn(),
    mockListUsers: vi.fn().mockResolvedValue({ data: { users: [] } }),
    mockWriteAudit: vi.fn().mockResolvedValue(undefined),
    mockDbQueryChain: chain,
  };
});

// ---------------------------------------------------------------------------
// Mocks (before any SUT import)
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({
    auth: {
      admin: {
        createUser: mockCreateUser,
        listUsers: mockListUsers,
      },
    },
    // serviceClient.from(…) chain for the public.users race-recovery lookup
    from: mockDbQueryChain.from,
  }),
  revokeAllSessions: vi.fn(),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/ratelimit", () => ({
  limitOtpSendEmail: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpSendIp: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpVerifyEmail: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@/backend/platform/resend", () => ({
  sendTransactional: vi.fn().mockResolvedValue({ id: "email-1" }),
  FROM_TRANSACTIONAL: "no-reply@test.com",
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@zxcvbn-ts/core", () => {
  function ZxcvbnFactory() { return { check: (_pw: string) => ({ score: 4 }) }; }
  return { ZxcvbnFactory };
});

vi.mock("@zxcvbn-ts/language-common", () => ({
  adjacencyGraphs: {},
  dictionary: {},
}));

// Mock repository helpers used by provisionClientUser
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findClientByEmail: mockFindClientByEmail,
    findClientByPhone: vi.fn().mockResolvedValue(null),
    insertClientRows: mockInsertClientRows,
    insertPersonRecord: vi.fn().mockResolvedValue("person-id-1"),
    insertCasePartyRow: vi.fn().mockResolvedValue(undefined),
    checkClientEligibilityByEmail: vi.fn().mockResolvedValue({ eligible: false }),
    checkClientEligibilityById: vi.fn().mockResolvedValue({ eligible: false }),
    countActiveStaff: vi.fn().mockResolvedValue(1),
    getStaffProfileById: vi.fn().mockResolvedValue(null),
    findStaffById: vi.fn().mockResolvedValue(null),
    countActiveAdminsByOrg: vi.fn().mockResolvedValue(2),
    listStaffMembers: vi.fn().mockResolvedValue([]),
    insertStaffRows: vi.fn().mockResolvedValue(undefined),
    replaceStaffPermissions: vi.fn().mockResolvedValue(undefined),
    setStaffActive: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { provisionClientUser } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR = {
  userId: "staff-user-1",
  orgId: "org-abc-1",
  kind: "staff" as const,
  role: "admin" as const,
  permissions: new Map(),
};

const AUTH_USER = { id: "auth-user-new-1" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provisionClientUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined); // can() doesn't throw = passes
    mockInsertClientRows.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("requires clients:edit permission", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => {
      throw new AuthzError("forbidden_module");
    });
    await expect(
      provisionClientUser(ACTOR, { fullName: "Maria Lopez", email: "maria@example.com" }),
    ).rejects.toThrow();
  });

  it("returns existing userId (created:false) when email already registered", async () => {
    mockFindClientByEmail.mockResolvedValue({ id: "existing-user-id", existed: true });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Maria Lopez",
      email: "maria@example.com",
    });

    expect(result).toEqual({ userId: "existing-user-id", created: false });
    // Must NOT call createUser
    expect(mockCreateUser).not.toHaveBeenCalled();
    // Must NOT insert rows again
    expect(mockInsertClientRows).not.toHaveBeenCalled();
  });

  it("creates auth user + rows and returns created:true for new email", async () => {
    mockFindClientByEmail.mockResolvedValue(null); // email not found
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Pedro Gomez",
      email: "pedro@example.com",
      phoneE164: "+13055550002",
    });

    expect(result).toEqual({ userId: AUTH_USER.id, created: true });

    // auth.admin.createUser called with email + email_confirm:true (no password)
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "pedro@example.com",
        email_confirm: true,
      }),
    );
    // Rows inserted with email as identity + phone as contact
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AUTH_USER.id,
        orgId: ACTOR.orgId,
        email: "pedro@example.com",
        phoneE164: "+13055550002",
        firstName: "Pedro",
        lastName: "Gomez",
      }),
    );
    // Audit written
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("works without a phone (phone is optional contact data)", async () => {
    mockFindClientByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Sin Telefono",
      email: "notel@example.com",
    });

    // createUser called WITHOUT a phone key
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "notel@example.com", email_confirm: true }),
    );
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ email: "notel@example.com", phoneE164: null }),
    );
  });

  it("derives firstName only when fullName has no space", async () => {
    mockFindClientByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Valentina",
      email: "valentina@example.com",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Valentina",
        lastName: "",
      }),
    );
  });

  it("derives first/last name correctly for multi-word last name", async () => {
    mockFindClientByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Ana Maria de la Cruz",
      email: "ana@example.com",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Ana",
        lastName: "Maria de la Cruz",
      }),
    );
  });

  it("passes locale and timezone when provided", async () => {
    mockFindClientByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Jose Torres",
      email: "jose@example.com",
      locale: "es",
      timezone: "America/Chicago",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "es",
        timezone: "America/Chicago",
      }),
    );
  });

  // Race recovery resolved via direct DB query on public.users (by email),
  // NOT via listUsers() which silently misses users in orgs with >1000 accounts.
  it("handles race condition via public.users DB query (not listUsers)", async () => {
    mockFindClientByEmail.mockResolvedValue(null); // email not in public.users yet
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });
    // DB query on public.users returns the pre-existing row
    mockDbQueryChain.maybeSingle.mockResolvedValue({
      data: { id: "preexisting-auth-id" },
      error: null,
    });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Carmen Soto",
      email: "carmen@example.com",
    });

    expect(result).toEqual({ userId: "preexisting-auth-id", created: false });
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "preexisting-auth-id" }),
    );
    // listUsers must NOT have been called
    expect(mockListUsers).not.toHaveBeenCalled();
  });
});
