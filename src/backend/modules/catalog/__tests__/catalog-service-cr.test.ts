/**
 * Catalog service — code-review fix tests (Ola F4-2 CR).
 *
 * Covers all HIGH and MEDIUM findings from the code review:
 *
 * HIGH (security):
 *   H-1  createAutomationVersion — path prefix + validateUploadedObject
 *   H-2  createDatasetItem / updateDatasetItem — file_path prefix + validateUploadedObject
 *   H-3  validateExtractionSchema — raw_text reserved field (domain.ts)
 *
 * MEDIUM (cross-tenant + consistency):
 *   M-1  updateDataset / updateDatasetItem — org ownership check
 *   M-2  testGeneration — form org ownership check
 *   M-3  deleteQuestion — version status guard
 *   M-4  aiProposeStructure — AI call before delete (ordering)
 *   M-5  listDatasets — accepts Actor (not bare orgId)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — all mock variables
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
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
    findDataset: vi.fn(),
    findDatasetItem: vi.fn(),
    insertDatasetItem: vi.fn(),
    updateDataset: vi.fn(),
    updateDatasetItem: vi.fn(),
    deleteDataset: vi.fn(),
    deleteDatasetItem: vi.fn(),
    findPhaseById: vi.fn(),
    findServiceById: vi.fn(),
    deleteQuestion: vi.fn(),
    findVersionByQuestion: vi.fn(),
    listDatasets: vi.fn(),
  };

  const storageDownload = vi.fn();
  const supabaseClient = {
    storage: {
      from: vi.fn(() => ({ download: storageDownload })),
    },
  };
  const createServiceClient = vi.fn(() => supabaseClient);

  const detectAcroFields = vi.fn();
  const fillAcroForm = vi.fn();

  const messagesCountTokens = vi.fn();
  const getAnthropicClient = vi.fn(() => ({
    messages: { create: vi.fn(), countTokens: messagesCountTokens },
  }));

  const aiEngine = {
    proposeFormSegmentation: vi.fn(),
    proposeExtractionSchema: vi.fn(),
    startGeneration: vi.fn(),
  };

  const can = vi.fn();
  const writeAudit = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const validateUploadedObject = vi.fn();

  return {
    repo,
    storageDownload,
    createServiceClient,
    detectAcroFields,
    fillAcroForm,
    messagesCountTokens,
    getAnthropicClient,
    aiEngine,
    can,
    writeAudit,
    logger,
    validateUploadedObject,
  };
});

// ---------------------------------------------------------------------------
// vi.mock factories
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
  findDataset: mocks.repo.findDataset,
  findDatasetItem: mocks.repo.findDatasetItem,
  insertDatasetItem: mocks.repo.insertDatasetItem,
  updateDataset: mocks.repo.updateDataset,
  updateDatasetItem: mocks.repo.updateDatasetItem,
  deleteDataset: mocks.repo.deleteDataset,
  deleteDatasetItem: mocks.repo.deleteDatasetItem,
  findPhaseById: mocks.repo.findPhaseById,
  findServiceById: mocks.repo.findServiceById,
  deleteQuestion: mocks.repo.deleteQuestion,
  findVersionByQuestion: mocks.repo.findVersionByQuestion,
  listDatasets: mocks.repo.listDatasets,
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

vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: mocks.validateUploadedObject,
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/shared/constants/profile-fields", () => ({
  PROFILE_SOURCE_FIELDS: ["first_name", "last_name", "email"],
}));

vi.mock("@/shared/constants/ai-models", () => ({
  GENERATION_MODELS: ["claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5"],
}));

// ---------------------------------------------------------------------------
// SUT imports — after all mocks
// ---------------------------------------------------------------------------

import type { Actor } from "@/backend/platform/authz";
import {
  createAutomationVersion,
  createDatasetItem,
  updateDataset,
  updateDatasetItem,
  testGeneration,
  deleteQuestion,
  aiProposeStructure,
  listDatasets,
} from "../service";
import { validateExtractionSchema } from "../domain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = "22222222-2222-4222-8222-222222222222";

function makeActor(): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: ORG_ID,
    kind: "staff",
    role: "admin",
    permissions: new Map(),
  };
}

function makeAnotherActor(): Actor {
  return { ...makeActor(), orgId: "99999999-9999-4999-8999-999999999999" };
}

function makePdfFormRow() {
  return {
    id: "form-id-111",
    service_phase_id: "phase-id-111",
    slug: "i-765",
    kind: "pdf_automation",
    label_i18n: { es: "I-765", en: "I-765" },
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
  return new TextEncoder().encode("%PDF-1.4 fake content");
}

function makePhaseRow() {
  return { id: "phase-id-111", service_id: "service-id-111", slug: "main", label_i18n: {}, position: 0 };
}

function makeServiceRow(orgId = ORG_ID) {
  return { id: "service-id-111", org_id: orgId, slug: "i-765", label_i18n: {}, is_active: true };
}

// ---------------------------------------------------------------------------
// H-1 — createAutomationVersion path isolation
// ---------------------------------------------------------------------------

describe("H-1 — createAutomationVersion path isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
  });

  it("throws CATALOG_PDF_INVALID_PATH when path does not start with forms/{form_id}/", async () => {
    await expect(
      createAutomationVersion(makeActor(), {
        form_definition_id: "form-id-111",
        uploaded_pdf_path: "datasets/other-entity/victim.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_PDF_INVALID_PATH" });

    // validateUploadedObject must NOT be called — path rejected before hitting storage
    expect(mocks.validateUploadedObject).not.toHaveBeenCalled();
  });

  it("throws CATALOG_PDF_INVALID_PATH for path of a different form", async () => {
    await expect(
      createAutomationVersion(makeActor(), {
        form_definition_id: "form-id-111",
        uploaded_pdf_path: "forms/form-id-DIFFERENT/v1/f.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_PDF_INVALID_PATH" });
  });

  it("throws CATALOG_PDF_UNREADABLE when validateUploadedObject returns !ok", async () => {
    mocks.validateUploadedObject.mockResolvedValue({
      ok: false,
      reason: "File magic bytes do not match PDF extension.",
    });

    await expect(
      createAutomationVersion(makeActor(), {
        form_definition_id: "form-id-111",
        uploaded_pdf_path: "forms/form-id-111/v1/not-a-pdf.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_PDF_UNREADABLE" });
  });

  it("passes validateUploadedObject for a correctly scoped path", async () => {
    mocks.validateUploadedObject.mockResolvedValue({ ok: true });
    mocks.repo.listVersions.mockResolvedValue([]);
    mocks.repo.insertAutomationVersion.mockResolvedValue(makeDraftVersion());
    mocks.repo.findVersionById.mockResolvedValue(makeDraftVersion());
    const pdfBytes = makePdfBytes();
    mocks.storageDownload.mockResolvedValue({ data: new Blob([pdfBytes.buffer as ArrayBuffer]), error: null });
    mocks.detectAcroFields.mockResolvedValue([]);
    mocks.repo.updateVersion.mockResolvedValue(makeDraftVersion());

    await createAutomationVersion(makeActor(), {
      form_definition_id: "form-id-111",
      uploaded_pdf_path: "forms/form-id-111/1234567890-i765.pdf",
    });

    expect(mocks.validateUploadedObject).toHaveBeenCalledWith(
      "catalog-assets",
      "forms/form-id-111/1234567890-i765.pdf",
      "catalog-assets",
    );
  });
});

// ---------------------------------------------------------------------------
// H-2 — createDatasetItem / updateDatasetItem file_path isolation
// ---------------------------------------------------------------------------

describe("H-2 — dataset item file_path isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
    // M-1 stubs for updateDatasetItem
    mocks.repo.findDatasetItem.mockResolvedValue({ id: "item-1", dataset_id: "ds-1" });
    mocks.repo.findDataset.mockResolvedValue({ id: "ds-1", org_id: ORG_ID });
  });

  it("createDatasetItem: throws CATALOG_FILE_PATH_INVALID for cross-dataset path", async () => {
    await expect(
      createDatasetItem(makeActor(), {
        dataset_id: "ds-1",
        title: "Rogue",
        file_path: "datasets/ds-DIFFERENT/victim.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FILE_PATH_INVALID" });

    expect(mocks.validateUploadedObject).not.toHaveBeenCalled();
  });

  it("createDatasetItem: validates storage object for correctly scoped file_path", async () => {
    mocks.validateUploadedObject.mockResolvedValue({ ok: true });
    mocks.repo.insertDatasetItem.mockResolvedValue({
      id: "item-1",
      dataset_id: "ds-1",
      title: "Doc",
      file_path: "datasets/ds-1/doc.pdf",
      content: null,
      token_count: null,
    });

    await createDatasetItem(makeActor(), {
      dataset_id: "ds-1",
      title: "Doc",
      file_path: "datasets/ds-1/doc.pdf",
    });

    expect(mocks.validateUploadedObject).toHaveBeenCalledWith(
      "catalog-assets",
      "datasets/ds-1/doc.pdf",
      "catalog-assets",
    );
  });

  it("createDatasetItem: throws CATALOG_PDF_UNREADABLE when storage validation fails", async () => {
    mocks.validateUploadedObject.mockResolvedValue({ ok: false, reason: "Not a PDF." });

    await expect(
      createDatasetItem(makeActor(), {
        dataset_id: "ds-1",
        title: "Bad",
        file_path: "datasets/ds-1/bad.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_PDF_UNREADABLE" });
  });

  it("updateDatasetItem: throws CATALOG_FILE_PATH_INVALID for cross-dataset path", async () => {
    await expect(
      updateDatasetItem(makeActor(), "item-1", {
        file_path: "datasets/ds-DIFFERENT/victim.pdf",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FILE_PATH_INVALID" });
  });
});

// ---------------------------------------------------------------------------
// H-3 — validateExtractionSchema: raw_text reserved field (domain)
// ---------------------------------------------------------------------------

describe("H-3 — validateExtractionSchema raw_text reserved field", () => {
  it("rejects a schema with raw_text in top-level properties", () => {
    const schema = {
      type: "object",
      properties: {
        raw_text: { type: "string" },
        first_name: { type: "string" },
      },
    };
    const result = validateExtractionSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("raw_text");
    expect(result.reason).toContain("reservado");
  });

  it("accepts a schema without raw_text", () => {
    const schema = {
      type: "object",
      properties: {
        first_name: { type: "string", description: "First name" },
        dob: { type: "string", description: "Date of birth" },
      },
      required: ["first_name"],
    };
    expect(validateExtractionSchema(schema)).toEqual({ valid: true });
  });

  it("rejects raw_text inside a nested array items schema", () => {
    const schema = {
      type: "object",
      properties: {
        records: {
          type: "array",
          items: {
            type: "object",
            properties: {
              raw_text: { type: "string" },
            },
          },
        },
      },
    };
    const result = validateExtractionSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("raw_text");
  });
});

// ---------------------------------------------------------------------------
// M-1 — updateDataset / updateDatasetItem org ownership
// ---------------------------------------------------------------------------

describe("M-1 — updateDataset org ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("throws CATALOG_DATASET_NOT_FOUND when dataset belongs to another org", async () => {
    mocks.repo.findDataset.mockResolvedValue({ id: "ds-other", org_id: "other-org" });

    await expect(
      updateDataset(makeActor(), "ds-other", { name: "Rename" }),
    ).rejects.toMatchObject({ code: "CATALOG_DATASET_NOT_FOUND" });

    expect(mocks.repo.updateDataset).not.toHaveBeenCalled();
  });

  it("throws CATALOG_DATASET_NOT_FOUND when dataset does not exist", async () => {
    mocks.repo.findDataset.mockResolvedValue(null);

    await expect(
      updateDataset(makeActor(), "ghost-id", { name: "x" }),
    ).rejects.toMatchObject({ code: "CATALOG_DATASET_NOT_FOUND" });
  });

  it("succeeds when dataset org matches actor org", async () => {
    mocks.repo.findDataset.mockResolvedValue({ id: "ds-1", org_id: ORG_ID });
    mocks.repo.updateDataset.mockResolvedValue({ id: "ds-1", org_id: ORG_ID, name: "Renamed" });

    const result = await updateDataset(makeActor(), "ds-1", { name: "Renamed" });
    expect(result).toBeDefined();
    expect(mocks.repo.updateDataset).toHaveBeenCalledOnce();
  });
});

describe("M-1 — updateDatasetItem org ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("throws CATALOG_DATASET_NOT_FOUND when item's dataset belongs to another org", async () => {
    mocks.repo.findDatasetItem.mockResolvedValue({ id: "item-1", dataset_id: "ds-other" });
    mocks.repo.findDataset.mockResolvedValue({ id: "ds-other", org_id: "other-org-id" });

    await expect(
      updateDatasetItem(makeActor(), "item-1", { title: "Steal" }),
    ).rejects.toMatchObject({ code: "CATALOG_DATASET_NOT_FOUND" });

    expect(mocks.repo.updateDatasetItem).not.toHaveBeenCalled();
  });

  it("throws CATALOG_DATASET_NOT_FOUND when item does not exist", async () => {
    mocks.repo.findDatasetItem.mockResolvedValue(null);

    await expect(
      updateDatasetItem(makeActor(), "ghost-item", { title: "x" }),
    ).rejects.toMatchObject({ code: "CATALOG_DATASET_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// M-2 — testGeneration org ownership check
// ---------------------------------------------------------------------------

describe("M-2 — testGeneration org ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
  });

  it("throws CATALOG_FORM_NOT_FOUND when form belongs to another org", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
    mocks.repo.findPhaseById.mockResolvedValue(makePhaseRow());
    // service has a different org_id
    mocks.repo.findServiceById.mockResolvedValue(makeServiceRow("other-org-id"));

    await expect(
      testGeneration(makeActor(), {
        form_definition_id: "form-id-111",
        case_id: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FORM_NOT_FOUND" });

    expect(mocks.aiEngine.startGeneration).not.toHaveBeenCalled();
  });

  it("throws CATALOG_FORM_NOT_FOUND when form itself does not exist", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(null);

    await expect(
      testGeneration(makeActor(), {
        form_definition_id: "nonexistent",
        case_id: "33333333-3333-4333-8333-333333333333",
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FORM_NOT_FOUND" });
  });

  it("proceeds past org check when form matches actor org", async () => {
    mocks.repo.findFormDefinition.mockResolvedValue(makePdfFormRow());
    mocks.repo.findPhaseById.mockResolvedValue(makePhaseRow());
    mocks.repo.findServiceById.mockResolvedValue(makeServiceRow(ORG_ID));
    mocks.repo.findGenerationConfig.mockResolvedValue({
      form_definition_id: "form-id-111",
      system_prompt: "...",
      model: "claude-fable-5",
    });
    mocks.aiEngine.startGeneration.mockResolvedValue({
      run: { id: "run-111", status: "queued" },
    });

    const result = await testGeneration(makeActor(), {
      form_definition_id: "form-id-111",
      case_id: "33333333-3333-4333-8333-333333333333",
    });

    expect(result).toEqual({ run_id: "run-111" });
    expect(mocks.aiEngine.startGeneration).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// M-3 — deleteQuestion version status guard
// ---------------------------------------------------------------------------

describe("M-3 — deleteQuestion version status guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("throws CATALOG_VERSION_PUBLISHED_IMMUTABLE for question on a published version", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(
      makeDraftVersion({ status: "published" }),
    );

    await expect(deleteQuestion(makeActor(), "q-1")).rejects.toMatchObject({
      code: "CATALOG_VERSION_PUBLISHED_IMMUTABLE",
    });

    expect(mocks.repo.deleteQuestion).not.toHaveBeenCalled();
  });

  it("throws CATALOG_VERSION_PUBLISHED_IMMUTABLE for question on an archived version", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(
      makeDraftVersion({ status: "archived" }),
    );

    await expect(deleteQuestion(makeActor(), "q-2")).rejects.toMatchObject({
      code: "CATALOG_VERSION_PUBLISHED_IMMUTABLE",
    });
  });

  it("deletes successfully when version is draft", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(makeDraftVersion());
    mocks.repo.deleteQuestion.mockResolvedValue(undefined);

    await deleteQuestion(makeActor(), "q-draft");

    expect(mocks.repo.deleteQuestion).toHaveBeenCalledWith("q-draft");
  });

  it("still deletes if question/version not found (orphaned question)", async () => {
    // findVersionByQuestion returns null → no version → guard is skipped
    mocks.repo.findVersionByQuestion.mockResolvedValue(null);
    mocks.repo.deleteQuestion.mockResolvedValue(undefined);

    await deleteQuestion(makeActor(), "orphan-q");

    expect(mocks.repo.deleteQuestion).toHaveBeenCalledWith("orphan-q");
  });
});

// ---------------------------------------------------------------------------
// M-4 — aiProposeStructure: AI call BEFORE delete (ordering invariant)
// ---------------------------------------------------------------------------

describe("M-4 — aiProposeStructure: AI-first, delete-after ordering", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
    mocks.writeAudit.mockResolvedValue(undefined);
  });

  it("does NOT delete existing groups when AI call fails", async () => {
    const existingGroups = [{ id: "old-group-1" }, { id: "old-group-2" }];
    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "F1", field_type: "text", page: 1 }],
    });
    mocks.aiEngine.proposeFormSegmentation.mockRejectedValue(
      new Error("AI_OUTPUT_INVALID: could not parse response after 2 attempts"),
    );
    // If delete were called before AI, this would be invoked
    mocks.repo.listQuestionGroups.mockResolvedValue(existingGroups);

    await expect(
      aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" }),
    ).rejects.toThrow();

    // Critical: groups must NOT have been deleted (AI failed, so version state preserved)
    expect(mocks.repo.deleteQuestionGroup).not.toHaveBeenCalled();
  });

  it("deletes groups AFTER successful AI call in replace mode", async () => {
    const existingGroups = [{ id: "old-group-1" }];
    const callOrder: string[] = [];

    mocks.repo.findVersionById.mockResolvedValue({
      ...makeDraftVersion(),
      detected_fields: [{ pdf_field_name: "F1", field_type: "text", page: 1 }],
    });
    mocks.aiEngine.proposeFormSegmentation.mockImplementation(async () => {
      callOrder.push("ai_called");
      return { groups: [{ title_i18n: { es: "S", en: "S" }, position: 0, questions: [] }] };
    });
    mocks.repo.listQuestionGroups.mockResolvedValue(existingGroups);
    mocks.repo.deleteQuestionGroup.mockImplementation(async () => {
      callOrder.push("group_deleted");
      return undefined;
    });
    mocks.repo.upsertQuestionGroup.mockResolvedValue({ id: "new-group-1" });

    await aiProposeStructure(makeActor(), { version_id: "version-id-111", mode: "replace" });

    // AI must be called before deletion
    expect(callOrder[0]).toBe("ai_called");
    expect(callOrder[1]).toBe("group_deleted");
    expect(mocks.repo.deleteQuestionGroup).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// M-5 — listDatasets accepts Actor
// ---------------------------------------------------------------------------

describe("M-5 — listDatasets accepts Actor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.can.mockReturnValue(undefined);
  });

  it("calls can(actor, datasets, view) and queries by actor.orgId", async () => {
    const rows = [{ id: "ds-1", org_id: ORG_ID, name: "Dataset A" }];
    mocks.repo.listDatasets.mockResolvedValue(rows);

    const result = await listDatasets(makeActor());

    expect(mocks.can).toHaveBeenCalledWith(makeActor(), "datasets", "view");
    expect(mocks.repo.listDatasets).toHaveBeenCalledWith(ORG_ID);
    expect(result).toBe(rows);
  });

  it("another org actor gets different dataset scope", async () => {
    const otherActor = makeAnotherActor();
    mocks.repo.listDatasets.mockResolvedValue([]);

    await listDatasets(otherActor);

    expect(mocks.repo.listDatasets).toHaveBeenCalledWith(otherActor.orgId);
    expect(mocks.repo.listDatasets).not.toHaveBeenCalledWith(ORG_ID);
  });
});
