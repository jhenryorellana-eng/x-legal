/**
 * Cases module — event consumers for Andrium handoff (F5-Ola3)
 *
 * Covers:
 *  - transitionCaseSystem: delegates to findCaseByCaseId (service_role) + updateCase
 *  - transitionCaseSystem: skips when case not found (warn)
 *  - transitionCaseSystem: skips when transition is invalid (warn)
 *  - onExpedienteSentToFinanceCase: transitions to ready_for_delivery
 *  - onExpedienteSentToFinanceCase: idempotent (already ready_for_delivery → skip)
 *  - onExpedienteSentToFinanceCase: skips when case not found
 *  - onExpedientePrintedCase: transitions to delivered
 *  - onExpedientePrintedCase: idempotent (already delivered → skip)
 *  - onExpedientePrintedCase: skips when case not found
 *
 * Key invariant: ALL functions use findCaseByCaseId (service_role, NOT RLS).
 * The RLS-based findCaseById would throw CASE_NOT_FOUND in event-consumer context
 * where there is no auth session (Ola-2 lesson).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockFindCaseByCaseId,
  mockUpdateCase,
} = vi.hoisted(() => ({
  mockFindCaseByCaseId: vi.fn(),
  mockUpdateCase: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

// Repository — spread from real module to inherit domain functions, then override
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseByCaseId: mockFindCaseByCaseId,
    updateCase: mockUpdateCase,
    // Ensure RLS-based findCaseById is NOT called (returns null → surfaces bugs)
    findCaseById: vi.fn().mockResolvedValue(null),
    findCaseByContractId: vi.fn().mockResolvedValue(null),
    nextCaseNumber: vi.fn().mockResolvedValue("U26-TEST"),
    insertCase: vi.fn(),
    upsertCaseMember: vi.fn(),
    insertPhaseHistory: vi.fn(),
    listCases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    findDocumentById: vi.fn().mockResolvedValue(null),
    findCurrentChainHead: vi.fn().mockResolvedValue(null),
    insertCaseDocument: vi.fn(),
    updateDocument: vi.fn(),
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
    findFormResponse: vi.fn().mockResolvedValue(null),
    findFormResponseById: vi.fn().mockResolvedValue(null),
    listFormResponsesForCase: vi.fn().mockResolvedValue([]),
    insertFormResponse: vi.fn(),
    mergeFormAnswers: vi.fn(),
    updateFormResponse: vi.fn(),
    findLatestActiveDocumentBySlug: vi.fn().mockResolvedValue(null),
    findDocumentExtractionByCaseDocId: vi.fn().mockResolvedValue(null),
    findCompletedGenerationByFormSlug: vi.fn().mockResolvedValue(null),
    findClientProfileForForm: vi.fn().mockResolvedValue(null),
    findUserContactFields: vi.fn().mockResolvedValue(null),
    listDocumentExtractionsForCase: vi.fn().mockResolvedValue([]),
    findCasePrimaryClient: vi.fn().mockResolvedValue(null),
    findFormDefinitionById: vi.fn().mockResolvedValue(null),
  };
});

// Import AFTER mocks
import { transitionCaseSystem, onExpedienteSentToFinanceCase, onExpedientePrintedCase } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111111";

type CaseStatus =
  | "payment_pending" | "active" | "in_validation"
  | "ready_for_delivery" | "delivered" | "completed"
  | "on_hold" | "cancelled";

const makeCase = (status: CaseStatus) => ({
  id: CASE_ID,
  org_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  case_number: "U26-000001",
  status,
  service_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  service_plan_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  primary_client_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  assigned_paralegal_id: null,
  assigned_sales_id: null,
  current_phase_id: null,
  opened_at: null,
  closed_at: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

// ---------------------------------------------------------------------------
// transitionCaseSystem
// ---------------------------------------------------------------------------

describe("cases: transitionCaseSystem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCase.mockResolvedValue(undefined);
  });

  it("transitions active → in_validation via service_role", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("active"));
    await transitionCaseSystem(CASE_ID, "in_validation");
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { status: "in_validation" });
  });

  it("transitions in_validation → ready_for_delivery via service_role", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("in_validation"));
    await transitionCaseSystem(CASE_ID, "ready_for_delivery");
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { status: "ready_for_delivery" });
  });

  it("skips and does not call updateCase when case not found", async () => {
    mockFindCaseByCaseId.mockResolvedValue(null);
    await transitionCaseSystem(CASE_ID, "ready_for_delivery");
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("skips and does not call updateCase on invalid transition", async () => {
    // draft → delivered is invalid
    mockFindCaseByCaseId.mockResolvedValue(makeCase("payment_pending"));
    await transitionCaseSystem(CASE_ID, "delivered");
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// onExpedienteSentToFinanceCase
// ---------------------------------------------------------------------------

describe("cases: onExpedienteSentToFinanceCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCase.mockResolvedValue(undefined);
  });

  it("transitions active → ready_for_delivery", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("active"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { status: "ready_for_delivery" });
  });

  it("transitions in_validation → ready_for_delivery", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("in_validation"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { status: "ready_for_delivery" });
  });

  it("is idempotent: skips when already ready_for_delivery", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("ready_for_delivery"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("is idempotent: skips when already delivered", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("delivered"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("is idempotent: skips when already completed", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("completed"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("skips when case not found", async () => {
    mockFindCaseByCaseId.mockResolvedValue(null);
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("uses findCaseByCaseId (service_role) — NOT findCaseById (RLS)", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("active"));
    await onExpedienteSentToFinanceCase({ caseId: CASE_ID });
    expect(mockFindCaseByCaseId).toHaveBeenCalledWith(CASE_ID);
  });
});

// ---------------------------------------------------------------------------
// onExpedientePrintedCase
// ---------------------------------------------------------------------------

describe("cases: onExpedientePrintedCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateCase.mockResolvedValue(undefined);
  });

  it("transitions ready_for_delivery → delivered", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("ready_for_delivery"));
    await onExpedientePrintedCase({ caseId: CASE_ID });
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { status: "delivered" });
  });

  it("is idempotent: skips when already delivered", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("delivered"));
    await onExpedientePrintedCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("is idempotent: skips when already completed", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("completed"));
    await onExpedientePrintedCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("skips when case not found", async () => {
    mockFindCaseByCaseId.mockResolvedValue(null);
    await onExpedientePrintedCase({ caseId: CASE_ID });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("uses findCaseByCaseId (service_role) — NOT findCaseById (RLS)", async () => {
    mockFindCaseByCaseId.mockResolvedValue(makeCase("ready_for_delivery"));
    await onExpedientePrintedCase({ caseId: CASE_ID });
    expect(mockFindCaseByCaseId).toHaveBeenCalledWith(CASE_ID);
  });
});
