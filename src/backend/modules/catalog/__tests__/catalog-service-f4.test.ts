/**
 * Catalog service — F4 stubs unit tests.
 *
 * Covers the 6 previously-stubbed use cases:
 *   1. createAutomationVersion  (API-CAT-32)
 *   2. redetectFields           (API-CAT-33)
 *   3. aiProposeStructure       (API-CAT-34)
 *   4. generateTestPdf          (API-CAT-42)
 *   5. proposeExtractionSchema  (API-CAT-28)
 *   6. testGeneration           (API-CAT-47)
 * Plus:
 *   - updateDatasetItem  (API-CAT-51) — token recalculation on content change
 *   - deleteDataset      (API-CAT-53) — FK restrict guard
 *
 * Strategy: all IO (repository, platform/supabase, platform/pdf, platform/anthropic,
 * ai-engine module, audit) mocked with vi.hoisted() + vi.mock().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — all mock variables before vi.mock() factories run
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Repository
  const repo = {
    findFormDefinition: vi.fn(),
    listVersions: vi.fn(),
    insertAutomationVersion: vi.fn(),
    findVersionById: vi.fn(),
    updateVersion: vi.fn(),
    getVersionTree: vi.fn(),
    listQuestionGroups: vi.fn(),
    listQuestions: vi.fn(),
    deleteQuestionGroup: vi.fn(),
    upsertQuestionGroup: vi.fn(),
    upsertQuestion: vi.fn(),
    updateQuestionCondition: vi.fn(),
    findGenerationConfig: vi.fn(),
    findDataset: vi.fn(),
    findDatasetItem: vi.fn(),
    insertDatasetItem: vi.fn(),
    updateDatasetItem: vi.fn(),
    deleteDataset: vi.fn(),
    deleteDatasetItem: vi.fn(),
    findPhaseById: vi.fn(),
    findServiceById: vi.fn(),
    findVersionByQuestion: vi.fn(),
  };

  // Supabase storage
  const storageList = vi.fn();
  const storageDownload = vi.fn();
  const supabaseClient = {
    storage: {
      from: vi.fn(() => ({
        list: storageList,
        download: storageDownload,
      })),
    },
  };
  const createServiceClient = vi.fn(() => supabaseClient);

  // platform/pdf
  const detectAcroFields = vi.fn();
  const fillAcroForm = vi.fn();

  // platform/anthropic
  const messagesCreate = vi.fn();
  const messagesCountTokens = vi.fn();
  const anthropicClient = {
    messages: {
      create: messagesCreate,
      countTokens: messagesCountTokens,
    },
  };
  const getAnthropicClient = vi.fn(() => anthropicClient);

  // ai-engine module
  const aiEngine = {
    proposeFormSegmentation: vi.fn(),
    proposeExtractionSchema: vi.fn(),
    startGeneration: vi.fn(),
  };

  // authz
  const can = vi.fn();

  // audit
  const writeAudit = vi.fn();

  // logger
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  // platform/storage
  const validateUploadedObject = vi.fn();

  return {
    repo,
    storageList,
    storageDownload,
    supabaseClient,
    createServiceClient,
    detectAcroFields,
    fillAcroForm,
    aiEngine,
    can,
    writeAudit,
    logger,
    messagesCreate,
    messagesCountTokens,
    getAnthropicClient,
    validateUploadedObject,
  };
});

// ---------------------------------------------------------------------------
// vi.mock() factories
// ---------------------------------------------------------------------------

vi.mock("../repository", () => ({
  findFormDefinition: mocks.repo.findFormDefinition,
  listVersions: mocks.repo.listVersions,
  insertAutomationVersion: mocks.repo.insertAutomationVersion,
  findVersionById: mocks.repo.findVersionById,
  updateVersion: mocks.repo.updateVersion,
  getVersionTree: mocks.repo.getVersionTree,
  listQuestionGroups: mocks.repo.listQuestionGroups,
  listQuestions: mocks.repo.listQuestions,
  deleteQuestionGroup: mocks.repo.deleteQuestionGroup,
  upsertQuestionGroup: mocks.repo.upsertQuestionGroup,
  upsertQuestion: mocks.repo.upsertQuestion,
  updateQuestionCondition: mocks.repo.updateQuestionCondition,
  findGenerationConfig: mocks.repo.findGenerationConfig,
  findDataset: mocks.repo.findDataset,
  findDatasetItem: mocks.repo.findDatasetItem,
  insertDatasetItem: mocks.repo.insertDatasetItem,
  updateDatasetItem: mocks.repo.updateDatasetItem,
  deleteDataset: mocks.repo.deleteDataset,
  deleteDatasetItem: mocks.repo.deleteDatasetItem,
  findPhaseById: mocks.repo.findPhaseById,
  findServiceById: mocks.repo.findServiceById,
  findVersionByQuestion: mocks.repo.findVersionByQuestion,
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock("@/backend/platform/pdf", () => ({
  detectAcroFields: mocks.detectAcroFields,
  fillAcroForm: mocks.fillAcroForm,
  backfillNaTextFields: () => 0,
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mocks.can,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mocks.writeAudit,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn() },
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  proposeFormSegmentation: mocks.aiEngine.proposeFormSegmentation,
  proposeExtractionSchema: mocks.aiEngine.proposeExtractionSchema,
  startGeneration: mocks.aiEngine.startGeneration,
}));

vi.mock("@/shared/constants/profile-fields", () => ({
  PROFILE_SOURCE_FIELDS: ["first_name", "last_name", "email"],
}));

vi.mock("@/shared/constants/ai-models", () => ({
  GENERATION_MODELS: ["claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5"],
}));

// platform/storage is imported dynamically inside service functions — mock it at module level
vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: mocks.validateUploadedObject,
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT after all mocks are in place
// ---------------------------------------------------------------------------

import type { Actor } from "@/backend/platform/authz";
import {
  createAutomationVersion,
  redetectFields,
  aiProposeStructure,
  generateTestPdf,
  proposeExtractionSchema,
  testGeneration,
  updateDatasetItem,
  deleteDataset,
} from "../service";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeActor(): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    kind: "staff",
    role: "admin",
    // Empty map — can() is mocked and never inspects the map
    permissions: new Map(),
  };
}

function makePdfFormRow() {
  return {
    id: "form-id-111",
    service_phase_id: "phase-id-111",
    slug: "i-765",
    kind: "pdf_automation",
    label_i18n: { es: "Formulario I-765", en: "Form I-765" },
    description_i18n: null,
    filled_by: "client",
    position: 0,
    is_active: true,
  };
}

function makeDraftVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: "version-id-111",
    form_definition_id: "form-id-111",
    version: 1,
    source_pdf_path: "forms/form-id-111/v1/i765.pdf",
    detected_fields: [],
    status: "draft",
    published_at: null,
    created_by: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function makePdfBytes(): Uint8Array {
  // Minimal fake PDF header
  return new TextEncoder().encode("%PDF-1.4 fake content");
}

// ---------------------------------------------------------------------------
// 1. createAutomationVersion
// ---------------------------------------------------------------------------

describe("createAutomationVersion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("creates a draft version and chains detectAcroFields", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
    mocks.validateUploadedObject.mockResolvedValue({ ok: true });
    mocks.repo.listVersions.mockResolvedValue([]);
    mocks.repo.insertAutomationVersion.mockResolvedValue(makeDraftVersion());
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    // Storage download for redetectFields chain
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([
      { name: "FirstName", type: "text", page: 0, rect: [10, 20, 100, 30] },
    ]);
    mocks.repo.updateVersion.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "FirstName", field_type: "text", page: 1, rect: [10, 20, 100, 30] }],
    });

    const result = await createAutomationVersion(makeActor(), {
      form_definition_id: "form-id-111",
      uploaded_pdf_path: "forms/form-id-111/v1/i765.pdf",
    });

    expect(mocks.repo.insertAutomationVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1, status: "draft", detected_fields: [] }),
    );
    expect(mocks.detectAcroFields).toHaveBeenCalledOnce();
    expect(mocks.repo.updateVersion).toHaveBeenCalledWith(
      "version-id-111",
      expect.objectContaining({ detected_fields: expect.any(Array) }),
    );
    expect(result).toBeDefined();
  });

  it("throws CATALOG_FORM_NOT_FOUND when form is missing", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(null);

    await expect(
      createAutomationVersion(makeActor(), {
        form_definition_id: "nonexistent",
        uploaded_pdf_path: "forms/x/v1/f.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FORM_NOT_FOUND" });
  });

  it("throws CATALOG_FORM_KIND_MISMATCH for ai_letter forms", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue({ ...makePdfFormRow(), kind: "ai_letter" });

    await expect(
      createAutomationVersion(makeActor(), {
        form_definition_id: "form-id-111",
        uploaded_pdf_path: "forms/x/v1/f.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FORM_KIND_MISMATCH" });
  });

  it("increments version number when prior versions exist", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
    mocks.validateUploadedObject.mockResolvedValue({ ok: true });
    mocks.repo.listVersions.mockResolvedValue([
      { ...makeDraftVersion(), version: 1, status: "published" },
      { ...makeDraftVersion(), id: "v2", version: 2, status: "archived" },
    ]);
    mocks.repo.insertAutomationVersion.mockResolvedValue({ ...makeDraftVersion(), version: 3 });
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), version: 3 });
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([]);
    mocks.repo.updateVersion.mockResolvedValue({ ...makeDraftVersion(), version: 3, detected_fields: [] });

    await createAutomationVersion(makeActor(), {
      form_definition_id: "form-id-111",
      uploaded_pdf_path: "forms/form-id-111/v3/i765.pdf",
    });

    expect(mocks.repo.insertAutomationVersion).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 }),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. redetectFields
// ---------------------------------------------------------------------------

describe("redetectFields", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("downloads PDF, detects fields, and updates version", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([
      { name: "LastName", type: "text", page: 0, rect: [10, 50, 150, 60] },
      { name: "SignHere", type: "signature", page: 1, rect: [10, 700, 200, 720] },
    ]);
    mocks.repo.updateVersion.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [
        { pdf_field_name: "LastName", field_type: "text", page: 1, rect: [10, 50, 150, 60] },
        { pdf_field_name: "SignHere", field_type: "signature", page: 2, rect: [10, 700, 200, 720] },
      ],
    });

    const result = await redetectFields(makeActor(), "version-id-111");

    expect(mocks.repo.updateVersion).toHaveBeenCalledWith(
      "version-id-111",
      expect.objectContaining({
        detected_fields: expect.arrayContaining([
          expect.objectContaining({ pdf_field_name: "LastName", field_type: "text", page: 1 }),
          expect.objectContaining({ pdf_field_name: "SignHere", field_type: "signature", page: 2 }),
        ]),
      }),
    );
    expect(result).toBeDefined();
  });

  it("maps mupdf 0-indexed page to 1-indexed domain page", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([
      { name: "FieldA", type: "text", page: 0, rect: [0, 0, 100, 10] },
      { name: "FieldB", type: "checkbox", page: 2, rect: [0, 0, 50, 10] },
    ]);
    mocks.repo.updateVersion.mockImplementation((_id, patch) =>
      Promise.resolve({ ...makeDraftVersion(), ...patch }),
    );

    await redetectFields(makeActor(), "version-id-111");

    const [, patch] = mocks.repo.updateVersion.mock.calls[0] as [string, { detected_fields: Array<{ page: number }> }];
    expect(patch.detected_fields[0].page).toBe(1); // 0+1
    expect(patch.detected_fields[1].page).toBe(3); // 2+1
  });

  it("throws CATALOG_VERSION_PUBLISHED_IMMUTABLE for published version", async () => {
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), status: "published" });

    await expect(redetectFields(makeActor(), "version-id-111")).rejects.toMatchObject({
      code: "CATALOG_VERSION_PUBLISHED_IMMUTABLE",
    });
  });

  it("throws CATALOG_PDF_UNREADABLE when storage download fails", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    mocks.storageDownload.mockResolvedValue({ data: null, error: { message: "not found" } });

    await expect(redetectFields(makeActor(), "version-id-111")).rejects.toMatchObject({
      code: "CATALOG_PDF_UNREADABLE",
    });
  });

  it("throws CATALOG_PDF_UNREADABLE when detectAcroFields throws", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockRejectedValue(new Error("mupdf: cannot read compressed stream"));

    await expect(redetectFields(makeActor(), "version-id-111")).rejects.toMatchObject({
      code: "CATALOG_PDF_UNREADABLE",
    });
  });

  it("allows 0 detected fields (no AcroForm) without error", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([]);
    mocks.repo.updateVersion.mockResolvedValue({ ...makeDraftVersion(), detected_fields: [] });

    const result = await redetectFields(makeActor(), "version-id-111");
    expect(result).toBeDefined();
    expect(mocks.repo.updateVersion).toHaveBeenCalledWith("version-id-111", { detected_fields: [] });
  });
});

// ---------------------------------------------------------------------------
// 3. aiProposeStructure
// ---------------------------------------------------------------------------

describe("aiProposeStructure", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("calls proposeFormSegmentation and materializes draft groups + questions", async () => {
    const versionWithFields = {
      ...makeDraftVersion(),
      detected_fields: [
        { pdf_field_name: "FirstName", field_type: "text", page: 1 },
        { pdf_field_name: "DOB", field_type: "text", page: 1 },
      ],
    };
    mocks.repo.findVersionById.mockResolvedValue(versionWithFields);
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "Información Personal", en: "Personal Information" },
          position: 0,
          questions: [
            { question_i18n: { es: "Nombre", en: "First Name" }, field_type: "text", pdf_field_name: "FirstName", is_required: true, position: 0 },
            { question_i18n: { es: "Fecha de Nacimiento", en: "Date of Birth" }, field_type: "date", pdf_field_name: "DOB", is_required: true, position: 1 },
          ],
        },
      ],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "group-id-1", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });
    mocks.repo.upsertQuestion.mockResolvedValue({ id: "q-1" });

    const result = await aiProposeStructure(makeActor(), {
      version_id: "version-id-111",
      mode: "replace",
    });

    expect(result).toEqual({ groups: 1, questions: 2 });
    expect(mocks.aiEngine.proposeFormSegmentation).toHaveBeenCalledOnce();
    expect(mocks.repo.upsertQuestionGroup).toHaveBeenCalledOnce();
    expect(mocks.repo.upsertQuestion).toHaveBeenCalledTimes(2);
  });

  it("resolves AI-proposed conditions by key → question id (Sí/No → explanation)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), detected_fields: [{ pdf_field_name: "X", field_type: "text", page: 1 }] });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "G", en: "G" },
          position: 0,
          questions: [
            {
              key: "has_kids",
              question_i18n: { es: "¿Tienes hijos?", en: "Do you have children?" },
              field_type: "select",
              options: [
                { value: "si", label_i18n: { es: "Sí", en: "Yes" } },
                { value: "no", label_i18n: { es: "No", en: "No" } },
              ],
              is_required: true,
              position: 0,
            },
            {
              key: "kids_detail",
              question_i18n: { es: "Cuéntanos sobre tus hijos", en: "Tell us about your children" },
              field_type: "textarea",
              is_required: true,
              position: 1,
              condition: { when: { question: "has_kids", op: "equals", value: "si" }, action: "show" },
            },
          ],
        },
      ],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "group-id-1", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });
    mocks.repo.upsertQuestion
      .mockResolvedValueOnce({ id: "id-has-kids" })
      .mockResolvedValueOnce({ id: "id-kids-detail" });

    const result = await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    expect(result).toEqual({ groups: 1, questions: 2 });
    // The condition on q2 referenced q1 by KEY → resolved to q1's real id and persisted on q2.
    expect(mocks.repo.updateQuestionCondition).toHaveBeenCalledOnce();
    expect(mocks.repo.updateQuestionCondition).toHaveBeenCalledWith("id-kids-detail", {
      when: { question: "id-has-kids", op: "equals", value: "si" },
      action: "show",
      lock_message_i18n: null,
    });
  });

  it("drops an AI condition whose key reference is unknown (fail-safe)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), detected_fields: [{ pdf_field_name: "X", field_type: "text", page: 1 }] });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "G", en: "G" },
          position: 0,
          questions: [
            {
              key: "lonely",
              question_i18n: { es: "Detalle", en: "Detail" },
              field_type: "textarea",
              is_required: true,
              position: 0,
              condition: { when: { question: "does_not_exist", op: "equals", value: "si" }, action: "show" },
            },
          ],
        },
      ],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "g", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });
    mocks.repo.upsertQuestion.mockResolvedValue({ id: "q" });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    expect(mocks.repo.updateQuestionCondition).not.toHaveBeenCalled();
  });

  it("drops a self-referential condition (a field gated on its own value)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), detected_fields: [{ pdf_field_name: "X", field_type: "text", page: 1 }] });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "G", en: "G" },
          position: 0,
          questions: [
            {
              key: "self",
              question_i18n: { es: "Detalle", en: "Detail" },
              field_type: "textarea",
              is_required: true,
              position: 0,
              condition: { when: { question: "self", op: "equals", value: "si" }, action: "show" }, // references itself
            },
          ],
        },
      ],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "g", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });
    mocks.repo.upsertQuestion.mockResolvedValue({ id: "q-self" });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    expect(mocks.repo.updateQuestionCondition).not.toHaveBeenCalled();
  });

  it("materializes rich fields safely (options, help, profile whitelist, validation, pdf mapping)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "FirstName", field_type: "text", page: 1 }],
    });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "G", en: "G" },
          position: 0,
          questions: [
            // a) valid select with options + valid pdf mapping → kept as-is
            { question_i18n: { es: "País", en: "Country" }, field_type: "select",
              options: [{ value: "US", label_i18n: { es: "EEUU", en: "USA" } }],
              pdf_field_name: "FirstName", source: "client_answer", is_required: true, position: 0 },
            // b) select WITHOUT options → degrades to text, options null
            { question_i18n: { es: "X", en: "X" }, field_type: "select", options: [], pdf_field_name: null, position: 1 },
            // c) profile + whitelisted field (email) → kept
            { question_i18n: { es: "Email", en: "Email" }, field_type: "text", source: "profile",
              source_ref: { profile_field: "email" }, position: 2 },
            // d) profile + NON-whitelisted field (ssn) → degrades to client_answer
            { question_i18n: { es: "SSN", en: "SSN" }, field_type: "text", source: "profile",
              source_ref: { profile_field: "ssn" }, position: 3 },
            // e) help + validation kept; unknown pdf field → null
            { question_i18n: { es: "Y", en: "Y" }, field_type: "text",
              help_i18n: { es: "Pista", en: "Hint" }, validation: { min: 5 },
              pdf_field_name: "DoesNotExist", position: 4 },
          ],
        },
      ],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "g1", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });
    mocks.repo.upsertQuestion.mockResolvedValue({ id: "q" });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    const calls = mocks.repo.upsertQuestion.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(calls[0]).toMatchObject({ field_type: "select", options: [{ value: "US" }], pdf_field_name: "FirstName", source: "client_answer" });
    expect(calls[1]).toMatchObject({ field_type: "text", options: null });
    expect(calls[2]).toMatchObject({ source: "profile", source_ref: { profile_field: "email" } });
    expect(calls[3]).toMatchObject({ source: "client_answer", source_ref: null });
    expect(calls[4]).toMatchObject({ help_i18n: { es: "Pista", en: "Hint" }, validation: { min: 5 }, pdf_field_name: null });
  });

  it("throws CATALOG_NO_ACROFORM_FIELDS when version has no detected_fields", async () => {
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion()); // detected_fields: []

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" }),
    ).rejects.toMatchObject({ code: "CATALOG_NO_ACROFORM_FIELDS" });
  });

  it("throws CATALOG_VERSION_PUBLISHED_IMMUTABLE for published version", async () => {
    mocks.repo.findVersionById.mockResolvedValue({ ...makeDraftVersion(), status: "published" });

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" }),
    ).rejects.toMatchObject({ code: "CATALOG_VERSION_PUBLISHED_IMMUTABLE" });
  });

  it("replace mode: deletes existing groups before materializing", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "F1", field_type: "text", page: 1 }],
    });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [{ title_i18n: { es: "S", en: "S" }, position: 0, questions: [] }],
    });
    const existingGroups = [{ id: "old-group-1" }, { id: "old-group-2" }];
    mocks.repo.listQuestionGroups.mockResolvedValue(existingGroups);
    mocks.repo.deleteQuestionGroup.mockResolvedValue(undefined);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "new-group", automation_version_id: "version-id-111", title_i18n: {}, position: 0 });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    expect(mocks.repo.deleteQuestionGroup).toHaveBeenCalledTimes(2);
  });

  it("filters detected fields to the requested page range and forwards pageRange to the engine", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [
        { pdf_field_name: "A_p1", field_type: "text", page: 1 },
        { pdf_field_name: "B_p4", field_type: "text", page: 4 },
        { pdf_field_name: "C_p5", field_type: "text", page: 5 },
        { pdf_field_name: "D_p12", field_type: "text", page: 12 },
      ],
    });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({ groups: [] });
    mocks.repo.listQuestionGroups.mockResolvedValue([]);

    await aiProposeStructure(makeActor(), {
      version_id: "version-id-111",
      mode: "merge",
      pageRange: { from: 5, to: 12 },
    });

    expect(mocks.aiEngine.proposeFormSegmentation).toHaveBeenCalledOnce();
    const arg = mocks.aiEngine.proposeFormSegmentation.mock.calls[0][1];
    // Only pages 5-12 reached the model; pages 1-4 were excluded.
    expect(arg.detectedFields.map((f: { name: string }) => f.name)).toEqual(["C_p5", "D_p12"]);
    expect(arg.pageRange).toEqual({ from: 5, to: 12 });
  });

  it("throws CATALOG_NO_ACROFORM_FIELDS when the page range has no fields", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "A_p1", field_type: "text", page: 1 }],
    });

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "merge", pageRange: { from: 5, to: 12 } }),
    ).rejects.toMatchObject({ code: "CATALOG_NO_ACROFORM_FIELDS" });
    expect(mocks.aiEngine.proposeFormSegmentation).not.toHaveBeenCalled();
  });

  it("merge mode appends new groups AFTER the existing ones (position offset)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "C_p5", field_type: "text", page: 5 }],
    });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({
      groups: [
        {
          title_i18n: { es: "Parte B", en: "Part B" },
          position: 0,
          questions: [
            { question_i18n: { es: "q", en: "q" }, field_type: "text", pdf_field_name: "C_p5", is_required: true, position: 0 },
          ],
        },
      ],
    });
    // Existing page-1-4 groups occupy positions 0 and 1 → new group must land at 2.
    mocks.repo.listQuestionGroups.mockResolvedValue([
      { id: "g0", position: 0 },
      { id: "g1", position: 1 },
    ]);
    // Existing groups map only page-1-4 fields — none collide with C_p5.
    mocks.repo.listQuestions.mockResolvedValue([
      { pdf_field_name: "A_p1" },
      { pdf_field_name: "B_p4" },
    ]);
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "new-g", automation_version_id: "version-id-111", title_i18n: {}, position: 2 });
    mocks.repo.upsertQuestion.mockResolvedValue({ id: "q-1" });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "merge", pageRange: { from: 5, to: 12 } });

    expect(mocks.repo.upsertQuestionGroup).toHaveBeenCalledWith(expect.objectContaining({ position: 2 }));
  });

  it("merge mode excludes AcroForm fields already mapped in another group (overlapping ranges don't duplicate)", async () => {
    // Version has fields on pages 5-8; page 6 (C_p6) is ALREADY mapped by an existing
    // group. A second merge proposal covering pages 5-8 must NOT re-offer C_p6.
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [
        { pdf_field_name: "C_p5", field_type: "text", page: 5 },
        { pdf_field_name: "C_p6", field_type: "text", page: 6 },
        { pdf_field_name: "C_p7", field_type: "text", page: 7 },
      ],
    });
    mocks.aiEngine.proposeFormSegmentation.mockResolvedValue({ groups: [] });
    mocks.repo.listQuestionGroups.mockResolvedValue([{ id: "g0", position: 0 }]);
    mocks.repo.listQuestions.mockResolvedValue([{ pdf_field_name: "C_p6" }]);

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "merge", pageRange: { from: 5, to: 8 } });

    const arg = mocks.aiEngine.proposeFormSegmentation.mock.calls[0][1];
    // C_p6 is already mapped → excluded; only the unmapped fields reach the model.
    expect(arg.detectedFields.map((f: { name: string }) => f.name)).toEqual(["C_p5", "C_p7"]);
  });

  it("merge mode throws when EVERY field in scope is already mapped", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "C_p5", field_type: "text", page: 5 }],
    });
    mocks.repo.listQuestionGroups.mockResolvedValue([{ id: "g0", position: 0 }]);
    mocks.repo.listQuestions.mockResolvedValue([{ pdf_field_name: "C_p5" }]);

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "merge", pageRange: { from: 5, to: 8 } }),
    ).rejects.toMatchObject({ code: "CATALOG_NO_ACROFORM_FIELDS" });
    expect(mocks.aiEngine.proposeFormSegmentation).not.toHaveBeenCalled();
  });

  it("rejects a page range combined with replace mode (would silently wipe the rest of the form)", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "C_p5", field_type: "text", page: 5 }],
    });

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace", pageRange: { from: 5, to: 8 } }),
    ).rejects.toMatchObject({ code: "CATALOG_BAD_PAGE_RANGE" });
    expect(mocks.aiEngine.proposeFormSegmentation).not.toHaveBeenCalled();
  });

  it("rejects an inverted / out-of-bounds page range at the service boundary", async () => {
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "C_p5", field_type: "text", page: 5 }],
    });

    for (const bad of [{ from: 8, to: 5 }, { from: 0, to: 4 }]) {
      await expect(
        aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "merge", pageRange: bad }),
      ).rejects.toMatchObject({ code: "CATALOG_BAD_PAGE_RANGE" });
    }
    expect(mocks.aiEngine.proposeFormSegmentation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. generateTestPdf
// ---------------------------------------------------------------------------

describe("generateTestPdf", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
  });

  it("returns filled PDF bytes and an empty gaps list when all required questions answered", async () => {
    mocks.repo.getVersionTree.mockResolvedValue({
      version: { ...makeDraftVersion(), source_pdf_path: "forms/f/v1/f.pdf" },
      groups: [],
      questions: [
        { id: "q-1", pdf_field_name: "FirstName", is_required: true, position: 0 },
        { id: "q-2", pdf_field_name: "LastName", is_required: true, position: 1 },
      ],
    });
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    const filledBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    mocks.fillAcroForm.mockResolvedValue(filledBytes);

    const result = await generateTestPdf(makeActor(), {
      version_id: "version-id-111",
      sample_answers: { "q-1": "John", "q-2": "Doe" },
    });

    expect(result.pdfBytes).toBe(filledBytes);
    expect(result.gaps).toHaveLength(0);
    expect(mocks.fillAcroForm).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      {},
      { FirstName: "John", LastName: "Doe" },
    );
  });

  it("returns gaps for required fields with no sample answer (non-blocking)", async () => {
    mocks.repo.getVersionTree.mockResolvedValue({
      version: { ...makeDraftVersion(), source_pdf_path: "forms/f/v1/f.pdf" },
      groups: [],
      questions: [
        { id: "q-1", pdf_field_name: "Field1", is_required: true, position: 0 },
        { id: "q-2", pdf_field_name: "Field2", is_required: true, position: 1 },
      ],
    });
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.fillAcroForm.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));

    // Only provide q-1, leave q-2 unanswered
    const result = await generateTestPdf(makeActor(), {
      version_id: "version-id-111",
      sample_answers: { "q-1": "value1" },
    });

    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({ question_id: "q-2", pdf_field_name: "Field2" });
  });

  it("throws CATALOG_VERSION_NOT_FOUND when version tree is missing", async () => {
    mocks.repo.getVersionTree.mockResolvedValue(null);

    await expect(
      generateTestPdf(makeActor(), { version_id: "nonexistent", sample_answers: {} }),
    ).rejects.toMatchObject({ code: "CATALOG_VERSION_NOT_FOUND" });
  });

  it("mirrors production: option-group siblings OFF and a do_not_fill group stays blank", async () => {
    mocks.repo.getVersionTree.mockResolvedValue({
      version: { ...makeDraftVersion(), source_pdf_path: "forms/f/v1/f.pdf" },
      groups: [
        { id: "gA", do_not_fill: false },
        { id: "gSig", do_not_fill: true }, // Part D signature / Parts F/G
      ],
      questions: [
        {
          id: "qSex", group_id: "gA", field_type: "select", is_required: true, pdf_field_name: null, position: 0,
          options: [
            { value: "m", pdf_field_name: "SexM" },
            { value: "f", pdf_field_name: "SexF" },
          ],
        },
        { id: "qSign", group_id: "gSig", field_type: "text", is_required: false, pdf_field_name: "SignName", position: 0 },
      ],
    });
    mocks.storageDownload.mockResolvedValue({ data: new Blob([makePdfBytes().buffer as ArrayBuffer]), error: null });
    mocks.fillAcroForm.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));

    await generateTestPdf(makeActor(), {
      version_id: "version-id-111",
      sample_answers: { qSex: "m", qSign: "should be ignored" },
    });

    const values = mocks.fillAcroForm.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(values).toMatchObject({ SexM: true, SexF: false }); // chosen ON, sibling explicitly OFF
    expect(values).not.toHaveProperty("SignName"); // do_not_fill group → blank even with an answer
  });

  it("skips questions without pdf_field_name (intermediate fields)", async () => {
    mocks.repo.getVersionTree.mockResolvedValue({
      version: { ...makeDraftVersion(), source_pdf_path: "forms/f/v1/f.pdf" },
      groups: [],
      questions: [
        { id: "q-intermediate", pdf_field_name: null, is_required: true, position: 0 },
        { id: "q-mapped", pdf_field_name: "MappedField", is_required: false, position: 1 },
      ],
    });
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.fillAcroForm.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));

    const result = await generateTestPdf(makeActor(), {
      version_id: "version-id-111",
      sample_answers: {},
    });

    // intermediate field (no pdf_field_name) must not appear in gaps or fill mapping
    expect(result.gaps).toHaveLength(0); // q-mapped is not required
    expect(mocks.fillAcroForm).toHaveBeenCalledWith(expect.any(Uint8Array), {}, {});
  });
});

// ---------------------------------------------------------------------------
// 5. proposeExtractionSchema
// ---------------------------------------------------------------------------

describe("proposeExtractionSchema", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
  });

  it("delegates to ai-engine and returns the schema when valid", async () => {
    const mockSchema = {
      type: "object",
      properties: {
        full_name: { type: "string", description: "Full legal name" },
        dob: { type: "string", description: "Date of birth" },
      },
      required: ["full_name"],
    };
    mocks.aiEngine.proposeExtractionSchema.mockResolvedValue({ schema: mockSchema });

    const result = await proposeExtractionSchema(makeActor(), {
      service_phase_id: "phase-id-111",
      label: "Passport",
      help: "A valid US passport",
    });

    expect(result).toEqual(mockSchema);
    expect(mocks.aiEngine.proposeExtractionSchema).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ requirementLabel: { es: "Passport", en: "Passport" } }),
    );
  });

  it("throws CATALOG_EXTRACTION_SCHEMA_INVALID when schema has $ref (not portable to Gemini)", async () => {
    const invalidSchema = {
      type: "object",
      properties: { field: { $ref: "#/definitions/SomeType" } },
    };
    mocks.aiEngine.proposeExtractionSchema.mockResolvedValue({ schema: invalidSchema });

    await expect(
      proposeExtractionSchema(makeActor(), {
        service_phase_id: "phase-id-111",
        label: "Tax Return",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_EXTRACTION_SCHEMA_INVALID" });
  });
});

// ---------------------------------------------------------------------------
// 6. testGeneration
// ---------------------------------------------------------------------------

describe("testGeneration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    // M-2: wire form→phase→service org check
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
    mocks.repo.findPhaseById.mockResolvedValue({
      id: "phase-id-111",
      service_id: "service-id-111",
      slug: "principal",
      label_i18n: { es: "Principal", en: "Main" },
      position: 0,
    });
    mocks.repo.findServiceById.mockResolvedValue({
      id: "service-id-111",
      org_id: "22222222-2222-4222-8222-222222222222", // matches makeActor().orgId
      slug: "i-765",
      label_i18n: { es: "I-765", en: "I-765" },
      is_active: true,
    });
  });

  it("delegates to startGeneration with isTest=true and returns run_id", async () => {
    mocks.repo.findGenerationConfig.mockResolvedValue({
      form_definition_id: "form-id-111",
      system_prompt: "You are a legal assistant.",
      model: "claude-fable-5",
    });
    mocks.aiEngine.startGeneration.mockResolvedValue({
      run: { id: "run-id-abc123", status: "queued" },
      budgetWarning: null,
    });

    const result = await testGeneration(makeActor(), {
      form_definition_id: "form-id-111",
      case_id: "33333333-3333-4333-8333-333333333333",
    });

    expect(result).toEqual({ run_id: "run-id-abc123" });
    expect(mocks.aiEngine.startGeneration).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        formDefinitionId: "form-id-111",
        caseId: "33333333-3333-4333-8333-333333333333",
        isTest: true,
      }),
    );
  });

  it("throws CATALOG_GENERATION_NOT_CONFIGURED when no config exists", async () => {
    mocks.repo.findGenerationConfig.mockResolvedValue(null);

    await expect(
      testGeneration(makeActor(), {
        form_definition_id: "form-id-111",
        case_id: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_GENERATION_NOT_CONFIGURED" });

    expect(mocks.aiEngine.startGeneration).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. updateDatasetItem — token recalculation
// ---------------------------------------------------------------------------

describe("updateDatasetItem", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
    // M-1: wire item → dataset → org ownership check
    mocks.repo.findDatasetItem.mockResolvedValue({ id: "item-1", dataset_id: "ds-1" });
    mocks.repo.findDataset.mockResolvedValue({
      id: "ds-1",
      org_id: "22222222-2222-4222-8222-222222222222", // matches makeActor().orgId
    });
  });

  it("recalculates token_count when content changes", async () => {
    mocks.messagesCountTokens.mockResolvedValue({ input_tokens: 42 });
    mocks.repo.updateDatasetItem.mockResolvedValue({
      id: "item-1",
      dataset_id: "ds-1",
      title: "Updated",
      content: "New content",
      token_count: 42,
    });

    const result = await updateDatasetItem(makeActor(), "item-1", { content: "New content" });

    expect(mocks.messagesCountTokens).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: "user", content: "New content" }] }),
    );
    expect(mocks.repo.updateDatasetItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ content: "New content", token_count: 42 }),
    );
    expect(result).toBeDefined();
  });

  it("sets token_count to null when content changes to null", async () => {
    mocks.repo.updateDatasetItem.mockResolvedValue({ id: "item-1", dataset_id: "ds-1", content: null, token_count: null });

    await updateDatasetItem(makeActor(), "item-1", { content: null });

    expect(mocks.messagesCountTokens).not.toHaveBeenCalled();
    expect(mocks.repo.updateDatasetItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ token_count: null }),
    );
  });

  it("does NOT recalculate token_count when only title changes", async () => {
    mocks.repo.updateDatasetItem.mockResolvedValue({ id: "item-1", title: "New title", token_count: 99 });

    await updateDatasetItem(makeActor(), "item-1", { title: "New title" });

    expect(mocks.messagesCountTokens).not.toHaveBeenCalled();
    // token_count not in patch → repo called without it
    const [, patch] = mocks.repo.updateDatasetItem.mock.calls[0] as [string, Record<string, unknown>];
    expect("token_count" in patch).toBe(false);
  });

  it("sets token_count to null (non-fatal) when Anthropic countTokens fails", async () => {
    mocks.messagesCountTokens.mockRejectedValue(new Error("provider unavailable"));
    mocks.repo.updateDatasetItem.mockResolvedValue({ id: "item-1", content: "text", token_count: null });

    await updateDatasetItem(makeActor(), "item-1", { content: "text" });

    expect(mocks.repo.updateDatasetItem).toHaveBeenCalledWith(
      "item-1",
      expect.objectContaining({ token_count: null }),
    );
    expect(mocks.logger.warn).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. deleteDataset — FK guard
// ---------------------------------------------------------------------------

describe("deleteDataset", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("deletes the dataset and writes audit", async () => {
    mocks.repo.deleteDataset.mockResolvedValue(undefined);

    await deleteDataset(makeActor(), "ds-1");

    expect(mocks.repo.deleteDataset).toHaveBeenCalledWith("ds-1");
    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.any(Object),
      "catalog.dataset.deleted",
      "ai_datasets",
      "ds-1",
      {},
    );
  });

  it("throws CATALOG_DATASET_IN_USE when FK violation occurs", async () => {
    mocks.repo.deleteDataset.mockRejectedValue({ code: "23503", message: "FK violation" });

    await expect(deleteDataset(makeActor(), "ds-in-use")).rejects.toMatchObject({
      code: "CATALOG_DATASET_IN_USE",
    });
  });
});
