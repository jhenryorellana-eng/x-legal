/**
 * executeExtractionJob — chunked OCR pipeline for large scanned documents.
 *
 * Large PDFs (>30 pages or >15MB) can not be extracted in one Gemini call:
 * the inline request caps at ~20MB and `raw_text` for 200+ pages exceeds any
 * single-response output budget. The chunked route splits the PDF into
 * page-range sub-PDFs (mupdf), OCRs each chunk (checkpointed in
 * `document_extractions.progress` — a QStash retry resumes, never re-pays),
 * self-chains when over the soft time budget, and runs ONE final fields pass
 * over the assembled text. Small documents keep the single-call path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks (pattern: service.test.ts)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const repo = {
    findExtraction: vi.fn(),
    upsertExtraction: vi.fn(),
    updateExtractionDigest: vi.fn().mockResolvedValue(undefined),
    getCaseDocumentForAi: vi.fn(),
    // import-graph stubs (not exercised here)
    findRunById: vi.fn(),
    findActiveRun: vi.fn(),
    maxVersion: vi.fn(),
    insertRun: vi.fn(),
    updateRunStatus: vi.fn(),
    completeRun: vi.fn(),
    markRunFailed: vi.fn(),
    isCancelled: vi.fn(),
    updateRunProgress: vi.fn(),
    patchConfigSnapshot: vi.fn(),
    findGenerationConfig: vi.fn().mockResolvedValue(null),
    countRunningByOrg: vi.fn(),
    listRunsForCase: vi.fn(),
    sumMonthlyCosts: vi.fn(),
    sumCosts: vi.fn(),
    aiCostRows: vi.fn(),
    getOrgCostContext: vi.fn(),
    findTranslation: vi.fn(),
    findTranslationById: vi.fn(),
    insertTranslation: vi.fn(),
    resetTranslation: vi.fn(),
    completeTranslation: vi.fn(),
    getTranslationSource: vi.fn(),
    loadDatasetItems: vi.fn(),
    loadResolvedInputs: vi.fn(),
    resolveGenerationInputs: vi.fn(),
    findCaseDocumentMeta: vi.fn(),
    listCurrentReadyQuestionnaireInstances: vi.fn().mockResolvedValue([]),
    findQuestionnaireGenerationConfig: vi.fn().mockResolvedValue(null),
    updateQuestionnaireInstance: vi.fn().mockResolvedValue(undefined),
    insertPreMortemQueued: vi.fn(),
    findPreMortemAssessmentById: vi.fn(),
    claimPreMortemAssessment: vi.fn(),
    requeuePreMortemAssessment: vi.fn(),
    cancelQueuedPreMortemAssessment: vi.fn(),
    completePreMortemAssessment: vi.fn(),
    markPreMortemFailed: vi.fn(),
    sweepStalePreMortemForCase: vi.fn().mockResolvedValue(0),
    sweepStaleRunsForCase: vi.fn().mockResolvedValue(0),
  };

  const gemini = { generateContent: vi.fn() };
  const getGeminiModels = vi.fn(() => gemini);
  const qstash = { enqueueJob: vi.fn().mockResolvedValue(undefined) };
  const pdf = {
    countPdfPages: vi.fn(),
    extractPdfPageRange: vi.fn(),
    renderMarkdownToPdf: vi.fn(),
    renderMarkdownToDocx: vi.fn(),
    renderCertifiedTranslationPdf: vi.fn(),
  };
  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  // storage download via createServiceClient().storage.from().download()
  const storageDownload = vi.fn();
  const createServiceClient = vi.fn(() => ({
    storage: { from: vi.fn(() => ({ download: storageDownload })) },
  }));

  return { repo, gemini, getGeminiModels, qstash, pdf, events, logger, storageDownload, createServiceClient };
});

vi.mock("../repository", () => mocks.repo);
vi.mock("../events", () => mocks.events);
vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: mocks.getGeminiModels,
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: mocks.qstash.enqueueJob }));
vi.mock("@/backend/platform/pdf", () => mocks.pdf);
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: mocks.createServiceClient,
  createServerClient: vi.fn(),
}));
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
}));
vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: vi.fn(),
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));
vi.mock("@/backend/platform/ratelimit", () => ({
  limitAiImprove: vi.fn().mockResolvedValue({ allowed: true, reset: 0 }),
}));
vi.mock("@/backend/platform/ai-stub", () => ({ isAiStubEnabled: () => false }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/backend/modules/catalog", () => ({ getServiceTranslationConfig: vi.fn() }));
vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

import { executeExtractionJob, assessDocumentLegibility } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOC_ID = "11111111-1111-4111-8111-000000000001";
const PAYLOAD = {
  jobKey: "extract-document" as const,
  entityId: DOC_ID,
  attempt: 1,
  dedupeId: `extract-document:${DOC_ID}`,
  caseDocumentId: DOC_ID,
};

const SCHEMA = {
  type: "object",
  properties: { a_number: { type: "string" }, court_location: { type: "string" } },
  required: ["a_number"],
};

function docFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: DOC_ID,
    caseId: "22222222-2222-4222-8222-000000000001",
    serviceId: null,
    storagePath: `case/x/doc.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1024,
    requiredDocumentType: {
      aiExtract: true,
      extractionSchema: SCHEMA,
      slug: "asilo-presentado-completo-con-anexos",
    },
    ...overrides,
  };
}

function blobOf(bytes: Uint8Array) {
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

/** Gemini response shaped like the SDK result. */
function geminiText(text: string, inTok = 100, outTok = 50) {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok },
  };
}

/** Gemini response cut at the output-token ceiling (finishReason MAX_TOKENS). */
function geminiStopped(text: string, finishReason: string, inTok = 100, outTok = 65536) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason }],
    usageMetadata: { promptTokenCount: inTok, candidatesTokenCount: outTok },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.repo.findExtraction.mockResolvedValue(null);
  mocks.repo.upsertExtraction.mockImplementation(async (row: Record<string, unknown>) => row);
  mocks.storageDownload.mockResolvedValue({ data: blobOf(new Uint8Array([37, 80, 68, 70])), error: null });
});

// ---------------------------------------------------------------------------
// Single-call path (small documents) — regression + raised output budget
// ---------------------------------------------------------------------------

describe("executeExtractionJob — small documents keep the single-call path", () => {
  it("runs ONE multimodal call with raw_text injected and a 65536 output budget", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(6);
    mocks.gemini.generateContent.mockResolvedValue(
      geminiText(JSON.stringify({ a_number: "244-132-587", raw_text: "texto completo" })),
    );

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    expect(mocks.gemini.generateContent).toHaveBeenCalledTimes(1);
    const call = mocks.gemini.generateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0].inlineData).toBeDefined();
    expect(call.config.responseSchema.properties.raw_text).toBeDefined();
    expect(call.config.maxOutputTokens).toBe(65536);
    expect(mocks.pdf.extractPdfPageRange).not.toHaveBeenCalled();

    const completed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(completed.status).toBe("completed");
    expect(completed.raw_text).toBe("texto completo");
    expect(completed.payload).toEqual({ a_number: "244-132-587" });
  });
});

// ---------------------------------------------------------------------------
// Chunked path
// ---------------------------------------------------------------------------

describe("executeExtractionJob — chunked OCR for large documents", () => {
  beforeEach(() => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 14 * 1024 * 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(100); // → 4 chunks of 25
    mocks.pdf.extractPdfPageRange.mockImplementation(
      async (_b: Uint8Array, start: number, end: number) => new Uint8Array([start, end]),
    );
  });

  it("OCRs every 25-page chunk, then one text-only fields pass, and completes", async () => {
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") {
        const chunkBytes = call.contents[0].parts[0].inlineData.data as string;
        const [start] = Array.from(Buffer.from(chunkBytes, "base64"));
        return geminiText(`ocr-del-chunk-${start}`);
      }
      return geminiText(JSON.stringify({ a_number: "244-132-587", court_location: "Houston" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    // 4 OCR calls + 1 fields call
    expect(mocks.gemini.generateContent).toHaveBeenCalledTimes(5);
    const ocrCalls = mocks.gemini.generateContent.mock.calls.filter(
      (c) => c[0].config.responseMimeType === "text/plain",
    );
    expect(ocrCalls).toHaveLength(4);
    // OCR calls carry NO json schema (less truncable) and a big output budget
    for (const c of ocrCalls) {
      expect(c[0].config.responseSchema).toBeUndefined();
      expect(c[0].config.maxOutputTokens).toBe(65536);
    }
    // fields pass: text-only (no inlineData), fields schema WITHOUT raw_text
    const fieldsCall = mocks.gemini.generateContent.mock.calls.at(-1)?.[0];
    expect(fieldsCall.contents[0].parts[0].inlineData).toBeUndefined();
    expect(fieldsCall.contents[0].parts[0].text).toContain("ocr-del-chunk-0");
    expect(fieldsCall.config.responseSchema.properties.raw_text).toBeUndefined();

    const completed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(completed.status).toBe("completed");
    expect(completed.payload).toEqual({ a_number: "244-132-587", court_location: "Houston" });
    // assembled raw_text: page-range markers + ordered chunk texts
    expect(completed.raw_text).toContain("=== Pages 1-25 ===");
    expect(completed.raw_text).toContain("=== Pages 76-100 ===");
    const i0 = completed.raw_text.indexOf("ocr-del-chunk-0");
    const i75 = completed.raw_text.indexOf("ocr-del-chunk-75");
    expect(i0).toBeGreaterThanOrEqual(0);
    expect(i75).toBeGreaterThan(i0);
    // checkpoint cleared on completion
    expect(completed.progress).toBeNull();
    expect(mocks.events.emitExtractionCompleted).toHaveBeenCalledTimes(1);
  });

  it("resumes from the checkpoint without re-OCRing completed chunks", async () => {
    mocks.repo.findExtraction.mockResolvedValue({
      status: "pending",
      progress: {
        kind: "chunked",
        page_count: 100,
        chunk_pages: 25,
        parts: { "0": "ya-estaba-0", "1": "ya-estaba-1" },
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") return geminiText("ocr-nuevo");
      return geminiText(JSON.stringify({ a_number: "244-132-587" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    const ocrCalls = mocks.gemini.generateContent.mock.calls.filter(
      (c) => c[0].config.responseMimeType === "text/plain",
    );
    expect(ocrCalls).toHaveLength(2); // only chunks 2 and 3
    const completed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(completed.raw_text).toContain("ya-estaba-0");
    expect(completed.raw_text).toContain("ocr-nuevo");
  });

  it("self-chains when the soft time budget is exceeded mid-chunks", async () => {
    // First Date.now() (start) → 0; every later check → beyond the budget
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const v = now;
      now += 700_000; // beyond EXTRACTION_SOFT_BUDGET_MS after the first chunk
      return v;
    });
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") return geminiText("ocr");
      return geminiText(JSON.stringify({ a_number: "x" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("deferred");
    expect(mocks.qstash.enqueueJob).toHaveBeenCalledTimes(1);
    const [chainPayload] = mocks.qstash.enqueueJob.mock.calls[0];
    expect(chainPayload.jobKey).toBe("extract-document");
    expect(chainPayload.caseDocumentId).toBe(DOC_ID);
    expect(chainPayload.dedupeId).toMatch(new RegExp(`^extract-document:${DOC_ID}:chain-\\d+$`));
    // checkpoint persisted with at least the first chunk
    const lastUpsert = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(lastUpsert.status).toBe("pending");
    expect(lastUpsert.progress?.parts?.["0"]).toBeDefined();
  });

  it("marks the extraction failed with the chunk index when OCR exhausts its 3 retries", async () => {
    mocks.gemini.generateContent.mockRejectedValue(new Error("gemini down"));

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("failed");
    // 3 attempts on the FIRST chunk only (backoff is a no-op under Vitest).
    expect(mocks.gemini.generateContent).toHaveBeenCalledTimes(3);
    const failed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(failed.status).toBe("failed");
    expect(String(failed.error)).toContain("chunk 0");
  });

  it("bisects a chunk whose OCR truncates at the token ceiling instead of losing the tail", async () => {
    // 31 pages → chunked route (page count >30) → chunks [0,25) and [25,31). The
    // first chunk's full-range OCR truncates (MAX_TOKENS); its two halves ([0,12)
    // and [12,25)) fit. The tail must NOT be silently dropped: the range is
    // re-OCR'd in halves and both are assembled in order.
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 14 * 1024 * 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(31);
    mocks.pdf.extractPdfPageRange.mockImplementation(
      async (_b: Uint8Array, start: number, end: number) => new Uint8Array([start, end]),
    );
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") {
        const [start, end] = Array.from(Buffer.from(call.contents[0].parts[0].inlineData.data, "base64"));
        if (start === 0 && end === 25) return geminiStopped(`trunc-${start}-${end}`, "MAX_TOKENS");
        return geminiText(`ocr-${start}-${end}`);
      }
      return geminiText(JSON.stringify({ a_number: "244-132-587" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    const completed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    // The truncated full-range text is discarded; the two halves are used, in order.
    expect(completed.raw_text).not.toContain("trunc-0-25");
    const iLeft = completed.raw_text.indexOf("ocr-0-12");
    const iRight = completed.raw_text.indexOf("ocr-12-25");
    expect(iLeft).toBeGreaterThanOrEqual(0);
    expect(iRight).toBeGreaterThan(iLeft);
  });

  it("bisects a chunk whose inline bytes exceed the request limit before calling Gemini", async () => {
    // 31 pages → chunks [0,25) and [25,31). The first chunk's sub-PDF is oversized
    // for an inline request (>18MB); it must be split by page BEFORE the call, so
    // the ~20MB inline ceiling is never hit and no page is dropped.
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 14 * 1024 * 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(31);
    const OVERSIZED = 19 * 1024 * 1024;
    mocks.pdf.extractPdfPageRange.mockImplementation(
      async (_b: Uint8Array, start: number, end: number) =>
        start === 0 && end === 25 ? new Uint8Array(OVERSIZED) : new Uint8Array([start, end]),
    );
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") {
        const [start, end] = Array.from(Buffer.from(call.contents[0].parts[0].inlineData.data, "base64"));
        return geminiText(`ocr-${start}-${end}`);
      }
      return geminiText(JSON.stringify({ a_number: "244-132-587" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    // No OCR call carried the oversized payload — it was split first.
    const ocrCalls = mocks.gemini.generateContent.mock.calls.filter(
      (c) => c[0].config.responseMimeType === "text/plain",
    );
    const sentSizes = ocrCalls.map(
      (c) => Buffer.from(c[0].contents[0].parts[0].inlineData.data, "base64").length,
    );
    expect(Math.max(...sentSizes)).toBeLessThan(OVERSIZED);
    const completed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(completed.raw_text).toContain("ocr-0-12");
    expect(completed.raw_text).toContain("ocr-12-25");
  });

  it("computes and persists a page-cited digest for a record large enough to be clipped", async () => {
    // 4 chunks × 30k chars → assembled raw_text >80k → eligible for a digest.
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 14 * 1024 * 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(100);
    mocks.pdf.extractPdfPageRange.mockImplementation(
      async (_b: Uint8Array, start: number, end: number) => new Uint8Array([start, end]),
    );
    const bigChunk = "X".repeat(30_000);
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") return geminiText(bigChunk); // OCR chunk
      if (call.config.responseSchema) return geminiText(JSON.stringify({ a_number: "244-132-587" })); // fields
      return geminiText("RESUMEN págs 1-100: hechos clave del expediente."); // digest (no schema, no mime)
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    // The digest is persisted separately from the completion upsert.
    expect(mocks.repo.updateExtractionDigest).toHaveBeenCalledWith(
      DOC_ID,
      "RESUMEN págs 1-100: hechos clave del expediente.",
    );
    // The digest call carried the faithful prompt over the assembled OCR, no schema.
    const digestCall = mocks.gemini.generateContent.mock.calls.find(
      (c) => !c[0].config.responseMimeType && !c[0].config.responseSchema,
    )?.[0];
    expect(digestCall).toBeDefined();
    expect(digestCall.contents[0].parts[0].text).toContain("paralegal");
    expect(digestCall.contents[0].parts[0].text).toContain("XXXXX");
  });

  it("skips the digest for a small chunked record (fits the budget verbatim)", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 14 * 1024 * 1024 }));
    mocks.pdf.countPdfPages.mockResolvedValue(100);
    mocks.pdf.extractPdfPageRange.mockImplementation(
      async (_b: Uint8Array, start: number, end: number) => new Uint8Array([start, end]),
    );
    mocks.gemini.generateContent.mockImplementation(async (call: Record<string, any>) => {
      if (call.config.responseMimeType === "text/plain") return geminiText("corto"); // tiny OCR
      return geminiText(JSON.stringify({ a_number: "244-132-587" }));
    });

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("completed");
    expect(mocks.repo.updateExtractionDigest).not.toHaveBeenCalled();
  });

  it("rejects documents over the shared 50MB cap with an updated message", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue(docFixture({ sizeBytes: 51 * 1024 * 1024 }));

    const outcome = await executeExtractionJob(PAYLOAD);

    expect(outcome).toBe("failed");
    const failed = mocks.repo.upsertExtraction.mock.calls.at(-1)?.[0];
    expect(String(failed.error)).toContain("AI_DOCUMENT_TOO_LARGE");
    expect(String(failed.error)).toContain("50MB");
  });
});

// ---------------------------------------------------------------------------
// Legibility gate — sampled pages for large PDFs
// ---------------------------------------------------------------------------

describe("assessDocumentLegibility — samples the first pages of large PDFs", () => {
  it("sends only a 5-page sample when the PDF is big", async () => {
    const bigPdf = new Uint8Array(5 * 1024 * 1024);
    const sample = new Uint8Array([9, 9, 9]);
    mocks.pdf.countPdfPages.mockResolvedValue(200);
    mocks.pdf.extractPdfPageRange.mockResolvedValue(sample);
    mocks.gemini.generateContent.mockResolvedValue(
      geminiText(JSON.stringify({ legible: true, blur_level: "none", reason_es: "", reason_en: "" })),
    );

    const verdict = await assessDocumentLegibility({ bytes: bigPdf, mimeType: "application/pdf" });

    expect(verdict.legible).toBe(true);
    // reference equality — deep-comparing a 5MB typed array stalls the worker
    const [argBytes, argStart, argEnd] = mocks.pdf.extractPdfPageRange.mock.calls[0];
    expect(argBytes).toBe(bigPdf);
    expect(argStart).toBe(0);
    expect(argEnd).toBe(5);
    const call = mocks.gemini.generateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0].inlineData.data).toBe(Buffer.from(sample).toString("base64"));
  });

  it("keeps the full bytes for small PDFs", async () => {
    const smallPdf = new Uint8Array([1, 2, 3]);
    mocks.pdf.countPdfPages.mockResolvedValue(3);
    mocks.gemini.generateContent.mockResolvedValue(
      geminiText(JSON.stringify({ legible: true, blur_level: "none", reason_es: "", reason_en: "" })),
    );

    await assessDocumentLegibility({ bytes: smallPdf, mimeType: "application/pdf" });

    expect(mocks.pdf.extractPdfPageRange).not.toHaveBeenCalled();
    const call = mocks.gemini.generateContent.mock.calls[0][0];
    expect(call.contents[0].parts[0].inlineData.data).toBe(Buffer.from(smallPdf).toString("base64"));
  });

  it("fails open if the sampling itself throws", async () => {
    const bigPdf = new Uint8Array(5 * 1024 * 1024);
    mocks.pdf.countPdfPages.mockRejectedValue(new Error("mupdf boom"));
    mocks.gemini.generateContent.mockResolvedValue(
      geminiText(JSON.stringify({ legible: true, blur_level: "none", reason_es: "", reason_en: "" })),
    );

    const verdict = await assessDocumentLegibility({ bytes: bigPdf, mimeType: "application/pdf" });

    expect(verdict.legible).toBe(true);
  });
});
