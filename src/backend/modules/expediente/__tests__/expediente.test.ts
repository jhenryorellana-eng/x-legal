/**
 * Expediente module — TDD tests (F5).
 *
 * Covers:
 * - domain: canTransitionExpediente, isEditableStatus, canonicalClientLabel, validateItemRef
 * - service: createExpediente (attempt_no increment + one-draft guard)
 * - service: addItem (ref validation + EXPEDIENTE_NOT_EDITABLE)
 * - service: removeItem (item deletion + renumbering)
 * - service: reorderItems (position reassignment)
 * - service: compileExpediente (resolves sources, calls compileExpedientePdf, uploads, compiled + page_count, emits event)
 * - service: compileExpediente (compile_failed path on error)
 * - service: createCorrectionAttempt (clones items + attempt_no+1)
 * - service: generateCover (canonical label via getCaseWorkspace + renderCoverPdf + upload)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  canTransitionExpediente,
  isEditableStatus,
  canonicalClientLabel,
  validateItemRef,
  type ExpedienteStatus,
} from "../domain";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockRequireCaseAccess,
  // Repository mocks
  mockListActiveCoverTemplates,
  mockFindCoverTemplateById,
  mockInsertCoverRender,
  mockListCoverRendersForCase,
  mockFindExpedienteById,
  mockListExpedientesForCase,
  mockMaxAttemptNoForCase,
  mockFindDraftExpedienteForCase,
  mockInsertExpediente,
  mockUpdateExpediente,
  mockListItemsForExpediente,
  mockMaxItemPositionForExpediente,
  mockFindItemById,
  mockInsertItem,
  mockDeleteItem,
  mockUpdateItemPosition,
  mockUpdateItemPageCount,
  mockUpdateItemMeta,
  mockVerifyCoverRenderExists,
  mockFindGenerationRunById,
  mockFindFormResponseById,
  mockFindCaseDocumentById,
  mockListCoverRendersForMaterial,
  mockListGenerationRunsForMaterial,
  mockListFormResponsesForMaterial,
  mockListApprovedDocumentsForMaterial,
  mockFindCoverRenderById,
  mockListCompletedTranslationsForCase,
  mockFindTranslationById,
  mockCountCoverItemRefs,
  mockDeleteCoverRender,
  mockProposeExpedienteAssembly,
  // Audit mock
  mockWriteAudit,
  // Events mock
  mockEmitExpedienteCompiled,
  mockEmitExpedienteSentToFinance,
  // Platform mocks
  mockUploadBytesToStorage,
  mockCreateSignedUploadUrl,
  mockCreateSignedDownloadUrl,
  mockValidateUploadedObject,
  mockRenderCoverPdf,
  mockCompileExpedientePdf,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  // Repository
  mockListActiveCoverTemplates: vi.fn().mockResolvedValue([]),
  mockFindCoverTemplateById: vi.fn().mockResolvedValue(null),
  mockInsertCoverRender: vi.fn(),
  mockListCoverRendersForCase: vi.fn().mockResolvedValue([]),
  mockFindExpedienteById: vi.fn().mockResolvedValue(null),
  mockListExpedientesForCase: vi.fn().mockResolvedValue([]),
  mockMaxAttemptNoForCase: vi.fn().mockResolvedValue(0),
  mockFindDraftExpedienteForCase: vi.fn().mockResolvedValue(null),
  mockInsertExpediente: vi.fn(),
  mockUpdateExpediente: vi.fn().mockResolvedValue(undefined),
  mockListItemsForExpediente: vi.fn().mockResolvedValue([]),
  mockMaxItemPositionForExpediente: vi.fn().mockResolvedValue(0),
  mockFindItemById: vi.fn().mockResolvedValue(null),
  mockInsertItem: vi.fn(),
  mockDeleteItem: vi.fn().mockResolvedValue(undefined),
  mockUpdateItemPosition: vi.fn().mockResolvedValue(undefined),
  mockUpdateItemPageCount: vi.fn().mockResolvedValue(undefined),
  mockUpdateItemMeta: vi.fn().mockResolvedValue(undefined),
  mockVerifyCoverRenderExists: vi.fn().mockResolvedValue(true),
  mockFindGenerationRunById: vi.fn().mockResolvedValue(null),
  mockFindFormResponseById: vi.fn().mockResolvedValue(null),
  mockFindCaseDocumentById: vi.fn().mockResolvedValue(null),
  mockListCoverRendersForMaterial: vi.fn().mockResolvedValue([]),
  mockListGenerationRunsForMaterial: vi.fn().mockResolvedValue([]),
  mockListFormResponsesForMaterial: vi.fn().mockResolvedValue([]),
  mockListApprovedDocumentsForMaterial: vi.fn().mockResolvedValue([]),
  mockFindCoverRenderById: vi.fn().mockResolvedValue(null),
  mockListCompletedTranslationsForCase: vi.fn().mockResolvedValue([]),
  mockFindTranslationById: vi.fn().mockResolvedValue(null),
  mockCountCoverItemRefs: vi.fn().mockResolvedValue(0),
  mockDeleteCoverRender: vi.fn().mockResolvedValue(undefined),
  mockProposeExpedienteAssembly: vi.fn(),
  // Audit
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  // Events
  mockEmitExpedienteCompiled: vi.fn(),
  mockEmitExpedienteSentToFinance: vi.fn(),
  // Platform
  mockUploadBytesToStorage: vi.fn().mockResolvedValue("some/path.pdf"),
  mockCreateSignedUploadUrl: vi.fn().mockResolvedValue({ signedUrl: "https://upload.url", path: "some/path.pdf" }),
  mockCreateSignedDownloadUrl: vi.fn().mockResolvedValue("https://download.url"),
  mockValidateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
  mockRenderCoverPdf: vi.fn().mockResolvedValue(new Uint8Array([37, 80, 68, 70])), // %PDF
  mockCompileExpedientePdf: vi.fn().mockResolvedValue({
    pdf: new Uint8Array([37, 80, 68, 70]),
    pageCount: 10,
    toc: [{ title: "Cover", startPage: 2, pageCount: 1 }],
  }),
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
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        download: vi.fn().mockResolvedValue({
          data: new Blob([new Uint8Array([37, 80, 68, 70])]),
          error: null,
        }),
      })),
    },
  })),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  uploadBytesToStorage: mockUploadBytesToStorage,
  createSignedUploadUrl: mockCreateSignedUploadUrl,
  createSignedDownloadUrl: mockCreateSignedDownloadUrl,
  validateUploadedObject: mockValidateUploadedObject,
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderCoverPdf: mockRenderCoverPdf,
  compileExpedientePdf: mockCompileExpedientePdf,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../events", () => ({
  emitExpedienteCompiled: mockEmitExpedienteCompiled,
  emitExpedienteSentToFinance: mockEmitExpedienteSentToFinance,
  registerExpedienteConsumers: vi.fn(),
}));

vi.mock("../repository", () => ({
  listActiveCoverTemplates: mockListActiveCoverTemplates,
  findCoverTemplateById: mockFindCoverTemplateById,
  insertCoverRender: mockInsertCoverRender,
  listCoverRendersForCase: mockListCoverRendersForCase,
  findExpedienteById: mockFindExpedienteById,
  listExpedientesForCase: mockListExpedientesForCase,
  maxAttemptNoForCase: mockMaxAttemptNoForCase,
  findDraftExpedienteForCase: mockFindDraftExpedienteForCase,
  insertExpediente: mockInsertExpediente,
  updateExpediente: mockUpdateExpediente,
  listItemsForExpediente: mockListItemsForExpediente,
  maxItemPositionForExpediente: mockMaxItemPositionForExpediente,
  findItemById: mockFindItemById,
  insertItem: mockInsertItem,
  deleteItem: mockDeleteItem,
  updateItemPosition: mockUpdateItemPosition,
  updateItemPageCount: mockUpdateItemPageCount,
  updateItemMeta: mockUpdateItemMeta,
  verifyCoverRenderExists: mockVerifyCoverRenderExists,
  findGenerationRunById: mockFindGenerationRunById,
  findFormResponseById: mockFindFormResponseById,
  findCaseDocumentById: mockFindCaseDocumentById,
  listCoverRendersForMaterial: mockListCoverRendersForMaterial,
  listGenerationRunsForMaterial: mockListGenerationRunsForMaterial,
  listFormResponsesForMaterial: mockListFormResponsesForMaterial,
  listApprovedDocumentsForMaterial: mockListApprovedDocumentsForMaterial,
  findCoverRenderById: mockFindCoverRenderById,
  listCompletedTranslationsForCase: mockListCompletedTranslationsForCase,
  findTranslationById: mockFindTranslationById,
  countCoverItemRefs: mockCountCoverItemRefs,
  deleteCoverRender: mockDeleteCoverRender,
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  proposeExpedienteAssembly: mockProposeExpedienteAssembly,
}));

// autoAssembleWithAi pulls ready exhibits to file behind each memo — default to none
// so the existing assembly tests are unaffected; a dedicated test exercises insertion.
vi.mock("@/backend/modules/exhibits", () => ({
  listReadyByCase: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/backend/modules/cases", () => ({
  getCaseWorkspace: vi.fn().mockResolvedValue({
    caseNumber: "U26-000001",
    service: { labelI18n: { es: "Visa de Trabajo", en: "Work Visa" } },
    parties: [
      { id: "00000000-0000-0000-0000-0000000000a1", role: "petitioner", name: "María García" },
    ],
  }),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const EXP_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const TEMPLATE_ID = "44444444-4444-4444-8444-444444444444";
const REF_ID = "55555555-5555-4555-8555-555555555555";

const staffActor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "staff" as const,
  role: "paralegal" as const,
  permissions: new Map(),
};

const _adminActor = {
  ...staffActor,
  role: "admin" as const,
};

const makeExpediente = (status: ExpedienteStatus = "draft", attemptNo = 1) => ({
  id: EXP_ID,
  case_id: CASE_ID,
  attempt_no: attemptNo,
  status,
  built_by: staffActor.userId,
  compiled_pdf_path: status === "compiled" ? "case/111/exp-a1.pdf" : null,
  page_count: status === "compiled" ? 10 : null,
  sent_to_finance_at: null,
  sent_to_finance_by: null,
  printed_at: null,
  printed_by: null,
  shipped_at: null,
  filed_at: null,
  tracking_ref: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
});

const makeItem = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  expediente_id: EXP_ID,
  position: 1,
  item_type: "cover",
  ref_id: REF_ID,
  external_file_path: null,
  title: "Cover Page",
  page_count: null,
  include_in_toc: true,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// DOMAIN — pure functions (no mocks needed)
// ---------------------------------------------------------------------------

describe("domain: canTransitionExpediente", () => {
  it("allows draft → compiling for paralegal", () => {
    expect(canTransitionExpediente("draft", "compiling", "paralegal")).toBeNull();
  });

  it("allows draft → compiling for admin", () => {
    expect(canTransitionExpediente("draft", "compiling", "admin")).toBeNull();
  });

  it("returns EXPEDIENTE_INVALID_TRANSITION for draft → printed", () => {
    expect(canTransitionExpediente("draft", "printed", "admin")).toBe(
      "EXPEDIENTE_INVALID_TRANSITION",
    );
  });

  it("returns EXPEDIENTE_FORBIDDEN_TRANSITION for sales on draft → compiling", () => {
    expect(canTransitionExpediente("draft", "compiling", "sales")).toBe(
      "EXPEDIENTE_FORBIDDEN_TRANSITION",
    );
  });

  it("allows compiling → compiled", () => {
    expect(canTransitionExpediente("compiling", "compiled", "paralegal")).toBeNull();
  });

  it("allows compiling → compile_failed", () => {
    expect(canTransitionExpediente("compiling", "compile_failed", "paralegal")).toBeNull();
  });

  it("allows compile_failed → compiling (retry)", () => {
    expect(canTransitionExpediente("compile_failed", "compiling", "paralegal")).toBeNull();
  });

  it("allows compiled → ready (paralegal marks 'Listo')", () => {
    expect(canTransitionExpediente("compiled", "ready", "paralegal")).toBeNull();
  });

  it("allows ready → sent_to_finance (self handoff)", () => {
    expect(canTransitionExpediente("ready", "sent_to_finance", "paralegal")).toBeNull();
  });

  it("allows ready → sent_to_lawyer (with_lawyer handoff)", () => {
    expect(canTransitionExpediente("ready", "sent_to_lawyer", "paralegal")).toBeNull();
  });

  it("no longer allows compiled → sent_to_finance directly (must go via ready)", () => {
    expect(canTransitionExpediente("compiled", "sent_to_finance", "paralegal")).toBe(
      "EXPEDIENTE_INVALID_TRANSITION",
    );
  });

  it("allows sent_to_lawyer → approved", () => {
    expect(canTransitionExpediente("sent_to_lawyer", "approved", "paralegal")).toBeNull();
  });

  it("allows sent_to_lawyer → corrections_needed", () => {
    expect(canTransitionExpediente("sent_to_lawyer", "corrections_needed", "paralegal")).toBeNull();
  });

  it("allows approved → sent_to_finance for finance role", () => {
    expect(canTransitionExpediente("approved", "sent_to_finance", "finance")).toBeNull();
  });

  it("allows sent_to_finance → printed for finance role", () => {
    expect(canTransitionExpediente("sent_to_finance", "printed", "finance")).toBeNull();
  });

  it("forbids sent_to_finance → printed for paralegal", () => {
    expect(canTransitionExpediente("sent_to_finance", "printed", "paralegal")).toBe(
      "EXPEDIENTE_FORBIDDEN_TRANSITION",
    );
  });

  it("admin always allowed (even for restricted transitions)", () => {
    expect(canTransitionExpediente("sent_to_finance", "printed", "admin")).toBeNull();
    expect(canTransitionExpediente("approved", "sent_to_finance", "admin")).toBeNull();
  });
});

describe("domain: isEditableStatus", () => {
  it("returns true for draft", () => {
    expect(isEditableStatus("draft")).toBe(true);
  });

  it("returns true for corrections_needed", () => {
    expect(isEditableStatus("corrections_needed")).toBe(true);
  });

  it("returns false for compiling", () => {
    expect(isEditableStatus("compiling")).toBe(false);
  });

  it("returns false for compiled", () => {
    expect(isEditableStatus("compiled")).toBe(false);
  });

  it("returns false for approved", () => {
    expect(isEditableStatus("approved")).toBe(false);
  });

  it("returns false for printed", () => {
    expect(isEditableStatus("printed")).toBe(false);
  });
});

describe("domain: canonicalClientLabel", () => {
  it("produces '{initial}. {lastName}' from first and last name", () => {
    expect(canonicalClientLabel("María", "García")).toBe("M. García");
  });

  it("uppercases the initial", () => {
    expect(canonicalClientLabel("juan", "López")).toBe("J. López");
  });

  it("handles multi-word first name (takes first char)", () => {
    expect(canonicalClientLabel("Ana María", "Torres")).toBe("A. Torres");
  });

  it("handles empty strings gracefully", () => {
    expect(canonicalClientLabel("", "Pérez")).toBe(". Pérez");
  });
});

describe("domain: validateItemRef", () => {
  it("accepts cover with refId", () => {
    expect(validateItemRef("cover", REF_ID, null).ok).toBe(true);
  });

  it("rejects cover without refId", () => {
    expect(validateItemRef("cover", null, null).ok).toBe(false);
  });

  it("rejects cover with externalFilePath", () => {
    expect(validateItemRef("cover", REF_ID, "some/path.pdf").ok).toBe(false);
  });

  it("accepts external_file with path, no refId", () => {
    expect(validateItemRef("external_file", null, "some/path.pdf").ok).toBe(true);
  });

  it("rejects external_file without path", () => {
    expect(validateItemRef("external_file", null, null).ok).toBe(false);
  });

  it("rejects external_file with refId", () => {
    expect(validateItemRef("external_file", REF_ID, "some/path.pdf").ok).toBe(false);
  });

  it("accepts ai_generation with refId", () => {
    expect(validateItemRef("ai_generation", REF_ID, null).ok).toBe(true);
  });

  it("rejects automated_form without refId", () => {
    expect(validateItemRef("automated_form", null, null).ok).toBe(false);
  });

  it("rejects client_document without refId", () => {
    expect(validateItemRef("client_document", "", null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SERVICE — createExpediente
// ---------------------------------------------------------------------------

import {
  createExpediente,
  addItem,
  removeItem,
  reorderItems,
  compileExpediente,
  createCorrectionAttempt,
  generateCover,
  autoAssembleWithAi,
  ExpedienteError,
} from "../service";

describe("service: createExpediente", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindDraftExpedienteForCase.mockResolvedValue(null);
    mockMaxAttemptNoForCase.mockResolvedValue(0);
    mockInsertExpediente.mockResolvedValue(makeExpediente("draft", 1));
  });

  it("creates a draft with attempt_no=1 when no prior attempts", async () => {
    mockMaxAttemptNoForCase.mockResolvedValue(0);

    const result = await createExpediente(staffActor, { caseId: CASE_ID });

    expect(mockInsertExpediente).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: CASE_ID,
        attempt_no: 1,
        status: "draft",
        built_by: staffActor.userId,
      }),
    );
    expect(result.attempt_no).toBe(1);
  });

  it("increments attempt_no when prior attempts exist", async () => {
    mockMaxAttemptNoForCase.mockResolvedValue(2);
    mockInsertExpediente.mockResolvedValue(makeExpediente("draft", 3));

    await createExpediente(staffActor, { caseId: CASE_ID });

    expect(mockInsertExpediente).toHaveBeenCalledWith(
      expect.objectContaining({ attempt_no: 3 }),
    );
  });

  it("throws EXPEDIENTE_DRAFT_EXISTS when a draft already exists", async () => {
    mockFindDraftExpedienteForCase.mockResolvedValue(makeExpediente("draft"));

    await expect(createExpediente(staffActor, { caseId: CASE_ID })).rejects.toThrow(
      ExpedienteError,
    );

    const thrownErr = await createExpediente(staffActor, { caseId: CASE_ID }).catch(
      (e: ExpedienteError) => e,
    );
    expect((thrownErr as ExpedienteError).code).toBe("EXPEDIENTE_DRAFT_EXISTS");
  });

  it("writes audit after creation", async () => {
    await createExpediente(staffActor, { caseId: CASE_ID });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "expediente.created",
      "expedientes",
      expect.any(String),
      expect.objectContaining({ after: expect.objectContaining({ caseId: CASE_ID }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// SERVICE — addItem
// ---------------------------------------------------------------------------

describe("service: addItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindExpedienteById.mockResolvedValue(makeExpediente("draft"));
    mockMaxItemPositionForExpediente.mockResolvedValue(0);
    mockVerifyCoverRenderExists.mockResolvedValue(true);
    mockInsertItem.mockResolvedValue(makeItem());
  });

  it("adds a cover item when expediente is draft", async () => {
    const result = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Cover Page",
    });
    expect(result.item_type).toBe("cover");
    expect(mockInsertItem).toHaveBeenCalledWith(
      expect.objectContaining({
        expediente_id: EXP_ID,
        item_type: "cover",
        ref_id: REF_ID,
        position: 1,
      }),
    );
  });

  it("throws EXPEDIENTE_NOT_EDITABLE when status is compiled", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled"));

    const err = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Test",
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EDITABLE");
  });

  it("throws EXPEDIENTE_NOT_EDITABLE when status is sent_to_lawyer", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("sent_to_lawyer"));

    const err = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Test",
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EDITABLE");
  });

  it("accepts addItem when status is corrections_needed", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("corrections_needed"));
    mockInsertItem.mockResolvedValue(makeItem());

    const result = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Cover",
    });
    expect(result).toBeDefined();
  });

  it("throws EXPEDIENTE_ITEM_REF_INVALID for external_file without path", async () => {
    const err = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "external_file",
      title: "External",
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_ITEM_REF_INVALID");
  });

  it("throws EXPEDIENTE_ITEM_REF_INVALID when cover_render not found", async () => {
    mockVerifyCoverRenderExists.mockResolvedValue(false);

    const err = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Cover",
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_ITEM_REF_INVALID");
  });

  it("validates ai_generation ref exists", async () => {
    mockFindGenerationRunById.mockResolvedValue(null);

    const err = await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "ai_generation",
      refId: REF_ID,
      title: "AI Generation",
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_ITEM_REF_INVALID");
  });

  it("positions at max+1", async () => {
    mockMaxItemPositionForExpediente.mockResolvedValue(5);
    mockInsertItem.mockResolvedValue(makeItem({ position: 6 }));

    await addItem(staffActor, {
      expedienteId: EXP_ID,
      itemType: "cover",
      refId: REF_ID,
      title: "Cover",
    });

    expect(mockInsertItem).toHaveBeenCalledWith(
      expect.objectContaining({ position: 6 }),
    );
  });
});

// ---------------------------------------------------------------------------
// SERVICE — removeItem
// ---------------------------------------------------------------------------

describe("service: removeItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindItemById.mockResolvedValue(makeItem());
    mockFindExpedienteById.mockResolvedValue(makeExpediente("draft"));
    mockListItemsForExpediente.mockResolvedValue([]);
  });

  it("deletes the item and renumbers remaining", async () => {
    const item2 = makeItem({ id: "item-2", position: 2 });
    const item3 = makeItem({ id: "item-3", position: 3 });
    mockListItemsForExpediente.mockResolvedValue([item2, item3]);

    await removeItem(staffActor, ITEM_ID);

    expect(mockDeleteItem).toHaveBeenCalledWith(ITEM_ID);
    // item2 is already at position 1, no update needed; item3 moves from 3 to 2
    expect(mockUpdateItemPosition).toHaveBeenCalledWith("item-3", 2);
  });

  it("throws EXPEDIENTE_NOT_EDITABLE when compiled", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled"));

    const err = await removeItem(staffActor, ITEM_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EDITABLE");
  });

  it("throws EXPEDIENTE_ITEM_NOT_FOUND when item does not exist", async () => {
    mockFindItemById.mockResolvedValue(null);

    const err = await removeItem(staffActor, ITEM_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_ITEM_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// SERVICE — reorderItems
// ---------------------------------------------------------------------------

describe("service: reorderItems", () => {
  const ITEM_A = "aaaaaaaa-1111-4111-8111-111111111111";
  const ITEM_B = "bbbbbbbb-2222-4222-8222-222222222222";
  const ITEM_C = "cccccccc-3333-4333-8333-333333333333";

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindExpedienteById.mockResolvedValue(makeExpediente("draft"));
    mockUpdateItemPosition.mockResolvedValue(undefined);
  });

  it("sets positions in array order via two-phase update", async () => {
    await reorderItems(staffActor, {
      expedienteId: EXP_ID,
      orderedItemIds: [ITEM_C, ITEM_A, ITEM_B],
    });

    // Phase 1: negative temps
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_C, -1000);
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_A, -2000);
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_B, -3000);
    // Phase 2: final positions
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_C, 1);
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_A, 2);
    expect(mockUpdateItemPosition).toHaveBeenCalledWith(ITEM_B, 3);
  });

  it("throws EXPEDIENTE_NOT_EDITABLE when status is approved", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("approved"));

    const err = await reorderItems(staffActor, {
      expedienteId: EXP_ID,
      orderedItemIds: [ITEM_A],
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EDITABLE");
  });
});

// ---------------------------------------------------------------------------
// SERVICE — compileExpediente (happy path)
// ---------------------------------------------------------------------------

describe("service: compileExpediente — happy path", () => {
  const COVER_ITEM = makeItem({
    id: "item-cover",
    item_type: "cover",
    ref_id: REF_ID,
    title: "Cover",
    include_in_toc: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindExpedienteById.mockResolvedValue(makeExpediente("draft"));
    mockListItemsForExpediente.mockResolvedValue([COVER_ITEM]);
    mockFindCoverRenderById.mockResolvedValue({
      id: REF_ID,
      case_id: CASE_ID,
      pdf_path: "case/111/covers/cover-uuid.pdf",
      data: {},
      template_id: null,
      created_by: staffActor.userId,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
    mockCompileExpedientePdf.mockResolvedValue({
      pdf: new Uint8Array([37, 80, 68, 70]),
      pageCount: 5,
      toc: [{ title: "Cover", startPage: 2, pageCount: 1 }],
    });
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockUploadBytesToStorage.mockResolvedValue("case/111/exp-a1.pdf");
  });

  it("sets status to compiling, then compiled after success", async () => {
    await compileExpediente(staffActor, EXP_ID);

    // First call: set compiling
    expect(mockUpdateExpediente).toHaveBeenNthCalledWith(
      1,
      EXP_ID,
      expect.objectContaining({ status: "compiling" }),
    );
    // Second call: set compiled with pdf path and page count
    expect(mockUpdateExpediente).toHaveBeenNthCalledWith(
      2,
      EXP_ID,
      expect.objectContaining({
        status: "compiled",
        page_count: 5,
      }),
    );
  });

  it("calls compileExpedientePdf with resolved items", async () => {
    await compileExpediente(staffActor, EXP_ID);

    expect(mockCompileExpedientePdf).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Cover",
          includeInToc: true,
          mimeType: "application/pdf",
        }),
      ]),
    );
  });

  it("uploads the compiled PDF to expedientes bucket", async () => {
    await compileExpediente(staffActor, EXP_ID);

    expect(mockUploadBytesToStorage).toHaveBeenCalledWith(
      "expedientes",
      expect.stringContaining("case/"),
      expect.any(Uint8Array),
      "application/pdf",
    );
  });

  it("emits expediente.compiled event", async () => {
    await compileExpediente(staffActor, EXP_ID);

    expect(mockEmitExpedienteCompiled).toHaveBeenCalledWith({
      caseId: CASE_ID,
      expedienteId: EXP_ID,
      attemptNo: 1,
    });
  });

  it("updates item page counts from TOC", async () => {
    mockCompileExpedientePdf.mockResolvedValue({
      pdf: new Uint8Array([37, 80, 68, 70]),
      pageCount: 5,
      toc: [{ title: "Cover", startPage: 2, pageCount: 1 }],
    });

    await compileExpediente(staffActor, EXP_ID);

    expect(mockUpdateItemPageCount).toHaveBeenCalledWith("item-cover", 1);
  });

  it("returns compiledPdfPath and pageCount", async () => {
    const result = await compileExpediente(staffActor, EXP_ID);

    expect(result.pageCount).toBe(5);
    expect(result.compiledPdfPath).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// SERVICE — compileExpediente (failure path)
// ---------------------------------------------------------------------------

describe("service: compileExpediente — compile_failed path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindExpedienteById.mockResolvedValue(makeExpediente("draft"));
    mockListItemsForExpediente.mockResolvedValue([makeItem()]);
    mockFindCoverRenderById.mockResolvedValue({
      id: REF_ID,
      case_id: CASE_ID,
      pdf_path: "case/111/covers/cover.pdf",
      data: {},
      template_id: null,
      created_by: staffActor.userId,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
  });

  it("sets status=compile_failed when compileExpedientePdf throws", async () => {
    mockCompileExpedientePdf.mockRejectedValue(new Error("mupdf failed"));

    await expect(compileExpediente(staffActor, EXP_ID)).rejects.toThrow(ExpedienteError);

    // Should have set compiling, then compile_failed
    const calls = mockUpdateExpediente.mock.calls;
    expect(calls[0][1]).toMatchObject({ status: "compiling" });
    expect(calls[1][1]).toMatchObject({ status: "compile_failed" });
  });

  it("throws EXPEDIENTE_COMPILE_FAILED on error", async () => {
    mockCompileExpedientePdf.mockRejectedValue(new Error("boom"));

    const err = await compileExpediente(staffActor, EXP_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_COMPILE_FAILED");
  });

  it("throws EXPEDIENTE_NOT_COMPILABLE when status is compiled", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled"));

    const err = await compileExpediente(staffActor, EXP_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_COMPILABLE");
  });

  it("does NOT emit event on failure", async () => {
    mockCompileExpedientePdf.mockRejectedValue(new Error("boom"));

    await compileExpediente(staffActor, EXP_ID).catch(() => {});
    expect(mockEmitExpedienteCompiled).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SERVICE — createCorrectionAttempt
// ---------------------------------------------------------------------------

describe("service: createCorrectionAttempt", () => {
  const sourceItems = [
    makeItem({ id: "src-item-1", position: 1, title: "Cover" }),
    makeItem({ id: "src-item-2", position: 2, title: "Form", item_type: "automated_form", ref_id: REF_ID }),
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindExpedienteById.mockResolvedValue(makeExpediente("corrections_needed", 1));
    mockListItemsForExpediente.mockResolvedValue(sourceItems);
    mockInsertExpediente.mockResolvedValue(makeExpediente("draft", 2));
    mockInsertItem.mockResolvedValue(makeItem());
  });

  it("inserts a new expediente with attempt_no+1 and status=draft", async () => {
    await createCorrectionAttempt(staffActor, EXP_ID);

    expect(mockInsertExpediente).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: CASE_ID,
        attempt_no: 2,
        status: "draft",
        built_by: staffActor.userId,
      }),
    );
  });

  it("clones all source items into the new expediente", async () => {
    await createCorrectionAttempt(staffActor, EXP_ID);

    // Both items should be inserted (cloned)
    expect(mockInsertItem).toHaveBeenCalledTimes(2);
    expect(mockInsertItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Cover", position: 1 }),
    );
    expect(mockInsertItem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Form", position: 2, item_type: "automated_form" }),
    );
  });

  it("throws EXPEDIENTE_NOT_EDITABLE when source is not corrections_needed", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled"));

    const err = await createCorrectionAttempt(staffActor, EXP_ID).catch(
      (e: ExpedienteError) => e,
    );
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EDITABLE");
  });

  it("writes audit log", async () => {
    await createCorrectionAttempt(staffActor, EXP_ID);

    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "expediente.correction_attempt_created",
      "expedientes",
      expect.any(String),
      expect.objectContaining({
        after: expect.objectContaining({ sourceExpedienteId: EXP_ID }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// SERVICE — generateCover
// ---------------------------------------------------------------------------

describe("service: generateCover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
    mockFindCoverTemplateById.mockResolvedValue({
      id: TEMPLATE_ID,
      org_id: staffActor.orgId,
      name: "Classic",
      template: { title_i18n: { es: "EXPEDIENTE", en: "EXPEDIENTE" }, style: "ulp-classic" },
      is_active: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
    mockInsertCoverRender.mockResolvedValue({
      id: "render-uuid",
      case_id: CASE_ID,
      template_id: TEMPLATE_ID,
      data: {},
      pdf_path: "case/111/covers/render-uuid.pdf",
      created_by: staffActor.userId,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
  });

  it("renders the cover PDF via renderCoverPdf", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: { field1: "value1" },
    });

    expect(mockRenderCoverPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        caseNumber: "U26-000001",
        clientLabel: expect.stringMatching(/^M\./),
        serviceLabel: "Visa de Trabajo",
      }),
    );
  });

  it("derives canonical client label from the petitioner (principal) party", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: {},
    });

    // "María García" → "M. García"
    const call = mockRenderCoverPdf.mock.calls[0][0];
    expect(call.clientLabel).toBe("M. García");
  });

  it("uses a custom title and per-party subtitle when provided", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: { title: "Documentos del menor", partyId: "00000000-0000-0000-0000-0000000000a1" },
    });

    const call = mockRenderCoverPdf.mock.calls[0][0];
    expect(call.title).toBe("Documentos del menor");
    expect(call.subtitle).toBe("María García"); // subtitle defaults to the selected party's name
  });

  it("uploads the rendered PDF to generated bucket", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: {},
    });

    expect(mockUploadBytesToStorage).toHaveBeenCalledWith(
      "generated",
      expect.stringContaining(`case/${CASE_ID}/covers/`),
      expect.any(Uint8Array),
      "application/pdf",
    );
  });

  it("inserts a cover_renders row", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: { custom: "data" },
    });

    expect(mockInsertCoverRender).toHaveBeenCalledWith(
      expect.objectContaining({
        case_id: CASE_ID,
        template_id: TEMPLATE_ID,
        created_by: staffActor.userId,
      }),
    );
  });

  it("throws COVER_TEMPLATE_NOT_FOUND when template does not belong to actor org", async () => {
    mockFindCoverTemplateById.mockResolvedValue({
      id: TEMPLATE_ID,
      org_id: "other-org-id",
      name: "Other",
      template: {},
      is_active: true,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });

    const err = await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: {},
    }).catch((e: ExpedienteError) => e);

    expect((err as ExpedienteError).code).toBe("COVER_TEMPLATE_NOT_FOUND");
  });

  it("writes audit after cover generation", async () => {
    await generateCover(staffActor, {
      caseId: CASE_ID,
      templateId: TEMPLATE_ID,
      data: {},
    });

    expect(mockWriteAudit).toHaveBeenCalledWith(
      staffActor,
      "expediente.cover_generated",
      "cover_renders",
      expect.any(String),
      expect.anything(),
    );
  });
});

describe("service: autoAssembleWithAi", () => {
  const PARTY_ID = "00000000-0000-0000-0000-0000000000a1"; // matches the cases mock
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockRequireCaseAccess.mockResolvedValue(undefined);
    // Existing empty draft → no replace needed.
    mockFindDraftExpedienteForCase.mockResolvedValue(makeExpediente("draft"));
    mockListItemsForExpediente.mockResolvedValue([]);
    mockMaxItemPositionForExpediente.mockResolvedValue(0);
    mockListActiveCoverTemplates.mockResolvedValue([
      { id: TEMPLATE_ID, org_id: staffActor.orgId, name: "Sep", template: { style: "ulp-divider" }, is_active: true, created_at: "", updated_at: "" },
    ]);
    mockListApprovedDocumentsForMaterial.mockResolvedValue([
      { refId: "doc1", title: "Acta de nacimiento", createdAt: "", storagePath: "p", displayName: "Acta de nacimiento", originalFilename: "acta.pdf", partyId: PARTY_ID, requirementLabel: null },
    ]);
    mockListCompletedTranslationsForCase.mockResolvedValue([
      { translationId: "tr1", caseDocumentId: "doc1", translatedPdfPath: "tp" },
    ]);
    mockListFormResponsesForMaterial.mockResolvedValue([]);
    mockListGenerationRunsForMaterial.mockResolvedValue([]);
    mockInsertCoverRender.mockResolvedValue({ id: "cov1" });
    mockInsertItem.mockResolvedValue({ id: "it" });
    mockProposeExpedienteAssembly.mockResolvedValue({
      sections: [
        { kind: "party", title: "Documentos de la peticionaria: María García", partyId: PARTY_ID, documentIds: ["doc1"] },
      ],
    });
  });

  it("builds the draft: cover, then translation BEFORE the original document", async () => {
    const res = await autoAssembleWithAi(staffActor, CASE_ID);

    // Order of inserted items: cover → translation → client_document
    const types = mockInsertItem.mock.calls.map((c) => (c[0] as { item_type: string }).item_type);
    expect(types).toEqual(["cover", "translation", "client_document"]);

    // The translation item references the translation id, the doc item the doc id.
    const trCall = mockInsertItem.mock.calls.find((c) => (c[0] as { item_type: string }).item_type === "translation");
    const docCall = mockInsertItem.mock.calls.find((c) => (c[0] as { item_type: string }).item_type === "client_document");
    expect((trCall![0] as { ref_id: string }).ref_id).toBe("tr1");
    expect((docCall![0] as { ref_id: string }).ref_id).toBe("doc1");

    expect(res.coversCreated).toBe(1);
    expect(res.itemsCreated).toBe(3);
  });

  it("refuses to overwrite a non-empty draft without replace", async () => {
    mockListItemsForExpediente.mockResolvedValue([{ id: "x", item_type: "cover", ref_id: "c", position: 1 }]);
    const err = await autoAssembleWithAi(staffActor, CASE_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_EMPTY");
  });

  it("per-party cover carries the party name as subtitle", async () => {
    await autoAssembleWithAi(staffActor, CASE_ID);
    const coverCall = mockRenderCoverPdf.mock.calls[0][0];
    expect(coverCall.subtitle).toBe("María García");
  });

  it("falls back to a deterministic draft when the AI planner fails (never leaves an empty draft)", async () => {
    // A generated letter + a document, and the AI planner throws (non-deterministic
    // invalid output — seen in prod for services with no strong form). The assembly must
    // NOT hard-fail: the safety nets build a complete draft from the known material.
    mockListGenerationRunsForMaterial.mockResolvedValue([
      { refId: "gen1", title: "Credible Fear Memorandum", partyId: null },
    ]);
    mockProposeExpedienteAssembly.mockRejectedValue(new Error("AI_OUTPUT_INVALID"));

    const res = await autoAssembleWithAi(staffActor, CASE_ID);

    expect(res.itemsCreated).toBeGreaterThan(0);
    const types = mockInsertItem.mock.calls.map((c) => (c[0] as { item_type: string }).item_type);
    expect(types).toContain("ai_generation"); // the memo, placed by the safety net
    expect(types).toContain("client_document"); // the leftover document
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("service: getCompiledPdfUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireCaseAccess.mockResolvedValue(undefined);
  });

  it("throws EXPEDIENTE_NOT_COMPILED when compiled_pdf_path is null", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled", 1));
    // makeExpediente returns compiled_pdf_path = "case/111/exp-a1.pdf" when compiled
    // Override to null:
    mockFindExpedienteById.mockResolvedValue({
      ...makeExpediente("compiled"),
      compiled_pdf_path: null,
    });

    const { getCompiledPdfUrl } = await import("../service");
    const err = await getCompiledPdfUrl(staffActor, EXP_ID).catch((e: ExpedienteError) => e);
    expect((err as ExpedienteError).code).toBe("EXPEDIENTE_NOT_COMPILED");
  });

  it("returns signed URL when compiled_pdf_path exists", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExpediente("compiled"));
    mockCreateSignedDownloadUrl.mockResolvedValue("https://signed.url/compiled.pdf");

    const { getCompiledPdfUrl } = await import("../service");
    const url = await getCompiledPdfUrl(staffActor, EXP_ID);
    expect(url).toBe("https://signed.url/compiled.pdf");
  });
});
