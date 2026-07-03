/**
 * Tests for identity/service.ts — updateClientAddress (RF-VAN-018, the
 * "existing client" path of the "Nuevo caso" modal).
 *
 * Identity fields (name/phone/email) are IMMUTABLE in this flow — the phone is
 * the client's login credential (one account per client, DOC-22 §1). Only the
 * address is persisted.
 *
 * Covers:
 * - Requires clients:edit permission
 * - CLIENT_NOT_FOUND when the id is missing / another org (findClientById null)
 * - Success: writes ONLY the address row (never touches auth or users.phone)
 * - Audit written on success
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockFindClientById,
  mockUpdateClientAddressRow,
  mockUpdateUserById,
  mockWriteAudit,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockFindClientById: vi.fn(),
  mockUpdateClientAddressRow: vi.fn().mockResolvedValue(undefined),
  mockUpdateUserById: vi.fn(),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({
    auth: { admin: { updateUserById: mockUpdateUserById } },
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
  writeAudit: mockWriteAudit,
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
    findClientById: mockFindClientById,
    updateClientAddressRow: mockUpdateClientAddressRow,
  };
});

import { updateClientAddress } from "../service";

const ACTOR = {
  userId: "staff-user-1",
  orgId: "org-abc-1",
  kind: "staff" as const,
  role: "sales" as const,
  permissions: new Map(),
};

const CLIENT_ID = "client-user-1";
const ADDRESS = { line1: "500 Ocean Dr", city: "Miami", state: "FL", zip: "33139", apartment: null };

describe("updateClientAddress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockFindClientById.mockResolvedValue({
      id: CLIENT_ID,
      email: "maria@example.com",
      phoneE164: "+13055550100",
    });
    mockUpdateClientAddressRow.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("requires clients:edit permission", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => {
      throw new AuthzError("forbidden_module");
    });
    await expect(
      updateClientAddress(ACTOR, { userId: CLIENT_ID, address: ADDRESS }),
    ).rejects.toThrow();
    expect(mockUpdateClientAddressRow).not.toHaveBeenCalled();
  });

  it("returns CLIENT_NOT_FOUND when the client is missing or from another org", async () => {
    mockFindClientById.mockResolvedValue(null);
    const res = await updateClientAddress(ACTOR, { userId: CLIENT_ID, address: ADDRESS });
    expect(res).toEqual({ ok: false, code: "CLIENT_NOT_FOUND" });
    expect(mockUpdateClientAddressRow).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("writes ONLY the address and never touches auth (phone is the credential)", async () => {
    const res = await updateClientAddress(ACTOR, { userId: CLIENT_ID, address: ADDRESS });
    expect(res).toEqual({ ok: true, userId: CLIENT_ID });

    expect(mockUpdateClientAddressRow).toHaveBeenCalledWith({
      userId: CLIENT_ID,
      address: ADDRESS,
    });
    // Identity is immutable in this flow: no Supabase Auth update, ever.
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      ACTOR,
      "client.updated",
      "users",
      CLIENT_ID,
      expect.objectContaining({ fields: ["address"] }),
    );
  });
});
