/**
 * ai-engine Pre-Mortem critic — unit tests.
 *
 * Covers:
 *   1. retrieveDatasetItemsWithFallback: semantic OK path
 *   2. retrieveDatasetItemsWithFallback: fallback to lexical when matchDatasetItems empty
 *   3. retrieveDatasetItemsWithFallback: fallback to lexical when embedText throws
 *   4. assessPreMortemRisk: happy path (persists assessment, returns PreMortemAssessment)
 *   5. assessPreMortemRisk: tolerant JSON parsing (noisy output with markdown fences)
 *   6. assessPreMortemRisk: filters out invalid denial reason codes
 *   7. assessPreMortemRisk: throws PREMORTEM_NO_ELIGIBLE_RUN when no eligible run
 *   8. assessPreMortemRisk: explicit runId not found → PREMORTEM_NO_ELIGIBLE_RUN
 *   9. getPreMortemAssessmentsForCase: maps rows to typed PreMortemAssessment[]
 *  10. isPreMortemEnabledForCase: delegates to findPreMortemEnabledConfigForCase
 *
 * Mock strategy: vi.hoisted() for all variables used inside vi.mock() factories.
 * All I/O (repository, platform, authz) is mocked. No real Anthropic/Gemini calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted — declare mock variables BEFORE vi.mock() runs
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // repository
  const repo = {
    findRunById: vi.fn(),
    findGenerationConfig: vi.fn().mockResolvedValue(null),
    matchDatasetItems: vi.fn(),
    insertPreMortemAssessment: vi.fn(),
    listPreMortemAssessmentsForCase: vi.fn(),
    findPreMortemEnabledConfigForCase: vi.fn(),
    findLatestEligibleRunForPreMortem: vi.fn(),
    // pass-throughs for other repo functions imported by service.ts
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
    sumMonthlyCosts: vi.fn().mockResolvedValue({ totalUsd: 0, bySource: {} }),
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

  const authz = {
    can: vi.fn(),
    requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  };

  const embeddings = {
    embedText: vi.fn(),
    toVectorLiteral: vi.fn((v: number[]) => `[${v.join(",")}]`),
  };

  const anthropicClient = {
    messages: {
      stream: vi.fn(() => ({
        finalMessage: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: '{"overallRisk":"medium","summary":"Test summary.","reasons":[]}' }],
          usage: { input_tokens: 100, output_tokens: 50 },
          stop_reason: "end_turn",
          model: "claude-opus-4-7",
        }),
      })),
      create: vi.fn(),
    },
  };

  const getAnthropicClient = vi.fn(() => anthropicClient);

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const audit = { writeAudit: vi.fn() };

  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };

  return {
    repo,
    authz,
    embeddings,
    anthropicClient,
    getAnthropicClient,
    logger,
    audit,
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

vi.mock("@/backend/platform/embeddings", () => ({
  embedText: mocks.embeddings.embedText,
  toVectorLiteral: mocks.embeddings.toVectorLiteral,
  EMBEDDING_DIM: 768,
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
}));

vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: vi.fn(() => ({ generateContent: vi.fn() })),
  getGeminiClient: vi.fn(() => ({ models: { embedContent: vi.fn(), generateContent: vi.fn() } })),
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));

vi.mock("@/backend/platform/ai-stub", () => ({
  isAiStubEnabled: () => false,
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: vi.fn(),
  renderMarkdownToDocx: vi.fn(),
}));

vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mocks.audit.writeAudit,
}));

vi.mock("../events", () => ({
  emitGenerationCompleted: mocks.events.emitGenerationCompleted,
  emitGenerationFailed: mocks.events.emitGenerationFailed,
  emitExtractionCompleted: mocks.events.emitExtractionCompleted,
}));

vi.mock("@/shared/constants/ai-models", () => ({
  DEFAULT_GENERATION_MODEL: "claude-sonnet-4-6",
  FALLBACK_GENERATION_MODEL: "claude-sonnet-4-6",
  GENERATION_MODELS: ["claude-sonnet-4-6", "claude-opus-4-7"],
}));

vi.mock("@/backend/platform/supabase", () => {
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
  assessPreMortemRisk,
  getPreMortemAssessmentsForCase,
  isPreMortemEnabledForCase,
  retrieveDatasetItemsWithFallback,
  AiEngineError,
} from "../service";

import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR: Actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  kind: "staff",
  role: "paralegal",
  permissions: new Map(),
};

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const FORM_DEF_ID = "55555555-5555-4555-8555-555555555555";
const DATASET_ID = "66666666-6666-4666-8666-666666666666";
const ASSESSMENT_ID = "77777777-7777-4777-8777-777777777777";

const BASE_RUN = {
  id: RUN_ID,
  case_id: CASE_ID,
  form_definition_id: FORM_DEF_ID,
  status: "completed" as const,
  output_text: "## Memorándum legal\n\nEl solicitante teme persecución por su opinión política.",
  model: "claude-opus-4-7",
  orgId: "22222222-2222-4222-8222-222222222222",
  version: 1,
  is_test: false,
  created_at: "2026-06-29T10:00:00.000Z",
  updated_at: "2026-06-29T10:00:00.000Z",
  output_path: null,
  output_summary: null,
  input_tokens: 1000,
  output_tokens: 500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cost_usd: 0.05,
  progress: null,
  error: null,
  party_id: null,
  requested_by: ACTOR.userId,
  config_snapshot: null,
  completed_at: "2026-06-29T10:05:00.000Z",
};

const DATASET_ITEM = {
  id: "item-1",
  title: "Matter of XYZ — Granted",
  content: "Applicant from Honduras granted asylum based on political opinion nexus.",
  tags: ["NEXUS_FAIL", "CREDIBILITY"],
  outcome: "granted",
  jurisdiction: "BIA",
  token_count: 120,
  created_at: "2026-01-01T00:00:00.000Z",
  meta: { kind: "precedent" as const, citation: "Matter of XYZ, 27 I&N Dec. 1" },
  similarity: 0.92,
};

function buildAnthropicFinalMessage(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 200, output_tokens: 100 },
    stop_reason: "end_turn",
    model: "claude-opus-4-7",
  };
}

// ---------------------------------------------------------------------------
// beforeEach — reset mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
  mocks.authz.can.mockReturnValue(undefined);
  mocks.repo.findGenerationConfig.mockResolvedValue({
    dataset_id: DATASET_ID,
    model: "claude-opus-4-7",
    pre_mortem_enabled: true,
    // other fields not needed
  });
  mocks.repo.loadDatasetItems.mockResolvedValue([]);
  mocks.repo.matchDatasetItems.mockResolvedValue([]);
  mocks.embeddings.embedText.mockResolvedValue(new Array(768).fill(0.1));

  // Default Anthropic response: valid JSON
  mocks.anthropicClient.messages.stream.mockImplementation(() => ({
    finalMessage: vi.fn().mockResolvedValue(
      buildAnthropicFinalMessage(
        '{"overallRisk":"medium","summary":"The memo has moderate risk.","reasons":[{"code":"NEXUS_FAIL","probability":0.7,"rationale":"Nexus not clearly established.","correction":"Add explicit nexus argument."}]}'
      )
    ),
  }));

  mocks.repo.insertPreMortemAssessment.mockResolvedValue({
    id: ASSESSMENT_ID,
    created_at: "2026-06-29T10:10:00.000Z",
  });
});

// ---------------------------------------------------------------------------
// 1. retrieveDatasetItemsWithFallback — semantic OK path
// ---------------------------------------------------------------------------

describe("retrieveDatasetItemsWithFallback", () => {
  it("returns semantic hits when matchDatasetItems returns results", async () => {
    mocks.repo.matchDatasetItems.mockResolvedValue([DATASET_ITEM]);
    mocks.embeddings.embedText.mockResolvedValue(new Array(768).fill(0.5));

    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");

    expect(mocks.embeddings.embedText).toHaveBeenCalledOnce();
    expect(mocks.repo.matchDatasetItems).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(DATASET_ITEM.id);
    expect(result[0].title).toBe(DATASET_ITEM.title);
    // loadDatasetItems should NOT have been called (semantic path succeeded)
    expect(mocks.repo.loadDatasetItems).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. Fallback to lexical when matchDatasetItems returns empty
  // -------------------------------------------------------------------------

  it("falls back to lexical selectDatasetItems when matchDatasetItems returns []", async () => {
    mocks.repo.matchDatasetItems.mockResolvedValue([]); // no embeddings backfilled
    mocks.repo.loadDatasetItems.mockResolvedValue([
      {
        id: "lex-1",
        title: "Lexical item",
        content: "Content found by lexical search.",
        tags: ["CREDIBILITY"],
        outcome: "denied",
        jurisdiction: "9th Cir.",
        token_count: 80,
        created_at: "2026-01-01T00:00:00.000Z",
        meta: {},
      },
    ]);

    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");

    expect(mocks.repo.loadDatasetItems).toHaveBeenCalledWith(DATASET_ID);
    // Result comes from lexical path
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 3. Fallback to lexical when embedText throws
  // -------------------------------------------------------------------------

  it("falls back to lexical when embedText throws", async () => {
    mocks.embeddings.embedText.mockRejectedValue(new Error("Gemini unavailable"));
    mocks.repo.loadDatasetItems.mockResolvedValue([
      {
        id: "lex-fallback",
        title: "Fallback item",
        content: "Fallback content.",
        tags: [],
        outcome: null,
        jurisdiction: null,
        token_count: 60,
        created_at: "2026-01-01T00:00:00.000Z",
        meta: {},
      },
    ]);

    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: DATASET_ID }),
      expect.stringContaining("semantic retrieval failed"),
    );
    expect(mocks.repo.loadDatasetItems).toHaveBeenCalledWith(DATASET_ID);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].id).toBe("lex-fallback");
  });

  it("returns [] when datasetId is null", async () => {
    const result = await retrieveDatasetItemsWithFallback(null, "query");
    expect(result).toEqual([]);
    expect(mocks.embeddings.embedText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. assessPreMortemRisk — happy path
// ---------------------------------------------------------------------------

describe("assessPreMortemRisk", () => {
  it("resolves the latest eligible run, calls Anthropic, persists assessment", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({
      runId: RUN_ID,
      outputText: BASE_RUN.output_text,
      formDefinitionId: FORM_DEF_ID,
      model: "claude-opus-4-7",
    });
    mocks.repo.matchDatasetItems.mockResolvedValue([DATASET_ITEM]);
    mocks.embeddings.embedText.mockResolvedValue(new Array(768).fill(0.2));

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID });

    // Auth
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);

    // Anthropic was called
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledOnce();

    // Assessment persisted
    expect(mocks.repo.insertPreMortemAssessment).toHaveBeenCalledOnce();
    const insertArg = mocks.repo.insertPreMortemAssessment.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg["case_id"]).toBe(CASE_ID);
    expect(insertArg["run_id"]).toBe(RUN_ID);
    expect(insertArg["created_by"]).toBe(ACTOR.userId);
    expect(insertArg["overall_risk"]).toBe("medium");

    // Returned shape
    expect(result.id).toBe(ASSESSMENT_ID);
    expect(result.caseId).toBe(CASE_ID);
    expect(result.runId).toBe(RUN_ID);
    expect(result.overallRisk).toBe("medium");
    expect(result.summary).toBe("The memo has moderate risk.");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe("NEXUS_FAIL");
    expect(result.reasons[0].probability).toBe(0.7);
    expect(result.createdBy).toBe(ACTOR.userId);
  });

  // -------------------------------------------------------------------------
  // 5. Tolerant JSON parsing — noisy output with markdown fences
  // -------------------------------------------------------------------------

  it("parses JSON correctly even when Anthropic wraps output in markdown fences", async () => {
    const noisyOutput =
      "Here is my analysis:\n" +
      "```json\n" +
      '{"overallRisk":"high","summary":"High risk case.","reasons":[{"code":"CREDIBILITY","probability":0.85,"rationale":"Timeline inconsistencies.","correction":"Provide sworn affidavit."}]}\n' +
      "```\n" +
      "Please review the above.";

    mocks.anthropicClient.messages.stream.mockImplementation(() => ({
      finalMessage: vi.fn().mockResolvedValue(buildAnthropicFinalMessage(noisyOutput)),
    }));
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({
      runId: RUN_ID,
      outputText: BASE_RUN.output_text,
      formDefinitionId: FORM_DEF_ID,
      model: "claude-opus-4-7",
    });

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID });

    expect(result.overallRisk).toBe("high");
    expect(result.summary).toBe("High risk case.");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0].code).toBe("CREDIBILITY");
    expect(result.reasons[0].probability).toBe(0.85);
  });

  // -------------------------------------------------------------------------
  // 6. Filter invalid denial reason codes
  // -------------------------------------------------------------------------

  it("filters out reasons with invalid denial reason codes", async () => {
    const outputWithInvalidCodes =
      '{"overallRisk":"low","summary":"Low risk.","reasons":[' +
      '{"code":"NEXUS_FAIL","probability":0.3,"rationale":"Minor.","correction":"Clarify."},' +
      '{"code":"INVENTED_CODE","probability":0.9,"rationale":"Invalid.","correction":"N/A"},' +
      '{"code":"CREDIBILITY","probability":0.2,"rationale":"OK.","correction":"Document."}' +
      "]}";

    mocks.anthropicClient.messages.stream.mockImplementation(() => ({
      finalMessage: vi.fn().mockResolvedValue(buildAnthropicFinalMessage(outputWithInvalidCodes)),
    }));
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({
      runId: RUN_ID,
      outputText: BASE_RUN.output_text,
      formDefinitionId: FORM_DEF_ID,
      model: "claude-opus-4-7",
    });

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID });

    // Only valid codes (NEXUS_FAIL, CREDIBILITY); INVENTED_CODE filtered out
    const codes = result.reasons.map((r) => r.code);
    expect(codes).not.toContain("INVENTED_CODE");
    expect(codes).toContain("NEXUS_FAIL");
    expect(codes).toContain("CREDIBILITY");
    // Sorted by probability descending
    expect(result.reasons[0].probability).toBeGreaterThanOrEqual(result.reasons[1].probability);
  });

  // -------------------------------------------------------------------------
  // 7. throws PREMORTEM_NO_ELIGIBLE_RUN when no eligible run (auto-select path)
  // -------------------------------------------------------------------------

  it("throws PREMORTEM_NO_ELIGIBLE_RUN when no eligible run exists", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue(null);

    await expect(assessPreMortemRisk(ACTOR, { caseId: CASE_ID })).rejects.toMatchObject({
      name: "AiEngineError",
      code: "PREMORTEM_NO_ELIGIBLE_RUN",
    });

    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. Explicit runId not found → PREMORTEM_NO_ELIGIBLE_RUN
  // -------------------------------------------------------------------------

  it("throws PREMORTEM_NO_ELIGIBLE_RUN when explicit runId has no output_text", async () => {
    mocks.repo.findRunById.mockResolvedValue({
      ...BASE_RUN,
      id: RUN_ID,
      output_text: null, // no output
    });

    await expect(
      assessPreMortemRisk(ACTOR, { caseId: CASE_ID, runId: RUN_ID }),
    ).rejects.toMatchObject({
      name: "AiEngineError",
      code: "PREMORTEM_NO_ELIGIBLE_RUN",
    });
  });

  it("uses explicit runId when provided and run has output_text", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, orgId: ACTOR.orgId });

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, runId: RUN_ID });

    expect(mocks.repo.findRunById).toHaveBeenCalledWith(RUN_ID);
    expect(mocks.repo.findLatestEligibleRunForPreMortem).not.toHaveBeenCalled();
    expect(result.runId).toBe(RUN_ID);
  });
});

// ---------------------------------------------------------------------------
// 9. getPreMortemAssessmentsForCase — maps rows to typed PreMortemAssessment[]
// ---------------------------------------------------------------------------

describe("getPreMortemAssessmentsForCase", () => {
  it("returns mapped assessments for the case", async () => {
    const row = {
      id: ASSESSMENT_ID,
      case_id: CASE_ID,
      run_id: RUN_ID,
      form_definition_id: FORM_DEF_ID,
      overall_risk: "medium",
      summary: "Moderate risk.",
      reasons: [
        { code: "NEXUS_FAIL", probability: 0.6, rationale: "Weak nexus.", correction: "Strengthen nexus." },
      ],
      model: "claude-opus-4-7",
      input_tokens: 200,
      output_tokens: 80,
      cost_usd: 0.02,
      created_by: ACTOR.userId,
      created_at: "2026-06-29T10:10:00.000Z",
    };

    mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([row]);

    const results = await getPreMortemAssessmentsForCase(ACTOR, CASE_ID);

    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(results).toHaveLength(1);
    const a = results[0];
    expect(a.id).toBe(ASSESSMENT_ID);
    expect(a.caseId).toBe(CASE_ID);
    expect(a.overallRisk).toBe("medium");
    expect(a.summary).toBe("Moderate risk.");
    expect(a.reasons).toHaveLength(1);
    expect(a.reasons[0].code).toBe("NEXUS_FAIL");
    expect(a.model).toBe("claude-opus-4-7");
    expect(a.costUsd).toBe(0.02);
    expect(a.createdBy).toBe(ACTOR.userId);
  });

  it("returns [] when no assessments exist", async () => {
    mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([]);

    const results = await getPreMortemAssessmentsForCase(ACTOR, CASE_ID);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. isPreMortemEnabledForCase — delegates to findPreMortemEnabledConfigForCase
// ---------------------------------------------------------------------------

describe("isPreMortemEnabledForCase", () => {
  it("returns true when findPreMortemEnabledConfigForCase resolves true", async () => {
    mocks.repo.findPreMortemEnabledConfigForCase.mockResolvedValue(true);

    const result = await isPreMortemEnabledForCase(ACTOR, CASE_ID);

    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(result).toBe(true);
  });

  it("returns false when no pre_mortem_enabled config exists", async () => {
    mocks.repo.findPreMortemEnabledConfigForCase.mockResolvedValue(false);

    const result = await isPreMortemEnabledForCase(ACTOR, CASE_ID);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AiEngineError — verify the new code is in the union
// ---------------------------------------------------------------------------

describe("AiEngineError", () => {
  it("can be constructed with PREMORTEM_NO_ELIGIBLE_RUN code", () => {
    const err = new AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN");
    expect(err.code).toBe("PREMORTEM_NO_ELIGIBLE_RUN");
    expect(err.name).toBe("AiEngineError");
    expect(err instanceof Error).toBe(true);
  });
});
