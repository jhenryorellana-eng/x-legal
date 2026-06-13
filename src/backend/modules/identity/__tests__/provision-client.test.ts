/**
 * Tests for identity/service.ts — provisionClientUser (DOC-22 §1.2 H-2).
 *
 * Covers:
 * - Idempotent by phone: returns existing userId when phone already registered
 * - Creates auth user + public rows when phone is new
 * - Derives first/last name correctly from fullName
 * - Handles race condition: auth user exists but public.users row is missing
 * - Requires clients:edit permission
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock references
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockFindClientByPhone,
  mockInsertClientRows,
  mockCreateUser,
  mockListUsers,
  mockWriteAudit,
  mockDbQueryChain,
} = vi.hoisted(() => {
  // Chainable Supabase query-builder stub (used by the C-1 fix path)
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
    mockFindClientByPhone: vi.fn(),
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
    // C-1 fix: serviceClient.from(…) chain for the public.users lookup
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
  limitOtpSendPhone: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpSendIp: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpVerifyPhone: vi.fn().mockResolvedValue({ allowed: true }),
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
    findClientByPhone: mockFindClientByPhone,
    insertClientRows: mockInsertClientRows,
    insertPersonRecord: vi.fn().mockResolvedValue("person-id-1"),
    insertCasePartyRow: vi.fn().mockResolvedValue(undefined),
    checkClientEligibility: vi.fn().mockResolvedValue({ eligible: false }),
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
      provisionClientUser(ACTOR, { fullName: "Maria Lopez", phoneE164: "+13055550001" }),
    ).rejects.toThrow();
  });

  it("returns existing userId (created:false) when phone already registered", async () => {
    mockFindClientByPhone.mockResolvedValue({ id: "existing-user-id", existed: true });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Maria Lopez",
      phoneE164: "+13055550001",
    });

    expect(result).toEqual({ userId: "existing-user-id", created: false });
    // Must NOT call createUser
    expect(mockCreateUser).not.toHaveBeenCalled();
    // Must NOT insert rows again
    expect(mockInsertClientRows).not.toHaveBeenCalled();
  });

  it("creates auth user + rows and returns created:true for new phone", async () => {
    mockFindClientByPhone.mockResolvedValue(null); // phone not found
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Pedro Gomez",
      phoneE164: "+13055550002",
    });

    expect(result).toEqual({ userId: AUTH_USER.id, created: true });

    // auth.admin.createUser called with phone + phone_confirm:true (no password)
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+13055550002",
        phone_confirm: true,
      }),
    );
    // Rows inserted
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AUTH_USER.id,
        orgId: ACTOR.orgId,
        phoneE164: "+13055550002",
        firstName: "Pedro",
        lastName: "Gomez",
      }),
    );
    // Audit written
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("derives firstName only when fullName has no space", async () => {
    mockFindClientByPhone.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Valentina",
      phoneE164: "+13055550003",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Valentina",
        lastName: "",
      }),
    );
  });

  it("derives first/last name correctly for multi-word last name", async () => {
    mockFindClientByPhone.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Ana Maria de la Cruz",
      phoneE164: "+13055550004",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "Ana",
        lastName: "Maria de la Cruz",
      }),
    );
  });

  it("passes locale and timezone when provided", async () => {
    mockFindClientByPhone.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Jose Torres",
      phoneE164: "+13055550005",
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

  // C-1 FIX: race condition now resolved via direct DB query on public.users,
  // NOT via listUsers() which silently misses users in orgs with >1000 accounts.
  it("C-1: handles race condition via public.users DB query (not listUsers)", async () => {
    mockFindClientByPhone.mockResolvedValue(null); // phone not in public.users yet
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });
    // C-1: DB query on public.users returns the pre-existing row
    mockDbQueryChain.maybeSingle.mockResolvedValue({
      data: { id: "preexisting-auth-id" },
      error: null,
    });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Carmen Soto",
      phoneE164: "+13055550006",
    });

    expect(result).toEqual({ userId: "preexisting-auth-id", created: false });
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "preexisting-auth-id" }),
    );
    // listUsers must NOT have been called (C-1 fix replaced it)
    expect(mockListUsers).not.toHaveBeenCalled();
  });
});
