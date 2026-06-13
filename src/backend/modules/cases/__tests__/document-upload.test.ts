/**
 * Cases / document upload — H-2 + H-3 fixes (TDD).
 *
 * H-2: startDocumentUpload sanitizes client-supplied filename before embedding
 *      it in the storage path.
 * H-3: confirmDocumentUpload rejects an uploadRef that does not start with the
 *      expected case prefix, preventing path-traversal across cases.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist mock factories (required by vitest hoisting rules)
// ---------------------------------------------------------------------------

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockCreateSignedUploadUrl,
  mockValidateUploadedObject,
  mockInsertCaseDocument,
  mockFindCurrentChainHead,
  mockUpdateDocument,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockCreateSignedUploadUrl: vi.fn(),
  mockValidateUploadedObject: vi.fn(),
  mockInsertCaseDocument: vi.fn(),
  mockFindCurrentChainHead: vi.fn().mockResolvedValue(null),
  mockUpdateDocument: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: mockCreateSignedUploadUrl,
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: mockValidateUploadedObject,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    findCurrentChainHead: mockFindCurrentChainHead,
    insertCaseDocument: mockInsertCaseDocument,
    updateDocument: mockUpdateDocument,
    // remaining fns: keep original stubs
    findCaseByContractId: vi.fn().mockResolvedValue(null),
    findCaseByCaseId: vi.fn().mockResolvedValue(null),
    nextCaseNumber: vi.fn().mockResolvedValue("X-001"),
    insertCase: vi.fn(),
    upsertCaseMember: vi.fn().mockResolvedValue(undefined),
    updateCase: vi.fn(),
    insertPhaseHistory: vi.fn(),
    findDocumentById: vi.fn().mockResolvedValue(null),
    getTimelinePage: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listCases: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    listCaseDocuments: vi.fn().mockResolvedValue([]),
    getRequirementOverrides: vi.fn().mockResolvedValue([]),
    getCaseParties: vi.fn().mockResolvedValue([]),
    findServiceLite: vi.fn().mockResolvedValue(null),
    listServicePhases: vi.fn().mockResolvedValue([]),
    listServiceMilestones: vi.fn().mockResolvedValue([]),
    findPersonRecord: vi.fn().mockResolvedValue(null),
    findClientDisplayName: vi.fn().mockResolvedValue(null),
    findPlanKind: vi.fn().mockResolvedValue(null),
    insertCasePartyRow: vi.fn().mockResolvedValue(undefined),
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

import { startDocumentUpload, confirmDocumentUpload } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  orgId:   "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "staff" as const,
  role: "admin" as const,
  permissions: new Map(),
};

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";

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

// ---------------------------------------------------------------------------
// H-2: startDocumentUpload — filename sanitization
// ---------------------------------------------------------------------------

describe("startDocumentUpload — H-2 filename sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockFindCaseById.mockResolvedValue(ACTIVE_CASE);
    mockCreateSignedUploadUrl.mockResolvedValue({
      signedUrl: "https://example.com/upload",
      path: `case/${CASE_ID}/1234-safe.pdf`,
    });
  });

  it("embeds only safe characters in the storage path for a clean filename", async () => {
    await startDocumentUpload(ACTOR, {
      caseId: CASE_ID,
      requirementId: null,
      filename: "my-document.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    const [bucket, pathArg] = mockCreateSignedUploadUrl.mock.calls[0] as [string, string];
    expect(bucket).toBe("case-documents");
    // Path should start with case/{caseId}/ and contain the safe filename
    expect(pathArg).toMatch(new RegExp(`^case/${CASE_ID}/\\d+-my-document\\.pdf$`));
  });

  it("strips path traversal sequences from filenames (H-2)", async () => {
    await startDocumentUpload(ACTOR, {
      caseId: CASE_ID,
      requirementId: null,
      filename: "../../../etc/passwd",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    const [, pathArg] = mockCreateSignedUploadUrl.mock.calls[0] as [string, string];
    // The path must stay under the case prefix (not escape it via ../)
    expect(pathArg).toMatch(new RegExp(`^case/${CASE_ID}/`));
    // Slashes from path traversal are replaced — no ../ in the sanitized segment
    expect(pathArg).not.toContain("../");
    // The entire path after the case prefix must only contain [a-zA-Z0-9._-]
    const suffix = pathArg.replace(`case/${CASE_ID}/`, "");
    expect(suffix).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it("replaces spaces and special chars with underscores (H-2)", async () => {
    await startDocumentUpload(ACTOR, {
      caseId: CASE_ID,
      requirementId: null,
      filename: "mi documento (1) [final].pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });

    const [, pathArg] = mockCreateSignedUploadUrl.mock.calls[0] as [string, string];
    // No spaces or brackets
    expect(pathArg).not.toMatch(/\s/);
    expect(pathArg).not.toContain("(");
    expect(pathArg).not.toContain("[");
  });
});

// ---------------------------------------------------------------------------
// H-3: confirmDocumentUpload — uploadRef prefix guard
// ---------------------------------------------------------------------------

describe("confirmDocumentUpload — H-3 uploadRef prefix guard", () => {
  const VALID_UPLOAD_REF = `case/${CASE_ID}/1234-document.pdf`;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(undefined);
    mockValidateUploadedObject.mockResolvedValue({ ok: true });
    mockInsertCaseDocument.mockResolvedValue({
      id: "ffffffff-ffff-4fff-8fff-000000000001",
      case_id: CASE_ID,
      storage_path: VALID_UPLOAD_REF,
      original_filename: "document.pdf",
      mime_type: "application/pdf",
      size_bytes: 1024,
      status: "pending_review",
      chain_superseded_at: null,
      required_document_type_id: null,
      party_id: null,
      uploaded_by: ACTOR.userId,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  it("accepts a valid uploadRef with matching case prefix", async () => {
    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: VALID_UPLOAD_REF,
        originalFilename: "document.pdf",
      }),
    ).resolves.toBeDefined();
  });

  it("throws DOC_UPLOAD_INVALID when uploadRef has a different case prefix (H-3)", async () => {
    const OTHER_CASE_ID = "99999999-9999-4999-8999-000000000001";

    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: `case/${OTHER_CASE_ID}/1234-document.pdf`,
        originalFilename: "document.pdf",
      }),
    ).rejects.toMatchObject({ code: "DOC_UPLOAD_INVALID" });

    // validateUploadedObject must NOT be called (guard fires first)
    expect(mockValidateUploadedObject).not.toHaveBeenCalled();
  });

  it("throws DOC_UPLOAD_INVALID for a root-level path (no case prefix) (H-3)", async () => {
    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: "avatars/some-user/photo.png",
        originalFilename: "photo.png",
      }),
    ).rejects.toMatchObject({ code: "DOC_UPLOAD_INVALID" });
  });

  it("does not call validateUploadedObject when prefix is wrong (H-3)", async () => {
    await expect(
      confirmDocumentUpload(ACTOR, {
        caseId: CASE_ID,
        uploadRef: `case/00000000-0000-4000-8000-000000000099/evil.pdf`,
        originalFilename: "evil.pdf",
      }),
    ).rejects.toMatchObject({ code: "DOC_UPLOAD_INVALID" });

    expect(mockValidateUploadedObject).not.toHaveBeenCalled();
  });
});
