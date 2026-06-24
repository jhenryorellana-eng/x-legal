/**
 * Tests for contracts/service.ts — resyncPartiesSnapshot.
 *
 * - No contract for the case → { resynced: false }, no write
 * - Signed contract → { resynced: false }, no write (immutable legal record)
 * - Draft contract → updateContract called with the snapshot, { resynced: true }
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCan, mockFindContractByCaseId, mockUpdateContract } = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockFindContractByCaseId: vi.fn(),
  mockUpdateContract: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));
vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn(), emitAndWait: vi.fn() } }));
vi.mock("@/backend/platform/ratelimit", () => ({ limitSigningTokenIp: vi.fn() }));
vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: vi.fn(),
  createSignedUploadUrl: vi.fn(),
}));
vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({}),
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn(), appendCaseTimeline: vi.fn() }));
vi.mock("../signature-pdf", () => ({ jpegDataUrlToPdf: vi.fn() }));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findContractByCaseId: mockFindContractByCaseId,
    updateContract: mockUpdateContract,
  };
});

import { resyncPartiesSnapshot } from "../service";

const ACTOR = {
  userId: "staff-admin", orgId: "00000000-0000-4000-8000-000000000001",
  kind: "staff" as const, role: "admin" as const, permissions: new Map(),
};
const CASE_ID = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const SNAPSHOT = { parties: [{ role: "petitioner", userId: "u1", name: "Carlos Mendoza" }] };

describe("resyncPartiesSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
  });

  it("no-ops when the case has no contract", async () => {
    mockFindContractByCaseId.mockResolvedValue(null);
    const res = await resyncPartiesSnapshot(ACTOR, CASE_ID, SNAPSHOT);
    expect(res).toEqual({ resynced: false });
    expect(mockUpdateContract).not.toHaveBeenCalled();
  });

  it("no-ops when the contract is signed (immutable)", async () => {
    mockFindContractByCaseId.mockResolvedValue({ id: "contract-1", status: "signed" });
    const res = await resyncPartiesSnapshot(ACTOR, CASE_ID, SNAPSHOT);
    expect(res).toEqual({ resynced: false });
    expect(mockUpdateContract).not.toHaveBeenCalled();
  });

  it("updates the snapshot for a draft contract", async () => {
    mockFindContractByCaseId.mockResolvedValue({ id: "contract-1", status: "draft" });
    const res = await resyncPartiesSnapshot(ACTOR, CASE_ID, SNAPSHOT);
    expect(res).toEqual({ resynced: true });
    expect(mockUpdateContract).toHaveBeenCalledWith("contract-1", { parties_snapshot: SNAPSHOT });
  });

  it("updates the snapshot for a sent contract", async () => {
    mockFindContractByCaseId.mockResolvedValue({ id: "contract-1", status: "sent" });
    const res = await resyncPartiesSnapshot(ACTOR, CASE_ID, SNAPSHOT);
    expect(res).toEqual({ resynced: true });
    expect(mockUpdateContract).toHaveBeenCalled();
  });
});
