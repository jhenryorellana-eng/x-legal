/**
 * Andrium handoff tests — F5-Ola3
 *
 * Covers:
 *  - service: sendToFinance (plan gates, block on re-send, audit, event)
 *  - service: markPrinted (state gate, compiled_pdf_path gate, audit, event)
 *  - service: markShipped (state gate, trackingRef, audit, no event)
 *  - service: markFiled   (state gate, audit, no event)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockFindExpedienteById,
  mockUpdateExpediente,
  mockFindCasePlanRequiresLawyerValidation,
  mockWriteAudit,
  mockEmitExpedienteSentToFinance,
  mockEmitExpedientePrinted,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockFindExpedienteById: vi.fn(),
  mockUpdateExpediente: vi.fn().mockResolvedValue(undefined),
  mockFindCasePlanRequiresLawyerValidation: vi.fn(),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockEmitExpedienteSentToFinance: vi.fn(),
  mockEmitExpedientePrinted: vi.fn(),
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
  createServiceClient: vi.fn(() => ({
    storage: { from: vi.fn(() => ({ download: vi.fn() })) },
  })),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  uploadBytesToStorage: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderCoverPdf: vi.fn(),
  compileExpedientePdf: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../events", () => ({
  emitExpedienteCompiled: vi.fn(),
  emitExpedienteSentToFinance: mockEmitExpedienteSentToFinance,
  emitExpedientePrinted: mockEmitExpedientePrinted,
  registerExpedienteConsumers: vi.fn(),
}));

vi.mock("../repository", () => ({
  // Covers
  listActiveCoverTemplates: vi.fn().mockResolvedValue([]),
  findCoverTemplateById: vi.fn().mockResolvedValue(null),
  insertCoverRender: vi.fn(),
  listCoverRendersForCase: vi.fn().mockResolvedValue([]),
  // Expediente
  findExpedienteById: mockFindExpedienteById,
  listExpedientesForCase: vi.fn().mockResolvedValue([]),
  maxAttemptNoForCase: vi.fn().mockResolvedValue(0),
  findDraftExpedienteForCase: vi.fn().mockResolvedValue(null),
  insertExpediente: vi.fn(),
  updateExpediente: mockUpdateExpediente,
  // Items
  listItemsForExpediente: vi.fn().mockResolvedValue([]),
  maxItemPositionForExpediente: vi.fn().mockResolvedValue(0),
  findItemById: vi.fn().mockResolvedValue(null),
  insertItem: vi.fn(),
  deleteItem: vi.fn().mockResolvedValue(undefined),
  updateItemPosition: vi.fn().mockResolvedValue(undefined),
  updateItemPageCount: vi.fn().mockResolvedValue(undefined),
  updateItemMeta: vi.fn().mockResolvedValue(undefined),
  verifyCoverRenderExists: vi.fn().mockResolvedValue(true),
  findGenerationRunById: vi.fn().mockResolvedValue(null),
  findFormResponseById: vi.fn().mockResolvedValue(null),
  findCaseDocumentById: vi.fn().mockResolvedValue(null),
  listCoverRendersForMaterial: vi.fn().mockResolvedValue([]),
  listGenerationRunsForMaterial: vi.fn().mockResolvedValue([]),
  listFormResponsesForMaterial: vi.fn().mockResolvedValue([]),
  listApprovedDocumentsForMaterial: vi.fn().mockResolvedValue([]),
  findCoverRenderById: vi.fn().mockResolvedValue(null),
  // Handoff
  findCasePlanRequiresLawyerValidation: mockFindCasePlanRequiresLawyerValidation,
}));

vi.mock("@/backend/modules/cases", () => ({
  getCaseWorkspace: vi.fn().mockResolvedValue({
    caseNumber: "ULP-2026-0001",
    service: { labelI18n: { es: "Visa de Trabajo", en: "Work Visa" } },
    parties: [{ id: "00000000-0000-0000-0000-0000000000a1", role: "petitioner", name: "María García" }],
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const EXP_ID  = "22222222-2222-4222-8222-222222222222";

const actor = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId:  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "staff" as const,
  role: "finance" as const,
  permissions: new Map(),
};

type ExpStatus =
  | "draft" | "compiling" | "compile_failed" | "compiled" | "ready"
  | "sent_to_lawyer" | "corrections_needed" | "approved"
  | "sent_to_finance" | "printed";

const makeExp = (status: ExpStatus, overrides: Record<string, unknown> = {}) => ({
  id: EXP_ID,
  case_id: CASE_ID,
  attempt_no: 1,
  status,
  built_by: actor.userId,
  compiled_pdf_path: ["compiled", "ready", "approved", "sent_to_finance", "printed"].includes(status)
    ? `expedientes/${CASE_ID}/exp-a1.pdf`
    : null,
  page_count: null,
  sent_to_finance_at: null,
  sent_to_finance_by: null,
  printed_at: null,
  printed_by: null,
  shipped_at: null,
  filed_at: null,
  tracking_ref: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Import service after mocks
// ---------------------------------------------------------------------------

import { markExpedienteReady, sendToFinance, markPrinted, markShipped, markFiled, ExpedienteError } from "../service";

// ---------------------------------------------------------------------------
// sendToFinance
// ---------------------------------------------------------------------------

describe("service: sendToFinance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  describe("plan self (requires_lawyer_validation = false)", () => {
    beforeEach(() => {
      mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    });

    it("succeeds when status is ready (plan self)", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("ready"));
      await sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID });
      expect(mockUpdateExpediente).toHaveBeenCalledWith(
        EXP_ID,
        expect.objectContaining({ status: "sent_to_finance" }),
      );
    });

    it("throws EXPEDIENTE_NOT_READY when status is compiled (not yet 'Listo', plan self)", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
      await expect(
        sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
      ).rejects.toMatchObject({ code: "EXPEDIENTE_NOT_READY" });
    });

    it("throws EXPEDIENTE_NOT_READY when status is approved but plan is self", async () => {
      // 'approved' is the with_lawyer path — plan self hands off from 'ready'
      mockFindExpedienteById.mockResolvedValue(makeExp("approved"));
      await expect(
        sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
      ).rejects.toMatchObject({ code: "EXPEDIENTE_NOT_READY" });
    });
  });

  describe("plan with_lawyer (requires_lawyer_validation = true)", () => {
    beforeEach(() => {
      mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(true);
    });

    it("succeeds when status is approved (plan with_lawyer)", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("approved"));
      await sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID });
      expect(mockUpdateExpediente).toHaveBeenCalledWith(
        EXP_ID,
        expect.objectContaining({ status: "sent_to_finance" }),
      );
    });

    it("throws EXPEDIENTE_NOT_APPROVED when status is compiled (plan with_lawyer)", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
      await expect(
        sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
      ).rejects.toMatchObject({ code: "EXPEDIENTE_NOT_APPROVED" });
    });
  });

  describe("block on re-send", () => {
    beforeEach(() => {
      mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    });

    it("throws EXPEDIENTE_ALREADY_SENT_TO_FINANCE when status is sent_to_finance", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
      await expect(
        sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
      ).rejects.toMatchObject({ code: "EXPEDIENTE_ALREADY_SENT_TO_FINANCE" });
    });

    it("throws EXPEDIENTE_ALREADY_SENT_TO_FINANCE when status is printed", async () => {
      mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
      await expect(
        sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
      ).rejects.toMatchObject({ code: "EXPEDIENTE_ALREADY_SENT_TO_FINANCE" });
    });
  });

  it("emits expediente.sent_to_finance event on success", async () => {
    mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    mockFindExpedienteById.mockResolvedValue(makeExp("ready"));
    await sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID });
    expect(mockEmitExpedienteSentToFinance).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, expedienteId: EXP_ID }),
    );
  });

  it("writes audit on success", async () => {
    mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    mockFindExpedienteById.mockResolvedValue(makeExp("ready"));
    await sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      actor,
      "expediente.sent_to_finance",
      "expedientes",
      EXP_ID,
      expect.any(Object),
    );
  });

  it("throws EXPEDIENTE_NOT_FOUND when expediente does not exist", async () => {
    mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    mockFindExpedienteById.mockResolvedValue(null);
    await expect(
      sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID }),
    ).rejects.toMatchObject({ code: "EXPEDIENTE_NOT_FOUND" });
  });

  it("sets sent_to_finance_at and sent_to_finance_by on update", async () => {
    mockFindCasePlanRequiresLawyerValidation.mockResolvedValue(false);
    mockFindExpedienteById.mockResolvedValue(makeExp("ready"));
    await sendToFinance(actor, { caseId: CASE_ID, expedienteId: EXP_ID });
    const call = mockUpdateExpediente.mock.calls[0][1] as Record<string, unknown>;
    expect(call.sent_to_finance_by).toBe(actor.userId);
    expect(typeof call.sent_to_finance_at).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// markExpedienteReady ("Listo")
// ---------------------------------------------------------------------------

describe("service: markExpedienteReady", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("transitions compiled → ready and audits", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
    await markExpedienteReady(actor, EXP_ID);
    expect(mockUpdateExpediente).toHaveBeenCalledWith(EXP_ID, { status: "ready" });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      actor,
      "expediente.marked_ready",
      "expedientes",
      EXP_ID,
      expect.any(Object),
    );
  });

  it("throws EXPEDIENTE_NOT_COMPILED when not compiled (e.g. still draft)", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("draft"));
    await expect(markExpedienteReady(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_COMPILED",
    });
    expect(mockUpdateExpediente).not.toHaveBeenCalled();
  });

  it("does NOT emit sent_to_finance (marking ready is not a handoff)", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
    await markExpedienteReady(actor, EXP_ID);
    expect(mockEmitExpedienteSentToFinance).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markPrinted
// ---------------------------------------------------------------------------

describe("service: markPrinted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("succeeds when status is sent_to_finance and compiled_pdf_path exists", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await markPrinted(actor, EXP_ID);
    expect(mockUpdateExpediente).toHaveBeenCalledWith(
      EXP_ID,
      expect.objectContaining({ status: "printed" }),
    );
  });

  it("throws EXPEDIENTE_NOT_IN_PRINT_QUEUE when status is compiled", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
    await expect(markPrinted(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_IN_PRINT_QUEUE",
    });
  });

  it("throws EXPEDIENTE_NOT_IN_PRINT_QUEUE when status is approved", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("approved"));
    await expect(markPrinted(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_IN_PRINT_QUEUE",
    });
  });

  it("throws COMPILE_SOURCE_MISSING when compiled_pdf_path is null (RF-AND-024)", async () => {
    mockFindExpedienteById.mockResolvedValue(
      makeExp("sent_to_finance", { compiled_pdf_path: null }),
    );
    await expect(markPrinted(actor, EXP_ID)).rejects.toMatchObject({
      code: "COMPILE_SOURCE_MISSING",
    });
  });

  it("emits expediente.printed event on success", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await markPrinted(actor, EXP_ID);
    expect(mockEmitExpedientePrinted).toHaveBeenCalledWith(
      expect.objectContaining({ expedienteId: EXP_ID, caseId: CASE_ID }),
    );
  });

  it("sets printed_at and printed_by", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await markPrinted(actor, EXP_ID);
    const call = mockUpdateExpediente.mock.calls[0][1] as Record<string, unknown>;
    expect(call.printed_by).toBe(actor.userId);
    expect(typeof call.printed_at).toBe("string");
  });

  it("writes audit", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await markPrinted(actor, EXP_ID);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      actor,
      "expediente.printed",
      "expedientes",
      EXP_ID,
      expect.any(Object),
    );
  });

  it("throws EXPEDIENTE_NOT_FOUND when expediente missing", async () => {
    mockFindExpedienteById.mockResolvedValue(null);
    await expect(markPrinted(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// markShipped
// ---------------------------------------------------------------------------

describe("service: markShipped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("succeeds when status is printed", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markShipped(actor, EXP_ID, "1Z-TRACKING-123");
    expect(mockUpdateExpediente).toHaveBeenCalledWith(
      EXP_ID,
      expect.objectContaining({ tracking_ref: "1Z-TRACKING-123" }),
    );
  });

  it("stores null tracking_ref when not provided", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markShipped(actor, EXP_ID);
    const call = mockUpdateExpediente.mock.calls[0][1] as Record<string, unknown>;
    expect(call.tracking_ref).toBeNull();
  });

  it("throws EXPEDIENTE_NOT_PRINTED when status is sent_to_finance", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await expect(markShipped(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_PRINTED",
    });
  });

  it("throws EXPEDIENTE_NOT_PRINTED when status is compiled", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("compiled"));
    await expect(markShipped(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_PRINTED",
    });
  });

  it("does NOT change status (shipped_at only — SIN cambio de estado)", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markShipped(actor, EXP_ID, "TRACK-ABC");
    const call = mockUpdateExpediente.mock.calls[0][1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("status");
    expect(call).toHaveProperty("shipped_at");
  });

  it("writes audit", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markShipped(actor, EXP_ID);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      actor,
      "expediente.shipped",
      "expedientes",
      EXP_ID,
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// markFiled
// ---------------------------------------------------------------------------

describe("service: markFiled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateExpediente.mockResolvedValue(undefined);
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("succeeds when status is printed", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markFiled(actor, EXP_ID);
    expect(mockUpdateExpediente).toHaveBeenCalledWith(
      EXP_ID,
      expect.objectContaining({ filed_at: expect.any(String) }),
    );
  });

  it("throws EXPEDIENTE_NOT_PRINTED when status is sent_to_finance", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("sent_to_finance"));
    await expect(markFiled(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_PRINTED",
    });
  });

  it("does NOT change status (filed_at only — SIN cambio de estado)", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markFiled(actor, EXP_ID);
    const call = mockUpdateExpediente.mock.calls[0][1] as Record<string, unknown>;
    expect(call).not.toHaveProperty("status");
    expect(call).toHaveProperty("filed_at");
  });

  it("writes audit", async () => {
    mockFindExpedienteById.mockResolvedValue(makeExp("printed"));
    await markFiled(actor, EXP_ID);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      actor,
      "expediente.filed",
      "expedientes",
      EXP_ID,
      expect.any(Object),
    );
  });

  it("throws EXPEDIENTE_NOT_FOUND when expediente missing", async () => {
    mockFindExpedienteById.mockResolvedValue(null);
    await expect(markFiled(actor, EXP_ID)).rejects.toMatchObject({
      code: "EXPEDIENTE_NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// Error class smoke test
// ---------------------------------------------------------------------------

describe("ExpedienteError — new codes", () => {
  it("can construct EXPEDIENTE_NOT_APPROVED", () => {
    const err = new ExpedienteError("EXPEDIENTE_NOT_APPROVED");
    expect(err.code).toBe("EXPEDIENTE_NOT_APPROVED");
    expect(err.name).toBe("ExpedienteError");
  });

  it("can construct EXPEDIENTE_ALREADY_SENT_TO_FINANCE", () => {
    const err = new ExpedienteError("EXPEDIENTE_ALREADY_SENT_TO_FINANCE");
    expect(err.code).toBe("EXPEDIENTE_ALREADY_SENT_TO_FINANCE");
  });

  it("can construct EXPEDIENTE_NOT_IN_PRINT_QUEUE", () => {
    const err = new ExpedienteError("EXPEDIENTE_NOT_IN_PRINT_QUEUE");
    expect(err.code).toBe("EXPEDIENTE_NOT_IN_PRINT_QUEUE");
  });

  it("can construct EXPEDIENTE_NOT_PRINTED", () => {
    const err = new ExpedienteError("EXPEDIENTE_NOT_PRINTED");
    expect(err.code).toBe("EXPEDIENTE_NOT_PRINTED");
  });

  it("can construct COMPILE_SOURCE_MISSING", () => {
    const err = new ExpedienteError("COMPILE_SOURCE_MISSING");
    expect(err.code).toBe("COMPILE_SOURCE_MISSING");
  });
});
