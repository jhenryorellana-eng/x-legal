/**
 * Expediente print queue — F6-Ola2 unit tests.
 *
 * Covers:
 *  - listPrintQueue: requires can('printing','view'), delegates to repo
 *  - PrintQueueItemDto shape contract
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockRequireCaseAccess,
  mockListPrintQueue,
  mockFindExpedienteById,
  mockUpdateExpediente,
  mockWriteAudit,
  mockEmitExpedientePrinted,
  mockCreateSignedDownloadUrl,
  mockFindCasePlanRequiresLawyerValidation,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockListPrintQueue: vi.fn().mockResolvedValue([]),
  mockFindExpedienteById: vi.fn().mockResolvedValue(null),
  mockUpdateExpediente: vi.fn().mockResolvedValue(undefined),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockEmitExpedientePrinted: vi.fn(),
  mockCreateSignedDownloadUrl: vi.fn().mockResolvedValue("https://storage.url/pdf"),
  mockFindCasePlanRequiresLawyerValidation: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
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
        download: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    },
  })),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  uploadBytesToStorage: vi.fn().mockResolvedValue("some/path.pdf"),
  createSignedUploadUrl: vi.fn().mockResolvedValue({ signedUrl: "https://upload.url", path: "some/path.pdf" }),
  createSignedDownloadUrl: mockCreateSignedDownloadUrl,
  validateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderCoverPdf: vi.fn().mockResolvedValue(new Uint8Array()),
  compileExpedientePdf: vi.fn().mockResolvedValue({ pdf: new Uint8Array(), pageCount: 0, toc: [] }),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../events", () => ({
  emitExpedienteCompiled: vi.fn(),
  emitExpedienteSentToFinance: vi.fn(),
  emitExpedientePrinted: mockEmitExpedientePrinted,
  registerExpedienteConsumers: vi.fn(),
}));

vi.mock("../repository", () => ({
  // Full stub — all functions from service imports must be present
  listActiveCoverTemplates: vi.fn().mockResolvedValue([]),
  findCoverTemplateById: vi.fn().mockResolvedValue(null),
  insertCoverRender: vi.fn(),
  listCoverRendersForCase: vi.fn().mockResolvedValue([]),
  findExpedienteById: mockFindExpedienteById,
  listExpedientesForCase: vi.fn().mockResolvedValue([]),
  maxAttemptNoForCase: vi.fn().mockResolvedValue(0),
  findDraftExpedienteForCase: vi.fn().mockResolvedValue(null),
  insertExpediente: vi.fn(),
  updateExpediente: mockUpdateExpediente,
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
  findCasePlanRequiresLawyerValidation: mockFindCasePlanRequiresLawyerValidation,
  // Ola-2 print queue
  listPrintQueue: mockListPrintQueue,
}));

vi.mock("@/backend/modules/cases", () => ({
  getCaseWorkspace: vi.fn().mockResolvedValue(null),
}));

// Import after mocks
import { listPrintQueue } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ANDRIUM_ACTOR = {
  userId: "finance-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  orgId: "org-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  role: "finance" as const,
  kind: "staff" as const,
  permissions: new Map([["printing", { view: true, edit: true }]]),
} as import("@/backend/platform/authz").Actor;

const printQueueItems = [
  {
    expedienteId: "exp-1111-4111-8111-111111111111",
    caseId: "case-2222-4222-8222-222222222222",
    caseNumber: "2025-001",
    clientName: "Carlos Mendez",
    serviceLabel: { es: "Visa de Trabajo", en: "Work Visa" },
    attemptNo: 1,
    pageCount: 42,
    status: "sent_to_finance",
    sentToFinanceAt: "2025-06-10T09:00:00Z",
    sentByName: "Ana Torres",
    withLawyer: true,
    shippedAt: null,
    filedAt: null,
    trackingRef: null,
    hasPdf: true,
  },
  {
    expedienteId: "exp-3333-4333-8333-333333333333",
    caseId: "case-4444-4444-8444-444444444444",
    caseNumber: "2025-002",
    clientName: "Luis Gomez",
    serviceLabel: null,
    attemptNo: 2,
    pageCount: null,
    status: "printed",
    sentToFinanceAt: "2025-06-11T10:00:00Z",
    sentByName: null,
    withLawyer: false,
    shippedAt: "2025-06-12T08:00:00Z",
    filedAt: null,
    trackingRef: "TRACK-XYZ",
    hasPdf: true,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("expediente: listPrintQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPrintQueue.mockResolvedValue(printQueueItems);
  });

  it("requires can('printing', 'view')", async () => {
    await listPrintQueue(ANDRIUM_ACTOR);
    expect(mockCan).toHaveBeenCalledWith(ANDRIUM_ACTOR, "printing", "view");
  });

  it("delegates to repoPrintQueue with orgId and no status filter", async () => {
    await listPrintQueue(ANDRIUM_ACTOR);
    expect(mockListPrintQueue).toHaveBeenCalledWith(ANDRIUM_ACTOR.orgId, undefined);
  });

  it("passes status filter when provided", async () => {
    await listPrintQueue(ANDRIUM_ACTOR, { status: "sent_to_finance" });
    expect(mockListPrintQueue).toHaveBeenCalledWith(ANDRIUM_ACTOR.orgId, "sent_to_finance");
  });

  it("returns the PrintQueueItemDto list from repo", async () => {
    const result = await listPrintQueue(ANDRIUM_ACTOR);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      expedienteId: "exp-1111-4111-8111-111111111111",
      caseNumber: "2025-001",
      clientName: "Carlos Mendez",
      serviceLabel: { es: "Visa de Trabajo", en: "Work Visa" },
      withLawyer: true,
      hasPdf: true,
      sentByName: "Ana Torres",
    });
  });

  it("returns empty list when no items in queue", async () => {
    mockListPrintQueue.mockResolvedValue([]);
    const result = await listPrintQueue(ANDRIUM_ACTOR);
    expect(result).toEqual([]);
  });

  it("returns item with null serviceLabel when service plan has no label", async () => {
    const result = await listPrintQueue(ANDRIUM_ACTOR);
    expect(result[1].serviceLabel).toBeNull();
  });

  it("returns item with trackingRef when present", async () => {
    const result = await listPrintQueue(ANDRIUM_ACTOR);
    expect(result[1].trackingRef).toBe("TRACK-XYZ");
    expect(result[1].shippedAt).toBeTruthy();
  });
});
