/**
 * Tests for cases/service.ts — createCaseFromContract (DOC-41 §3.1, API-CASE-13).
 *
 * Covers:
 * - Requires cases:edit permission
 * - Idempotent by contractId: returns {created:false} when contract already has a case
 * - Throws CASE_SERVICE_NOT_AVAILABLE for inactive/missing service
 * - Throws CASE_SERVICE_NOT_AVAILABLE for inactive/missing plan
 * - Throws CASE_PAYMENT_PLAN_INVALID when downpayment > total
 * - Happy path: builds the atomic payload (case + member + contract + plan +
 *   installments) and calls create_case_atomic; emits case.created
 * - Creates person_records for non-user parties; applicant auto-added first
 * - Atomic write (migration 0026): a single createCaseAtomic call replaces the old
 *   sequential inserts — there is no partial-failure / orphan path to test for.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist ALL variables referenced inside vi.mock() factories.
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockFindCaseByContractId,
  mockNextCaseNumber,
  mockCreateCaseAtomic,
  mockWriteAudit,
  mockEmit,
  mockUpsertPersonRecord,
  mockAppendCaseTimeline,
  mockServiceClient,
  mockGetActiveTermsVersion,
  mockBuildInstallments,
  mockListContractableServices,
  mockListServicePartyRoles,
  mockBuildContractDocument,
  mockGetOrgContractInfo,
} = vi.hoisted(() => {
  const client = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
  };
  client.from.mockReturnValue(client);
  client.select.mockReturnValue(client);
  client.eq.mockReturnValue(client);
  client.update.mockReturnValue(client);

  return {
    mockCan: vi.fn(),
    mockFindCaseByContractId: vi.fn(),
    mockNextCaseNumber: vi.fn().mockResolvedValue("ULP-2026-0001"),
    mockCreateCaseAtomic: vi.fn(),
    mockWriteAudit: vi.fn().mockResolvedValue(undefined),
    mockEmit: vi.fn(),
    mockUpsertPersonRecord: vi.fn().mockResolvedValue("person-record-id-1"),
    mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
    mockServiceClient: client,
    mockGetActiveTermsVersion: vi.fn().mockResolvedValue({ version: "v1.0" }),
    mockBuildInstallments: vi.fn().mockReturnValue([
      { number: 1, amountCents: 10000, dueDate: "2026-06-23", isDownpayment: true },
      { number: 2, amountCents: 20000, dueDate: "2026-07-23", isDownpayment: false },
      { number: 3, amountCents: 20000, dueDate: "2026-08-23", isDownpayment: false },
    ]),
    mockListContractableServices: vi.fn().mockResolvedValue([]),
    mockListServicePartyRoles: vi
      .fn()
      .mockResolvedValue([
      { role_key: "spouse", cardinality: "single", include_in_contract: true, label_i18n: { es: "Cónyuge", en: "Spouse" } },
      { role_key: "minor", cardinality: "multiple", include_in_contract: true, label_i18n: { es: "Hijo/a", en: "Child" } },
    ]),
    // Returns a recognizable sentinel echoing the inputs that matter for the freeze.
    mockBuildContractDocument: vi.fn((i: { locale: string; committedParties: unknown[] }) => ({
      locale: i.locale,
      committedParties: i.committedParties,
    })),
    mockGetOrgContractInfo: vi.fn().mockResolvedValue({
      companyName: "USA LATINO PRIME",
      representativeName: "Jimy Henry Orellana Domínguez",
      phone: "801-941-3479",
      zelleEmail: "Henryorellana@usalatinoprime.com",
    }),
  };
});

// ---------------------------------------------------------------------------
// Mocks (registered before SUT import)
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: mockEmit, emitAndWait: mockEmit },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue(mockServiceClient),
  createServiceClient: vi.fn().mockReturnValue(mockServiceClient),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

// Repository — spread from real module, override the ones used by the SUT.
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseByContractId: mockFindCaseByContractId,
    nextCaseNumber: mockNextCaseNumber,
    createCaseAtomic: mockCreateCaseAtomic,
    findCaseById: vi.fn().mockResolvedValue(null),
    findCaseByCaseId: vi.fn().mockResolvedValue(null),
    listCases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    findDocumentById: vi.fn().mockResolvedValue(null),
    findCurrentChainHead: vi.fn().mockResolvedValue(null),
    insertCaseDocument: vi.fn(),
    updateDocument: vi.fn(),
    updateCase: vi.fn(),
    insertPhaseHistory: vi.fn(),
    getTimelinePage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listCaseDocuments: vi.fn().mockResolvedValue([]),
    getRequirementOverrides: vi.fn().mockResolvedValue([]),
    getCaseParties: vi.fn().mockResolvedValue([]),
    findServiceLite: vi.fn().mockResolvedValue(null),
    listServicePhases: vi.fn().mockResolvedValue([]),
    listServiceMilestones: vi.fn().mockResolvedValue([]),
    findPersonRecord: vi.fn().mockResolvedValue(null),
    findClientDisplayName: vi.fn().mockResolvedValue(null),
    findClientFullName: vi.fn().mockResolvedValue({ first_name: "Carlos", last_name: "Mendoza" }),
    findPlanKind: vi.fn().mockResolvedValue(null),
  };
});

// Identity module — person record resolution + boundary helpers.
vi.mock("@/backend/modules/identity", () => ({
  upsertPersonRecord: mockUpsertPersonRecord,
  insertCasePartyRow: vi.fn(),
  can: mockCan,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  normalizePhoneE164: vi.fn((p: string) => p),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
  provisionClientUser: vi.fn().mockResolvedValue({ userId: "client-1", created: true }),
}));

// Contracts module — only getActiveTermsVersion is used now.
vi.mock("@/backend/modules/contracts", () => ({
  createContract: vi.fn(),
  getActiveTermsVersion: mockGetActiveTermsVersion,
  sendContractForSigning: vi.fn().mockResolvedValue(undefined),
  buildContractDocument: mockBuildContractDocument,
  ContractError: class ContractError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

// Org module — EL CONSULTOR data for freezing the contract document.
vi.mock("@/backend/modules/org", () => ({
  getOrgContractInfo: mockGetOrgContractInfo,
}));

// Billing module — buildInstallments (pure domain math) is used to size cuotas.
vi.mock("@/backend/modules/billing", () => ({
  buildInstallments: mockBuildInstallments,
  BillingError: class BillingError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

// Catalog module
vi.mock("@/backend/modules/catalog", () => ({
  listContractableServices: mockListContractableServices,
  listServicePartyRoles: mockListServicePartyRoles,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { createCaseFromContract } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR = {
  userId: "staff-user-1",
  orgId: "00000000-0000-4000-8000-000000000001",
  kind: "staff" as const,
  role: "admin" as const,
  permissions: new Map(),
};

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const NEW_CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NEW_CONTRACT_ID = "contract-new-1";

const ATOMIC_RESULT = { caseId: NEW_CASE_ID, contractId: NEW_CONTRACT_ID, planId: "plan-1" };

const VALID_PAYMENT_PLAN = {
  totalCents: 50000,
  downpaymentCents: 10000,
  installmentCount: 3,
};

// ---------------------------------------------------------------------------
// Helper: configure Supabase mock chain for service + plan queries.
// ---------------------------------------------------------------------------

function setupDbQueryMocks(opts: { serviceActive?: boolean; planActive?: boolean } = {}) {
  const { serviceActive = true, planActive = true } = opts;
  let callCount = 0;
  mockServiceClient.maybeSingle.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({
        data: serviceActive ? { id: SERVICE_ID, is_active: true, label_i18n: {} } : null,
      });
    }
    return Promise.resolve({
      data: planActive
        ? { id: PLAN_ID, kind: "self", price_cents: 50000, is_active: true }
        : null,
    });
  });
  mockServiceClient.from.mockReturnValue(mockServiceClient);
  mockServiceClient.select.mockReturnValue(mockServiceClient);
  mockServiceClient.eq.mockReturnValue(mockServiceClient);
  mockServiceClient.update.mockReturnValue(mockServiceClient);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createCaseFromContract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockCreateCaseAtomic.mockResolvedValue(ATOMIC_RESULT);
    mockFindCaseByContractId.mockResolvedValue(null);
    mockGetActiveTermsVersion.mockResolvedValue({ version: "v1.0" });
    mockBuildInstallments.mockReturnValue([
      { number: 1, amountCents: 10000, dueDate: "2026-06-23", isDownpayment: true },
      { number: 2, amountCents: 20000, dueDate: "2026-07-23", isDownpayment: false },
      { number: 3, amountCents: 20000, dueDate: "2026-08-23", isDownpayment: false },
    ]);
    mockListContractableServices.mockResolvedValue([]);
    mockListServicePartyRoles.mockResolvedValue([
      { role_key: "spouse", cardinality: "single", include_in_contract: true },
      { role_key: "minor", cardinality: "multiple", include_in_contract: true },
    ]);
    mockUpsertPersonRecord.mockResolvedValue("person-record-id-1");
    mockNextCaseNumber.mockResolvedValue("ULP-2026-0001");
    setupDbQueryMocks();
  });

  it("requires cases:edit permission", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => { throw new AuthzError("forbidden_module"); });
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toThrow();
  });

  it("is idempotent: returns existing case when contractId already has a case", async () => {
    mockFindCaseByContractId.mockResolvedValue({ caseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });

    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      contractId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result).toEqual({
      caseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      contractId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      created: false,
    });
    expect(mockCreateCaseAtomic).not.toHaveBeenCalled();
  });

  it("throws CASE_SERVICE_NOT_AVAILABLE when service is not active", async () => {
    setupDbQueryMocks({ serviceActive: false });
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toMatchObject({ code: "CASE_SERVICE_NOT_AVAILABLE" });
  });

  it("throws CASE_SERVICE_NOT_AVAILABLE when plan is not active", async () => {
    setupDbQueryMocks({ serviceActive: true, planActive: false });
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toMatchObject({ code: "CASE_SERVICE_NOT_AVAILABLE" });
  });

  it("throws CASE_PAYMENT_PLAN_INVALID when downpayment > total", async () => {
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [],
        paymentPlan: { totalCents: 1000, downpaymentCents: 5000, installmentCount: 2 },
      }),
    ).rejects.toMatchObject({ code: "CASE_PAYMENT_PLAN_INVALID" });
  });

  it("happy path: builds the atomic payload (case + member + contract + plan + installments); emits case.created; returns created:true", async () => {
    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result).toEqual({ caseId: NEW_CASE_ID, contractId: NEW_CONTRACT_ID, created: true });

    expect(mockCreateCaseAtomic).toHaveBeenCalledTimes(1);
    const payload = mockCreateCaseAtomic.mock.calls[0][0];

    expect(payload.case).toEqual(
      expect.objectContaining({
        org_id: ACTOR.orgId,
        case_number: "ULP-2026-0001",
        status: "payment_pending",
        primary_client_id: CLIENT_ID,
      }),
    );
    expect(payload.member).toEqual({ user_id: CLIENT_ID, access_role: "owner" });
    expect(payload.contract).toEqual(
      expect.objectContaining({ org_id: ACTOR.orgId, status: "draft", terms_version: "v1.0" }),
    );
    // Regression (bug fix): the parties snapshot MUST include the principal
    // applicant (petitioner) FIRST — even with zero additional parties.
    expect(payload.contract.parties_snapshot).toEqual({
      parties: [{ role: "petitioner", userId: CLIENT_ID, name: "Carlos Mendoza" }],
    });
    expect(payload.plan).toEqual(
      expect.objectContaining({ total_cents: 50000, downpayment_cents: 10000, installment_count: 3 }),
    );
    // Installments mapped from buildInstallments drafts (snake_case rows).
    expect(payload.installments).toEqual([
      expect.objectContaining({ number: 1, is_downpayment: true, amount_cents: 10000, status: "pending" }),
      expect.objectContaining({ number: 2, is_downpayment: false, amount_cents: 20000 }),
      expect.objectContaining({ number: 3, is_downpayment: false, amount_cents: 20000 }),
    ]);

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: "case.created" }));
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("creates person_records for non-user parties; applicant auto-added first in the payload", async () => {
    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [
        { role: "spouse", person: { firstName: "Rosa", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Tito", lastName: "Diaz", relationship: "minor" } },
      ],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result.created).toBe(true);
    expect(mockUpsertPersonRecord).toHaveBeenCalledTimes(2);

    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    expect(payload.parties).toEqual([
      expect.objectContaining({ user_id: CLIENT_ID, person_record_id: null, party_role: "petitioner", position: 0 }),
      expect.objectContaining({ person_record_id: "person-record-id-1", user_id: null, party_role: "spouse", position: 1 }),
      expect.objectContaining({ party_role: "minor", position: 2 }),
    ]);
    // The snapshot mirrors the parties: petitioner first, then additional with names.
    expect(payload.contract.parties_snapshot).toEqual({
      parties: [
        { role: "petitioner", userId: CLIENT_ID, name: "Carlos Mendoza" },
        { role: "spouse", userId: null, name: "Rosa Diaz" },
        { role: "minor", userId: null, name: "Tito Diaz" },
      ],
    });
  });

  it("excludes from the contract snapshot the parties whose role is not include_in_contract", async () => {
    // Spouse is OPTIONAL for the contract (include_in_contract: false); minors are in.
    mockListServicePartyRoles.mockResolvedValueOnce([
      { role_key: "spouse", cardinality: "single", include_in_contract: false },
      { role_key: "minor", cardinality: "multiple", include_in_contract: true },
    ]);

    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [
        { role: "spouse", person: { firstName: "Rosa", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Hijo Uno", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Hijo Dos", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Hijo Tres", lastName: "Diaz" } },
      ],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    // case_parties keeps ALL parties (spouse is still a real case party).
    expect(payload.parties.map((p: { party_role: string }) => p.party_role)).toEqual([
      "petitioner",
      "spouse",
      "minor",
      "minor",
      "minor",
    ]);
    // But the contract snapshot commits ONLY the petitioner + the 3 children.
    expect(payload.contract.parties_snapshot).toEqual({
      parties: [
        { role: "petitioner", userId: CLIENT_ID, name: "Carlos Mendoza" },
        { role: "minor", userId: null, name: "Hijo Uno Diaz" },
        { role: "minor", userId: null, name: "Hijo Dos Diaz" },
        { role: "minor", userId: null, name: "Hijo Tres Diaz" },
      ],
    });
  });

  it("freezes a bilingual document_snapshot committing only petitioner + children", async () => {
    mockListServicePartyRoles.mockResolvedValueOnce([
      { role_key: "spouse", cardinality: "single", include_in_contract: false, label_i18n: { es: "Cónyuge", en: "Spouse" } },
      { role_key: "minor", cardinality: "multiple", include_in_contract: true, label_i18n: { es: "Hijo/a", en: "Child" } },
    ]);

    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [
        { role: "spouse", person: { firstName: "Rosa", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Hijo Uno", lastName: "Diaz" } },
        { role: "minor", person: { firstName: "Hijo Dos", lastName: "Diaz" } },
      ],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    const snap = payload.contract.document_snapshot as { es?: { committedParties?: { name: string }[] }; en?: unknown };
    expect(snap).toBeTruthy();
    expect(snap.es).toBeTruthy();
    expect(snap.en).toBeTruthy();
    // The assembler received only the children (spouse excluded from the contract).
    expect(snap.es?.committedParties?.map((p) => p.name)).toEqual(["Hijo Uno Diaz", "Hijo Dos Diaz"]);
    // EL CONSULTOR data was resolved from the org config.
    expect(mockGetOrgContractInfo).toHaveBeenCalledWith(ACTOR.orgId);
    // Built once per locale.
    expect(mockBuildContractDocument).toHaveBeenCalledTimes(2);
  });

  it("rejects a second party for a single-cardinality role (CASE_PARTY_CARDINALITY)", async () => {
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [
          { role: "spouse", person: { firstName: "Rosa", lastName: "Diaz" } },
          { role: "spouse", person: { firstName: "Otra", lastName: "Persona" } },
        ],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toMatchObject({ code: "CASE_PARTY_CARDINALITY" });
    expect(mockCreateCaseAtomic).not.toHaveBeenCalled();
  });

  it("auto-adds only the applicant when there are no additional parties", async () => {
    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    expect(payload.parties).toHaveLength(1);
    expect(payload.parties[0]).toEqual(
      expect.objectContaining({ user_id: CLIENT_ID, party_role: "petitioner", position: 0 }),
    );
    expect(payload.contract.parties_snapshot).toEqual({
      parties: [{ role: "petitioner", userId: CLIENT_ID, name: "Carlos Mendoza" }],
    });
  });

  it("freezes the principal name as null when the client has no profile yet", async () => {
    const repo = await import("../repository");
    vi.mocked(repo.findClientFullName).mockResolvedValueOnce(null);

    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    expect(payload.contract.parties_snapshot).toEqual({
      parties: [{ role: "petitioner", userId: CLIENT_ID, name: null }],
    });
  });

  it("rejects an additional party whose role is not declared by the service", async () => {
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [{ role: "guardian", person: { firstName: "X", lastName: "Y" } }],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toMatchObject({ code: "CASE_PARTY_ROLE_INVALID" });
    expect(mockCreateCaseAtomic).not.toHaveBeenCalled();
  });

  it("rejects the principal role among the additional parties", async () => {
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [{ role: "petitioner", person: { firstName: "Dup", lastName: "Licant" } }],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toMatchObject({ code: "CASE_PARTY_ROLE_INVALID" });
  });

  it("skips upsertPersonRecord for user parties (userId provided)", async () => {
    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [{ role: "spouse", userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(mockUpsertPersonRecord).not.toHaveBeenCalled();
    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    expect(payload.parties).toContainEqual(
      expect.objectContaining({ user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", person_record_id: null }),
    );
  });

  it("propagates a createCaseAtomic failure (atomic — nothing partial persists)", async () => {
    mockCreateCaseAtomic.mockRejectedValueOnce(new Error("create_case_atomic failed"));
    await expect(
      createCaseFromContract(ACTOR, {
        primaryClientId: CLIENT_ID,
        serviceId: SERVICE_ID,
        servicePlanId: PLAN_ID,
        parties: [],
        paymentPlan: VALID_PAYMENT_PLAN,
      }),
    ).rejects.toThrow();
    // No success side-effects when the atomic write fails.
    expect(mockWriteAudit).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(expect.objectContaining({ type: "case.created" }));
  });

  it("emits case.assigned when assignedParalegalId is set", async () => {
    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      assignedParalegalId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({ type: "case.assigned" }));
    const payload = mockCreateCaseAtomic.mock.calls[0][0];
    expect(payload.case.assigned_paralegal_id).toBe("ffffffff-ffff-4fff-8fff-ffffffffffff");
  });
});
