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
    countRunningByOrg: vi.fn(),
    listRunsForCase: vi.fn(),
    sumMonthlyCosts: vi.fn(),
    sumCosts: vi.fn(),
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
  };

  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };

  return {
    repo,
    authz,
    qstash,
    anthropicClient,
    getAnthropicClient,
    geminiModels,
    getGeminiModels,
    storage,
    logger,
    audit,
    pdf,
    events,
  };
});

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

vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: mocks.storage.createSignedDownloadUrl,
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
  cancelGeneration,
  markRunFailedByCallback,
  markExtractionFailed,
  markTranslationFailed,
  getRunsForCase,
  proposeFormSegmentation,
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
  function mockCreateText(text: string) {
    mocks.anthropicClient.messages.create.mockResolvedValue({
      content: [
        { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "USCIS I-589 instructions" } },
        { type: "web_search_tool_result", tool_use_id: "srv1", content: [] },
        { type: "text", text },
      ],
    });
  }

  it("researches via web_search (step A) then generates JSON tool-free (step B)", async () => {
    mockCreateText(
      '```json\n{"research_summary":"Per the official USCIS I-589 instructions","groups":[{"title_i18n":{"es":"A","en":"A"},"questions":[{"question_i18n":{"es":"N","en":"N"},"field_type":"text","source":"profile","source_ref":{"profile_field":"email"}}]}]}\n```',
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
    expect(mocks.anthropicClient.messages.create).toHaveBeenCalledTimes(2);

    type Body = { tools?: Array<{ type: string; name: string }>; messages: Array<{ content: string }> };
    // calls[0] = research (web_search tool + form/service context)
    const research = mocks.anthropicClient.messages.create.mock.calls[0][0] as Body;
    expect(research.tools?.[0]).toMatchObject({ type: "web_search_20250305", name: "web_search" });
    expect(research.messages[0].content).toContain("uscis-i-589");
    expect(research.messages[0].content).toContain("Asilo Político");
    // calls[1] = generation (NO tools, full budget; whitelist surfaced here)
    const generation = mocks.anthropicClient.messages.create.mock.calls[1][0] as Body;
    expect(generation.tools).toBeUndefined();
    expect(generation.messages[0].content).toContain("email");
  });

  it("extracts JSON even when wrapped in prose, and retries on invalid output", async () => {
    mocks.anthropicClient.messages.create
      .mockResolvedValueOnce({ content: [{ type: "text", text: "I could not find anything useful." }] })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: 'Here is the structure:\n{"groups":[{"title_i18n":{"es":"B","en":"B"},"questions":[]}]}\nHope it helps!' }],
      });

    const res = await proposeFormSegmentation(ADMIN_ACTOR, {
      detectedFields: [{ name: "F1", type: "text", page: 1 }],
      pdfText: "",
    });

    expect(res.groups).toHaveLength(1);
    expect(mocks.anthropicClient.messages.create).toHaveBeenCalledTimes(2);
  });

  it("throws AI_OUTPUT_INVALID after both attempts fail to parse", async () => {
    mocks.anthropicClient.messages.create.mockResolvedValue({ content: [{ type: "text", text: "no json here at all" }] });

    await expect(
      proposeFormSegmentation(ADMIN_ACTOR, { detectedFields: [{ name: "F1", type: "text", page: 1 }], pdfText: "" }),
    ).rejects.toMatchObject({ code: "AI_OUTPUT_INVALID" });
  });
});
