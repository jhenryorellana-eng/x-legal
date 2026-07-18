/**
 * resolveAiFields — raw_text context + fingerprint cache (ola apelación).
 *
 * (a) Context documents PREFER the completed extraction's raw_text over raw
 *     bytes: a 14MB scanned record used to be SKIPPED by the 12MB inline
 *     guardrail, leaving the EOIR-26 item #6 draft without its main context.
 * (b) The resolution is cached per (case, party, question) with an input
 *     fingerprint (instruction + connected + model + document set metadata),
 *     validated on read — no more one-Gemini-call-per-wizard-open.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockDownloadDocumentBytesBySlug,
  mockDownloadAllDocumentBytesBySlug,
  mockFindRawTextsBySlug,
  mockListDocumentMetaBySlugs,
  mockFindAiFieldCacheRows,
  mockUpsertAiFieldCacheRows,
  mockInterpretDocumentFields,
} = vi.hoisted(() => ({
  mockDownloadDocumentBytesBySlug: vi.fn(),
  mockDownloadAllDocumentBytesBySlug: vi.fn().mockResolvedValue([]),
  mockFindRawTextsBySlug: vi.fn().mockResolvedValue([]),
  mockListDocumentMetaBySlugs: vi.fn().mockResolvedValue([]),
  mockFindAiFieldCacheRows: vi.fn().mockResolvedValue([]),
  mockUpsertAiFieldCacheRows: vi.fn().mockResolvedValue(undefined),
  mockInterpretDocumentFields: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {},
}));
vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn(), on: vi.fn() },
}));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn(),
  appendCaseTimeline: vi.fn(),
}));
vi.mock("@/backend/platform/crypto", () => ({
  decryptPiiField: vi.fn(),
  encryptPiiField: vi.fn(),
  isAllowedPiiKey: vi.fn().mockReturnValue(true),
  maskValue: vi.fn(),
  ALLOWED_PII_KEYS: [],
}));
vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    downloadDocumentBytesBySlug: mockDownloadDocumentBytesBySlug,
    downloadAllDocumentBytesBySlug: mockDownloadAllDocumentBytesBySlug,
    findRawTextsBySlug: mockFindRawTextsBySlug,
    listDocumentMetaBySlugs: mockListDocumentMetaBySlugs,
    findAiFieldCacheRows: mockFindAiFieldCacheRows,
    upsertAiFieldCacheRows: mockUpsertAiFieldCacheRows,
    findCompletedGenerationByFormSlug: vi.fn().mockResolvedValue(null),
  };
});
vi.mock("@/backend/modules/ai-engine", () => ({
  interpretDocumentFields: mockInterpretDocumentFields,
  synthesizeLetterFields: vi.fn().mockResolvedValue({}),
}));

import { resolveAiFields } from "../service";

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const Q6 = "eeeeeeee-eeee-4eee-8eee-000000000006";

const FIELD = {
  id: Q6,
  connected: {
    kind: "document",
    slug: "decision-y-orden-del-juez-de-inmigracion",
    context_slugs: ["asilo-presentado-completo-con-anexos"],
  },
  instruction: "Redacta las razones de la apelación.",
  model: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDownloadDocumentBytesBySlug.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: "application/pdf",
  });
  mockDownloadAllDocumentBytesBySlug.mockResolvedValue([]);
  mockFindRawTextsBySlug.mockResolvedValue([]);
  mockListDocumentMetaBySlugs.mockResolvedValue([
    { id: "doc-dec", slug: "decision-y-orden-del-juez-de-inmigracion", size_bytes: 3, updated_at: "2026-07-01T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-01T00:05:00Z" },
    { id: "doc-asilo", slug: "asilo-presentado-completo-con-anexos", size_bytes: 14_000_000, updated_at: "2026-07-02T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-02T00:20:00Z" },
  ]);
  mockFindAiFieldCacheRows.mockResolvedValue([]);
  mockInterpretDocumentFields.mockResolvedValue({ [Q6]: "Borrador del ítem 6" });
});

describe("resolveAiFields — raw_text context", () => {
  it("passes the extracted raw_text as contextTexts instead of downloading bytes", async () => {
    mockFindRawTextsBySlug.mockResolvedValue([
      { rawText: "TEXTO COMPLETO DEL ASILO (227 págs)", label: "Asilo completo" },
    ]);

    const out = await resolveAiFields(CASE_ID, null, [FIELD]);

    expect(out[Q6]).toBe("Borrador del ítem 6");
    const call = mockInterpretDocumentFields.mock.calls[0][0];
    expect(call.contextTexts).toEqual([
      { text: "TEXTO COMPLETO DEL ASILO (227 págs)", label: "Asilo completo" },
    ]);
    expect(call.contextFiles).toBeUndefined();
    expect(mockDownloadAllDocumentBytesBySlug).not.toHaveBeenCalled();
  });

  it("falls back to byte context for slugs without a completed extraction", async () => {
    mockFindRawTextsBySlug.mockResolvedValue([]);
    mockDownloadAllDocumentBytesBySlug.mockResolvedValue([
      { bytes: new Uint8Array([9]), mimeType: "application/pdf", label: "Asilo completo" },
    ]);

    await resolveAiFields(CASE_ID, null, [FIELD]);

    const call = mockInterpretDocumentFields.mock.calls[0][0];
    expect(call.contextFiles).toHaveLength(1);
    expect(call.contextTexts).toBeUndefined();
  });
});

describe("resolveAiFields — fingerprint cache", () => {
  it("computes once, upserts with a fingerprint, then serves the cache without provider calls", async () => {
    // First resolution: miss → provider + upsert
    const first = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(first[Q6]).toBe("Borrador del ítem 6");
    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(1);
    expect(mockUpsertAiFieldCacheRows).toHaveBeenCalledTimes(1);
    const upserted = mockUpsertAiFieldCacheRows.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(upserted[0].question_id).toBe(Q6);
    expect(upserted[0].value).toBe("Borrador del ítem 6");
    const fingerprint = upserted[0].input_fingerprint as string;
    expect(fingerprint.length).toBeGreaterThan(10);

    // Second resolution: same inputs → cache hit, ZERO provider calls
    mockFindAiFieldCacheRows.mockResolvedValue([
      { question_id: Q6, input_fingerprint: fingerprint, value: "Borrador del ítem 6" },
    ]);
    const second = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(second[Q6]).toBe("Borrador del ítem 6");
    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(1); // unchanged
    expect(mockDownloadDocumentBytesBySlug).toHaveBeenCalledTimes(1); // no re-download either
  });

  it("recomputes when the document set changed (fingerprint mismatch)", async () => {
    const first = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(first[Q6]).toBe("Borrador del ítem 6");
    const fingerprint = (mockUpsertAiFieldCacheRows.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
      .input_fingerprint as string;

    // A new upload replaced the asylum package → updated_at changes
    mockFindAiFieldCacheRows.mockResolvedValue([
      { question_id: Q6, input_fingerprint: fingerprint, value: "viejo" },
    ]);
    mockListDocumentMetaBySlugs.mockResolvedValue([
      { id: "doc-dec", slug: "decision-y-orden-del-juez-de-inmigracion", size_bytes: 3, updated_at: "2026-07-01T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-01T00:05:00Z" },
      { id: "doc-asilo-2", slug: "asilo-presentado-completo-con-anexos", size_bytes: 15_000_000, updated_at: "2026-07-10T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-10T00:30:00Z" },
    ]);

    const second = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(second[Q6]).toBe("Borrador del ítem 6");
    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(2);
  });

  it("recomputes when a context document's extraction COMPLETES after the first resolution", async () => {
    // First resolution: the 227-page context is still OCR'ing → cached with status pending
    mockListDocumentMetaBySlugs.mockResolvedValue([
      { id: "doc-dec", slug: "decision-y-orden-del-juez-de-inmigracion", size_bytes: 3, updated_at: "2026-07-01T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-01T00:05:00Z" },
      { id: "doc-asilo", slug: "asilo-presentado-completo-con-anexos", size_bytes: 14_000_000, updated_at: "2026-07-02T00:00:00Z", extraction_status: "pending", extraction_completed_at: null },
    ]);
    const first = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(first[Q6]).toBe("Borrador del ítem 6");
    const fingerprint = (mockUpsertAiFieldCacheRows.mock.calls[0][0] as Array<Record<string, unknown>>)[0]
      .input_fingerprint as string;

    // Extraction completes (case_documents.updated_at UNCHANGED — the completion
    // writes to document_extractions only): the fingerprint must still change.
    mockFindAiFieldCacheRows.mockResolvedValue([
      { question_id: Q6, input_fingerprint: fingerprint, value: "pobre (sin contexto)" },
    ]);
    mockListDocumentMetaBySlugs.mockResolvedValue([
      { id: "doc-dec", slug: "decision-y-orden-del-juez-de-inmigracion", size_bytes: 3, updated_at: "2026-07-01T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-01T00:05:00Z" },
      { id: "doc-asilo", slug: "asilo-presentado-completo-con-anexos", size_bytes: 14_000_000, updated_at: "2026-07-02T00:00:00Z", extraction_status: "completed", extraction_completed_at: "2026-07-02T00:25:00Z" },
    ]);

    const second = await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(second[Q6]).toBe("Borrador del ítem 6");
    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(2);
  });

  it("never caches an empty provider result", async () => {
    mockInterpretDocumentFields.mockResolvedValue({});
    await resolveAiFields(CASE_ID, null, [FIELD]);
    expect(mockUpsertAiFieldCacheRows).not.toHaveBeenCalled();
  });

  it("serves the STALE cached value when a recompute comes back empty (never blank a good field)", async () => {
    mockFindAiFieldCacheRows.mockResolvedValue([
      { question_id: Q6, input_fingerprint: "huella-vieja-distinta", value: "Borrador bueno de hace 30 min" },
    ]);
    mockInterpretDocumentFields.mockResolvedValue({}); // provider hiccup on recompute

    const out = await resolveAiFields(CASE_ID, null, [FIELD]);

    expect(mockInterpretDocumentFields).toHaveBeenCalledTimes(1); // recompute attempted
    expect(out[Q6]).toBe("Borrador bueno de hace 30 min"); // stale beats empty
    expect(mockUpsertAiFieldCacheRows).not.toHaveBeenCalled(); // stale is not re-cached
  });
});
