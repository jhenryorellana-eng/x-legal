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
    findGenerationConfig: vi.fn(),
    insertDatasetItem: vi.fn(),
    updateDatasetItem: vi.fn(),
    deleteDataset: vi.fn(),
    deleteDatasetItem: vi.fn(),
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
  findGenerationConfig: mocks.repo.findGenerationConfig,
  insertDatasetItem: mocks.repo.insertDatasetItem,
  updateDatasetItem: mocks.repo.updateDatasetItem,
  deleteDataset: mocks.repo.deleteDataset,
  deleteDatasetItem: mocks.repo.deleteDatasetItem,
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: mocks.createServiceClient,
}));

vi.mock("@/backend/platform/pdf", () => ({
  detectAcroFields: mocks.detectAcroFields,
  fillAcroForm: mocks.fillAcroForm,
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
    mocks.storageList.mockResolvedValue({ data: [{ name: "i765.pdf" }], error: null });
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
    mocks.storageList.mockResolvedValue({ data: [{ name: "i765.pdf" }], error: null });
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
        form_definition_id: "unconfigured-form",
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
