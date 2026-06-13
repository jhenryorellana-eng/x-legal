/**
 * Tests for cases/service.ts — createCaseFromContract (DOC-41 §3.1, API-CASE-13).
 *
 * Covers:
 * - Requires cases:edit permission
 * - Idempotent by contractId: returns {created:false} when contract already has a case
 * - Throws CASE_SERVICE_NOT_AVAILABLE for inactive/missing service
 * - Throws CASE_SERVICE_NOT_AVAILABLE for inactive/missing plan
 * - Throws CASE_PAYMENT_PLAN_INVALID when downpayment > total
 * - Happy path: creates case + member + contract + billing plan, emits case.created
 * - Creates person_records for non-user parties
 * - Billing PAYMENT_PLAN_EXISTS is treated as idempotent (does not throw)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist ALL variables that are referenced inside vi.mock() factories.
// vi.mock() factories are hoisted to the top of the file by vitest — any
// variable they close over must be declared via vi.hoisted() as well.
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockFindCaseByContractId,
  mockNextCaseNumber,
  mockInsertCase,
  mockUpsertCaseMember,
  mockWriteAudit,
  mockEmit,
  mockUpsertPersonRecord,
  mockInsertCasePartyRow,
  mockAppendCaseTimeline,
  // Supabase chainable client
  mockServiceClient,
  // Dynamic-import mocks (used by vi.mock factories for contracts/billing/catalog)
  mockCreateContract,
  mockGetActiveTermsVersion,
  mockCreatePaymentPlan,
  mockListContractableServices,
} = vi.hoisted(() => {
  // Build a chainable Supabase-style client mock
  const client = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    update: vi.fn(),
    maybeSingle: vi.fn(),
  };
  // Default: every chainable method returns `client` itself
  client.from.mockReturnValue(client);
  client.select.mockReturnValue(client);
  client.eq.mockReturnValue(client);
  client.update.mockReturnValue(client);

  return {
    mockCan: vi.fn(),
    mockFindCaseByContractId: vi.fn(),
    mockNextCaseNumber: vi.fn().mockResolvedValue("ULP-2026-0001"),
    mockInsertCase: vi.fn(),
    mockUpsertCaseMember: vi.fn().mockResolvedValue(undefined),
    mockWriteAudit: vi.fn().mockResolvedValue(undefined),
    mockEmit: vi.fn(),
    mockUpsertPersonRecord: vi.fn().mockResolvedValue("person-record-id-1"),
    mockInsertCasePartyRow: vi.fn().mockResolvedValue(undefined),
    mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
    mockServiceClient: client,
    mockCreateContract: vi.fn().mockResolvedValue({ id: "contract-new-1" }),
    mockGetActiveTermsVersion: vi.fn().mockResolvedValue({ version: "v1.0" }),
    mockCreatePaymentPlan: vi.fn().mockResolvedValue({ id: "plan-1" }),
    mockListContractableServices: vi.fn().mockResolvedValue([]),
  };
});

// ---------------------------------------------------------------------------
// Mocks (registered before SUT import — they use the hoisted refs above)
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
  appEvents: { emit: mockEmit },
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

// Repository — spread from real module so unrelated fns keep their shape,
// then override the ones used by createCaseFromContract.
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseByContractId: mockFindCaseByContractId,
    nextCaseNumber: mockNextCaseNumber,
    insertCase: mockInsertCase,
    upsertCaseMember: mockUpsertCaseMember,
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
    findPlanKind: vi.fn().mockResolvedValue(null),
  };
});

// Identity module — sync mock for upsertPersonRecord / insertCasePartyRow
// (dynamic imports inside createCaseFromContract resolve to this mock)
vi.mock("@/backend/modules/identity", () => ({
  upsertPersonRecord: mockUpsertPersonRecord,
  insertCasePartyRow: mockInsertCasePartyRow,
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

// Contracts module
vi.mock("@/backend/modules/contracts", () => ({
  createContract: mockCreateContract,
  getActiveTermsVersion: mockGetActiveTermsVersion,
  sendContractForSigning: vi.fn().mockResolvedValue(undefined),
  ContractError: class ContractError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

// Billing module
vi.mock("@/backend/modules/billing", () => ({
  createPaymentPlan: mockCreatePaymentPlan,
  BillingError: class BillingError extends Error {
    constructor(public readonly code: string) { super(code); }
  },
}));

// Catalog module
vi.mock("@/backend/modules/catalog", () => ({
  listContractableServices: mockListContractableServices,
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
const CASE_ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  org_id: ACTOR.orgId,
  case_number: "ULP-2026-0001",
  service_id: SERVICE_ID,
  service_plan_id: PLAN_ID,
  primary_client_id: CLIENT_ID,
  status: "payment_pending",
  current_phase_id: null,
  assigned_paralegal_id: null,
  assigned_sales_id: null,
  opened_at: null,
  completed_at: null,
  internal_note: null,
  rebooking_blocked_until: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const VALID_PAYMENT_PLAN = {
  totalCents: 50000,
  downpaymentCents: 10000,
  installmentCount: 3,
};

// ---------------------------------------------------------------------------
// Helper: configure Supabase mock chain for service + plan queries.
// The service does TWO maybeSingle() calls: first for services, second for
// service_plans. A call-counter distinguishes the two.
// ---------------------------------------------------------------------------

function setupDbQueryMocks(opts: {
  serviceActive?: boolean;
  planActive?: boolean;
} = {}) {
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
    mockInsertCase.mockResolvedValue(CASE_ROW);
    mockFindCaseByContractId.mockResolvedValue(null);
    mockCreateContract.mockResolvedValue({ id: "contract-new-1" });
    mockCreatePaymentPlan.mockResolvedValue({ id: "plan-1" });
    mockGetActiveTermsVersion.mockResolvedValue({ version: "v1.0" });
    mockListContractableServices.mockResolvedValue([]);
    mockUpsertPersonRecord.mockResolvedValue("person-record-id-1");
    mockInsertCasePartyRow.mockResolvedValue(undefined);
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
    expect(mockInsertCase).not.toHaveBeenCalled();
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

  it("happy path: creates case, member, contract, billing plan; emits case.created; returns created:true", async () => {
    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result).toMatchObject({ caseId: CASE_ROW.id, created: true });

    // Case inserted with correct fields
    expect(mockInsertCase).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: ACTOR.orgId,
        case_number: "ULP-2026-0001",
        status: "payment_pending",
        primary_client_id: CLIENT_ID,
      }),
    );

    // Case member upserted as owner
    expect(mockUpsertCaseMember).toHaveBeenCalledWith(CASE_ROW.id, CLIENT_ID, "owner");

    // Contract created
    expect(mockCreateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: ACTOR.orgId,
        caseId: CASE_ROW.id,
      }),
    );

    // Billing plan created
    expect(mockCreatePaymentPlan).toHaveBeenCalledWith(
      ACTOR,
      expect.objectContaining({
        totalCents: 50000,
        downpaymentCents: 10000,
        installmentCount: 3,
      }),
    );

    // case.created event emitted
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "case.created" }),
    );

    // Audit written
    expect(mockWriteAudit).toHaveBeenCalled();
  });

  it("creates person_records for non-user parties via identity module", async () => {
    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [
        { role: "spouse", person: { firstName: "Rosa", lastName: "Diaz" } },
        { role: "child", person: { firstName: "Tito", lastName: "Diaz", relationship: "minor" } },
      ],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result.created).toBe(true);

    // upsertPersonRecord called for each non-user party
    expect(mockUpsertPersonRecord).toHaveBeenCalledTimes(2);
    expect(mockUpsertPersonRecord).toHaveBeenNthCalledWith(
      1,
      ACTOR,
      expect.objectContaining({ firstName: "Rosa", lastName: "Diaz" }),
    );
    expect(mockUpsertPersonRecord).toHaveBeenNthCalledWith(
      2,
      ACTOR,
      expect.objectContaining({ firstName: "Tito", lastName: "Diaz", relationship: "minor" }),
    );

    // case_parties rows inserted
    expect(mockInsertCasePartyRow).toHaveBeenCalledTimes(2);
    expect(mockInsertCasePartyRow).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        caseId: CASE_ROW.id,
        personRecordId: "person-record-id-1",
        userId: null,
        partyRole: "spouse",
        position: 0,
      }),
    );
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
    expect(mockInsertCasePartyRow).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", personRecordId: null }),
    );
  });

  it("treats PAYMENT_PLAN_EXISTS as idempotent (does not throw)", async () => {
    // billing.createPaymentPlan throws PAYMENT_PLAN_EXISTS
    mockCreatePaymentPlan.mockRejectedValueOnce(
      Object.assign(new Error("PAYMENT_PLAN_EXISTS"), { code: "PAYMENT_PLAN_EXISTS" }),
    );

    const result = await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(result.created).toBe(true);
  });

  it("emits case.assigned when assignedParalegalId is set", async () => {
    mockInsertCase.mockResolvedValueOnce({
      ...CASE_ROW,
      assigned_paralegal_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    });

    await createCaseFromContract(ACTOR, {
      primaryClientId: CLIENT_ID,
      serviceId: SERVICE_ID,
      servicePlanId: PLAN_ID,
      assignedParalegalId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      parties: [],
      paymentPlan: VALID_PAYMENT_PLAN,
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "case.assigned" }),
    );
  });
});
