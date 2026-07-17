/**
 * ai-engine Pre-Mortem ASYNC pipeline — unit tests (QStash job model).
 *
 * The validator no longer runs inside a server action: startPreMortemValidation
 * freezes the target, inserts a 'queued' assessment row (the row IS the
 * concurrency lock via a partial unique index) and enqueues the run-premortem
 * job; executePreMortemJob claims the row atomically (queued→running), runs the
 * single long Anthropic call and completes/fails the SAME row.
 *
 * Cost-safety invariants under test:
 *   - a lost claim NEVER calls Anthropic (at-least-once QStash delivery)
 *   - a failed call requeues + throws (QStash retries; nothing was produced)
 *   - a post-call persist failure NEVER re-runs the call (fail, keep the spend)
 *   - zombie rows are swept to 'failed' lazily on the read path (no auto re-run)
 *
 * All I/O (repository, platform, authz, the cases module) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findRunById: vi.fn(),
    findActiveRun: vi.fn(),
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
    loadDatasetItems: vi.fn(),
    loadResolvedInputs: vi.fn(),
    resolveGenerationInputs: vi.fn(),
    // --- async pre-mortem lifecycle (new) ---
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
    resolveFormResponseFieldValuesSystem: vi.fn(),
    getFormResponseMeta: vi.fn(),
  };

  const anthropicClient = {
    messages: {
      stream: vi.fn(),
      create: vi.fn(),
    },
  };

  const qstash = { enqueueJob: vi.fn().mockResolvedValue(undefined) };

  const getAnthropicClient = vi.fn(() => anthropicClient);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const audit = { writeAudit: vi.fn() };
  const events = {
    emitGenerationCompleted: vi.fn(),
    emitGenerationFailed: vi.fn(),
    emitExtractionCompleted: vi.fn(),
  };

  return { repo, authz, embeddings, cases, anthropicClient, qstash, getAnthropicClient, logger, audit, events };
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
  resolveFormResponseFieldValuesSystem: mocks.cases.resolveFormResponseFieldValuesSystem,
  getFormResponseMeta: mocks.cases.getFormResponseMeta,
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

vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: mocks.qstash.enqueueJob }));

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
  startPreMortemValidation,
  executePreMortemJob,
  cancelPreMortemValidation,
  getPreMortemStatus,
  markPreMortemFailedByCallback,
  getPreMortemAssessmentsForCase,
  type RunPreMortemPayload,
} from "../service";

import type { Actor } from "@/backend/platform/authz";

const ACTOR: Actor = {
  userId: "11111111-1111-4111-8111-111111111111",
  orgId: "22222222-2222-4222-8222-222222222222",
  kind: "staff",
  role: "paralegal",
  permissions: new Map(),
};

const CLIENT_ACTOR: Actor = { ...ACTOR, kind: "client", role: null as never };

const CASE_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const FORM_DEF_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "77777777-7777-4777-8777-777777777777";
const RESPONSE_ID = "88888888-8888-4888-8888-888888888888";

const BASE_RUN = {
  id: RUN_ID,
  case_id: CASE_ID,
  form_definition_id: FORM_DEF_ID,
  status: "completed" as const,
  output_text: "## Memorándum legal\n\nEl solicitante teme persecución por su opinión política.",
  model: "claude-opus-4-7",
  version: 1,
  is_test: false,
  created_at: "2026-07-17T10:00:00.000Z",
  updated_at: "2026-07-17T10:00:00.000Z",
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
  completed_at: "2026-07-17T10:05:00.000Z",
};

const QUEUED_ROW = {
  id: ASSESSMENT_ID,
  case_id: CASE_ID,
  target_kind: "ai_letter",
  run_id: RUN_ID,
  response_id: null,
  form_definition_id: FORM_DEF_ID,
  status: "queued",
  started_at: null,
  error: null,
  score: null,
  semaforo: null,
  verdict: null,
  summary: null,
  findings: [],
  model: null,
  input_tokens: null,
  output_tokens: null,
  cost_usd: null,
  created_by: ACTOR.userId,
  created_at: "2026-07-17T11:00:00.000Z",
  updated_at: "2026-07-17T11:00:00.000Z",
};

const PAYLOAD: RunPreMortemPayload = {
  jobKey: "run-premortem",
  entityId: ASSESSMENT_ID,
  attempt: 1,
  dedupeId: `run-premortem:${ASSESSMENT_ID}`,
  orgId: ACTOR.orgId,
  assessmentId: ASSESSMENT_ID,
};

const VALID_REPORT_JSON =
  '{"score":82,"semaforo":"amber","verdict":"needs_corrections","summary":"Muy buen documento.","findings":[{"severity":"moderado","category":"mal_llenado","location":"Item 8","description":"Dato incompleto.","correction":"Completar."}]}';

function buildAnthropicFinalMessage(text: string, model = "claude-opus-4-7") {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 200, output_tokens: 100 },
    stop_reason: "end_turn",
    model,
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
  mocks.repo.findGenerationConfig.mockResolvedValue({ dataset_id: null, model: "claude-opus-4-7" });
  mocks.repo.findFormFillGuide.mockResolvedValue({
    guide_markdown: "# Guía\n- Criterio 1.",
    enabled: true,
    source_file_path: null,
  });
  mocks.repo.findRunById.mockResolvedValue({ ...BASE_RUN });
  mocks.repo.findActiveRun.mockResolvedValue(null);
  mocks.repo.loadResolvedInputs.mockResolvedValue({ documents: [], forms: [] });
  mocks.repo.loadDatasetItems.mockResolvedValue([]);
  mocks.repo.matchDatasetItems.mockResolvedValue([]);
  mocks.cases.getCaseExtractions.mockResolvedValue([]);
  mocks.repo.insertPreMortemQueued.mockResolvedValue({ id: ASSESSMENT_ID, created_at: QUEUED_ROW.created_at });
  mocks.repo.findPreMortemAssessmentById.mockResolvedValue({ ...QUEUED_ROW });
  mocks.repo.claimPreMortemAssessment.mockResolvedValue(true);
  mocks.repo.completePreMortemAssessment.mockResolvedValue({ rowsAffected: 1 });
  mocks.repo.markPreMortemFailed.mockResolvedValue(undefined);
  mocks.repo.requeuePreMortemAssessment.mockResolvedValue(undefined);
  mocks.repo.sweepStalePreMortemForCase.mockResolvedValue(0);
  mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([]);
  mocks.qstash.enqueueJob.mockResolvedValue(undefined);
  mockAnthropic(VALID_REPORT_JSON);
});

// ---------------------------------------------------------------------------
// startPreMortemValidation — enqueue path
// ---------------------------------------------------------------------------

describe("startPreMortemValidation", () => {
  it("ai_letter (explicit runId): freezes the run, inserts queued and enqueues run-premortem with 780s timeout", async () => {
    const result = await startPreMortemValidation(ACTOR, {
      caseId: CASE_ID,
      target: { kind: "ai_letter", runId: RUN_ID },
    });

    expect(result.assessmentId).toBe(ASSESSMENT_ID);
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);

    // Row frozen to the concrete artifact, queued.
    const insertArg = mocks.repo.insertPreMortemQueued.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.case_id).toBe(CASE_ID);
    expect(insertArg.target_kind).toBe("ai_letter");
    expect(insertArg.run_id).toBe(RUN_ID);
    expect(insertArg.response_id).toBe(null);
    expect(insertArg.form_definition_id).toBe(FORM_DEF_ID);
    expect(insertArg.status).toBe("queued");
    expect(insertArg.created_by).toBe(ACTOR.userId);

    // Enqueued with per-ROW dedupe + explicit long endpoint timeout (< route 800s).
    expect(mocks.qstash.enqueueJob).toHaveBeenCalledOnce();
    const [envelope, options] = mocks.qstash.enqueueJob.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(envelope.jobKey).toBe("run-premortem");
    expect(envelope.entityId).toBe(ASSESSMENT_ID);
    expect(envelope.assessmentId).toBe(ASSESSMENT_ID);
    expect(envelope.orgId).toBe(ACTOR.orgId);
    expect(envelope.dedupeId).toBe(`run-premortem:${ASSESSMENT_ID}`);
    expect(options).toMatchObject({ retries: 2, timeout: "780s" });

    // The validator call does NOT happen synchronously.
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
    expect(mocks.audit.writeAudit).toHaveBeenCalled();
  });

  it("ai_letter without runId: resolves the latest eligible run and freezes ITS id", async () => {
    mocks.repo.findLatestEligibleRunForPreMortem.mockResolvedValue({ runId: RUN_ID, formDefinitionId: FORM_DEF_ID });

    await startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter" } });

    const insertArg = mocks.repo.insertPreMortemQueued.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.run_id).toBe(RUN_ID);
  });

  it("throws PREMORTEM_NO_GUIDE early — nothing inserted, nothing enqueued", async () => {
    mocks.repo.findFormFillGuide.mockResolvedValue(null);

    await expect(
      startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ code: "PREMORTEM_NO_GUIDE" });

    expect(mocks.repo.insertPreMortemQueued).not.toHaveBeenCalled();
    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
  });

  it("maps the unique-violation 'duplicate' to PREMORTEM_IN_PROGRESS — nothing enqueued", async () => {
    mocks.repo.insertPreMortemQueued.mockResolvedValue("duplicate");

    await expect(
      startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ code: "PREMORTEM_IN_PROGRESS" });

    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects when a generation of the same form is in flight (PREMORTEM_TARGET_REGENERATING)", async () => {
    mocks.repo.findActiveRun.mockResolvedValue({ id: "someRun", status: "running" });

    await expect(
      startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ code: "PREMORTEM_TARGET_REGENERATING" });

    expect(mocks.repo.insertPreMortemQueued).not.toHaveBeenCalled();
    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects non-staff actors (staff-only work product)", async () => {
    await expect(
      startPreMortemValidation(CLIENT_ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toMatchObject({ name: "AuthzError" });

    expect(mocks.repo.insertPreMortemQueued).not.toHaveBeenCalled();
  });

  it("compensates when the enqueue fails: marks the queued row failed and rethrows", async () => {
    mocks.qstash.enqueueJob.mockRejectedValue(new Error("qstash down"));

    await expect(
      startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "ai_letter", runId: RUN_ID } }),
    ).rejects.toThrow();

    expect(mocks.repo.markPreMortemFailed).toHaveBeenCalledWith(ASSESSMENT_ID, expect.stringContaining("enqueue"));
  });

  it("pdf_automation: freezes response_id via light meta and guards IDOR", async () => {
    mocks.cases.getFormResponseMeta.mockResolvedValue({ caseId: CASE_ID, formDefinitionId: FORM_DEF_ID });

    await startPreMortemValidation(ACTOR, {
      caseId: CASE_ID,
      target: { kind: "pdf_automation", responseId: RESPONSE_ID },
    });

    const insertArg = mocks.repo.insertPreMortemQueued.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.target_kind).toBe("pdf_automation");
    expect(insertArg.response_id).toBe(RESPONSE_ID);
    expect(insertArg.run_id).toBe(null);

    // IDOR: response of ANOTHER case must be rejected.
    mocks.cases.getFormResponseMeta.mockResolvedValue({ caseId: "99999999-9999-4999-8999-999999999999", formDefinitionId: FORM_DEF_ID });
    await expect(
      startPreMortemValidation(ACTOR, { caseId: CASE_ID, target: { kind: "pdf_automation", responseId: RESPONSE_ID } }),
    ).rejects.toMatchObject({ name: "AuthzError" });
  });
});

// ---------------------------------------------------------------------------
// executePreMortemJob — worker path
// ---------------------------------------------------------------------------

describe("executePreMortemJob", () => {
  it("returns 'skipped' when the assessment row no longer exists", async () => {
    mocks.repo.findPreMortemAssessmentById.mockResolvedValue(null);

    expect(await executePreMortemJob(PAYLOAD)).toBe("skipped");
    expect(mocks.repo.claimPreMortemAssessment).not.toHaveBeenCalled();
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
  });

  it("returns 'skipped' for a terminal row without attempting a claim", async () => {
    mocks.repo.findPreMortemAssessmentById.mockResolvedValue({ ...QUEUED_ROW, status: "completed" });

    expect(await executePreMortemJob(PAYLOAD)).toBe("skipped");
    expect(mocks.repo.claimPreMortemAssessment).not.toHaveBeenCalled();
  });

  it("a lost claim NEVER calls Anthropic (concurrent duplicate delivery)", async () => {
    mocks.repo.claimPreMortemAssessment.mockResolvedValue(false);

    expect(await executePreMortemJob(PAYLOAD)).toBe("skipped");
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
    expect(mocks.repo.completePreMortemAssessment).not.toHaveBeenCalled();
  });

  it("happy path: claims, calls the validator once and completes the SAME row with the calibrated verdict", async () => {
    // 82 with zero críticos → deterministic calibration says would_approve
    // even though the model said needs_corrections.
    expect(await executePreMortemJob(PAYLOAD)).toBe("completed");

    expect(mocks.repo.claimPreMortemAssessment).toHaveBeenCalledWith(ASSESSMENT_ID);
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledOnce();

    expect(mocks.repo.completePreMortemAssessment).toHaveBeenCalledOnce();
    const [idArg, resultArg] = mocks.repo.completePreMortemAssessment.mock.calls[0] as [string, Record<string, unknown>];
    expect(idArg).toBe(ASSESSMENT_ID);
    expect(resultArg.score).toBe(82);
    expect(resultArg.verdict).toBe("would_approve");
    expect(resultArg.model).toBe("claude-opus-4-7");
  });

  it("a slow call failure (timeout/5xx) requeues the row and throws so QStash retries", async () => {
    mocks.anthropicClient.messages.stream.mockImplementation(() => ({
      finalMessage: vi.fn().mockRejectedValue(new Error("Request was aborted.")),
    }));

    await expect(executePreMortemJob(PAYLOAD)).rejects.toThrow();

    expect(mocks.repo.requeuePreMortemAssessment).toHaveBeenCalledWith(ASSESSMENT_ID);
    expect(mocks.repo.completePreMortemAssessment).not.toHaveBeenCalled();
    expect(mocks.repo.markPreMortemFailed).not.toHaveBeenCalled();
  });

  it("a fast 400/model failure falls back in-process (exactly one extra call) and completes", async () => {
    let calls = 0;
    mocks.anthropicClient.messages.stream.mockImplementation(() => ({
      finalMessage: vi.fn().mockImplementation(() => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("400 model_not_found"));
        return Promise.resolve(buildAnthropicFinalMessage(VALID_REPORT_JSON, "claude-sonnet-4-6"));
      }),
    }));

    expect(await executePreMortemJob(PAYLOAD)).toBe("completed");
    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledTimes(2);
    expect(mocks.repo.requeuePreMortemAssessment).not.toHaveBeenCalled();
  });

  it("a deterministic resolve error (guide disabled meanwhile) marks failed WITHOUT throwing", async () => {
    mocks.repo.findFormFillGuide.mockResolvedValue({ guide_markdown: "x", enabled: false, source_file_path: null });

    expect(await executePreMortemJob(PAYLOAD)).toBe("failed");

    expect(mocks.repo.markPreMortemFailed).toHaveBeenCalledWith(ASSESSMENT_ID, expect.any(String));
    expect(mocks.repo.requeuePreMortemAssessment).not.toHaveBeenCalled();
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
  });

  it("post-call persist failure retries in-process then fails — the 700s call is NEVER re-run", async () => {
    mocks.repo.completePreMortemAssessment.mockRejectedValue(new Error("db down"));

    expect(await executePreMortemJob(PAYLOAD)).toBe("failed");

    expect(mocks.anthropicClient.messages.stream).toHaveBeenCalledOnce();
    expect(mocks.repo.completePreMortemAssessment).toHaveBeenCalledTimes(3);
    expect(mocks.repo.markPreMortemFailed).toHaveBeenCalledWith(ASSESSMENT_ID, expect.stringContaining("persist"));
    expect(mocks.repo.requeuePreMortemAssessment).not.toHaveBeenCalled();
  });

  it("persist rowsAffected=0 (row cancelled/failed meanwhile) → 'skipped', spend kept, no failure mark", async () => {
    mocks.repo.completePreMortemAssessment.mockResolvedValue({ rowsAffected: 0 });

    expect(await executePreMortemJob(PAYLOAD)).toBe("skipped");
    expect(mocks.repo.markPreMortemFailed).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// cancel / status / callback / read-path sweep
// ---------------------------------------------------------------------------

describe("cancelPreMortemValidation", () => {
  it("cancels a queued row (guarded update) and reports success", async () => {
    mocks.repo.cancelQueuedPreMortemAssessment.mockResolvedValue(true);

    const res = await cancelPreMortemValidation(ACTOR, ASSESSMENT_ID);
    expect(res.cancelled).toBe(true);
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);
    expect(mocks.repo.cancelQueuedPreMortemAssessment).toHaveBeenCalledWith(ASSESSMENT_ID);
  });

  it("cannot cancel a running row (the call is already in flight and paid)", async () => {
    mocks.repo.findPreMortemAssessmentById.mockResolvedValue({ ...QUEUED_ROW, status: "running" });
    mocks.repo.cancelQueuedPreMortemAssessment.mockResolvedValue(false);

    const res = await cancelPreMortemValidation(ACTOR, ASSESSMENT_ID);
    expect(res.cancelled).toBe(false);
  });
});

describe("getPreMortemStatus", () => {
  it("returns the row status after authorizing against the row's case", async () => {
    mocks.repo.findPreMortemAssessmentById.mockResolvedValue({ ...QUEUED_ROW, status: "running" });

    const res = await getPreMortemStatus(ACTOR, ASSESSMENT_ID);
    expect(res).toEqual({ id: ASSESSMENT_ID, status: "running" });
    expect(mocks.authz.requireCaseAccess).toHaveBeenCalledWith(ACTOR, CASE_ID);
  });

  it("rejects non-staff actors", async () => {
    await expect(getPreMortemStatus(CLIENT_ACTOR, ASSESSMENT_ID)).rejects.toMatchObject({ name: "AuthzError" });
  });
});

describe("markPreMortemFailedByCallback", () => {
  it("delegates to the guarded repo update (job-failed exhaustion path)", async () => {
    await markPreMortemFailedByCallback(ASSESSMENT_ID, "job.run-premortem: exhausted all QStash retries");
    expect(mocks.repo.markPreMortemFailed).toHaveBeenCalledWith(
      ASSESSMENT_ID,
      expect.stringContaining("exhausted"),
    );
  });
});

describe("getPreMortemAssessmentsForCase (async shape + lazy sweep)", () => {
  it("sweeps stale in-flight rows BEFORE listing and exposes status/error in the shape", async () => {
    mocks.repo.listPreMortemAssessmentsForCase.mockResolvedValue([
      { ...QUEUED_ROW, status: "running", started_at: "2026-07-17T11:01:00.000Z" },
      {
        ...QUEUED_ROW,
        id: "66666666-6666-4666-8666-666666666666",
        status: "completed",
        score: 82,
        semaforo: "amber",
        verdict: "would_approve",
      },
    ]);

    const rows = await getPreMortemAssessmentsForCase(ACTOR, CASE_ID);

    expect(mocks.repo.sweepStalePreMortemForCase).toHaveBeenCalledOnce();
    const [caseArg, cutoffs] = mocks.repo.sweepStalePreMortemForCase.mock.calls[0] as [string, Record<string, string>];
    expect(caseArg).toBe(CASE_ID);
    expect(typeof cutoffs.runningBefore).toBe("string");
    expect(typeof cutoffs.queuedBefore).toBe("string");

    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("running");
    expect(rows[1].status).toBe("completed");
    expect(rows[1].verdict).toBe("would_approve");
  });
});
