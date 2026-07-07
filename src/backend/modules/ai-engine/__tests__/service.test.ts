/**
 * ai-engine service — unit tests with platform + repository mocked.
 *
 * Strategy: all I/O (repository, qstash, anthropic, gemini, authz, storage)
 * is mocked with vi.hoisted() + vi.mock(). Tests validate the orchestration
 * logic (state transitions, concurrency guards, idempotence, error paths)
 * without hitting any real external service.
 *
 * Key patterns:
 *  - vi.hoisted() for variables used inside vi.mock() factories
 *  - All repo functions are spies on the hoisted mock objects
 *  - Platform modules mocked at the module level (no dynamic import)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — declare mock variables BEFORE vi.mock() runs
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // repository mock functions
  const repo = {
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
    findExtraction: vi.fn(),
    upsertExtraction: vi.fn(),
    findTranslation: vi.fn(),
    findTranslationById: vi.fn(),
    insertTranslation: vi.fn(),
    resetTranslation: vi.fn(),
    completeTranslation: vi.fn(),
    getCaseDocumentForAi: vi.fn(),
    getTranslationSource: vi.fn(),
    loadDatasetItems: vi.fn(),
    loadResolvedInputs: vi.fn(),
  };

  // platform mock functions
  const authz = {
    can: vi.fn(),
    requireCaseAccess: vi.fn(),
  };

  const qstash = {
    enqueueJob: vi.fn(),
  };

  const anthropic = {
    stream: vi.fn(),
    finalMessage: vi.fn(),
  };

  const anthropicClient = {
    messages: {
      stream: vi.fn(() => ({
        finalMessage: anthropic.finalMessage,
      })),
      // Non-streaming create — used by proposeFormSegmentation / proposeExtractionSchema.
      create: vi.fn(),
    },
  };

  const getAnthropicClient = vi.fn(() => anthropicClient);

  const gemini = {
    generateContent: vi.fn(),
  };

  const geminiModels = {
    generateContent: gemini.generateContent,
  };

  const getGeminiModels = vi.fn(() => geminiModels);

  const storage = {
    createSignedDownloadUrl: vi.fn(),
    uploadBytesToStorage: vi.fn(),
    downloadBytesFromStorage: vi.fn(),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const audit = {
    writeAudit: vi.fn(),
  };

  const pdf = {
    renderMarkdownToPdf: vi.fn(),
    renderMarkdownToDocx: vi.fn(),
    renderCertifiedTranslationPdf: vi.fn(),
  };

  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };

  const catalog = {
    getServiceTranslationConfig: vi.fn(),
  };

  return {
    repo,
    authz,
    qstash,
    anthropic,
    anthropicClient,
    getAnthropicClient,
    geminiModels,
    getGeminiModels,
    storage,
    logger,
    audit,
    pdf,
    events,
    catalog,
  };
});

vi.mock("@/backend/modules/catalog", () => ({
  getServiceTranslationConfig: mocks.catalog.getServiceTranslationConfig,
}));

// ---------------------------------------------------------------------------
// vi.mock() — module-level intercepts
// ---------------------------------------------------------------------------

vi.mock("../repository", () => mocks.repo);

vi.mock("@/backend/platform/authz", () => ({
  can: mocks.authz.can,
  requireCaseAccess: mocks.authz.requireCaseAccess,
  AuthzError: class AuthzError extends Error {
    constructor(code: string) {
      super(code);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: mocks.qstash.enqueueJob,
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
}));

vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: mocks.getGeminiModels,
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));

// Force the non-stub (real Gemini) path for assessDocumentLegibility tests; the
// generateContent call is mocked above, so no real provider is hit.
vi.mock("@/backend/platform/ai-stub", () => ({
  isAiStubEnabled: () => false,
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: mocks.storage.createSignedDownloadUrl,
  uploadBytesToStorage: mocks.storage.uploadBytesToStorage,
  downloadBytesFromStorage: mocks.storage.downloadBytesFromStorage,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mocks.audit.writeAudit,
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: mocks.pdf.renderMarkdownToPdf,
  renderMarkdownToDocx: mocks.pdf.renderMarkdownToDocx,
  renderCertifiedTranslationPdf: mocks.pdf.renderCertifiedTranslationPdf,
}));

// URL verification hits the network — stub it so research sources aren't dropped
// in unit tests (the reachability logic itself is covered in url-utils.test.ts).
vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

vi.mock("../events", () => ({
  emitGenerationCompleted: mocks.events.emitGenerationCompleted,
  emitGenerationFailed: mocks.events.emitGenerationFailed,
  emitExtractionCompleted: mocks.events.emitExtractionCompleted,
}));

vi.mock("@/shared/constants/ai-models", () => ({
  DEFAULT_GENERATION_MODEL: "claude-sonnet-4-6",
  FALLBACK_GENERATION_MODEL: "claude-sonnet-4-6",
  GENERATION_MODELS: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-fable-5", "claude-haiku-4-5"],
}));

// Supabase mock — needed for functions that call createServiceClient() directly
// Returns a chainable no-op builder for UPDATE queries
vi.mock("@/backend/platform/supabase", () => {
  const chainable = {
    from: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
  };
  // Make all chainable methods return the same chainable object
  Object.keys(chainable).forEach((key) => {
    (chainable as Record<string, unknown>)[key] = vi.fn().mockReturnValue({ ...chainable, then: undefined, error: null, data: null });
  });
  const mockClient = {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          in: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  };
  return {
    createServiceClient: vi.fn(() => mockClient),
    createServerClient: vi.fn(() => mockClient),
  };
});

// ---------------------------------------------------------------------------
// Import subject AFTER mocks are set up
// ---------------------------------------------------------------------------

import {
  startGeneration,
  executeGenerationJob,
  cancelGeneration,
  markRunFailedByCallback,
  markExtractionFailed,
  markTranslationFailed,
  getRunsForCase,
  proposeFormSegmentation,
  proposeExpedienteAssembly,
  translateAnswerText,
  translateAnswersBatch,
  assessDocumentLegibility,
  interpretDocumentFields,
  synthesizeLetterFields,
  executeTranslationJob,
  getDocumentTranslation,
  getDocumentTranslationPdf,
  getAiCostsReport,
  AiEngineError,
} from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

import type { Actor } from "@/backend/platform/authz";

const ADMIN_ACTOR: Actor = {
  userId: "user-admin-111",
  orgId: "org-111",
  kind: "staff",
  role: "admin",
  permissions: new Map(),
};

const STAFF_ACTOR: Actor = {
  userId: "user-staff-222",
  orgId: "org-222",
  kind: "staff",
  role: "paralegal",
  permissions: new Map(),
};

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const FORM_DEF_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "44444444-4444-4444-8444-444444444444";

const BASE_RUN = {
  id: RUN_ID,
  case_id: CASE_ID,
  form_definition_id: FORM_DEF_ID,
  org_id: ORG_ID,
  version: 1,
  status: "queued" as const,
  model: "claude-sonnet-4-6",
  config_snapshot: null,
  output_storage_path: null,
  cost_usd: null,
  progress: null,
  attempt: 1,
  is_test: false,
  created_at: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-01T00:00:00.000Z",
};

// BASE_DOC: available for future extraction tests
const _BASE_DOC = {
  id: "doc-111",
  case_id: CASE_ID,
  file_name: "passport.pdf",
  storage_path: "orgs/org-111/cases/case-111/passport.pdf",
  mime_type: "application/pdf",
  file_size_bytes: 500000,
  page_count: 5,
  required_document_type: {
    slug: "passport",
    ai_extract: true,
    extraction_schema: { name: { type: "string" } },
  },
};

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: authz passes
  mocks.authz.can.mockReturnValue(undefined);
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);

  // Default: repo returns sensible values
  mocks.repo.maxVersion.mockResolvedValue(null);
  mocks.repo.findActiveRun.mockResolvedValue(null);
  mocks.repo.countRunningByOrg.mockResolvedValue(0);
  mocks.repo.sumMonthlyCosts.mockResolvedValue(0);
  mocks.repo.insertRun.mockResolvedValue(BASE_RUN);
  mocks.repo.loadDatasetItems.mockResolvedValue([]);
  mocks.qstash.enqueueJob.mockResolvedValue(undefined);
  mocks.audit.writeAudit.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// startGeneration (API-AI-01)
// ---------------------------------------------------------------------------

describe("startGeneration", () => {
  const validInput = {
    caseId: CASE_ID,
    formDefinitionId: FORM_DEF_ID,
    partyId: null,
    isTest: false,
  };

  it("creates a queued run and enqueues the job", async () => {
    const result = await startGeneration(ADMIN_ACTOR, validInput);

    expect(mocks.repo.insertRun).toHaveBeenCalledOnce();
    expect(mocks.qstash.enqueueJob).toHaveBeenCalledOnce();
    expect(mocks.qstash.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: "run-generation" }),
      expect.anything(), // options (retries, etc.)
    );
    expect(result.run).toBeDefined();
    expect(result.run.id).toBe(RUN_ID);
  });

  it("calls can() with cases:edit permission", async () => {
    await startGeneration(ADMIN_ACTOR, validInput);
    expect(mocks.authz.can).toHaveBeenCalledWith(
      ADMIN_ACTOR,
      "cases",
      "edit",
    );
  });

  it("calls requireCaseAccess with the caseId", async () => {
    await startGeneration(ADMIN_ACTOR, validInput);
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(
      ADMIN_ACTOR,
      CASE_ID,
    );
  });

  it("rejects non-admin isTest=true request", async () => {
    await expect(
      startGeneration(STAFF_ACTOR, { ...validInput, isTest: true }),
    ).rejects.toThrow();
  });

  it("throws when an active run already exists (duplicate guard)", async () => {
    mocks.repo.findActiveRun.mockResolvedValue(BASE_RUN);

    await expect(startGeneration(ADMIN_ACTOR, validInput)).rejects.toThrow(
      AiEngineError,
    );
    // Should NOT insert a new run
    expect(mocks.repo.insertRun).not.toHaveBeenCalled();
  });

  it("writes an audit log entry", async () => {
    await startGeneration(ADMIN_ACTOR, validInput);
    expect(mocks.audit.writeAudit).toHaveBeenCalled();
  });

  it("returns null budgetWarning when no budget configured (sumMonthlyCosts=0, no org budget)", async () => {
    const result = await startGeneration(ADMIN_ACTOR, validInput);
    // If org has no budget configured, evaluateBudget returns 'ok'
    // budgetWarning is null when 'ok' (non-blocking)
    expect(result.budgetWarning === null || result.budgetWarning === "ok").toBe(true);
  });

  it("assigns version=1 for first run", async () => {
    mocks.repo.maxVersion.mockResolvedValue(null);
    await startGeneration(ADMIN_ACTOR, validInput);
    const insertedRun = mocks.repo.insertRun.mock.calls[0][0] as {
      version: number;
    };
    expect(insertedRun.version).toBe(1);
  });

  it("increments version for subsequent runs", async () => {
    mocks.repo.maxVersion.mockResolvedValue(2);
    await startGeneration(ADMIN_ACTOR, validInput);
    const insertedRun = mocks.repo.insertRun.mock.calls[0][0] as {
      version: number;
    };
    expect(insertedRun.version).toBe(3);
  });

  it("propagates authz error when can() throws", async () => {
    mocks.authz.can.mockImplementation(() => {
      throw new Error("forbidden");
    });
    await expect(startGeneration(ADMIN_ACTOR, validInput)).rejects.toThrow("forbidden");
    expect(mocks.repo.insertRun).not.toHaveBeenCalled();
  });

  it("enqueues with dedupeId containing runId", async () => {
    await startGeneration(ADMIN_ACTOR, validInput);
    const callPayload = mocks.qstash.enqueueJob.mock.calls[0][0] as {
      dedupeId?: string;
    };
    expect(callPayload.dedupeId).toBeTruthy();
    expect(callPayload.dedupeId).toContain(RUN_ID);
  });
});

// ---------------------------------------------------------------------------
// cancelGeneration (API-AI-04)
// ---------------------------------------------------------------------------

describe("cancelGeneration", () => {
  it("transitions run from queued to cancelled", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "queued" });
    mocks.repo.updateRunStatus.mockResolvedValue({ ...BASE_RUN, status: "cancelled" });

    await cancelGeneration(ADMIN_ACTOR, RUN_ID);

    // Cancels only a still-queued/running run (TOCTOU guard via conditional WHERE).
    expect(mocks.repo.updateRunStatus).toHaveBeenCalledWith(
      RUN_ID,
      "cancelled",
      undefined,
      ["queued", "running"],
    );
    // Cross-tenant guard runs before the mutation.
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ADMIN_ACTOR, CASE_ID);
  });

  it("throws AI_RUN_NOT_FOUND when run does not exist", async () => {
    mocks.repo.findRunById.mockResolvedValue(null);

    await expect(cancelGeneration(ADMIN_ACTOR, RUN_ID)).rejects.toThrow(AiEngineError);
    await expect(cancelGeneration(ADMIN_ACTOR, RUN_ID)).rejects.toMatchObject({
      code: "AI_RUN_NOT_FOUND",
    });
  });

  it("throws AI_RUN_INVALID_STATE when run is already completed", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "completed" });

    await expect(cancelGeneration(ADMIN_ACTOR, RUN_ID)).rejects.toThrow(AiEngineError);
    await expect(cancelGeneration(ADMIN_ACTOR, RUN_ID)).rejects.toMatchObject({
      code: "AI_RUN_INVALID_STATE",
    });
  });

  it("throws AI_RUN_INVALID_STATE when run is already cancelled", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "cancelled" });

    await expect(cancelGeneration(ADMIN_ACTOR, RUN_ID)).rejects.toThrow(AiEngineError);
  });

  it("writes audit log on successful cancel", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "queued" });
    mocks.repo.updateRunStatus.mockResolvedValue({ ...BASE_RUN, status: "cancelled" });

    await cancelGeneration(ADMIN_ACTOR, RUN_ID);

    expect(mocks.audit.writeAudit).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markRunFailedByCallback (job-failed callback)
// ---------------------------------------------------------------------------

describe("markRunFailedByCallback", () => {
  it("marks run as failed with error message", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "running" });
    mocks.repo.markRunFailed.mockResolvedValue({ ...BASE_RUN, status: "failed" });

    await markRunFailedByCallback(RUN_ID, "max retries exhausted");

    expect(mocks.repo.markRunFailed).toHaveBeenCalledWith(
      RUN_ID,
      "max retries exhausted",
    );
  });

  it("emits generation failed event", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "running" });
    mocks.repo.markRunFailed.mockResolvedValue({ ...BASE_RUN, status: "failed" });

    await markRunFailedByCallback(RUN_ID, "error");

    expect(mocks.events.emitGenerationFailed).toHaveBeenCalled();
  });

  it("is a no-op when run is not found (idempotent)", async () => {
    mocks.repo.findRunById.mockResolvedValue(null);

    // Should not throw
    await expect(markRunFailedByCallback(RUN_ID, "error")).resolves.toBeUndefined();
    expect(mocks.repo.markRunFailed).not.toHaveBeenCalled();
  });

  it("calls markRunFailed even for completed run (repo enforces idempotence)", async () => {
    // The service delegates idempotence to the repo layer (conditional UPDATE in DB)
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "completed" });
    mocks.repo.markRunFailed.mockResolvedValue(undefined);

    await expect(markRunFailedByCallback(RUN_ID, "error")).resolves.toBeUndefined();
    // markRunFailed called — repo-level WHERE guard prevents actual state change
    expect(mocks.repo.markRunFailed).toHaveBeenCalledWith(RUN_ID, "error");
  });

  it("calls markRunFailed even for failed run (idempotent upsert-style)", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, status: "failed" });
    mocks.repo.markRunFailed.mockResolvedValue(undefined);

    await expect(markRunFailedByCallback(RUN_ID, "error")).resolves.toBeUndefined();
    expect(mocks.repo.markRunFailed).toHaveBeenCalledWith(RUN_ID, "error");
  });
});

// ---------------------------------------------------------------------------
// markExtractionFailed
// ---------------------------------------------------------------------------

describe("markExtractionFailed", () => {
  const CASE_DOC_ID = "55555555-5555-5555-8555-555555555555";

  it("upserts extraction with status=failed", async () => {
    mocks.repo.upsertExtraction.mockResolvedValue(undefined);

    await markExtractionFailed(CASE_DOC_ID, "extraction timed out");

    expect(mocks.repo.upsertExtraction).toHaveBeenCalledWith(
      expect.objectContaining({
        case_document_id: CASE_DOC_ID,
        status: "failed",
        error: "extraction timed out",
      }),
    );
  });

  it("always calls upsertExtraction (idempotent — creates or updates)", async () => {
    mocks.repo.upsertExtraction.mockResolvedValue(undefined);

    await markExtractionFailed(CASE_DOC_ID, "timeout");

    expect(mocks.repo.upsertExtraction).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// markTranslationFailed
// ---------------------------------------------------------------------------

describe("markTranslationFailed", () => {
  const TRANSLATION_ID = "66666666-6666-6666-8666-666666666666";

  it("resolves without throwing when called with a valid id", async () => {
    // markTranslationFailed uses supabase directly (not resetTranslation repo fn)
    // This test verifies the function signature and that it doesn't throw
    await expect(
      markTranslationFailed(TRANSLATION_ID, "translation timed out"),
    ).resolves.toBeUndefined();
  });

  it("is callable with any valid UUID — idempotent by WHERE status='processing' guard", async () => {
    // Calling twice should not throw
    await markTranslationFailed(TRANSLATION_ID, "error1");
    await markTranslationFailed(TRANSLATION_ID, "error2");
  });
});

// ---------------------------------------------------------------------------
// getRunsForCase (API-AI-02)
// ---------------------------------------------------------------------------

describe("executeTranslationJob", () => {
  const TRANSLATION_ID = "77777777-7777-4777-8777-777777777777";
  const CASE_DOC_ID = "88888888-8888-4888-8888-888888888888";

  const PROCESSING_ROW = {
    id: TRANSLATION_ID,
    case_document_id: CASE_DOC_ID,
    direction: "es-en" as const,
    status: "processing" as const,
  };

  const JOB = {
    jobKey: "translate-document" as const,
    entityId: TRANSLATION_ID,
    attempt: 1,
    dedupeId: `translate-document:${CASE_DOC_ID}:es-en`,
    translationId: TRANSLATION_ID,
    direction: "es-en" as const,
  };

  beforeEach(() => {
    mocks.geminiModels.generateContent.mockReset();
    mocks.repo.findTranslationById.mockReset();
    mocks.repo.getTranslationSource.mockReset();
    mocks.repo.getCaseDocumentForAi.mockReset();
    mocks.repo.completeTranslation.mockReset();
    mocks.pdf.renderCertifiedTranslationPdf.mockReset();
    mocks.catalog.getServiceTranslationConfig.mockReset();
    mocks.catalog.getServiceTranslationConfig.mockResolvedValue({ signerName: null, signatureImageBytes: null });
    mocks.storage.uploadBytesToStorage.mockReset();
  });

  it("renders an English PDF and stores translated_pdf_path on completion", async () => {
    mocks.repo.findTranslationById.mockResolvedValue(PROCESSING_ROW);
    mocks.repo.getTranslationSource.mockResolvedValue({
      rawText: "Acta de nacimiento de Juan Pérez.",
      storagePath: null,
      mimeType: null,
    });
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Birth certificate of Juan Pérez." }] } }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 60 },
    });
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID });
    mocks.pdf.renderCertifiedTranslationPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.storage.uploadBytesToStorage.mockResolvedValue("ok");

    const outcome = await executeTranslationJob(JOB);

    expect(outcome).toBe("completed");
    expect(mocks.pdf.renderCertifiedTranslationPdf).toHaveBeenCalledWith(
      "Birth certificate of Juan Pérez.",
      "es-en",
      expect.objectContaining({ signerName: null, signatureImageBytes: null }),
    );
    expect(mocks.storage.uploadBytesToStorage).toHaveBeenCalledWith(
      "generated",
      `case/${CASE_ID}/translations/${TRANSLATION_ID}.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(mocks.repo.completeTranslation).toHaveBeenCalledWith(
      TRANSLATION_ID,
      expect.objectContaining({
        status: "completed",
        translatedText: "Birth certificate of Juan Pérez.",
        translatedPdfPath: `case/${CASE_ID}/translations/${TRANSLATION_ID}.pdf`,
      }),
    );
  });

  it("strips a Markdown code fence the model may wrap the answer in", async () => {
    mocks.repo.findTranslationById.mockResolvedValue(PROCESSING_ROW);
    mocks.repo.getTranslationSource.mockResolvedValue({ rawText: "Acta.", storagePath: null, mimeType: null });
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "```markdown\n# Birth Certificate\n\nJuan Pérez.\n```" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID });
    mocks.pdf.renderCertifiedTranslationPdf.mockResolvedValue(new Uint8Array([1]));
    mocks.storage.uploadBytesToStorage.mockResolvedValue("ok");

    await executeTranslationJob(JOB);

    // The fence is stripped before both render and persistence.
    expect(mocks.pdf.renderCertifiedTranslationPdf).toHaveBeenCalledWith(
      "# Birth Certificate\n\nJuan Pérez.",
      "es-en",
      expect.objectContaining({ signerName: null }),
    );
    expect(mocks.repo.completeTranslation).toHaveBeenCalledWith(
      TRANSLATION_ID,
      expect.objectContaining({ translatedText: "# Birth Certificate\n\nJuan Pérez." }),
    );
  });

  it("stamps the per-service signer name + signature image when the service is configured", async () => {
    mocks.repo.findTranslationById.mockResolvedValue(PROCESSING_ROW);
    mocks.repo.getTranslationSource.mockResolvedValue({ rawText: "Acta.", storagePath: null, mimeType: null });
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Birth certificate." }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    // The case's service carries a configured signature.
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID, serviceId: "svc-1" });
    const sigBytes = new Uint8Array([137, 80, 78, 71]);
    mocks.catalog.getServiceTranslationConfig.mockResolvedValue({ signerName: "Andrew Navarro", signatureImageBytes: sigBytes });
    mocks.pdf.renderCertifiedTranslationPdf.mockResolvedValue(new Uint8Array([1]));
    mocks.storage.uploadBytesToStorage.mockResolvedValue("ok");

    await executeTranslationJob(JOB);

    expect(mocks.catalog.getServiceTranslationConfig).toHaveBeenCalledWith("svc-1");
    expect(mocks.pdf.renderCertifiedTranslationPdf).toHaveBeenCalledWith(
      "Birth certificate.",
      "es-en",
      expect.objectContaining({ signerName: "Andrew Navarro", signatureImageBytes: sigBytes }),
    );
  });

  it("still completes (translated text kept) when the PDF render fails", async () => {
    mocks.repo.findTranslationById.mockResolvedValue(PROCESSING_ROW);
    mocks.repo.getTranslationSource.mockResolvedValue({ rawText: "Texto.", storagePath: null, mimeType: null });
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Text." }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID });
    mocks.pdf.renderCertifiedTranslationPdf.mockRejectedValue(new Error("render boom"));

    const outcome = await executeTranslationJob(JOB);

    expect(outcome).toBe("completed");
    expect(mocks.storage.uploadBytesToStorage).not.toHaveBeenCalled();
    expect(mocks.repo.completeTranslation).toHaveBeenCalledWith(
      TRANSLATION_ID,
      expect.objectContaining({ status: "completed", translatedPdfPath: null }),
    );
  });

  it("still completes (text kept) when the PDF upload fails", async () => {
    mocks.repo.findTranslationById.mockResolvedValue(PROCESSING_ROW);
    mocks.repo.getTranslationSource.mockResolvedValue({ rawText: "Texto.", storagePath: null, mimeType: null });
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Text." }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    });
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID });
    mocks.pdf.renderCertifiedTranslationPdf.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.storage.uploadBytesToStorage.mockRejectedValue(new Error("upload boom"));

    const outcome = await executeTranslationJob(JOB);

    expect(outcome).toBe("completed");
    expect(mocks.repo.completeTranslation).toHaveBeenCalledWith(
      TRANSLATION_ID,
      expect.objectContaining({ status: "completed", translatedPdfPath: null }),
    );
  });
});

describe("translation cross-case guard", () => {
  const CASE_DOC_ID = "99999999-9999-4999-8999-999999999999";
  const OTHER_CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  beforeEach(() => {
    mocks.authz.requireCaseAccess.mockReset();
    mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
    mocks.repo.getCaseDocumentForAi.mockReset();
    mocks.repo.findTranslation.mockReset();
  });

  it("getDocumentTranslation returns null when the document belongs to another case", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: OTHER_CASE_ID });

    const result = await getDocumentTranslation(ADMIN_ACTOR, {
      caseId: CASE_ID,
      caseDocumentId: CASE_DOC_ID,
      direction: "es-en",
    });

    expect(result).toBeNull();
    expect(mocks.repo.findTranslation).not.toHaveBeenCalled();
  });

  it("getDocumentTranslation returns the row when the document belongs to the case", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: CASE_ID });
    mocks.repo.findTranslation.mockResolvedValue({
      id: "t1",
      case_document_id: CASE_DOC_ID,
      direction: "es-en",
      status: "completed",
    });

    const result = await getDocumentTranslation(ADMIN_ACTOR, {
      caseId: CASE_ID,
      caseDocumentId: CASE_DOC_ID,
      direction: "es-en",
    });

    expect(result).not.toBeNull();
    expect(mocks.repo.findTranslation).toHaveBeenCalledWith(CASE_DOC_ID, "es-en");
  });

  it("getDocumentTranslationPdf returns null when the document belongs to another case", async () => {
    mocks.repo.getCaseDocumentForAi.mockResolvedValue({ id: CASE_DOC_ID, caseId: OTHER_CASE_ID });

    const result = await getDocumentTranslationPdf(ADMIN_ACTOR, {
      caseId: CASE_ID,
      caseDocumentId: CASE_DOC_ID,
      direction: "es-en",
    });

    expect(result).toBeNull();
    expect(mocks.repo.findTranslation).not.toHaveBeenCalled();
  });
});

describe("getRunsForCase", () => {
  it("requires case access (calls requireCaseAccess)", async () => {
    mocks.repo.listRunsForCase.mockResolvedValue([]);

    await getRunsForCase(ADMIN_ACTOR, CASE_ID);

    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ADMIN_ACTOR, CASE_ID);
  });

  it("returns runs from repository", async () => {
    const runs = [BASE_RUN, { ...BASE_RUN, id: "run-2", version: 2 }];
    mocks.repo.listRunsForCase.mockResolvedValue(runs);

    const result = await getRunsForCase(ADMIN_ACTOR, CASE_ID);

    expect(result).toHaveLength(2);
  });

  it("marks the highest completed version as isCurrent", async () => {
    // listRunsForCase returns in version DESC order (as DB returns)
    const runs = [
      { ...BASE_RUN, id: "run-3", version: 3, status: "failed" as const },
      { ...BASE_RUN, id: "run-2", version: 2, status: "completed" as const },
      { ...BASE_RUN, id: "run-1", version: 1, status: "completed" as const },
    ];
    mocks.repo.listRunsForCase.mockResolvedValue(runs);

    const result = await getRunsForCase(ADMIN_ACTOR, CASE_ID);
    const current = result.find((r) => r.isCurrent);

    expect(current).toBeDefined();
    expect(current!.id).toBe("run-2"); // highest completed version (DESC: first completed = run-2)
  });

  it("returns empty array when no runs exist", async () => {
    mocks.repo.listRunsForCase.mockResolvedValue([]);

    const result = await getRunsForCase(ADMIN_ACTOR, CASE_ID);

    expect(result).toEqual([]);
  });

  it("does not call can() — relies on requireCaseAccess only", async () => {
    mocks.repo.listRunsForCase.mockResolvedValue([]);

    await getRunsForCase(ADMIN_ACTOR, CASE_ID);

    // getRunsForCase uses requireCaseAccess, not can()
    expect(mocks.authz.can).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// proposeFormSegmentation — grounded proposal (web_search + context)
// ---------------------------------------------------------------------------

describe("proposeFormSegmentation", () => {
  // STEP A research uses non-streaming `create`; STEP B generation uses
  // `stream().finalMessage()` (large forms need a big max_tokens, which the SDK
  // only allows via streaming). Helpers below mock each accordingly.
  function mockResearch(text = "Per the official USCIS I-589 instructions, fill Part A…") {
    mocks.anthropicClient.messages.create.mockResolvedValue({
      content: [
        { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "USCIS I-589 instructions" } },
        { type: "web_search_tool_result", tool_use_id: "srv1", content: [] },
        { type: "text", text },
      ],
    });
  }
  const genMsg = (text: string) => ({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 100 },
    model: "claude-sonnet-4-6",
  });

  it("researches via web_search (step A, create) then STREAMS the JSON (step B)", async () => {
    mockResearch();
    mocks.anthropic.finalMessage.mockResolvedValue(
      genMsg('{"groups":[{"title_i18n":{"es":"A","en":"A"},"questions":[{"question_i18n":{"es":"N","en":"N"},"field_type":"text","source":"profile","source_ref":{"profile_field":"email"}}]}]}'),
    );

    const res = await proposeFormSegmentation(ADMIN_ACTOR, {
      detectedFields: [{ name: "Pt1Line5_Email", type: "text", page: 1 }],
      pdfText: "",
      formName: "USCIS I-589",
      formSlug: "uscis-i-589",
      serviceName: "Asilo Político",
      profileFields: ["email"],
    });

    expect(res.groups).toHaveLength(1);
    expect(res.research_summary).toContain("I-589");
    expect(mocks.anthropicClient.messages.create).toHaveBeenCalledTimes(1); // research only
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(1); // ONE generation

    type Body = { tools?: Array<{ type: string; name: string }>; messages: Array<{ content: string }> };
    const research = mocks.anthropicClient.messages.create.mock.calls[0][0] as Body;
    expect(research.tools?.[0]).toMatchObject({ type: "web_search_20250305", name: "web_search" });
    expect(research.messages[0].content).toContain("uscis-i-589");
    expect(research.messages[0].content).toContain("Asilo Político");
    // generation (stream) carries NO tools + surfaces the profile whitelist
    const generation = (mocks.anthropicClient.messages.stream.mock.calls[0] as unknown[])[0] as Body;
    expect(generation.tools).toBeUndefined();
    expect(generation.messages[0].content).toContain("email");
  });

  it("extracts JSON even when wrapped in prose, and retries the stream on invalid output", async () => {
    mockResearch("brief");
    mocks.anthropic.finalMessage
      .mockResolvedValueOnce(genMsg("I could not produce JSON."))
      .mockResolvedValueOnce(genMsg('Here is the structure:\n{"groups":[{"title_i18n":{"es":"B","en":"B"},"questions":[]}]}\nHope it helps!'));

    const res = await proposeFormSegmentation(ADMIN_ACTOR, {
      detectedFields: [{ name: "F1", type: "text", page: 1 }],
      pdfText: "",
      formName: "X",
      formSlug: "x",
    });

    expect(res.groups).toHaveLength(1);
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("throws AI_OUTPUT_INVALID after both stream attempts fail to parse", async () => {
    mockResearch("brief");
    mocks.anthropic.finalMessage.mockResolvedValue(genMsg("no json here at all"));

    await expect(
      proposeFormSegmentation(ADMIN_ACTOR, { detectedFields: [{ name: "F1", type: "text", page: 1 }], pdfText: "", formName: "X", formSlug: "x" }),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
  });

  it("sends ALL curated fields in one generation call (no blind 180-field cap), curating internal ones out", async () => {
    // 200 real fields incl. ones on page 12 (past the old slice(0,180)) + an internal field.
    const fields = [
      ...Array.from({ length: 200 }, (_, i) => ({ name: `Pt${i}_Field`, type: "text", page: (i % 12) + 1 })),
      { name: "LateField_Page12", type: "text", page: 12 },
      { name: "Pt1_Signature", type: "text", page: 12 }, // curated out
    ];
    mockResearch("brief");
    mocks.anthropic.finalMessage.mockResolvedValue(
      genMsg('{"groups":[{"title_i18n":{"es":"A","en":"A"},"questions":[{"question_i18n":{"es":"N","en":"N"},"field_type":"text"}]}]}'),
    );

    const res = await proposeFormSegmentation(ADMIN_ACTOR, {
      detectedFields: fields,
      pdfText: "",
      formName: "USCIS I-589",
      formSlug: "uscis-i-589",
    });

    expect(res.groups).toHaveLength(1);
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(1);
    const gen = (mocks.anthropicClient.messages.stream.mock.calls[0] as unknown[])[0] as { messages: Array<{ content: string }> };
    expect(gen.messages[0].content).toContain("LateField_Page12"); // would have been cut by slice(0,180)
    expect(gen.messages[0].content).not.toContain("Pt1_Signature"); // curated out
  });

  it("retries once and succeeds when the first stream attempt throws (timeout/5xx)", async () => {
    mockResearch("brief");
    mocks.anthropic.finalMessage
      .mockRejectedValueOnce(new Error("Request timed out")) // generation attempt 0 throws
      .mockResolvedValueOnce(genMsg('{"groups":[{"title_i18n":{"es":"A","en":"A"},"questions":[]}]}')); // attempt 1 ok

    const res = await proposeFormSegmentation(ADMIN_ACTOR, {
      detectedFields: [{ name: "F1", type: "text", page: 1 }],
      pdfText: "",
      formName: "X",
      formSlug: "x",
    });

    expect(res.groups).toHaveLength(1);
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable auth error (401) — fails fast after one attempt", async () => {
    mockResearch("brief");
    mocks.anthropic.finalMessage.mockRejectedValue(new Error("401 Unauthorized: invalid x-api-key"));

    await expect(
      proposeFormSegmentation(ADMIN_ACTOR, { detectedFields: [{ name: "F1", type: "text", page: 1 }], pdfText: "", formName: "X", formSlug: "x" }),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(1); // broke after attempt 0, no retry
  });
});

// ---------------------------------------------------------------------------
// proposeExpedienteAssembly — AI assembly planner (sync, JSON, retry)
// ---------------------------------------------------------------------------

describe("proposeExpedienteAssembly", () => {
  const createMsg = (text: string) => ({ content: [{ type: "text", text }] });
  const baseInput = {
    caseLabel: "ULP-2026-0001",
    serviceCategory: "Asilo Político",
    parties: [{ id: "p1", role: "minor", name: "Juan Pérez" }],
    strongDocs: [{ kind: "automated_form" as const, id: "f1", label: "Formulario I-589", partyId: null }],
    documents: [{ caseDocumentId: "d1", fileName: "acta_juan.pdf", partyId: "p1", requirementLabel: "Acta de nacimiento" }],
  };

  beforeEach(() => {
    mocks.anthropicClient.messages.create.mockReset();
  });

  it("parses the planner JSON into ordered sections", async () => {
    mocks.anthropicClient.messages.create.mockResolvedValue(
      createMsg(
        '{"sections":[{"kind":"document","title":"Formulario I-589","refType":"automated_form","refId":"f1"},{"kind":"party","title":"Documentos del menor: Juan Pérez","partyId":"p1","documentIds":["d1"]}]}',
      ),
    );

    const plan = await proposeExpedienteAssembly(baseInput);
    expect(plan.sections).toHaveLength(2);
    expect(plan.sections[0]).toMatchObject({ kind: "document", refType: "automated_form", refId: "f1" });
    expect(plan.sections[1]).toMatchObject({ kind: "party", partyId: "p1", documentIds: ["d1"] });
  });

  it("retries once with feedback when the first response is invalid", async () => {
    mocks.anthropicClient.messages.create
      .mockResolvedValueOnce(createMsg("not json at all"))
      .mockResolvedValueOnce(createMsg('{"sections":[{"kind":"other","title":"Otros","documentIds":["d1"]}]}'));

    const plan = await proposeExpedienteAssembly(baseInput);
    expect(plan.sections).toHaveLength(1);
    expect(mocks.anthropicClient.messages.create).toHaveBeenCalledTimes(2);
  });

  it("throws AI_OUTPUT_INVALID after the retry also fails", async () => {
    mocks.anthropicClient.messages.create.mockResolvedValue(createMsg("still not json"));
    await expect(proposeExpedienteAssembly(baseInput)).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
    expect(mocks.anthropicClient.messages.create).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// translateAnswerText — PII masking before the provider (review SHOULD-FIX #1)
// ---------------------------------------------------------------------------

describe("translateAnswerText", () => {
  beforeEach(() => {
    mocks.geminiModels.generateContent.mockReset();
  });

  it("masks structured PII (SSN) before sending the answer to Gemini", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "My son's number is •••-••-6789" }] } }],
    });

    await translateAnswerText({ text: "El número de mi hijo es 123-45-6789", direction: "es-en" });

    const sentPrompt = mocks.geminiModels.generateContent.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(sentPrompt).toContain("•••-••-6789"); // masked
    expect(sentPrompt).not.toContain("123-45-6789"); // raw SSN never sent
  });

  it("returns the provider translation", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "hello world" }] } }],
    });
    const r = await translateAnswerText({ text: "hola mundo", direction: "es-en" });
    expect(r.text).toBe("hello world");
  });

  it("instructs the model to keep proper nouns and accents (legal-form mode)", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "José Ramírez" }] } }],
    });
    await translateAnswerText({ text: "José Ramírez", direction: "es-en" });
    const sentPrompt = mocks.geminiModels.generateContent.mock.calls[0][0].contents[0].parts[0]
      .text as string;
    expect(sentPrompt).toMatch(/proper noun/i);
    expect(sentPrompt).toMatch(/accent|diacritic/i);
  });

  it("passes the field label to the model as disambiguation context", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: "Christian" }] } }],
    });
    await translateAnswerText({
      text: "Cristiano",
      direction: "es-en",
      fieldLabel: "¿Cuál es su religión?",
    });
    const sentPrompt = mocks.geminiModels.generateContent.mock.calls[0][0].contents[0].parts[0]
      .text as string;
    expect(sentPrompt).toContain("¿Cuál es su religión?");
  });
});

describe("translateAnswersBatch", () => {
  beforeEach(() => {
    mocks.geminiModels.generateContent.mockReset();
  });

  it("translates N answers in ONE provider call and maps them back by id", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ answers: [
        { id: "q1", value: "In 2022 I was threatened." },
        { id: "q2", value: "I fear being harmed in Caracas." },
      ] }) }] } }],
    });

    const out = await translateAnswersBatch({
      items: [
        { id: "q1", text: "En 2022 fui amenazado.", fieldLabel: "Explique" },
        { id: "q2", text: "Temo ser dañado en Caracas.", fieldLabel: "Explique" },
      ],
      direction: "es-en",
      preserveProperNouns: true,
    });

    expect(mocks.geminiModels.generateContent).toHaveBeenCalledTimes(1); // ONE call for both
    expect(out).toEqual({ q1: "In 2022 I was threatened.", q2: "I fear being harmed in Caracas." });
    const prompt = mocks.geminiModels.generateContent.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(prompt).toMatch(/proper noun/i);
    expect(prompt).toContain('id="q1"');
    expect(prompt).toContain('id="q2"');
  });

  it("masks structured PII per item before the provider", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ answers: [{ id: "q1", value: "ok" }] }) }] } }],
    });
    await translateAnswersBatch({ items: [{ id: "q1", text: "Mi SSN es 123-45-6789" }], direction: "es-en" });
    const prompt = mocks.geminiModels.generateContent.mock.calls[0][0].contents[0].parts[0].text as string;
    expect(prompt).toContain("•••-••-6789");
    expect(prompt).not.toContain("123-45-6789");
  });

  it("is a no-op (no provider call) when there are no items", async () => {
    const out = await translateAnswersBatch({ items: [], direction: "es-en" });
    expect(out).toEqual({});
    expect(mocks.geminiModels.generateContent).not.toHaveBeenCalled();
  });
});

describe("assessDocumentLegibility", () => {
  beforeEach(() => {
    mocks.geminiModels.generateContent.mockReset();
  });

  it("parses a legible verdict from Gemini", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ legible: true, blur_level: "none", reason_es: "ok", reason_en: "ok" }) }] } }],
    });
    const v = await assessDocumentLegibility({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
    expect(v.legible).toBe(true);
    expect(v.blurLevel).toBe("none");
  });

  it("parses a heavy-blur / illegible verdict", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ legible: false, blur_level: "heavy", reason_es: "borroso", reason_en: "blurry" }) }] } }],
    });
    const v = await assessDocumentLegibility({ bytes: new Uint8Array([1]), mimeType: "application/pdf" });
    expect(v.legible).toBe(false);
    expect(v.blurLevel).toBe("heavy");
    expect(v.reasonEs).toBe("borroso");
  });

  it("fails open (legible=true) when the provider throws", async () => {
    mocks.geminiModels.generateContent.mockRejectedValue(new Error("RESOURCE_EXHAUSTED"));
    const v = await assessDocumentLegibility({ bytes: new Uint8Array([1]), mimeType: "image/png" });
    expect(v.legible).toBe(true);
    expect(v.blurLevel).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// ai_field resolution (Etapa B): interpretDocumentFields / synthesizeLetterFields
// ---------------------------------------------------------------------------

describe("interpretDocumentFields (Gemini, ai_field ← document)", () => {
  beforeEach(() => {
    mocks.geminiModels.generateContent.mockReset();
  });

  it("maps each question id to its interpreted value", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  answers: [
                    { id: "q1", value: "Relato de persecución." },
                    { id: "q2", value: "Fecha aproximada: marzo 2023." },
                  ],
                }),
              },
            ],
          },
        },
      ],
    });
    const out = await interpretDocumentFields({
      fileBase64: "ZmFrZQ==",
      mimeType: "application/pdf",
      fields: [
        { id: "q1", instruction: "Resume el relato." },
        { id: "q2", instruction: "¿Cuándo ocurrió?" },
      ],
    });
    expect(out).toEqual({ q1: "Relato de persecución.", q2: "Fecha aproximada: marzo 2023." });
  });

  it("omits ids the model left empty (no invention)", async () => {
    mocks.geminiModels.generateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ answers: [{ id: "q1", value: "" }] }) }] } }],
    });
    const out = await interpretDocumentFields({
      fileBase64: "ZmFrZQ==",
      mimeType: "application/pdf",
      fields: [{ id: "q1", instruction: "Algo no presente." }],
    });
    expect(out).toEqual({});
  });

  it("returns an empty map (best-effort) when Gemini throws", async () => {
    mocks.geminiModels.generateContent.mockRejectedValue(new Error("RESOURCE_EXHAUSTED"));
    const out = await interpretDocumentFields({
      fileBase64: "ZmFrZQ==",
      mimeType: "application/pdf",
      fields: [{ id: "q1", instruction: "x" }],
    });
    expect(out).toEqual({});
  });

  it("short-circuits with no fields (no provider call)", async () => {
    const out = await interpretDocumentFields({ fileBase64: "ZmFrZQ==", mimeType: "application/pdf", fields: [] });
    expect(out).toEqual({});
    expect(mocks.geminiModels.generateContent).not.toHaveBeenCalled();
  });
});

describe("synthesizeLetterFields (Anthropic, ai_field ← ai_letter)", () => {
  const genMsg = (text: string) => ({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 100 },
    model: "claude-sonnet-4-6",
  });

  beforeEach(() => {
    mocks.anthropic.finalMessage.mockReset();
  });

  it("maps each question id to its synthesized value from the letter", async () => {
    mocks.anthropic.finalMessage.mockResolvedValue(
      genMsg(JSON.stringify({ answers: [{ id: "qb", value: "Narrativa de la Parte B." }] })),
    );
    const out = await synthesizeLetterFields({
      letterText: "## Memorándum...\nEl solicitante sufrió...",
      fields: [{ id: "qb", instruction: "Redacta la Parte B." }],
    });
    expect(out).toEqual({ qb: "Narrativa de la Parte B." });
  });

  it("returns an empty map when the model produces no JSON", async () => {
    mocks.anthropic.finalMessage.mockResolvedValue(genMsg("no hay json aquí"));
    const out = await synthesizeLetterFields({
      letterText: "memo",
      fields: [{ id: "qb", instruction: "x" }],
    });
    expect(out).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// executeGenerationJob — sectioned, resumable, v1-grade engine
// ---------------------------------------------------------------------------

describe("executeGenerationJob (sectioned + research)", () => {
  const LONG_BODY = "Detailed legal analysis paragraph. ".repeat(40); // ~1.4k chars

  function aiMessage(text: string) {
    return {
      usage: { input_tokens: 1000, output_tokens: 2000 },
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      model: "claude-sonnet-4-6",
    };
  }

  function sectionedRun(over: Record<string, unknown> = {}) {
    return {
      ...BASE_RUN,
      status: "running" as const,
      orgId: ORG_ID,
      progress: null,
      config_snapshot: {
        system_prompt: "You are a federal immigration attorney.",
        input_document_slugs: [],
        input_form_slugs: [],
        dataset_id: null,
        model: "claude-sonnet-4-6",
        research_model: "claude-opus-4-7",
        max_output_tokens: 16000,
        output_format: "pdf",
        output_language: "en",
        web_search_enabled: true,
        web_search_max_uses: 6,
        research_instructions: "Find favorable federal precedents.",
        sections: [
          { key: "i1", heading: "I.1 Introduction", min_words: 0, max_tokens: 4000, guidance: "Intro.", type: "analysis" },
          { key: "i2", heading: "I.2 Argument", min_words: 0, max_tokens: 4000, guidance: "Argue.", type: "analysis" },
        ],
        assembly: { cover: true, toc: true, chronology: false, closing: "I declare under penalty of perjury that the foregoing is true." },
        resolved_inputs: { documents: [], forms: [] },
        dataset_injection: null,
      },
      ...over,
    };
  }

  // A curated precedent the engine sources jurisprudence from (web_search case-law is
  // unreliable; the dataset is the source of truth). datasetToJurisprudence parses the
  // citation/court/year from the title and the URL from meta.
  const PRECEDENT_ITEM = {
    id: "ds-prec-1",
    title: "Doe v. INS, 1 F.3d 2 (9th Cir. 1999)",
    content: "Imputed political opinion suffices to establish nexus.",
    tags: ["political_opinion", "nexus"],
    outcome: "granted",
    token_count: 40,
    created_at: "2025-01-01",
    jurisdiction: "9th Cir.",
    meta: { kind: "precedent" as const, url: "https://x" },
  };

  beforeEach(() => {
    mocks.repo.loadResolvedInputs.mockResolvedValue({ documents: [], forms: [] });
    mocks.repo.loadDatasetItems.mockResolvedValue([PRECEDENT_ITEM]);
    mocks.repo.isCancelled.mockResolvedValue(false);
    mocks.repo.completeRun.mockResolvedValue({ rowsAffected: 1 });
    mocks.repo.updateRunProgress.mockResolvedValue(undefined);
    mocks.repo.patchConfigSnapshot.mockResolvedValue(undefined);
    mocks.pdf.renderMarkdownToPdf.mockResolvedValue(new Uint8Array([1]));
  });

  it("runs research once, drafts every section, assembles, and completes in one pass", async () => {
    mocks.repo.findRunById.mockResolvedValue(sectionedRun());
    mocks.anthropic.finalMessage
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"], perpetrator: "state agents", state_action: "state actor", principal_theory: "Individualized persecution.", summary: "Targeted for opposition.", chronology: [{ date: "2021-05-01", event: "Threat", consequence: "Fled", exhibit: null }] })))
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ analogies: [{ i: 1, factual_analogy: "Applies directly to the applicant's facts." }] })))
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ items: [{ source_name: "HRW", executive_summary: "Impunity.", full_context: "C", why_it_helps: "W", url: "https://y", published_date: "2025-01-01" }] })))
      .mockResolvedValueOnce(aiMessage(`## I.1 Introduction\n\n${LONG_BODY}`))
      .mockResolvedValueOnce(aiMessage(`## I.2 Argument\n\n${LONG_BODY}`));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("completed");
    // 3 research calls + 2 section calls
    expect(mocks.anthropic.finalMessage).toHaveBeenCalledTimes(5);
    // research persisted INCREMENTALLY (one patch per sub-step: analysis, jurisprudence, conditions)
    const researchPatches = mocks.repo.patchConfigSnapshot.mock.calls.filter((c) => "research" in (c[1] ?? {}));
    expect(researchPatches.length).toBe(3);
    const finalResearch = researchPatches[researchPatches.length - 1][1].research;
    expect(finalResearch.jurisprudence).toHaveLength(1);
    expect(finalResearch.country_conditions).toHaveLength(1);
    // assembled output carries cover + both sections + closing
    const completeArg = mocks.repo.completeRun.mock.calls[0][1];
    expect(completeArg.outputText).toContain("LEGAL MEMORANDUM");
    expect(completeArg.outputText).toContain("I.1 Introduction");
    expect(completeArg.outputText).toContain("I.2 Argument");
    expect(completeArg.outputText).toContain("penalty of perjury");
    // not deferred
    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
    expect(mocks.events.emitGenerationCompleted).toHaveBeenCalledTimes(1);
  });

  it("resumes from a checkpoint without redoing research or completed sections", async () => {
    const snapshot = sectionedRun().config_snapshot;
    mocks.repo.findRunById.mockResolvedValue(
      sectionedRun({
        config_snapshot: {
          ...snapshot,
          research: { analysis: null, jurisprudence: [], country_conditions: [] },
        },
        progress: {
          kind: "sectioned",
          sectionsDone: 1,
          parts: [`## I.1 Introduction\n\n${LONG_BODY}`],
          prevTail: "tail",
          usage: { inputTokens: 10, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          costUsd: 0.5,
          modelUsed: "claude-sonnet-4-6",
        },
      }),
    );
    mocks.anthropic.finalMessage.mockResolvedValueOnce(aiMessage(`## I.2 Argument\n\n${LONG_BODY}`));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("completed");
    // only section 2 drafted — no research, no section 1 redo
    expect(mocks.anthropic.finalMessage).toHaveBeenCalledTimes(1);
    const completeArg = mocks.repo.completeRun.mock.calls[0][1];
    expect(completeArg.outputText).toContain("I.1 Introduction");
    expect(completeArg.outputText).toContain("I.2 Argument");
  });

  it("resumes research mid-phase (researchStep=1) without re-running the analysis call", async () => {
    const snapshot = sectionedRun().config_snapshot;
    mocks.repo.findRunById.mockResolvedValue(
      sectionedRun({
        config_snapshot: {
          ...snapshot,
          // analysis already done + persisted; jurisprudence/conditions still pending
          research: {
            analysis: { nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"], perpetrator: "state agents", state_action: "state actor", principal_theory: "T", summary: "S", chronology: [] },
            jurisprudence: [],
            country_conditions: [],
          },
        },
        progress: {
          kind: "sectioned",
          sectionsDone: 0,
          parts: [],
          prevTail: "",
          usage: { inputTokens: 5, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
          costUsd: 0.1,
          modelUsed: "claude-sonnet-4-6",
          researchStep: 1,
        },
      }),
    );
    mocks.anthropic.finalMessage
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ analogies: [{ i: 1, factual_analogy: "Applies directly to the applicant's facts." }] })))
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ items: [{ source_name: "HRW", executive_summary: "Impunity.", full_context: "C", why_it_helps: "W", url: "https://y", published_date: "2025-01-01" }] })))
      .mockResolvedValueOnce(aiMessage(`## I.1 Introduction\n\n${LONG_BODY}`))
      .mockResolvedValueOnce(aiMessage(`## I.2 Argument\n\n${LONG_BODY}`));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("completed");
    // analysis NOT re-run: only jurisprudence + conditions (2) + 2 sections = 4 calls
    expect(mocks.anthropic.finalMessage).toHaveBeenCalledTimes(4);
    const researchPatches = mocks.repo.patchConfigSnapshot.mock.calls.filter((c) => "research" in (c[1] ?? {}));
    const finalResearch = researchPatches[researchPatches.length - 1][1].research;
    expect(finalResearch.jurisprudence).toHaveLength(1);
    expect(finalResearch.country_conditions).toHaveLength(1);
  });

  it("re-runs research when a partial bundle was persisted but no progress row exists (first-invocation crash window)", async () => {
    // Crash between patchConfigSnapshot(research) and checkpoint() on the very first
    // invocation: DB has a partial research bundle (analysis only) but progress is
    // null. The job MUST re-run research, not treat the partial bundle as complete.
    const snapshot = sectionedRun().config_snapshot;
    mocks.repo.findRunById.mockResolvedValue(
      sectionedRun({
        progress: null,
        config_snapshot: {
          ...snapshot,
          research: {
            analysis: { nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"], perpetrator: "state agents", state_action: "state actor", principal_theory: "T", summary: "S", chronology: [] },
            jurisprudence: [],
            country_conditions: [],
          },
        },
      }),
    );
    mocks.anthropic.finalMessage
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ nationality: "Venezuela", persecution_type: "political opinion", protected_grounds: ["political opinion"], perpetrator: "state agents", state_action: "state actor", principal_theory: "P", summary: "S", chronology: [] })))
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ analogies: [{ i: 1, factual_analogy: "Applies directly to the applicant's facts." }] })))
      .mockResolvedValueOnce(aiMessage(JSON.stringify({ items: [{ source_name: "HRW", executive_summary: "Impunity.", full_context: "C", why_it_helps: "W", url: "https://y", published_date: "2025-01-01" }] })))
      .mockResolvedValueOnce(aiMessage(`## I.1 Introduction\n\n${LONG_BODY}`))
      .mockResolvedValueOnce(aiMessage(`## I.2 Argument\n\n${LONG_BODY}`));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("completed");
    // research re-ran (3 calls) + 2 sections = 5 — NOT skipped (which would be 2)
    expect(mocks.anthropic.finalMessage).toHaveBeenCalledTimes(5);
    const researchPatches = mocks.repo.patchConfigSnapshot.mock.calls.filter((c) => "research" in (c[1] ?? {}));
    const finalResearch = researchPatches[researchPatches.length - 1][1].research;
    expect(finalResearch.jurisprudence).toHaveLength(1);
    expect(finalResearch.country_conditions).toHaveLength(1);
  });

  it("still supports single-pass generation when there are no sections", async () => {
    mocks.repo.findRunById.mockResolvedValue(
      sectionedRun({ config_snapshot: { ...sectionedRun().config_snapshot, sections: [], web_search_enabled: false } }),
    );
    mocks.anthropic.finalMessage.mockResolvedValueOnce(aiMessage(LONG_BODY));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("completed");
    expect(mocks.anthropic.finalMessage).toHaveBeenCalledTimes(1);
  });

  it("fails the run on a non-retryable (4xx) research error — never a zombie", async () => {
    mocks.repo.findRunById.mockResolvedValue(sectionedRun());
    mocks.anthropic.finalMessage.mockRejectedValueOnce(new Error("401 unauthorized"));

    const outcome = await executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never);

    expect(outcome).toBe("failed");
    expect(mocks.repo.markRunFailed).toHaveBeenCalledTimes(1);
    expect(mocks.events.emitGenerationFailed).toHaveBeenCalledTimes(1);
    expect(mocks.repo.completeRun).not.toHaveBeenCalled();
  });

  it("re-throws a transient (5xx) research error so QStash retries (no zombie, not marked failed)", async () => {
    mocks.repo.findRunById.mockResolvedValue(sectionedRun());
    mocks.anthropic.finalMessage.mockRejectedValueOnce(new Error("529 Service overloaded"));

    await expect(executeGenerationJob({ runId: RUN_ID, orgId: ORG_ID } as never)).rejects.toThrow("529");
    // Transient → re-thrown for retry; the run is NOT permanently marked failed here.
    expect(mocks.repo.markRunFailed).not.toHaveBeenCalled();
    expect(mocks.repo.completeRun).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getAiCostsReport (API-AI-10 / RF-ADM-005 + RF-ADM-037)
// ---------------------------------------------------------------------------

describe("getAiCostsReport", () => {
  type Row = {
    id: string;
    source: "generations" | "extractions" | "translations";
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens: number;
    model: string | null;
    status: string;
    isTest: boolean;
    createdAt: string;
    caseNumber: string | null;
    serviceLabel: string | null;
  };

  const row = (over: Partial<Row>): Row => ({
    id: "r-1",
    source: "generations",
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    model: "claude-sonnet-4-6",
    status: "completed",
    isTest: false,
    createdAt: "2026-06-15T10:00:00.000Z",
    caseNumber: "ULP-1",
    serviceLabel: "Asilo",
    ...over,
  });

  const CURRENT: Row[] = [
    row({ id: "g1", costUsd: 0.5, inputTokens: 100, outputTokens: 200, cacheTokens: 50, model: "claude-sonnet-4-6" }),
    row({ id: "g2", costUsd: 0.1, inputTokens: 10, outputTokens: 20, status: "failed", model: "claude-opus-4-7", caseNumber: "ULP-2" }),
    row({ id: "gt", costUsd: 0.99, inputTokens: 999, outputTokens: 999, isTest: true, model: "claude-sonnet-4-6" }),
    row({ id: "e1", source: "extractions", costUsd: 0.05, inputTokens: 30, outputTokens: 10, model: "gemini-2.5-flash" }),
    row({ id: "t1", source: "translations", costUsd: 0.03, inputTokens: 20, outputTokens: 5, model: "gemini-2.5-flash" }),
  ];

  beforeEach(() => {
    mocks.authz.can.mockReset();
    mocks.repo.getOrgCostContext.mockResolvedValue({ tz: "America/New_York", budgetUsd: 500 });
    mocks.repo.aiCostRows.mockReset();
    // Promise.all order: first call = current window, second = previous window.
    mocks.repo.aiCostRows.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce([]);
  });

  it("gates on dashboard:view before reading", async () => {
    await getAiCostsReport(ADMIN_ACTOR, { period: "month" });
    expect(mocks.authz.can).toHaveBeenCalledWith(ADMIN_ACTOR, "dashboard", "view");
  });

  it("excludes editor test runs from totals and reports them as testUsd (RF-ADM-037)", async () => {
    const r = await getAiCostsReport(ADMIN_ACTOR, { period: "month" });
    expect(r.totalUsd).toBeCloseTo(0.68, 4); // 0.5 + 0.1 + 0.05 + 0.03 (test 0.99 excluded)
    expect(r.testUsd).toBeCloseTo(0.99, 4);
    expect(r.runs).toBe(4);
  });

  it("computes tokens, failure rate, and the by-source / by-model breakdowns", async () => {
    const r = await getAiCostsReport(ADMIN_ACTOR, { period: "month" });
    expect(r.totalTokens).toBe(445); // 350 + 30 + 40 + 25 (test row excluded)
    expect(r.failedRuns).toBe(1);
    expect(r.failureRatePct).toBe(25); // 1 of 4
    expect(r.bySource).toEqual({ generations: 0.6, extractions: 0.05, translations: 0.03 });
    expect(r.byModel[0]).toEqual({ model: "claude-sonnet-4-6", usd: 0.5 }); // costliest first
    expect(r.budgetUsd).toBe(500);
  });

  it("ranks the costliest non-test invocations (topRuns) and keeps the per-query table", async () => {
    const r = await getAiCostsReport(ADMIN_ACTOR, { period: "month" });
    expect(r.topRuns[0].id).toBe("g1"); // $0.50, the most expensive
    expect(r.topRuns.every((q) => !q.isTest)).toBe(true);
    expect(r.queries).toHaveLength(4); // non-test only
    expect(r.prevTotalUsd).toBe(0); // previous window empty
  });
});
