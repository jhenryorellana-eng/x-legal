/**
 * Regression: getCasesForClient authz (DOC-22 §5.2).
 *
 * Caught live (2026-06-13) — the client /home crashed with AuthzError
 * `wrong_kind` because getCasesForClient called the staff-only `can()`.
 * A client must be able to list their OWN cases (row scoping is enforced by
 * RLS); staff use listCasesAdmin instead and must NOT reach this endpoint.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/backend/platform/authz", () => ({
  // can() is intentionally a throwing spy: the fix MUST NOT call it for the
  // client path. If a future regression reintroduces can(), the client test
  // fails loudly here.
  can: vi.fn(() => {
    throw new (class extends Error {
      constructor() {
        super("wrong_kind");
        this.name = "AuthzError";
      }
    })();
  }),
  requireCaseAccess: vi.fn(),
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn(), on: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/backend/platform/supabase", () => ({ createServerClient: vi.fn(), createServiceClient: vi.fn() }));

const { mockListCases } = vi.hoisted(() => ({ mockListCases: vi.fn() }));
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return { ...original, listCases: mockListCases };
});

import { getCasesForClient } from "../service";

const CLIENT = {
  userId: "00000000-0000-0000-0000-000000000101",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "client" as const,
  role: null,
  permissions: new Map(),
};
const STAFF = { ...CLIENT, kind: "staff" as const, role: "sales" as const };

describe("getCasesForClient — authz", () => {
  beforeEach(() => {
    mockListCases.mockReset();
    mockListCases.mockResolvedValue({
      items: [{ id: "cccccccc-cccc-4ccc-8ccc-000000000001", org_id: CLIENT.orgId, status: "active" }],
      nextCursor: null,
    });
  });

  it("lets a client list their own cases (no staff can() check)", async () => {
    const page = await getCasesForClient(CLIENT, { limit: 20 });
    expect(page.items).toHaveLength(1);
    // Scoped by the client's org; RLS narrows rows to case_members.
    expect(mockListCases).toHaveBeenCalledWith(expect.objectContaining({ orgId: CLIENT.orgId }));
  });

  it("rejects a staff actor with wrong_kind (staff must use listCasesAdmin)", async () => {
    await expect(getCasesForClient(STAFF, { limit: 20 })).rejects.toMatchObject({
      name: "AuthzError",
      reason: "wrong_kind",
    });
    expect(mockListCases).not.toHaveBeenCalled();
  });

  it("never throws wrong_kind for a valid client (the original live bug)", async () => {
    await expect(getCasesForClient(CLIENT, {})).resolves.toBeDefined();
  });
});
