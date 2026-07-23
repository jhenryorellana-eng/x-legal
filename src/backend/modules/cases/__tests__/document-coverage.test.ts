/**
 * Document coverage (combined uploads) — cases-side derivation + staff overrule.
 *
 * Contract under test:
 *  - buildDocumentsMatrix exposes `coveredBy` on a pending slot with an active
 *    coverage, and an OWN upload always supersedes it (derivation, D2)
 *  - a case-level coverage never covers a per-party slot (D5)
 *  - dismissDocumentCoverage / restoreDocumentCoverage: reviewer roles
 *    (admin + paralegal + sales; finance denied), case scoping, state machine,
 *    audit + client-visible timeline
 *  - resolveBySource `document_extraction`: falls back to the coverage payload
 *    ONLY when the slug has no own active upload (never mixes sources)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockGetCaseParties,
  mockGetRequirementOverrides,
  mockListCaseDocuments,
  mockGetCaseRequirements,
  mockListActiveCoveragesForCase,
  mockFindCoverageById,
  mockUpdateCoverageStatus,
  mockFindLatestActiveDocumentBySlug,
  mockFindDocumentExtractionByCaseDocId,
  mockFindActiveCoveragePayloadBySlug,
  mockWriteAudit,
  mockAppendCaseTimeline,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockGetCaseParties: vi.fn().mockResolvedValue([]),
  mockGetRequirementOverrides: vi.fn().mockResolvedValue([]),
  mockListCaseDocuments: vi.fn().mockResolvedValue([]),
  mockGetCaseRequirements: vi.fn(),
  mockListActiveCoveragesForCase: vi.fn().mockResolvedValue([]),
  mockFindCoverageById: vi.fn().mockResolvedValue(null),
  mockUpdateCoverageStatus: vi.fn().mockResolvedValue(undefined),
  mockFindLatestActiveDocumentBySlug: vi.fn().mockResolvedValue(null),
  mockFindDocumentExtractionByCaseDocId: vi.fn().mockResolvedValue(null),
  mockFindActiveCoveragePayloadBySlug: vi.fn().mockResolvedValue(null),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
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

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("@/backend/modules/catalog", () => ({
  getCaseRequirements: mockGetCaseRequirements,
  getPublishedAutomationVersion: vi.fn().mockResolvedValue(null),
  listQuestionGroups: vi.fn().mockResolvedValue([]),
  listQuestions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    getCaseParties: mockGetCaseParties,
    getRequirementOverrides: mockGetRequirementOverrides,
    listCaseDocuments: mockListCaseDocuments,
    listServicePhases: vi.fn().mockResolvedValue([]),
    findClientDisplayName: vi.fn().mockResolvedValue(null),
    findPersonRecord: vi.fn().mockResolvedValue(null),
    listActiveCoveragesForCase: mockListActiveCoveragesForCase,
    findCoverageById: mockFindCoverageById,
    updateCoverageStatus: mockUpdateCoverageStatus,
    findLatestActiveDocumentBySlug: mockFindLatestActiveDocumentBySlug,
    findDocumentExtractionByCaseDocId: mockFindDocumentExtractionByCaseDocId,
    findActiveCoveragePayloadBySlug: mockFindActiveCoveragePayloadBySlug,
  };
});

import {
  getDocumentsMatrix,
  dismissDocumentCoverage,
  restoreDocumentCoverage,
  resolveBySource,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PHASE_ID = "11111111-1111-4111-8111-000000000001";
const RDT_ID = "22222222-2222-4222-8222-000000000001";
const PARTY_ID = "33333333-3333-4333-8333-000000000002";
const COVERAGE_ID = "55555555-5555-4555-8555-000000000001";
const SRC_DOC_ID = "66666666-6666-4666-8666-000000000001";

function staffActor(role: "admin" | "sales" | "paralegal" | "finance") {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    kind: "staff" as const,
    role,
    permissions: new Map(),
  };
}

const ACTIVE_CASE = {
  id: CASE_ID,
  org_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  case_number: "T-001",
  status: "active",
  service_id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
  primary_client_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
  current_phase_id: PHASE_ID,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function expandedDoc(over: Record<string, unknown> = {}) {
  return {
    key: `${RDT_ID}:case`,
    required_document_type_id: RDT_ID,
    party_id: null,
    label_i18n: { es: "Declaración jurada", en: "Sworn declaration" },
    help_i18n: null,
    category_i18n: null,
    is_required: false,
    is_hidden: false,
    ai_extract: true,
    extraction_schema: null,
    position: 0,
    ...over,
  };
}

function coverageRow(over: Record<string, unknown> = {}) {
  return {
    id: COVERAGE_ID,
    case_document_id: SRC_DOC_ID,
    covered_required_document_type_id: RDT_ID,
    party_id: null,
    confidence: 0.9,
    source_display_name: "Formulario I-589 completo",
    ...over,
  };
}

function coverageDbRow(over: Record<string, unknown> = {}) {
  return {
    id: COVERAGE_ID,
    case_id: CASE_ID,
    case_document_id: SRC_DOC_ID,
    covered_required_document_type_id: RDT_ID,
    party_id: null,
    status: "detected",
    confidence: 0.9,
    page_range: null,
    payload: { declarant_name: "Juan" },
    model: "gemini-2.5-flash",
    input_tokens: 10,
    output_tokens: 10,
    cost_usd: 0.001,
    dismissed_by: null,
    dismissed_at: null,
    dismiss_reason: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

function uploadedDoc(over: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-000000000010",
    required_document_type_id: RDT_ID,
    party_id: null,
    status: "uploaded",
    display_name: "Declaración",
    original_filename: "declaracion.pdf",
    mime_type: "application/pdf",
    created_at: new Date().toISOString(),
    rejection_reason_i18n: null,
    correction_due_at: null,
    translation_not_required: false,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue(ACTIVE_CASE);
  mockGetCaseParties.mockResolvedValue([]);
  mockGetRequirementOverrides.mockResolvedValue([]);
  mockListCaseDocuments.mockResolvedValue([]);
  mockListActiveCoveragesForCase.mockResolvedValue([]);
  mockFindCoverageById.mockResolvedValue(null);
  mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc()] });
  mockFindLatestActiveDocumentBySlug.mockResolvedValue(null);
  mockFindDocumentExtractionByCaseDocId.mockResolvedValue(null);
  mockFindActiveCoveragePayloadBySlug.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// buildDocumentsMatrix derivation (via getDocumentsMatrix)
// ---------------------------------------------------------------------------

describe("matrix coverage derivation", () => {
  it("exposes coveredBy on a pending slot with an active coverage (status stays 'pendiente')", async () => {
    mockListActiveCoveragesForCase.mockResolvedValue([coverageRow()]);

    const res = await getDocumentsMatrix(staffActor("admin"), CASE_ID);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].status).toBe("pendiente");
    expect(res.items[0].coveredBy).toMatchObject({
      coverageId: COVERAGE_ID,
      sourceDocumentId: SRC_DOC_ID,
      sourceName: "Formulario I-589 completo",
      confidence: 0.9,
    });
    expect(res.optionalDone).toBe(1);
  });

  it("an OWN upload supersedes the coverage (derivation, never persisted)", async () => {
    mockListActiveCoveragesForCase.mockResolvedValue([coverageRow()]);
    mockListCaseDocuments.mockResolvedValue([uploadedDoc()]);

    const res = await getDocumentsMatrix(staffActor("admin"), CASE_ID);
    expect(res.items[0].status).toBe("revision");
    expect(res.items[0].coveredBy).toBeNull();
  });

  it("a case-level coverage does NOT cover a per-party slot (D5)", async () => {
    mockGetCaseParties.mockResolvedValue([
      { id: PARTY_ID, party_role: "minor", person_record_id: "p-1", user_id: null, position: 1 },
    ]);
    mockGetCaseRequirements.mockResolvedValue({
      documents: [expandedDoc({ key: `${RDT_ID}:${PARTY_ID}`, party_id: PARTY_ID })],
    });
    mockListActiveCoveragesForCase.mockResolvedValue([coverageRow()]); // party_id null

    const res = await getDocumentsMatrix(staffActor("admin"), CASE_ID);
    expect(res.items[0].coveredBy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dismissDocumentCoverage / restoreDocumentCoverage
// ---------------------------------------------------------------------------

describe("dismissDocumentCoverage", () => {
  it("finance is denied (forbidden_module) before any lookup", async () => {
    await expect(
      dismissDocumentCoverage(staffActor("finance"), { caseId: CASE_ID, coverageId: COVERAGE_ID }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
    expect(mockFindCoverageById).not.toHaveBeenCalled();
  });

  it("throws COVERAGE_NOT_FOUND when the coverage belongs to another case (id scoping)", async () => {
    mockFindCoverageById.mockResolvedValue(coverageDbRow({ case_id: "otro-caso" }));
    await expect(
      dismissDocumentCoverage(staffActor("admin"), { caseId: CASE_ID, coverageId: COVERAGE_ID }),
    ).rejects.toMatchObject({ code: "COVERAGE_NOT_FOUND" });
    expect(mockUpdateCoverageStatus).not.toHaveBeenCalled();
  });

  it("throws COVERAGE_INVALID_STATE when already dismissed", async () => {
    mockFindCoverageById.mockResolvedValue(coverageDbRow({ status: "dismissed" }));
    await expect(
      dismissDocumentCoverage(staffActor("admin"), { caseId: CASE_ID, coverageId: COVERAGE_ID }),
    ).rejects.toMatchObject({ code: "COVERAGE_INVALID_STATE" });
  });

  it("paralegal dismisses: persists dismissed + reason, writes audit + client-visible timeline", async () => {
    mockFindCoverageById.mockResolvedValue(coverageDbRow());

    await dismissDocumentCoverage(staffActor("paralegal"), {
      caseId: CASE_ID,
      coverageId: COVERAGE_ID,
      reason: "No es la declaración, son notas sueltas",
    });

    expect(mockUpdateCoverageStatus).toHaveBeenCalledWith(
      COVERAGE_ID,
      expect.objectContaining({
        status: "dismissed",
        dismiss_reason: "No es la declaración, son notas sueltas",
      }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      "case.document_coverage.dismissed",
      "case_document_coverages",
      COVERAGE_ID,
      expect.anything(),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        eventType: "document.coverage_dismissed",
        visibleToClient: true,
      }),
    );
  });
});

describe("restoreDocumentCoverage", () => {
  it("only a dismissed coverage can be restored", async () => {
    mockFindCoverageById.mockResolvedValue(coverageDbRow({ status: "detected" }));
    await expect(
      restoreDocumentCoverage(staffActor("admin"), { caseId: CASE_ID, coverageId: COVERAGE_ID }),
    ).rejects.toMatchObject({ code: "COVERAGE_INVALID_STATE" });
  });

  it("restores to detected and clears the dismissal fields", async () => {
    mockFindCoverageById.mockResolvedValue(coverageDbRow({ status: "dismissed" }));
    await restoreDocumentCoverage(staffActor("sales"), { caseId: CASE_ID, coverageId: COVERAGE_ID });
    expect(mockUpdateCoverageStatus).toHaveBeenCalledWith(COVERAGE_ID, {
      status: "detected",
      dismissed_by: null,
      dismissed_at: null,
      dismiss_reason: null,
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      "case.document_coverage.restored",
      "case_document_coverages",
      COVERAGE_ID,
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// resolveBySource — document_extraction coverage fallback
// ---------------------------------------------------------------------------

describe("resolveBySource document_extraction — coverage fallback", () => {
  const question = {
    id: "q-1",
    source: "document_extraction",
    source_ref: { document_slug: "declaracion-jurada", json_path: "declarant_name" },
  };

  it("falls back to the coverage payload when the slug has no own upload", async () => {
    mockFindActiveCoveragePayloadBySlug.mockResolvedValue({ declarant_name: "Juan Pérez" });

    const value = await resolveBySource(question, {}, CASE_ID, null);
    expect(value).toBe("Juan Pérez");
    expect(mockFindActiveCoveragePayloadBySlug).toHaveBeenCalledWith(CASE_ID, "declaracion-jurada");
  });

  it("an own upload's COMPLETED extraction wins over the coverage", async () => {
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({ id: "own-doc", storage_path: "x" });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "completed",
      payload: { declarant_name: "María" },
    });
    mockFindActiveCoveragePayloadBySlug.mockResolvedValue({ declarant_name: "Juan" });

    const value = await resolveBySource(question, {}, CASE_ID, null);
    expect(value).toBe("María");
    expect(mockFindActiveCoveragePayloadBySlug).not.toHaveBeenCalled();
  });

  it("an own upload with an INCOMPLETE extraction resolves null — sources never mix", async () => {
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({ id: "own-doc", storage_path: "x" });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({ status: "pending", payload: null });
    mockFindActiveCoveragePayloadBySlug.mockResolvedValue({ declarant_name: "Juan" });

    const value = await resolveBySource(question, {}, CASE_ID, null);
    expect(value).toBeNull();
    expect(mockFindActiveCoveragePayloadBySlug).not.toHaveBeenCalled();
  });

  it("a per-party question never uses the (case-level) coverage fallback", async () => {
    const value = await resolveBySource(question, {}, CASE_ID, PARTY_ID);
    expect(value).toBeNull();
    expect(mockFindActiveCoveragePayloadBySlug).not.toHaveBeenCalled();
  });

  it("applies value_map over the coverage-sourced value", async () => {
    mockFindActiveCoveragePayloadBySlug.mockResolvedValue({ declarant_name: "yes" });
    const mapped = await resolveBySource(
      {
        id: "q-2",
        source: "document_extraction",
        source_ref: {
          document_slug: "declaracion-jurada",
          json_path: "declarant_name",
          value_map: { yes: "SÍ" },
        },
      },
      {},
      CASE_ID,
      null,
    );
    expect(mapped).toBe("SÍ");
  });
});
