/**
 * Cases / document quality + format gate (TDD).
 *
 * confirmDocumentUpload runs, after storage validation and before registering
 * the row:
 *  1. per-document format enforcement (accepted_format pdf|png) — mismatch →
 *     deleteObject + DOC_FORMAT_NOT_ALLOWED, no row inserted.
 *  2. AI quality gate (ai-engine.assessDocumentLegibility) — clearly illegible →
 *     deleteObject + DOC_NOT_LEGIBLE, no row inserted; legible → inserted.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockValidateUploadedObject,
  mockDeleteObject,
  mockInsertCaseDocument,
  mockFindCurrentChainHead,
  mockUpdateDocument,
  mockAssessLegibility,
  mockCreateServiceClient,
  mockInsertTimelineEntry,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockValidateUploadedObject: vi.fn(),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
  mockInsertCaseDocument: vi.fn(),
  mockFindCurrentChainHead: vi.fn().mockResolvedValue(null),
  mockUpdateDocument: vi.fn().mockResolvedValue(undefined),
  mockAssessLegibility: vi.fn(),
  mockCreateServiceClient: vi.fn(),
  mockInsertTimelineEntry: vi.fn().mockResolvedValue(undefined),
}));

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
  createServiceClient: mockCreateServiceClient,
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: mockValidateUploadedObject,
  deleteObject: mockDeleteObject,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  assessDocumentLegibility: mockAssessLegibility,
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    findCurrentChainHead: mockFindCurrentChainHead,
    insertCaseDocument: mockInsertCaseDocument,
    updateDocument: mockUpdateDocument,
    insertTimelineEntry: mockInsertTimelineEntry,
  };
});

import { confirmDocumentUpload } from "../service";

const ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "client" as const,
  role: null,
  permissions: new Map(),
};
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const REQ_ID = "11111111-1111-4111-8111-000000000001";

const ACTIVE_CASE = {
  id: CASE_ID,
  org_id: ACTOR.orgId,
  case_number: "T-001",
  status: "active",
  service_id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
  primary_client_id: ACTOR.userId,
  current_phase_id: null,
  assigned_paralegal_id: null,
  assigned_sales_id: null,
  opened_at: null,
  completed_at: null,
  internal_note: null,
  rebooking_blocked_until: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** Chainable supabase stub: from().select().eq().maybeSingle() → { data }. */
function serviceClientReturning(data: Record<string, unknown>) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data }) }),
      }),
    }),
  };
}

const INSERTED_DOC = {
  id: "ffffffff-ffff-4fff-8fff-000000000001",
  case_id: CASE_ID,
  status: "uploaded",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue(ACTIVE_CASE);
  mockFindCurrentChainHead.mockResolvedValue(null);
  mockInsertCaseDocument.mockResolvedValue(INSERTED_DOC);
  // accepted_format png, ai_extract false (both lookups hit required_document_types)
  mockCreateServiceClient.mockReturnValue(serviceClientReturning({ accepted_format: "png", ai_extract: false }));
  mockValidateUploadedObject.mockResolvedValue({ ok: true, bytes: Buffer.from("PNGDATA") });
  mockAssessLegibility.mockResolvedValue({ legible: true, blurLevel: "none", reasonEs: "", reasonEn: "" });
});

describe("confirmDocumentUpload — quality + format gate", () => {
  it("rejects a clearly illegible document (delete + DOC_NOT_LEGIBLE, no insert)", async () => {
    mockAssessLegibility.mockResolvedValue({
      legible: false,
      blurLevel: "heavy",
      reasonEs: "Muy borroso",
      reasonEn: "Too blurry",
    });

    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: `case/${CASE_ID}/1-scan.png`,
        requirementId: REQ_ID,
        partyId: null,
        originalFilename: "scan.png",
      }),
    ).rejects.toMatchObject({ code: "DOC_NOT_LEGIBLE" });

    expect(mockDeleteObject).toHaveBeenCalledWith("case-documents", `case/${CASE_ID}/1-scan.png`);
    expect(mockInsertCaseDocument).not.toHaveBeenCalled();
  });

  it("rejects 'heavy' blur even when legible=true", async () => {
    mockAssessLegibility.mockResolvedValue({ legible: true, blurLevel: "heavy", reasonEs: "", reasonEn: "" });
    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: `case/${CASE_ID}/1-scan.png`,
        requirementId: REQ_ID,
        partyId: null,
        originalFilename: "scan.png",
      }),
    ).rejects.toMatchObject({ code: "DOC_NOT_LEGIBLE" });
    expect(mockInsertCaseDocument).not.toHaveBeenCalled();
  });

  it("accepts a legible document (inserts the row)", async () => {
    const doc = await confirmDocumentUpload(ACTOR, {
      caseId: CASE_ID,
      uploadRef: `case/${CASE_ID}/1-scan.png`,
      requirementId: REQ_ID,
      partyId: null,
      originalFilename: "scan.png",
    });
    expect(doc).toEqual(INSERTED_DOC);
    expect(mockInsertCaseDocument).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("rejects a format mismatch (png uploaded for a pdf-only doc)", async () => {
    mockCreateServiceClient.mockReturnValue(serviceClientReturning({ accepted_format: "pdf", ai_extract: false }));
    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: `case/${CASE_ID}/1-scan.png`,
        requirementId: REQ_ID,
        partyId: null,
        originalFilename: "scan.png",
      }),
    ).rejects.toMatchObject({ code: "DOC_FORMAT_NOT_ALLOWED" });
    expect(mockDeleteObject).toHaveBeenCalled();
    expect(mockInsertCaseDocument).not.toHaveBeenCalled();
    // format is checked before the quality gate
    expect(mockAssessLegibility).not.toHaveBeenCalled();
  });
});
