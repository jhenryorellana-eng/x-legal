/**
 * Tests for cases/service.ts — updateCaseParty (admin party name correction).
 *
 * Covers:
 * - Admin-only (non-admin staff rejected)
 * - Party not found → CASE_PARTY_NOT_FOUND
 * - Petitioner (user_id) → updates client_profiles, not person_records
 * - Additional party (person_record_id) → updates person_records
 * - Signed contract → CASE_CONTRACT_LOCKED, nothing written
 * - No contract → live name updated, resynced:false
 * - Zod: empty firstName rejected
 * - Writes audit + timeline; re-syncs the contract snapshot when draft
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockWriteAudit,
  mockAppendCaseTimeline,
  mockGetCaseParties,
  mockFindPersonRecord,
  mockFindClientFullName,
  mockUpdateClientProfileName,
  mockUpdatePersonRecordName,
  mockGetContractForCase,
  mockResyncPartiesSnapshot,
  mockFindCaseById,
  mockListServicePartyRoles,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
  mockGetCaseParties: vi.fn(),
  mockFindPersonRecord: vi.fn(),
  mockFindClientFullName: vi.fn(),
  mockUpdateClientProfileName: vi.fn().mockResolvedValue(undefined),
  mockUpdatePersonRecordName: vi.fn().mockResolvedValue(undefined),
  mockGetContractForCase: vi.fn(),
  mockResyncPartiesSnapshot: vi.fn().mockResolvedValue({ resynced: true }),
  mockFindCaseById: vi.fn(),
  mockListServicePartyRoles: vi.fn(),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn(), emitAndWait: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));
vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({}),
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    getCaseParties: mockGetCaseParties,
    findPersonRecord: mockFindPersonRecord,
    findClientFullName: mockFindClientFullName,
    updateClientProfileName: mockUpdateClientProfileName,
    updatePersonRecordName: mockUpdatePersonRecordName,
    findClientDisplayName: vi.fn().mockResolvedValue(null),
    findCaseById: mockFindCaseById,
  };
});

vi.mock("@/backend/modules/contracts", () => ({
  getContractForCase: mockGetContractForCase,
  resyncPartiesSnapshot: mockResyncPartiesSnapshot,
  resyncDocumentSnapshot: vi.fn().mockResolvedValue({ resynced: true }),
  ContractError: class ContractError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

vi.mock("@/backend/modules/catalog", () => ({
  listServicePartyRoles: mockListServicePartyRoles,
}));

import { updateCaseParty } from "../service";

const CASE_ID = "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1";
const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const PETITIONER_PARTY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SPOUSE_PARTY_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSON_RECORD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const ADMIN = {
  userId: "staff-admin", orgId: "00000000-0000-4000-8000-000000000001",
  kind: "staff" as const, role: "admin" as const, permissions: new Map(),
};
const SALES = { ...ADMIN, userId: "staff-sales", role: "sales" as const };

const PARTIES = [
  { id: PETITIONER_PARTY_ID, case_id: CASE_ID, party_role: "petitioner", user_id: CLIENT_ID, person_record_id: null, position: 0 },
  { id: SPOUSE_PARTY_ID, case_id: CASE_ID, party_role: "spouse", user_id: null, person_record_id: PERSON_RECORD_ID, position: 1 },
];

describe("updateCaseParty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockGetCaseParties.mockResolvedValue(PARTIES);
    mockFindPersonRecord.mockResolvedValue({ first_name: "Rosa", last_name: "Diaz" });
    mockFindClientFullName.mockResolvedValue({ first_name: "Carlos", last_name: "Mendoza" });
    mockGetContractForCase.mockResolvedValue({ id: "contract-1", status: "draft" });
    mockResyncPartiesSnapshot.mockResolvedValue({ resynced: true });
    mockFindCaseById.mockResolvedValue({ id: CASE_ID, service_id: SERVICE_ID });
    // Spouse role declared by the service and included in the contract → resync
    // keeps the spouse in the snapshot (consistent with the existing fixtures).
    mockListServicePartyRoles.mockResolvedValue([
      { role_key: "spouse", cardinality: "single", include_in_contract: true },
    ]);
  });

  it("rejects a non-admin staff actor", async () => {
    await expect(
      updateCaseParty(SALES, { caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "X", lastName: "Y" }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
    expect(mockUpdateClientProfileName).not.toHaveBeenCalled();
  });

  it("throws CASE_PARTY_NOT_FOUND for an unknown party", async () => {
    await expect(
      updateCaseParty(ADMIN, {
        caseId: CASE_ID,
        partyId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        firstName: "X",
        lastName: "Y",
      }),
    ).rejects.toMatchObject({ code: "CASE_PARTY_NOT_FOUND" });
  });

  it("updates client_profiles for the petitioner (user_id) and not person_records", async () => {
    const res = await updateCaseParty(ADMIN, {
      caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "Carlos", lastName: "Mendoza Ruiz",
    });
    expect(mockUpdateClientProfileName).toHaveBeenCalledWith(CLIENT_ID, { firstName: "Carlos", lastName: "Mendoza Ruiz" });
    expect(mockUpdatePersonRecordName).not.toHaveBeenCalled();
    expect(res.resynced).toBe(true);
    expect(mockResyncPartiesSnapshot).toHaveBeenCalledTimes(1);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      ADMIN, "case.party.renamed", "case_parties", PETITIONER_PARTY_ID, expect.any(Object),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalled();
  });

  it("updates person_records for an additional party (person_record_id)", async () => {
    await updateCaseParty(ADMIN, {
      caseId: CASE_ID, partyId: SPOUSE_PARTY_ID, firstName: "Rosa", lastName: "Diaz Lopez",
    });
    expect(mockUpdatePersonRecordName).toHaveBeenCalledWith(PERSON_RECORD_ID, { firstName: "Rosa", lastName: "Diaz Lopez" });
    expect(mockUpdateClientProfileName).not.toHaveBeenCalled();
  });

  it("blocks editing when the contract is signed (CASE_CONTRACT_LOCKED) and writes nothing", async () => {
    mockGetContractForCase.mockResolvedValue({ id: "contract-1", status: "signed" });
    await expect(
      updateCaseParty(ADMIN, { caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "Nope", lastName: "Nope" }),
    ).rejects.toMatchObject({ code: "CASE_CONTRACT_LOCKED" });
    expect(mockUpdateClientProfileName).not.toHaveBeenCalled();
    expect(mockResyncPartiesSnapshot).not.toHaveBeenCalled();
  });

  it("updates the live name with resynced:false when there is no contract", async () => {
    mockGetContractForCase.mockResolvedValue(null);
    const res = await updateCaseParty(ADMIN, {
      caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "Carlos", lastName: "Mendoza",
    });
    expect(mockUpdateClientProfileName).toHaveBeenCalled();
    expect(mockResyncPartiesSnapshot).not.toHaveBeenCalled();
    expect(res.resynced).toBe(false);
  });

  it("rejects an empty first name (Zod)", async () => {
    await expect(
      updateCaseParty(ADMIN, { caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "   ", lastName: "Y" }),
    ).rejects.toBeInstanceOf(Error);
    expect(mockUpdateClientProfileName).not.toHaveBeenCalled();
  });

  it("accepts an empty last name (single-name party)", async () => {
    const res = await updateCaseParty(ADMIN, {
      caseId: CASE_ID, partyId: PETITIONER_PARTY_ID, firstName: "Madonna", lastName: "",
    });
    expect(mockUpdateClientProfileName).toHaveBeenCalledWith(CLIENT_ID, { firstName: "Madonna", lastName: "" });
    expect(res.resynced).toBe(true);
  });
});
