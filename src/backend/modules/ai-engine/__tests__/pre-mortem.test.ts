/**
 * ai-engine Pre-Mortem quality validator — unit tests.
 *
 * Covers:
 *   1-4. retrieveDatasetItemsWithFallback (semantic / lexical fallback / null)
 *   5. assessPreMortemRisk: ai_letter happy path (persists validation, new shape)
 *   6. assessPreMortemRisk: pdf_automation happy path (resolveFormResponseFieldValues)
 *   7. assessPreMortemRisk: tolerant JSON parsing (markdown fences)
 *   8. assessPreMortemRisk: filters invalid categories/severities, clamps score
 *   9. assessPreMortemRisk: PREMORTEM_NO_TARGET when no eligible ai_letter run
 *  10. assessPreMortemRisk: PREMORTEM_NO_GUIDE when the form has no enabled guide
 *  11. assessPreMortemRisk: IDOR guard (run/response of a different case)
 *  12. assessPreMortemRisk: non-staff actor rejected (staff-only)
 *  13. getPreMortemAssessmentsForCase: maps rows to the new shape
 *  14. isPreMortemEnabledForCase: delegates to findGuideEnabledFormForCase
 *
 * All I/O (repository, platform, authz, the cases module) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findRunById: vi.fn(),
    findGenerationConfig: vi.fn().mockResolvedValue(null),
    matchDatasetItems: vi.fn(),
    insertPreMortemAssessment: vi.fn(),
    listPreMortemAssessmentsForCase: vi.fn(),
    findGuideEnabledFormForCase: vi.fn(),
    listGuideEnabledFormsForCase: vi.fn().mockResolvedValue([]),
    listCompletedRunsForForms: vi.fn().mockResolvedValue([]),
    listFormResponsesForForms: vi.fn().mockResolvedValue([]),
    findFormFillGuide: vi.fn(),
    findLatestEligibleRunForPreMortem: vi.fn(),
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
    resolveGenerationInputs: vi.fn(),
  };

  const authz = {
    can: vi.fn(),
    requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  };

  const embeddings = {
    embedText: vi.fn(),
    toVectorLiteral: vi.fn((v: number[]) => `[${v.join(",")}]`),
  };

  const cases = {
    getCaseExtractions: vi.fn().mockResolvedValue([]),
    resolveFormResponseFieldValues: vi.fn(),
  };

  const anthropicClient = {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  };

  const getAnthropicClient = vi.fn(() => anthropicClient);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const audit = { writeAudit: vi.fn() };
  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };

  return { repo, authz, embeddings, cases, anthropicClient, getAnthropicClient, logger, audit, events };
});

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

vi.mock("@/backend/modules/cases", () => ({
  getCaseExtractions: mocks.cases.getCaseExtractions,
  resolveFormResponseFieldValues: mocks.cases.resolveFormResponseFieldValues,
}));

vi.mock("@/backend/platform/embeddings", () => ({
  embedText: mocks.embeddings.embedText,
  toVectorLiteral: mocks.embeddings.toVectorLiteral,
  EMBEDDING_DIM: 768,
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));

// Required by the module import graph (improveFormAnswerText); not exercised here.
vi.mock("@/backend/platform/ratelimit", () => ({
  limitAiImprove: vi.fn().mockResolvedValue({ allowed: true, reset: 0 }),
}));

vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: vi.fn(() => ({ generateContent: vi.fn() })),
  getGeminiClient: vi.fn(() => ({ models: { embedContent: vi.fn(), generateContent: vi.fn() } })),
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));

vi.mock("@/backend/platform/ai-stub", () => ({ isAiStubEnabled: () => false }));

vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));

vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));

vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: vi.fn(),
  renderMarkdownToDocx: vi.fn(),
}));

vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));

vi.mock("@/backend/modules/audit", () => ({ writeAudit: mocks.audit.writeAudit }));

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
      update: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(() => Promise.resolve({ data: null, error: null })) })) })),
      select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: [], error: null })) })),
    })),
  };
  return { createServiceClient: vi.fn(() => mockClient), createServerClient: vi.fn(() => mockClient) };
});

import {
  assessPreMortemRisk,
  getPreMortemAssessmentsForCase,
  isPreMortemEnabledForCase,
  retrieveDatasetItemsWithFallback,
  AiEngineError,
} from "../service";

import type { Actor } from "@/backend/platform/authz";

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
const RESPONSE_ID = "88888888-8888-4888-8888-888888888888";

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
  content: "Applicant granted asylum based on political opinion nexus.",
  tags: ["NEXUS_FAIL", "CREDIBILITY"],
  outcome: "granted",
  jurisdiction: "BIA",
  token_count: 120,
  created_at: "2026-01-01T00:00:00.000Z",
  meta: { kind: "precedent" as const, citation: "Matter of XYZ, 27 I&N Dec. 1" },
  similarity: 0.92,
};

const VALID_REPORT_JSON =
  '{"score":72,"semaforo":"amber","verdict":"needs_corrections","summary":"Two fields need fixing.","findings":[{"severity":"critico","category":"mal_llenado","location":"Item 8","description":"Foreign address in a US-only field.","correction":"Use the US residence."}]}';

function buildAnthropicFinalMessage(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 200, output_tokens: 100 },
    stop_reason: "end_turn",
    model: "claude-opus-4-7",
  };
}

function mockAnthropic(text: string) {
  mocks.anthropicClient.messages.stream.mockImplementation(() => ({
    finalMessage: vi.fn().mockResolvedValue(buildAnthropicFinalMessage(text)),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
  mocks.authz.can.mockReturnValue(undefined);
  mocks.repo.findGenerationConfig.mockResolvedValue({ dataset_id: DATASET_ID, model: "claude-opus-4-7" });
  mocks.repo.findFormFillGuide.mockResolvedValue({
    guide_markdown: "# I-589 guide\n- Item 8: US residence only.",
    enabled: true,
    source_file_path: null,
  });
  mocks.repo.loadDatasetItems.mockResolvedValue([]);
  mocks.repo.matchDatasetItems.mockResolvedValue([]);
  mocks.embeddings.embedText.mockResolvedValue(new Array(768).fill(0.1));
  mocks.cases.getCaseExtractions.mockResolvedValue([]);
  // ai_letter now always resolves to a full run row (for config_snapshot + party_id).
  mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN });
  // Default: no frozen/config source inputs → validator falls back to extractions.
  mocks.repo.loadResolvedInputs.mockResolvedValue({ documents: [], forms: [] });
  mockAnthropic(VALID_REPORT_JSON);
  mocks.repo.insertPreMortemAssessment.mockResolvedValue({ id: ASSESSMENT_ID, created_at: "2026-06-29T10:10:00.000Z" });
});

// ---------------------------------------------------------------------------
// retrieveDatasetItemsWithFallback (kept from the prior RAG helper)
// ---------------------------------------------------------------------------

describe("retrieveDatasetItemsWithFallback", () => {
  it("returns semantic hits when matchDatasetItems returns results", async () => {
    mocks.repo.matchDatasetItems.mockResolvedValue([DATASET_ITEM]);
    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(DATASET_ITEM.id);
    expect(mocks.repo.loadDatasetItems).not.toHaveBeenCalled();
  });

  it("falls back to lexical when matchDatasetItems returns []", async () => {
    mocks.repo.matchDatasetItems.mockResolvedValue([]);
    mocks.repo.loadDatasetItems.mockResolvedValue([
      { id: "lex-1", title: "Lexical", content: "x", tags: [], outcome: null, jurisdiction: null, token_count: 80, created_at: "2026-01-01T00:00:00.000Z", meta: {} },
    ]);
    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");
    expect(mocks.repo.loadDatasetItems).toHaveBeenCalledWith(DATASET_ID);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to lexical when embedText throws", async () => {
    mocks.embeddings.embedText.mockRejectedValue(new Error("Gemini unavailable"));
    mocks.repo.loadDatasetItems.mockResolvedValue([
      { id: "lex-fallback", title: "Fallback", content: "x", tags: [], outcome: null, jurisdiction: null, token_count: 60, created_at: "2026-01-01T00:00:00.000Z", meta: {} },
    ]);
    const result = await retrieveDatasetItemsWithFallback(DATASET_ID, "test query");
    expect(mocks.repo.loadDatasetItems).toHaveBeenCalledWith(DATASET_ID);
    expect(result[0].id).toBe("lex-fallback");
  });

  it("returns [] when datasetId is null", async () => {
    const result = await retrieveDatasetItemsWithFallback(null, "query");
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assessPreMortemRisk
// ---------------------------------------------------------------------------

describe("assessPreMortemRisk", () => {
  it("ai_letter: auto-selects the latest eligible run, validates, persists (new shape)", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({
      runId: RUN_ID,
      outputText: BASE_RUN.output_text,
      outputPath: null,
      formDefinitionId: FORM_DEF_ID,
      model: "claude-opus-4-7",
    });

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter" } });

    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledOnce();

    expect(mocks.repo.insertPreMortemAssessment).toHaveBeenCalledOnce();
    const insertArg = mocks.repo.insertPreMortemAssessment.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.case_id).toBe(CASE_ID);
    expect(insertArg.target_kind).toBe("ai_letter");
    expect(insertArg.run_id).toBe(RUN_ID);
    expect(insertArg.response_id).toBe(null);
    expect(insertArg.score).toBe(72);
    expect(insertArg.semaforo).toBe("amber");
    expect(insertArg.verdict).toBe("needs_corrections");

    expect(result.targetKind).toBe("ai_letter");
    expect(result.runId).toBe(RUN_ID);
    expect(result.score).toBe(72);
    expect(result.semaforo).toBe("amber");
    expect(result.verdict).toBe("needs_corrections");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe("mal_llenado");
    expect(result.createdBy).toBe(ACTOR.userId);
  });

  it("ai_letter: injects the SOURCE material (questionnaire answers) the memo was generated from", async () => {
    mocks.repo.findRunById.mockResolvedValue({
      ...BASE_RUN,
      config_snapshot: {
        resolved_inputs: {
          documents: [],
          forms: [{ slug: "memorandum-de-miedo-creible-cuestionario", response_id: "r1" }],
        },
      },
    });
    mocks.repo.loadResolvedInputs.mockResolvedValue({
      documents: [],
      forms: [
        {
          slug: "memorandum-de-miedo-creible-cuestionario",
          answers: { "¿A qué le teme si regresa?": "A ser detenida por el colectivo armado en Caracas" },
        },
      ],
    });

    await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } });

    expect(mocks.repo.loadResolvedInputs).toHaveBeenCalledOnce();
    const streamArg = JSON.stringify(mocks.anthropicClient.messages.stream.mock.calls[0][0]);
    expect(streamArg).toContain("MATERIAL FUENTE");
    expect(streamArg).toContain("A ser detenida por el colectivo armado en Caracas");
    // When source material is present the generic extractions block is skipped.
    expect(mocks.cases.getCaseExtractions).not.toHaveBeenCalled();
  });

  it("ai_letter: truncates a giant memo to budget with a visible marker (no silent cap)", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, output_text: "A".repeat(200_000) });

    await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } });

    const streamArg = JSON.stringify(mocks.anthropicClient.messages.stream.mock.calls[0][0]);
    expect(streamArg).toContain("truncado por presupuesto");
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ label: "memo" }),
      expect.stringContaining("truncated to budget"),
    );
  });

  it("ai_letter: masks PII BEFORE truncating a giant memo (a boundary cut must not leak raw PII)", async () => {
    // ~180k chars of repeated SSNs → exceeds PREMORTEM_MEMO_BUDGET (120k) → truncates.
    // If masking ran AFTER truncation, the SSN straddling the cut would leak raw digits.
    const giant = "relleno con SSN 123-45-6789 aqui. ".repeat(6000);
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, output_text: giant });

    await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } });

    const streamArg = JSON.stringify(mocks.anthropicClient.messages.stream.mock.calls[0][0]);
    expect(streamArg).not.toContain("123-45-6789"); // raw SSN never reaches the provider
    expect(streamArg).toContain("6789"); // the masked form (•••-••-6789) survives
    expect(streamArg).toContain("truncado por presupuesto");
  });

  it("ai_letter: falls back to config slugs when the run froze empty inputs (older runs)", async () => {
    mocks.repo.findRunById.mockResolvedValue({
      ...BASE_RUN,
      party_id: null,
      config_snapshot: { resolved_inputs: { documents: [], forms: [] } },
    });
    mocks.repo.findGenerationConfig.mockResolvedValue({
      dataset_id: DATASET_ID,
      model: "claude-opus-4-7",
      input_form_slugs: ["memorandum-de-miedo-creible-cuestionario"],
      input_document_slugs: ["declaracion-jurada"],
    });
    mocks.repo.resolveGenerationInputs.mockResolvedValue({
      documents: [{ slug: "declaracion-jurada", case_document_id: "d1", extraction_id: "e1" }],
      forms: [{ slug: "memorandum-de-miedo-creible-cuestionario", response_id: "r1" }],
    });
    mocks.repo.loadResolvedInputs.mockResolvedValue({
      documents: [],
      forms: [{ slug: "memorandum-de-miedo-creible-cuestionario", answers: { "¿Qué teme?": "Represalias del grupo armado en su barrio" } }],
    });

    await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } });

    expect(mocks.repo.resolveGenerationInputs).toHaveBeenCalledWith(
      CASE_ID,
      null,
      ["memorandum-de-miedo-creible-cuestionario"],
      ["declaracion-jurada"],
    );
    const streamArg = JSON.stringify(mocks.anthropicClient.messages.stream.mock.calls[0][0]);
    expect(streamArg).toContain("MATERIAL FUENTE");
    expect(streamArg).toContain("Represalias del grupo armado en su barrio");
  });

  it("pdf_automation: resolves field values, validates, persists with response_id", async () => {
    mocks.cases.resolveFormResponseFieldValues.mockResolvedValue({
      caseId: CASE_ID,
      formDefinitionId: FORM_DEF_ID,
      fields: [
        { pdfFieldName: "Res8", label: "Item 8", fieldType: "text", source: "client_answer", value: "Caracas, Venezuela", visible: true, required: true, empty: false, doNotFill: false },
      ],
      missingRequired: [],
    });

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "pdf_automation", responseId: RESPONSE_ID } });

    expect(mocks.cases.resolveFormResponseFieldValues).toHaveBeenCalledWith(ACTOR, RESPONSE_ID);
    const insertArg = mocks.repo.insertPreMortemAssessment.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.target_kind).toBe("pdf_automation");
    expect(insertArg.response_id).toBe(RESPONSE_ID);
    expect(insertArg.run_id).toBe(null);
    expect(result.responseId).toBe(RESPONSE_ID);
    expect(result.targetKind).toBe("pdf_automation");
  });

  it("parses JSON even when Anthropic wraps it in markdown fences", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({ runId: RUN_ID, outputText: BASE_RUN.output_text, outputPath: null, formDefinitionId: FORM_DEF_ID, model: "claude-opus-4-7" });
    mockAnthropic(
      "Here is my review:\n```json\n" +
        '{"score":40,"semaforo":"red","verdict":"would_reject","summary":"Serious issues.","findings":[{"severity":"critico","category":"placeholder_sin_resolver","location":"Part B","description":"Unreplaced token.","correction":"Fill it."}]}\n' +
        "```\n",
    );

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter" } });
    expect(result.score).toBe(40);
    expect(result.semaforo).toBe("red");
    expect(result.verdict).toBe("would_reject");
    expect(result.findings[0].category).toBe("placeholder_sin_resolver");
  });

  it("filters invalid categories/severities and clamps the score", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({ runId: RUN_ID, outputText: BASE_RUN.output_text, outputPath: null, formDefinitionId: FORM_DEF_ID, model: "claude-opus-4-7" });
    mockAnthropic(
      '{"score":150,"semaforo":"amber","verdict":"needs_corrections","summary":"x","findings":[' +
        '{"severity":"critico","category":"mal_llenado","location":"A","description":"d","correction":"c"},' +
        '{"severity":"BOGUS","category":"mal_llenado","location":"B","description":"d","correction":"c"},' +
        '{"severity":"moderado","category":"INVENTED","location":"C","description":"d","correction":"c"}' +
        "]}",
    );

    const result = await assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter" } });
    expect(result.score).toBe(100); // clamped
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe("mal_llenado");
  });

  it("throws PREMORTEM_NO_TARGET when no eligible ai_letter run exists", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue(null);
    await expect(assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter" } })).rejects.toMatchObject({
      name: "AiEngineError",
      code: "PREMORTEM_NO_TARGET",
    });
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });

  it("throws PREMORTEM_NO_GUIDE when the form has no enabled guide", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN });
    mocks.repo.findFormFillGuide.mockResolvedValue({ guide_markdown: "", enabled: false, source_file_path: null });
    await expect(
      assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ name: "AiEngineError", code: "PREMORTEM_NO_GUIDE" });
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });

  it("uses an explicit runId and rejects one from a different case (IDOR)", async () => {
    mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN, case_id: "99999999-9999-4999-8999-999999999999" });
    await expect(
      assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ name: "AuthzError", message: "forbidden_case" });
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });

  it("rejects a pdf_automation response from a different case (IDOR)", async () => {
    mocks.cases.resolveFormResponseFieldValues.mockResolvedValue({
      caseId: "99999999-9999-4999-8999-999999999999",
      formDefinitionId: FORM_DEF_ID,
      fields: [],
      missingRequired: [],
    });
    await expect(
      assessPreMortemRisk(ACTOR, { caseId: CASE_ID, target: { kind: "pdf_automation", responseId: RESPONSE_ID } }),
    ).rejects.toMatchObject({ name: "AuthzError", message: "forbidden_case" });
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });

  it("rejects a non-staff (client) actor — Pre-Mortem is staff-only", async () => {
    const clientActor: Actor = { ...ACTOR, kind: "client", role: null };
    await expect(
      assessPreMortemRisk(clientActor, { caseId: CASE_ID, target: { kind: "ai_letter" } }),
    ).rejects.toMatchObject({ name: "AuthzError", message: "wrong_kind" });
    expect(mocks.repo.insertPreMortemAssessment).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getPreMortemAssessmentsForCase
// ---------------------------------------------------------------------------

describe("getPreMortemAssessmentsForCase", () => {
  it("maps rows to the new report shape", async () => {
    const row = {
      id: ASSESSMENT_ID,
      case_id: CASE_ID,
      target_kind: "pdf_automation",
      run_id: null,
      response_id: RESPONSE_ID,
      form_definition_id: FORM_DEF_ID,
      score: 88,
      semaforo: "green",
      verdict: "would_approve",
      summary: "Looks good.",
      findings: [{ severity: "sugerencia", category: "calidad", location: "Part B", description: "d", correction: "c" }],
      model: "claude-opus-4-7",
      input_tokens: 200,
      output_tokens: 80,
      cost_usd: 0.02,
      created_by: ACTOR.userId,
      created_at: "2026-06-29T10:10:00.000Z",
    };
    mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([row]);

    const results = await getPreMortemAssessmentsForCase(ACTOR, CASE_ID);
    expect(results).toHaveLength(1);
    const a = results[0];
    expect(a.targetKind).toBe("pdf_automation");
    expect(a.responseId).toBe(RESPONSE_ID);
    expect(a.score).toBe(88);
    expect(a.semaforo).toBe("green");
    expect(a.verdict).toBe("would_approve");
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].category).toBe("calidad");
  });

  it("returns [] when no assessments exist", async () => {
    mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([]);
    expect(await getPreMortemAssessmentsForCase(ACTOR, CASE_ID)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// isPreMortemEnabledForCase
// ---------------------------------------------------------------------------

describe("isPreMortemEnabledForCase", () => {
  it("returns true when findGuideEnabledFormForCase resolves true", async () => {
    mocks.repo.findGuideEnabledFormForCase.mockResolvedValue(true);
    expect(await isPreMortemEnabledForCase(ACTOR, CASE_ID)).toBe(true);
  });

  it("returns false when no form has an enabled guide", async () => {
    mocks.repo.findGuideEnabledFormForCase.mockResolvedValue(false);
    expect(await isPreMortemEnabledForCase(ACTOR, CASE_ID)).toBe(false);
  });

  it("returns false for a non-staff actor without querying (no tab for clients)", async () => {
    mocks.repo.findGuideEnabledFormForCase.mockResolvedValue(true);
    const clientActor: Actor = { ...ACTOR, kind: "client", role: null };
    expect(await isPreMortemEnabledForCase(clientActor, CASE_ID)).toBe(false);
    expect(mocks.repo.findGuideEnabledFormForCase).not.toHaveBeenCalled();
  });
});

describe("AiEngineError", () => {
  it("constructs the new Pre-Mortem codes", () => {
    expect(new AiEngineError("PREMORTEM_NO_GUIDE").code).toBe("PREMORTEM_NO_GUIDE");
    expect(new AiEngineError("PREMORTEM_NO_TARGET").code).toBe("PREMORTEM_NO_TARGET");
  });
});
