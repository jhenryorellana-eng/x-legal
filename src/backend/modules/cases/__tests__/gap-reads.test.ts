/**
 * Cases module — GAP reads for paralegal kanban board (F5-Ola3)
 *
 * Covers:
 *  GAP-1  listCasesByOwner(actor)
 *    - enforces can(actor,'cases','view')
 *    - filters by assignedParalegalId = actor.userId
 *    - enriches each case (service, phases, clientName, planKind)
 *    - returns empty array when no cases assigned
 *
 *  GAP-3  getCaseBoardAlerts(actor, caseIds)
 *    - enforces can(actor,'cases','view')
 *    - returns {} when caseIds is empty (no DB calls)
 *    - maps needsReview from countUploadedDocsByCases
 *    - maps lawyerCorrections from findCasesWithLawyerCorrections
 *    - maps generationFailed from findCasesWithGenerationFailed
 *    - maps rfeOverdue from findCasesWithRfeOverdue
 *    - defaults all signals to neutral (0/false) for unknown caseIds
 *    - runs all 4 batch queries in parallel (Promise.all)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — ESM hoisting requirement
// ---------------------------------------------------------------------------

const {
  mockListCases,
  mockFindServiceLite,
  mockListServicePhases,
  mockFindClientDisplayName,
  mockFindPlanKind,
  mockCountUploadedDocsByCases,
  mockFindCasesWithLawyerCorrections,
  mockFindCasesWithGenerationFailed,
  mockFindCasesWithRfeOverdue,
  mockFindCasesWithRfeInProgress,
  mockCan,
} = vi.hoisted(() => ({
  mockListCases: vi.fn(),
  mockFindServiceLite: vi.fn().mockResolvedValue(null),
  mockListServicePhases: vi.fn().mockResolvedValue([]),
  mockFindClientDisplayName: vi.fn().mockResolvedValue(null),
  mockFindPlanKind: vi.fn().mockResolvedValue(null),
  mockCountUploadedDocsByCases: vi.fn().mockResolvedValue([]),
  mockFindCasesWithLawyerCorrections: vi.fn().mockResolvedValue([]),
  mockFindCasesWithGenerationFailed: vi.fn().mockResolvedValue([]),
  mockFindCasesWithRfeOverdue: vi.fn().mockResolvedValue([]),
  mockFindCasesWithRfeInProgress: vi.fn().mockResolvedValue([]),
  mockCan: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
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

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    listCases: mockListCases,
    findServiceLite: mockFindServiceLite,
    listServicePhases: mockListServicePhases,
    findClientDisplayName: mockFindClientDisplayName,
    findPlanKind: mockFindPlanKind,
    countUploadedDocsByCases: mockCountUploadedDocsByCases,
    findCasesWithLawyerCorrections: mockFindCasesWithLawyerCorrections,
    findCasesWithGenerationFailed: mockFindCasesWithGenerationFailed,
    findCasesWithRfeOverdue: mockFindCasesWithRfeOverdue,
    findCasesWithRfeInProgress: mockFindCasesWithRfeInProgress,
    // Non-GAP repo functions — neutral mocks to avoid accidental calls
    findCaseById: vi.fn().mockResolvedValue(null),
    findCaseByCaseId: vi.fn().mockResolvedValue(null),
    findCaseByContractId: vi.fn().mockResolvedValue(null),
    nextCaseNumber: vi.fn().mockResolvedValue("ULP-2026-TEST"),
    insertCase: vi.fn(),
    upsertCaseMember: vi.fn(),
    insertPhaseHistory: vi.fn(),
    updateCase: vi.fn().mockResolvedValue(undefined),
    findDocumentById: vi.fn().mockResolvedValue(null),
    findCurrentChainHead: vi.fn().mockResolvedValue(null),
    insertCaseDocument: vi.fn(),
    updateDocument: vi.fn(),
    getTimelinePage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listCaseDocuments: vi.fn().mockResolvedValue([]),
    getRequirementOverrides: vi.fn().mockResolvedValue([]),
    getCaseParties: vi.fn().mockResolvedValue([]),
    listServiceMilestones: vi.fn().mockResolvedValue([]),
    findPersonRecord: vi.fn().mockResolvedValue(null),
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
import { listCasesByOwner, getCaseBoardAlerts } from "../service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR: Actor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "paralegal",
  kind: "staff",
  permissions: new Map([["cases", { view: true, edit: true }]]),
};

const CASE_ID_1 = "11111111-1111-4111-8111-111111111111";
const CASE_ID_2 = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CLIENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const makeCase = (id: string) => ({
  id,
  org_id: ACTOR.orgId,
  case_number: `ULP-2026-000${id[0]}`,
  status: "active" as const,
  service_id: SERVICE_ID,
  service_plan_id: PLAN_ID,
  primary_client_id: CLIENT_ID,
  assigned_paralegal_id: ACTOR.userId,
  assigned_sales_id: null,
  current_phase_id: null,
  opened_at: null,
  closed_at: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const makeServiceLite = () => ({
  id: SERVICE_ID,
  label_i18n: { en: "Immigration Service", es: "Servicio Migratorio" },
  icon: "scale",
  color: "accent",
});

const makePhases = () => [
  { id: "ph-1", label_i18n: { en: "Phase 1", es: "Fase 1" }, position: 1 },
  { id: "ph-2", label_i18n: { en: "Phase 2", es: "Fase 2" }, position: 2 },
];

// ---------------------------------------------------------------------------
// GAP-1: listCasesByOwner
// ---------------------------------------------------------------------------

describe("cases: listCasesByOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined); // no throw = authorized
  });

  it("enforces can(actor,'cases','view')", async () => {
    mockCan.mockImplementation(() => { throw new Error("AUTHZ_DENIED"); });
    mockListCases.mockResolvedValue({ items: [], nextCursor: null });
    await expect(listCasesByOwner(ACTOR)).rejects.toThrow("AUTHZ_DENIED");
  });

  it("returns empty array when no cases assigned to paralegal", async () => {
    mockListCases.mockResolvedValue({ items: [], nextCursor: null });
    const result = await listCasesByOwner(ACTOR);
    expect(result).toEqual([]);
  });

  it("filters by ownerId = actor.userId", async () => {
    mockListCases.mockResolvedValue({ items: [], nextCursor: null });
    await listCasesByOwner(ACTOR);
    expect(mockListCases).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: ACTOR.userId }),
    );
  });

  it("scopes query to actor.orgId", async () => {
    mockListCases.mockResolvedValue({ items: [], nextCursor: null });
    await listCasesByOwner(ACTOR);
    expect(mockListCases).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ACTOR.orgId }),
    );
  });

  it("returns enriched AdminCaseListItem for each case", async () => {
    mockListCases.mockResolvedValue({ items: [makeCase(CASE_ID_1)], nextCursor: null });
    mockFindServiceLite.mockResolvedValue(makeServiceLite());
    mockListServicePhases.mockResolvedValue(makePhases());
    mockFindClientDisplayName.mockResolvedValue("Maria Lopez");
    mockFindPlanKind.mockResolvedValue("standard");

    const result = await listCasesByOwner(ACTOR);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: CASE_ID_1,
      caseNumber: expect.stringContaining("ULP-2026"),
      status: "active",
      clientName: "Maria Lopez",
      planKind: "standard",
      phaseCount: 2,
    });
    // serviceLabelI18n must be {en, es}
    expect(result[0].serviceLabelI18n).toMatchObject({ en: "Immigration Service", es: "Servicio Migratorio" });
    // service icon/color come straight from the catalog row (GAP-3 fix)
    expect(result[0].serviceIcon).toBe("scale");
    expect(result[0].serviceColor).toBe("accent");
  });

  it("returns multiple items when multiple cases assigned", async () => {
    mockListCases.mockResolvedValue({
      items: [makeCase(CASE_ID_1), makeCase(CASE_ID_2)],
      nextCursor: null,
    });
    mockFindServiceLite.mockResolvedValue(makeServiceLite());
    mockListServicePhases.mockResolvedValue([]);
    mockFindClientDisplayName.mockResolvedValue(null);
    mockFindPlanKind.mockResolvedValue(null);

    const result = await listCasesByOwner(ACTOR);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([CASE_ID_1, CASE_ID_2]);
  });

  it("handles null service / null planKind gracefully", async () => {
    mockListCases.mockResolvedValue({ items: [makeCase(CASE_ID_1)], nextCursor: null });
    mockFindServiceLite.mockResolvedValue(null);
    mockListServicePhases.mockResolvedValue([]);
    mockFindClientDisplayName.mockResolvedValue(null);
    mockFindPlanKind.mockResolvedValue(null);

    const result = await listCasesByOwner(ACTOR);
    // asI18n(null) returns null — the page must handle null serviceLabelI18n
    expect(result[0].serviceLabelI18n).toBeNull();
    expect(result[0].serviceIcon).toBeNull();
    expect(result[0].serviceColor).toBeNull();
    expect(result[0].planKind).toBeNull();
    expect(result[0].clientName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GAP-3: getCaseBoardAlerts
// ---------------------------------------------------------------------------

describe("cases: getCaseBoardAlerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockCountUploadedDocsByCases.mockResolvedValue([]);
    mockFindCasesWithLawyerCorrections.mockResolvedValue([]);
    mockFindCasesWithGenerationFailed.mockResolvedValue([]);
    mockFindCasesWithRfeOverdue.mockResolvedValue([]);
    mockFindCasesWithRfeInProgress.mockResolvedValue([]);
  });

  it("enforces can(actor,'cases','view')", async () => {
    mockCan.mockImplementation(() => { throw new Error("AUTHZ_DENIED"); });
    await expect(getCaseBoardAlerts(ACTOR, [CASE_ID_1])).rejects.toThrow("AUTHZ_DENIED");
  });

  it("returns {} and makes no DB calls when caseIds is empty", async () => {
    const result = await getCaseBoardAlerts(ACTOR, []);
    expect(result).toEqual({});
    expect(mockCountUploadedDocsByCases).not.toHaveBeenCalled();
    expect(mockFindCasesWithLawyerCorrections).not.toHaveBeenCalled();
  });

  it("all signals default to neutral (0/false) when no alerts exist", async () => {
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1]).toEqual({
      needsReview: 0,
      lawyerCorrections: false,
      generationFailed: false,
      rfeOverdue: false,
      rfeInProgress: false,
    });
  });

  it("maps needsReview from countUploadedDocsByCases", async () => {
    mockCountUploadedDocsByCases.mockResolvedValue([
      { case_id: CASE_ID_1, count: 3 },
    ]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].needsReview).toBe(3);
  });

  it("maps lawyerCorrections=true when case in corrections_needed", async () => {
    mockFindCasesWithLawyerCorrections.mockResolvedValue([CASE_ID_1]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].lawyerCorrections).toBe(true);
  });

  it("maps generationFailed=true when case has failed AI run", async () => {
    mockFindCasesWithGenerationFailed.mockResolvedValue([CASE_ID_1]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].generationFailed).toBe(true);
  });

  it("maps rfeOverdue=true when case has overdue correction", async () => {
    mockFindCasesWithRfeOverdue.mockResolvedValue([CASE_ID_1]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].rfeOverdue).toBe(true);
  });

  it("maps rfeInProgress=true when a rejected RFE is not yet overdue", async () => {
    mockFindCasesWithRfeInProgress.mockResolvedValue([CASE_ID_1]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].rfeInProgress).toBe(true);
    expect(result[CASE_ID_1].rfeOverdue).toBe(false);
  });

  it("suppresses rfeInProgress when the same case is also overdue", async () => {
    mockFindCasesWithRfeOverdue.mockResolvedValue([CASE_ID_1]);
    mockFindCasesWithRfeInProgress.mockResolvedValue([CASE_ID_1]);
    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1].rfeOverdue).toBe(true);
    expect(result[CASE_ID_1].rfeInProgress).toBe(false);
  });

  it("correctly isolates signals between two cases", async () => {
    mockCountUploadedDocsByCases.mockResolvedValue([
      { case_id: CASE_ID_1, count: 2 },
    ]);
    mockFindCasesWithLawyerCorrections.mockResolvedValue([CASE_ID_2]);
    mockFindCasesWithGenerationFailed.mockResolvedValue([CASE_ID_1]);
    mockFindCasesWithRfeOverdue.mockResolvedValue([CASE_ID_2]);

    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1, CASE_ID_2]);

    expect(result[CASE_ID_1]).toEqual({
      needsReview: 2,
      lawyerCorrections: false,
      generationFailed: true,
      rfeOverdue: false,
      rfeInProgress: false,
    });
    expect(result[CASE_ID_2]).toEqual({
      needsReview: 0,
      lawyerCorrections: true,
      generationFailed: false,
      rfeOverdue: true,
      rfeInProgress: false,
    });
  });

  it("all 4 signals can be true simultaneously", async () => {
    mockCountUploadedDocsByCases.mockResolvedValue([{ case_id: CASE_ID_1, count: 5 }]);
    mockFindCasesWithLawyerCorrections.mockResolvedValue([CASE_ID_1]);
    mockFindCasesWithGenerationFailed.mockResolvedValue([CASE_ID_1]);
    mockFindCasesWithRfeOverdue.mockResolvedValue([CASE_ID_1]);

    const result = await getCaseBoardAlerts(ACTOR, [CASE_ID_1]);
    expect(result[CASE_ID_1]).toEqual({
      needsReview: 5,
      lawyerCorrections: true,
      generationFailed: true,
      rfeOverdue: true,
      rfeInProgress: false,
    });
  });

  it("passes all caseIds to each batch query", async () => {
    await getCaseBoardAlerts(ACTOR, [CASE_ID_1, CASE_ID_2]);
    expect(mockCountUploadedDocsByCases).toHaveBeenCalledWith([CASE_ID_1, CASE_ID_2]);
    expect(mockFindCasesWithLawyerCorrections).toHaveBeenCalledWith([CASE_ID_1, CASE_ID_2]);
    expect(mockFindCasesWithGenerationFailed).toHaveBeenCalledWith([CASE_ID_1, CASE_ID_2]);
    expect(mockFindCasesWithRfeOverdue).toHaveBeenCalledWith([CASE_ID_1, CASE_ID_2]);
  });
});
