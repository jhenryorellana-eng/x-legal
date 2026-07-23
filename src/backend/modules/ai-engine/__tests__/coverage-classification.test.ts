/**
 * executeCoverageClassificationJob — combined-upload coverage (classify-document-coverage).
 *
 * After a document's primary extraction completes, the job classifies its
 * raw_text against the phase's detectable sibling types (prompt 100% data-driven
 * from the catalog) and persists one coverage row per detected type, each with
 * a payload extracted against the COVERED type's own extraction_schema.
 *
 * Contract under test:
 *  - skip conditions (non-pdf / inactive doc / no candidates / no raw_text)
 *  - dynamic classification responseSchema built from candidate slugs
 *  - confidence threshold (COVERAGE_CONFIDENCE_THRESHOLD = 0.7 default)
 *  - sticky dismissal: a dismissed coverage is never re-extracted nor revived
 *  - per-type extraction failure degrades to payload=null (coverage still counts)
 *  - re-run coherence via deleteUndetectedCoverages(keep list)
 *  - AI_E2E_STUB: deterministic, zero Gemini calls
 *  - classification hard-failure throws (QStash retries)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const gemini = { generateContent: vi.fn() };
  return {
    getCoverageContext: vi.fn(),
    upsertCoverageRow: vi.fn().mockResolvedValue("inserted"),
    deleteUndetectedCoverages: vi.fn().mockResolvedValue(undefined),
    emitCoverageDetected: vi.fn().mockResolvedValue(undefined),
    gemini,
    getGeminiModels: vi.fn(() => gemini),
    isAiStubEnabled: vi.fn(() => false),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock("../repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repository")>()),
  getCoverageContext: mocks.getCoverageContext,
  upsertCoverageRow: mocks.upsertCoverageRow,
  deleteUndetectedCoverages: mocks.deleteUndetectedCoverages,
}));
vi.mock("../events", () => ({
  emitGenerationCompleted: vi.fn(),
  emitGenerationFailed: vi.fn(),
  emitExtractionCompleted: vi.fn(),
  emitCoverageDetected: mocks.emitCoverageDetected,
}));
vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: mocks.getGeminiModels,
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));
vi.mock("@/backend/platform/ai-stub", () => ({
  isAiStubEnabled: mocks.isAiStubEnabled,
}));
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
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
  limitAiWebResearch: vi.fn().mockResolvedValue({ allowed: true, reset: 0 }),
}));
vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));
vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: vi.fn(),
  renderMarkdownToDocx: vi.fn(),
  renderCertifiedTranslationPdf: vi.fn(),
  countPdfPages: vi.fn(),
  extractPdfPageRange: vi.fn(),
}));
vi.mock("@/backend/platform/embeddings", () => ({
  embedText: vi.fn(),
  toVectorLiteral: vi.fn(),
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

import { executeCoverageClassificationJob } from "../service";
import type { ClassifyCoveragePayload } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOC_ID = "77777777-7777-4777-8777-000000000001";
const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const RDT_DECL = "88888888-8888-4888-8888-000000000001";
const RDT_EVID = "88888888-8888-4888-8888-000000000002";

const PAYLOAD: ClassifyCoveragePayload = {
  jobKey: "classify-document-coverage",
  entityId: DOC_ID,
  attempt: 1,
  dedupeId: `classify-coverage:${DOC_ID}:1`,
  caseDocumentId: DOC_ID,
};

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: RDT_DECL,
    slug: "declaracion-jurada",
    labelI18n: { es: "Declaración jurada", en: "Sworn declaration" },
    helpI18n: null,
    hintsI18n: { es: "Narrativa en primera persona, firmada." },
    extractionSchema: {
      type: "object",
      properties: { declarant_name: { type: "string" } },
      required: ["declarant_name"],
    },
    ...over,
  };
}

function context(over: Record<string, unknown> = {}) {
  return {
    doc: {
      id: DOC_ID,
      caseId: CASE_ID,
      partyId: null,
      status: "uploaded",
      mimeType: "application/pdf",
      requiredDocumentTypeId: "99999999-9999-4999-8999-000000000001",
      servicePhaseId: "11111111-1111-4111-8111-000000000001",
    },
    rawText: "I-589 text… DECLARATION OF JUAN… evidence annexes…",
    candidates: [candidate()],
    existingByRdtId: new Map<string, { status: string }>(),
    ...over,
  };
}

/** Gemini response wrapper with usage metadata. */
function geminiJson(obj: unknown) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGeminiModels.mockReturnValue(mocks.gemini);
  mocks.isAiStubEnabled.mockReturnValue(false);
  mocks.upsertCoverageRow.mockResolvedValue("inserted");
  mocks.deleteUndetectedCoverages.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Skip conditions
// ---------------------------------------------------------------------------

describe("skip conditions", () => {
  it("skips a missing document", async () => {
    mocks.getCoverageContext.mockResolvedValue(null);
    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("skipped");
    expect(mocks.gemini.generateContent).not.toHaveBeenCalled();
  });

  it("skips a non-PDF source (PNG signatures never classify)", async () => {
    mocks.getCoverageContext.mockResolvedValue(
      context({ doc: { ...context().doc, mimeType: "image/png" } }),
    );
    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("skipped");
  });

  it("skips when the source document is no longer active (rejected)", async () => {
    mocks.getCoverageContext.mockResolvedValue(
      context({ doc: { ...context().doc, status: "rejected" } }),
    );
    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("skipped");
  });

  it("skips when the phase has no eligible candidates", async () => {
    mocks.getCoverageContext.mockResolvedValue(context({ candidates: [] }));
    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("skipped");
  });

  it("skips when the primary extraction has no raw_text yet", async () => {
    mocks.getCoverageContext.mockResolvedValue(context({ rawText: null }));
    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("skipped");
  });
});

// ---------------------------------------------------------------------------
// Classification + per-type extraction
// ---------------------------------------------------------------------------

describe("classification + per-type extraction", () => {
  it("persists a detected coverage with the covered type's extracted payload and emits the event", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent
      // 1) classification
      .mockResolvedValueOnce(
        geminiJson({
          "declaracion-jurada": { present: true, confidence: 0.92, page_range: "12-18" },
        }),
      )
      // 2) per-type extraction with the COVERED type's schema
      .mockResolvedValueOnce(geminiJson({ declarant_name: "Juan Pérez" }));

    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("completed");

    // Classification call: responseSchema built dynamically from candidate slugs.
    const classifyCall = mocks.gemini.generateContent.mock.calls[0][0];
    expect(classifyCall.config.responseSchema.properties).toHaveProperty("declaracion-jurada");
    expect(classifyCall.config.responseSchema.required).toEqual(["declaracion-jurada"]);
    // Prompt is data-driven: label + hints reach the model verbatim.
    const promptText = classifyCall.contents[0].parts[0].text as string;
    expect(promptText).toContain("declaracion-jurada");
    expect(promptText).toContain("Narrativa en primera persona, firmada.");

    // Extraction call uses the covered type's own schema.
    const extractCall = mocks.gemini.generateContent.mock.calls[1][0];
    expect(extractCall.config.responseSchema.properties).toHaveProperty("declarant_name");
    expect(extractCall.config.responseSchema.required).toEqual(["declarant_name"]);

    expect(mocks.upsertCoverageRow).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCoverageRow.mock.calls[0][0]).toMatchObject({
      case_id: CASE_ID,
      case_document_id: DOC_ID,
      covered_required_document_type_id: RDT_DECL,
      party_id: null,
      confidence: 0.92,
      page_range: "12-18",
      payload: { declarant_name: "Juan Pérez" },
    });
    expect(mocks.deleteUndetectedCoverages).toHaveBeenCalledWith(DOC_ID, [RDT_DECL]);
    expect(mocks.emitCoverageDetected).toHaveBeenCalledWith({
      caseId: CASE_ID,
      caseDocumentId: DOC_ID,
      coveredRequirementIds: [RDT_DECL],
    });
  });

  it("a below-threshold detection persists nothing and clears stale rows", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent.mockResolvedValueOnce(
      geminiJson({ "declaracion-jurada": { present: true, confidence: 0.4 } }),
    );

    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("completed");
    expect(mocks.upsertCoverageRow).not.toHaveBeenCalled();
    // Re-run coherence: no keep list → any stale 'detected' rows are dropped.
    expect(mocks.deleteUndetectedCoverages).toHaveBeenCalledWith(DOC_ID, []);
    expect(mocks.emitCoverageDetected).not.toHaveBeenCalled();
  });

  it("present=false never persists (conservative default)", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent.mockResolvedValueOnce(
      geminiJson({ "declaracion-jurada": { present: false, confidence: 0.95 } }),
    );

    await executeCoverageClassificationJob(PAYLOAD);
    expect(mocks.upsertCoverageRow).not.toHaveBeenCalled();
  });

  it("a dismissed coverage is sticky: no re-extraction, kept out of the delete list, no emit", async () => {
    mocks.getCoverageContext.mockResolvedValue(
      context({ existingByRdtId: new Map([[RDT_DECL, { status: "dismissed" }]]) }),
    );
    mocks.gemini.generateContent.mockResolvedValueOnce(
      geminiJson({ "declaracion-jurada": { present: true, confidence: 0.9 } }),
    );

    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("completed");
    // Only the classification call — the (costly) per-type extraction is skipped.
    expect(mocks.gemini.generateContent).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCoverageRow).not.toHaveBeenCalled();
    // Still in the keep list so deleteUndetectedCoverages (status='detected'
    // only) leaves the dismissed row untouched either way.
    expect(mocks.deleteUndetectedCoverages).toHaveBeenCalledWith(DOC_ID, [RDT_DECL]);
    expect(mocks.emitCoverageDetected).not.toHaveBeenCalled();
  });

  it("per-type extraction failing BOTH attempts degrades to payload=null (coverage still counts)", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent
      .mockResolvedValueOnce(
        geminiJson({ "declaracion-jurada": { present: true, confidence: 0.85 } }),
      )
      .mockRejectedValueOnce(new Error("gemini 500"))
      .mockRejectedValueOnce(new Error("gemini 500"));

    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("completed");
    expect(mocks.upsertCoverageRow).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCoverageRow.mock.calls[0][0]).toMatchObject({
      covered_required_document_type_id: RDT_DECL,
      payload: null,
    });
    expect(mocks.emitCoverageDetected).toHaveBeenCalledTimes(1);
  });

  it("retries the per-type extraction with feedback when required fields are missing", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent
      .mockResolvedValueOnce(
        geminiJson({ "declaracion-jurada": { present: true, confidence: 0.85 } }),
      )
      .mockResolvedValueOnce(geminiJson({ wrong_field: "x" }))
      .mockResolvedValueOnce(geminiJson({ declarant_name: "Juan" }));

    await executeCoverageClassificationJob(PAYLOAD);
    const retryPrompt = mocks.gemini.generateContent.mock.calls[2][0].contents[0].parts[0].text as string;
    expect(retryPrompt).toContain("declarant_name");
    expect(mocks.upsertCoverageRow.mock.calls[0][0]).toMatchObject({
      payload: { declarant_name: "Juan" },
    });
  });

  it("classifies MULTIPLE candidates and only persists the detected subset", async () => {
    mocks.getCoverageContext.mockResolvedValue(
      context({
        candidates: [
          candidate(),
          candidate({
            id: RDT_EVID,
            slug: "evidencias",
            extractionSchema: {
              type: "object",
              properties: { summary: { type: "string" } },
              required: ["summary"],
            },
          }),
        ],
      }),
    );
    mocks.gemini.generateContent
      .mockResolvedValueOnce(
        geminiJson({
          "declaracion-jurada": { present: true, confidence: 0.9 },
          evidencias: { present: false, confidence: 0.9 },
        }),
      )
      .mockResolvedValueOnce(geminiJson({ declarant_name: "Juan" }));

    await executeCoverageClassificationJob(PAYLOAD);
    expect(mocks.upsertCoverageRow).toHaveBeenCalledTimes(1);
    expect(mocks.deleteUndetectedCoverages).toHaveBeenCalledWith(DOC_ID, [RDT_DECL]);
  });

  it("throws when the classification call fails twice (QStash retries the job)", async () => {
    mocks.getCoverageContext.mockResolvedValue(context());
    mocks.gemini.generateContent
      .mockRejectedValueOnce(new Error("gemini down"))
      .mockRejectedValueOnce(new Error("gemini down"));

    await expect(executeCoverageClassificationJob(PAYLOAD)).rejects.toThrow("gemini down");
    expect(mocks.upsertCoverageRow).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AI_E2E_STUB
// ---------------------------------------------------------------------------

describe("AI_E2E_STUB", () => {
  it("marks every candidate detected deterministically without any Gemini call", async () => {
    mocks.isAiStubEnabled.mockReturnValue(true);
    mocks.getCoverageContext.mockResolvedValue(context());

    await expect(executeCoverageClassificationJob(PAYLOAD)).resolves.toBe("completed");
    expect(mocks.gemini.generateContent).not.toHaveBeenCalled();
    expect(mocks.upsertCoverageRow).toHaveBeenCalledTimes(1);
    expect(mocks.upsertCoverageRow.mock.calls[0][0]).toMatchObject({
      confidence: 0.99,
      payload: { declarant_name: "STUB" },
    });
    expect(mocks.emitCoverageDetected).toHaveBeenCalledTimes(1);
  });
});
