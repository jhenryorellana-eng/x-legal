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
  isAiImproveEnabled,
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
  mockFindLatestActiveDocumentBySlug,
  mockFindDocumentExtractionByCaseDocId,
  mockFindCompletedGenerationByFormSlug,
  mockDownloadDocumentBytesBySlug,
  mockDownloadAllDocumentBytesBySlug,
  mockFindClientProfileForForm,
  mockFindUserContactFields,
  mockListDocumentExtractionsForCase,
  mockFindCasePrimaryClient,
  mockFindFormDefinitionById,
  mockFindCaseServiceId,
  // catalog mocks
  mockGetPublishedAutomationVersion,
  mockListQuestionGroups,
  mockListQuestions,
  // pdf + ai-engine mocks
  mockFillAcroForm,
  mockBackfillNa,
  mockTranslateText,
  mockTranslateAnswersBatch,
  mockInterpretDocumentFields,
  mockSynthesizeLetterFields,
  mockGetCurrentQuestionnaireInstance,
  mockGetQuestionnaireClientState,
  mockStartQuestionnaireGeneration,
  mockGetQuestionnaireInstanceDrafts,
  mockGetQuestionnaireInstanceSchemaQuestions,
  mockFindCaseByIdSystem,
  mockListUploadedRequirementSlugs,
  mockGetPostureBySlug,
  mockMergeFormAnswersIfEmpty,
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
  mockFindLatestActiveDocumentBySlug: vi.fn(),
  mockFindDocumentExtractionByCaseDocId: vi.fn(),
  mockFindCompletedGenerationByFormSlug: vi.fn(),
  mockDownloadDocumentBytesBySlug: vi.fn(),
  mockDownloadAllDocumentBytesBySlug: vi.fn().mockResolvedValue([]),
  mockFindClientProfileForForm: vi.fn(),
  mockFindUserContactFields: vi.fn(),
  mockListDocumentExtractionsForCase: vi.fn(),
  mockFindCasePrimaryClient: vi.fn(),
  mockFindFormDefinitionById: vi.fn(),
  mockFindCaseServiceId: vi.fn(),
  mockGetPublishedAutomationVersion: vi.fn(),
  mockListQuestionGroups: vi.fn().mockResolvedValue([]),
  mockListQuestions: vi.fn().mockResolvedValue([]),
  mockFillAcroForm: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])),
  mockBackfillNa: vi.fn(() => 0),
  mockTranslateText: vi.fn(),
  mockTranslateAnswersBatch: vi.fn().mockResolvedValue({}),
  mockInterpretDocumentFields: vi.fn().mockResolvedValue({}),
  mockSynthesizeLetterFields: vi.fn().mockResolvedValue({}),
  mockGetCurrentQuestionnaireInstance: vi.fn().mockResolvedValue(null),
  mockGetQuestionnaireClientState: vi.fn(),
  mockStartQuestionnaireGeneration: vi.fn().mockResolvedValue({ status: "queued" }),
  mockGetQuestionnaireInstanceDrafts: vi.fn().mockResolvedValue(null),
  mockGetQuestionnaireInstanceSchemaQuestions: vi.fn().mockResolvedValue(null),
  mockFindCaseByIdSystem: vi.fn().mockResolvedValue(null),
  mockListUploadedRequirementSlugs: vi.fn().mockResolvedValue([]),
  mockGetPostureBySlug: vi.fn().mockResolvedValue(null),
  mockMergeFormAnswersIfEmpty: vi.fn().mockResolvedValue(null),
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
  appEvents: { emit: mockEmit, emitAndWait: mockEmit, on: vi.fn() },
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
  // Wave 2 — posture source gate
  findCaseByIdSystem: mockFindCaseByIdSystem,
  listUploadedRequirementSlugs: mockListUploadedRequirementSlugs,
  findExtractionPayloadBySlug: vi.fn().mockResolvedValue(null),
  updateCasePosture: vi.fn().mockResolvedValue(undefined),
  listServicePosturesForService: vi.fn().mockResolvedValue([]),
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
  mergeFormAnswersIfEmpty: mockMergeFormAnswersIfEmpty,
  updateFormResponse: mockUpdateFormResponse,
  listFormResponsesForCase: vi.fn().mockResolvedValue([]),
  findLatestActiveDocumentBySlug: mockFindLatestActiveDocumentBySlug,
  findDocumentExtractionByCaseDocId: mockFindDocumentExtractionByCaseDocId,
  findCompletedGenerationByFormSlug: mockFindCompletedGenerationByFormSlug,
  downloadDocumentBytesBySlug: mockDownloadDocumentBytesBySlug,
  downloadAllDocumentBytesBySlug: mockDownloadAllDocumentBytesBySlug,
  // Tiny shared inline budget so the threading math is visible in tests.
  AI_FIELD_CONTEXT_MAX_TOTAL_BYTES: 100,
  // ai_field raw_text context + fingerprint cache (covered in ai-field-cache.test.ts):
  // benign defaults here = always a cache miss and byte-context fallback.
  findRawTextsBySlug: vi.fn().mockResolvedValue([]),
  listDocumentMetaBySlugs: vi.fn().mockResolvedValue([]),
  findAiFieldCacheRows: vi.fn().mockResolvedValue([]),
  upsertAiFieldCacheRows: vi.fn().mockResolvedValue(undefined),
  findClientProfileForForm: mockFindClientProfileForForm,
  findUserContactFields: mockFindUserContactFields,
  listDocumentExtractionsForCase: mockListDocumentExtractionsForCase,
  findCasePrimaryClient: mockFindCasePrimaryClient,
  findFormDefinitionById: mockFindFormDefinitionById,
  findCaseServiceId: mockFindCaseServiceId,
}));

vi.mock("@/backend/modules/catalog", () => ({
  getPublishedAutomationVersion: mockGetPublishedAutomationVersion,
  listQuestionGroups: mockListQuestionGroups,
  listQuestions: mockListQuestions,
  getCaseRequirements: vi.fn(),
  getCatalogFirstPhase: vi.fn(),
  // Wave 2 — posture lookups (source gate + question playbook)
  getPostureBySlug: mockGetPostureBySlug,
  resolvePostureForService: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn().mockResolvedValue("https://signed.url/file.pdf"),
  validateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
  uploadBytesToStorage: vi.fn().mockResolvedValue("case/test-case/forms/form-slug-resp-id.pdf"),
}));

vi.mock("@/backend/platform/pdf", () => ({
  fillAcroForm: mockFillAcroForm,
  backfillNaTextFields: mockBackfillNa,
}));

// Ola perf: a cache miss on an ai_field question enqueues the background warm
// job — the wizard open itself must NEVER call a provider.
vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  translateAnswerText: mockTranslateText,
  translateAnswersBatch: mockTranslateAnswersBatch,
  interpretDocumentFields: mockInterpretDocumentFields,
  synthesizeLetterFields: mockSynthesizeLetterFields,
  getCurrentQuestionnaireInstance: mockGetCurrentQuestionnaireInstance,
  getQuestionnaireClientState: mockGetQuestionnaireClientState,
  startQuestionnaireGeneration: mockStartQuestionnaireGeneration,
  getQuestionnaireInstanceDrafts: mockGetQuestionnaireInstanceDrafts,
  getQuestionnaireInstanceSchemaQuestions: mockGetQuestionnaireInstanceSchemaQuestions,
  // Autofill total: drafts ∪ schema default_values. The submit path consumes
  // THIS one; same mock fn keeps the provenance assertions unchanged.
  getQuestionnaireInstanceAutofillValues: mockGetQuestionnaireInstanceDrafts,
  // The COMPLETENESS gate consumes this stricter, provenance-filtered variant.
  // Aliased to the same fn here on purpose: these fixtures predate the split and
  // their drafts all represent legitimately grounded answers, so the gate should
  // see them. The filtering itself is unit-tested in ai-engine, where it lives.
  // It MUST stay bound — the gate now fails closed, so an unbound name would
  // block every approve instead of silently skipping the check.
  getQuestionnaireInstanceAnsweredValues: mockGetQuestionnaireInstanceDrafts,
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

/** The service both the case and its forms belong to (cross-service scope check). */
const SERVICE_ID = "5e5e5e5e-5e5e-5e5e-5e5e-5e5e5e5e5e5e";

// Default for every suite: the form belongs to the case's own service (the normal
// case). `vi.clearAllMocks()` clears calls but not implementations, so this
// survives the per-describe resets; the scope-check suite overrides it explicitly.
mockFindCaseServiceId.mockResolvedValue(SERVICE_ID);

const activeFormDef = {
  id: FORM_DEF_ID,
  slug: "form-slug",
  kind: "pdf_automation",
  filled_by: "client",
  is_per_party: false,
  party_roles: null,
  is_active: true,
  service_id: SERVICE_ID,
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

describe("isAiImproveEnabled", () => {
  it("true only for an object with a non-empty instruction", () => {
    expect(isAiImproveEnabled({ instruction: "Una persona por línea." })).toBe(true);
  });

  it("false for null / undefined / empty instruction / garbage", () => {
    expect(isAiImproveEnabled(null)).toBe(false);
    expect(isAiImproveEnabled(undefined)).toBe(false);
    expect(isAiImproveEnabled({ instruction: "" })).toBe(false);
    expect(isAiImproveEnabled({ instruction: "   " })).toBe(false);
    expect(isAiImproveEnabled({ instruction: 42 })).toBe(false);
    expect(isAiImproveEnabled("instruction")).toBe(false);
    expect(isAiImproveEnabled(["instruction"])).toBe(false);
    expect(isAiImproveEnabled({})).toBe(false);
  });
});

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

  it("skips a required field hidden by its condition, enforces it when shown", () => {
    const questions = [
      makeQuestion({ id: "yn", field_type: "select", options: [{ value: "si" }, { value: "no" }], is_required: false }),
      makeQuestion({
        id: "explanation",
        field_type: "textarea",
        is_required: true,
        condition: { when: { question: "yn", op: "equals", value: "si" }, action: "show" },
      }),
    ];
    // yn = no → explanation hidden → no error despite being empty+required
    expect(validateAnswerTypes({ yn: "no" }, questions)).toHaveLength(0);
    // yn = si → explanation shown + required + empty → required error
    expect(validateAnswerTypes({ yn: "si" }, questions)).toEqual([{ questionId: "explanation", code: "required" }]);
    // yn = si + filled → no error
    expect(validateAnswerTypes({ yn: "si", explanation: "porque..." }, questions)).toHaveLength(0);
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

  it("enforceRequired=false (draft) skips required, still type-checks present answers", () => {
    const questions = [
      makeQuestion({ id: "q1", is_required: true }),
      makeQuestion({ id: "q2", is_required: true, field_type: "select", options: [{ value: "a" }, { value: "b" }] }),
    ];
    // q1 absent (would be "required" when enforced) → skipped; q2 present but invalid option → still flagged.
    expect(validateAnswerTypes({ q2: "a" }, questions, false)).toHaveLength(0);
    expect(validateAnswerTypes({ q2: "zzz" }, questions, false)).toEqual([{ questionId: "q2", code: "type" }]);
    // submit (default true) still enforces required on the same partial answers.
    expect(validateAnswerTypes({ q2: "a" }, questions).map((e) => e.questionId)).toEqual(["q1"]);
  });
});

// ---------------------------------------------------------------------------
// Service: saveFormDraft
// ---------------------------------------------------------------------------

import { saveFormDraft, staffUpdateFormAnswers, submitFormResponse, approveFormResponse, generateFilledPdf, resolveFormResponseFieldValues, resolveBySource, resolveAiFields, getCaseExtractions, getFormForClient, reopenQuestionnaireForClientInput } from "../service";

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

  it("draft autosave does NOT enforce required on a partial patch (regression)", async () => {
    // The version has two required questions; the client has only filled q1.
    // A draft autosave of {q1} must persist — never reject because q2 is empty.
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: true, options: null, validation: null },
      { id: "q2", field_type: "text", is_required: true, options: null, validation: null },
    ]);
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { q1: "only this" } });

    const result = await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "only this" },
    });

    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "only this" });
    expect(result.id).toBe(RESPONSE_ID);
  });

  it("drops a computed question's key from the patch (a client can't poison a derived total)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "inc1", field_type: "number", is_required: true, options: null, validation: null, source: "client_answer" },
      { id: "total", field_type: "number", is_required: false, options: null, validation: null, source: "computed" },
    ]);
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { inc1: "100" } });

    await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { inc1: "100", total: "9999" }, // a stale/buggy client tries to write the total
    });

    // The computed key is stripped; only the real line item survives the merge.
    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { inc1: "100" });
  });

  it("accepts a Postgres-valid but non-RFC-4122 UUID caseId (zUuid, regression)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { q1: "x" } });
    // e.g. a seeded/demo id whose version nibble isn't 1-8 — Zod's .uuid() would reject it.
    await expect(
      saveFormDraft(clientActor, {
        caseId: "00000000-0000-0000-0000-000000000302",
        formDefinitionId: FORM_DEF_ID,
        partyId: null,
        patch: { q1: "x" },
      }),
    ).resolves.toBeTruthy();
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

  it("PERSISTS a format-invalid partial value on draft autosave (does not brick — regression)", async () => {
    // A value still being typed (e.g. a ZIP "330" before "33012", failing the field
    // regex) must PERSIST on a draft autosave — never reject. Rejecting it bricks the
    // whole-form autosave (the engine treats a rejection as permanent) and loses
    // keystrokes. Format is enforced at SUBMIT, not on the draft (DOC-41 §3.8).
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: true, options: null, validation: { regex: "^\\d{5}$" } },
    ]);
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { q1: "330" } });

    const result = await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "330" }, // partial ZIP, fails ^\d{5}$
    });

    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "330" });
    expect(result.id).toBe(RESPONSE_ID);
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

  // Ola 3 — a dynamic questionnaire draft must stay pinned to the instance the
  // client is actually answering. getFormForClient renders the CURRENT instance, so
  // after a regeneration (new current, old demoted) the draft's pin has to follow —
  // otherwise loadQuestionLabelsForResponse resolves AI labels from the wrong schema
  // and the memo loses the wording of every newly-answered question.
  const QN_FORM_DEF = { ...activeFormDef, kind: "questionnaire" };
  const OLD_INSTANCE_ID = "b2b2b2b2-2222-4222-8222-222222222222";
  const NEW_INSTANCE_ID = "a1a1a1a1-1111-4111-8111-111111111111";
  const qnDraft = { ...draftResponse, automation_version_id: null, questionnaire_instance_id: OLD_INSTANCE_ID };

  it("re-pins a questionnaire draft to the current instance after a regeneration", async () => {
    mockFindFormDefinitionById.mockResolvedValue(QN_FORM_DEF);
    mockFindFormResponse.mockResolvedValue(qnDraft);
    mockGetCurrentQuestionnaireInstance.mockResolvedValue({ id: NEW_INSTANCE_ID, status: "ready" });
    mockFindFormResponseById.mockResolvedValue({ ...qnDraft, questionnaire_instance_id: NEW_INSTANCE_ID });

    await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "x" },
    });

    expect(mockUpdateFormResponse).toHaveBeenCalledWith(RESPONSE_ID, { questionnaire_instance_id: NEW_INSTANCE_ID });
    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "x" });
  });

  it("does NOT re-pin a questionnaire draft when the current instance already matches the pin", async () => {
    mockFindFormDefinitionById.mockResolvedValue(QN_FORM_DEF);
    mockFindFormResponse.mockResolvedValue({ ...qnDraft, questionnaire_instance_id: NEW_INSTANCE_ID });
    mockGetCurrentQuestionnaireInstance.mockResolvedValue({ id: NEW_INSTANCE_ID, status: "ready" });
    mockFindFormResponseById.mockResolvedValue({ ...qnDraft, questionnaire_instance_id: NEW_INSTANCE_ID });

    await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "x" },
    });

    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });

  it("does NOT re-pin a questionnaire draft while the current instance is still generating", async () => {
    mockFindFormDefinitionById.mockResolvedValue(QN_FORM_DEF);
    mockFindFormResponse.mockResolvedValue(qnDraft);
    mockGetCurrentQuestionnaireInstance.mockResolvedValue({ id: NEW_INSTANCE_ID, status: "generating" });
    mockFindFormResponseById.mockResolvedValue(qnDraft);

    await saveFormDraft(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
      patch: { q1: "x" },
    });

    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getFormForClient — questionnaire `stale` flag (on_new_evidence, ola Apelación)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// getFormForClient — the form must belong to the CASE's own service
// ---------------------------------------------------------------------------

describe("getFormForClient — cross-service form scope check", () => {
  const OTHER_SERVICE = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(null);
    // The CASE's service stays the module default (SERVICE_ID); only the FORM's
    // service varies per test. Overriding the case-service mock here would leak
    // its implementation into later suites and break them.
  });

  it("rejects a formDefinitionId belonging to ANOTHER service as FORM_NOT_FOUND", async () => {
    // `formDefinitionId` comes straight from the /formulario/[formId] URL, and
    // requireCaseAccess only proves the actor may see the CASE. Without the scope
    // check a client could read any other service's form through their own case.
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, service_id: OTHER_SERVICE });

    await expect(
      getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null }),
    ).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });

  it("rejects when the form's owning service cannot be resolved (fail closed)", async () => {
    mockFindFormDefinitionById.mockResolvedValue({ ...activeFormDef, service_id: null });

    await expect(
      getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null }),
    ).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });

  it("allows a form that belongs to the case's own service", async () => {
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);

    const dto = await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });
    expect(dto.formDefinitionId).toBe(FORM_DEF_ID);
  });
});

describe("getFormForClient — questionnaire stale flag", () => {
  const QN_DEF = { ...activeFormDef, kind: "questionnaire" };

  function dynamicState(
    instanceStatus: string,
    opts: { autoTrigger?: boolean; stuckQueued?: boolean; prereqsOk?: boolean } = {},
  ) {
    return {
      isDynamic: true,
      mode: "automatic",
      hybridLayout: "append_group",
      autoTrigger: opts.autoTrigger ?? false,
      allowClientTrigger: false,
      stuckQueued: opts.stuckQueued ?? false,
      instance: { status: instanceStatus, schema: { groups: [] } },
      prereqs: opts.prereqsOk === undefined ? null : { ok: opts.prereqsOk, missingForms: [], missingDocuments: [] },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("surfaces questionnaireStale=true when the current instance predates new evidence", async () => {
    mockFindFormDefinitionById.mockResolvedValue(QN_DEF);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(dynamicState("stale"));

    const dto = await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    expect(dto.questionnaireStale).toBe(true);
    expect(dto.questionnaireGate).toBeNull();
  });

  it("keeps questionnaireStale falsy for a fresh (ready) instance", async () => {
    mockFindFormDefinitionById.mockResolvedValue(QN_DEF);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(dynamicState("ready"));

    const dto = await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    expect(dto.questionnaireStale).toBeFalsy();
  });

  it("re-kicks generation when the current 'queued' instance is stuck (dispatch lost)", async () => {
    // A 'queued' row past the staleness window means its QStash dispatch was dropped.
    // Re-opening the form as the client must self-heal by re-triggering generation —
    // otherwise the instance is stuck forever and the client sees a frozen spinner.
    mockFindFormDefinitionById.mockResolvedValue(QN_DEF);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(
      dynamicState("queued", { autoTrigger: true, stuckQueued: true, prereqsOk: true }),
    );

    await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    expect(mockStartQuestionnaireGeneration).toHaveBeenCalledWith(
      clientActor,
      { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null },
    );
  });

  it("does NOT re-kick generation for a healthy (recent) 'queued' instance", async () => {
    // A fresh queued row is dispatched and about to run; re-triggering would be noise.
    mockFindFormDefinitionById.mockResolvedValue(QN_DEF);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(
      dynamicState("queued", { autoTrigger: true, stuckQueued: false, prereqsOk: true }),
    );

    await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    expect(mockStartQuestionnaireGeneration).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Service: staffUpdateFormAnswers (Henry 2026-07-08 — Diana/admin edit in review)
// ---------------------------------------------------------------------------

describe("staffUpdateFormAnswers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined); // formEdit granted
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestions.mockResolvedValue([]);
    mockListQuestionGroups.mockResolvedValue([]);
  });

  it("is gated by the formEdit permission (not cases:edit)", async () => {
    mockFindFormResponse.mockResolvedValue(approvedResponse);
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { q1: "x" } });

    await staffUpdateFormAnswers(staffActor, {
      caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "x" },
    });

    expect(mockCan).toHaveBeenCalledWith(staffActor, "formEdit", "edit");
  });

  it("edits a SUBMITTED response (no FORM_NOT_SUBMITTABLE) and leaves the status unchanged", async () => {
    mockFindFormResponse.mockResolvedValue(submittedResponse);
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: { q1: "corrected" } });

    const result = await staffUpdateFormAnswers(staffActor, {
      caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "corrected" },
    });

    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "corrected" });
    expect(result.status).toBe("submitted"); // status is NEVER changed here
    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });

  it("writes a PII-safe audit entry (case.form_response.updated) — question ids, never values (RF-TRX-023 / RNF-020)", async () => {
    mockFindFormResponse.mockResolvedValue(submittedResponse);
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: { q1: "123-45-6789" } });

    await staffUpdateFormAnswers(staffActor, {
      caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "123-45-6789" },
    });

    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "case.form_response.updated",
      "case_form_responses",
      RESPONSE_ID,
      expect.objectContaining({
        after: expect.objectContaining({
          caseId: CASE_ID,
          formDefinitionId: FORM_DEF_ID,
          status: "submitted",
          changedQuestionIds: ["q1"],
        }),
      }),
    );
    // PII guard: the audit payload must NOT carry the answer value anywhere.
    expect(JSON.stringify(mockWriteAudit.mock.calls)).not.toContain("123-45-6789");
  });

  it("edits an APPROVED response (stays approved)", async () => {
    mockFindFormResponse.mockResolvedValue(approvedResponse);
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { q1: "fix" } });

    const result = await staffUpdateFormAnswers(staffActor, {
      caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "fix" },
    });

    expect(mockMergeFormAnswers).toHaveBeenCalledWith(RESPONSE_ID, { q1: "fix" });
    expect(result.status).toBe("approved");
  });

  it("rejects when the actor lacks the formEdit permission — no mutation", async () => {
    mockCan.mockImplementation(() => { throw new Error("forbidden_module"); });
    mockFindFormResponse.mockResolvedValue(approvedResponse);

    await expect(
      staffUpdateFormAnswers(staffActor, {
        caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "x" },
      }),
    ).rejects.toThrow("forbidden_module");

    expect(mockMergeFormAnswers).not.toHaveBeenCalled();
  });

  it("blocks cross-tenant edit (requireCaseAccess rejects → no mutation)", async () => {
    mockFindFormResponse.mockResolvedValue(approvedResponse);
    mockRequireCaseAccess.mockRejectedValue(new Error("forbidden_case"));

    await expect(
      staffUpdateFormAnswers(staffActor, {
        caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null, patch: { q1: "x" },
      }),
    ).rejects.toThrow("forbidden_case");

    expect(mockMergeFormAnswers).not.toHaveBeenCalled();
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

  it("resolves required PROFILE fields (absent from answers) before validating — regression", async () => {
    // A required question sourced from 'profile' is filled at render/PDF time, so its
    // value is NOT in answers. Submit must resolve it (resolveBySource) — else the
    // client could never submit a form whose name/phone come from their profile.
    mockFindFormResponse.mockResolvedValue(draftResponse); // answers do not include qEmail
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qEmail", field_type: "text", is_required: true, options: null, validation: null, source: "profile", source_ref: { profile_field: "email" } },
    ]);
    mockFindCasePrimaryClient.mockResolvedValue("client-1");
    mockFindUserContactFields.mockResolvedValue({ email: "carlos@example.com", phone_e164: null });
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    const result = await submitFormResponse(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });
    expect(result.status).toBe("submitted");
  });

  it("still fails when a required PROFILE field resolves empty (no false-positive)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qEmail", field_type: "text", is_required: true, options: null, validation: null, source: "profile", source_ref: { profile_field: "email" } },
    ]);
    mockFindCasePrimaryClient.mockResolvedValue("client-1");
    mockFindUserContactFields.mockResolvedValue({ email: null, phone_e164: null }); // unresolved

    await expect(
      submitFormResponse(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null }),
    ).rejects.toThrow("FORM_VALIDATION_FAILED");
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

  // --- Completeness gate (RF-VAN-043: approved ⇒ complete) ------------------

  const REQ_QID = "eeeeeeee-eeee-4eee-8eee-000000000101";
  const AI_CTRL_QID = "eeeeeeee-eeee-4eee-8eee-000000000102";
  const DEP_QID = "eeeeeeee-eeee-4eee-8eee-000000000103";

  it("throws FORM_INCOMPLETE (with the missing list) when a required question is unanswered", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "g1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: REQ_QID, field_type: "text", is_required: true, options: null, validation: null,
        source: "client_answer", source_ref: null, condition: null,
        question_i18n: { es: "Nombre completo", en: "Full name" },
      },
    ]);

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toMatchObject({
      code: "FORM_INCOMPLETE",
      details: expect.objectContaining({
        count: 1,
        missing: [expect.objectContaining({ questionId: REQ_QID, label: "Nombre completo" })],
      }),
    });
    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });

  it("approves when the only required question resolves via a catalog default_value", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "g1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: REQ_QID, field_type: "text", is_required: true, options: null, validation: null,
        source: "client_answer", source_ref: { default_value: "Not Detained" }, condition: null,
        question_i18n: { es: "¿Detenido?", en: "Detained?" },
      },
    ]);

    await approveFormResponse(staffActor, { responseId: RESPONSE_ID });

    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "approved" }),
    );
  });

  it("fail-closed: a still-pending ai_field that CONTROLS a condition blocks the approve", async () => {
    // The dependent required question is HIDDEN while its ai_field controller is
    // unresolved — without the fail-closed rule the form would approve as
    // "complete" with an unknown conditional branch.
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "g1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: AI_CTRL_QID, field_type: "select", is_required: false,
        options: [{ value: "si" }, { value: "no" }], validation: null,
        source: "ai_field",
        source_ref: { connected: { kind: "document", slug: "decision-juez" }, instruction: "¿Es X?" },
        condition: null,
        question_i18n: { es: "¿Decisión oral?", en: "Oral decision?" },
      },
      {
        id: DEP_QID, field_type: "date", is_required: true, options: null, validation: null,
        source: "client_answer", source_ref: null,
        condition: { when: { question: AI_CTRL_QID, op: "equals", value: "si" }, action: "show" },
        question_i18n: { es: "Fecha de la decisión oral", en: "Oral decision date" },
      },
    ]);
    const repo = await import("@/backend/modules/cases/repository");
    vi.mocked(repo.findAiFieldCacheRows).mockResolvedValue([]); // still warming

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toMatchObject({
      code: "FORM_INCOMPLETE",
      details: expect.objectContaining({
        missing: [expect.objectContaining({ questionId: AI_CTRL_QID })],
      }),
    });
    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });

  it("approves once the controlling ai_field is cached and the condition turns the dependent off", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "g1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: AI_CTRL_QID, field_type: "select", is_required: false,
        options: [{ value: "si" }, { value: "no" }], validation: null,
        source: "ai_field",
        source_ref: { connected: { kind: "document", slug: "decision-juez" }, instruction: "¿Es X?" },
        condition: null,
        question_i18n: { es: "¿Decisión oral?", en: "Oral decision?" },
      },
      {
        id: DEP_QID, field_type: "date", is_required: true, options: null, validation: null,
        source: "client_answer", source_ref: null,
        condition: { when: { question: AI_CTRL_QID, op: "equals", value: "si" }, action: "show" },
        question_i18n: { es: "Fecha de la decisión oral", en: "Oral decision date" },
      },
    ]);
    const repo = await import("@/backend/modules/cases/repository");
    vi.mocked(repo.findAiFieldCacheRows).mockResolvedValue([
      { question_id: AI_CTRL_QID, input_fingerprint: "fp", value: "no" },
    ]);

    await approveFormResponse(staffActor, { responseId: RESPONSE_ID });

    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "approved" }),
    );
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

  // --- I-589 hardening (0065): do-not-fill, multiselect, sibling-off, targeted N/A ---

  it("leaves a do_not_fill group ENTIRELY blank — no value, no N/A backfill", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { qSig: "Karelis" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      detected_fields: [{ pdf_field_name: "SignName", field_type: "text", page: 10 }],
    });
    mockListQuestionGroups.mockResolvedValue([{ id: "grpF", do_not_fill: true }]);
    mockListQuestions.mockResolvedValue([
      { id: "qSig", source: "client_answer", source_ref: null, pdf_field_name: "SignName", is_required: false, field_type: "text" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    // Even with an answer present, a do-not-fill section stays blank (no value, no "N/A").
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, {});
  });

  it("multiselect ticks every chosen box and explicitly turns the rest OFF", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { qBasis: ["race", "religion"] } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grpB" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "qBasis", source: "client_answer", source_ref: null, pdf_field_name: null,
        is_required: true, field_type: "multiselect", validation: { minSelected: 1 },
        options: [
          { value: "race", pdf_field_name: "Race" },
          { value: "religion", pdf_field_name: "Religion" },
          { value: "nationality", pdf_field_name: "Nationality" },
        ],
      },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { Race: true, Religion: true, Nationality: false });
  });

  it("blocks generation when a min-selected multiselect is empty (asylum basis rule)", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grpB" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "qBasis", source: "client_answer", source_ref: null, pdf_field_name: null,
        is_required: false, field_type: "multiselect", validation: { minSelected: 1 },
        options: [{ value: "race", pdf_field_name: "Race" }],
      },
    ]);

    await expect(
      generateFilledPdf(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_PDF_REQUIRED_MISSING");
  });

  it("a Yes/No select ticks the chosen box and clears the other — never both marked", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { qMarried: "no" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "qMarried", source: "client_answer", source_ref: null, pdf_field_name: null,
        is_required: true, field_type: "select",
        options: [
          { value: "si", pdf_field_name: "MarriedYes" },
          { value: "no", pdf_field_name: "MarriedNo" },
        ],
      },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { MarriedYes: false, MarriedNo: true });
  });

  it("a condition sees its controlling select resolved by default_value (EOIR-26 item-5 date regression)", async () => {
    // The item-5 selector is client_answer with default_value "merits" — the client
    // never typed it, so `answers` is empty. Its dependent date (condition equals
    // "merits") must STILL fill: the checkbox and its date come from the same
    // effective resolution, or the PDF ships a marked box with a blank date.
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "qDecision", source: "client_answer", source_ref: { default_value: "merits" },
        pdf_field_name: null, is_required: true, field_type: "select",
        options: [
          { value: "merits", pdf_field_name: "Box5.1" },
          { value: "bond", pdf_field_name: "Box5.2" },
        ],
      },
      {
        id: "qDate", source: "document_extraction",
        source_ref: { document_slug: "decision", json_path: "decision_date" },
        pdf_field_name: "Date5.1", is_required: false, field_type: "date",
        condition: { when: { question: "qDecision", op: "equals", value: "merits" }, action: "show" },
      },
    ]);
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({ id: DOC_ID, storage_path: "case/x/decision.pdf" });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "completed",
      payload: { decision_date: "2026-06-30" },
    });

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    const fill = mockFillAcroForm.mock.calls[0][2] as Record<string, unknown>;
    expect(fill["Box5.1"]).toBe(true);
    expect(fill["Date5.1"]).toBe("06/30/2026");
  });

  it("back-fills N/A only on visible empty free-text — never dates, never hidden fields", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      detected_fields: [
        { pdf_field_name: "Occupation", field_type: "text", page: 3 },
        { pdf_field_name: "SignDate", field_type: "text", page: 3 },
        { pdf_field_name: "SpouseName", field_type: "text", page: 2 },
      ],
    });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qOcc", source: "client_answer", source_ref: null, pdf_field_name: "Occupation", is_required: false, field_type: "text" },
      { id: "qDate", source: "client_answer", source_ref: null, pdf_field_name: "SignDate", is_required: false, field_type: "date" },
      {
        id: "qSpouse", source: "client_answer", source_ref: null, pdf_field_name: "SpouseName",
        is_required: false, field_type: "text",
        condition: { when: { question: "qMarried", op: "equals", value: "si" }, action: "show" },
      },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    // Only the visible, empty free-text field is offered for "N/A". The date field
    // and the condition-hidden spouse field are NOT — they stay blank.
    const naTargets = (mockBackfillNa.mock.calls[0] as unknown as unknown[])?.[2] as Map<string, string>;
    expect([...naTargets.keys()]).toEqual(["Occupation"]);
  });

  it("uses the client's override for an editable empty-profile field (regression #6)", async () => {
    // The question is source='profile' but the client's profile is empty, so the
    // client typed a value (it lives in answers). The fill must use the override —
    // without it, resolveBySource(profile) returns empty and required-missing throws.
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { qAddr: "1234 Main St" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qAddr", source: "profile", source_ref: { profile_field: "address.line1" }, pdf_field_name: "AddrField", is_required: true },
    ]);
    mockFindCasePrimaryClient.mockResolvedValue("client-1");
    mockFindClientProfileForForm.mockResolvedValue({ address: {} }); // profile resolves empty

    const url = await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    expect(url).toBeDefined();
  });

  it("batch-translates free-text answers ES→EN before filling, and caches the result", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { q1: "hola mundo" },
      answers_translated: {},
      translation_status: "pending_server",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "q1",
        source: "client_answer",
        source_ref: null,
        pdf_field_name: "Story",
        is_required: false,
        field_type: "textarea",
        question_i18n: { es: "Cuente su historia", en: "Tell your story" },
      },
    ]);
    mockTranslateAnswersBatch.mockResolvedValue({ q1: "hello world" });

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    // ONE batched call (not per-field), with the field label as context + proper-noun preservation.
    expect(mockTranslateAnswersBatch).toHaveBeenCalledWith({
      items: [{ id: "q1", text: "hola mundo", fieldLabel: "Cuente su historia" }],
      direction: "es-en",
      preserveProperNouns: true,
    });
    expect(mockTranslateText).not.toHaveBeenCalled();
    // Write-back cache so a regeneration re-uses the translation.
    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ answers_translated: { q1: "hello world" } }),
    );
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { Story: "hello world" });
  });

  it("re-translates fresh at generation, ignoring a STALE answers_translated cache", async () => {
    // The answer changed after it was first translated; the cache is stale. The filed PDF
    // must reflect the CURRENT answer, so generation re-translates instead of trusting it.
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { q1: "hola mundo" },
      answers_translated: { q1: "a stale translation of an old answer" },
      translation_status: "done",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", source: "client_answer", source_ref: null, pdf_field_name: "Story", is_required: false, field_type: "textarea" },
    ]);
    mockTranslateAnswersBatch.mockResolvedValue({ q1: "hello world" });

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(mockTranslateAnswersBatch).toHaveBeenCalled(); // does NOT trust the stale cache
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { Story: "hello world" });
  });

  it("keeps the answer unchanged when the batch returns no translation", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { q1: "hello world" },
      translation_status: "none",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", source: "client_answer", source_ref: null, pdf_field_name: "Story", is_required: false, field_type: "textarea" },
    ]);
    mockTranslateAnswersBatch.mockResolvedValue({}); // e.g. already-English text → nothing to change

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { Story: "hello world" });
  });

  it("never writes a leaked « placeholder — treats it as empty (N/A target)", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { q1: "«Child 1 — full name»" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      source_language: "en",
      detected_fields: [{ pdf_field_name: "ChildLast1", field_type: "text", page: 2 }],
    });
    mockTranslateAnswersBatch.mockResolvedValue({});
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", source: "client_answer", source_ref: null, pdf_field_name: "ChildLast1", is_required: false, field_type: "text" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    // The « value must NEVER reach the AcroForm; it is treated as empty → becomes an N/A target.
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, {});
    const naTargets = (mockBackfillNa.mock.calls[0] as unknown as unknown[])?.[2] as Map<string, string>;
    expect([...naTargets.keys()]).toEqual(["ChildLast1"]);
  });

  it("writes an A-Number VERBATIM — never sends it to the translator (no PII mask on the PDF)", async () => {
    // The exact Karelis bug: a text A-Number the client typed. It must reach the AcroForm
    // as "A123456789", NOT the masked "A-•••-•••" the translator (maskPii) would return.
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { qA: "A123456789" },
      translation_status: "none",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qA", source: "client_answer", source_ref: null, pdf_field_name: "ANumber", is_required: false, field_type: "text" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    // A structured value is excluded from the batch entirely (here it was the only field).
    expect(mockTranslateAnswersBatch).not.toHaveBeenCalled();
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { ANumber: "A123456789" });
  });

  it("honours no_translate — a proper noun is written literally, only the narrative is translated", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { qName: "María González", qStory: "hola mundo" },
      translation_status: "none",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qName", source: "client_answer", source_ref: null, pdf_field_name: "Name", is_required: false, field_type: "text", no_translate: true },
      { id: "qStory", source: "client_answer", source_ref: null, pdf_field_name: "Story", is_required: false, field_type: "textarea" },
    ]);
    mockTranslateAnswersBatch.mockResolvedValue({ qStory: "hello world" });

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    // The no_translate field is NOT in the batch; only the narrative is.
    const batchArg = mockTranslateAnswersBatch.mock.calls[0][0] as { items: Array<{ id: string }> };
    expect(batchArg.items.map((i) => i.id)).toEqual(["qStory"]);
    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { Name: "María González", Story: "hello world" });
  });

  it("empty policy `na` (version default) fills an empty DATE with N/A (legacy `auto` skipped dates)", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      source_language: "en",
      default_empty_policy: "na",
      detected_fields: [
        { pdf_field_name: "Occupation", field_type: "text", page: 3 },
        { pdf_field_name: "DOB", field_type: "text", page: 3 },
      ],
    });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qOcc", source: "client_answer", source_ref: null, pdf_field_name: "Occupation", is_required: false, field_type: "text" },
      { id: "qDob", source: "client_answer", source_ref: null, pdf_field_name: "DOB", is_required: false, field_type: "date" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    const naTargets = (mockBackfillNa.mock.calls[0] as unknown as unknown[])?.[2] as Map<string, string>;
    expect(naTargets.get("Occupation")).toBe("N/A");
    expect(naTargets.get("DOB")).toBe("N/A");
  });

  it("empty policy `blank` (version default) leaves empty free-text blank", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      default_empty_policy: "blank",
      detected_fields: [{ pdf_field_name: "Occupation", field_type: "text", page: 3 }],
    });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "qOcc", source: "client_answer", source_ref: null, pdf_field_name: "Occupation", is_required: false, field_type: "text" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    const naTargets = (mockBackfillNa.mock.calls[0] as unknown as unknown[])?.[2] as Map<string, string>;
    expect(naTargets.size).toBe(0);
  });

  it("per-field `custom` empty policy overrides the version default with its own placeholder", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: {} });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({
      ...publishedVersion,
      default_empty_policy: "blank", // version-wide: blank...
      detected_fields: [{ pdf_field_name: "Occupation", field_type: "text", page: 3 }],
    });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      // ...but this field forces a custom "None"
      { id: "qOcc", source: "client_answer", source_ref: null, pdf_field_name: "Occupation", is_required: false, field_type: "text", empty_policy: "custom", empty_placeholder: "None" },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });
    const naTargets = (mockBackfillNa.mock.calls[0] as unknown as unknown[])?.[2] as Map<string, string>;
    expect(naTargets.get("Occupation")).toBe("None");
  });

  it("formats a full-date answer as MM/DD/YYYY for the official PDF", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { q1: "1985-06-15" },
      translation_status: "none",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "q1",
        source: "client_answer",
        source_ref: null,
        pdf_field_name: "DOB",
        is_required: false,
        field_type: "date",
        question_i18n: { es: "¿Cuál es su fecha de nacimiento?" },
      },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { DOB: "06/15/1985" });
  });

  it("formats a month/year date answer as MM/YYYY (Mo/Yr field)", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...approvedResponse,
      answers: { q1: "2018-01-01" },
      translation_status: "none",
    });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue({ ...publishedVersion, source_language: "en" });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "q1",
        source: "client_answer",
        source_ref: null,
        pdf_field_name: "FromDate",
        is_required: false,
        field_type: "date",
        question_i18n: { es: "Residencia 1 — desde (mes/año)" },
      },
    ]);

    await generateFilledPdf(staffActor, { responseId: RESPONSE_ID });

    expect(mockFillAcroForm).toHaveBeenCalledWith(expect.anything(), {}, { FromDate: "01/2018" });
  });
});

// ---------------------------------------------------------------------------
// Service: resolveFormResponseFieldValues (Pre-Mortem validator input)
// Shares resolveFormResponseFieldsCore with generateFilledPdf → structured view
// of exactly what would be filed. Unlike generateFilledPdf it must NOT require a
// fileable status (validates drafts) nor throw on missing required.
// ---------------------------------------------------------------------------

describe("resolveFormResponseFieldValues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestionGroups.mockResolvedValue([]);
    mockListQuestions.mockResolvedValue([]);
  });

  it("blocks cross-tenant reads (requireCaseAccess rejects → no PII leak)", async () => {
    mockFindFormResponseById.mockResolvedValue(approvedResponse);
    mockRequireCaseAccess.mockRejectedValue(new Error("forbidden_case"));

    await expect(
      resolveFormResponseFieldValues(staffActor, RESPONSE_ID),
    ).rejects.toThrow("forbidden_case");
    expect(mockFindFormDefinitionById).not.toHaveBeenCalled();
  });

  it("validates a DRAFT response (no fileable status gate) and reports structured fields + missingRequired", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...draftResponse, answers: { qName: "Karelis" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grpA" }, { id: "grpSig", do_not_fill: true }]);
    mockListQuestions.mockImplementation(async (groupId: string) =>
      groupId === "grpA"
        ? [
            { id: "qName", source: "client_answer", source_ref: null, pdf_field_name: "FirstName", is_required: true, field_type: "text" },
            { id: "qMiss", source: "client_answer", source_ref: null, pdf_field_name: "LastName", is_required: true, field_type: "text" },
          ]
        : [{ id: "qSig", source: "client_answer", source_ref: null, pdf_field_name: "SignName", is_required: false, field_type: "text" }],
    );

    // Would throw FORM_PDF_BLOCKED via generateFilledPdf; the validator resolves it.
    const res = await resolveFormResponseFieldValues(staffActor, RESPONSE_ID);

    const byId = Object.fromEntries(res.fields.map((f) => [f.questionId, f]));
    expect(byId.qName).toMatchObject({ pdfFieldName: "FirstName", value: "Karelis", empty: false, doNotFill: false });
    expect(byId.qMiss).toMatchObject({ pdfFieldName: "LastName", value: null, empty: true, required: true });
    expect(byId.qSig).toMatchObject({ doNotFill: true, value: null });
    // A required field with no value is reported (not thrown).
    expect(res.missingRequired).toContain("LastName");
    expect(res.versionId).toBe(publishedVersion.id);
  });

  it("shows the ENGLISH label of a Yes/No select (not the internal 'si' code) so the validator doesn't misflag it", async () => {
    // The client picked "si" on a Yes/No select whose options carry English labels.
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, answers: { qMarried: "si" } });
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockListQuestionGroups.mockResolvedValue([{ id: "grpA" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "qMarried",
        source: "client_answer",
        source_ref: null,
        pdf_field_name: null,
        is_required: false,
        field_type: "select",
        options: [
          { value: "si", label_i18n: { en: "Yes", es: "Sí" }, pdf_field_name: "MarriedYes" },
          { value: "no", label_i18n: { en: "No", es: "No" }, pdf_field_name: "MarriedNo" },
        ],
      },
    ]);

    const res = await resolveFormResponseFieldValues(staffActor, RESPONSE_ID);
    const qMarried = res.fields.find((f) => f.questionId === "qMarried");
    // The structured value the validator sees is the English label — what reads on the form.
    expect(qMarried?.value).toBe("Yes");
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
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({
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
    mockFindLatestActiveDocumentBySlug.mockResolvedValue(null);

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
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({ id: DOC_ID, storage_path: "x" });
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
      outputStructured: { letter_body: "Dear USCIS...", header: { date: "2026-06-14" } },
      outputText: null,
      outputPath: null,
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

  it("splits a profile phone into area code / local number via the format transform", async () => {
    mockFindCasePrimaryClient.mockResolvedValue("client-1");
    mockFindUserContactFields.mockResolvedValue({ email: null, phone_e164: "+13055551234" });

    const area = await resolveBySource(
      { id: "qArea", source: "profile", source_ref: { profile_field: "phone_e164", format: "us_area_code" } },
      {}, CASE_ID, null,
    );
    const number = await resolveBySource(
      { id: "qNum", source: "profile", source_ref: { profile_field: "phone_e164", format: "us_local_number" } },
      {}, CASE_ID, null,
    );
    expect(area).toBe("305");
    expect(number).toBe("555-1234");
  });

  // --- ai_field (Etapa B) ---
  it("resolves ai_field (document) by INTERPRETING the uploaded file via Gemini", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    });
    mockInterpretDocumentFields.mockResolvedValue({ q1: "Relato resumido de la persecución." });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: {
          connected: { kind: "document", slug: "declaracion-jurada" },
          instruction: "Resume el relato de persecución.",
        },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("Relato resumido de la persecución.");
    expect(mockInterpretDocumentFields).toHaveBeenCalledOnce();
    expect(mockSynthesizeLetterFields).not.toHaveBeenCalled();
  });

  it("resolves ai_field (ai_letter) by SYNTHESIZING from the generated letter via Anthropic", async () => {
    mockFindCompletedGenerationByFormSlug.mockResolvedValue({
      outputStructured: null,
      outputText: "## Memorándum de Miedo Creíble\n\nEl solicitante...",
      outputPath: null,
    });
    mockSynthesizeLetterFields.mockResolvedValue({ q1: "Narrativa de la Parte B." });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: {
          connected: { kind: "ai_letter", slug: "memorandum-de-miedo-creible" },
          instruction: "Redacta la narrativa de la Parte B.",
        },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBe("Narrativa de la Parte B.");
    expect(mockSynthesizeLetterFields).toHaveBeenCalledOnce();
  });

  it("returns null for ai_field with an incomplete source_ref (no AI call)", async () => {
    const result = await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: { connected: { kind: "document", slug: "" }, instruction: "x" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(result).toBeNull();
    expect(mockInterpretDocumentFields).not.toHaveBeenCalled();
  });

  // --- ai_field multi-documento (ola Apelación: el #6 del EOIR-26 lee decisión + asilo + evidencias) ---
  it("attaches connected.context_slugs documents as context files for the interpreter", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    });
    mockDownloadAllDocumentBytesBySlug.mockImplementation(async (_caseId: string, slug: string) =>
      slug === "asilo-presentado-completo-con-anexos"
        ? [{ bytes: new Uint8Array([4]), mimeType: "application/pdf", label: "Asilo completo.pdf" }]
        : [
            { bytes: new Uint8Array([5]), mimeType: "application/pdf", label: "Evidencia 1.pdf" },
            { bytes: new Uint8Array([6]), mimeType: "application/pdf", label: "Evidencia 2.pdf" },
          ],
    );
    mockInterpretDocumentFields.mockResolvedValue({ q1: "Razones fundamentadas en el expediente." });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: {
          connected: {
            kind: "document",
            slug: "decision-y-orden-del-juez-de-inmigracion",
            context_slugs: ["asilo-presentado-completo-con-anexos", "evidencias-sustentatorias"],
          },
          instruction: "Redacta las razones de la apelación.",
        },
      },
      {},
      CASE_ID,
      null,
    );

    expect(result).toBe("Razones fundamentadas en el expediente.");
    const call = mockInterpretDocumentFields.mock.calls[0][0] as {
      fileBase64: string;
      contextFiles?: Array<{ fileBase64: string; mimeType: string; label?: string }>;
    };
    expect(call.fileBase64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(call.contextFiles).toHaveLength(3);
    expect(call.contextFiles![0].label).toBe("Asilo completo.pdf");
    expect(call.contextFiles![1].label).toBe("Evidencia 1.pdf");
    expect(call.contextFiles![2].label).toBe("Evidencia 2.pdf");
  });

  it("keeps the single-document ai_field call shape when no context_slugs (regression)", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "application/pdf",
    });
    mockInterpretDocumentFields.mockResolvedValue({ q1: "ok" });

    await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: {
          connected: { kind: "document", slug: "declaracion-jurada" },
          instruction: "Resume.",
        },
      },
      {},
      CASE_ID,
      null,
    );

    expect(mockDownloadAllDocumentBytesBySlug).not.toHaveBeenCalled();
    const call = mockInterpretDocumentFields.mock.calls[0][0] as { contextFiles?: unknown };
    expect(call.contextFiles).toBeUndefined();
  });

  it("resolves best-effort when the context documents are missing (no context files)", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    mockDownloadAllDocumentBytesBySlug.mockResolvedValue([]);
    mockInterpretDocumentFields.mockResolvedValue({ q1: "solo primario" });

    const result = await resolveBySource(
      {
        id: "q1",
        source: "ai_field",
        source_ref: {
          connected: { kind: "document", slug: "decision-y-orden-del-juez-de-inmigracion", context_slugs: ["evidencias-sustentatorias"] },
          instruction: "Redacta.",
        },
      },
      {},
      CASE_ID,
      null,
    );

    expect(result).toBe("solo primario");
    const call = mockInterpretDocumentFields.mock.calls[0][0] as { contextFiles?: unknown[] };
    expect(call.contextFiles ?? []).toHaveLength(0);
  });

  it("threads the shared inline budget (minus the primary) across context slugs", async () => {
    // The mocked repository exposes a tiny budget (100 bytes) so the math is visible:
    // primary=3 → first slug sees 97; its 4-byte file → second slug sees 93.
    mockDownloadDocumentBytesBySlug.mockResolvedValue({ bytes: new Uint8Array(3), mimeType: "application/pdf" });
    mockDownloadAllDocumentBytesBySlug
      .mockResolvedValueOnce([{ bytes: new Uint8Array(4), mimeType: "application/pdf", label: "A.pdf" }])
      .mockResolvedValueOnce([]);
    mockInterpretDocumentFields.mockResolvedValue({});

    await resolveAiFields(CASE_ID, null, [
      {
        id: "q1",
        connected: {
          kind: "document",
          slug: "decision-y-orden-del-juez-de-inmigracion",
          context_slugs: ["asilo-presentado-completo-con-anexos", "evidencias-sustentatorias"],
        },
        instruction: "x",
      },
    ]);

    expect(mockDownloadAllDocumentBytesBySlug).toHaveBeenNthCalledWith(
      1, CASE_ID, "asilo-presentado-completo-con-anexos", null, { maxTotalBytes: 97 },
    );
    expect(mockDownloadAllDocumentBytesBySlug).toHaveBeenNthCalledWith(
      2, CASE_ID, "evidencias-sustentatorias", null, { maxTotalBytes: 93 },
    );
  });

  it("skips the context downloads when the primary alone exceeds the shared budget", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({ bytes: new Uint8Array(101), mimeType: "application/pdf" });
    mockInterpretDocumentFields.mockResolvedValue({ q1: "ok" });

    const out = await resolveAiFields(CASE_ID, null, [
      {
        id: "q1",
        connected: { kind: "document", slug: "decision-y-orden-del-juez-de-inmigracion", context_slugs: ["evidencias-sustentatorias"] },
        instruction: "x",
      },
    ]);

    expect(mockDownloadAllDocumentBytesBySlug).not.toHaveBeenCalled();
    const call = mockInterpretDocumentFields.mock.calls[0][0] as { contextFiles?: unknown };
    expect(call.contextFiles).toBeUndefined();
    expect(out).toEqual({ q1: "ok" });
  });

  it("groups ai_fields by context set so different contexts get separate interpreter calls", async () => {
    mockDownloadDocumentBytesBySlug.mockResolvedValue({
      bytes: new Uint8Array([1]),
      mimeType: "application/pdf",
    });
    mockDownloadAllDocumentBytesBySlug.mockResolvedValue([
      { bytes: new Uint8Array([2]), mimeType: "application/pdf", label: "Asilo.pdf" },
    ]);
    mockInterpretDocumentFields.mockResolvedValue({});

    await resolveAiFields(CASE_ID, null, [
      {
        id: "q1",
        connected: { kind: "document", slug: "decision-y-orden-del-juez-de-inmigracion" },
        instruction: "a",
      },
      {
        id: "q2",
        connected: {
          kind: "document",
          slug: "decision-y-orden-del-juez-de-inmigracion",
          context_slugs: ["asilo-presentado-completo-con-anexos"],
        },
        instruction: "b",
      },
    ]);

    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(2);
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

  it("memoizes the profile + primary client across a shared cache (no N+1)", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    mockFindClientProfileForForm.mockResolvedValue({
      first_name: "Maria",
      last_name: "Garcia",
      preferred_name: null,
      country_of_origin: "MX",
      address: {},
      pii_encrypted: {},
    });

    // Two profile-sourced questions in the same form load share one cache.
    const cache = {};
    const [a, b] = await Promise.all([
      resolveBySource({ id: "q1", source: "profile", source_ref: { profile_field: "first_name" } }, {}, CASE_ID, null, cache),
      resolveBySource({ id: "q2", source: "profile", source_ref: { profile_field: "last_name" } }, {}, CASE_ID, null, cache),
    ]);

    expect(a).toBe("Maria");
    expect(b).toBe("Garcia");
    // Fetched exactly once each — not once per prefilled question.
    expect(mockFindCasePrimaryClient).toHaveBeenCalledTimes(1);
    expect(mockFindClientProfileForForm).toHaveBeenCalledTimes(1);
  });

  it("does NOT memoize a rejected profile load — a later question retries (no poisoned cache)", async () => {
    mockFindCasePrimaryClient.mockResolvedValue(CLIENT_ID);
    // A transient failure on the first load must not blank out every other
    // profile-sourced field on the form: the second question retries and succeeds.
    mockFindClientProfileForForm
      .mockRejectedValueOnce(new Error("transient db error"))
      .mockResolvedValueOnce({
        first_name: "Maria",
        last_name: "Garcia",
        preferred_name: null,
        country_of_origin: "MX",
        address: {},
        pii_encrypted: {},
      });

    const cache = {};
    await expect(
      resolveBySource({ id: "q1", source: "profile", source_ref: { profile_field: "first_name" } }, {}, CASE_ID, null, cache),
    ).rejects.toThrow("transient db error");

    // SAME cache: the rejected promise was evicted, so this retries instead of
    // reusing the cached rejection.
    const b = await resolveBySource(
      { id: "q2", source: "profile", source_ref: { profile_field: "last_name" } },
      {},
      CASE_ID,
      null,
      cache,
    );
    expect(b).toBe("Garcia");
    expect(mockFindClientProfileForForm).toHaveBeenCalledTimes(2);
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

// ---------------------------------------------------------------------------
// Ola apelación — value_map / default_value en source_ref (prefill de selects)
// ---------------------------------------------------------------------------

describe("resolveBySource — value_map / default_value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindLatestActiveDocumentBySlug.mockResolvedValue({ id: "doc-1" });
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "completed",
      payload: { is_oral_decision: true, decision_outcome: "denied" },
    });
  });

  it("maps an extracted boolean through value_map to an option value", async () => {
    const value = await resolveBySource(
      {
        id: "q-tipo",
        source: "document_extraction",
        source_ref: {
          document_slug: "decision",
          json_path: "is_oral_decision",
          value_map: { true: "oral", false: "written" },
        },
      },
      {},
      CASE_ID,
      null,
    );
    expect(value).toBe("oral");
  });

  it("value_map miss falls back to default_value (never leaks a raw non-option value)", async () => {
    mockFindDocumentExtractionByCaseDocId.mockResolvedValue({
      status: "completed",
      payload: { is_oral_decision: "quién sabe" },
    });
    const value = await resolveBySource(
      {
        id: "q-tipo",
        source: "document_extraction",
        source_ref: {
          document_slug: "decision",
          json_path: "is_oral_decision",
          value_map: { true: "oral", false: "written" },
          default_value: "oral",
        },
      },
      {},
      CASE_ID,
      null,
    );
    expect(value).toBe("oral");
  });

  it("document_extraction default_value applies when the document is missing", async () => {
    mockFindLatestActiveDocumentBySlug.mockResolvedValue(null);
    const value = await resolveBySource(
      {
        id: "q-tipo",
        source: "document_extraction",
        source_ref: { document_slug: "decision", json_path: "x", default_value: "oral" },
      },
      {},
      CASE_ID,
      null,
    );
    expect(value).toBe("oral");
  });

  it("client_answer default_value fills an unanswered question; a real answer wins", async () => {
    const ref = { id: "q-brief", source: "client_answer", source_ref: { default_value: "yes" } };
    expect(await resolveBySource(ref, {}, CASE_ID, null)).toBe("yes");
    expect(await resolveBySource(ref, { "q-brief": "no" }, CASE_ID, null)).toBe("no");
  });
});

describe("submitFormResponse — client_answer defaults satisfy required fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("submits with an untouched required select whose source_ref carries a default_value", async () => {
    mockFindFormResponse.mockResolvedValue({ ...draftResponse, answers: {} });
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "q-brief",
        field_type: "select",
        is_required: true,
        options: [{ value: "yes" }, { value: "no" }],
        validation: null,
        source: "client_answer",
        source_ref: { default_value: "yes" },
      },
    ]);
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    await expect(
      submitFormResponse(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null }),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Ola apelación — AI draft answers (autofill total del cuestionario dinámico)
// ---------------------------------------------------------------------------

describe("getFormForClient — AI draft prefill (questionnaire)", () => {
  const QN_DEF = { ...activeFormDef, kind: "questionnaire" };
  const BASE_QID = "eeeeeeee-eeee-4eee-8eee-000000000001";
  const GEN_QID = "eeeeeeee-eeee-4eee-8eee-000000000002";

  const instanceSchema = {
    groups: [
      {
        id: "gggggggg-gggg-4ggg-8ggg-000000000001",
        title_i18n: { es: "Generadas", en: "Generated" },
        position: 0,
        questions: [
          {
            id: GEN_QID,
            question_i18n: { es: "¿Qué denegó el juez?", en: "What did the judge deny?" },
            help_i18n: null,
            field_type: "textarea",
            options: null,
            is_required: true,
            position: 0,
            source: "client_answer",
            validation: null,
            condition: null,
          },
        ],
      },
    ],
  };

  function hybridState(drafts: Record<string, string> | null) {
    return {
      isDynamic: true,
      mode: "hybrid",
      hybridLayout: "append_group",
      autoTrigger: false,
      allowClientTrigger: false,
      stuckQueued: false,
      instance: { status: "ready", schema: instanceSchema, draft_answers: drafts },
      prereqs: null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormDefinitionById.mockResolvedValue(QN_DEF);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestionGroups.mockResolvedValue([
      { id: "grp-base", title_i18n: { es: "Base", en: "Base" }, position: 0 },
    ]);
    mockListQuestions.mockResolvedValue([
      {
        id: BASE_QID,
        group_id: "grp-base",
        question_i18n: { es: "¿Qué fue injusto?", en: "What was unfair?" },
        help_i18n: null,
        field_type: "textarea",
        options: null,
        is_required: true,
        position: 0,
        source: "client_answer",
        source_ref: null,
        validation: null,
        condition: null,
        ai_improve: null,
      },
    ]);
  });

  it("prefills generated AND base questions from instance draft_answers as source 'ai_draft'", async () => {
    mockFindFormResponse.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(
      hybridState({ [BASE_QID]: "Borrador base", [GEN_QID]: "Borrador generado" }),
    );

    const dto = await getFormForClient(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    const allQs = dto.groups.flatMap((g) => g.questions);
    const baseQ = allQs.find((q) => q.id === BASE_QID);
    const genQ = allQs.find((q) => q.id === GEN_QID);

    expect(baseQ?.prefillValue).toBe("Borrador base");
    expect(baseQ?.isPrefilled).toBe(true);
    expect(baseQ?.source).toBe("ai_draft");

    expect(genQ?.prefillValue).toBe("Borrador generado");
    expect(genQ?.isPrefilled).toBe(true);
    expect(genQ?.source).toBe("ai_draft");
  });

  it("a saved client answer always wins over the draft (no prefill, source intact)", async () => {
    mockFindFormResponse.mockResolvedValue({
      ...draftResponse,
      automation_version_id: VERSION_ID,
      answers: { [GEN_QID]: "Lo escribí yo" },
    });
    mockGetQuestionnaireClientState.mockResolvedValue(
      hybridState({ [GEN_QID]: "Borrador generado" }),
    );

    const dto = await getFormForClient(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    const genQ = dto.groups.flatMap((g) => g.questions).find((q) => q.id === GEN_QID);
    expect(genQ?.currentAnswer).toBe("Lo escribí yo");
    expect(genQ?.isPrefilled).toBe(false);
    expect(genQ?.source).toBe("client_answer");
  });

  it("no drafts → questionnaire renders exactly as before (regression)", async () => {
    mockFindFormResponse.mockResolvedValue(null);
    mockGetQuestionnaireClientState.mockResolvedValue(hybridState(null));

    const dto = await getFormForClient(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    const allQs = dto.groups.flatMap((g) => g.questions);
    for (const q of allQs) {
      expect(q.isPrefilled).toBe(false);
      expect(q.prefillValue).toBeNull();
    }
  });
});

describe("submitFormResponse — materializes untouched AI drafts with provenance", () => {
  const INSTANCE_ID = "ffffffff-ffff-4fff-8fff-000000000010";
  const BASE_QID = "eeeeeeee-eeee-4eee-8eee-000000000001";
  const GEN_QID = "eeeeeeee-eeee-4eee-8eee-000000000002";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockListQuestionGroups.mockResolvedValue([]);
    mockListQuestions.mockResolvedValue([]);
  });

  it("fills unanswered questions via the ATOMIC fill-if-empty RPC and records provenance", async () => {
    mockFindFormResponse.mockResolvedValue({
      ...draftResponse,
      automation_version_id: null,
      questionnaire_instance_id: INSTANCE_ID,
      answers: { [BASE_QID]: "Editado por el cliente" },
    });
    mockGetQuestionnaireInstanceDrafts.mockResolvedValue({
      [BASE_QID]: "Borrador base",
      [GEN_QID]: "Borrador generado",
    });
    mockMergeFormAnswersIfEmpty.mockResolvedValue({
      [BASE_QID]: "Editado por el cliente",
      [GEN_QID]: "Borrador generado",
    });
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    expect(mockGetQuestionnaireInstanceDrafts).toHaveBeenCalledWith(INSTANCE_ID);
    // Only the EMPTY question goes to the RPC (the client-edited one is excluded)
    expect(mockMergeFormAnswersIfEmpty).toHaveBeenCalledWith(RESPONSE_ID, {
      [GEN_QID]: "Borrador generado",
    });
    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ ai_draft_question_ids: [GEN_QID] }),
    );
    // PII-safe audit: ids only, never values
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(),
      "case.form_response.ai_drafts_materialized",
      "case_form_responses",
      RESPONSE_ID,
      expect.anything(),
    );
    const auditCall = mockWriteAudit.mock.calls.at(-1);
    expect(JSON.stringify(auditCall)).not.toContain("Borrador generado");
  });

  it("a concurrent client autosave wins: the RPC result excludes the draft → no provenance for it", async () => {
    mockFindFormResponse.mockResolvedValue({
      ...draftResponse,
      automation_version_id: null,
      questionnaire_instance_id: INSTANCE_ID,
      answers: {},
    });
    mockGetQuestionnaireInstanceDrafts.mockResolvedValue({ [GEN_QID]: "Borrador generado" });
    // The RPC saw a client answer land first → kept it (fill-if-empty semantics)
    mockMergeFormAnswersIfEmpty.mockResolvedValue({ [GEN_QID]: "Lo escribió el cliente a última hora" });
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    const provenanceCall = mockUpdateFormResponse.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.ai_draft_question_ids !== undefined,
    );
    expect(provenanceCall).toBeUndefined();
  });

  it("skips materialization entirely when the client answered everything", async () => {
    mockFindFormResponse.mockResolvedValue({
      ...draftResponse,
      automation_version_id: null,
      questionnaire_instance_id: INSTANCE_ID,
      answers: { [BASE_QID]: "a", [GEN_QID]: "b" },
    });
    mockGetQuestionnaireInstanceDrafts.mockResolvedValue({
      [BASE_QID]: "Borrador base",
      [GEN_QID]: "Borrador generado",
    });
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    const materializeCall = mockUpdateFormResponse.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)?.ai_draft_question_ids !== undefined,
    );
    expect(materializeCall).toBeUndefined();
  });

  it("keeps the submit intact for a non-questionnaire response (no instance pin)", async () => {
    mockFindFormResponse.mockResolvedValue(draftResponse);
    mockListQuestionGroups.mockResolvedValue([{ id: "grp1" }]);
    mockListQuestions.mockResolvedValue([
      { id: "q1", field_type: "text", is_required: false, options: null, validation: null },
    ]);
    mockFindFormResponseById.mockResolvedValue({ ...submittedResponse });

    await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    expect(mockGetQuestionnaireInstanceDrafts).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Ola perf — getFormForClient sirve ai_field SOLO desde caché (LLM nunca en el GET)
// ---------------------------------------------------------------------------

describe("getFormForClient — ai_field prefill is CACHE-ONLY (Ola perf)", () => {
  const AI_QID = "99999999-9999-4999-8999-000000000001";
  const aiFieldQuestion = {
    id: AI_QID,
    group_id: "g1",
    question_i18n: { es: "Motivo de la decisión", en: "Decision reason" },
    help_i18n: null,
    field_type: "textarea",
    options: null,
    is_required: false,
    position: 0,
    source: "ai_field",
    source_ref: { connected: { kind: "document", slug: "decision-juez" }, instruction: "Resume el motivo" },
    validation: null,
    condition: null,
    ai_improve: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockFindFormResponse.mockResolvedValue(null);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    mockListQuestionGroups.mockResolvedValue([{ id: "g1", title_i18n: { es: "G", en: "G" }, position: 0 }]);
    mockListQuestions.mockResolvedValue([aiFieldQuestion]);
  });

  it("cache HIT → serves the cached value without any provider call", async () => {
    const repo = await import("@/backend/modules/cases/repository");
    vi.mocked(repo.findAiFieldCacheRows).mockResolvedValue([
      { question_id: AI_QID, input_fingerprint: "fp", value: "valor cacheado" },
    ]);

    const dto = await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    const q = dto.groups[0].questions[0];
    expect(q.prefillValue).toBe("valor cacheado");
    expect(q.prefillPending).toBeUndefined();
    expect(mockInterpretDocumentFields).not.toHaveBeenCalled();
    const { enqueueJob } = await import("@/backend/platform/qstash");
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });

  it("cache MISS → prefillPending + background warm enqueued (deduped), still no provider call", async () => {
    const repo = await import("@/backend/modules/cases/repository");
    vi.mocked(repo.findAiFieldCacheRows).mockResolvedValue([]);

    const dto = await getFormForClient(clientActor, { caseId: CASE_ID, formDefinitionId: FORM_DEF_ID, partyId: null });

    const q = dto.groups[0].questions[0];
    expect(q.prefillValue).toBeNull();
    expect(q.prefillPending).toBe(true);
    expect(mockInterpretDocumentFields).not.toHaveBeenCalled();
    const { enqueueJob } = await import("@/backend/platform/qstash");
    expect(vi.mocked(enqueueJob)).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: "refresh-ai-prefill",
        caseId: CASE_ID,
        dedupeId: `ai-prefill:${CASE_ID}:case`,
      }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Autofill total — submit crea la respuesta cuando el cliente no editó nada
// ---------------------------------------------------------------------------

describe("submitFormResponse — fully-prefilled form with NO prior response (found live 2026-07-18)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindFormDefinitionById.mockResolvedValue(activeFormDef);
    mockGetPublishedAutomationVersion.mockResolvedValue(publishedVersion);
    // One catalog default-valued question: the form is fully prefilled and the
    // fail-closed "questions unresolvable" submit guard stays satisfied.
    mockListQuestionGroups.mockResolvedValue([{ id: "g1" }]);
    mockListQuestions.mockResolvedValue([
      {
        id: "eeeeeeee-eeee-4eee-8eee-000000000201",
        field_type: "text", is_required: true, options: null, validation: null,
        source: "client_answer", source_ref: { default_value: "Not Detained" }, condition: null,
        question_i18n: { es: "¿Detenido?", en: "Detained?" },
      },
    ]);
  });

  it("creates the response through the gated first-save path and submits it", async () => {
    // No existing response (the client edited nothing — everything was prefilled).
    mockFindFormResponse.mockResolvedValue(null);
    mockInsertFormResponse.mockResolvedValue({ ...draftResponse, answers: {} });
    // 1ª relectura (fin de saveFormDraftImpl) → draft; 2ª (fin del submit) → submitted.
    mockFindFormResponseById
      .mockResolvedValueOnce({ ...draftResponse, answers: {} })
      .mockResolvedValue({ ...submittedResponse });

    await submitFormResponse(clientActor, {
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      partyId: null,
    });

    // The row was created (same insert the autosave uses) and then submitted.
    expect(mockInsertFormResponse).toHaveBeenCalledWith(
      expect.objectContaining({ case_id: CASE_ID, form_definition_id: FORM_DEF_ID, status: "draft" }),
    );
    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "submitted" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Wave 1 — reopenQuestionnaireForClientInput
// ---------------------------------------------------------------------------

describe("completeness gate — fails CLOSED when the questionnaire check breaks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("blocks approve instead of certifying the form when the check throws", async () => {
    // Regression. This check used to be wrapped in a try/catch that only did
    // logger.warn(..."skipped"), so ANY error in it made the form pass as
    // complete — the gate silently dropping the very thing it exists to verify.
    // The bug hid in plain sight: when the ai-engine binding was momentarily
    // missing, 848 tests stayed green while the questionnaire was never checked.
    mockFindFormResponseById.mockResolvedValue({
      ...submittedResponse,
      questionnaire_instance_id: "33333333-3333-4333-8333-333333333333",
    });
    mockGetQuestionnaireInstanceSchemaQuestions.mockRejectedValue(new Error("ai-engine unavailable"));

    await expect(
      approveFormResponse(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_INCOMPLETE");

    expect(mockUpdateFormResponse).not.toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({ status: "approved" }),
    );
  });
});

describe("reopenQuestionnaireForClientInput", () => {
  const INSTANCE_ID_R = "22222222-2222-4222-8222-222222222222";

  /** An approved response shaped like the real case: nothing the client wrote. */
  function reopenable(answers: Record<string, unknown>, provenance: Record<string, string>) {
    return {
      ...approvedResponse,
      questionnaire_instance_id: INSTANCE_ID_R,
      answers,
      answer_provenance: provenance,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("clears fabricated answers, KEEPS the real ones, and hands the form back", async () => {
    mockFindFormResponseById.mockResolvedValue(
      reopenable(
        { good: "Testimonio real de la clienta.", filler: "Por ahora no cuento con información." },
        { good: "ai_grounded", filler: "ai_gap_filled" },
      ),
    );

    const out = await reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID });

    expect(out.clearedQuestionIds).toEqual(["filler"]);
    expect(out.keptCount).toBe(1);
    expect(mockUpdateFormResponse).toHaveBeenCalledWith(
      RESPONSE_ID,
      expect.objectContaining({
        status: "rejected",
        answers: { good: "Testimonio real de la clienta." },
        answer_provenance: { good: "ai_grounded" },
        // A previous override must never survive: the new state needs a new signature.
        low_coverage_ack: null,
      }),
    );
  });

  it("clears legacy 'unknown' answers — the state migration 0095 left the real case in", async () => {
    const answers: Record<string, unknown> = {};
    const provenance: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      answers["q" + i] = "texto " + i;
      provenance["q" + i] = "unknown";
    }
    mockFindFormResponseById.mockResolvedValue(reopenable(answers, provenance));

    const out = await reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID });

    expect(out.clearedQuestionIds).toHaveLength(25);
    expect(out.keptCount).toBe(0);
  });

  it("never clears what the client authored", async () => {
    mockFindFormResponseById.mockResolvedValue(
      reopenable(
        { typed: "Lo escribí yo", tapped: "Confirmado", def: "no_new_evidence", bad: "relleno" },
        { typed: "client_edited", tapped: "client_confirmed", def: "schema_default", bad: "ai_gap_filled" },
      ),
    );

    const out = await reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID });

    expect(out.clearedQuestionIds).toEqual(["bad"]);
    expect(out.keptCount).toBe(3);
  });

  it("notifies the client and writes an audit trail of what was cleared", async () => {
    mockFindFormResponseById.mockResolvedValue(reopenable({ a: "x" }, { a: "ai_gap_filled" }));

    await reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID });

    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "form_response.rejected", visibleToClient: true }),
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "case.form_response.reopened",
      "case_form_responses",
      RESPONSE_ID,
      { clearedQuestionIds: ["a"], keptCount: 0 },
    );
  });

  it("refuses a response that is not a questionnaire", async () => {
    mockFindFormResponseById.mockResolvedValue({ ...approvedResponse, questionnaire_instance_id: null });

    await expect(
      reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("refuses a draft response (nothing to hand back yet)", async () => {
    mockFindFormResponseById.mockResolvedValue({
      ...draftResponse,
      questionnaire_instance_id: INSTANCE_ID_R,
    });

    await expect(
      reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORM_NOT_SUBMITTABLE");
  });

  it("enforces the cross-tenant guard before touching anything", async () => {
    mockFindFormResponseById.mockResolvedValue(reopenable({ a: "x" }, { a: "ai_gap_filled" }));
    mockRequireCaseAccess.mockRejectedValue(new Error("FORBIDDEN"));

    await expect(
      reopenQuestionnaireForClientInput(staffActor, { responseId: RESPONSE_ID }),
    ).rejects.toThrow("FORBIDDEN");
    expect(mockUpdateFormResponse).not.toHaveBeenCalled();
  });
});
