/**
 * Tests for identity/service.ts — provisionClientUser.
 *
 * Identity model (DOC-22 §1, 2026-07 refactor — phone is the identity):
 * - The client's UNIQUE identity is their PHONE (public.users.phone_e164).
 * - Idempotent by PHONE: returns the existing userId when the phone already exists.
 * - The real email is OPTIONAL, REPEATABLE contact data — two different clients
 *   may share one email (or have none). It is NEVER the dedup key.
 * - Supabase Auth gets a SYNTHETIC, unique-per-phone email (syntheticAuthEmail);
 *   the client logs in with the phone (signInWithPassword by phone).
 * - Requires clients:edit permission.
 * - Recovers a race (public.users already has the phone) and a leftover auth
 *   shell that collides by phone.
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
  mockUpdateUserById,
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
    mockFindClientByPhone: vi.fn(),
    mockInsertClientRows: vi.fn().mockResolvedValue(undefined),
    mockCreateUser: vi.fn(),
    mockListUsers: vi.fn().mockResolvedValue({ data: { users: [] } }),
    mockUpdateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
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
        updateUserById: mockUpdateUserById,
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
  limitOtpSendPhone: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpSendIp: vi.fn().mockResolvedValue({ allowed: true }),
}));

// platform/env — phone-login password derivation reads SUPABASE_SERVICE_ROLE_KEY
vi.mock("@/backend/platform/env", () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-key" },
  providerEnv: vi.fn(),
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
import { derivePhonePassword, syntheticAuthEmail } from "../domain";

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
const PHONE = "+13055550100";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("provisionClientUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined); // can() doesn't throw = passes
    mockFindClientByPhone.mockResolvedValue(null); // phone not registered by default
    mockInsertClientRows.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
    mockDbQueryChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockListUsers.mockResolvedValue({ data: { users: [] } });
  });

  it("requires clients:edit permission", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => {
      throw new AuthzError("forbidden_module");
    });
    await expect(
      provisionClientUser(ACTOR, { fullName: "Maria Lopez", email: "maria@example.com", phoneE164: PHONE }),
    ).rejects.toThrow();
  });

  it("is idempotent by PHONE: returns existing userId (created:false) when phone already registered", async () => {
    mockFindClientByPhone.mockResolvedValue({ id: "existing-user-id", email: "x@y.com", existed: true });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Maria Lopez",
      email: "maria@example.com",
      phoneE164: PHONE,
    });

    expect(result).toEqual({ userId: "existing-user-id", created: false });
    // Must NOT create a new auth user or re-insert rows
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockInsertClientRows).not.toHaveBeenCalled();
  });

  it("creates the auth user with a SYNTHETIC email + phone identity, and stores the REAL email in public rows", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Pedro Gomez",
      email: "pedro@example.com",
      phoneE164: PHONE,
    });

    expect(result).toEqual({ userId: AUTH_USER.id, created: true });

    // Auth identity = phone + synthetic email (NOT the real email) + derived password
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: syntheticAuthEmail(PHONE),
        email_confirm: true,
        phone: PHONE,
        phone_confirm: true,
        password: derivePhonePassword(PHONE, "test-service-key"),
      }),
    );
    // The REAL email is contact data on the public rows
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AUTH_USER.id,
        orgId: ACTOR.orgId,
        email: "pedro@example.com",
        phoneE164: PHONE,
        firstName: "Pedro",
        lastName: "Gomez",
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("REGRESSION: two clients with the SAME real email but DIFFERENT phones both provision (email is not the dedup key)", async () => {
    // The phone is what makes them distinct — findClientByPhone returns null for
    // this new phone even though the email is already used by another client.
    mockFindClientByPhone.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({ data: { user: { id: "second-client-id" } }, error: null });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Ricardo Paqui",
      email: "shared@example.com", // already belongs to another client
      phoneE164: "+13055550199",
    });

    // A NEW distinct client is created — never merged into the other account.
    expect(result).toEqual({ userId: "second-client-id", created: true });
    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: syntheticAuthEmail("+13055550199") }),
    );
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ email: "shared@example.com", userId: "second-client-id" }),
    );
  });

  it("email is OPTIONAL: provisions a client with no email (public email = null, Auth still synthetic)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Sin Correo",
      phoneE164: PHONE,
    });

    expect(mockCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: syntheticAuthEmail(PHONE), phone: PHONE }),
    );
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, phoneE164: PHONE }),
    );
  });

  it("requires a phone (the identity): throws when phone is missing", async () => {
    await expect(
      provisionClientUser(ACTOR, { fullName: "No Phone", email: "np@example.com" }),
    ).rejects.toThrow();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("throws for an invalid phone", async () => {
    await expect(
      provisionClientUser(ACTOR, { fullName: "Bad Phone", phoneE164: "123" }),
    ).rejects.toThrow();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it("derives firstName only when fullName has no space", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Valentina",
      phoneE164: PHONE,
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Valentina", lastName: "" }),
    );
  });

  it("derives first/last name correctly for a multi-word last name", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Ana Maria de la Cruz",
      phoneE164: PHONE,
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Ana", lastName: "Maria de la Cruz" }),
    );
  });

  it("forwards the full US address to insertClientRows (prefills the I-589)", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Rosa Diaz",
      email: "rosa@example.com",
      phoneE164: PHONE,
      address: { line1: "123 Main St", city: "Miami", state: "FL", zip: "33101", apartment: "4B" },
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({
        address: { line1: "123 Main St", city: "Miami", state: "FL", zip: "33101", apartment: "4B" },
      }),
    );
  });

  it("passes locale and timezone when provided", async () => {
    mockCreateUser.mockResolvedValue({ data: { user: AUTH_USER }, error: null });

    await provisionClientUser(ACTOR, {
      fullName: "Jose Torres",
      phoneE164: PHONE,
      locale: "es",
      timezone: "America/Chicago",
    });

    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ locale: "es", timezone: "America/Chicago" }),
    );
  });

  // Race recovery resolved via direct DB query on public.users (by PHONE),
  // NOT via listUsers() which silently misses users in orgs with >1000 accounts.
  it("handles a race (public.users already has the phone) via a DB query, idempotently", async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });
    // DB query on public.users returns the pre-existing row (by phone)
    mockDbQueryChain.maybeSingle.mockResolvedValue({
      data: { id: "preexisting-id" },
      error: null,
    });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Carmen Soto",
      email: "carmen@example.com",
      phoneE164: PHONE,
    });

    expect(result).toEqual({ userId: "preexisting-id", created: false });
    // Idempotent: already fully provisioned by the concurrent request → no re-insert
    expect(mockInsertClientRows).not.toHaveBeenCalled();
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  // Orphan recovery: a leftover auth shell with NO public.users row collides by
  // PHONE — reuse it via the admin list instead of hard-failing case creation.
  it("recovers a leftover auth shell that collides by phone", async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: "Phone number already registered" },
    });
    // No public.users row for this phone (true orphan)
    mockDbQueryChain.maybeSingle.mockResolvedValue({ data: null, error: null });
    // the admin list surfaces the leftover auth user by phone (no +)
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: "orphan-auth-id", email: null, phone: "13055550100" }] },
    });

    const result = await provisionClientUser(ACTOR, {
      fullName: "Pedro Orphan",
      email: "pedro.orphan@example.com",
      phoneE164: PHONE,
    });

    expect(result).toEqual({ userId: "orphan-auth-id", created: false });
    expect(mockUpdateUserById).toHaveBeenCalledWith(
      "orphan-auth-id",
      expect.objectContaining({ phone: PHONE, email: syntheticAuthEmail(PHONE) }),
    );
    expect(mockInsertClientRows).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "orphan-auth-id" }),
    );
  });
});
