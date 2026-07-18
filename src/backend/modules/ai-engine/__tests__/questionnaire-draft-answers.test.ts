/**
 * executeQuestionnaireGenerationJob — AI draft answers (autofill total).
 *
 * With `draft_answers_enabled` on the questionnaire config, the job runs a
 * SECOND Anthropic call after materializing the schema (uuids exist only then)
 * that drafts one grounded answer per client question — generated AND base
 * (hybrid) — and persists them on the INSTANCE (`draft_answers`), never into
 * `case_form_responses.answers`. Best-effort: a drafting failure never blocks
 * the questionnaire (`ready` without drafts). Drafts that echo PII mask tokens
 * or select values outside the question's options are dropped (fail-safe).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findCurrentQuestionnaireInstance: vi.fn(),
    updateQuestionnaireInstance: vi.fn().mockResolvedValue(undefined),
    findQuestionnaireGenerationConfig: vi.fn(),
    loadResolvedInputs: vi.fn(),
    listPublishedQuestionTexts: vi.fn().mockResolvedValue([]),
    listPublishedClientQuestionsForDrafts: vi.fn().mockResolvedValue([]),
    getQuestionnaireInstanceDrafts: vi.fn(),
    // import-graph stubs
    findRunById: vi.fn(), findActiveRun: vi.fn(), maxVersion: vi.fn(), insertRun: vi.fn(),
    updateRunStatus: vi.fn(), completeRun: vi.fn(), markRunFailed: vi.fn(), isCancelled: vi.fn(),
    updateRunProgress: vi.fn(), patchConfigSnapshot: vi.fn(), findGenerationConfig: vi.fn().mockResolvedValue(null),
    countRunningByOrg: vi.fn(), listRunsForCase: vi.fn(), sumMonthlyCosts: vi.fn(), sumCosts: vi.fn(),
    aiCostRows: vi.fn(), getOrgCostContext: vi.fn(), findExtraction: vi.fn(), upsertExtraction: vi.fn(),
    findTranslation: vi.fn(), findTranslationById: vi.fn(), insertTranslation: vi.fn(),
    resetTranslation: vi.fn(), completeTranslation: vi.fn(), getCaseDocumentForAi: vi.fn(),
    getTranslationSource: vi.fn(), loadDatasetItems: vi.fn(), resolveGenerationInputs: vi.fn(),
    findCaseDocumentMeta: vi.fn(), listCurrentReadyQuestionnaireInstances: vi.fn().mockResolvedValue([]),
    insertQuestionnaireInstance: vi.fn(),
    insertPreMortemQueued: vi.fn(), findPreMortemAssessmentById: vi.fn(), claimPreMortemAssessment: vi.fn(),
    requeuePreMortemAssessment: vi.fn(), cancelQueuedPreMortemAssessment: vi.fn(),
    completePreMortemAssessment: vi.fn(), markPreMortemFailed: vi.fn(),
    sweepStalePreMortemForCase: vi.fn().mockResolvedValue(0), sweepStaleRunsForCase: vi.fn().mockResolvedValue(0),
  };

  // Anthropic: stream(...).finalMessage() — the responder inspects the user
  // message to decide whether it's the question-gen call or the drafts call.
  const streamCalls: Array<Record<string, unknown>> = [];
  let responder: (args: { messages: Array<{ content: string }> }) => unknown = () => {
    throw new Error("responder not set");
  };
  const anthropicClient = {
    messages: {
      stream: vi.fn((args: { messages: Array<{ content: string }> }) => {
        streamCalls.push(args);
        return { finalMessage: async () => responder(args) };
      }),
      create: vi.fn(),
    },
  };

  return {
    repo,
    anthropicClient,
    streamCalls,
    setResponder: (fn: typeof responder) => { responder = fn; },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock("../repository", () => mocks.repo);
vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: vi.fn(() => mocks.anthropicClient),
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));
vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: vi.fn(() => ({ generateContent: vi.fn() })),
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));
vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: vi.fn(), renderMarkdownToDocx: vi.fn(), renderCertifiedTranslationPdf: vi.fn(),
  countPdfPages: vi.fn(), extractPdfPageRange: vi.fn(),
}));
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/platform/supabase", () => ({ createServiceClient: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(), requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
}));
vi.mock("@/backend/platform/ratelimit", () => ({ limitAiImprove: vi.fn() }));
vi.mock("@/backend/platform/ai-stub", () => ({ isAiStubEnabled: () => false }));
vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(), uploadBytesToStorage: vi.fn(), downloadBytesFromStorage: vi.fn(),
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/backend/modules/catalog", () => ({ getServiceTranslationConfig: vi.fn() }));
vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));
vi.mock("@/shared/constants/ai-models", () => ({
  DEFAULT_GENERATION_MODEL: "claude-sonnet-4-6",
  FALLBACK_GENERATION_MODEL: "claude-sonnet-4-6",
  GENERATION_MODELS: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-fable-5", "claude-haiku-4-5"],
}));

import { executeQuestionnaireGenerationJob } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_QID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const SELECT_QID = "bbbbbbbb-bbbb-4bbb-8bbb-000000000002";

const INSTANCE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  case_id: "cccccccc-cccc-4ccc-8ccc-000000000001",
  form_definition_id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  party_id: null,
  status: "queued",
  inputs_snapshot: { documents: [], forms: [] },
};

const CONFIG = {
  form_definition_id: INSTANCE.form_definition_id,
  mode: "hybrid",
  generation_prompt: null,
  input_document_slugs: [],
  input_form_slugs: [],
  prerequisite_form_slugs: [],
  prerequisite_document_slugs: [],
  target_question_count: 4,
  model: "claude-sonnet-4-6",
  hybrid_layout: "append_group",
  auto_trigger: true,
  allow_client_trigger: false,
  on_new_evidence: "flag",
  draft_answers_enabled: true,
  draft_answers_prompt: null,
};

const QUESTIONS_JSON = JSON.stringify({
  groups: [
    {
      title_i18n: { es: "Sobre la decisión", en: "About the decision" },
      questions: [
        { key: "q1", question_i18n: { es: "¿Qué denegó el juez?", en: "What did the judge deny?" }, field_type: "textarea", is_required: true },
        { key: "q2", question_i18n: { es: "¿Cuándo fue la audiencia?", en: "When was the hearing?" }, field_type: "date", is_required: false },
      ],
    },
  ],
});

/** Pulls the drafteable question ids out of the drafts-call user message. */
function idsFromDraftPrompt(user: string): string[] {
  return [...user.matchAll(/- id: ([0-9a-f-]{36})/g)].map((m) => m[1]);
}

function textMessage(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 60 },
    stop_reason: "end_turn",
    model: "claude-sonnet-4-6",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.streamCalls.length = 0;
  mocks.repo.findCurrentQuestionnaireInstance.mockResolvedValue({ ...INSTANCE });
  mocks.repo.findQuestionnaireGenerationConfig.mockResolvedValue({ ...CONFIG });
  mocks.repo.loadResolvedInputs.mockResolvedValue({
    documents: [{ slug: "decision", extractionPayload: {}, rawText: "El juez denegó asilo por pretermisión." }],
    forms: [],
  });
  mocks.repo.listPublishedQuestionTexts.mockResolvedValue(["¿Pregunta base ya cubierta?"]);
  mocks.repo.listPublishedClientQuestionsForDrafts.mockResolvedValue([
    { id: BASE_QID, question_i18n: { es: "¿Qué te pareció injusto?" }, help_i18n: null, field_type: "textarea", options: null, is_required: true },
    { id: SELECT_QID, question_i18n: { es: "¿Tienes evidencia nueva?" }, help_i18n: null, field_type: "select", options: [{ value: "no", label_i18n: { es: "No", en: "No" } }, { value: "yes", label_i18n: { es: "Sí", en: "Yes" } }], is_required: false },
  ]);
});

describe("executeQuestionnaireGenerationJob — draft answers", () => {
  it("runs a second call and persists drafts for generated AND base questions", async () => {
    mocks.setResponder((args) => {
      const user = String(args.messages[0]?.content ?? "");
      if (mocks.streamCalls.length === 1) return textMessage(QUESTIONS_JSON);
      const ids = idsFromDraftPrompt(user);
      return textMessage(JSON.stringify({
        answers: ids.map((id) => ({ id, value: id === SELECT_QID ? "no" : `Borrador para ${id}` })),
      }));
    });

    const outcome = await executeQuestionnaireGenerationJob({
      caseId: INSTANCE.case_id,
      formDefinitionId: INSTANCE.form_definition_id,
      partyId: null,
    });

    expect(outcome).toBe("ready");
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(2);

    const readyUpdate = mocks.repo.updateQuestionnaireInstance.mock.calls.find(
      (c) => c[1]?.status === "ready",
    )?.[1] as Record<string, unknown>;
    expect(readyUpdate).toBeDefined();
    const drafts = readyUpdate.draft_answers as Record<string, string>;
    expect(drafts).toBeTruthy();
    // base questions drafted
    expect(drafts[BASE_QID]).toContain("Borrador");
    expect(drafts[SELECT_QID]).toBe("no");
    // the 2 generated questions drafted too (ids minted at materialization)
    expect(Object.keys(drafts).length).toBe(4);
  });

  it("drops drafts that echo PII mask tokens, invalid select values or unknown ids", async () => {
    mocks.setResponder((args) => {
      const user = String(args.messages[0]?.content ?? "");
      if (mocks.streamCalls.length === 1) return textMessage(QUESTIONS_JSON);
      const ids = idsFromDraftPrompt(user);
      const generated = ids.filter((id) => id !== BASE_QID && id !== SELECT_QID);
      return textMessage(JSON.stringify({
        answers: [
          { id: BASE_QID, value: "Mi número es •••••1234" }, // masked token → dropped
          { id: SELECT_QID, value: "quizás" },               // not an option value → dropped
          { id: generated[0], value: "⟦PII_1⟧ dijo eso" },    // reversible token → dropped
          { id: generated[1], value: "2026-06-30" },          // valid
          { id: "99999999-9999-4999-8999-000000000009", value: "huérfano" }, // unknown → dropped
        ],
      }));
    });

    await executeQuestionnaireGenerationJob({
      caseId: INSTANCE.case_id,
      formDefinitionId: INSTANCE.form_definition_id,
      partyId: null,
    });

    const readyUpdate = mocks.repo.updateQuestionnaireInstance.mock.calls.find(
      (c) => c[1]?.status === "ready",
    )?.[1] as Record<string, unknown>;
    const drafts = readyUpdate.draft_answers as Record<string, string>;
    expect(Object.keys(drafts).length).toBe(1);
    expect(Object.values(drafts)[0]).toBe("2026-06-30");
  });

  it("stays ready WITHOUT drafts when the drafting call fails (best-effort)", async () => {
    mocks.setResponder(() => {
      if (mocks.streamCalls.length === 1) return textMessage(QUESTIONS_JSON);
      throw new Error("anthropic down");
    });

    const outcome = await executeQuestionnaireGenerationJob({
      caseId: INSTANCE.case_id,
      formDefinitionId: INSTANCE.form_definition_id,
      partyId: null,
    });

    expect(outcome).toBe("ready");
    const readyUpdate = mocks.repo.updateQuestionnaireInstance.mock.calls.find(
      (c) => c[1]?.status === "ready",
    )?.[1] as Record<string, unknown>;
    expect(readyUpdate.draft_answers ?? null).toBeNull();
  });

  it("makes a single call when draft_answers_enabled is off (regression)", async () => {
    mocks.repo.findQuestionnaireGenerationConfig.mockResolvedValue({ ...CONFIG, draft_answers_enabled: false });
    mocks.setResponder(() => textMessage(QUESTIONS_JSON));

    const outcome = await executeQuestionnaireGenerationJob({
      caseId: INSTANCE.case_id,
      formDefinitionId: INSTANCE.form_definition_id,
      partyId: null,
    });

    expect(outcome).toBe("ready");
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(1);
  });
});
