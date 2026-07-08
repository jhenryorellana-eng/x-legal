/**
 * Cases / documents — multiple uploads, semantic naming, lifecycle (TDD).
 *
 * Covers the 0039 capabilities:
 *  - allow_multiple requirements: each file coexists (no auto-replace) and the
 *    client-typed name is required (DOC_NAME_REQUIRED).
 *  - single slot semantic name: derived server-side from the requirement label
 *    (+ party) into display_name; client name ignored.
 *  - re-upload lifecycle by previous status: approved → locked, uploaded → hard
 *    overwrite (delete prev), rejected → traceable 'replaced'.
 *  - deleteCaseDocument guard (uploaded only).
 *  - getCaseDocumentBytes returns a slugified, semantic download filename.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockRequireCaseAccess,
  mockValidateUploadedObject,
  mockDeleteObject,
  mockDownloadBytes,
  mockInsertCaseDocument,
  mockFindCurrentChainHead,
  mockUpdateDocument,
  mockDeleteCaseDocumentRow,
  mockFindDocumentById,
  mockGetCaseParties,
  mockFindPersonRecord,
  mockMaybeSingle,
} = vi.hoisted(() => ({
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockValidateUploadedObject: vi.fn().mockResolvedValue({ ok: true }),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
  mockDownloadBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  mockInsertCaseDocument: vi.fn(),
  mockFindCurrentChainHead: vi.fn().mockResolvedValue(null),
  mockUpdateDocument: vi.fn().mockResolvedValue(undefined),
  mockDeleteCaseDocumentRow: vi.fn().mockResolvedValue(undefined),
  mockFindDocumentById: vi.fn().mockResolvedValue(null),
  mockGetCaseParties: vi.fn().mockResolvedValue([]),
  mockFindPersonRecord: vi.fn().mockResolvedValue(null),
  mockMaybeSingle: vi.fn().mockResolvedValue({ data: null }),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: mockRequireCaseAccess,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {},
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn(), emitAndWait: vi.fn().mockResolvedValue(undefined), on: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// createServiceClient is used only for the required_document_types lookup inside
// confirmDocumentUpload — return a chainable builder ending in maybeSingle().
vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
    }),
  })),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: mockValidateUploadedObject,
  deleteObject: mockDeleteObject,
  downloadBytesFromStorage: mockDownloadBytes,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCurrentChainHead: mockFindCurrentChainHead,
    // Etapa C: confirmDocumentUpload now reads the case's current phase to tag the doc.
    findCaseById: vi.fn().mockResolvedValue({ current_phase_id: null }),
    insertCaseDocument: mockInsertCaseDocument,
    updateDocument: mockUpdateDocument,
    deleteCaseDocumentRow: mockDeleteCaseDocumentRow,
    findDocumentById: mockFindDocumentById,
    getCaseParties: mockGetCaseParties,
    findPersonRecord: mockFindPersonRecord,
    findClientDisplayName: vi.fn().mockResolvedValue(null),
  };
});

import { confirmDocumentUpload, deleteCaseDocument, renameCaseDocument, getCaseDocumentBytes, CaseError } from "../service";

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const REQ_ID = "11111111-1111-4111-8111-000000000001";
const PARTY_ID = "22222222-2222-4222-8222-000000000001";
const ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "client" as const,
  role: null,
  permissions: new Map(),
};

function insertedRow(over: Record<string, unknown> = {}) {
  return {
    id: "ffffffff-ffff-4fff-8fff-000000000001",
    case_id: CASE_ID,
    storage_path: `case/${CASE_ID}/1-x.pdf`,
    original_filename: "x.pdf",
    display_name: null,
    mime_type: "application/pdf",
    size_bytes: 0,
    status: "uploaded",
    required_document_type_id: REQ_ID,
    party_id: null,
    replaces_document_id: null,
    uploaded_by: ACTOR.userId,
    rejection_reason_i18n: null,
    reviewed_by: null,
    reviewed_at: null,
    correction_due_at: null,
    translation_not_required: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockValidateUploadedObject.mockResolvedValue({ ok: true });
  mockFindCurrentChainHead.mockResolvedValue(null);
  mockInsertCaseDocument.mockImplementation(async (row) => insertedRow(row));
  mockMaybeSingle.mockResolvedValue({ data: null });
});

const baseInput = (over: Record<string, unknown> = {}) => ({
  caseId: CASE_ID,
  uploadRef: `case/${CASE_ID}/1-reporte.pdf`,
  requirementId: REQ_ID,
  partyId: null,
  originalFilename: "reporte.pdf",
  ...over,
});

describe("confirmDocumentUpload — allow_multiple", () => {
  it("requires a client-typed name and rejects empty (DOC_NAME_REQUIRED)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: true, label_i18n: { es: "Evidencias", en: "Evidence" } },
    });
    await expect(confirmDocumentUpload(ACTOR, baseInput({ displayName: "  " }))).rejects.toMatchObject({
      code: "DOC_NAME_REQUIRED",
    });
    expect(mockDeleteObject).toHaveBeenCalledWith("case-documents", `case/${CASE_ID}/1-reporte.pdf`);
    expect(mockInsertCaseDocument).not.toHaveBeenCalled();
  });

  it("stores the client-typed display_name and never replaces (coexist)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: true, label_i18n: { es: "Evidencias", en: "Evidence" } },
    });
    await confirmDocumentUpload(ACTOR, baseInput({ displayName: "reporte policial" }));
    expect(mockFindCurrentChainHead).not.toHaveBeenCalled();
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "reporte policial", replaces_document_id: null, status: "uploaded" }),
    );
  });
});

describe("confirmDocumentUpload — single slot semantic name", () => {
  it("derives display_name from the requirement label (no party)", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: false, label_i18n: { es: "Pasaporte", en: "Passport" } },
    });
    await confirmDocumentUpload(ACTOR, baseInput());
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Pasaporte" }),
    );
  });

  it("appends the party name → 'Pasaporte de Juan Pérez'", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: false, label_i18n: { es: "Pasaporte", en: "Passport" } },
    });
    mockGetCaseParties.mockResolvedValue([
      { id: PARTY_ID, person_record_id: "pr-1", user_id: null, party_role: "minor" },
    ]);
    mockFindPersonRecord.mockResolvedValue({ first_name: "Juan", last_name: "Pérez" });
    await confirmDocumentUpload(ACTOR, baseInput({ partyId: PARTY_ID }));
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Pasaporte de Juan Pérez" }),
    );
  });

  it("ignores a client-supplied name for a single required slot", async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: false, label_i18n: { es: "Pasaporte", en: "Passport" } },
    });
    await confirmDocumentUpload(ACTOR, baseInput({ displayName: "spoofed name" }));
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(
      expect.objectContaining({ display_name: "Pasaporte" }),
    );
  });
});

describe("confirmDocumentUpload — re-upload lifecycle (single slot)", () => {
  beforeEach(() => {
    mockMaybeSingle.mockResolvedValue({
      data: { accepted_format: "pdf", ai_extract: false, allow_multiple: false, label_i18n: { es: "Pasaporte", en: "Passport" } },
    });
  });

  it("blocks re-upload when the previous document is approved (DOC_ALREADY_APPROVED)", async () => {
    mockFindCurrentChainHead.mockResolvedValue(insertedRow({ id: "prev-1", status: "approved", storage_path: "case/x/old.pdf" }));
    await expect(confirmDocumentUpload(ACTOR, baseInput())).rejects.toMatchObject({ code: "DOC_ALREADY_APPROVED" });
    expect(mockDeleteObject).toHaveBeenCalledWith("case-documents", `case/${CASE_ID}/1-reporte.pdf`);
    expect(mockInsertCaseDocument).not.toHaveBeenCalled();
  });

  it("hard-overwrites a never-reviewed (uploaded) previous: deletes prev file + row", async () => {
    mockFindCurrentChainHead.mockResolvedValue(insertedRow({ id: "prev-2", status: "uploaded", storage_path: "case/x/old.pdf" }));
    await confirmDocumentUpload(ACTOR, baseInput());
    expect(mockDeleteObject).toHaveBeenCalledWith("case-documents", "case/x/old.pdf");
    expect(mockDeleteCaseDocumentRow).toHaveBeenCalledWith("prev-2");
    expect(mockUpdateDocument).not.toHaveBeenCalled();
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(expect.objectContaining({ replaces_document_id: null }));
  });

  it("keeps a rejected previous as a traceable 'replaced' link (correction)", async () => {
    mockFindCurrentChainHead.mockResolvedValue(insertedRow({ id: "prev-3", status: "rejected", storage_path: "case/x/old.pdf" }));
    await confirmDocumentUpload(ACTOR, baseInput());
    expect(mockDeleteCaseDocumentRow).not.toHaveBeenCalled();
    expect(mockUpdateDocument).toHaveBeenCalledWith("prev-3", { status: "replaced" });
    expect(mockInsertCaseDocument).toHaveBeenCalledWith(expect.objectContaining({ replaces_document_id: "prev-3" }));
  });
});

describe("deleteCaseDocument — pending-only hard delete", () => {
  it("deletes a never-reviewed (uploaded) document", async () => {
    mockFindDocumentById.mockResolvedValue(insertedRow({ id: "d-1", status: "uploaded", storage_path: "case/x/d1.pdf" }));
    await deleteCaseDocument(ACTOR, "d-1");
    expect(mockDeleteObject).toHaveBeenCalledWith("case-documents", "case/x/d1.pdf");
    expect(mockDeleteCaseDocumentRow).toHaveBeenCalledWith("d-1");
  });

  it("blocks deleting an approved document (DOC_LOCKED)", async () => {
    mockFindDocumentById.mockResolvedValue(insertedRow({ id: "d-2", status: "approved" }));
    await expect(deleteCaseDocument(ACTOR, "d-2")).rejects.toMatchObject({ code: "DOC_LOCKED" });
    expect(mockDeleteCaseDocumentRow).not.toHaveBeenCalled();
  });

  it("blocks deleting a rejected document (DOC_REVIEWED → use correction)", async () => {
    mockFindDocumentById.mockResolvedValue(insertedRow({ id: "d-3", status: "rejected" }));
    await expect(deleteCaseDocument(ACTOR, "d-3")).rejects.toMatchObject({ code: "DOC_REVIEWED" });
  });
});

describe("renameCaseDocument — staff fixes a non-fitting name", () => {
  const RID = "11111111-1111-4111-8111-0000000000a1";

  it("updates display_name (trimmed) on the document", async () => {
    mockFindDocumentById.mockResolvedValue(insertedRow({ id: RID, display_name: "repote polcial" }));
    await renameCaseDocument(ACTOR, { documentId: RID, displayName: "  Reporte policial  " });
    expect(mockUpdateDocument).toHaveBeenCalledWith(RID, { display_name: "Reporte policial" });
  });

  it("rejects an empty name (DOC_NAME_REQUIRED)", async () => {
    mockFindDocumentById.mockResolvedValue(insertedRow({ id: RID }));
    await expect(renameCaseDocument(ACTOR, { documentId: RID, displayName: "   " })).rejects.toMatchObject({
      code: "DOC_NAME_REQUIRED",
    });
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it("throws DOC_NOT_FOUND for a missing document", async () => {
    mockFindDocumentById.mockResolvedValue(null);
    await expect(renameCaseDocument(ACTOR, { documentId: RID, displayName: "X" })).rejects.toMatchObject({
      code: "DOC_NOT_FOUND",
    });
  });
});

describe("getCaseDocumentBytes — semantic download filename", () => {
  it("returns a slugified filename from display_name + real extension", async () => {
    mockFindDocumentById.mockResolvedValue(
      insertedRow({ display_name: "Pasaporte de Juan", storage_path: `case/${CASE_ID}/1-raw.pdf`, original_filename: "raw.pdf" }),
    );
    const r = await getCaseDocumentBytes(ACTOR, "ffffffff-ffff-4fff-8fff-000000000001");
    expect(r.filename).toBe("pasaporte-de-juan.pdf");
  });

  it("falls back to the original filename base when display_name is null", async () => {
    mockFindDocumentById.mockResolvedValue(
      insertedRow({ display_name: null, storage_path: `case/${CASE_ID}/1-mi_archivo.pdf`, original_filename: "Mi Archivo.pdf" }),
    );
    const r = await getCaseDocumentBytes(ACTOR, "ffffffff-ffff-4fff-8fff-000000000001");
    expect(r.filename).toBe("mi-archivo.pdf");
  });
});

describe("CaseError codes", () => {
  it("exposes the new document lifecycle codes", () => {
    expect(new CaseError("DOC_NAME_REQUIRED").code).toBe("DOC_NAME_REQUIRED");
    expect(new CaseError("DOC_LOCKED").code).toBe("DOC_LOCKED");
  });
});
