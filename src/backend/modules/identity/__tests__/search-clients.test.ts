/**
 * Tests for identity/service.ts — searchClients (RF-VAN-018, client picker for
 * the "Nuevo caso" modal step 1).
 *
 * Covers:
 * - Requires clients:view permission (can() throws → rejects)
 * - Trims the query and clamps the limit to 1..20 (default 8)
 * - Maps repository rows to the DTO (fullName join + trim)
 * - Empty query is forwarded as-is (backend returns recent clients)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCan, mockSearchClientRows } = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockSearchClientRows: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({}),
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

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/ratelimit", () => ({
  limitOtpSendPhone: vi.fn().mockResolvedValue({ allowed: true }),
  limitOtpSendIp: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock("@/backend/platform/env", () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: "test-service-key" },
  providerEnv: vi.fn(),
}));
vi.mock("@/backend/platform/resend", () => ({
  sendTransactional: vi.fn().mockResolvedValue({ id: "email-1" }),
  FROM_TRANSACTIONAL: "no-reply@test.com",
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@zxcvbn-ts/core", () => {
  function ZxcvbnFactory() { return { check: (_pw: string) => ({ score: 4 }) }; }
  return { ZxcvbnFactory };
});
vi.mock("@zxcvbn-ts/language-common", () => ({ adjacencyGraphs: {}, dictionary: {} }));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    searchClientRows: mockSearchClientRows,
  };
});

import { searchClients } from "../service";

const ACTOR = {
  userId: "staff-user-1",
  orgId: "org-abc-1",
  kind: "staff" as const,
  role: "sales" as const,
  permissions: new Map(),
};

const ROW = {
  userId: "client-user-1",
  firstName: "María",
  lastName: "González",
  email: "maria@example.com",
  phoneE164: "+13055550301",
  address: { line1: "123 Main St", city: "Miami", state: "FL", zip: "33101", apartment: null },
  caseCount: 2,
};

describe("searchClients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockSearchClientRows.mockResolvedValue([]);
  });

  it("requires clients:view permission", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => {
      throw new AuthzError("forbidden_module");
    });
    await expect(searchClients(ACTOR, { query: "maria" })).rejects.toThrow();
    expect(mockSearchClientRows).not.toHaveBeenCalled();
  });

  it("trims the query and uses the default limit of 8", async () => {
    await searchClients(ACTOR, { query: "  María  " });
    expect(mockSearchClientRows).toHaveBeenCalledWith(ACTOR.orgId, "María", 8);
  });

  it("clamps the limit to 1..20", async () => {
    await searchClients(ACTOR, { query: "x", limit: 100 });
    expect(mockSearchClientRows).toHaveBeenLastCalledWith(ACTOR.orgId, "x", 20);

    await searchClients(ACTOR, { query: "x", limit: 0 });
    expect(mockSearchClientRows).toHaveBeenLastCalledWith(ACTOR.orgId, "x", 1);
  });

  it("forwards an empty query (backend returns recent clients)", async () => {
    await searchClients(ACTOR, { query: "   " });
    expect(mockSearchClientRows).toHaveBeenCalledWith(ACTOR.orgId, "", 8);
  });

  it("maps repository rows to the DTO with a joined fullName", async () => {
    mockSearchClientRows.mockResolvedValue([ROW, { ...ROW, userId: "u2", lastName: "" }]);

    const res = await searchClients(ACTOR, { query: "maria" });
    expect(res).toEqual([
      {
        userId: "client-user-1",
        fullName: "María González",
        email: "maria@example.com",
        phoneE164: "+13055550301",
        address: ROW.address,
        caseCount: 2,
      },
      expect.objectContaining({ userId: "u2", fullName: "María" }),
    ]);
  });
});
