/**
 * Cases / form runtime — TDD tests for F4-Ola3.
 *
 * Covers:
 * - domain: FormResponseStatus state machine, validateAnswerTypes
 * - service: saveFormDraft (merge, FORM_VERSION_MISMATCH, FORM_VERSION_NOT_PUBLISHED)
 * - service: submitFormResponse (validation, draft→submitted)
 * - service: approveFormResponse (submitted→approved, gates)
 * - service: generateFilledPdf (FORM_PDF_BLOCKED, FORM_VERSION_MISMATCH, happy path)
 * - service: resolveBySource (all 4 sources: client_answer, document_extraction, generation_output, profile)
 * - service: getCaseExtractions (staff read)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canTransitionFormResponse,
  validateAnswerTypes,
  type FormResponseStatus,
  type QuestionValidationRule,
} from "../domain";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockRequireCaseAccess,
  // repository mocks
  mockFindFormResponse,
  mockFindFormResponseById,
  mockInsertFormResponse,
  mockMergeFormAnswers,
  mockUpdateFormResponse,
  mockFindApprovedDocumentBySlug,
  mockFindDocumentExtractionByCaseDocId,
  mockFindCompletedGenerationByFormSlug,
  mockFindClientProfileForForm,
  mockFindUserContactFields,
  mockListDocumentExtractionsForCase,
  mockFindCasePrimaryClient,
  mockFindFormDefinitionById,
  // catalog mocks
  mockGetPublishedAutomationVersion,
  mockListQuestionGroups,
  mockListQuestions,
  // audit mocks
  mockWriteAudit,
  mockAppendCaseTimeline,
  // events mock
  mockEmit,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindFormResponse: vi.fn(),
  mockFindFormResponseById: vi.fn(),
  mockInsertFormResponse: vi.fn(),
  mockMergeFormAnswers: vi.fn().mockResolvedValue(undefined),
  mockUpdateFormResponse: vi.fn().mockResolvedValue(undefined),
  mockFindApprovedDocumentBySlug: vi.fn(),
  mockFindDocumentExtractionByCaseDocId: vi.fn(),
  mockFindCompletedGenerationByFormSlug: vi.fn(),
  mockFindClientProfileForForm: vi.fn(),
  mockFindUserContactFields: vi.fn(),
  mockListDocumentExtractionsForCase: vi.fn(),
  mockFindCasePrimaryClient: vi.fn(),
  mockFindFormDefinitionById: vi.fn(),
  mockGetPublishedAutomationVersion: vi.fn(),
  mockListQuestionGroups: vi.fn().mockResolvedValue([]),
  mockListQuestions: vi.fn().mockResolvedValue([]),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
  mockEmit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: mockEmit, on: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("../repository", () => ({
  // Existing repo functions (stubs for tests not under test here)
  findCaseById: vi.fn().mockResolvedValue(null),
  findCaseByCaseId: vi.fn().mockResolvedValue(null),
  findCaseByContractId: vi.fn().mockResolvedValue(null),
  nextCaseNumber: vi.fn(),
  insertCase: vi.fn(),
  upsertCaseMember: vi.fn(),
  updateCase: vi.fn(),
  insertPhaseHistory: vi.fn(),
  findDocumentById: vi.fn(),
  insertCaseDocument: vi.fn(),
  updateDocument: vi.fn(),
  findCurrentChainHead: vi.fn().mockResolvedValue(null),
  getTimelinePage: vi.fn(),
  listCases: vi.fn(),
  listCaseDocuments: vi.fn().mockResolvedValue([]),
  getRequirementOverrides: vi.fn().mockResolvedValue([]),
  getCaseParties: vi.fn().mockResolvedValue([]),
  findServiceLite: vi.fn().mockResolvedValue(null),
  listServicePhases: vi.fn().mockResolvedValue([]),
  listServiceMilestones: vi.fn().mockResolvedValue([]),
  findPersonRecord: vi.fn().mockResolvedValue(null),
  findClientDisplayName: vi.fn().mockResolvedValue(null),
  findPlanKind: vi.fn().mockResolvedValue(null),
  // New form response functions
  findFormResponse: mockFindFormResponse,
  findFormResponseById: mockFindFormResponseById,
  insertFormResponse: mockInsertFormResponse,
  mergeFormAnswers: mockMergeFormAnswers,
  updateFormResponse: mockUpdateFormResponse,
  listFormResponsesForCase: vi.fn().mockResolvedValue([]),
  findApprovedDocumentBySlug: mockFindApprovedDocumentBySlug,
  findDocumentExtractionByCaseDocId: mockFindDocumentExtractionByCaseDocId,
  findCompletedGenerationByFormSlug: mockFindCompletedGenerationByFormSlug,
  findClientProfileForForm: mockFindClientProfileForForm,
  findUserContactFields: mockFindUserContactFields,
  listDocumentExtractionsForCase: mockListDocumentExtractionsForCase,
  findCasePrimaryClient: mockFindCasePrimaryClient,
  findFormDefinitionById: mockFindFormDefinitionById,
}));

vi.mock("@/backend/modules/catalog", () => ({
  getPublishedAutomationVersion: mockGetPublishedAutomationVersion,
  listQuestionGroups: mockListQuestionGroups,
  listQuestions: mockListQuestions,
  getCaseRequirements: vi.fn(),
  getCatalogFirstPhase: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn().mockResolvedValue("https://signed.url/file.pdf"),
  validateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
  uploadBytesToStorage: vi.fn().mockResolvedValue("case/test-case/forms/form-slug-resp-id.pdf"),
}));

vi.mock("@/backend/platform/pdf", () => ({
  fillAcroForm: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), // %PDF
}));

vi.mock("@/backend/platform/crypto", () => ({
  decryptPiiField: vi.fn().mockReturnValue("123-45-6789"),
  encryptPiiField: vi.fn(),
  isAllowedPiiKey: vi.fn().mockReturnValue(true),
  maskValue: vi.fn(),
  ALLOWED_PII_KEYS: ["ssn", "a_number", "passport"],
}));

vi.mock("@/shared/constants/profile-fields", () => ({
  PROFILE_SOURCE_FIELDS: [
    "first_name", "last_name", "preferred_name", "country_of_origin",
    "address.line1", "address.city", "address.state", "address.zip",
    "phone_e164", "email", "pii.ssn", "pii.a_number", "pii.passport",
  ],
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const FORM_DEF_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const RESPONSE_ID = "44444444-4444-4444-8444-444444444444";
const _PARTY_ID = "55555555-5555-4555-8555-555555555555";
const CLIENT_ID = "66666666-6666-4666-8666-666666666666";
const DOC_ID = "77777777-7777-4777-8777-777777777777";
const _RUN_ID = "88888888-8888-4888-8888-888888888888";

const staffActor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "staff" as const,
  role: "paralegal" as const,
  permissions: new Map(),
};

const clientActor = {
  userId: CLIENT_ID,
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "client" as const,
  role: null,
  permissions: new Map(),
};

const activeFormDef = {
  id: FORM_DEF_ID,
  slug: "form-slug",
  kind: "pdf_automation",
  filled_by: "client",
  is_per_party: false,
  party_roles: null,
  is_active: true,
};

const publishedVersion = {
  id: VERSION_ID,
  source_pdf_path: "catalog-assets/form.pdf",
  detected_fields: [],
};

const draftResponse = {
  id: RESPONSE_ID,
  case_id: CASE_ID,
  form_definition_id: FORM_DEF_ID,
  automation_version_id: VERSION_ID,
  party_id: null,
  status: "draft",
  answers: {},
  submitted_at: null,
  filled_pdf_path: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const submittedResponse = { ...draftResponse, status: "submitted" };
const approvedResponse = { ...draftResponse, status: "approved" };

// ---------------------------------------------------------------------------
// Domain: FormResponseStatus state machine
// ---------------------------------------------------------------------------

describe("canTransitionFormResponse", () => {
  it("allows draft → submitted", () => {
    expect(canTransitionFormResponse("draft", "submitted")).toBeNull();
  });

  it("allows submitted → approved", () => {
    expect(canTransitionFormResponse("submitted", "approved")).toBeNull();
  });

  it("denies draft → approved (must go through submitted)", () => {
    expect(canTransitionFormResponse("draft", "approved")).toBe("FORM_INVALID_TRANSITION");
  });

  it("denies approved → submitted (terminal)", () => {
    expect(canTransitionFormResponse("approved" as FormResponseStatus, "submitted")).toBe(
      "FORM_INVALID_TRANSITION",
    );
  });

  it("denies approved → draft (terminal)", () => {
    expect(canTransitionFormResponse("approved" as FormResponseStatus, "draft")).toBe(
      "FORM_INVALID_TRANSITION",
    );
  });
});

// ---------------------------------------------------------------------------
// Domain: validateAnswerTypes
// ---------------------------------------------------------------------------

describe("validateAnswerTypes", () => {
  const makeQuestion = (overrides?: Partial<QuestionValidationRule>): QuestionValidationRule => ({
    id: "q1",
    field_type: "text",
    is_required: true,
    options: null,
    validation: null,
    ...overrides,
  });

  it("returns empty array when all required fields are answered", () => {
    const questions = [makeQuestion({ id: "q1" }), makeQuestion({ id: "q2", is_required: false })];
    const answers = { q1: "hello" };
    expect(validateAnswerTypes(answers, questions)).toHaveLength(0);
  });

  it("returns error for missing required field", () => {
    const questions = [makeQuestion({ id: "q1", is_required: true })];
    const answers = {};
    const errors = validateAnswerTypes(answers, questions);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ questionId: "q1", code: "required" });
  });

  it("accepts empty optional field without error", () => {
    const questions = [makeQuestion({ id: "q1", is_required: false })];
    const answers = {};
    expect(validateAnswerTypes(answers, questions)).toHaveLength(0);
  });

  it("rejects a select value outside the declared options (server whitelist)", () => {
    const questions = [
      makeQuestion({
        id: "q1",
        field_type: "select",
        is_required: false,
        options: [{ value: "male" }, { value: "female" }],
      }),
    ];
    expect(validateAnswerTypes({ q1: "other" }, questions)).toEqual([
      { questionId: "q1", code: "type" },
    ]);
    expect(validateAnswerTypes({ q1: "female" }, questions)).toHaveLength(0);
  });

  it("validates regex rule", () => {
    const questions = [
      makeQuestion({
        id: "q1",
        is_required: false,
        validation: { regex: "^\\d{3}-\\d{2}-\\d{4}$" },
      }),
    ];
    const good = { q1: "123-45-6789" };
    const bad = { q1: "notanssn" };
    expect(validateAnswerTypes(good, questions)).toHaveLength(0);
    const errors = validateAnswerTypes(bad, questions);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe("regex");
  });

  it("validates min number rule", () => {
    const questions = [
      makeQuestion({ id: "q1", field_type: "number", is_required: false, validation: { min: 18 } }),
    ];
    const tooSmall = { q1: 5 };
    const ok = { q1: 25 };
    expect(validateAnswerTypes(tooSmall, questions)[0]?.code).toBe("min");
    expect(validateAnswerTypes(ok, questions)).toHaveLength(0);
  });

  it("validates max string length rule", () => {
    const questions = [
      makeQuestion({ id: "q1", is_required: false, validation: { max: 5 } }),
    ];
    const tooLong = { q1: "toolongstring" };
    const ok = { q1: "hi" };
    expect(validateAnswerTypes(tooLong, questions)[0]?.code).toBe("max");
    expect(validateAnswerTypes(ok, questions)).toHaveLength(0);
  });

  it("validates multiple questions — collects all errors", () => {
    const questions = [
      makeQuestion({ id: "q1", is_required: true }),
      makeQuestion({ id: "q2", is_required: true }),
    ];
    const answers = {};
    const errors = validateAnswerTypes(answers, questions);
    expect(errors).toHaveLength(2);
  });

  it("null/undefined values count as empty", () => {
    const questions = [makeQuestion({ id: "q1", is_required: true })];
    expect(validateAnswerTypes({ q1: null }, questions)[0]?.code).toBe("required");
    expect(validateAnswerTypes({ q1: undefined }, questions)[0]?.code).toBe("required");
  });
});

// ---------------------------------------------------------------------------
// Service: saveFormDraft
// ---------------------------------------------------------------------------

import { saveFormDraft, submitFormResponse, approveFormResponse, generateFilledPdf, resolveBySource, getCaseExtractions } from "../service";

describe("saveFormDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestions.mockResolvedValue([]);
    mockListQuestionGroups.mockResolvedValue([]);
  });

  it("creates a new draft response on first save", async () => {
    mockFindFormResponse.mockResolvedValue(null);
    const newResponse = { ...draftResponse };
    mockInsertFormResponse.mockResolvedValue(newResponse);
    mockMergeFormAnswers.mockResolvedValue(undefined);
    mockFindFormResponseById.mockResolvedValue(newResponse);

    const result = await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "hello" },
    });

    expect(mockInsertFormResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: CASE_ID,
        form_definition_id: FORM_DEF_ID,
        automation_version_id: VERSION_ID,
        party_id: null,
        status: "draft",
      }),
    );
    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "hello" });
    expect(result.id).toBe(RESPONSE_ID);
  });

  it("merges into existing draft (no re-insert)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { q1: "hello" } });

    await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "hello" },
    });

    expect(mockInsertFormResponse).not.toHaveBeenCalled();
    expect(mockMergeFormAnswers).toHaveBeenCalled();
  });

  it("throws FORM_NOT_SUBMITTABLE when trying to edit a submitted response", async () => {
    mockFindFormResponse.mockResolvedValue(submittedResponse);

    await expect(
      saveFormDraft(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: { q1: "value" },
      }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("throws FORM_NOT_EDITABLE_BY_CLIENT for staff-only form", async () => {
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, filled_by: "staff" });
    mockFindFormResponse.mockResolvedValue(null);

    await expect(
      saveFormDraft(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: {},
      }),
    ).rejects.toThrow("FORM_NOT_EDITABLE_BY_CLIENT");
  });

  it("throws FORM_VERSION_NOT_PUBLISHED when no published version exists for pdf_automation", async () => {
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockInsertFormResponse.mockResolvedValue(draftResponse);

    await expect(
      saveFormDraft(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: {},
      }),
    ).rejects.toThrow("FORM_VERSION_NOT_PUBLISHED");
  });

  it("throws FORM_VERSION_MISMATCH for unknown question key", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: false, options: null, validation: null },
    ]);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);

    await expect(
      saveFormDraft(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: { unknown_q: "value" }, // key not in version
      }),
    ).rejects.toThrow("FORM_VERSION_MISMATCH");
  });

  it("throws FORM_VALIDATION_FAILED for invalid answer type", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: true, options: null, validation: { regex: "^\\d+$" } },
    ]);

    await expect(
      saveFormDraft(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: { q1: "not-a-number" },
      }),
    ).rejects.toThrow("FORM_VALIDATION_FAILED");
  });

  it("allows staff to save any form (filled_by=staff)", async () => {
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, filled_by: "staff" });
    mockFindFormResponse.mockResolvedValue(null);
    mockInsertFormResponse.mockResolvedValue(draftResponse);
    mockFindFormResponseById.mockResolvedValue(draftResponse);

    const result = await saveFormDraft(staffActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: {},
    });
    expect(result.id).toBe(RESPONSE_ID);
  });
});

// ---------------------------------------------------------------------------
// Service: submitFormResponse
// ---------------------------------------------------------------------------

describe("submitFormResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockListQuestionGroups.mockResolvedValue([]);
    mockListQuestions.mockResolvedValue([]);
  });

  it("transitions draft → submitted when all required fields answered", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    // A published version resolves to its questions (none required → empty answers pass).
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: false, options: null, validation: null },
    ]);
    const updated = { ...submittedResponse };
    mockFindFormResponseById.mockResolvedValue(updated);

    const result = await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "submitted" }),
    );
    expect(result.status).toBe("submitted");
    expect(mockEmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "form_response.submitted" }),
    );
  });

  it("throws FORM_NOT_SUBMITTABLE when no draft response exists", async () => {
    mockFindFormResponse.mockResolvedValue(null);

    await expect(
      submitFormResponse(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
      }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("throws FORM_NOT_SUBMITTABLE when response is already submitted", async () => {
    mockFindFormResponse.mockResolvedValue(submittedResponse);

    await expect(
      submitFormResponse(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
      }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("throws FORM_VALIDATION_FAILED when required questions are unanswered", async () => {
    mockFindFormResponse.mockResolvedValue({ ...draftResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: true, options: null, validation: null },
    ]);

    await expect(
      submitFormResponse(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
      }),
    ).rejects.toThrow("FORM_VALIDATION_FAILED");
  });

  it("fails closed when a versioned form resolves to zero questions (no silent skip)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    // Catalog read returns no questions for a pdf_automation version → unresolvable.
    mockListQuestionGroups.mockResolvedValue([]);
    mockListQuestions.mockResolvedValue([]);

    await expect(
      submitFormResponse(clientActor, {
        caseId: CASE_ID,
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
      }),
    ).rejects.toThrow("FORM_VERSION_NOT_PUBLISHED");

    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });

  it("emits timeline entry on successful submit", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: false, options: null, validation: null },
    ]);
    mockFindFormResponseById.mockResolvedValue(submittedResponse);

    await submitFormResponse(staffActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, eventType: "form_response.submitted" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Service: approveFormResponse
// ---------------------------------------------------------------------------

describe("approveFormResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("approves a submitted response", async () => {
    mockFindFormResponseById.mockResolvedValue(submittedResponse);

    await approveFormResponse(staffActor, { responseId: RESPONSE_ID });

    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "approved" }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "case.form_response.approved",
      "case_form_responses",
      RESPONSE_ID,
      expect.any(Object),
    );
  });

  it("throws FORM_RESPONSE_NOT_FOUND when response does not exist", async () => {
    mockFindFormResponseById.mockResolvedValue(null);

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_RESPONSE_NOT_FOUND");
  });

  it("throws FORM_NOT_SUBMITTABLE when response is still draft", async () => {
    mockFindFormResponseById.mockResolvedValue(draftResponse);

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("throws FORM_NOT_SUBMITTABLE when already approved (idempotent block)", async () => {
    mockFindFormResponseById.mockResolvedValue(approvedResponse);

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("requires cases:edit permission", async () => {
    mockCan.mockImplementation(() => { throw new Error("forbidden"); });

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("forbidden");

    expect(mockFindFormResponseById).not.toHaveBeenCalled();
  });

  it("blocks cross-tenant approve (requireCaseAccess rejects → no mutation)", async () => {
    mockFindFormResponseById.mockResolvedValue(submittedResponse);
    mockRequireCaseAccess.mockRejectedValue(new Error("forbidden_case"));

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("forbidden_case");

    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Service: generateFilledPdf
// ---------------------------------------------------------------------------

describe("generateFilledPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestionGroups.mockResolvedValue([]);
    mockListQuestions.mockResolvedValue([]);
    // Mock fetch for source PDF
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
  });

  it("throws FORM_RESPONSE_NOT_FOUND when response missing", async () => {
    mockFindFormResponseById.mockResolvedValue(null);

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_RESPONSE_NOT_FOUND");
  });

  it("blocks cross-tenant PDF generation (requireCaseAccess rejects → no PII leak)", async () => {
    mockFindFormResponseById.mockResolvedValue(approvedResponse);
    mockRequireCaseAccess.mockRejectedValue(new Error("forbidden_case"));

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("forbidden_case");

    // Never reaches the form-definition read / PDF fill if cross-tenant.
    expect(mockFindFormDefinitionById).not.toHaveBeenCalled();
  });

  it("throws FORM_PDF_BLOCKED when response is still draft", async () => {
    mockFindFormResponseById.mockResolvedValue(draftResponse);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_PDF_BLOCKED");
  });

  it("throws FORM_PDF_BLOCKED when client form is submitted but not approved", async () => {
    mockFindFormResponseById.mockResolvedValue(submittedResponse);
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, filled_by: "client" });

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_PDF_BLOCKED");
  });

  it("allows PDF generation for submitted staff-filled form", async () => {
    const staffFilledSubmitted = { ...submittedResponse };
    mockFindFormResponseById.mockResolvedValue(staffFilledSubmitted);
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, filled_by: "staff" });
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);

    const url = await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(url).toBe("https://signed.url/file.pdf");
    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ filled_pdf_path: expect.stringContaining("case/") }),
    );
  });

  it("throws FORM_VERSION_MISMATCH when response was saved against an older version", async () => {
    const OLD_VERSION = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const outdatedResponse = { ...approvedResponse, automation_version_id: OLD_VERSION };
    mockFindFormResponseById.mockResolvedValue(outdatedResponse);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    // published version is VERSION_ID, response has OLD_VERSION
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_VERSION_MISMATCH");
  });

  it("generates PDF successfully for approved client form", async () => {
    mockFindFormResponseById.mockResolvedValue(approvedResponse);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);

    const url = await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(url).toBeDefined();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "case.form_response.pdf_generated",
      "case_form_responses",
      RESPONSE_ID,
      expect.any(Object),
    );
  });

  it("throws FORM_PDF_REQUIRED_MISSING when required field has no value", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", source: "client_answer", source_ref: null, pdf_field_name: "FirstName", is_required: true },
    ]);

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_PDF_REQUIRED_MISSING");
  });
});

// ---------------------------------------------------------------------------
// Service: resolveBySource
// ---------------------------------------------------------------------------

describe("resolveBySource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves client_answer from response answers", async () => {
    const answers = { q1: "my answer" };
    const result = await resolveBySource(
      { id: "q1", source: "client_answer", source_ref: null },
      answers,
      CASE_ID,
      null,
    );
    expect(result).toBe("my answer");
  });

  it("returns null for client_answer when key missing", async () => {
    const result = await resolveBySource(
      { id: "missing_q", source: "client_answer", source_ref: null },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
  });

  it("resolves document_extraction via approved doc and extraction payload", async () => {
    mockFindApprovedDocumentBySlug.mockResolvedValue({
      id: DOC_ID,
      storage_path: "case/xxx/doc.pdf",
    });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "completed",
      payload: { name: "John Doe", dob: "1990-01-01" },
    });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "document_extraction",
        source_ref: { document_slug: "passport", json_path: "name" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("John Doe");
  });

  it("returns null for document_extraction when no approved doc found", async () => {
    mockFindApprovedDocumentBySlug.mockResolvedValue(null);

    const result = await resolveBySource(
      {
        id: "q1",
        source: "document_extraction",
        source_ref: { document_slug: "passport", json_path: "name" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
  });

  it("returns null for document_extraction when extraction is not completed", async () => {
    mockFindApprovedDocumentBySlug.mockResolvedValue({ id: DOC_ID, storage_path: "x" });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "pending",
      payload: null,
    });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "document_extraction",
        source_ref: { document_slug: "passport", json_path: "name" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
  });

  it("resolves generation_output via completed run output path", async () => {
    mockFindCompletedGenerationByFormSlug.mockResolvedValue({
      output: { letter_body: "Dear USCIS...", header: { date: "2026-06-14" } },
    });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "generation_output",
        source_ref: { form_slug: "cover-letter", output_path: "header.date" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("2026-06-14");
  });

  it("returns null for generation_output when no completed run", async () => {
    mockFindCompletedGenerationByFormSlug.mockResolvedValue(null);

    const result = await resolveBySource(
      {
        id: "q1",
        source: "generation_output",
        source_ref: { form_slug: "cover-letter", output_path: "body" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
  });

  it("resolves profile.first_name from client profile (non-PII)", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindClientProfileForForm.mockResolvedValue({
      first_name: "Maria",
      last_name: "Garcia",
      preferred_name: null,
      country_of_origin: "MX",
      address: {},
      pii_encrypted: {},
    });

    const result = await resolveBySource(
      { id: "q1", source: "profile", source_ref: { profile_field: "first_name" } },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("Maria");
    // PII was NOT decrypted — no crypto call
    const { decryptPiiField } = await import("@/backend/platform/crypto");
    expect(decryptPiiField).not.toHaveBeenCalled();
  });

  it("resolves profile.pii.ssn via local decryption (PII never leaves server)", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindClientProfileForForm.mockResolvedValue({
      first_name: "Maria",
      last_name: "Garcia",
      preferred_name: null,
      country_of_origin: null,
      address: {},
      pii_encrypted: { ssn: { iv: "abc", ct: "def", tag: "ghi" } },
    });
    const { decryptPiiField } = await import("@/backend/platform/crypto");
    (decryptPiiField as ReturnType<typeof vi.fn>).mockReturnValue("123-45-6789");

    const result = await resolveBySource(
      { id: "q1", source: "profile", source_ref: { profile_field: "pii.ssn" } },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("123-45-6789");
    expect(decryptPiiField).toHaveBeenCalled();
  });

  it("resolves profile.address.city via address sub-field", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindClientProfileForForm.mockResolvedValue({
      first_name: "Maria",
      last_name: "Garcia",
      preferred_name: null,
      country_of_origin: null,
      address: { city: "Miami", state: "FL" },
      pii_encrypted: {},
    });

    const result = await resolveBySource(
      { id: "q1", source: "profile", source_ref: { profile_field: "address.city" } },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("Miami");
  });

  it("resolves profile.email from users table", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindUserContactFields.mockResolvedValue({ phone_e164: "+13055550100", email: "maria@example.com" });

    const result = await resolveBySource(
      { id: "q1", source: "profile", source_ref: { profile_field: "email" } },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("maria@example.com");
  });

  it("resolves profile.phone_e164 from users table", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindUserContactFields.mockResolvedValue({ phone_e164: "+13055550100", email: "m@e.com" });

    const result = await resolveBySource(
      { id: "q1", source: "profile", source_ref: { profile_field: "phone_e164" } },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("+13055550100");
  });

  it("throws FORM_PROFILE_FIELD_FORBIDDEN for non-whitelisted field", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);

    await expect(
      resolveBySource(
        { id: "q1", source: "profile", source_ref: { profile_field: "internal_secret" } },
        {},
        CASE_ID,
        null,
      ),
    ).rejects.toThrow("FORM_PROFILE_FIELD_FORBIDDEN");
  });

  it("returns null for unknown source type", async () => {
    const result = await resolveBySource(
      { id: "q1", source: "unknown_source", source_ref: null },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Service: getCaseExtractions
// ---------------------------------------------------------------------------

describe("getCaseExtractions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("returns extraction summaries for a case", async () => {
    const extractions = [
      {
        caseDocumentId: DOC_ID,
        requirementSlug: "passport",
        partyId: null,
        documentStatus: "approved",
        extractionStatus: "completed",
        extractionPayload: { name: "John" },
      },
    ];
    mockListDocumentExtractionsForCase.mockResolvedValue(extractions);

    const result = await getCaseExtractions(staffActor, CASE_ID);

    expect(result).toHaveLength(1);
    expect(result[0].requirementSlug).toBe("passport");
    expect(result[0].extractionStatus).toBe("completed");
    expect(result[0].extractionPayload).toEqual({ name: "John" });
  });

  it("requires cases:view permission", async () => {
    mockCan.mockImplementation(() => { throw new Error("forbidden"); });

    await expect(getCaseExtractions(staffActor, CASE_ID)).rejects.toThrow("forbidden");
    expect(mockListDocumentExtractionsForCase).not.toHaveBeenCalled();
  });

  it("returns empty array when no documents with extractions", async () => {
    mockListDocumentExtractionsForCase.mockResolvedValue([]);

    const result = await getCaseExtractions(staffActor, CASE_ID);
    expect(result).toHaveLength(0);
  });
});
