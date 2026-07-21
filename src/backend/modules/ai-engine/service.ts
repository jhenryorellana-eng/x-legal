/**
 * ai-engine module — service layer (use cases).
 *
 * API-IDs (DOC-42 Endpoints):
 *   API-AI-01  startGeneration         POST /api/v1/cases/[caseId]/generations
 *   API-AI-02  getRunsForCase          GET  /api/v1/cases/[caseId]/generations
 *   API-AI-03  getRunById              GET  /api/v1/generations/[runId]
 *   API-AI-04  cancelGeneration        POST /api/v1/generations/[runId]/cancel
 *   API-AI-05  regenerate              server action aiEngine.regenerate
 *   API-AI-06  retryRunSameVersion     server action aiEngine.retryRunSameVersion
 *   API-AI-07  reprocessExtraction     POST /api/v1/cases/.../documents/.../extraction/reprocess
 *   API-AI-08  translateDocument       POST /api/v1/cases/.../documents/.../translate
 *   API-AI-09  getTranslation          GET  /api/v1/cases/.../documents/.../translation
 *   API-AI-10  getCostsSummary         GET  /api/v1/admin/ai-costs
 *   (internal) executeGenerationJob    called by jobs/run-generation.ts
 *   (internal) executeExtractionJob    called by jobs/extract-document.ts
 *   (internal) executeTranslationJob   called by jobs/translate-document.ts
 *   (internal) markRunFailed           called by jobs/job-failed.ts
 *   (internal) getCostsSummary         called by jobs/ai-budget-aggregation.ts
 *
 * Authorization: can() / requireCaseAccess() ALWAYS first.
 * Single-writer rule: only this module writes to ai_generation_runs,
 *                     document_extractions, document_translations.
 *
 * DOC-42 §3.
 *
 * @module ai-engine/service
 */

import { z } from "zod";
import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { enqueueJob } from "@/backend/platform/qstash";
import { getAnthropicClient, DEFAULT_UI_MODEL } from "@/backend/platform/anthropic";
import { limitAiImprove } from "@/backend/platform/ratelimit";
import { getGeminiModels, DEFAULT_GEMINI_MODEL } from "@/backend/platform/gemini";
import { isAiStubEnabled } from "@/backend/platform/ai-stub";
import {
  createSignedDownloadUrl,
  uploadBytesToStorage,
  downloadBytesFromStorage,
} from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import {
  renderMarkdownToPdf,
  renderMarkdownToDocx,
  renderCertifiedTranslationPdf,
  countPdfPages,
  extractPdfPageRange,
} from "@/backend/platform/pdf";
import { UPLOAD_MAX_FILE_BYTES, UPLOAD_MAX_FILE_MB } from "@/shared/constants/uploads";
import { checkUrlReachable, keepReachable } from "@/backend/platform/url-utils";
import { embedText } from "@/backend/platform/embeddings";
import { DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";
import {
  isFindingCategory,
  isFindingSeverity,
  isSemaforo,
  isVerdict,
  compareFindingSeverity,
  semaforoFromScore,
  FINDING_CATEGORIES_META,
  type FindingCategory,
  type FindingSeverity,
  type Semaforo,
  type Verdict,
} from "@/shared/constants/finding-categories";
import { resolvePeriodRange, type Period } from "@/shared/period";
import { isVerbatimValue } from "@/shared/form-logic/empty-policy";
import { randomUUID } from "node:crypto";
import { parseConditionOrNull } from "@/shared/form-logic/conditions";

import {
  canTransitionRun,
  nextVersion,
  evaluateBudget,
  selectDatasetItems,
  assemblePrompt,
  validateGenerationOutput,
  computeAnthropicCost,
  computeGeminiCost,
  maskPii,
  maskPiiReversible,
  restorePii,
  normalizeANumbersInText,
  validateImprovedText,
  buildWebSearchTool,
  sanitizeDocLabel,
  headTailClip,
  countWords,
  lastWords,
  buildSectionUserMessage,
  buildExpansionUserMessage,
  buildCondenseUserMessage,
  stripLeadingHeading,
  assembleDocument,
  buildAnnexesSection,
  buildCoverPage,
  buildChronologyTable,
  splitChronologyWindows,
  buildResearchContextBlock,
  buildAnalysisPrompt,
  buildCountryConditionsPrompt,
  parseResearchAnalysis,
  parseCountryConditions,
  datasetToJurisprudence,
  datasetToCountry,
  buildJurisprudenceAnalogyPrompt,
  parseAnalogies,
  curateInternalFields,
  sumUsage as _sumUsage,
  type GenerationRequest,
  type ConfigSnapshot,
  type GenerationSectionSpec,
  type SectionedProgress,
  type ResearchBundle,
  type ResolvedInputs,
  type ResearchAnalysis,
  type CountryConditionSource,
  type DatasetItem,
  type SystemBlock,
  // ChunkProgress: used in progress column typing (F4-2). Prefixed to suppress unused warning.
  type ChunkProgress as _ChunkProgress,
  type BudgetCheck,
  type AnthropicUsage,
  type RunContext,
  buildCaseContextBlocks,
  buildQuestionGenContext,
  GENERATION_MULTI_DOC_CHAR_BUDGET,
  QUESTIONNAIRE_FIELD_TYPES,
  type QuestionnaireSchema,
  type GeneratedGroup,
  type GeneratedQuestion,
  type QuestionnaireFieldType,
  questionKeyOf,
  resolveAnswerableFrom,
  type EvidenceRef,
} from "./domain";

import {
  type AnswerProvenance,
  countsAsAnswered,
  parseProvenanceMap,
} from "@/shared/constants/answer-provenance";

import {
  findRunById,
  findActiveRun,
  maxVersion,
  insertRun,
  updateRunStatus,
  completeRun,
  markRunFailed as repoMarkRunFailed,
  isCancelled,
  updateRunProgress,
  patchConfigSnapshot,
  countRunningByOrg,
  listRunsForCase,
  sumMonthlyCosts,
  sumCosts,
  aiCostRows,
  getOrgCostContext,
  type AiCostReportRow,
  findExtraction,
  findPreviousQuestionnaireSchema,
  upsertExtraction,
  updateExtractionDigest,
  findTranslation,
  findTranslationById,
  insertTranslation,
  resetTranslation,
  completeTranslation,
  getCaseDocumentForAi,
  getTranslationSource,
  loadDatasetItems,
  loadResolvedInputs,
  resolveGenerationInputs,
  findGenerationConfig,
  matchDatasetItems,
  listPreMortemAssessmentsForCase,
  insertPreMortemQueued,
  findPreMortemAssessmentById,
  claimPreMortemAssessment,
  requeuePreMortemAssessment,
  cancelQueuedPreMortemAssessment,
  completePreMortemAssessment,
  markPreMortemFailed,
  sweepStalePreMortemForCase,
  sweepStaleRunsForCase,
  findGuideEnabledFormForCase,
  listGuideEnabledFormsForCase,
  listCompletedRunsForForms,
  listFormResponsesForForms,
  findFormFillGuide,
  findLatestEligibleRunForPreMortem,
  findQuestionnaireGenerationConfig,
  findCurrentQuestionnaireInstance,
  findCaseDocumentMeta,
  listCurrentReadyQuestionnaireInstances,
  listAutoQuestionnaireFormsForCase,
  nextQuestionnaireInstanceVersion,
  createQuestionnaireInstance,
  updateQuestionnaireInstance,
  findQuestionnaireInstanceById,
  findSubmittedFormSlugs,
  findFormResponseAnswersMeta,
  listPublishedQuestionTexts,
  listPublishedClientQuestionsForDrafts,
  findQuestionForImprove,
  type QuestionnaireInstanceRow,
  type QuestionnaireGenConfigRow,
  type GenerationRunRow,
  type DocumentExtractionRow as _DocumentExtractionRow,
  type DocumentTranslationRow,
  type PreMortemAssessmentRow as _PreMortemAssessmentRow,
} from "./repository";

import {
  emitGenerationCompleted,
  emitGenerationFailed,
  emitExtractionCompleted,
} from "./events";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class AiEngineError extends Error {
  constructor(
    public readonly code:
      | "AI_CONFIG_NOT_FOUND"
      | "AI_INPUTS_MISSING"
      | "AI_RUN_DUPLICATE"
      | "AI_RUN_NOT_FOUND"
      | "AI_RUN_INVALID_STATE"
      | "AI_PROVIDER_UNAVAILABLE"
      | "AI_OUTPUT_INVALID"
      | "AI_DOCUMENT_TOO_LARGE"
      | "AI_PDF_PAGECOUNT_FAILED"
      | "AI_IMPROVE_NOT_ENABLED"
      | "AI_IMPROVE_RATE_LIMITED"
      | "AI_IMPROVE_TEXT_TOO_LONG"
      | "AI_IMPROVE_OUTPUT_INVALID"
      | "PREMORTEM_NO_ELIGIBLE_RUN"
      | "PREMORTEM_NO_TARGET"
      | "PREMORTEM_NO_GUIDE"
      | "PREMORTEM_IN_PROGRESS"
      | "PREMORTEM_TARGET_REGENERATING",
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "AiEngineError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Documents accepted for AI processing follow the shared upload cap (RNF-016).
const AI_DOCUMENT_MAX_BYTES = UPLOAD_MAX_FILE_BYTES;
// Chunked OCR extraction — large scanned documents (200+ page court records)
// cannot be extracted in one call: the inline request caps around 20MB and the
// full raw_text exceeds any single response. Route threshold + chunk sizing:
const EXTRACTION_CHUNKED_MIN_BYTES = 15 * 1024 * 1024;
const EXTRACTION_CHUNKED_MIN_PAGES = 30;
const EXTRACTION_CHUNK_PAGES = 25;
const EXTRACTION_SOFT_BUDGET_MS = 600_000; // under the 800s QStash webhook maxDuration
const EXTRACTION_MAX_OUTPUT_TOKENS = 65_536;
// Gemini's inline-request payload caps around 20MB. A 25-page range of hi-res
// scans can exceed it (a low-page-count / high-DPI document within the 50MB
// upload cap), so a range whose sub-PDF is larger than this is split by page
// BEFORE the call — the ceiling is never hit and no page is dropped.
const EXTRACTION_INLINE_MAX_BYTES = 18 * 1024 * 1024;
// Digest: a bounded, page-cited summary of a large document, computed once so the
// generation prompt can COVER the middle a head-tail clip would otherwise drop.
// Output cap keeps it well under the smallest generation budget.
const EXTRACTION_DIGEST_MAX_OUTPUT_TOKENS = 8_192;
// Only documents that could actually be clipped downstream (the smallest budget is
// the multi-doc one) get a digest — smaller records are shown to the model whole.
const EXTRACTION_DIGEST_MIN_CHARS = GENERATION_MULTI_DOC_CHAR_BUDGET;
// Above this size a PDF whose pages cannot be counted FAILS LOUD instead of
// degrading to the single-call route (which cannot handle a big scan anyway).
const EXTRACTION_PAGECOUNT_REQUIRED_BYTES = 8 * 1024 * 1024;
// Backoff between provider retry attempts (chunk OCR / fields pass).
const EXTRACTION_RETRY_BACKOFF_MS = [1_000, 4_000];
// Legibility gate — sample the first pages of big PDFs instead of inlining 14MB+
const LEGIBILITY_SAMPLE_MIN_BYTES = 4 * 1024 * 1024;
const LEGIBILITY_SAMPLE_PAGES = 5;
const CONCURRENCY_LIMIT = 2; // max simultaneous T1 runs per org (DOC-74 §2.4)
const MAX_CONCURRENCY_DEFER = 30; // max deferrals before marking stall-failed
const DATASET_BUDGET = parseInt(process.env.AI_DATASET_TOKEN_BUDGET ?? "50000", 10);
const MIN_OUTPUT_CHARS = 800;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const GenerationRequestSchema = z.object({
  caseId: z.string().uuid(),
  formDefinitionId: z.string().uuid(),
  partyId: z.string().uuid().nullable().optional(),
  isTest: z.boolean().optional().default(false),
});

const TranslateDocumentInputSchema = z.object({
  caseId: z.string().uuid(),
  caseDocumentId: z.string().uuid(),
  direction: z.enum(["es-en", "en-es"]),
});

// ---------------------------------------------------------------------------
// Helper: current month UTC string "YYYY-MM"
// ---------------------------------------------------------------------------

function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// Helper: check if a Postgres error is a unique violation
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "23505"
  );
}

// ---------------------------------------------------------------------------
// API-AI-01: startGeneration (DOC-42 §3.1)
// ---------------------------------------------------------------------------

export interface StartGenerationResult {
  run: GenerationRunRow;
  budgetWarning: BudgetCheck | null;
}

/**
 * Creates a new generation run (queued) and enqueues it for async execution.
 *
 * Validates:
 *   - Actor permission: cases:edit
 *   - Case access
 *   - No duplicate active run for (case, form, party)
 *   - Budget check (non-blocking warning)
 *
 * @api-id API-AI-01
 */
export async function startGeneration(
  actor: Actor,
  input: GenerationRequest,
): Promise<StartGenerationResult> {
  can(actor, "cases", "edit");
  // Disparar generaciones de IA (jobs pagados) es función legal — admin+paralegal
  // only. Finance tiene cases:edit para intake, no para esto. Henry 2026-07-20.
  if (actor.role !== "admin" && actor.role !== "paralegal") throw new AuthzError("forbidden_module");
  await requireCaseAccess(actor, input.caseId);
  const p = GenerationRequestSchema.parse(input);

  // is_test only for admin
  if (p.isTest && actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }

  // Duplicate check
  const existing = await findActiveRun(
    p.caseId,
    p.formDefinitionId,
    p.partyId ?? null,
  );
  if (existing) {
    throw new AiEngineError("AI_RUN_DUPLICATE");
  }

  // Budget pre-check (non-blocking)
  const spent = await sumMonthlyCosts(actor.orgId, currentMonthUtc());
  // Get org budget from settings (best effort — no throw if unavailable)
  let budgetUsd: number | null = null;
  try {
    const { createServiceClient } = await import("@/backend/platform/supabase");
    const client = createServiceClient();
    const { data } = await client
      .from("orgs")
      .select("settings")
      .eq("id", actor.orgId)
      .maybeSingle();
    if (data?.settings && typeof data.settings === "object") {
      const s = data.settings as Record<string, unknown>;
      if (typeof s["ai_budget_usd"] === "number") {
        budgetUsd = s["ai_budget_usd"] as number;
      }
    }
  } catch {
    // Non-fatal
  }
  const budgetStatus = evaluateBudget(spent.totalUsd, budgetUsd);

  // Get next version
  const currentMax = await maxVersion(
    p.caseId,
    p.formDefinitionId,
    p.partyId ?? null,
  );
  const version = nextVersion(currentMax);

  // Freeze the real generation config into the run's snapshot (catalog owns
  // editing; ai-engine reads it here). Each run is reproducible from its snapshot.
  const cfg = await findGenerationConfig(p.formDefinitionId);
  // Resolve the config's input form/document slugs to concrete case rows for this
  // case+party, so the companion-questionnaire answers + document extractions
  // actually reach the prompt (DOC-42 §3.1 — was left empty, the core Ola 2 bug).
  const resolvedInputs = await resolveGenerationInputs(
    p.caseId,
    p.partyId ?? null,
    cfg?.input_form_slugs ?? [],
    cfg?.input_document_slugs ?? [],
  );
  const configSnapshot: ConfigSnapshot = {
    system_prompt: cfg?.system_prompt ?? "",
    input_document_slugs: cfg?.input_document_slugs ?? [],
    input_form_slugs: cfg?.input_form_slugs ?? [],
    dataset_id: cfg?.dataset_id ?? null,
    model: cfg?.model ?? DEFAULT_GENERATION_MODEL,
    max_output_tokens: cfg?.max_output_tokens ?? 32000,
    output_format: (cfg?.output_format as ConfigSnapshot["output_format"]) ?? "pdf",
    output_language: (cfg?.output_language as ConfigSnapshot["output_language"]) ?? "es",
    web_search_enabled: cfg?.web_search_enabled ?? false,
    web_search_max_uses: cfg?.web_search_max_uses ?? 5,
    research_instructions: cfg?.research_instructions ?? null,
    research_model: cfg?.research_model ?? null,
    sections: (cfg?.sections as unknown as GenerationSectionSpec[] | undefined) ?? [],
    rules_enabled: cfg?.rules_enabled ?? true,
    rules_text: cfg?.rules_text ?? null,
    assembly: (cfg?.assembly as ConfigSnapshot["assembly"]) ?? null,
    resolved_inputs: resolvedInputs,
    dataset_injection: null,
  };

  let run: GenerationRunRow;
  try {
    run = await insertRun({
      case_id: p.caseId,
      form_definition_id: p.formDefinitionId,
      party_id: p.partyId ?? null,
      status: "queued",
      version,
      is_test: p.isTest ?? false,
      requested_by: actor.userId,
      config_snapshot: configSnapshot as unknown as import("@/shared/database.types").Json,
    });
  } catch (err) {
    // uq_ai_runs_active_target closes the findActiveRun read-then-insert TOCTOU:
    // two concurrent starts both pass the pre-check, only one row wins the index.
    if (isUniqueViolation(err)) {
      throw new AiEngineError("AI_RUN_DUPLICATE");
    }
    throw err;
  }

  await enqueueJob(
    {
      jobKey: "run-generation",
      entityId: run.id,
      attempt: 1,
      dedupeId: `run-generation:${run.id}:v${run.version}`,
      runId: run.id,
      orgId: actor.orgId,
    },
    { retries: 2 },
  );

  await writeAudit(
    actor,
    "ai.generation.started",
    "ai_generation_run",
    run.id,
    { after: { caseId: p.caseId, formDefinitionId: p.formDefinitionId, isTest: p.isTest, version } },
  );

  logger.info(
    {
      job: "startGeneration",
      runId: run.id,
      caseId: p.caseId,
      version,
      budgetStatus,
    },
    "ai-engine: generation run created",
  );

  return {
    run,
    budgetWarning: budgetStatus === "ok" ? null : budgetStatus,
  };
}

// ---------------------------------------------------------------------------
// executeGenerationJob — called by jobs/run-generation.ts (DOC-42 §3.2)
// ---------------------------------------------------------------------------

export type JobOutcome =
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled"
  | "continued"
  | "deferred";

export interface RunGenerationPayload {
  jobKey: "run-generation";
  runId: string;
  entityId: string;
  attempt: number;
  dedupeId: string;
  /** Org of the run — enables the webhook_events idempotency barrier at ingress. */
  orgId: string;
  chunk?: {
    index: number;
    partPaths: string[];
  };
}

/**
 * Executes a generation job (called by run-generation QStash handler).
 *
 * Guards (idempotence):
 *   - Run not found: 2xx no-op
 *   - Already completed/failed: 2xx no-op
 *   - Cancelled: 2xx no-op
 *   - Concurrency: defer up to 30 times
 *
 * @internal
 */
export async function executeGenerationJob(
  payload: RunGenerationPayload,
): Promise<JobOutcome> {
  const run = await findRunById(payload.runId);
  if (!run) {
    logger.warn({ runId: payload.runId }, "run-generation: run not found — skipping");
    return "skipped";
  }

  if (run.status === "completed" || run.status === "failed") return "skipped";
  if (run.status === "cancelled") return "cancelled";

  // Concurrency gate: max 2 T1 running per org
  const concurrentCount = await countRunningByOrg(run.orgId, run.id);
  if (concurrentCount >= CONCURRENCY_LIMIT) {
    const deferAttempt = payload.attempt ?? 1;
    if (deferAttempt >= MAX_CONCURRENCY_DEFER) {
      await repoMarkRunFailed(run.id, "AI_PROVIDER_UNAVAILABLE: concurrency stall after 30 deferrals");
      emitGenerationFailed({
        caseId: run.case_id,
        runId: run.id,
        formDefinitionId: run.form_definition_id,
        partyId: run.party_id,
        version: run.version,
        error: "AI_PROVIDER_UNAVAILABLE: concurrency stall",
        isTest: run.is_test,
      });
      return "failed";
    }
    // Defer: re-enqueue with 60s delay
    await enqueueJob(
      {
        jobKey: "run-generation",
        entityId: run.id,
        attempt: deferAttempt + 1,
        dedupeId: `run-generation:${run.id}:v${run.version}:defer-${deferAttempt}`,
        runId: run.id,
        orgId: run.orgId,
      },
      { delay: 60, retries: 2 },
    );
    return "deferred";
  }

  // Transition queued → running
  if (run.status === "queued") {
    await updateRunStatus(run.id, "running");
  }

  const snapshot = run.config_snapshot as unknown as ConfigSnapshot;

  // Load inputs + dataset
  const inputs = await loadResolvedInputs(snapshot);
  const datasetItems = await loadDatasetItems(snapshot.dataset_id);
  const runContext: RunContext = {};
  // The few-shot reference is precedents + model declarations; country-condition
  // items (meta.kind === "country") are annex feedstock, not style examples — keep
  // them out of the prompt XML (they still feed the country fallback).
  const selected = selectDatasetItems(datasetItems.filter((i) => i.meta?.kind !== "country"), runContext, DATASET_BUDGET);

  // Persist dataset_injection if not already set
  if (!snapshot.dataset_injection && selected.selectedItems.length > 0) {
    await patchConfigSnapshot(run.id, {
      dataset_injection: {
        item_ids: selected.selectedItems.map((i) => i.id),
        total_tokens: selected.totalTokens,
      },
    });
  }

  const prompt = assemblePrompt(snapshot, inputs, selected);

  // Sectioned long-form (v1-grade: research → resumable drafting → court assembly)
  // vs single-pass. Both finalize through finalizeRun.
  const sections = snapshot.sections ?? [];
  if (sections.length > 0) {
    return runSectionedGeneration(run, snapshot, prompt, inputs, sections, datasetItems);
  }
  return runSinglePassGeneration(run, snapshot, prompt);
}

// ---------------------------------------------------------------------------
// Generation engine helpers (Anthropic call, error handling, finalize)
// ---------------------------------------------------------------------------

/** Soft wall-clock budget per job invocation; over it (with sections left) we
 *  checkpoint and self-chain so a 100-page run never exceeds maxDuration. */
const SECTION_SOFT_BUDGET_MS = 150_000;

/** Per-Anthropic-call hard timeout. A streaming call — especially with the native
 *  web_search server tool — can otherwise stall indefinitely (the stream stops
 *  emitting while the server searches). Bounding it under maxDuration means a hung
 *  call aborts and the job retries/resumes from its checkpoint instead of burning
 *  the entire invocation on one stuck request. */
const CALL_TIMEOUT_MS = 240_000;

/** Research timeouts. Analysis / analogy are tool-free and fast. The country
 *  web_search runs minutes, so (a) we defer it to a fresh invocation when the
 *  earlier sub-steps already burned the budget, and (b) we bound it by the
 *  remaining wall-clock so it aborts in time for the DB save inside maxDuration
 *  (300s) — otherwise Vercel kills the process mid-call and forces a QStash retry. */
const RESEARCH_ANALYSIS_TIMEOUT_MS = 120_000;
/** Self-chain BEFORE the country web_search if this much wall-clock is already gone
 *  (leaves ~200s for the ~190s search + the DB save within the 300s budget). */
const RESEARCH_PRE_COUNTRY_BUDGET_MS = 90_000;
/** The country web_search must abort by this wall-clock mark (leaves ~15s headroom
 *  before the 300s hard kill for saveResearch + accounting). */
const MAX_RESEARCH_WALLCLOCK_MS = 285_000;

interface AnthropicCallResult {
  text: string;
  stopReason: string;
  usage: AnthropicUsage;
  model: string;
}

type AnthropicClient = ReturnType<typeof getAnthropicClient>;

/** One Anthropic streaming call → normalized text + usage. Streaming is required
 *  for large outputs and for the native web_search server tool. */
async function callAnthropic(
  client: AnthropicClient,
  args: { model: string; system: SystemBlock[] | string; user: string; maxTokens: number; tools?: ReturnType<typeof buildWebSearchTool>[]; timeoutMs?: number },
): Promise<AnthropicCallResult> {
  const system =
    typeof args.system === "string"
      ? args.system
      : args.system.map((b) => ({
          type: "text" as const,
          text: b.text,
          ...(b.cacheControl ? { cache_control: { type: "ephemeral" as const } } : {}),
        }));
  // Hard wall-clock bound via AbortController. The SDK's `timeout` option does NOT
  // bound a stream that keeps emitting events: with the web_search server tool the
  // stream stays "active" (keep-alives while the server searches) and the timeout
  // never fires, so a slow/stuck search can hang the job for many minutes. An
  // explicit abort timer force-aborts the request regardless of stream activity.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), args.timeoutMs ?? CALL_TIMEOUT_MS);
  let message;
  try {
    const stream = client.messages.stream(
      {
        model: args.model,
        max_tokens: args.maxTokens,
        system,
        messages: [{ role: "user" as const, content: args.user }],
        ...(args.tools ? { tools: args.tools } : {}),
      },
      { timeout: args.timeoutMs ?? CALL_TIMEOUT_MS, maxRetries: 1, signal: ctrl.signal },
    );
    message = await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }
  const usage: AnthropicUsage = {
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
    cacheCreationInputTokens:
      ((message.usage as unknown) as Record<string, number> | null)?.["cache_creation_input_tokens"] ?? 0,
    cacheReadInputTokens:
      ((message.usage as unknown) as Record<string, number> | null)?.["cache_read_input_tokens"] ?? 0,
  };
  const text = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  return { text, stopReason: message.stop_reason ?? "end_turn", usage, model: message.model ?? args.model };
}

function addUsage(a: AnthropicUsage, b: AnthropicUsage): AnthropicUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

/** Maps an Anthropic error to a JobOutcome: non-retryable 4xx → failed (2xx ack),
 *  otherwise re-throws so QStash retries (and the run resumes from its checkpoint). */
async function handleAnthropicError(
  err: unknown,
  run: GenerationRunRow & { orgId: string },
): Promise<JobOutcome> {
  const errMsg = err instanceof Error ? err.message : String(err);
  logger.error({ err, runId: run.id }, "run-generation: Anthropic call failed");
  const isNonRetryable = ["400", "401", "403", "413"].some((c) => errMsg.includes(c));
  if (isNonRetryable) {
    await repoMarkRunFailed(run.id, errMsg);
    emitGenerationFailed({
      caseId: run.case_id,
      runId: run.id,
      formDefinitionId: run.form_definition_id,
      partyId: run.party_id,
      version: run.version,
      error: errMsg,
      isTest: run.is_test,
    });
    return "failed";
  }
  throw err;
}

/** Validates, renders, and atomically completes a run. Shared by both engines. */
async function finalizeRun(args: {
  run: GenerationRunRow & { orgId: string };
  snapshot: ConfigSnapshot;
  outputText: string;
  stopReason: string;
  usage: AnthropicUsage;
  modelUsed: string;
  costUsd: number | null;
}): Promise<JobOutcome> {
  const { run, snapshot, outputText, stopReason, usage, modelUsed, costUsd } = args;

  const validation = validateGenerationOutput(outputText, stopReason, MIN_OUTPUT_CHARS);
  if (!validation.ok) {
    await repoMarkRunFailed(run.id, `AI_OUTPUT_INVALID: ${validation.reason}`);
    emitGenerationFailed({
      caseId: run.case_id,
      runId: run.id,
      formDefinitionId: run.form_definition_id,
      partyId: run.party_id,
      version: run.version,
      error: `AI_OUTPUT_INVALID: ${validation.reason}`,
      isTest: run.is_test,
    });
    return "failed";
  }

  if (await isCancelled(run.id)) return "cancelled";

  let outputPath: string | null = null;
  try {
    outputPath = await renderAndStore(outputText, run, snapshot);
  } catch (renderErr) {
    logger.warn({ err: renderErr, runId: run.id }, "run-generation: render failed — continuing with text only");
  }

  const outputSummary = outputText.slice(0, 400).trim();

  const { rowsAffected } = await completeRun(run.id, {
    outputPath,
    outputText,
    outputSummary,
    model: modelUsed,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    costUsd,
  });

  if (rowsAffected === 0) {
    logger.warn({ runId: run.id }, "run-generation: completeRun affected 0 rows — already closed");
    return "skipped";
  }

  // Awaited (not fire-and-forget): finalizeRun runs in a Vercel invocation frozen on
  // return, so the exhibit-capture + notification consumers must finish before we return.
  await emitGenerationCompleted({
    caseId: run.case_id,
    runId: run.id,
    formDefinitionId: run.form_definition_id,
    partyId: run.party_id,
    version: run.version,
    isTest: run.is_test,
  });
  logger.info(
    { job: "run-generation", runId: run.id, model: modelUsed, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd },
    "run-generation: completed",
  );
  return "completed";
}

/** Single-call generation (no sections): unchanged legacy path. */
async function runSinglePassGeneration(
  run: GenerationRunRow & { orgId: string },
  snapshot: ConfigSnapshot,
  prompt: ReturnType<typeof assemblePrompt>,
): Promise<JobOutcome> {
  const client = getAnthropicClient();
  const model = snapshot.model ?? DEFAULT_GENERATION_MODEL;
  const tools = snapshot.web_search_enabled ? [buildWebSearchTool(snapshot.web_search_max_uses ?? 5, model)] : undefined;
  let res: AnthropicCallResult;
  try {
    res = await callAnthropic(client, {
      model,
      system: prompt.system,
      user: prompt.messages[0]?.content ?? "",
      maxTokens: snapshot.max_output_tokens,
      tools,
    });
  } catch (err) {
    return handleAnthropicError(err, run);
  }
  return finalizeRun({
    run,
    snapshot,
    outputText: res.text,
    stopReason: res.stopReason,
    usage: res.usage,
    modelUsed: res.model,
    costUsd: computeAnthropicCost(res.usage, res.model),
  });
}

/** A section drafted truncated by max_tokens TWICE — never accept a cut-off
 *  filing silently (ola apelación: end of the silent truncation). */
export class SectionTruncatedError extends Error {
  constructor(public readonly sectionKey: string) {
    super(`SECTION_TRUNCATED:${sectionKey}`);
    this.name = "SectionTruncatedError";
  }
}

/**
 * Target-length control for one drafted section (ola apelación):
 *  1. stopReason 'max_tokens' → ONE retry with an explicit concision order;
 *     a second truncation throws SectionTruncatedError (run fails loudly).
 *  2. Below the floor → expansion pass, bounded by the ceiling (accepted only
 *     if it grew, stayed ≤ ceiling×1.15 and did not truncate).
 *  3. Above ceiling×1.15 → ONE condense pass (accepted only if it shrank,
 *     kept the floor and did not truncate).
 * `call` already accounts usage/cost. Exported for unit tests.
 */
export async function enforceSectionLength(args: {
  section: GenerationSectionSpec;
  sectionUserContent: string;
  first: { text: string; stopReason: string };
  call: (user: string) => Promise<{ text: string; stopReason: string }>;
}): Promise<string> {
  const { section: sec, sectionUserContent: secContent } = args;
  const ceiling = sec.max_words ?? 0;
  let res = args.first;

  if (res.stopReason === "max_tokens") {
    const retry = await args.call(
      secContent +
        "\n\nYour previous draft was cut off by the token limit. Rewrite THIS section more concisely so it fits completely" +
        (ceiling > 0 ? ` (hard ceiling: ${ceiling} words)` : "") +
        ". Never end mid-sentence.",
    );
    if (retry.stopReason === "max_tokens") throw new SectionTruncatedError(sec.key);
    res = retry;
  }

  if (sec.min_words > 0 && countWords(res.text) < sec.min_words) {
    const exp = await args.call(
      buildExpansionUserMessage(secContent, res.text, sec.min_words, ceiling > 0 ? ceiling : undefined),
    );
    const grew = countWords(exp.text) > countWords(res.text);
    const withinCeiling = ceiling === 0 || countWords(exp.text) <= ceiling * 1.15;
    if (grew && withinCeiling && exp.stopReason !== "max_tokens") res = exp;
  }

  if (ceiling > 0 && countWords(res.text) > ceiling * 1.15) {
    const cond = await args.call(buildCondenseUserMessage(secContent, res.text, ceiling));
    const shrank = countWords(cond.text) < countWords(res.text);
    const keepsFloor =
      sec.min_words === 0 || countWords(cond.text) >= Math.min(sec.min_words, ceiling) * 0.85;
    if (shrank && keepsFloor && cond.stopReason !== "max_tokens") res = cond;
  }

  return res.text;
}

/** Re-enqueues this run to continue on a fresh invocation (self-chaining). */
async function reEnqueueSelf(run: GenerationRunRow & { orgId: string }, step: number): Promise<void> {
  await enqueueJob(
    {
      jobKey: "run-generation",
      entityId: run.id,
      attempt: 1,
      dedupeId: `run-generation:${run.id}:v${run.version}:chain-${step}`,
      runId: run.id,
      orgId: run.orgId,
    },
    { delay: 1, retries: 2 },
  );
}

/** Best-effort cover metadata pulled from extraction payloads (names are not
 *  PII-masked; A-numbers/case meta stay placeholders the staff completes). */
/**
 * Flattens the case/extraction data into a {{token}} resolution context for the
 * cover page. Carries every string field from the input documents' extraction
 * payloads (so an admin can reference any extracted field by name) plus canonical
 * aliases the default cover rows use (applicant_name, nationality, entry_date,
 * principal_theory). Research analysis fills nationality / principal_theory.
 */
export function deriveCoverContext(inputs: ResolvedInputs, analysis: ResearchAnalysis | null): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const d of inputs.documents) {
    for (const [k, v] of Object.entries(d.extractionPayload ?? {})) {
      if (typeof v === "string" && v.trim()) ctx[k] = v.trim();
    }
  }
  const pick = (...keys: string[]): string | undefined => {
    for (const k of keys) if (ctx[k]?.trim()) return ctx[k].trim();
    return undefined;
  };
  const set = (k: string, v?: string) => { if (v?.trim() && !ctx[k]) ctx[k] = v.trim(); };
  set("applicant_name", pick("full_name", "name", "applicant_name", "nombre_completo", "applicant_full_name", "respondent_full_name"));
  set("entry_date", pick("date_of_entry", "entry_date", "fecha_entrada"));
  set("nationality", pick("nationality", "country", "nacionalidad", "pais") ?? analysis?.nationality ?? undefined);
  set("principal_theory", analysis?.principal_theory ?? undefined);
  return ctx;
}

/**
 * Sectioned, resumable, v1-grade engine: research (analysis + verified
 * jurisprudence + country conditions, ONCE) → per-section drafting with a word
 * floor + chronological windows + continuity tail → court assembly (cover, TOC,
 * chronology, perjury closing). Checkpoints after research and after each section;
 * self-chains when over the soft time budget so it never exceeds maxDuration.
 */
async function runSectionedGeneration(
  run: GenerationRunRow & { orgId: string },
  snapshot: ConfigSnapshot,
  prompt: ReturnType<typeof assemblePrompt>,
  inputs: ResolvedInputs,
  sections: GenerationSectionSpec[],
  datasetItems: DatasetItem[],
): Promise<JobOutcome> {
  const client = getAnthropicClient();
  const startedAt = Date.now();
  const researchModel = snapshot.research_model || snapshot.model || DEFAULT_GENERATION_MODEL;
  const draftDefaultModel = snapshot.model || DEFAULT_GENERATION_MODEL;
  const baseUserContent = prompt.messages[0]?.content ?? "";

  // Restore checkpoint (resume) — parts/tail/usage survive a re-enqueue.
  const prior =
    run.progress && (run.progress as { kind?: string }).kind === "sectioned"
      ? ((run.progress as unknown) as SectionedProgress)
      : null;
  let usage: AnthropicUsage = prior?.usage ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
  let costAccum = prior?.costUsd ?? 0;
  const parts: string[] = prior?.parts ?? [];
  let prevTail = prior?.prevTail ?? "";
  let sectionsDone = prior?.sectionsDone ?? 0;
  let modelUsed = prior?.modelUsed ?? draftDefaultModel;
  // Research sub-step (resume): prefer the explicit checkpoint. The fallback "done"
  // (3) is ONLY for old-format runs — a progress row that predates this field, which
  // always carried complete research. It must NOT fire when there is no progress row
  // at all (prior === null): a first invocation that crashed between the research
  // write and the checkpoint would otherwise be read as complete and skip the
  // still-pending jurisprudence/country sub-steps, yielding a citation-less memo.
  let researchStep = prior?.researchStep ?? (prior !== null && snapshot.research ? 3 : 0);

  const account = (r: AnthropicCallResult) => {
    usage = addUsage(usage, r.usage);
    costAccum += computeAnthropicCost(r.usage, r.model) ?? 0;
    modelUsed = r.model;
  };
  const checkpoint = () =>
    updateRunProgress(run.id, { kind: "sectioned", sectionsDone, parts, prevTail, usage, costUsd: costAccum, modelUsed, researchStep });

  // ── Research phase (resumable per sub-step; persisted incrementally in
  //    config_snapshot.research). researchStep: 1 = analysis, 2 = jurisprudence
  //    (from the CURATED DATASET — reliable case law; open-ended web_search for
  //    precedents hangs or returns nothing), 3 = country conditions (web_search,
  //    which is reliable for news, with the dataset as the fallback). Each sub-step
  //    self-chains over the soft budget so research never blows maxDuration. ──
  let bundle: ResearchBundle = snapshot.research ?? { analysis: null, jurisprudence: [], country_conditions: [] };
  const researchEnabled = (snapshot.web_search_enabled || !!snapshot.dataset_id) ?? false;
  if (researchEnabled && researchStep < 3) {
    // Persist the partial research + advance the sub-step checkpoint. Research is
    // written BEFORE the progress checkpoint: in the sub-millisecond crash window
    // between the two we only lose cost accounting, never the research itself.
    const saveResearch = async (step: number) => {
      researchStep = step;
      await patchConfigSnapshot(run.id, { research: bundle });
      await checkpoint();
    };
    const overBudget = () => Date.now() - startedAt > SECTION_SOFT_BUDGET_MS;

    try {
      // Step 1 — case analysis (tool-free, fast).
      if (researchStep < 1) {
        const ap = buildAnalysisPrompt({ systemPrompt: snapshot.system_prompt, caseContext: baseUserContent });
        const ar = await callAnthropic(client, { model: researchModel, system: ap.system, user: ap.user, maxTokens: 8000, timeoutMs: RESEARCH_ANALYSIS_TIMEOUT_MS });
        account(ar);
        bundle = { ...bundle, analysis: parseResearchAnalysis(ar.text) };
        await saveResearch(1);
        if (overBudget()) { await reEnqueueSelf(run, sectionsDone); return "deferred"; }
      }

      // Step 2 — jurisprudence from the curated dataset (real precedents + holdings),
      // with a per-case factual analogy generated in ONE tool-free call. The citation
      // is always present (the authority) even if a URL is dead/absent.
      if (researchStep < 2) {
        let jurisprudence = datasetToJurisprudence(datasetItems, bundle.analysis, 6);
        if (jurisprudence.length > 0) {
          const anp = buildJurisprudenceAnalogyPrompt({ analysis: bundle.analysis, cases: jurisprudence });
          const anr = await callAnthropic(client, { model: draftDefaultModel, system: anp.system, user: anp.user, maxTokens: 6000, timeoutMs: RESEARCH_ANALYSIS_TIMEOUT_MS });
          account(anr);
          const analogies = parseAnalogies(anr.text, jurisprudence.length);
          jurisprudence = jurisprudence.map((c, i) => ({ ...c, factual_analogy: analogies[i] || c.factual_analogy }));
        }
        jurisprudence = await Promise.all(
          jurisprudence.map(async (c) => (c.url && !(await checkUrlReachable(c.url)).reachable ? { ...c, url: "" } : c)),
        );
        bundle = { ...bundle, jurisprudence };
        await saveResearch(2);
        // Defer the country web_search to a fresh invocation if the budget is already
        // mostly gone — the search needs ~190s and must finish + save within 300s.
        if (Date.now() - startedAt > RESEARCH_PRE_COUNTRY_BUDGET_MS) { await reEnqueueSelf(run, sectionsDone); return "deferred"; }
      }

      // Step 3 — country conditions via web_search (reliable for news; capped to 4
      // searches, wall-clock-bounded). A failure/empty result falls back to the curated
      // dataset country items — never re-throws — so the annexes are never empty.
      if (researchStep < 3) {
        let country: CountryConditionSource[] = [];
        if (snapshot.web_search_enabled) {
          const cp = buildCountryConditionsPrompt({ instructions: snapshot.research_instructions ?? null, analysis: bundle.analysis });
          const tools = [buildWebSearchTool(Math.min(snapshot.web_search_max_uses ?? 3, 3), researchModel)];
          // Bound by the remaining wall-clock so the call aborts in time for saveResearch.
          const searchTimeout = Math.max(60_000, MAX_RESEARCH_WALLCLOCK_MS - (Date.now() - startedAt));
          try {
            const res = await callAnthropic(client, { model: researchModel, system: cp.system, user: cp.user, maxTokens: 12000, tools, timeoutMs: searchTimeout });
            account(res);
            country = await keepReachable(parseCountryConditions(res.text));
          } catch (e) {
            // Fall back to the dataset on ANY error (never fail the run on country).
            // A permanent 4xx (e.g. 400/413 — a structurally broken prompt) is logged at
            // error level so an operator can act; a timeout/5xx is just transient.
            const msg = e instanceof Error ? e.message : String(e);
            const detail = { err: e, runId: run.id };
            if (["400", "413"].some((c) => msg.includes(c))) logger.error(detail, "ai-engine: country web_search permanent error; using dataset fallback");
            else logger.warn(detail, "ai-engine: country web_search timeout/transient; using dataset fallback");
          }
        }
        if (country.length === 0) {
          country = await keepReachable(datasetToCountry(datasetItems));
          if (country.length === 0) logger.warn({ runId: run.id, datasetId: snapshot.dataset_id }, "ai-engine: no country conditions from web_search or dataset");
        }
        bundle = { ...bundle, country_conditions: country };
        await saveResearch(3);
        if (overBudget()) { await reEnqueueSelf(run, sectionsDone); return "deferred"; }
      }
    } catch (err) {
      // Non-retryable 4xx → mark failed; transient/5xx/timeout → re-throw so QStash
      // retries, resuming from the last saved research sub-step (already-saved
      // analysis/jurisprudence are NOT re-run).
      return handleAnthropicError(err, run);
    }
  }

  // ── Drafting (resumable) ──────────────────────────────────────────────────
  const researchBlock = buildResearchContextBlock(bundle);
  const draftBase = researchBlock ? `${baseUserContent}\n\n${researchBlock}` : baseUserContent;
  const windows = bundle.analysis ? splitChronologyWindows(bundle.analysis.chronology) : null;
  const narrativeIdx = new Map<number, number>();
  sections.forEach((s, i) => {
    if (s.type === "narrative") narrativeIdx.set(i, narrativeIdx.size);
  });

  try {
    for (let i = sectionsDone; i < sections.length; i++) {
      if (await isCancelled(run.id)) return "cancelled";
      const sec = sections[i];

      let sectionContext: string | undefined;
      const ni = narrativeIdx.get(i);
      if (ni !== undefined && windows) {
        // Three windows for the canonical I.5/I.6/I.7 split; a 4th+ narrative
        // section (unusual) falls back to the final window.
        const w = ni === 0 ? windows.early : ni === 1 ? windows.middle : windows.final;
        if (w.length) {
          sectionContext = `<chronological_window>\n${buildChronologyTable(w)}\n</chronological_window>\nCover ONLY the events within this window for this section.`;
        }
      }

      const secModel = sec.model || draftDefaultModel;
      const secContent = buildSectionUserMessage(draftBase, sec, prevTail, snapshot.research_instructions, sectionContext);
      const first = await callAnthropic(client, { model: secModel, system: prompt.system, user: secContent, maxTokens: sec.max_tokens });
      account(first);
      const doCall = async (user: string) => {
        const r = await callAnthropic(client, { model: secModel, system: prompt.system, user, maxTokens: sec.max_tokens });
        account(r);
        return r;
      };
      let finalText: string;
      try {
        finalText = await enforceSectionLength({ section: sec, sectionUserContent: secContent, first, call: doCall });
      } catch (err) {
        if (err instanceof SectionTruncatedError) {
          const msg = `${err.message} — la sección quedó truncada por max_tokens dos veces; sube max_tokens de la sección o baja max_words`;
          await repoMarkRunFailed(run.id, msg);
          emitGenerationFailed({
            caseId: run.case_id,
            runId: run.id,
            formDefinitionId: run.form_definition_id,
            partyId: run.party_id,
            version: run.version,
            error: msg,
            isTest: run.is_test,
          });
          return "failed";
        }
        throw err;
      }
      const body = stripLeadingHeading(finalText.trim(), sec.heading);
      // Court documents (hide_heading) print the section body WITHOUT its `## heading`
      // scaffolding — the heading is only the model's writing instruction, not content.
      parts.push(sec.hide_heading ? body : `## ${sec.heading}\n\n${body}`);
      prevTail = lastWords(finalText, 1200);
      sectionsDone = i + 1;
      await checkpoint();

      if (sectionsDone < sections.length && Date.now() - startedAt > SECTION_SOFT_BUDGET_MS) {
        await reEnqueueSelf(run, sectionsDone);
        return "deferred";
      }
    }
  } catch (err) {
    return handleAnthropicError(err, run);
  }

  // ── Court assembly (structure is config-driven; assembleDocument gates each
  //    block, so the extras are built whenever their data exists) ──────────────
  const coverMd = buildCoverPage(snapshot.assembly?.cover_page ?? null, deriveCoverContext(inputs, bundle.analysis));
  const chronoMd =
    bundle.analysis && bundle.analysis.chronology.length ? buildChronologyTable(bundle.analysis.chronology) : undefined;
  const annexesMd = buildAnnexesSection(bundle) || undefined;
  const outputText = assembleDocument(sections, parts, snapshot.assembly ?? null, {
    cover: coverMd,
    chronology: chronoMd,
    annexes: annexesMd,
  });

  return finalizeRun({ run, snapshot, outputText, stopReason: "end_turn", usage, modelUsed, costUsd: costAccum });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

async function renderAndStore(
  outputText: string,
  run: GenerationRunRow & { orgId: string },
  snapshot: ConfigSnapshot,
): Promise<string | null> {
  const fmt = snapshot.output_format ?? "pdf";
  const path = `generated/runs/${run.id}/output.${fmt}`;

  const { createServiceClient } = await import("@/backend/platform/supabase");
  const supabase = createServiceClient();

  if (fmt === "pdf") {
    const bytes = await renderMarkdownToPdf(outputText);
    // Length telemetry (ola apelación): the target-length control is word-based
    // and open-loop — this log closes the loop for HUMANS (calibrate max_words
    // per section against the real page count; ~450 words/page US Letter).
    try {
      const pageCount = await countPdfPages(bytes);
      logger.info(
        { runId: run.id, pageCount, totalWords: countWords(outputText) },
        "run-generation: rendered PDF length",
      );
    } catch { /* telemetry only — never blocks the render */ }
    const { error } = await supabase.storage
      .from("generated")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    return path;
  }

  if (fmt === "docx") {
    const bytes = await renderMarkdownToDocx(outputText);
    const { error } = await supabase.storage
      .from("generated")
      .upload(path, bytes, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
    if (error) throw error;
    return path;
  }

  // md: store raw text (drop the PDF page-break markers — they have no meaning here)
  const mdText = outputText.replace(/\n*<<<PAGEBREAK>>>\n*/g, "\n\n");
  const { error } = await supabase.storage
    .from("generated")
    .upload(path, new TextEncoder().encode(mdText), { contentType: "text/markdown", upsert: true });
  if (error) throw error;
  return path;
}

// ---------------------------------------------------------------------------
// API-AI-04: cancelGeneration (DOC-42 §3.3)
// ---------------------------------------------------------------------------

/**
 * Marks a run as cancelled (best effort).
 * In-flight jobs check this flag before writing output.
 *
 * @api-id API-AI-04
 */
export async function cancelGeneration(
  actor: Actor,
  runId: string,
): Promise<void> {
  can(actor, "cases", "edit");
  // Cancelar generaciones es función legal — admin+paralegal only. Henry 2026-07-20.
  if (actor.role !== "admin" && actor.role !== "paralegal") throw new AuthzError("forbidden_module");
  const run = await findRunById(runId);
  if (!run) throw new AiEngineError("AI_RUN_NOT_FOUND");
  // Cross-tenant guard: findRunById fetches by UUID globally; verify the actor
  // belongs to this run's case before mutating (else org A could cancel org B's run).
  await requireCaseAccess(actor, run.case_id);
  if (!canTransitionRun(run.status as Parameters<typeof canTransitionRun>[0], "cancelled")) {
    throw new AiEngineError("AI_RUN_INVALID_STATE");
  }

  // Conditional WHERE guards the TOCTOU window: only cancel a run still queued/running.
  await updateRunStatus(runId, "cancelled", undefined, ["queued", "running"]);
  await writeAudit(actor, "ai.generation.cancelled", "ai_generation_run", runId, {});
}

// ---------------------------------------------------------------------------
// API-AI-05: regenerate (DOC-42 §3.4)
// ---------------------------------------------------------------------------

/**
 * Creates a new version (regenerate) for a case+form+party.
 * Re-validates all current inputs and config.
 *
 * @api-id API-AI-05
 */
export async function regenerate(
  actor: Actor,
  runId: string,
): Promise<StartGenerationResult> {
  const prev = await findRunById(runId);
  if (!prev) throw new AiEngineError("AI_RUN_NOT_FOUND");
  // Cross-tenant guard (also enforced transitively by startGeneration, made explicit here).
  await requireCaseAccess(actor, prev.case_id);

  return startGeneration(actor, {
    caseId: prev.case_id,
    formDefinitionId: prev.form_definition_id,
    partyId: prev.party_id,
    isTest: prev.is_test,
  });
}

// ---------------------------------------------------------------------------
// retryRunSameVersion — admin-only manual retry (DOC-26 §5.3)
// ---------------------------------------------------------------------------

/**
 * Resets a failed run to queued and re-enqueues with attempt+1.
 * Only admin can use this (DOC-26 §5.3).
 *
 * @api-id API-AI-06
 */
export async function retryRunSameVersion(
  actor: Actor,
  runId: string,
): Promise<void> {
  if (actor.role !== "admin") throw new AuthzError("forbidden_module");

  const run = await findRunById(runId);
  if (!run) throw new AiEngineError("AI_RUN_NOT_FOUND");
  // Cross-tenant guard: an admin is org-scoped — verify the run's case is in their org.
  await requireCaseAccess(actor, run.case_id);
  if (!canTransitionRun(run.status as Parameters<typeof canTransitionRun>[0], "queued")) {
    throw new AiEngineError("AI_RUN_INVALID_STATE");
  }

  const attempt = (run as unknown as Record<string, number>)["attempt"] ?? 1;
  await updateRunStatus(runId, "queued", { error: null });
  await enqueueJob(
    {
      jobKey: "run-generation",
      entityId: run.id,
      attempt: attempt + 1,
      dedupeId: `run-generation:${run.id}:v${run.version}:retry-${attempt}`,
      runId: run.id,
      orgId: actor.orgId,
    },
    { retries: 2 },
  );

  await writeAudit(actor, "job.run-generation.manual_retry", "ai_generation_run", runId, {
    after: { attempt: attempt + 1 },
  });
}

// ---------------------------------------------------------------------------
// markRunFailed — called by job-failed callback (DOC-42 §3.5)
// ---------------------------------------------------------------------------

/**
 * Marks a run as failed. Called by jobs/job-failed.ts on QStash retry exhaustion.
 * Idempotent: does not overwrite already-terminal states.
 */
export async function markRunFailedByCallback(
  runId: string,
  errorMsg: string,
): Promise<void> {
  const run = await findRunById(runId);
  if (!run) return; // already gone or unknown

  await repoMarkRunFailed(runId, errorMsg);

  emitGenerationFailed({
    caseId: run.case_id,
    runId: run.id,
    formDefinitionId: run.form_definition_id,
    partyId: run.party_id,
    version: run.version,
    error: errorMsg,
    isTest: run.is_test,
  });
}

// ---------------------------------------------------------------------------
// executeExtractionJob — called by jobs/extract-document.ts (DOC-42 §3.6)
// ---------------------------------------------------------------------------

export interface ExtractDocumentPayload {
  jobKey: "extract-document";
  entityId: string;
  attempt: number;
  dedupeId: string;
  caseDocumentId: string;
}

/**
 * Executes document extraction via Gemini multimodal.
 *
 * Idempotence: if extraction already completed, returns 'skipped'.
 * Validation: Ajv against extraction_schema with 1 retry.
 *
 * @internal
 */
export async function executeExtractionJob(
  payload: ExtractDocumentPayload,
): Promise<JobOutcome> {
  // Cache/idempotence: skip if already completed
  const existing = await findExtraction(payload.caseDocumentId);
  if (existing?.status === "completed") return "skipped";

  const doc = await getCaseDocumentForAi(payload.caseDocumentId);
  if (!doc) {
    logger.warn({ caseDocumentId: payload.caseDocumentId }, "extract-document: document not found — skipping");
    return "skipped";
  }

  const rdt = doc.requiredDocumentType;
  if (!rdt?.aiExtract || !rdt?.extractionSchema) {
    logger.info(
      { caseDocumentId: payload.caseDocumentId },
      "extract-document: ai_extract=false or no schema — skipping",
    );
    return "skipped";
  }

  // Size limit — the shared upload cap (RNF-016); pages are handled by chunking.
  if (doc.sizeBytes > AI_DOCUMENT_MAX_BYTES) {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "failed",
      model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      error: `AI_DOCUMENT_TOO_LARGE: file ${Math.round(doc.sizeBytes / 1024 / 1024)}MB exceeds ${UPLOAD_MAX_FILE_MB}MB limit`,
    });
    return "failed";
  }

  // Mark pending
  await upsertExtraction({
    case_document_id: doc.id,
    status: "pending",
    model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
  });

  // Fetch document for Gemini
  const { createServiceClient } = await import("@/backend/platform/supabase");
  const supabase = createServiceClient();
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("case-documents")
    .download(doc.storagePath);

  if (dlErr || !fileData) {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "failed",
      model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      error: `Storage download failed: ${dlErr?.message}`,
    });
    return "failed";
  }

  const fileBytes = new Uint8Array(await fileData.arrayBuffer());
  const fileBase64 = Buffer.from(fileBytes).toString("base64");

  // Guard: `raw_text` is a reserved injected field. If the configured
  // extraction_schema already declares it, our injection would silently
  // overwrite it (and corrupt the extracted payload). Fail loudly instead.
  // (The catalog editor should also validate this, but defend at runtime.)
  const baseSchema = (rdt.extractionSchema ?? {}) as Record<string, unknown>;
  const baseProps =
    (baseSchema.properties as Record<string, unknown> | undefined) ?? baseSchema;
  if (baseProps && typeof baseProps === "object" && "raw_text" in baseProps) {
    throw new AiEngineError("AI_CONFIG_NOT_FOUND", {
      reason: "extraction_schema declares the reserved field name 'raw_text'",
    });
  }

  // Build schema with raw_text field injected (DOC-42 §3.6 / DOC-74 §3.4).
  // The stored extraction_schema is a full JSON Schema ({ type, properties, required }).
  // `baseProps` above already normalises both shapes (full schema vs bare property map),
  // so we merge raw_text into the property map — NOT the whole schema object.
  const baseRequired = Array.isArray((baseSchema as { required?: unknown }).required)
    ? ((baseSchema as { required?: string[] }).required as string[])
    : [];
  const extractionSchemaWithRawText = {
    type: "object",
    properties: {
      ...baseProps,
      raw_text: { type: "string", description: "Full plain text of the document" },
    },
    required: [...baseRequired, "raw_text"],
  };

  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const geminiModels = getGeminiModels();

  // Route: large scanned PDFs go through the chunked OCR pipeline (page-range
  // sub-PDFs + checkpointed progress + one final fields pass). Small documents
  // keep the single multimodal call below, byte-identical except for the raised
  // output budget (medium documents used to truncate raw_text at 8192 tokens).
  let pageCount = 1;
  if (doc.mimeType === "application/pdf") {
    try {
      pageCount = await countPdfPages(fileBytes);
    } catch (err) {
      // One retry — mupdf WASM init can hiccup transiently.
      try {
        pageCount = await countPdfPages(fileBytes);
      } catch {
        // A LARGE pdf without a page count must not degrade to the single-call
        // route: a 200-page scan would blow the inline/output limits and fail
        // 9 minutes in with nothing to show. Fail loud instead (QStash retries;
        // if mupdf truly can't open it, extraction is impossible anyway since
        // the chunked route needs page-range splits).
        if (fileBytes.length > EXTRACTION_PAGECOUNT_REQUIRED_BYTES) {
          throw new AiEngineError("AI_PDF_PAGECOUNT_FAILED", {
            caseDocumentId: doc.id,
            sizeBytes: fileBytes.length,
          });
        }
        logger.warn({ err, caseDocumentId: doc.id }, "extract-document: countPdfPages failed twice — small file, single-call route");
      }
    }
  }
  if (
    doc.mimeType === "application/pdf" &&
    (fileBytes.length > EXTRACTION_CHUNKED_MIN_BYTES || pageCount > EXTRACTION_CHUNKED_MIN_PAGES)
  ) {
    return runChunkedExtraction({
      doc,
      fileBytes,
      pageCount,
      existingProgress: existing?.progress ?? null,
      baseProps: baseProps as Record<string, unknown>,
      baseRequired,
      model,
    });
  }

  let extractionResult: Record<string, unknown> | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let ajvErrors: string | null = null;

  // Two attempts: initial + 1 retry with feedback (DOC-74 §6.4)
  for (let attempt = 0; attempt < 2; attempt++) {
    const feedbackPrompt =
      attempt > 0 && ajvErrors
        ? `\n\nCORRECTION REQUIRED: The previous response had validation errors. Fix exactly these issues:\n${ajvErrors}`
        : "";

    try {
      const response = await geminiModels.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: doc.mimeType,
                  data: fileBase64,
                },
              },
              {
                text: `Extract all information from this document and return a JSON object matching the provided schema.${feedbackPrompt}`,
              },
            ],
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: extractionSchemaWithRawText,
        },
      });

      const text =
        response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      try {
        extractionResult = JSON.parse(text) as Record<string, unknown>;
      } catch {
        ajvErrors = "Response was not valid JSON";
        continue;
      }

      // Validate against schema (simplified — full Ajv validation in prod).
      // `baseRequired` is the normalised required-field list from the stored schema.
      const missingRequired = baseRequired.filter(
        (key) => extractionResult && !(key in extractionResult),
      );
      if (missingRequired.length > 0) {
        ajvErrors = `Missing required fields: ${missingRequired.join(", ")}`;
        extractionResult = null;
        continue;
      }

      ajvErrors = null;
      break;
    } catch (err) {
      logger.error({ err, attempt, caseDocumentId: doc.id }, "extract-document: Gemini call failed");
      if (attempt === 1) {
        await upsertExtraction({
          case_document_id: doc.id,
          status: "failed",
          model,
          error: err instanceof Error ? err.message : String(err),
        });
        return "failed";
      }
    }
  }

  if (!extractionResult || ajvErrors) {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "failed",
      model,
      error: `AI_OUTPUT_INVALID: ${ajvErrors}`,
    });
    return "failed";
  }

  const rawText = typeof extractionResult["raw_text"] === "string"
    ? (extractionResult["raw_text"] as string)
    : "";
  const { raw_text: _rawText, ...extractionPayload } = extractionResult;

  const costUsd = computeGeminiCost({ inputTokens, outputTokens });

  await upsertExtraction({
    case_document_id: doc.id,
    status: "completed",
    payload: extractionPayload as import("@/shared/database.types").Json,
    raw_text: rawText,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    completed_at: new Date().toISOString(),
    error: null,
  });

  await emitExtractionCompleted({ caseId: doc.caseId, caseDocumentId: doc.id });

  logger.info(
    {
      job: "extract-document",
      caseDocumentId: doc.id,
      model,
      inputTokens,
      outputTokens,
      costUsd,
    },
    "extract-document: completed",
  );

  return "completed";
}

// ---------------------------------------------------------------------------
// Chunked OCR extraction — large scanned documents
// ---------------------------------------------------------------------------

interface ChunkedExtractionProgress {
  kind: "chunked";
  page_count: number;
  chunk_pages: number;
  parts: Record<string, string>;
  usage: { input_tokens: number; output_tokens: number };
}

/** Backoff between provider retry attempts (attempt 1 → 1s, attempt 2 → 4s).
 *  No-op under Vitest so retry-exhaustion tests don't wall-clock the sleeps. */
async function sleepBackoff(attempt: number): Promise<void> {
  if (process.env.VITEST) return;
  const ms = EXTRACTION_RETRY_BACKOFF_MS[Math.min(attempt - 1, EXTRACTION_RETRY_BACKOFF_MS.length - 1)];
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Human-facing progress of an in-flight extraction, derived from the chunked
 *  checkpoint. `null` when there is no checkpoint (short doc, or not started).
 *  0–90% maps to OCR'd pages; the final fields pass owns 90–100. Consumed by
 *  cases.getDocumentExtractionStatus → the client's "Leyendo página X de Y". */
export interface ExtractionProgressSummary {
  pagesDone: number;
  pagesTotal: number;
  pct: number;
}

/**
 * Reads the chunked checkpoint of a document extraction and summarizes it for
 * UI polling. Owns the `progress` jsonb shape (module-internal) so consumers
 * never parse it themselves.
 */
export async function getExtractionProgressSummary(
  caseDocumentId: string,
): Promise<ExtractionProgressSummary | null> {
  const row = await findExtraction(caseDocumentId);
  const p = (row as { progress?: unknown } | null)?.progress as
    | Partial<ChunkedExtractionProgress>
    | null
    | undefined;
  if (!p || p.kind !== "chunked" || !p.parts || typeof p.parts !== "object" || !p.page_count) {
    return null;
  }
  const chunkPages = p.chunk_pages ?? EXTRACTION_CHUNK_PAGES;
  const pagesTotal = p.page_count;
  const pagesDone = Math.min(Object.keys(p.parts).length * chunkPages, pagesTotal);
  const pct = Math.round((pagesDone / pagesTotal) * 90);
  return { pagesDone, pagesTotal, pct };
}

/** Loads a checkpoint if it matches the current chunking geometry; else starts fresh. */
function parseChunkedProgress(value: unknown, pageCount: number): ChunkedExtractionProgress {
  const p = value as Partial<ChunkedExtractionProgress> | null;
  if (
    p &&
    p.kind === "chunked" &&
    p.page_count === pageCount &&
    p.chunk_pages === EXTRACTION_CHUNK_PAGES &&
    p.parts &&
    typeof p.parts === "object"
  ) {
    return {
      kind: "chunked",
      page_count: pageCount,
      chunk_pages: EXTRACTION_CHUNK_PAGES,
      parts: { ...p.parts },
      usage: {
        input_tokens: p.usage?.input_tokens ?? 0,
        output_tokens: p.usage?.output_tokens ?? 0,
      },
    };
  }
  return {
    kind: "chunked",
    page_count: pageCount,
    chunk_pages: EXTRACTION_CHUNK_PAGES,
    parts: {},
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * OCR-first pipeline for large PDFs:
 *  1. Split into page-range sub-PDFs (mupdf) of EXTRACTION_CHUNK_PAGES pages.
 *  2. OCR each chunk with a plain-text call (no JSON schema — less truncable),
 *     checkpointing every chunk in `document_extractions.progress` so QStash
 *     retries / self-chained invocations resume at the first missing index and
 *     never re-pay a completed chunk.
 *  3. Self-chain to a fresh invocation when over the soft wall-clock budget.
 *  4. One final text-only fields pass over the assembled raw_text (the full
 *     document view matters for synthesis fields like persecution_summary).
 */
const DIGEST_PROMPT =
  "Eres un paralegal que resume un documento legal para un abogado. Produce un RESUMEN FIEL y " +
  "estructurado en español que cubra TODAS las secciones del documento (para que no se pierda nada), " +
  "CON citas de rango de página (el texto trae marcadores `=== Pages N-M ===` — cítalos). Incluye " +
  "hechos clave, nombres, fechas, afirmaciones y citas textuales BREVES de las declaraciones críticas. " +
  "NO inventes ni infieras nada que no esté en el texto: si algo no consta, no lo menciones. Sé conciso " +
  "pero COMPLETO en cobertura. Devuelve solo texto plano, sin comentarios ni encabezados de respuesta.";

/**
 * Builds a bounded, page-cited digest of the assembled OCR text via a single
 * faithful (temperature 0) Gemini call. BEST-EFFORT: any failure returns null so
 * it never blocks or fails an extraction — the digest is optional and generation
 * falls back to the head-tail clip when it is absent. One call over the full
 * raw_text (Gemini's context easily holds a 200+ page record) — cheaper and
 * simpler than a per-chunk map-reduce, and it sees the document whole.
 */
async function buildDocumentDigest(args: {
  rawText: string;
  model: string;
  geminiModels: ReturnType<typeof getGeminiModels>;
  caseDocumentId: string;
}): Promise<{ digestText: string; inputTokens: number; outputTokens: number } | null> {
  try {
    const response = await args.geminiModels.generateContent({
      model: args.model,
      contents: [
        { role: "user", parts: [{ text: `${DIGEST_PROMPT}\n\nDOCUMENTO (OCR):\n\n${args.rawText}` }] },
      ],
      config: { temperature: 0, maxOutputTokens: EXTRACTION_DIGEST_MAX_OUTPUT_TOKENS },
    });
    const digestText = (response.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
    if (!digestText) return null;
    return {
      digestText,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    };
  } catch (err) {
    logger.warn(
      { err, caseDocumentId: args.caseDocumentId },
      "extract-document: digest generation failed (optional — falling back to clip)",
    );
    return null;
  }
}

/**
 * OCRs a [startPage, endPage) page range to plain text via Gemini vision. A
 * response truncated at the output-token ceiling (finishReason "MAX_TOKENS")
 * would silently drop the tail of a dense range, so the range is BISECTED and
 * each half re-OCR'd (recursively) — each half fits the budget. A single page
 * that still truncates is degenerate (no real page exceeds 65k output tokens):
 * keep what came back and warn, never lose it silently. Transient errors and
 * empty transcriptions retry (3×). Throws only when a range exhausts its
 * retries — the caller fails the chunk with its page numbers. `usage`
 * accumulates provider tokens across every sub-call so cost stays honest
 * (RNF-041) even when a range is subdivided.
 */
async function ocrPageRangeText(args: {
  fileBytes: Uint8Array;
  startPage: number;
  endPage: number;
  model: string;
  geminiModels: ReturnType<typeof getGeminiModels>;
  usage: { input_tokens: number; output_tokens: number };
  caseDocumentId: string;
}): Promise<string> {
  const { fileBytes, startPage, endPage, model, geminiModels, usage, caseDocumentId } = args;
  const chunkBytes = await extractPdfPageRange(fileBytes, startPage, endPage);

  // Split by page BEFORE the call if the sub-PDF is too big for an inline request
  // (hi-res scans): each half is re-OCR'd and joined, so the ~20MB ceiling is
  // never hit. A single page that still exceeds it is degenerate — fall through
  // and let the call surface a real error rather than fail silently.
  if (chunkBytes.length > EXTRACTION_INLINE_MAX_BYTES && endPage - startPage > 1) {
    const mid = startPage + Math.floor((endPage - startPage) / 2);
    const left = await ocrPageRangeText({ ...args, startPage, endPage: mid });
    const right = await ocrPageRangeText({ ...args, startPage: mid, endPage });
    return `${left}\n${right}`;
  }
  const chunkBase64 = Buffer.from(chunkBytes).toString("base64");

  let lastErr: unknown = null;
  // 3 attempts with backoff (1s, 4s): a 429/5xx or an empty transcription on ONE
  // range must not burn the run — the caller's checkpoint keeps every paid chunk.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleepBackoff(attempt);
    try {
      const response = await geminiModels.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "application/pdf", data: chunkBase64 } },
              {
                text:
                  "Transcribe the complete text of this document segment, in reading order. " +
                  "Output plain text only — no summaries, no commentary, no markdown fences. " +
                  "Preserve headings and paragraph breaks.",
              },
            ],
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          responseMimeType: "text/plain",
        },
      });
      usage.input_tokens += response.usageMetadata?.promptTokenCount ?? 0;
      usage.output_tokens += response.usageMetadata?.candidatesTokenCount ?? 0;
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const finishReason = response.candidates?.[0]?.finishReason ?? null;

      // Truncated at the token ceiling — the tail of this range is missing. Bisect
      // and re-OCR each half (each fits the budget) rather than accept the cut.
      if (finishReason === "MAX_TOKENS" && endPage - startPage > 1) {
        const mid = startPage + Math.floor((endPage - startPage) / 2);
        const left = await ocrPageRangeText({ ...args, startPage, endPage: mid });
        const right = await ocrPageRangeText({ ...args, startPage: mid, endPage });
        return `${left}\n${right}`;
      }
      if (finishReason === "MAX_TOKENS") {
        logger.warn(
          { caseDocumentId, page: startPage + 1 },
          "extract-document: single-page OCR truncated at the token ceiling — kept partial text",
        );
        return text;
      }

      // An empty transcription of a whole range is suspicious (transient/refusal):
      // retry. A genuinely blank page returns "" and, after retries, is accepted.
      if (text.trim() === "" && attempt < 2) {
        lastErr = new Error("empty OCR transcription");
        continue;
      }
      return text;
    } catch (err) {
      lastErr = err;
      logger.warn(
        { err, attempt, startPage, endPage, caseDocumentId },
        "extract-document: chunk OCR call failed",
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function runChunkedExtraction(args: {
  doc: { id: string; caseId: string; mimeType: string };
  fileBytes: Uint8Array;
  pageCount: number;
  existingProgress: unknown;
  baseProps: Record<string, unknown>;
  baseRequired: string[];
  model: string;
}): Promise<JobOutcome> {
  const { doc, fileBytes, pageCount, baseProps, baseRequired, model } = args;
  const geminiModels = getGeminiModels();
  const chunkCount = Math.ceil(pageCount / EXTRACTION_CHUNK_PAGES);
  const progress = parseChunkedProgress(args.existingProgress, pageCount);
  const start = Date.now();

  const persistCheckpoint = async () => {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "pending",
      model,
      progress: progress as unknown as import("@/shared/database.types").Json,
    });
  };

  for (let i = 0; i < chunkCount; i++) {
    if (progress.parts[String(i)] !== undefined) continue;

    const startPage = i * EXTRACTION_CHUNK_PAGES;
    const endPage = Math.min(startPage + EXTRACTION_CHUNK_PAGES, pageCount);

    // OCR the 25-page range. A range whose transcription hits the token ceiling
    // is bisected inside the helper (never silently truncated); transient
    // failures/empty responses retry there. A range that exhausts its retries
    // throws — fail the chunk with its page numbers (the checkpoint keeps the
    // paid chunks so a QStash retry resumes).
    let ocrText: string;
    try {
      ocrText = await ocrPageRangeText({
        fileBytes,
        startPage,
        endPage,
        model,
        geminiModels,
        usage: progress.usage,
        caseDocumentId: doc.id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await upsertExtraction({
        case_document_id: doc.id,
        status: "failed",
        model,
        error: `AI_OCR_CHUNK_FAILED: chunk ${i} (pages ${startPage + 1}-${endPage}): ${msg}`,
        progress: progress as unknown as import("@/shared/database.types").Json,
      });
      return "failed";
    }

    progress.parts[String(i)] = ocrText;
    await persistCheckpoint();

    const remaining = chunkCount - Object.keys(progress.parts).length;
    if (remaining > 0 && Date.now() - start > EXTRACTION_SOFT_BUDGET_MS) {
      const done = Object.keys(progress.parts).length;
      await enqueueJob(
        {
          jobKey: "extract-document",
          entityId: doc.id,
          attempt: 1,
          dedupeId: `extract-document:${doc.id}:chain-${done}`,
          caseDocumentId: doc.id,
        },
        { delay: 1, retries: 2 },
      );
      logger.info(
        { caseDocumentId: doc.id, done, remaining },
        "extract-document: soft budget hit — self-chained to a fresh invocation",
      );
      return "deferred";
    }
  }

  // Assemble the full raw_text in chunk order with page-range markers (the
  // `=== Page N ===` convention of extractPdfText, at chunk granularity).
  const rawText = Array.from({ length: chunkCount }, (_, i) => {
    const s = i * EXTRACTION_CHUNK_PAGES + 1;
    const e = Math.min((i + 1) * EXTRACTION_CHUNK_PAGES, pageCount);
    return `=== Pages ${s}-${e} ===\n${progress.parts[String(i)] ?? ""}`;
  }).join("\n\n");

  // Fields pass — text-only over the assembled OCR, WITHOUT the raw_text field
  // (we already have it). 3-attempt validation loop with backoff. Output budget
  // matches the OCR calls (the old 8192 cap silently truncated the JSON of
  // large schemas over a 200+ page record → AI_OUTPUT_INVALID after 9 paid
  // minutes; responseSchema output can be verbose).
  const fieldsSchema = { type: "object", properties: baseProps, required: baseRequired };
  let extractionResult: Record<string, unknown> | null = null;
  let ajvErrors: string | null = null;
  let fieldsIn = 0;
  let fieldsOut = 0;
  const FIELDS_ATTEMPTS = 3;

  for (let attempt = 0; attempt < FIELDS_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleepBackoff(attempt);
    const feedbackPrompt =
      attempt > 0 && ajvErrors
        ? `\n\nCORRECTION REQUIRED: The previous response had validation errors. Fix exactly these issues:\n${ajvErrors}`
        : "";
    try {
      const response = await geminiModels.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  `Extract all information from this document text and return a JSON object matching the provided schema.${feedbackPrompt}` +
                  `\n\nDOCUMENT TEXT (OCR):\n\n${rawText}`,
              },
            ],
          },
        ],
        config: {
          temperature: 0,
          maxOutputTokens: EXTRACTION_MAX_OUTPUT_TOKENS,
          responseMimeType: "application/json",
          responseSchema: fieldsSchema,
        },
      });
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      fieldsIn += response.usageMetadata?.promptTokenCount ?? 0;
      fieldsOut += response.usageMetadata?.candidatesTokenCount ?? 0;

      // Truncation guard: a response cut at the token ceiling parses as invalid
      // JSON below, but detect it explicitly so the retry feedback is precise.
      const finishReason = response.candidates?.[0]?.finishReason ?? null;
      if (finishReason === "MAX_TOKENS") {
        ajvErrors = "Response was truncated (hit the output-token ceiling). Return ONLY the JSON object, as compact as possible.";
        extractionResult = null;
        continue;
      }

      try {
        extractionResult = JSON.parse(text) as Record<string, unknown>;
      } catch {
        ajvErrors = "Response was not valid JSON";
        continue;
      }
      const missingRequired = baseRequired.filter(
        (key) => extractionResult && !(key in extractionResult),
      );
      if (missingRequired.length > 0) {
        ajvErrors = `Missing required fields: ${missingRequired.join(", ")}`;
        extractionResult = null;
        continue;
      }
      ajvErrors = null;
      break;
    } catch (err) {
      logger.error({ err, attempt, caseDocumentId: doc.id }, "extract-document: fields pass failed");
      if (attempt === FIELDS_ATTEMPTS - 1) {
        // Keep the checkpoint — the paid OCR survives for a reprocess.
        await upsertExtraction({
          case_document_id: doc.id,
          status: "failed",
          model,
          error: err instanceof Error ? err.message : String(err),
          progress: progress as unknown as import("@/shared/database.types").Json,
        });
        return "failed";
      }
    }
  }

  if (!extractionResult || ajvErrors) {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "failed",
      model,
      error: `AI_OUTPUT_INVALID: ${ajvErrors}`,
      progress: progress as unknown as import("@/shared/database.types").Json,
    });
    return "failed";
  }

  // Digest (best-effort): only for a record large enough to be clipped downstream.
  // Covers the middle a head-tail clip would drop, so the questionnaire/brief
  // generator sees every section. Never blocks completion — a failure returns null.
  let digestText: string | null = null;
  let digestIn = 0;
  let digestOut = 0;
  if (rawText.length > EXTRACTION_DIGEST_MIN_CHARS) {
    const digest = await buildDocumentDigest({ rawText, model, geminiModels, caseDocumentId: doc.id });
    if (digest) {
      digestText = digest.digestText;
      digestIn = digest.inputTokens;
      digestOut = digest.outputTokens;
    }
  }

  const inputTokens = progress.usage.input_tokens + fieldsIn + digestIn;
  const outputTokens = progress.usage.output_tokens + fieldsOut + digestOut;
  const costUsd = computeGeminiCost({ inputTokens, outputTokens });

  await upsertExtraction({
    case_document_id: doc.id,
    status: "completed",
    payload: extractionResult as import("@/shared/database.types").Json,
    raw_text: rawText,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    completed_at: new Date().toISOString(),
    error: null,
    progress: null,
  });

  // Persist the digest separately (best-effort): a missing column pre-migration
  // is logged, never thrown — the completed extraction above already stands.
  if (digestText) await updateExtractionDigest(doc.id, digestText);

  await emitExtractionCompleted({ caseId: doc.caseId, caseDocumentId: doc.id });

  logger.info(
    {
      job: "extract-document",
      caseDocumentId: doc.id,
      route: "chunked",
      pageCount,
      chunkCount,
      rawTextLength: rawText.length,
      model,
      inputTokens,
      outputTokens,
      costUsd,
    },
    "extract-document: chunked extraction completed",
  );

  return "completed";
}

// ---------------------------------------------------------------------------
// markExtractionFailed — job-failed callback
// ---------------------------------------------------------------------------

export async function markExtractionFailed(
  caseDocumentId: string,
  errorMsg: string,
): Promise<void> {
  await upsertExtraction({
    case_document_id: caseDocumentId,
    status: "failed",
    model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    error: errorMsg,
  });
}

// ---------------------------------------------------------------------------
// reprocessExtraction — RF-DIA-012 A2
// ---------------------------------------------------------------------------

/**
 * Resets an extraction to pending and re-enqueues for re-processing.
 *
 * @api-id API-AI-07
 */
export async function reprocessExtraction(
  actor: Actor,
  caseDocumentId: string,
): Promise<void> {
  can(actor, "cases", "edit");
  // Reprocesar extracción es función legal — admin+paralegal only. Henry 2026-07-20.
  if (actor.role !== "admin" && actor.role !== "paralegal") throw new AuthzError("forbidden_module");
  const existing = await findExtraction(caseDocumentId);
  const n = existing ? ((existing as unknown as Record<string, number>)["attempt"] ?? 0) + 1 : 1;

  await upsertExtraction({
    case_document_id: caseDocumentId,
    status: "pending",
    model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
    error: null,
  });

  await enqueueJob(
    {
      jobKey: "extract-document",
      entityId: caseDocumentId,
      attempt: n,
      dedupeId: `extract-document:${caseDocumentId}:retry-${n}`,
      caseDocumentId,
      orgId: actor.orgId,
    },
    { retries: 3 },
  );

  await writeAudit(actor, "ai.extraction.reprocessed", "document_extraction", caseDocumentId, {});
}

// ---------------------------------------------------------------------------
// translateDocument — API-AI-08 (DOC-42 §3.7)
// ---------------------------------------------------------------------------

export interface TranslateDocumentResult {
  translation: DocumentTranslationRow;
  cached: boolean;
}

/**
 * Requests document translation with structural cache (UNIQUE case_document_id + direction).
 * Uses mutex-by-INSERT for concurrent requests (DOC-42 §3.7).
 *
 * @api-id API-AI-08
 */
/**
 * A `document_translations` row stuck in `processing` longer than this is treated
 * as a dead job (worker killed / enqueue lost) and becomes retryable. Generous
 * relative to the job's maxDuration (300s) + retries so a legitimately in-flight
 * translation is never pre-empted.
 */
const STALE_TRANSLATION_MS = 15 * 60 * 1000;

export async function translateDocument(
  actor: Actor,
  input: { caseId: string; caseDocumentId: string; direction: "es-en" | "en-es" },
): Promise<TranslateDocumentResult> {
  await requireCaseAccess(actor, input.caseId);
  const p = TranslateDocumentInputSchema.parse(input);

  // Cross-case guard: requireCaseAccess authorized input.caseId, but the lookups
  // below key on caseDocumentId via the service client (RLS bypassed). Verify the
  // document actually belongs to the authorized case so a member of case A cannot
  // act on (or read) a document from case B (DOC-20 §7 — single source of auth).
  const ownerDoc = await getCaseDocumentForAi(p.caseDocumentId);
  if (!ownerDoc || ownerDoc.caseId !== input.caseId) {
    throw new AuthzError("forbidden_case");
  }

  const existing = await findTranslation(p.caseDocumentId, p.direction);

  if (existing?.status === "completed") return { translation: existing, cached: true };

  // A `processing` row normally means a worker is on it. But if the enqueue died
  // or the worker was killed mid-flight, the row would otherwise stay `processing`
  // forever and the UI would poll a dead job. Treat a processing row that has been
  // stuck well past the job's max lifetime (maxDuration + retries) as retryable.
  const processingSince = existing
    ? new Date(existing.updated_at ?? existing.created_at ?? 0).getTime()
    : 0;
  const staleProcessing =
    existing?.status === "processing" &&
    Number.isFinite(processingSince) &&
    Date.now() - processingSince > STALE_TRANSLATION_MS;

  if (existing?.status === "processing" && !staleProcessing) {
    return { translation: existing, cached: false };
  }

  // Retry path: a prior attempt failed, or a processing row went stale. Reset →
  // re-enqueue; if the enqueue itself fails, mark the row `failed` so it never
  // gets stuck in `processing` (self-healing on the next retry).
  if (existing && (existing.status === "failed" || staleProcessing)) {
    const attempt = (existing as unknown as Record<string, number>)["attempt"] ?? 1;
    await resetTranslation(existing.id, { status: "processing", requested_by: actor.userId });
    try {
      await enqueueJob(
        {
          jobKey: "translate-document",
          entityId: existing.id,
          attempt: attempt + 1,
          dedupeId: `translate-document:${p.caseDocumentId}:${p.direction}:retry-${attempt + 1}`,
          translationId: existing.id,
          direction: p.direction,
          orgId: actor.orgId,
        },
        { retries: 3 },
      );
    } catch (err) {
      await resetTranslation(existing.id, { status: "failed" });
      throw err;
    }
    return { translation: { ...existing, status: "processing" }, cached: false };
  }

  // First attempt: INSERT acts as a mutex (unique_violation = concurrent winner).
  try {
    const row = await insertTranslation({
      case_document_id: p.caseDocumentId,
      direction: p.direction,
      status: "processing",
      requested_by: actor.userId,
    });

    try {
      await enqueueJob(
        {
          jobKey: "translate-document",
          entityId: row.id,
          attempt: 1,
          dedupeId: `translate-document:${p.caseDocumentId}:${p.direction}`,
          translationId: row.id,
          direction: p.direction,
          orgId: actor.orgId,
        },
        { retries: 3 },
      );
    } catch (err) {
      // Do not leave the freshly-inserted row stuck in `processing`.
      await resetTranslation(row.id, { status: "failed" });
      throw err;
    }

    return { translation: row, cached: false };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findTranslation(p.caseDocumentId, p.direction);
      if (!winner) throw err;
      return { translation: winner, cached: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getDocumentTranslation — API-AI-09 (read-only status/result for polling)
// ---------------------------------------------------------------------------

/**
 * Reads the translation row for (case_document_id, direction). Read-only — it
 * NEVER re-enqueues, so the UI can poll it safely while a job is running.
 *
 * @api-id API-AI-09
 */
export async function getDocumentTranslation(
  actor: Actor,
  input: { caseId: string; caseDocumentId: string; direction: "es-en" | "en-es" },
): Promise<DocumentTranslationRow | null> {
  await requireCaseAccess(actor, input.caseId);
  // Cross-case guard (see translateDocument): the document must belong to the
  // authorized case — findTranslation keys on caseDocumentId with RLS bypassed.
  const ownerDoc = await getCaseDocumentForAi(input.caseDocumentId);
  if (!ownerDoc || ownerDoc.caseId !== input.caseId) return null;
  return findTranslation(input.caseDocumentId, input.direction);
}

/**
 * Returns the rendered translation PDF bytes (English document) once the
 * translation has completed, or null if not ready. Authorizes via the case.
 * Consumed by the same-origin preview route (kind=translation).
 */
export async function getDocumentTranslationPdf(
  actor: Actor,
  input: { caseId: string; caseDocumentId: string; direction: "es-en" | "en-es" },
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string } | null> {
  await requireCaseAccess(actor, input.caseId);
  // Cross-case guard (see translateDocument): the PDF bytes are PII-dense — make
  // sure the document belongs to the authorized case before serving them.
  const ownerDoc = await getCaseDocumentForAi(input.caseDocumentId);
  if (!ownerDoc || ownerDoc.caseId !== input.caseId) return null;
  const row = await findTranslation(input.caseDocumentId, input.direction);
  if (!row || row.status !== "completed" || !row.translated_pdf_path) return null;
  const bytes = await downloadBytesFromStorage("generated", row.translated_pdf_path);
  return { bytes, mimeType: "application/pdf", filename: `traduccion-${input.direction}.pdf` };
}

// ---------------------------------------------------------------------------
// executeTranslationJob — called by jobs/translate-document.ts
// ---------------------------------------------------------------------------

export interface TranslateDocumentJobPayload {
  jobKey: "translate-document";
  entityId: string;
  attempt: number;
  dedupeId: string;
  translationId: string;
  direction: "es-en" | "en-es";
}

/** Strips a ```lang … ``` fence the model may wrap the whole answer in (Gemini
 *  sometimes fences its Markdown), leaving the raw Markdown body to render. */
function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const m = /^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return m ? m[1].trim() : trimmed;
}

/** Index at which to split a long text for re-translation: the paragraph break
 *  (`\n\n`) nearest the midpoint, else the nearest line break, else the raw
 *  midpoint. Returns the offset AFTER the break so neither half repeats it. */
function paragraphSplitPoint(text: string): number {
  const mid = Math.floor(text.length / 2);
  const before = text.lastIndexOf("\n\n", mid);
  const after = text.indexOf("\n\n", mid);
  const paraBreaks = [before, after].filter((i) => i > 0);
  if (paraBreaks.length) {
    const best = paraBreaks.reduce((a, b) => (Math.abs(a - mid) <= Math.abs(b - mid) ? a : b));
    return best + 2;
  }
  const nl = text.lastIndexOf("\n", mid);
  if (nl > 0) return nl + 1;
  return mid;
}

/**
 * Translates a text via Gemini, bisecting on truncation. A translation cut at the
 * output-token ceiling (finishReason "MAX_TOKENS") drops the tail of the document
 * silently — instead, split the SOURCE at a paragraph boundary near the midpoint
 * and translate each half (each fits the budget), then join. A text too small to
 * split that still truncates is degenerate: keep what came back. `usage`
 * accumulates provider tokens across every sub-call so cost stays honest (RNF-041).
 */
async function translateTextSegmented(args: {
  text: string;
  promptText: string;
  model: string;
  geminiModels: ReturnType<typeof getGeminiModels>;
  usage: { input_tokens: number; output_tokens: number };
}): Promise<string> {
  const { text, promptText, model, geminiModels, usage } = args;
  const response = await geminiModels.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: `${promptText}\n\n---\n${text}` }] }],
    config: { temperature: 0.2, maxOutputTokens: 65536 },
  });
  usage.input_tokens += response.usageMetadata?.promptTokenCount ?? 0;
  usage.output_tokens += response.usageMetadata?.candidatesTokenCount ?? 0;
  const out = stripMarkdownFence(response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
  const finishReason = response.candidates?.[0]?.finishReason ?? null;

  if (finishReason === "MAX_TOKENS") {
    const splitAt = paragraphSplitPoint(text);
    if (splitAt > 0 && splitAt < text.length) {
      const left = await translateTextSegmented({ ...args, text: text.slice(0, splitAt) });
      const right = await translateTextSegmented({ ...args, text: text.slice(splitAt) });
      return `${left}\n\n${right}`;
    }
  }
  return out;
}

/**
 * Executes document translation via Gemini.
 * @internal
 */
export async function executeTranslationJob(
  payload: TranslateDocumentJobPayload,
): Promise<JobOutcome> {
  const translation = await findTranslationById(payload.translationId);
  if (!translation || translation.status === "completed") return "skipped";

  const source = await getTranslationSource(translation.case_document_id);
  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const geminiModels = getGeminiModels();

  // Use payload.direction (statically typed 'es-en' | 'en-es') over
  // translation.direction (DB `string`). The payload is delivered by QStash with a
  // signature-verified body and carries the same value stored when the job was
  // enqueued, so it is both trustworthy and strictly typed for the renderer.
  const direction = payload.direction;
  // Ask for clean Markdown so the rendered certified-translation PDF has real
  // hierarchy and spacing (headings, paragraphs, line breaks, tables) — the
  // document body is composed from this text (renderCertifiedTranslationPdf).
  const formatGuidance =
    " Format the result as clean Markdown that mirrors the source so it reads clearly: use a level-1 heading (#) for the document's own title and level-2 headings (##) for sections; write a 2-column Markdown table (| Field | Detail |) for blocks of label-value data (registry fields such as 'Given names', 'Date of birth', 'Father', 'Registration number'), and prose paragraphs for narrative text; keep line breaks and lists. Preserve names, numbers and dates exactly. Do not add notes or commentary, and do not wrap the answer in a code fence.";
  const promptText =
    (direction === "es-en"
      ? "Translate the following document from Spanish to English. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [illegible]."
      : "Translate the following document from English to Spanish. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [ilegible].") +
    formatGuidance;

  let translatedText: string;
  let inputTokens = 0;
  let outputTokens = 0;

  try {
    if (source.rawText) {
      // Translate the already-OCR'd text (no PDF resend). Segmented: a document
      // whose translation would exceed the output-token ceiling is split by
      // paragraph and re-translated per half, so a 200+ page record never
      // truncates silently (the raw single call capped at 65k output tokens).
      const usage = { input_tokens: 0, output_tokens: 0 };
      translatedText = await translateTextSegmented({
        text: source.rawText,
        promptText,
        model,
        geminiModels,
        usage,
      });
      inputTokens = usage.input_tokens;
      outputTokens = usage.output_tokens;
    } else if (source.storagePath) {
      // Fallback for a document with no extraction (typically small: a passport,
      // a supporting letter). Fetch the PDF and translate multimodal in one call.
      const { createServiceClient } = await import("@/backend/platform/supabase");
      const supabase = createServiceClient();
      const { data: fileData } = await supabase.storage
        .from("case-documents")
        .download(source.storagePath);

      const fileBytes = fileData ? new Uint8Array(await fileData.arrayBuffer()) : new Uint8Array();
      const fileBase64 = Buffer.from(fileBytes).toString("base64");

      const response = await geminiModels.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: source.mimeType ?? "application/pdf",
                  data: fileBase64,
                },
              },
              { text: promptText },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 65536,
        },
      });
      inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      // A single multimodal call cannot page-split, so a large scan would truncate
      // here silently. Fail loud and actionable instead: the document must be
      // extracted first (chunked OCR) so translation runs over raw_text (segmented).
      if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
        throw new Error(
          "AI_TRANSLATION_TRUNCATED: multimodal translation hit the output-token ceiling — extract the document first so translation runs over raw_text",
        );
      }
      translatedText = stripMarkdownFence(response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    } else {
      // No source text AND no source PDF — this is a data gap, NOT a success.
      // Marking it 'completed' with empty text would poison the UNIQUE
      // (case_document_id, direction) cache and serve empty text on the next call.
      // Mark 'failed' so it can be retried once a source exists.
      const { createServiceClient } = await import("@/backend/platform/supabase");
      const supabase = createServiceClient();
      await supabase
        .from("document_translations")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", translation.id)
        .in("status", ["processing"]);
      logger.warn(
        { translationId: translation.id },
        "translate-document: no source text or PDF available — marked failed",
      );
      return "failed";
    }

    // Validate translation (not empty, reasonable length)
    if (!translatedText.trim()) {
      throw new Error("Translation output was empty");
    }
  } catch (err) {
    logger.error({ err, translationId: translation.id }, "translate-document: Gemini call failed");
    // Throw for QStash retry
    throw err;
  }

  const costUsd = computeGeminiCost({ inputTokens, outputTokens });

  // Ola 2: render the translated text to a PDF so the translation becomes a
  // court-ready document (English expediente) that staff can preview/download
  // and later add as an expediente item. Reuses the mupdf markdown→PDF renderer
  // (same engine as AI generations). Best-effort: if the render fails, the
  // translated text is still persisted — a render hiccup must never strand the
  // row in 'processing'.
  let translatedPdfPath: string | null = null;
  try {
    const docMeta = await getCaseDocumentForAi(translation.case_document_id);
    const caseId = docMeta?.caseId ?? "unknown";
    // Per-service translator signature + name, stamped on the certification block.
    // Best-effort: if the config/image read fails the translation still renders with
    // an impersonal, unsigned certification (no row left in 'processing').
    let signerName: string | null = null;
    let signatureImageBytes: Uint8Array | null = null;
    if (docMeta?.serviceId) {
      try {
        const { getServiceTranslationConfig } = await import("@/backend/modules/catalog");
        const cfg = await getServiceTranslationConfig(docMeta.serviceId);
        signerName = cfg.signerName;
        signatureImageBytes = cfg.signatureImageBytes;
      } catch (err) {
        logger.warn(
          { err, translationId: translation.id },
          "translate-document: per-service signature config read failed",
        );
      }
    }
    const signedDate = new Date().toLocaleDateString(direction === "es-en" ? "en-GB" : "es-ES", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const pdfBytes = await renderCertifiedTranslationPdf(translatedText, direction, {
      signerName,
      signatureImageBytes,
      signedDate,
    });
    const pdfPath = `case/${caseId}/translations/${translation.id}.pdf`;
    await uploadBytesToStorage("generated", pdfPath, pdfBytes, "application/pdf");
    translatedPdfPath = pdfPath;
  } catch (err) {
    logger.error(
      { err, translationId: translation.id },
      "translate-document: PDF render failed (translated text kept)",
    );
  }

  await completeTranslation(translation.id, {
    status: "completed",
    translatedText,
    translatedPdfPath,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    completedAt: new Date().toISOString(),
  });

  logger.info(
    {
      job: "translate-document",
      translationId: translation.id,
      model,
      inputTokens,
      outputTokens,
      costUsd,
    },
    "translate-document: completed",
  );

  return "completed";
}

// ---------------------------------------------------------------------------
// markTranslationFailed — job-failed callback
// ---------------------------------------------------------------------------

export async function markTranslationFailed(
  translationId: string,
  errorMsg: string,
): Promise<void> {
  const { createServiceClient } = await import("@/backend/platform/supabase");
  const supabase = createServiceClient();
  // document_translations has no `error` column (unlike document_extractions), so
  // we persist the failure status and surface the reason via the structured logger
  // (PII-redacted) rather than dropping it silently.
  logger.warn({ translationId, errorMsg }, "ai-engine: translation marked failed by callback");
  await supabase
    .from("document_translations")
    .update({
      status: "failed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", translationId)
    .in("status", ["processing"]);
}

// ---------------------------------------------------------------------------
// translateText — T4 ephemeral (DOC-42 §3.8)
// ---------------------------------------------------------------------------

/**
 * Synchronous text translation (no table — caller persists where appropriate).
 * Used by messaging for body_translated and by cases for completeI18n.
 *
 * @api-id (internal)
 */
export async function translateText(input: {
  text: string;
  direction: "es-en" | "en-es";
  /**
   * Legal-document mode: keep proper nouns verbatim and preserve diacritics.
   * Used when translating client answers for an official AcroForm — a person's
   * name, city, state/department, country or employer must NOT be translated
   * (e.g. "Rosa" must stay "Rosa", never "Pink"), and accents must survive
   * (e.g. "José Ramírez" must stay "José Ramírez", never "Jose Ramirez").
   */
  preserveProperNouns?: boolean;
  /**
   * The form field this value answers (e.g. "¿Cuál es su religión?"). Translating
   * a bare value out of context is ambiguous — "Cristiano" is both a religion and
   * a personal name. The label lets the model disambiguate: a religion field →
   * "Christian"; a name field → keep "Cristiano".
   */
  fieldLabel?: string;
}): Promise<{ text: string; model: string }> {
  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const geminiModels = getGeminiModels();

  const langs =
    input.direction === "es-en"
      ? { from: "Spanish", to: "English" }
      : { from: "English", to: "Spanish" };
  // For legal-form answers, names of people and places are identifiers, not words
  // to translate — and dropping an accent changes a legal name. Instruct the model
  // to keep them exactly. (Common descriptive words like an occupation are still
  // translated normally.)
  const properNounRule = input.preserveProperNouns
    ? " Keep every proper noun exactly as written — the names of specific people," +
      " streets, cities, towns, departments, provinces, states, countries, schools," +
      " employers and institutions must NOT be translated or transliterated (e.g." +
      ' "Carlos" stays "Carlos", "Distrito Capital" stays "Distrito Capital").' +
      " Do translate ordinary descriptive words normally — occupations, religions," +
      ' relationships and other common nouns (e.g. "Vendedor" → "Seller",' +
      ' "Cristiano" → "Christian"). Preserve all accents and diacritics exactly as in' +
      " the source (e.g. keep á é í ó ú ñ); never strip or normalize them."
    : "";
  const fieldContext = input.fieldLabel?.trim()
    ? ` This value is the answer to the form field "${input.fieldLabel.trim()}";` +
      " use that context to choose the right meaning."
    : "";
  const promptText =
    `Translate this text from ${langs.from} to ${langs.to}.` +
    ` Return only the translated text, no explanations.${properNounRule}${fieldContext}\n\n${input.text}`;

  try {
    const response = await geminiModels.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      config: { temperature: 0.2, maxOutputTokens: 4096 },
    });

    const translated = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { text: translated, model };
  } catch (err) {
    throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", err);
  }
}

// ---------------------------------------------------------------------------
// assessDocumentLegibility — pre-acceptance quality gate (Gemini Vision)
// ---------------------------------------------------------------------------

export interface DocumentLegibilityVerdict {
  /** false ONLY when the document is clearly unreadable. */
  legible: boolean;
  blurLevel: "none" | "light" | "heavy";
  reasonEs: string;
  reasonEn: string;
}

const LEGIBILITY_SCHEMA = {
  type: "object",
  properties: {
    legible: { type: "boolean" },
    blur_level: { type: "string", enum: ["none", "light", "heavy"] },
    reason_es: { type: "string" },
    reason_en: { type: "string" },
  },
  required: ["legible", "blur_level", "reason_es", "reason_en"],
};

/**
 * First-filter document quality check, run before a case document is accepted
 * (DOC-41 §3.6 extension). Conservative by design: it flags a document as NOT
 * acceptable only when the scan is CLEARLY unreadable / heavily blurred — light
 * blur passes, because the human reviewer (Diana/Henry/Vanessa via reviewDocument)
 * is the final word. Fail-open: any provider error returns legible=true, so an AI
 * outage never blocks uploads. Respects the AI stub (E2E/CI) — no Gemini call.
 *
 * Multimodal: accepts PDF and PNG via inlineData (same pipeline as extraction).
 */
export async function assessDocumentLegibility(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<DocumentLegibilityVerdict> {
  if (isAiStubEnabled()) {
    return { legible: true, blurLevel: "none", reasonEs: "", reasonEn: "" };
  }

  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;

  // Big PDFs: judge legibility on a first-pages sample — inlining a 14MB+ scan
  // would blow the request limit and silently fail-open (no quality control at
  // all). Sampling failure falls back to the full bytes (outer fail-open stands).
  let sendBytes = input.bytes;
  if (input.mimeType === "application/pdf" && input.bytes.length > LEGIBILITY_SAMPLE_MIN_BYTES) {
    try {
      const pages = await countPdfPages(input.bytes);
      if (pages > LEGIBILITY_SAMPLE_PAGES) {
        sendBytes = await extractPdfPageRange(input.bytes, 0, LEGIBILITY_SAMPLE_PAGES);
      }
    } catch (err) {
      logger.warn({ err }, "ai-engine: legibility sampling failed — using full bytes");
    }
  }
  const base64 = Buffer.from(sendBytes).toString("base64");

  try {
    const response = await getGeminiModels().generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: base64 } },
            {
              text:
                "Eres un control de calidad de documentos escaneados para un expediente legal. " +
                "Evalúa SOLO la legibilidad visual del documento: nitidez, enfoque, iluminación y que no esté recortado. " +
                "Marca legible=false o blur_level='heavy' ÚNICAMENTE si el contenido es claramente ilegible " +
                "(muy borroso, demasiado oscuro, o recortado de modo que no se puede leer). " +
                "Ante cualquier duda, considéralo aceptable (legible=true, blur_level distinto de 'heavy'). " +
                "Responde en JSON: {legible, blur_level, reason_es, reason_en} con motivos breves.",
            },
          ],
        },
      ],
      config: {
        temperature: 0,
        maxOutputTokens: 256,
        responseMimeType: "application/json",
        responseSchema: LEGIBILITY_SCHEMA,
      },
    });

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const parsed = JSON.parse(text) as {
      legible?: boolean;
      blur_level?: string;
      reason_es?: string;
      reason_en?: string;
    };
    const blurLevel: DocumentLegibilityVerdict["blurLevel"] =
      parsed.blur_level === "heavy" || parsed.blur_level === "light"
        ? parsed.blur_level
        : "none";
    return {
      legible: parsed.legible !== false,
      blurLevel,
      reasonEs: parsed.reason_es ?? "",
      reasonEn: parsed.reason_en ?? "",
    };
  } catch (err) {
    // Fail-open: never block an upload because the AI provider is unavailable.
    logger.warn(
      { err },
      "ai-engine: assessDocumentLegibility failed — allowing upload (fail-open)",
    );
    return { legible: true, blurLevel: "none", reasonEs: "", reasonEn: "" };
  }
}

/**
 * Translates a free-text client answer for AcroForm filling, masking structured
 * PII (SSN, A-number, passport) BEFORE it reaches the provider — consistent with
 * the generation pipeline (domain `maskPii`, DOC-74 §7.1). Structured PII destined
 * for the official form arrives via `source='profile'` (resolved locally in
 * pdf-lib, never sent to AI), so masking here only neutralizes PII a client may
 * have incidentally typed into a narrative text/textarea field.
 */
export async function translateAnswerText(input: {
  text: string;
  direction: "es-en" | "en-es";
  /** The form field label this answer belongs to, for disambiguation. */
  fieldLabel?: string;
}): Promise<{ text: string }> {
  const { text } = await translateText({
    text: maskPii(input.text),
    direction: input.direction,
    preserveProperNouns: true,
    fieldLabel: input.fieldLabel,
  });
  return { text };
}

// ---------------------------------------------------------------------------
// T5 — "Mejorar con IA" (per-question rewrite, DOC-74 §1 task T5)
// ---------------------------------------------------------------------------

const AI_IMPROVE_TIMEOUT_MS = 30_000;
const AI_IMPROVE_MAX_INPUT_CHARS = 10_000;

// Fixed guardrails live HERE, in code — the per-question instruction (catalog
// config) only carries the field-specific FORMAT rules. Kept stable on purpose.
const IMPROVE_SYSTEM_PROMPT = [
  "Eres un corrector de respuestas de formularios legales de inmigración.",
  "Tu única tarea es reescribir el texto del usuario corrigiendo ortografía, puntuación, mayúsculas y coherencia, y aplicando EXACTAMENTE el formato que pida la instrucción del campo.",
  "Reglas estrictas:",
  "- NO inventes, añadas ni elimines información: hechos, nombres, fechas, números, cantidades y lugares se conservan tal cual.",
  "- Si una fecha está incompleta (solo el año, o solo mes y año), consérvala incompleta: NUNCA inventes el día ni el mes para completar un formato.",
  "- Conserva el idioma original del texto (si está en español, responde en español; si está en inglés, en inglés).",
  "- Los tokens con forma [[PII_n]] son datos protegidos: consérvalos carácter por carácter (incluidos los corchetes dobles), colocados donde corresponda en el texto final. NUNCA los omitas ni los reescribas.",
  "- Si el texto ya es correcto, devuélvelo con los cambios mínimos necesarios.",
  "- Devuelve SOLO el texto final: sin preámbulos, sin explicaciones, sin comillas y sin markdown.",
].join("\n");

export interface ImproveFormAnswerResult {
  improvedText: string;
}

/**
 * Rewrites a client's form answer (spelling/punctuation/casing/required format)
 * per the question's `ai_improve.instruction` (catalog config, server-only —
 * NEVER accepted from the client). Synchronous, haiku-class model, best-effort:
 * every failure throws a typed AiEngineError and the caller leaves the client's
 * text untouched.
 *
 * PII: reversible tokenization (⟦PII_n⟧) instead of the lossy maskPii — the
 * output REPLACES the answer, so A-Numbers/SSNs/passports must survive verbatim
 * (DOC-74 §7.1 still holds: raw PII never reaches the provider).
 */
export async function improveFormAnswerText(
  actor: Actor,
  input: { caseId: string; formDefinitionId: string; questionId: string; text: string },
): Promise<ImproveFormAnswerResult> {
  await requireCaseAccess(actor, input.caseId);

  const rl = await limitAiImprove(actor.userId);
  if (!rl.allowed) throw new AiEngineError("AI_IMPROVE_RATE_LIMITED");

  // The question must belong to the form the client is filling and to a
  // non-draft version. Archived is accepted on purpose: a client's in-progress
  // response stays pinned to its version even after a re-publish.
  const question = await findQuestionForImprove(input.questionId);
  if (
    !question ||
    question.version.form_definition_id !== input.formDefinitionId ||
    question.version.status === "draft"
  ) {
    throw new AiEngineError("AI_IMPROVE_NOT_ENABLED");
  }
  const instruction = question.ai_improve?.instruction?.trim();
  if (!instruction) throw new AiEngineError("AI_IMPROVE_NOT_ENABLED");

  const text = input.text.trim();
  if (!text) return { improvedText: input.text };
  if (text.length > AI_IMPROVE_MAX_INPUT_CHARS) {
    throw new AiEngineError("AI_IMPROVE_TEXT_TOO_LONG");
  }

  // E2E / CI: deterministic short-circuit BEFORE any provider work (the stub
  // Anthropic client answers with the legal-memo fixture, useless here).
  if (isAiStubEnabled()) {
    return { improvedText: `${text} [mejorado-stub]` };
  }

  const { masked, tokens } = maskPiiReversible(text);
  const label = question.question_i18n?.es ?? question.question_i18n?.en ?? "";
  const user = [
    label ? `Campo del formulario: "${label}"` : null,
    `Instrucción del campo: ${instruction}`,
    "",
    "Texto del usuario:",
    masked,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const model = process.env.AI_UI_MODEL ?? DEFAULT_UI_MODEL;
  const maxTokens = Math.min(4096, Math.max(512, Math.ceil(masked.length / 2)));

  // One retry on an invalid output (e.g. the model dropped a [[PII_n]] token),
  // with an explicit reminder appended. Still fail-safe: two misses → typed
  // error and the client's text stays untouched.
  let validated: ReturnType<typeof validateImprovedText> = { ok: false, reason: "not_run" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    let result: AnthropicCallResult;
    try {
      result = await callAnthropic(getAnthropicClient(), {
        model,
        system: IMPROVE_SYSTEM_PROMPT,
        user:
          attempt === 1
            ? user
            : `${user}\n\nIMPORTANTE: tu respuesta anterior perdió un token protegido. Conserva CADA token [[PII_n]] del texto EXACTAMENTE como aparece, sin omitirlo ni modificarlo.`,
        maxTokens,
        timeoutMs: AI_IMPROVE_TIMEOUT_MS,
      });
    } catch (err) {
      throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", err);
    }

    validated = validateImprovedText(masked, result.text);
    if (validated.ok) {
      // T5 cost: log-only (see note below).
      const costUsd = computeAnthropicCost(result.usage, result.model);
      logger.info(
        {
          caseId: input.caseId,
          questionId: input.questionId,
          model: result.model,
          usage: result.usage,
          costUsd,
          attempt,
        },
        "ai-engine: improveFormAnswerText",
      );
      break;
    }
    logger.warn(
      { questionId: input.questionId, reason: validated.reason, attempt },
      "ai-engine: improveFormAnswerText output rejected",
    );
  }
  if (!validated.ok) {
    throw new AiEngineError("AI_IMPROVE_OUTPUT_INVALID", validated.reason);
  }

  // Restore PII verbatim, then apply the DETERMINISTIC A-Number canonical
  // format (A-#########) — the model can't do it (it only sees tokens).
  // T5 cost: log-only (inside the loop). getCostsSummary aggregates the
  // T1/T3/T4 tables; at ~$0.001-0.005/click (haiku) a BD row is not yet
  // warranted. TODO(T5-costs): persist to a small usage table if volume grows.
  const improvedText = normalizeANumbersInText(restorePii(validated.text, tokens));

  return { improvedText };
}

// ---------------------------------------------------------------------------
// ai_field resolution (Etapa B) — a form field whose value is produced by AI at
// resolution time. Two flavors, batched (one provider call per source):
//   - interpretDocumentFields: Gemini multimodal INTERPRETS a client document.
//   - synthesizeLetterFields:  Anthropic SYNTHESIZES from a generated ai_letter.
// Both take many per-field instructions and return an { questionId -> value } map.
// The cases module loads the source content (it owns case data) and calls these;
// ai-engine owns the providers + PII masking (RNF-041 / DOC-74 §7.1).
// ---------------------------------------------------------------------------

/** One ai_field to resolve: a stable id (the question id) + its per-field instruction. */
export interface AiFieldRequest {
  id: string;
  instruction: string;
}

const AI_FIELD_ANSWERS_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, value: { type: "string" } },
        required: ["id", "value"],
      },
    },
  },
  required: ["answers"],
};

/** Tolerant parse of {"answers":[{id,value}]} → map, keeping only requested ids with non-empty values. */
function parseFieldAnswers(text: string, fields: AiFieldRequest[]): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const json = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    const parsed = JSON.parse(json) as { answers?: Array<{ id?: unknown; value?: unknown }> };
    const byId = new Map((parsed.answers ?? []).map((a) => [String(a.id), a.value]));
    for (const f of fields) {
      const v = byId.get(f.id);
      if (v != null && String(v).trim()) out[f.id] = String(v).trim();
    }
  } catch {
    // Tolerant: a malformed response leaves all fields unresolved (caller treats as empty).
  }
  return out;
}

function buildAiFieldList(fields: AiFieldRequest[]): string {
  return fields.map((f, i) => `${i + 1}. id="${f.id}": ${f.instruction}`).join("\n");
}

/**
 * INTERPRETS a client-uploaded document (Gemini multimodal over the raw file) to
 * answer many per-field instructions at once. Does NOT extract a fixed datum — it
 * reads, comprehends, and drafts. Best-effort: any failure → empty map (the form
 * field is simply left blank). Respects the AI stub (E2E/CI).
 */
export async function interpretDocumentFields(input: {
  fileBase64: string;
  mimeType: string;
  /** Additional documents the interpreter READS as supporting context (labeled);
   *  the instruction still applies to the PRIMARY document. */
  contextFiles?: Array<{ fileBase64: string; mimeType: string; label?: string }>;
  /** Context as EXTRACTED TEXT (preferred for large scanned records — a 14MB
   *  package travels as text instead of blowing the inline byte budget). */
  contextTexts?: Array<{ text: string; label?: string }>;
  fields: AiFieldRequest[];
  model?: string | null;
}): Promise<Record<string, string>> {
  if (input.fields.length === 0) return {};
  if (isAiStubEnabled()) {
    return Object.fromEntries(input.fields.map((f) => [f.id, `[stub-doc: ${f.instruction.slice(0, 60)}]`]));
  }
  const model = input.model || process.env.AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const ctxFiles = input.contextFiles ?? [];
  const ctxTexts = input.contextTexts ?? [];
  const hasContext = ctxFiles.length > 0 || ctxTexts.length > 0;
  const contextNote = hasContext
    ? "\n\nSe adjuntan además documentos de contexto (rotulados): úsalos para corroborar y " +
      "fundamentar, pero la instrucción se aplica sobre el DOCUMENTO PRINCIPAL. Si ninguno " +
      "de los documentos respalda un dato, devuelve cadena vacía (NO inventes)."
    : "";
  const prompt =
    "Eres un asistente legal que INTERPRETA un documento (no extraes un dato literal: " +
    "lees, comprendes y redactas). Para cada campo, produce el texto solicitado basándote " +
    "ÚNICAMENTE en el contenido real del documento. Si el documento no lo respalda, devuelve " +
    "cadena vacía para ese id (NO inventes)." +
    contextNote +
    "\n\nCampos:\n" +
    buildAiFieldList(input.fields) +
    '\n\nResponde en JSON: {"answers":[{"id":"<id>","value":"<texto>"}]}.';
  // Without any context the part shape stays EXACTLY [document, prompt]
  // (regression-safe for every existing single-document ai_field). Context text
  // is PII-masked before the provider (same policy as the generation pipeline);
  // the interpreter is told never to echo mask tokens into an answer.
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
    !hasContext
      ? [{ inlineData: { mimeType: input.mimeType, data: input.fileBase64 } }, { text: prompt }]
      : [
          { text: "DOCUMENTO PRINCIPAL (la instrucción se aplica sobre este documento):" },
          { inlineData: { mimeType: input.mimeType, data: input.fileBase64 } },
          ...ctxFiles.flatMap((c, i) => [
            { text: `DOCUMENTO DE CONTEXTO ${i + 1}${c.label ? ` — "${sanitizeDocLabel(c.label)}"` : ""}:` },
            { inlineData: { mimeType: c.mimeType, data: c.fileBase64 } },
          ]),
          ...ctxTexts.map((c, i) => ({
            text:
              `DOCUMENTO DE CONTEXTO (texto extraído) ${ctxFiles.length + i + 1}` +
              `${c.label ? ` — "${sanitizeDocLabel(c.label)}"` : ""}:\n` +
              // Mask BEFORE truncating (project-memory CRITICAL): a head-tail cut
              // through an unmasked A-number/SSN would leave the fragment visible.
              `${headTailClip(maskPii(c.text), 300_000, "contexto")}\n--- FIN DEL DOCUMENTO DE CONTEXTO ---`,
          })),
          { text: prompt },
        ];
  try {
    const response = await getGeminiModels().generateContent({
      model,
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: AI_FIELD_ANSWERS_SCHEMA,
      },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseFieldAnswers(text, input.fields);
  } catch (err) {
    logger.warn({ err, count: input.fields.length }, "ai-engine: interpretDocumentFields failed — leaving fields blank");
    return {};
  }
}

/**
 * SYNTHESIZES form-field text from a generated ai_letter (e.g. the credible-fear
 * memorandum) via Anthropic, answering many per-field instructions at once. The
 * letter text is PII-masked before the provider (DOC-74 §7.1). Best-effort: any
 * failure → empty map. Respects the AI stub (E2E/CI).
 */
export async function synthesizeLetterFields(input: {
  letterText: string;
  fields: AiFieldRequest[];
  model?: string | null;
}): Promise<Record<string, string>> {
  if (input.fields.length === 0) return {};
  if (isAiStubEnabled()) {
    return Object.fromEntries(input.fields.map((f) => [f.id, `[stub-letter: ${f.instruction.slice(0, 60)}]`]));
  }
  const model = input.model || DEFAULT_GENERATION_MODEL;
  const system =
    "Eres un asistente legal experto en asilo en EE. UU. A partir del MEMORÁNDUM provisto, " +
    "redacta el texto pedido para cada campo de un formulario oficial (p. ej. USCIS I-589). " +
    "Usa SOLO hechos presentes en el memorándum; no inventes. Sé conciso, preciso y formal, " +
    "en el idioma que pida cada campo. Devuelve cadena vacía para un id no sustentado.";
  const user =
    "MEMORÁNDUM:\n" +
    maskPii(input.letterText) +
    "\n\n---\nCampos a redactar:\n" +
    buildAiFieldList(input.fields) +
    '\n\nResponde ÚNICAMENTE en JSON: {"answers":[{"id":"<id>","value":"<texto>"}]}.';
  try {
    const client = getAnthropicClient();
    const r = await callAnthropic(client, { model, system, user, maxTokens: 6000, timeoutMs: 180_000 });
    return parseFieldAnswers(r.text, input.fields);
  } catch (err) {
    logger.warn({ err, count: input.fields.length }, "ai-engine: synthesizeLetterFields failed — leaving fields blank");
    return {};
  }
}

/** One answer to translate: a stable id (question id) + its text + optional field label for context. */
export interface TranslateAnswerItem {
  id: string;
  text: string;
  fieldLabel?: string;
}

/**
 * BATCH-translates many client answers in ONE Gemini call (structured output) so an
 * English AcroForm never leaks Spanish free-text. Replaces N sequential per-field calls
 * (2-4 min) with one call for N fields. Preserves proper nouns (names/places) and accents,
 * masks incidental PII per item (DOC-74 §7.1), and — if a value is already in the target
 * language — returns it unchanged. Chunks by cumulative text size to stay within the output
 * budget. Best-effort: an item absent from the response is simply absent from the map (the
 * caller keeps the original). Respects the AI stub (E2E/CI → passthrough).
 */
export async function translateAnswersBatch(input: {
  items: TranslateAnswerItem[];
  direction: "es-en" | "en-es";
  preserveProperNouns?: boolean;
}): Promise<Record<string, string>> {
  const all = input.items.filter((i) => i.text?.trim());
  if (all.length === 0) return {};
  // Defence in depth: a structured/PII value (A-Number, SSN, passport, date, code) is
  // returned RAW — never masked, never sent to the translator. This guarantees a masked
  // token (e.g. "A-•••-•••") can never leave this function even if a caller forgot to
  // pre-filter. Natural-language text (incl. names/cities) still goes through, preserved
  // by the proper-noun rule. Callers that must keep proper nouns literal use no_translate.
  const verbatim: Record<string, string> = {};
  const items = all.filter((i) => {
    if (isVerbatimValue(i.text)) {
      verbatim[i.id] = i.text;
      return false;
    }
    return true;
  });
  if (items.length === 0) return verbatim;
  if (isAiStubEnabled()) {
    return { ...verbatim, ...Object.fromEntries(items.map((i) => [i.id, i.text])) }; // stub: passthrough
  }

  // Chunk by cumulative text length so one response stays within maxOutputTokens.
  const CHUNK_CHARS = 6_000;
  const chunks: TranslateAnswerItem[][] = [];
  let cur: TranslateAnswerItem[] = [];
  let curLen = 0;
  for (const it of items) {
    if (cur.length > 0 && curLen + it.text.length > CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(it);
    curLen += it.text.length;
  }
  if (cur.length > 0) chunks.push(cur);

  const results = await Promise.all(
    chunks.map((chunk) => translateAnswersChunk(chunk, input.direction, input.preserveProperNouns)),
  );
  return Object.assign({ ...verbatim }, ...results);
}

async function translateAnswersChunk(
  items: TranslateAnswerItem[],
  direction: "es-en" | "en-es",
  preserveProperNouns?: boolean,
): Promise<Record<string, string>> {
  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const langs = direction === "es-en" ? { from: "Spanish", to: "English" } : { from: "English", to: "Spanish" };
  const properNounRule = preserveProperNouns
    ? " Keep every proper noun exactly as written — the names of specific people, streets, cities, towns," +
      " departments, provinces, states, countries, schools, employers and institutions must NOT be translated" +
      " or transliterated. Do translate ordinary descriptive words normally (occupations, religions," +
      " relationships and other common nouns). Preserve all accents and diacritics exactly as in the source."
    : "";
  const list = items
    .map((it, i) => {
      const label = it.fieldLabel?.trim() ? ` (form field: "${it.fieldLabel.trim()}")` : "";
      return `${i + 1}. id="${it.id}"${label}:\n${maskPii(it.text)}`;
    })
    .join("\n\n");
  const prompt =
    `Translate EACH item's text from ${langs.from} to ${langs.to}, keyed by its id.${properNounRule}` +
    ` If an item's text is already in ${langs.to}, return it unchanged. Return the full translated text for each id.` +
    `\n\nItems:\n${list}\n\nRespond ONLY in JSON: {"answers":[{"id":"<id>","value":"<translated text>"}]}.`;
  try {
    const response = await getGeminiModels().generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 32_768,
        responseMimeType: "application/json",
        responseSchema: AI_FIELD_ANSWERS_SCHEMA,
        // gemini-2.5-flash is a "thinking" model; its reasoning tokens count toward
        // maxOutputTokens and, with many fields, can starve the JSON output (truncated
        // → unparseable → nothing translated). Translation needs no chain-of-thought, so
        // disable thinking to give every token to the answer.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const out = parseFieldAnswers(text, items.map((i) => ({ id: i.id, instruction: "" })));
    if (Object.keys(out).length === 0) {
      logger.warn(
        { finishReason: response.candidates?.[0]?.finishReason, textLen: text.length, items: items.length },
        "translateAnswersBatch: chunk produced no usable translations",
      );
    }
    return out;
  } catch (err) {
    logger.warn({ err, count: items.length }, "ai-engine: translateAnswersBatch chunk failed — leaving answers untranslated");
    return {};
  }
}

/**
 * Proposes the questions of a companion QUESTIONNAIRE (Etapa B) — the complementary
 * form whose answers feed a generated document. Unlike proposeFormSegmentation there
 * is NO PDF/AcroForm: the proposal is grounded in the generation's PURPOSE (the
 * ai_letter system prompt) so the questions gather exactly the facts a high-quality
 * draft needs. Every question is `client_answer` (the admin can later switch a field
 * to ai_field / profile). Returns the same shape proposeFormSegmentation does, so the
 * catalog materializer is reused unchanged. Best-effort: a parse failure → no groups.
 */
export async function proposeQuestionnaireQuestions(input: {
  purpose: string;
  formName?: string;
  serviceName?: string;
  model?: string | null;
}): Promise<SegmentationProposal> {
  if (isAiStubEnabled()) {
    return {
      groups: [
        {
          title_i18n: { es: "Datos del caso", en: "Case data" },
          position: 0,
          questions: [
            { key: "q1", question_i18n: { es: "Describe brevemente tu situación.", en: "Briefly describe your situation." }, field_type: "textarea", source: "client_answer", is_required: true, position: 0 },
          ],
        },
      ],
    };
  }
  const model = input.model || DEFAULT_GENERATION_MODEL;
  const system =
    "Eres un asistente que diseña CUESTIONARIOS complementarios para nutrir la redacción " +
    "de un documento legal generado por IA. Propón preguntas claras y específicas, agrupadas " +
    "por tema, que recojan los hechos necesarios para una redacción de alta calidad. Cada " +
    "pregunta la responde el cliente o el equipo (source='client_answer'). NO inventes campos " +
    "de PDF (no uses pdf_field_name).";
  const user =
    "Documento a generar (propósito / prompt del sistema):\n" +
    maskPii(input.purpose || "(sin descripción)") +
    `\n\nFormulario: ${input.formName ?? ""}\nServicio: ${input.serviceName ?? ""}\n\n` +
    'Devuelve SOLO JSON con esta forma: {"groups":[{"title_i18n":{"es":"...","en":"..."},' +
    '"questions":[{"key":"q1","question_i18n":{"es":"...","en":"..."},"help_i18n":{"es":"...","en":"..."},' +
    '"field_type":"text|textarea|date|number|select|checkbox","is_required":true}]}]}. ' +
    "Usa 2–5 grupos y 3–8 preguntas por grupo. Las claves `key` deben ser únicas (q1, q2, …).";
  try {
    const client = getAnthropicClient();
    const r = await callAnthropic(client, { model, system, user, maxTokens: 8000, timeoutMs: 180_000 });
    const start = r.text.indexOf("{");
    const end = r.text.lastIndexOf("}");
    const json = start >= 0 && end > start ? r.text.slice(start, end + 1) : r.text;
    const parsed = JSON.parse(json) as { groups?: ProposedGroup[] };
    return { groups: Array.isArray(parsed.groups) ? parsed.groups : [] };
  } catch (err) {
    logger.warn({ err }, "ai-engine: proposeQuestionnaireQuestions failed — no groups proposed");
    return { groups: [] };
  }
}

// ===========================================================================
// Ola 3 — Per-case questionnaire generation ("super-detailed questions")
//
// Reads the client's I-589 answers + uploaded documents (declaración jurada,
// evidencias, NTA/Parole) and generates DEEP, SPECIFIC follow-up questions
// grounded in THIS client's record. Modeled as a per-case AI generation with its
// own instance + cost (like document_extractions) — NOT an ai_generation_run.
// ===========================================================================

function normalizeI18n(v: { es?: string; en?: string } | null | undefined): { es: string; en: string } {
  const es = (v?.es ?? v?.en ?? "").toString().trim();
  const en = (v?.en ?? v?.es ?? "").toString().trim();
  return { es, en };
}

const QUESTIONNAIRE_GEN_SYSTEM_BASE =
  "Eres un paralegal experto en inmigración que diseña un CUESTIONARIO PERSONALIZADO para un cliente, " +
  "leyendo su expediente real (respuestas del formulario I-589 y los documentos que subió: declaración jurada, " +
  "evidencias sustentatorias, NTA/Parole). Tu objetivo es generar preguntas MUY ESPECÍFICAS y PROFUNDAS que " +
  "hagan que el cliente EXTIENDA y DETALLE lo que vivió, para nutrir después la redacción de un memorándum legal.\n\n" +
  "REGLAS ABSOLUTAS:\n" +
  "1. FUNDAMENTA cada pregunta en algo concreto del expediente. Cita el detalle: si mencionó una carta de " +
  "extorsión, pregunta su fecha, quién la entregó y qué exigía; si mencionó un allanamiento, pregunta dónde, " +
  "cuándo exactamente, quiénes participaron, qué se llevaron, quién fue testigo y qué pasó después.\n" +
  "2. NUNCA inventes hechos, nombres, fechas ni lugares. Si un dato falta, PREGÚNTALO — no lo asumas.\n" +
  "3. Profundiza según el tipo de daño: abuso → dónde/cuándo/quién/testigos/lesiones/atención médica/denuncia; " +
  "amenazas → medio/frecuencia/contenido textual/autor; persecución política, religiosa o por grupo social → " +
  "cómo se le identificó, qué actos concretos y qué consecuencias tuvo.\n" +
  "4. Pide FECHAS y LUGARES concretos para poder corroborar con noticias y eventos públicos (elecciones, " +
  "represión, informes de la ONU/ACNUR/HRW): pregunta '¿en qué fecha aproximada?' y '¿en qué ciudad o zona?'.\n" +
  "5. NO repitas lo que el cliente ya respondió en el I-589 ni en las preguntas base — SOLO profundiza más allá.\n" +
  "6. Las preguntas las responde el CLIENTE (source='client_answer'); usa field_type 'textarea' para relatos, " +
  "'date' para fechas y 'select'/'checkbox' con opciones cuando aplique. NUNCA uses campos de PDF.\n" +
  "7. Redacta cada pregunta de forma clara y empática, dirigida al cliente ('usted'), bilingüe (es + en).\n" +
  "8. Preguntas de DISPONIBILIDAD de evidencia ('¿Tiene usted…?', '¿Cuenta con…?'): incluye SIEMPRE una opción " +
  "negativa/'No aplica' y, si esa evidencia NO consta en el expediente, declara `default_value` con el `value` " +
  "EXACTO de esa opción negativa — así el cuestionario queda respondido por defecto cuando no hay nada que aportar " +
  "y el cliente solo lo cambia si sí tiene la evidencia.\n" +
  "9. CLASIFICA CADA PREGUNTA con `answerable_from` — de dónde puede salir la respuesta:\n" +
  "   - `record_confirm`: el expediente YA contiene la respuesta. Declara `prefill_value` (el dato concreto) y " +
  "`evidence_refs`:[{\"document\":\"<slug>\",\"span\":\"<CITA VERBATIM del expediente que contiene ese dato>\"}]. " +
  "El cliente solo tendrá que confirmarlo con un toque. El `span` se VERIFICA contra el expediente: si no aparece " +
  "literalmente, o si `prefill_value` no está contenido en él, la pregunta se degrada automáticamente y pierde el " +
  "prellenado. NO cites de memoria: copia el texto exacto.\n" +
  "   - `record`: el expediente permite redactar un borrador, pero no hay un dato puntual que confirmar.\n" +
  "   - `client_only`: la respuesta SOLO existe en la memoria del cliente (lo que se dijo en una audiencia, lo que " +
  "sintió, hechos posteriores). NO inventes un prellenado para estas: se le preguntarán directamente.\n" +
  "10. Si el expediente NO permite responder una pregunta, eso NO es un problema: márcala `client_only`. Es " +
  "preferible una pregunta honesta sin respuesta a un cuestionario que parece completo y está vacío.";

function buildQuestionnaireGenSystem(
  config: QuestionnaireGenConfigRow,
  posturePlaybook?: string | null,
): string {
  const extra = config.generation_prompt?.trim();
  let system = extra
    ? `${QUESTIONNAIRE_GEN_SYSTEM_BASE}\n\nINSTRUCCIONES ADICIONALES DEL SERVICIO:\n${extra}`
    : QUESTIONNAIRE_GEN_SYSTEM_BASE;
  // Posture goes LAST so it can veto the generic rules above. Without it the
  // generator asked a pretermission case what the judge found on credibility —
  // a decision that was never made, so the question was unanswerable by
  // construction and no amount of retrieval could have saved it.
  const playbook = posturePlaybook?.trim();
  if (playbook) system += `\n\nPOSTURA PROCESAL DEL CASO (PRIORITARIO SOBRE LO ANTERIOR):\n${playbook}`;
  return system;
}

function questionGenOutputInstructions(target: number | null): string {
  const n = target && target > 0 ? target : 15;
  return (
    "\n\n## FORMATO DE SALIDA\n" +
    'Devuelve SOLO JSON con esta forma: {"groups":[{"title_i18n":{"es":"...","en":"..."},' +
    '"questions":[{"key":"q1","question_i18n":{"es":"...","en":"..."},"help_i18n":{"es":"...","en":"..."},' +
    '"field_type":"textarea|text|date|number|select|checkbox","is_required":true}]}]}. ' +
    `Genera aproximadamente ${n} preguntas repartidas en 3–6 grupos temáticos. Las claves \`key\` deben ser ` +
    'únicas (q1, q2, …). Para "select"/"checkbox" añade "options":[{"value":"...","label_i18n":{"es":"...","en":"..."}}]. ' +
    'Una pregunta puede llevar "default_value":"<value de una opción o texto corto>" cuando la regla 8 aplique ' +
    "(disponibilidad de evidencia que no consta en el expediente).\n" +
    'CADA pregunta DEBE declarar "answerable_from":"record_confirm"|"record"|"client_only" (regla 9). ' +
    'Solo cuando sea "record_confirm", añade además "prefill_value":"<dato concreto>" y ' +
    '"evidence_refs":[{"document":"<slug>","span":"<cita verbatim del expediente>"}].'
  );
}

const QUESTIONNAIRE_STUB_PROPOSAL: SegmentationProposal = {
  groups: [
    {
      title_i18n: { es: "Profundicemos en tu historia", en: "Let's go deeper into your story" },
      position: 0,
      questions: [
        { key: "q1", question_i18n: { es: "¿En qué fecha y lugar ocurrió el hecho más grave que describiste?", en: "On what date and where did the most serious event you described happen?" }, field_type: "textarea", source: "client_answer", is_required: true, position: 0 },
        { key: "q2", question_i18n: { es: "¿Quiénes fueron testigos y qué pasó después?", en: "Who witnessed it and what happened afterward?" }, field_type: "textarea", source: "client_answer", is_required: false, position: 1 },
      ],
    },
  ],
};

/** Options for {@link materializeProposalToSchema}. */
export interface MaterializeOptions {
  /**
   * The schema currently stored on the instance. Questions whose `question_key`
   * matches one already there REUSE its uuid, so answers the client has already
   * given survive a regeneration instead of being orphaned (D2b).
   */
  previousSchema?: QuestionnaireSchema | null;
  /**
   * The case record the proposal was generated from (extraction raw_text +
   * previous answers). Every `record_confirm` claim is checked against THIS text;
   * without it, no prefill can be verified and all such claims degrade.
   */
  recordCorpus?: string | null;
}

/**
 * Turns an AI SegmentationProposal into the immutable per-case schema: assigns a
 * stable uuid per group/question (answers key off these, surviving regeneration)
 * and resolves each condition's `key` reference to the real uuid (dropping
 * unresolved / self references — fail-safe). Pure except for uuid minting.
 *
 * Two Wave-1 responsibilities beyond shaping:
 *  - IDENTITY (D2b): reuse the previous uuid for a question that comes back, keyed
 *    by `question_key` (normalized text), regardless of group or position.
 *  - CONTRACT (D2): verify each `answerable_from` claim against the record via
 *    `resolveAnswerableFrom`. Verification only degrades; a degraded question
 *    becomes required so the client must answer what the record cannot.
 */
export function materializeProposalToSchema(
  proposal: SegmentationProposal,
  opts: MaterializeOptions = {},
): QuestionnaireSchema {
  const keyToId = new Map<string, string>();
  const withRaw: Array<{ q: GeneratedQuestion; raw: ProposedQuestion["condition"] }> = [];

  // question_key → uuid from the instance being replaced.
  const previousIds = new Map<string, string>();
  for (const g of opts.previousSchema?.groups ?? []) {
    for (const q of g.questions ?? []) {
      const key = q.question_key || questionKeyOf(q.question_i18n?.es ?? "");
      if (key && !previousIds.has(key)) previousIds.set(key, q.id);
    }
  }
  const corpus = opts.recordCorpus ?? "";

  const groups: GeneratedGroup[] = proposal.groups.map((g, gi) => {
    const questions = (g.questions ?? []).map((pq, qi): GeneratedQuestion => {
      const questionI18n = normalizeI18n(pq.question_i18n);
      const questionKey = questionKeyOf(questionI18n.es);
      const id = previousIds.get(questionKey) ?? randomUUID();
      if (typeof pq.key === "string" && pq.key) keyToId.set(pq.key, id);
      const ft = QUESTIONNAIRE_FIELD_TYPES.includes(pq.field_type as QuestionnaireFieldType)
        ? (pq.field_type as QuestionnaireFieldType)
        : "textarea";
      const options = Array.isArray(pq.options)
        ? pq.options.map((o) => ({ value: String(o.value), label_i18n: normalizeI18n(o.label_i18n) }))
        : null;
      // default_value only survives when it maps to a REAL option (selects) or
      // the question is free-text — a hallucinated option value must never
      // pre-answer a question with something the client can't even pick.
      const rawDefault =
        typeof pq.default_value === "string" && pq.default_value.trim() !== ""
          ? pq.default_value.trim()
          : null;
      const defaultValue =
        rawDefault && (ft === "select" || ft === "checkbox")
          ? (options?.some((o) => o.value === rawDefault) ? rawDefault : null)
          : rawDefault;
      const verdict = resolveAnswerableFrom({
        claimed: pq.answerable_from,
        prefillValue: typeof pq.prefill_value === "string" ? pq.prefill_value : null,
        evidenceRefs: Array.isArray(pq.evidence_refs) ? pq.evidence_refs : null,
        corpus,
      });
      const degraded = pq.answerable_from === "record_confirm" && verdict.answerableFrom !== "record_confirm";
      const q: GeneratedQuestion = {
        id,
        question_key: questionKey,
        question_i18n: questionI18n,
        help_i18n: pq.help_i18n ? normalizeI18n(pq.help_i18n) : null,
        field_type: ft,
        options,
        // A claim the record could not back becomes the client's to answer, so it
        // must be required — otherwise a degraded question silently disappears
        // from the gate and the brief is written without it.
        is_required: degraded ? true : (pq.is_required ?? false),
        position: pq.position ?? qi,
        source: "client_answer",
        validation: pq.validation ?? null,
        condition: null,
        default_value: defaultValue,
        answerable_from: verdict.answerableFrom,
        prefill_value: verdict.prefillValue,
      };
      withRaw.push({ q, raw: pq.condition ?? null });
      return q;
    });
    return { id: randomUUID(), title_i18n: normalizeI18n(g.title_i18n ?? g.title), position: g.position ?? gi, questions };
  });

  const mintedIds = new Set(keyToId.values());
  for (const { q, raw } of withRaw) {
    if (!raw || typeof raw !== "object" || !raw.when) continue;
    const keyRef = typeof raw.when.question === "string" ? raw.when.question : "";
    const resolvedId = keyToId.get(keyRef) ?? (mintedIds.has(keyRef) ? keyRef : undefined);
    if (!resolvedId || resolvedId === q.id) continue;
    q.condition = parseConditionOrNull({
      when: { question: resolvedId, op: raw.when.op, value: raw.when.value },
      action: raw.action,
      lock_message_i18n: raw.lock_message_i18n ?? null,
    });
  }

  return { groups };
}

/**
 * Runs the AI question generator against a case's resolved inputs. Web search is
 * OFF (privacy: never send client facts to a search engine). Never throws —
 * returns an empty schema on failure so the job can mark the instance failed.
 */
async function generateCaseQuestionnaire(input: {
  config: QuestionnaireGenConfigRow;
  inputs: ResolvedInputs;
  alreadyCovered: string[];
  /** Posture prompt fragment resolved from the case (Wave 2). */
  posturePlaybook?: string | null;
  /** Schema of the instance being replaced — lets question ids (and therefore the
   *  client's existing answers) survive the regeneration. */
  previousSchema?: QuestionnaireSchema | null;
}): Promise<{ schema: QuestionnaireSchema; model: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const model = input.config.model || DEFAULT_GENERATION_MODEL;
  // The exact text the model was shown IS the corpus every record_confirm claim
  // is verified against — deriving it any other way would let a prefill validate
  // against something the model never actually read.
  const recordCorpus = buildQuestionGenContext(input.inputs, []);
  const materializeOpts: MaterializeOptions = { previousSchema: input.previousSchema ?? null, recordCorpus };
  if (isAiStubEnabled()) {
    return { schema: materializeProposalToSchema(QUESTIONNAIRE_STUB_PROPOSAL, materializeOpts), model, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }
  const system = buildQuestionnaireGenSystem(input.config, input.posturePlaybook);
  // target_question_count questions as bilingual (es/en) JSON — each with help,
  // options, validation, condition, and grounded prefills — is a large payload.
  // 8000 tokens truncated it mid-object for an 18-question hybrid over a full
  // asylum record: the JSON parsed to nothing and surfaced as the useless
  // "generator returned no questions". Give the schema real headroom, and widen
  // the client timeout to match (still under the 280s job endpoint timeout).
  const baseUser = buildQuestionGenContext(input.inputs, input.alreadyCovered) + questionGenOutputInstructions(input.config.target_question_count);
  const client = getAnthropicClient();

  // The generator is non-deterministic: the SAME record intermittently returns
  // `groups:[]` or non-JSON, then yields a valid schema on a re-ask (seen in
  // prod: 3 empty responses before success). A single shot let one flaky
  // response fail the whole questionnaire with no recovery — the drafts pass
  // already retries, so the schema call must too. `max_tokens` is NOT retried:
  // it is a size/config problem (re-asking truncates again), so it surfaces
  // immediately. Usage accumulates across attempts so cost stays honest (RNF-041).
  const QUESTION_GEN_ATTEMPTS = 3;
  let usageAccum: AnthropicUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  let lastReason = "";
  for (let attempt = 0; attempt < QUESTION_GEN_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleepBackoff(attempt);
    const user =
      attempt === 0
        ? baseUser
        : `${baseUser}\n\nYour previous response yielded no questions (${lastReason}). ` +
          `Return ONLY the JSON object with a NON-EMPTY "groups" array that follows the schema.`;
    const r = await callAnthropic(client, { model, system, user, maxTokens: 16000, timeoutMs: 270_000 });
    usageAccum = addUsage(usageAccum, r.usage);
    // A truncated response must NOT masquerade as "the model returned nothing",
    // and must NOT be retried (it would truncate again): throw the real reason.
    if (r.stopReason === "max_tokens") {
      throw new Error(`questionnaire generation truncated at max_tokens (${r.text.length} chars) — raise maxTokens`);
    }
    const parsed = stripFencesAndParse<{ groups?: ProposedGroup[] }>(r.text);
    if (!parsed || !Array.isArray(parsed.groups)) {
      lastReason = `not parseable JSON (stop=${r.stopReason}, ${r.text.length} chars)`;
      continue;
    }
    if (parsed.groups.length === 0) {
      lastReason = `empty groups (stop=${r.stopReason})`;
      continue;
    }
    const proposal: SegmentationProposal = { groups: parsed.groups };
    return {
      schema: materializeProposalToSchema(proposal, materializeOpts),
      model,
      inputTokens: usageAccum.inputTokens,
      outputTokens: usageAccum.outputTokens,
      costUsd: computeAnthropicCost(usageAccum, model) ?? 0,
    };
  }
  // Every attempt produced empty/unparseable output — surface the true cause. A
  // valid record never legitimately yields zero questions, so this is a real
  // failure, not "nothing to ask".
  throw new Error(
    `questionnaire generator produced no usable questions after ${QUESTION_GEN_ATTEMPTS} attempts — last: ${lastReason}`,
  );
}

// ---------------------------------------------------------------------------
// Draft answers (autofill total) — second pass after materialization
// ---------------------------------------------------------------------------

const QUESTIONNAIRE_DRAFT_SYSTEM_BASE =
  "Eres un paralegal experto en inmigración. REDACTA BORRADORES DE RESPUESTA a un cuestionario del cliente, " +
  "usando EXCLUSIVAMENTE la información del expediente (documentos y respuestas previas) que se te da. " +
  "El cliente revisará y editará cada borrador antes de enviarlo.\n\n" +
  "REGLAS ABSOLUTAS:\n" +
  '1. SOLO datos presentes en el expediente. Si la respuesta a una pregunta NO consta, devuelve cadena vacía "" — ' +
  "NUNCA inventes hechos, fechas, nombres ni lugares.\n" +
  "2. Preguntas con opciones (select/checkbox): responde con el `value` EXACTO de una opción, y solo cuando el " +
  "expediente lo respalde (p. ej. si el expediente no menciona evidencia nueva, la respuesta a '¿tienes evidencia " +
  'nueva?' + "' es la opción negativa). Sin respaldo, cadena vacía.\n" +
  "3. Fechas: formato AAAA-MM-DD; solo si constan en el expediente.\n" +
  "4. El expediente puede traer números de identificación ENMASCARADOS (aparecen como •••). NUNCA copies esos " +
  "símbolos al borrador: reformula la frase sin el número.\n" +
  "5. Escribe en ESPAÑOL, en primera persona (voz del cliente), tono claro y honesto, 1-4 frases por respuesta " +
  "narrativa (el cliente ampliará al revisar).\n" +
  "6. Cero relleno: un borrador vacío es mejor que uno especulativo.";

interface DraftableQuestion {
  id: string;
  question: string;
  help: string | null;
  fieldType: string;
  options: Array<{ value: string; label: string }> | null;
  isRequired: boolean;
}

function draftAnswersOutputInstructions(): string {
  return (
    "\n\n## FORMATO DE SALIDA\n" +
    'Devuelve SOLO JSON con esta forma: {"answers":[{"id":"<uuid de la pregunta>","value":"<borrador o cadena vacía>"}]}. ' +
    "Incluye una entrada por CADA pregunta listada, en el mismo orden."
  );
}

function draftableQuestionLine(q: DraftableQuestion): string {
  const opts = q.options?.length
    ? ` | opciones: ${q.options.map((o) => o.value).join(", ")}`
    : "";
  const help = q.help ? ` | ayuda: ${q.help}` : "";
  return `- id: ${q.id} | tipo: ${q.fieldType}${opts}${q.isRequired ? " | requerida" : ""} | ${q.question}${help}`;
}

/** Fail-safe filter: unknown ids, empty values, PII mask tokens and select
 *  values outside the question's options are dropped (never shown to a client). */
export function filterDraftAnswers(
  raw: Array<{ id?: unknown; value?: unknown }> | null | undefined,
  questions: DraftableQuestion[],
): Record<string, string> {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const drafts: Record<string, string> = {};
  for (const a of raw ?? []) {
    const q = byId.get(String(a?.id ?? ""));
    if (!q) continue;
    const value = typeof a?.value === "string" ? a.value.trim() : "";
    if (!value) continue;
    if (value.includes("•") || value.includes("⟦") || value.includes("⟧")) continue;
    if (q.fieldType === "select" || q.fieldType === "checkbox") {
      if (!q.options?.some((o) => o.value === value)) continue;
    }
    drafts[q.id] = value;
  }
  return drafts;
}

/**
 * REMOVED in Wave 1 — `QUESTIONNAIRE_GAP_RESOLUTION_ADDENDUM`.
 *
 * A second pass used to take every question the record could not answer and
 * resolve it "honestly" so coverage would reach 100%. For free text that meant a
 * first-person sentence like "Por ahora no cuento con este documento." In case
 * U26-000038 it produced 15 of 25 answers; the completeness gate accepted them,
 * staff approved the form, and those sentences flowed into the appeal brief as
 * the client's own testimony about her hearing.
 *
 * The addendum is DELETED rather than moved behind a config flag: it existed only
 * so the gate could close, and the gate no longer counts fabricated answers.
 * The legitimate part of its job — picking a real negative option when the record
 * shows the client has no such evidence — is already covered by `default_value`
 * (validated against the question's real options in materializeProposalToSchema)
 * and lands as `schema_default`, not as invented prose.
 */

/**
 * Drafts one grounded answer per client question from the same masked case
 * context the question generator used. Throws on provider failure — the caller
 * treats the whole pass as best-effort.
 *
 * Single pass by design: a question the record cannot answer stays EMPTY and is
 * surfaced to the client as theirs to answer.
 */
async function generateQuestionnaireDraftAnswers(input: {
  config: QuestionnaireGenConfigRow;
  inputs: ResolvedInputs;
  questions: DraftableQuestion[];
}): Promise<{ drafts: Record<string, string>; inputTokens: number; outputTokens: number; costUsd: number }> {
  const model = input.config.model || DEFAULT_GENERATION_MODEL;
  if (isAiStubEnabled()) {
    const drafts: Record<string, string> = {};
    for (const q of input.questions) {
      drafts[q.id] =
        q.fieldType === "date"
          ? "2026-01-15"
          : q.options?.length
            ? q.options[0].value
            : "Borrador de respuesta (stub IA) basado en tu expediente.";
    }
    return { drafts, inputTokens: 0, outputTokens: 0, costUsd: 0 };
  }

  const extra = input.config.draft_answers_prompt?.trim();
  const system = extra
    ? `${QUESTIONNAIRE_DRAFT_SYSTEM_BASE}\n\nINSTRUCCIONES ADICIONALES DEL SERVICIO:\n${extra}`
    : QUESTIONNAIRE_DRAFT_SYSTEM_BASE;
  const user =
    buildQuestionGenContext(input.inputs, []) +
    "\n\n## PREGUNTAS A RESPONDER (redacta el borrador de cada una)\n" +
    input.questions.map(draftableQuestionLine).join("\n") +
    draftAnswersOutputInstructions();

  const client = getAnthropicClient();
  const r = await callAnthropic(client, { model, system, user, maxTokens: 8000, timeoutMs: 240_000 });
  const parsed = stripFencesAndParse<{ answers?: Array<{ id?: unknown; value?: unknown }> }>(r.text);
  return {
    drafts: filterDraftAnswers(parsed?.answers, input.questions),
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    costUsd: computeAnthropicCost(r.usage, model) ?? 0,
  };
}

export interface QuestionnairePrereqStatus {
  ok: boolean;
  missingForms: string[];
  missingDocuments: string[];
}

/** Evaluates whether a case meets a questionnaire's (admin-configured) prerequisites. */
export async function evaluateQuestionnairePrereqs(
  caseId: string,
  partyId: string | null,
  config: QuestionnaireGenConfigRow,
): Promise<QuestionnairePrereqStatus> {
  const missingForms: string[] = [];
  if (config.prerequisite_form_slugs.length > 0) {
    const done = await findSubmittedFormSlugs(caseId, config.prerequisite_form_slugs, partyId);
    for (const slug of config.prerequisite_form_slugs) if (!done.has(slug)) missingForms.push(slug);
  }
  let missingDocuments: string[] = [];
  if (config.prerequisite_document_slugs.length > 0) {
    // A document counts as present only with a completed extraction (resolveGenerationInputs).
    const resolved = await resolveGenerationInputs(caseId, partyId, [], config.prerequisite_document_slugs);
    const present = new Set(resolved.documents.map((d) => d.slug));
    missingDocuments = config.prerequisite_document_slugs.filter((s) => !present.has(s));
  }
  return { ok: missingForms.length === 0 && missingDocuments.length === 0, missingForms, missingDocuments };
}

/**
 * document.uploaded watcher — the `on_new_evidence` consumer. When a NEW
 * document lands on a slug that feeds a per-case questionnaire whose current
 * instance is already READY:
 *  - `flag`  → mark the instance `stale`. The wizard keeps working — cases
 *    treats ready|stale alike — the flag just tells staff/client the questions
 *    predate the newest evidence and a regeneration is warranted.
 *  - `auto`  → REGENERATE, but ONLY when the client has not typed anything of
 *    their own (saved answers are empty or all AI-materialized drafts): a
 *    regeneration mints new question uuids, so auto-running over real client
 *    work would orphan it. With client edits it degrades to `flag`.
 *  - `never` → leave the instance untouched.
 * Best-effort: never throws (event path).
 */
export async function flagQuestionnairesOnNewEvidence(
  caseId: string,
  caseDocumentId: string,
): Promise<void> {
  try {
    const meta = await findCaseDocumentMeta(caseDocumentId);
    if (!meta?.requirementSlug) return;
    const instances = await listCurrentReadyQuestionnaireInstances(caseId);
    for (const inst of instances) {
      if ((inst.party_id ?? null) !== (meta.partyId ?? null)) continue;
      const config = await findQuestionnaireGenerationConfig(inst.form_definition_id);
      if (!config || config.mode === "global" || config.on_new_evidence === "never") continue;
      if (!config.input_document_slugs.includes(meta.requirementSlug)) continue;
      const snapshot = (inst.inputs_snapshot ?? {}) as {
        documents?: Array<{ case_document_id?: string }>;
      };
      const known = new Set((snapshot.documents ?? []).map((d) => d.case_document_id));
      if (known.has(caseDocumentId)) continue;

      if (config.on_new_evidence === "auto") {
        const respMeta = await findFormResponseAnswersMeta(caseId, inst.form_definition_id, inst.party_id ?? null);
        const draftIds = new Set(respMeta?.aiDraftQuestionIds ?? []);
        const clientEdited =
          !!respMeta &&
          Object.entries(respMeta.answers).some(
            ([qid, v]) => v !== null && v !== "" && !draftIds.has(qid),
          );
        if (!clientEdited) {
          const r = await startQuestionnaireGenerationCore(caseId, inst.form_definition_id, inst.party_id ?? null);
          logger.info(
            { caseId, instanceId: inst.id, slug: meta.requirementSlug, outcome: r.status },
            "ai-engine: on_new_evidence=auto → regeneration kicked",
          );
          continue;
        }
        logger.info(
          { caseId, instanceId: inst.id },
          "ai-engine: on_new_evidence=auto but client already edited — degrading to stale flag",
        );
      }

      await updateQuestionnaireInstance(inst.id, { status: "stale", updated_at: new Date().toISOString() });
      logger.info(
        { caseId, instanceId: inst.id, slug: meta.requirementSlug, caseDocumentId },
        "ai-engine: questionnaire instance flagged stale (new evidence)",
      );
    }
  } catch (err) {
    logger.warn({ err, caseId, caseDocumentId }, "ai-engine: flagQuestionnairesOnNewEvidence failed (non-fatal)");
  }
}

/** Reads the current questionnaire instance (consumed by cases.getFormForClient). */
export async function getCurrentQuestionnaireInstance(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<QuestionnaireInstanceRow | null> {
  return findCurrentQuestionnaireInstance(caseId, formDefinitionId, partyId);
}

export type QuestionnaireMode = "global" | "automatic" | "hybrid";
/**
 * A 'queued' instance normally flips to 'generating' within seconds of QStash
 * delivery. If it hasn't within this window its dispatch was dropped/lost and the
 * row is STUCK — recovery must re-dispatch a fresh instance. Single source of truth
 * for both the generation guard (startQuestionnaireGenerationCore) and the client
 * auto-trigger signal (getQuestionnaireClientState.stuckQueued).
 */
const QUESTIONNAIRE_QUEUED_STALE_MS = 180_000;
export interface QuestionnaireClientState {
  mode: QuestionnaireMode;
  /** false when the questionnaire has no config or is global (render base questions). */
  isDynamic: boolean;
  hybridLayout: "append_group" | "merge_by_topic";
  autoTrigger: boolean;
  allowClientTrigger: boolean;
  instance: QuestionnaireInstanceRow | null;
  /**
   * true when `instance` is a 'queued' row past the staleness window — its dispatch
   * was lost, so the client-side auto-trigger must treat it like a failed instance
   * and re-kick generation (the generation guard then re-dispatches a fresh one).
   */
  stuckQueued: boolean;
  /** Only computed when there is no ready instance yet. */
  prereqs: QuestionnairePrereqStatus | null;
}

/**
 * One-shot read of everything cases.getFormForClient needs to decide how to render
 * a questionnaire: its mode, the current instance (if any), and — when nothing is
 * ready yet — whether prerequisites are met. Global questionnaires report
 * isDynamic=false so the caller keeps the existing published-version path.
 */
export async function getQuestionnaireClientState(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<QuestionnaireClientState> {
  const config = await findQuestionnaireGenerationConfig(formDefinitionId);
  if (!config || config.mode === "global") {
    return {
      mode: "global", isDynamic: false, hybridLayout: "append_group",
      autoTrigger: false, allowClientTrigger: false, instance: null, stuckQueued: false, prereqs: null,
    };
  }
  const instance = await findCurrentQuestionnaireInstance(caseId, formDefinitionId, partyId);
  const stuckQueued =
    instance?.status === "queued" &&
    Date.now() - new Date(instance.updated_at).getTime() > QUESTIONNAIRE_QUEUED_STALE_MS;
  // A stuck 'queued' row is a dead instance for prereq purposes too — recompute so the
  // client can re-trigger against fresh prerequisites.
  const needsPrereqCheck =
    !instance || instance.status === "pending_prereqs" || instance.status === "failed" || stuckQueued;
  const prereqs = needsPrereqCheck ? await evaluateQuestionnairePrereqs(caseId, partyId, config) : null;
  return {
    mode: config.mode as QuestionnaireMode,
    isDynamic: true,
    hybridLayout: (config.hybrid_layout as "append_group" | "merge_by_topic") ?? "append_group",
    autoTrigger: config.auto_trigger,
    allowClientTrigger: config.allow_client_trigger,
    instance,
    stuckQueued,
    prereqs,
  };
}

/**
 * Kicks off per-case questionnaire generation (API-AI-QN-01). No-op for global
 * mode. If prerequisites aren't met, records a pending_prereqs marker and returns
 * without enqueuing. Otherwise freezes the resolved inputs, creates a queued
 * instance, and enqueues the generate-questionnaire job. Idempotent: an already
 * queued/generating current instance short-circuits.
 */
export async function startQuestionnaireGeneration(
  actor: Actor,
  input: { caseId: string; formDefinitionId: string; partyId?: string | null },
): Promise<{ status: "skipped" | "pending_prereqs" | "queued" | "in_progress"; instanceId?: string; missing?: QuestionnairePrereqStatus }> {
  await requireCaseAccess(actor, input.caseId);
  return startQuestionnaireGenerationCore(input.caseId, input.formDefinitionId, input.partyId ?? null);
}

/**
 * Actor-less core shared by the client/staff trigger (startQuestionnaireGeneration,
 * which authorizes first) and the on_new_evidence=auto event consumer (already
 * case-scoped — the event carries a verified caseId).
 */
async function startQuestionnaireGenerationCore(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<{ status: "skipped" | "pending_prereqs" | "queued" | "in_progress"; instanceId?: string; missing?: QuestionnairePrereqStatus }> {
  const config = await findQuestionnaireGenerationConfig(formDefinitionId);
  if (!config || config.mode === "global") return { status: "skipped" };

  const current = await findCurrentQuestionnaireInstance(caseId, formDefinitionId, partyId);
  // A 'generating' instance is reprocessed by its OWN QStash retries (crash-safe), so
  // it always counts as in-progress. A 'queued' instance that never started within the
  // staleness window is STUCK (its dispatch was dropped/failed) and must NOT block
  // recovery forever — fall through to re-dispatch a fresh instance. (A 'queued' row
  // normally flips to 'generating' within seconds of delivery.)
  const queuedStuck =
    current?.status === "queued" &&
    Date.now() - new Date(current.updated_at).getTime() > QUESTIONNAIRE_QUEUED_STALE_MS;
  if (current && (current.status === "generating" || current.status === "queued") && !queuedStuck) {
    return { status: "in_progress", instanceId: current.id };
  }

  const prereq = await evaluateQuestionnairePrereqs(caseId, partyId, config);
  if (!prereq.ok) {
    if (!current || current.status !== "pending_prereqs") {
      const version = await nextQuestionnaireInstanceVersion(caseId, formDefinitionId, partyId);
      await createQuestionnaireInstance({
        case_id: caseId, form_definition_id: formDefinitionId, party_id: partyId,
        status: "pending_prereqs", version, mode: config.mode,
      });
    }
    return { status: "pending_prereqs", missing: prereq };
  }

  const resolved = await resolveGenerationInputs(caseId, partyId, config.input_form_slugs, config.input_document_slugs);
  const version = await nextQuestionnaireInstanceVersion(caseId, formDefinitionId, partyId);
  const instance = await createQuestionnaireInstance({
    case_id: caseId, form_definition_id: formDefinitionId, party_id: partyId,
    status: "queued", version, mode: config.mode,
    inputs_snapshot: resolved as unknown as import("@/shared/database.types").Json,
    model: config.model,
  });

  // Dedupe PER INSTANCE (the freshly-inserted row's id), NOT per (case, form,
  // party) — otherwise QStash's publish-dedup window (~10 min) SILENTLY DROPS every
  // retry/regeneration launched within that window (a failed generation the client
  // re-opens, a staff "regenerate", new evidence), leaving the new instance stuck in
  // 'queued' forever. Double-dispatch is already prevented WITHOUT the dedup: the
  // status guard at the top (queued/generating → return in_progress) coalesces
  // sequential double-opens, and the job runner resolves the CURRENT instance and
  // short-circuits on a terminal/in-flight status, so even a true race processes the
  // live instance exactly once. (Mirrors enqueueLexReindex's per-attempt dedupeId.)
  //
  // orgId stays omitted so the webhook takes the no-barrier path (route.ts §4, which
  // only claims when BOTH dedupeId AND orgId are present) — a PERMANENT (org,
  // dedupeId) barrier would swallow every regeneration after the first.
  const dedupeKey = `generate-questionnaire:${caseId}:${formDefinitionId}:${partyId ?? "case"}:${instance.id}`;
  await enqueueJob(
    { jobKey: "generate-questionnaire", entityId: instance.id, attempt: 1, dedupeId: dedupeKey,
      caseId, formDefinitionId, partyId },
    // 280s endpoint timeout (< route maxDuration 300s): stops QStash's 60s default
    // from retrying while the ≤240s Anthropic generation is still running.
    { retries: 2, timeout: "280s" },
  );
  return { status: "queued", instanceId: instance.id };
}

/**
 * Event-driven bootstrap of a case's auto-trigger questionnaires (ola apelación).
 * Fired on `extraction.completed`: once a prerequisite document is uploaded AND
 * extracted, proactively generate + AI-draft-fill each CASE-LEVEL auto questionnaire
 * so it is ready-and-prefilled BEFORE anyone opens it — previously the instance was
 * only seeded lazily when the CLIENT opened the questionnaire, so staff (and clients
 * who upload first) saw it empty.
 *
 * Idempotent and safe to call on every extraction: only a missing or `pending_prereqs`
 * instance is advanced (startQuestionnaireGenerationCore itself short-circuits an
 * in-flight one and only queues once prereqs are met); ready / generating / queued /
 * failed instances are left to getFormForClient + the on_new_evidence watcher. Per-party
 * questionnaires are skipped here — they self-heal lazily with the real partyId.
 */
export async function autoBootstrapCaseQuestionnaires(caseId: string): Promise<void> {
  const forms = await listAutoQuestionnaireFormsForCase(caseId);
  for (const f of forms) {
    if (f.isPerParty) continue;
    try {
      const current = await findCurrentQuestionnaireInstance(caseId, f.formDefinitionId, null);
      if (current && current.status !== "pending_prereqs") continue;
      await startQuestionnaireGenerationCore(caseId, f.formDefinitionId, null);
    } catch (err) {
      logger.warn(
        { err, caseId, formDefinitionId: f.formDefinitionId },
        "ai-engine: autoBootstrapCaseQuestionnaires failed for one form",
      );
    }
  }
}

export interface GenerateQuestionnairePayload {
  jobKey: "generate-questionnaire";
  entityId: string;
  attempt: number;
  dedupeId: string;
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
  orgId?: string;
}

/**
 * Job runner (generate-questionnaire). Resolves the CURRENT instance for the
 * (case, form, party), runs the generator, and marks it ready (or failed).
 * Retry-safe: a crash mid-generation leaves status 'generating', which a QStash
 * retry REPROCESSES (rather than skipping) — mirrors executeExtractionJob's
 * treatment of 'pending'. Terminal states (ready/failed) short-circuit.
 */
export async function executeQuestionnaireGenerationJob(payload: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
}): Promise<string> {
  const instance = await findCurrentQuestionnaireInstance(payload.caseId, payload.formDefinitionId, payload.partyId);
  if (!instance) return "instance-not-found";
  if (instance.status !== "queued" && instance.status !== "generating") return `skipped-${instance.status}`;

  await updateQuestionnaireInstance(instance.id, { status: "generating" });
  try {
    const config = await findQuestionnaireGenerationConfig(instance.form_definition_id);
    if (!config) throw new Error("questionnaire generation config missing");

    const snapshot = (instance.inputs_snapshot ?? { documents: [], forms: [] }) as unknown as ConfigSnapshot["resolved_inputs"];
    const inputs = await loadResolvedInputs({ resolved_inputs: snapshot } as ConfigSnapshot);

    const alreadyCovered = config.mode === "hybrid"
      ? await listPublishedQuestionTexts(instance.form_definition_id)
      : [];

    // Recover the schema of the instance this regeneration replaces so question
    // ids — and the answers keyed off them — survive (D2b). The row the job fills
    // is freshly inserted (startQuestionnaireGeneration bumps the version and
    // flips is_current), so it starts schema-less; fall back to the previous
    // version's schema. On a first-ever generation there is none, and every id is
    // legitimately new.
    const previousSchema = ((instance.schema as unknown) ??
      (await findPreviousQuestionnaireSchema(
        instance.case_id,
        instance.form_definition_id,
        instance.party_id ?? null,
        instance.version,
      ))) as QuestionnaireSchema | null;
    // Posture is resolved on extraction.completed; read it here so a regeneration
    // always reflects the latest known posture of the case.
    const casesMod = (await import("@/backend/modules/cases")) as {
      getCasePosturePlaybook: (caseId: string) => Promise<string | null>;
    };
    const posturePlaybook = await casesMod.getCasePosturePlaybook(instance.case_id);
    const result = await generateCaseQuestionnaire({ config, inputs, alreadyCovered, previousSchema, posturePlaybook });
    if (result.schema.groups.length === 0) throw new Error("generator returned no questions");

    // Draft answers (autofill total) — over the FINAL question list: generated
    // uuids exist only after materialization, and the hybrid base questions come
    // from the published version. TWO passes: (1) grounded drafts from the
    // expediente; (2) gap resolution for whatever pass 1 left empty (negative
    // options / honest unavailability — issue: dynamic evidence questions must
    // land as "no aplica", never blank). A drafting failure never blocks the
    // questionnaire (ready without drafts) but it is NOT silent: the error is
    // persisted on the instance and questionnaire.drafts_failed notifies staff.
    let draftAnswers: Record<string, string> | null = null;
    let draftUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
    let draftsError: string | null = null;
    if (config.draft_answers_enabled) {
      const generatedQs: DraftableQuestion[] = result.schema.groups.flatMap((g) =>
        g.questions.map((q) => ({
          id: q.id,
          question: q.question_i18n.es || q.question_i18n.en,
          help: q.help_i18n?.es ?? null,
          fieldType: q.field_type,
          options: q.options?.map((o) => ({ value: o.value, label: o.label_i18n.es || o.label_i18n.en })) ?? null,
          isRequired: q.is_required,
        })),
      );
      // Deterministically resolved already — no LLM budget spent on them, and
      // their provenance is schema_default, not an AI draft.
      const defaultedIds = new Set(
        result.schema.groups.flatMap((g) => g.questions.filter((q) => q.default_value).map((q) => q.id)),
      );
      // Verified one-tap prefills (record_confirm): the client confirms these,
      // so drafting prose for them would be wasted tokens and a second source of truth.
      const prefilledIds = new Set(
        result.schema.groups.flatMap((g) =>
          g.questions.filter((q) => q.answerable_from === "record_confirm" && q.prefill_value).map((q) => q.id),
        ),
      );
      // `client_only` lives solely in the client's memory. Asking the model for a
      // draft can only produce a fabricated one — exactly the failure being fixed.
      const clientOnlyIds = new Set(
        result.schema.groups.flatMap((g) =>
          g.questions.filter((q) => q.answerable_from === "client_only").map((q) => q.id),
        ),
      );
      const baseQs: DraftableQuestion[] =
        config.mode === "hybrid"
          ? (await listPublishedClientQuestionsForDrafts(instance.form_definition_id)).map((q) => ({
              id: q.id,
              question: q.question_i18n?.es ?? q.question_i18n?.en ?? "",
              help: q.help_i18n?.es ?? null,
              fieldType: q.field_type,
              options:
                q.options?.map((o) => ({
                  value: o.value,
                  label: o.label_i18n?.es ?? o.label_i18n?.en ?? o.value,
                })) ?? null,
              isRequired: q.is_required,
            }))
          : [];
      const draftables = [...baseQs, ...generatedQs].filter(
        (q) => q.question && !clientOnlyIds.has(q.id) && !prefilledIds.has(q.id) && !defaultedIds.has(q.id),
      );
      if (draftables.length > 0) {
        // 2 attempts with backoff — a transient Anthropic hiccup must not leave
        // the client typing everything by hand.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) await sleepBackoff(attempt);
          try {
            const res = await generateQuestionnaireDraftAnswers({ config, inputs, questions: draftables });
            draftUsage = { inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: res.costUsd };
            const drafts = res.drafts;

            // Wave 1: NO second pass. A question the record cannot answer stays
            // empty and reaches the client as theirs to answer. Manufacturing a
            // "no tengo información" sentence here is what let a 36%-covered
            // questionnaire pass the gate and reach the appeal brief.
            draftAnswers = Object.keys(drafts).length > 0 ? drafts : null;
            draftsError = null;
            break;
          } catch (err) {
            draftsError = `DRAFTS_FAILED: ${err instanceof Error ? err.message : String(err)}`;
            logger.warn({ err, attempt, instanceId: instance.id }, "ai-engine: draft answers pass failed");
          }
        }
      }
    }

    // Provenance is written HERE and only here — the generation job is the single
    // authoritative writer, so submit/edit paths can copy it without drift.
    // Anything not listed stays absent, which reads as "unanswered" downstream.
    const draftProvenance: Record<string, AnswerProvenance> = {};
    for (const g of result.schema.groups) {
      for (const q of g.questions) {
        if (q.answerable_from === "record_confirm" && q.prefill_value) {
          // Not answered yet: the client still has to tap Confirm. It becomes
          // client_confirmed at that point (or client_edited if they correct it).
          continue;
        }
        if (q.default_value) draftProvenance[q.id] = "schema_default";
      }
    }
    for (const qid of Object.keys(draftAnswers ?? {})) {
      // Every surviving draft came from the single grounded pass.
      draftProvenance[qid] = "ai_grounded";
    }

    await updateQuestionnaireInstance(instance.id, {
      status: "ready",
      schema: result.schema as unknown as import("@/shared/database.types").Json,
      draft_answers: draftAnswers as unknown as import("@/shared/database.types").Json,
      draft_provenance: draftProvenance as unknown as import("@/shared/database.types").Json,
      model: result.model,
      input_tokens: result.inputTokens + draftUsage.inputTokens,
      output_tokens: result.outputTokens + draftUsage.outputTokens,
      cost_usd: result.costUsd + draftUsage.costUsd,
      generated_at: new Date().toISOString(),
      // ready-with-failed-drafts keeps the error visible (admin chip + event) —
      // the questionnaire works, but staff knows autofill needs a regenerate.
      error: draftsError,
    });

    if (draftsError) {
      appEvents.emit({
        type: "questionnaire.drafts_failed",
        payload: {
          caseId: instance.case_id,
          formDefinitionId: instance.form_definition_id,
          partyId: instance.party_id ?? null,
          instanceId: instance.id,
        },
        occurredAt: new Date(),
      });
    }
    return "ready";
  } catch (err) {
    await updateQuestionnaireInstance(instance.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    logger.error({ err, instanceId: instance.id }, "ai-engine: executeQuestionnaireGenerationJob failed");
    return "failed";
  }
}

/** Cases reads the anchored instance's drafts at submit time (materialization
 *  with provenance) — re-exported so the module border stays index→service. */
export { getQuestionnaireInstanceDrafts } from "./repository";

/**
 * Flat list of a questionnaire instance's generated questions (schema JSON),
 * shaped for validation (id / field_type / options / is_required / validation /
 * condition / default_value). Consumed by cases' completeness check — the
 * schema jsonb stays owned by this module. Null = no instance / no schema.
 */
export async function getQuestionnaireInstanceSchemaQuestions(
  instanceId: string,
): Promise<GeneratedQuestion[] | null> {
  const inst = await findQuestionnaireInstanceById(instanceId);
  const schema = (inst?.schema ?? null) as { groups?: Array<{ questions?: GeneratedQuestion[] }> } | null;
  if (!schema?.groups) return null;
  return schema.groups.flatMap((g) => g.questions ?? []);
}

/**
 * Full autofill view of an instance for submit-time materialization: AI drafts
 * UNION the schema's deterministic `default_value`s (drafts win). The defaults
 * guarantee "no aplica" lands as an ANSWER even when the drafting pass failed —
 * a checklist/approve gated on completeness must be able to close.
 */
export async function getQuestionnaireInstanceAutofillValues(
  instanceId: string,
): Promise<Record<string, string> | null> {
  const inst = await findQuestionnaireInstanceById(instanceId);
  if (!inst) return null;
  const drafts = ((inst.draft_answers ?? null) as Record<string, string> | null) ?? {};
  const schema = (inst.schema ?? null) as {
    groups?: Array<{ questions?: Array<{ id: string; default_value?: string | null }> }>;
  } | null;
  const out: Record<string, string> = { ...drafts };
  for (const g of schema?.groups ?? []) {
    for (const q of g.questions ?? []) {
      const dv = typeof q.default_value === "string" && q.default_value !== "" ? q.default_value : null;
      if (dv && !(out[q.id] && out[q.id].trim() !== "")) out[q.id] = dv;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The subset of autofill that COUNTS as answered for the completeness gate.
 *
 * Deliberately NOT the same as {@link getQuestionnaireInstanceAutofillValues}:
 * the wizard shows the client everything it has, but the gate certifies that a
 * form is ready to be filed. Those are different questions, and conflating them
 * is precisely how case U26-000038 was approved — the gate accepted 15 fabricated
 * "Por ahora no cuento con información" sentences because they were present, not
 * because anyone had answered.
 *
 * A value counts only when its provenance says so (see countsAsAnswered):
 *  - `ai_gap_filled` never counts — it is fabricated by definition.
 *  - `unknown` never counts — pre-migration rows are not evidence of an answer,
 *    so legacy instances re-open for review instead of silently passing.
 * Schema defaults always count: they are deterministic and were validated against
 * the question's real options, so a checklist gated on one can still close.
 */
export async function getQuestionnaireInstanceAnsweredValues(
  instanceId: string,
): Promise<Record<string, string> | null> {
  const inst = await findQuestionnaireInstanceById(instanceId);
  if (!inst) return null;
  const drafts = ((inst.draft_answers ?? null) as Record<string, string> | null) ?? {};
  const provenance = parseProvenanceMap(inst.draft_provenance);
  const schema = (inst.schema ?? null) as {
    groups?: Array<{ questions?: Array<{ id: string; default_value?: string | null }> }>;
  } | null;

  const out: Record<string, string> = {};
  for (const [qid, value] of Object.entries(drafts)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (!countsAsAnswered(provenance[qid] ?? "unknown")) continue;
    out[qid] = value;
  }
  for (const g of schema?.groups ?? []) {
    for (const q of g.questions ?? []) {
      const dv = typeof q.default_value === "string" && q.default_value !== "" ? q.default_value : null;
      if (dv && !(out[q.id] && out[q.id].trim() !== "")) out[q.id] = dv;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * job-failed callback for generate-questionnaire (DOC-26 §5). When QStash exhausts
 * retries, mark the current instance 'failed' so the client wizard shows the
 * "failed" gate state instead of being stuck at "generating" forever.
 */
export async function markQuestionnaireGenerationFailed(payload: {
  caseId: string;
  formDefinitionId: string;
  partyId: string | null;
}): Promise<void> {
  const instance = await findCurrentQuestionnaireInstance(payload.caseId, payload.formDefinitionId, payload.partyId);
  if (instance && (instance.status === "queued" || instance.status === "generating")) {
    await updateQuestionnaireInstance(instance.id, { status: "failed", error: "generation job exhausted retries" });
  }
}

/**
 * OCR/transcribes a stored document to plain text (Gemini multimodal). Used to make
 * uploaded dataset items (e.g. public won-case PDFs) injectable as reference material
 * for generation. Best-effort: returns null on failure (item kept without content).
 */
export async function extractRawTextFromStorage(input: {
  bucket: string;
  path: string;
  mimeType?: string;
}): Promise<string | null> {
  try {
    const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
    const geminiModels = getGeminiModels();
    const { createServiceClient } = await import("@/backend/platform/supabase");
    const supabase = createServiceClient();
    const { data: fileData } = await supabase.storage.from(input.bucket).download(input.path);
    if (!fileData) return null;
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    const fileBase64 = Buffer.from(fileBytes).toString("base64");
    const response = await geminiModels.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType ?? "application/pdf", data: fileBase64 } },
            {
              text:
                "Transcribe ALL text from this document verbatim as plain text. Preserve structure, headings and paragraph order. Do NOT summarize, omit or add commentary.",
            },
          ],
        },
      ],
      config: { temperature: 0, maxOutputTokens: 65536 },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * Completes a partial i18n object (es or en) using translateText.
 * The result is editable by staff before saving (DOC-42 §3.8).
 */
export async function completeI18n(
  partial: { es?: string; en?: string },
): Promise<{ es: string; en: string }> {
  if (partial.es && partial.en) return { es: partial.es, en: partial.en };

  if (partial.es && !partial.en) {
    const { text } = await translateText({ text: partial.es, direction: "es-en" });
    return { es: partial.es, en: text };
  }

  if (partial.en && !partial.es) {
    const { text } = await translateText({ text: partial.en, direction: "en-es" });
    return { es: text, en: partial.en };
  }

  throw new Error("completeI18n: at least one language must be provided");
}

// ---------------------------------------------------------------------------
// assistCatalogEditor — T2 structured outputs (DOC-42 §3.9)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M-12: tolerant JSON parse helper (strips ```json fences, retries on fail)
// ---------------------------------------------------------------------------

/**
 * Strips Markdown code fences from AI text and attempts JSON.parse.
 * Handles: ```json\n...\n```, ``` \n...\n```, and bare JSON.
 */
function stripFencesAndParse<T>(text: string): T | null {
  // Remove ```json ... ``` or ``` ... ``` fences (case-insensitive, multiline)
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/im, "")
    .replace(/\n?```\s*$/m, "")
    .trim();

  // Try parsed form first (fences stripped), then original
  for (const candidate of [stripped, text.trim()]) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // continue
    }
  }

  // Last resort: when the model wraps the JSON in prose (common once the
  // web_search tool is in play), grab the widest {...} span and parse that.
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(stripped.slice(first, last + 1)) as T;
    } catch {
      // give up
    }
  }
  return null;
}

/** A question proposed by the AI (rich shape — options/help/source/validation). */
export interface ProposedQuestion {
  /** Stable key the AI assigns so a condition can reference this question. */
  key?: string;
  question_i18n?: { es: string; en: string };
  help_i18n?: { es: string; en: string } | null;
  field_type?: string;
  options?: Array<{ value: string; label_i18n: { es: string; en: string } }> | null;
  pdf_field_name?: string | null;
  source?: string;
  source_ref?: Record<string, unknown> | null;
  is_required?: boolean;
  position?: number;
  validation?: { regex?: string; min?: number; max?: number } | null;
  /** Deterministic autofill: negative/"no aplica" option value for availability
   *  questions the expediente cannot answer (validated against options). */
  default_value?: string | null;
  /**
   * Wave 1 / D2 — the model's CLAIM about where this question can be answered
   * from ('record_confirm' | 'record' | 'client_only'). Never trusted as-is:
   * `resolveAnswerableFrom` verifies it against the record and may only degrade it.
   */
  answerable_from?: string;
  /** Proposed one-tap answer for a `record_confirm` claim. Verified in code. */
  prefill_value?: string | null;
  /** Verbatim spans the model claims back `prefill_value`. Checked against the record. */
  evidence_refs?: EvidenceRef[] | null;
  /**
   * Conditional/dynamic visibility. `when.question` references ANOTHER question's
   * `key` (the materializer resolves key → question_id). Used for the Sí/No →
   * explanation pattern and continuation/overflow blocks (e.g. the 5th child).
   */
  condition?: {
    when: { question: string; op: string; value?: string | number | boolean | string[] };
    action: string;
    lock_message_i18n?: { es: string; en: string } | null;
  } | null;
}

export interface ProposedGroup {
  title_i18n?: { es: string; en: string };
  title?: { es: string; en: string };
  position?: number;
  questions: ProposedQuestion[];
}

export interface SegmentationProposal {
  /** 1-2 sentence note on which official source(s) grounded the proposal. */
  research_summary?: string;
  groups: ProposedGroup[];
}

/**
 * Proposes form segmentation for a catalog AcroForm (RF-ADM-032 / DOC-74 §2.6).
 *
 * GROUNDED PROPOSAL: the model is given the form identity + the service it serves
 * and is instructed to FIRST research the OFFICIAL filling instructions (USCIS/EOIR)
 * and real filling guidance via the native `web_search` server tool, THEN map the
 * detected AcroForm fields into clear, client-answerable questions — with the right
 * field types, options, help text, source mapping and validation (REGLA #4 — live
 * research on every invocation).
 *
 * M-12: tolerant JSON parsing (strips fences / extracts the {...} span) + 1 retry
 * with error feedback on parse fail. Synchronous, uses Sonnet-4-6 (T2, DOC-74 §1).
 *
 * @api-id (internal — consumed by catalog module)
 */
export async function proposeFormSegmentation(
  actor: Actor,
  input: {
    detectedFields: Array<{ name: string; type: string; page: number; rect?: [number, number, number, number] }>;
    pdfText: string;
    groupScope?: string[];
    /** Form identity so the model can research the right official instructions. */
    formName?: string;
    formSlug?: string;
    /** The service (and its phase) the form is filled within. */
    serviceName?: string;
    serviceContext?: string;
    /** Whitelist of profile fields the model may map source='profile' to. */
    profileFields?: readonly string[];
    /** Soft hint: which pages of the official form this form focuses on (e.g. Part A = 1-4). */
    pageRange?: { from: number; to: number };
  },
): Promise<SegmentationProposal> {
  can(actor, "catalog", "edit");

  const editorModel = process.env.AI_EDITOR_MODEL ?? "claude-sonnet-4-6";
  const client = getAnthropicClient();

  const profileFields = input.profileFields ?? [];

  // ---------------------------------------------------------------------------
  // STEP A — RESEARCH (web_search → concise text brief). Separated from JSON
  // generation so the search reasoning doesn't compete with the structured
  // output for the token budget (the single-call variant truncated the JSON on
  // large forms). Best-effort: a failure degrades to an ungrounded proposal.
  // ---------------------------------------------------------------------------
  let researchBrief = "";
  if (input.formName || input.formSlug) {
    try {
      const researchResp = await client.messages.create(
        {
          model: editorModel,
          max_tokens: 3200,
          system:
            "You are an immigration-forms research assistant. Use web_search to find the OFFICIAL line-by-line filling instructions, then reply with a precise plain-text brief. No JSON, no markdown.",
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
          messages: [
            {
              role: "user",
              content: [
                `Research how to correctly fill the official U.S. immigration form: ${input.formName ?? input.formSlug}${input.formSlug ? ` [${input.formSlug}]` : ""}.`,
                input.serviceName ? `It is used within the service "${input.serviceName}".` : "",
                input.serviceContext ? `Service/phase context: ${input.serviceContext}` : "",
                "Prefer uscis.gov / justice.gov/eoir and reputable legal-aid guides (4-5 searches).",
                "Produce a precise brief (max ~650 words) covering, IN ORDER:",
                "- The form's Parts/sections and what each collects.",
                "- Which fields the applicant must personally provide; enumerated choices + allowed values.",
                "- STRUCTURED / REPEATING sections (e.g. address history, education history, employment",
                "  history, list of children/relatives): list the SEPARATE sub-fields each entry uses on the",
                "  official form (e.g. street, city, state/province, country, from-date, to-date) — these are",
                "  DISTINCT boxes on the PDF, never one free-text blob. For EACH repeating section give:",
                "  the EXACT number of rows/slots the form prints, and the LEFT-TO-RIGHT column order.",
                "- For every field, note whether it is REQUIRED or optional per the official instructions,",
                "  so the wizard marks is_required correctly (do not over-require optional fields).",
                "- FAMILY questions the form asks (e.g. mother, father — including whether each is living or",
                "  deceased and their city/country — and siblings), so none are missed.",
                "- Which fields map to standard identity/contact data. Plain text only.",
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
        },
        { timeout: 180_000, maxRetries: 1 },
      );
      researchBrief = researchResp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
        .trim();
    } catch (err) {
      // Research is best-effort — never block the proposal on a search failure.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "ai-engine: proposeFormSegmentation — research step failed, proceeding ungrounded",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // STEP B — GENERATE the JSON proposal (NO tools → full token budget for JSON).
  // ---------------------------------------------------------------------------
  const systemPrompt = [
    "You are a senior U.S. immigration paralegal and official-forms expert. You design",
    "client-facing intake wizards that collect EXACTLY the information needed to complete",
    "an official USCIS/EOIR form correctly. Your audience is a non-lawyer immigrant who",
    "answers in Spanish; every question must also have an accurate English translation.",
    "Your message must be ONLY the JSON object — no prose, no markdown fences.",
  ].join(" ");

  // Curate clearly-internal fields out (signatures, preparer, barcodes, …) so the
  // OUTPUT budget is spent on real client questions (v1 curated-field-map spirit).
  // Input size is NOT the bottleneck — the model's context easily holds every field
  // name. The bottleneck is OUTPUT (a long JSON streams slowly), so we keep help
  // text short (~40-75 questions) and give the call enough time + tokens to finish.
  // (Per-page batching was worse: it pushed the model to map more fields per call →
  // larger, slower output → the 120s timeout fired and the whole proposal failed.)
  const { kept: curatedFields } = curateInternalFields(input.detectedFields);
  const fieldsForProposal = curatedFields.length > 0 ? curatedFields : input.detectedFields;

  logger.info(
    { totalFields: input.detectedFields.length, curated: fieldsForProposal.length, researchLen: researchBrief.length },
    "ai-engine: proposeFormSegmentation — plan",
  );

  const buildUserPrompt = (feedback?: string): string => {
    const lines = [
      `Official form: ${input.formName ?? "(unknown immigration form)"}${input.formSlug ? ` [${input.formSlug}]` : ""}.`,
      input.serviceName ? `Used within the service: "${input.serviceName}".` : "",
      input.serviceContext ? `Service/phase context: ${input.serviceContext}` : "",
      input.pageRange
        ? `This form focuses on pages ${input.pageRange.from}-${input.pageRange.to} of the official form (continuation slots for these entries may live on later pages).`
        : "",
    ];
    if (researchBrief) {
      lines.push("", "OFFICIAL RESEARCH BRIEF (ground your questions in this):", researchBrief.slice(0, 6000));
    }
    lines.push(
      "",
      "PROPOSE a THOROUGH client intake wizard. From the detected AcroForm fields below,",
      "map every applicant-answerable field into clear, plain-language questions. Rules:",
      "- COVERAGE: aim for thorough coverage — a complex form like this typically needs",
      "  ~40-75 client questions. SKIP only signature, preparer, interpreter, attorney,",
      "  page-number, barcode and purely-internal/office-use fields. Do NOT drop real applicant",
      "  fields to save space, but do NOT pad with duplicates. Keep help_i18n SHORT (≤12 words)",
      "  or null to control length. Your ENTIRE reply must be ONE complete JSON object — never truncate.",
      "- Group questions following the form's official Parts/sections (logical order).",
      "- Write question_i18n {es,en} in plain language; help_i18n {es,en} with a short",
      "  hint grounded in the official instructions (or null).",
      "- field_type ∈ text|textarea|date|number|checkbox|select. Use select WITH options",
      "  (each {value, label_i18n}) for enumerated choices; use date for dates; textarea",
      "  for narratives.",
      "- YES/NO questions: model them as a select with Sí/No options (or an OPTIONAL",
      "  checkbox) — NEVER a required checkbox, because a required checkbox forces the",
      "  client to answer 'yes', which is wrong for a genuine yes/no question.",
      "- is_required must match the official form, BUT a checkbox should almost never be",
      "  required (only a true attestation/affirmation should be a required checkbox).",
      "- source: default 'client_answer'. Use 'profile' (with source_ref",
      '  {"profile_field":"<one of the whitelist>"}) ONLY for identity/contact fields that',
      `  match this EXACT whitelist: [${profileFields.join(", ")}] — never invent a field.`,
      "  Use 'document_extraction' (source_ref {\"document_slug\":\"...\",\"json_path\":\"...\"})",
      "  only when the value clearly comes from an uploaded document; otherwise client_answer.",
      "- pdf_field_name: copy the EXACT detected field name this question fills, or null.",
      "- Do NOT ask SSN / A-Number as free text — prefer the profile source when whitelisted.",
      "- validation: optional {regex?, min?, max?} when clearly warranted (e.g. ZIP regex).",
      "- key: give EVERY question a short stable key (e.g. \"has_other_nationality\",",
      "  \"child5_name\"). Conditions reference questions by this key.",
      "- condition (DYNAMIC FIELDS): when a question only applies depending on another",
      "  answer, add a `condition` referencing that question's key. Shape:",
      '  {"when":{"question":"<other key>","op":"equals|not_equals|includes|answered|gte|lte","value":<v>},"action":"show|lock|require","lock_message_i18n":{"es":"...","en":"..."}}.',
      "  * Sí/No → explanation: the explanation field gets",
      '    {"when":{"question":"<the yes/no key>","op":"equals","value":"si"},"action":"show"}',
      "    so it only appears (and is only required) when the client answers Sí. On the",
      "    official form, a 'No' answer leaves that explanation BLANK — model it this way.",
      "  * action 'lock' keeps the field visible but disabled with lock_message_i18n;",
      "    'require' keeps it visible but required only when the condition holds.",
      "- OVERFLOW / continuation (IMPORTANT): when the form has a FIXED number of slots",
      "  for repeated entries (e.g. children/relatives on the early pages) PLUS a",
      "  continuation/supplement area later in the SAME form, do NOT invent new pages.",
      "  Add a count question (number) and model each extra entry as its own question(s)",
      "  mapped to the form's OWN continuation slots, gated by a condition op 'gte' on the",
      "  count. Example: child #5 fields → condition",
      '  {"when":{"question":"<num_children key>","op":"gte","value":5},"action":"show"} with',
      "  pdf_field_name set to the continuation slot you identify from the field list + the",
      "  official instructions. Use the research brief to know where overflow goes.",
      "- STRUCTURED SECTIONS — NEVER COLLAPSE (IMPORTANT): for address history, education",
      "  history, employment history, and similar repeating sections, the official form has",
      "  SEPARATE boxes per sub-field. Create ONE question PER sub-field (e.g. street, city,",
      "  state/province, country, from-date, to-date, employer, occupation), each with its OWN",
      "  exact pdf_field_name and correct field_type (date for dates, text for city, etc.).",
      "  Do NOT lump them into a single textarea pointing at one box — that leaves the other",
      "  boxes empty and can't be auto-filled. Match the form's field granularity exactly.",
      "- MAP DISTINCT FIELDS: when one logical item is split across several AcroForm fields",
      "  (a date in month/day/year boxes, an address in street/city/state/zip boxes), map EACH",
      "  detected field to its own question — one question per detected box, not per concept.",
      "- FIELD GEOMETRY — RECONSTRUCT TABLES SPATIALLY (CRITICAL, prevents mis-mapping):",
      "  each field below shows its page and top-left position @x,y (x grows RIGHT, y grows",
      "  DOWN — a LARGER y is LOWER on the page). Fields with nearly the SAME y are in the SAME",
      "  table ROW; fields with nearly the same x are in the SAME COLUMN. To map a repeating",
      "  table (residences, education, employment, parents/siblings): (1) read its printed",
      "  column headers left-to-right from the page text, (2) group the row's fields by y, (3)",
      "  within each row assign fields to columns by ASCENDING x. NEVER assume the bracket index",
      "  (e.g. [8],[9],[10]) follows visual order — USCIS forms routinely interleave odd/even",
      "  indices across rows and scramble date-box indices, so INDEX ORDER ≠ POSITION. Map",
      "  STRICTLY by geometry + headers, never by the numeric index. The fields are listed in",
      "  reading order (page, then top-to-bottom, then left-to-right) to help you see the rows.",
      "- ACCOUNT FOR EVERY FIELD: each non-internal detected field below must end up mapped to",
      "  exactly one question's pdf_field_name (a repeating table's later rows become overflow",
      "  questions gated by a count). Do not silently drop applicant fields; if a field is truly",
      "  office-use/internal, omit it but note the category in research_summary.",
      "- COMPLETENESS — do not skip Parts: capture EVERY field the applicant personally fills.",
      "  In particular, FAMILY/background: parents (full name + whether LIVING or DECEASED +",
      "  city/country), SIBLINGS if asked, last residence abroad, education and employment — these",
      "  are commonly under-collected. Use the research brief to ensure none are missed.",
      "",
      `Detected AcroForm fields (${fieldsForProposal.length}, spanning the whole form,`,
      "listed in reading order — page, then top-to-bottom (y), then left-to-right (x)):",
      [...fieldsForProposal]
        .sort((a, b) => a.page - b.page || (a.rect?.[1] ?? 0) - (b.rect?.[1] ?? 0) || (a.rect?.[0] ?? 0) - (b.rect?.[0] ?? 0))
        .map((f) =>
          f.rect
            ? `- ${f.name} (${f.type}, page ${f.page}, @x${Math.round(f.rect[0])},y${Math.round(f.rect[1])})`
            : `- ${f.name} (${f.type}, page ${f.page})`,
        )
        .join("\n"),
    );
    if (input.pdfText) {
      lines.push(
        "",
        "PRINTED FORM TEXT BY PAGE — the official form's labels and column headers. The",
        "AcroForm field names above are often ANONYMOUS (e.g. \"TextField13[39]\"); use this",
        "text + the field's PAGE to figure out what each field actually is (e.g. the field on",
        "the page whose text shows an Employment table → map TextField13[39] to 'Employer',",
        "[40] to 'Occupation', the adjacent date boxes to From/To). Map by MEANING, never by",
        "the anonymous name. Match the form's exact granularity (one question per box).",
        "The text is segmented by `=== Page N ===` markers — align each field's PAGE with",
        "the matching page block; never read a field's columns from a different page's text:",
        input.pdfText.slice(0, 32000),
      );
    }
    lines.push(
      "",
      "Return ONLY this JSON object (no fences, no prose):",
      '{ "research_summary": "...", "groups": [ { "title_i18n": {"es":"...","en":"..."}, "position": 0, "questions": [ { "key": "unique_key", "question_i18n": {"es":"...","en":"..."}, "help_i18n": {"es":"...","en":"..."}, "field_type": "text", "options": null, "pdf_field_name": "...", "source": "client_answer", "source_ref": null, "is_required": true, "validation": null, "condition": null, "position": 0 } ] } ] }',
    );
    if (feedback) {
      lines.push("", `CORRECTION REQUIRED — previous response had errors: ${feedback}`, "Fix these issues and return ONLY valid JSON.");
    }
    return lines.filter((l) => l !== "").join("\n");
  };

  // Single JSON-gen call with a resilient retry: a transient failure on the first
  // attempt (timeout, 5xx, or unparseable/groupless output) feeds an error note
  // into a second attempt instead of bubbling up and failing the proposal silently.
  let lastError = "response was not valid JSON";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // STREAM (not create): a large form needs a big max_tokens, and the SDK
      // refuses a non-streaming request whose budget could exceed 10 minutes
      // ("Streaming is required…"). Streaming also avoids mid-JSON truncation.
      const stream = client.messages.stream(
        {
          model: editorModel,
          max_tokens: 32000,
          system: systemPrompt,
          messages: [{ role: "user", content: buildUserPrompt(attempt > 0 ? lastError : undefined) }],
        },
        // A big-form generation can run minutes; pin the per-request timeout to the
        // job route's maxDuration (300s) instead of relying on the SDK default.
        { timeout: 300_000, maxRetries: 1 },
      );
      const message = await stream.finalMessage();

      const text = message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text)
        .join("\n");
      const stop = message.stop_reason ?? undefined;

      const parsed = stripFencesAndParse<SegmentationProposal>(text);
      if (parsed && Array.isArray(parsed.groups)) {
        if (researchBrief && !parsed.research_summary) parsed.research_summary = researchBrief.slice(0, 280);
        const totalQ = parsed.groups.reduce((n, g) => n + (g.questions?.length ?? 0), 0);
        logger.info({ groups: parsed.groups.length, questions: totalQ, outLen: text.length, stop }, "ai-engine: proposeFormSegmentation — result");
        return parsed;
      }
      lastError = parsed
        ? `parsed object has no 'groups' array (got keys: ${Object.keys(parsed as object).join(", ")})`
        : "response was not valid JSON after stripping code fences";
      // stop === 'max_tokens' here means the JSON was truncated → a tighter cap is needed.
      logger.warn({ attempt, lastError, outLen: text.length, stop }, "ai-engine: proposeFormSegmentation — parse failed");
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Auth / bad-request errors won't succeed on retry (same pattern as executeGenerationJob).
      if (lastError.includes("401") || lastError.includes("403") || lastError.includes("400") || lastError.includes("413")) {
        break;
      }
    }
    // Only announce a retry when there IS another attempt left.
    if (attempt < 1) {
      logger.warn({ attempt, lastError }, "ai-engine: proposeFormSegmentation — attempt failed, retrying");
    }
  }

  throw new AiEngineError("AI_OUTPUT_INVALID", `proposeFormSegmentation: ${lastError}`);
}

/**
 * Proposes an extraction_schema for a document requirement (RF-ADM-029 / DOC-74 §2.6).
 * M-12: tolerant JSON parsing (strips fences) + 1 retry with error feedback on parse fail.
 *
 * @api-id (internal — consumed by catalog module)
 */
export async function proposeExtractionSchema(
  actor: Actor,
  input: {
    requirementLabel: { es: string; en: string };
    helpText?: string;
    sampleDocRef?: string;
  },
): Promise<{ schema: Record<string, unknown> }> {
  can(actor, "catalog", "edit");

  const editorModel = process.env.AI_EDITOR_MODEL ?? "claude-sonnet-4-6";
  const client = getAnthropicClient();

  const systemPrompt = "You are a JSON Schema expert for document extraction. Return ONLY valid JSON, no markdown code fences.";

  const buildUserPrompt = (feedback?: string): string => {
    const lines = [
      `Create a JSON Schema for extracting key fields from a "${input.requirementLabel.en}" document.`,
      "Use only these types: string, number, boolean, object, array.",
      "Add 'description' fields in English for each property.",
      "Include a 'required' array for mandatory fields.",
      "Do NOT use: $ref, allOf, anyOf, oneOf, if/then/else, or recursive structures.",
    ];
    if (input.helpText) lines.push(`Context: ${input.helpText}`);
    lines.push(
      "",
      'Return JSON with this exact shape (NO code fences):',
      '{ "schema": { "type": "object", "properties": { "field_name": { "type": "string", "description": "..." } }, "required": ["field_name"] } }',
    );
    if (feedback) {
      lines.push("", `CORRECTION REQUIRED — previous response had errors: ${feedback}`, "Fix these issues and return valid JSON.");
    }
    return lines.join("\n");
  };

  type SchemaResult = { schema: Record<string, unknown> };

  let lastError = "response was not valid JSON";

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: editorModel,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: buildUserPrompt(attempt > 0 ? lastError : undefined) }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    const parsed = stripFencesAndParse<SchemaResult>(text);
    if (parsed && typeof (parsed as SchemaResult).schema === "object" && (parsed as SchemaResult).schema !== null) {
      return parsed as SchemaResult;
    }

    lastError = parsed
      ? `parsed object has no 'schema' key (got keys: ${Object.keys(parsed as object).join(", ")})`
      : "response was not valid JSON after stripping code fences";

    if (attempt === 0) {
      logger.warn({ attempt, lastError }, "ai-engine: proposeExtractionSchema — retrying with feedback");
    }
  }

  throw new AiEngineError("AI_OUTPUT_INVALID", `proposeExtractionSchema: ${lastError}`);
}

// ---------------------------------------------------------------------------
// API-AI-11: proposeExpedienteAssembly — AI planner for the case-file assembly
// ---------------------------------------------------------------------------

/** A case party as seen by the assembly planner. */
export interface AssemblyPartyInput {
  id: string;
  role: string;
  name: string;
}

/** A "strong" artifact (USCIS form already filled, or a generated letter). */
export interface AssemblyStrongDocInput {
  kind: "automated_form" | "ai_generation";
  id: string;
  label: string;
  partyId?: string | null;
}

/** A client-uploaded document available for grouping under a party cover. */
export interface AssemblyDocInput {
  caseDocumentId: string;
  fileName: string;
  partyId: string | null;
  requirementLabel?: string | null;
  /** Already-extracted signal (masked before prompting) to sharpen classification. */
  extraction?: { payload?: Record<string, unknown> | null; rawTextSnippet?: string | null } | null;
}

export interface ExpedienteAssemblyInput {
  caseLabel: string;
  serviceCategory?: string | null;
  /** Service slug — stable identifier for the prompt context (the label above is display-only). */
  serviceSlug?: string | null;
  /** Per-service canonical assembly guide (English plain text, migration 0087).
   *  When set it takes strict precedence over the generic legal-order rules. */
  assemblyGuidance?: string | null;
  parties: AssemblyPartyInput[];
  strongDocs: AssemblyStrongDocInput[];
  documents: AssemblyDocInput[];
}

export type ExpedienteAssemblySection =
  | { kind: "document"; title: string; refType: "automated_form" | "ai_generation"; refId: string }
  | { kind: "party"; title: string; partyId: string; documentIds: string[] }
  | { kind: "other"; title: string; documentIds: string[] };

export interface ExpedienteAssemblyPlan {
  sections: ExpedienteAssemblySection[];
}

const AssemblyPlanSchema = z.object({
  sections: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("document"),
          title: z.string().trim().min(1),
          refType: z.enum(["automated_form", "ai_generation"]),
          refId: z.string().min(1),
        }),
        z.object({
          kind: z.literal("party"),
          title: z.string().trim().min(1),
          partyId: z.string().min(1),
          documentIds: z.array(z.string()).default([]),
        }),
        z.object({
          kind: z.literal("other"),
          title: z.string().trim().min(1),
          documentIds: z.array(z.string()).default([]),
        }),
      ]),
    )
    .min(1),
});

/** Build a short, PII-masked extraction hint for the classifier. */
function summarizeExtractionForPlanner(
  ext: AssemblyDocInput["extraction"],
): string | null {
  if (!ext) return null;
  const parts: string[] = [];
  if (ext.payload && Object.keys(ext.payload).length > 0) {
    parts.push(JSON.stringify(ext.payload).slice(0, 400));
  }
  if (ext.rawTextSnippet) parts.push(ext.rawTextSnippet.slice(0, 300));
  if (parts.length === 0) return null;
  return maskPii(parts.join(" | "));
}

/**
 * AI planner for the expediente (case file) assembly. Given the case context —
 * parties, strong artifacts (filled USCIS forms + generated letters) and the
 * client's uploaded documents (with file names + already-extracted hints) — it
 * returns an ORDERED list of sections: one cover per strong document (explicit
 * title) and semantic per-party covers grouping the remaining documents by the
 * member they belong to (inferred from the file name + extraction even when the
 * uploaded slot didn't set party_id). The legal order is GUIDED by the prompt;
 * the human (Diana) reviews and reorders. Sync call (no cost persisted), same
 * pattern as proposeExtractionSchema. The orchestrator re-validates every id.
 *
 * @api-id API-AI-11
 */
export async function proposeExpedienteAssembly(
  input: ExpedienteAssemblyInput,
): Promise<ExpedienteAssemblyPlan> {
  const editorModel = process.env.AI_EDITOR_MODEL ?? "claude-sonnet-4-6";
  const client = getAnthropicClient();

  // Per-service canonical order (config-as-data, services.expediente_guidance).
  // With a guide: the prompt gains the serviceSlug context key plus a
  // strict-precedence "CANONICAL ORDER" block, and the generic examples are
  // dropped. Without one the WHOLE prompt is byte-identical to the pre-0087
  // version (fixed by unit test) so unseeded services are unaffected.
  const guidance = input.assemblyGuidance?.trim() || null;

  const context = {
    case: input.caseLabel,
    serviceCategory: input.serviceCategory ?? null,
    ...(guidance ? { serviceSlug: input.serviceSlug ?? null } : {}),
    parties: input.parties.map((p) => ({ id: p.id, role: p.role, name: p.name })),
    strongDocuments: input.strongDocs.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      partyId: s.partyId ?? null,
    })),
    uploadedDocuments: input.documents.map((d) => ({
      id: d.caseDocumentId,
      fileName: d.fileName,
      partyId: d.partyId,
      requirement: d.requirementLabel ?? null,
      extractedHint: summarizeExtractionForPlanner(d.extraction),
    })),
  };

  const systemPrompt = [
    "You organize a U.S. immigration legal case file (\"expediente\") for filing with USCIS or an immigration court.",
    "You receive the case parties, the strong artifacts (already-filled USCIS forms and generated letters) and the client's uploaded documents.",
    "Your job: produce an ORDERED list of sections that a paralegal will review.",
    "Return ONLY valid JSON, no markdown code fences.",
  ].join("\n");

  const genericOrderRules = [
    "1. Order the sections following the canonical legal sequence for the case type. General order:",
    "   a) Initial instructions / petition / main USCIS form, b) sworn declarations & affidavits,",
    "   c) documents of each beneficiary/minor, d) documents of the petitioner/sponsor, e) witnesses, f) supporting evidence.",
    "   Example (Juvenile Visa / custody): Petition for Temporary Guardianship → Sworn Declaration of the Minor → Affidavit of Mother/Sponsor → Documents of the Minor → Documents of the Petitioner → Affidavit of Witness.",
    "   Example (Asylum): Form I-589 → Credible Fear Memorandum → documents per family member (beneficiary minor, spouse, each child) → supporting evidence.",
  ];
  const guidedOrderRules = [
    "1. Order the sections following the CANONICAL ORDER FOR THIS SERVICE above — it takes strict precedence.",
    "   Section titles specified in that guide are used VERBATIM and take precedence over the default",
    "   title formats of rules 2-4 below. Where the guide is silent, fall back to the general legal",
    "   sequence: a) main form/petition, b) sworn declarations & affidavits, c) documents of each",
    "   beneficiary/minor, d) documents of the petitioner/sponsor, e) witnesses, f) supporting evidence.",
  ];

  const buildUserPrompt = (feedback?: string): string => {
    const lines = [
      "CONTEXT (JSON):",
      JSON.stringify(context, null, 2),
      "",
      ...(guidance ? ["CANONICAL ORDER FOR THIS SERVICE (follow strictly):", guidance, ""] : []),
      "RULES:",
      "0. ALL section titles MUST be written in ENGLISH — the case file is filed with USCIS / the immigration court in English. Translate the artifact labels to natural English titles. Keep party PERSON NAMES verbatim (do not translate names).",
      ...(guidance ? guidedOrderRules : genericOrderRules),
      "2. Emit ONE 'document' section PER strong artifact (each filled form and each letter), each with an explicit, human-readable ENGLISH title (e.g. \"Form I-589\", \"Credible Fear Memorandum\", \"Statement of the Minor's Circumstances\"). Use the artifact's id as refId and its kind as refType.",
      "3. Group the remaining uploadedDocuments into 'party' sections — ONE per party that has documents. Assign each document to the party it belongs to using fileName + extractedHint + partyId (infer the party even when partyId is null or when a slot has multiple files). ENGLISH title format: \"Documents of the {role in English}: {party name}\" (e.g. \"Documents of the Minor: Juan Pérez\", \"Documents of the Petitioner: Carlos\", \"Documents of the Spouse: Rosa\").",
      "4. Documents that don't belong to any party (e.g. witnesses, general evidence) go in 'other' sections with a clear ENGLISH title (e.g. \"Witness Documents\", \"Supporting Evidence\").",
      "5. Use ONLY ids present in the context. Every uploaded document id must appear in exactly one section. Do NOT invent ids or titles for missing artifacts.",
      "",
      "Return JSON with EXACTLY this shape (no code fences):",
      '{ "sections": [',
      '  { "kind": "document", "title": "Form I-589", "refType": "automated_form", "refId": "<id>" },',
      '  { "kind": "party", "title": "Documents of the Minor: Juan Pérez", "partyId": "<id>", "documentIds": ["<docId>", "<docId>"] },',
      '  { "kind": "other", "title": "Witness Documents", "documentIds": ["<docId>"] }',
      "] }",
    ];
    if (feedback) {
      lines.push("", `CORRECTION REQUIRED — previous response had errors: ${feedback}`, "Fix these issues and return valid JSON.");
    }
    return lines.join("\n");
  };

  let lastError = "response was not valid JSON";

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: editorModel,
      max_tokens: 6000,
      system: systemPrompt,
      messages: [{ role: "user", content: buildUserPrompt(attempt > 0 ? lastError : undefined) }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");

    const parsed = stripFencesAndParse<unknown>(text);
    const result = AssemblyPlanSchema.safeParse(parsed);
    if (result.success) return result.data as ExpedienteAssemblyPlan;

    lastError = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");

    if (attempt === 0) {
      logger.warn({ attempt, lastError }, "ai-engine: proposeExpedienteAssembly — retrying with feedback");
    }
  }

  throw new AiEngineError("AI_OUTPUT_INVALID", `proposeExpedienteAssembly: ${lastError}`);
}

// ---------------------------------------------------------------------------
// API-AI-02: getRunsForCase
// ---------------------------------------------------------------------------

/** Running is stale past this: checkpoints touch updated_at every section (≤240s/call). */
const RUN_STALE_RUNNING_MS = 30 * 60_000;
/** Queued is stale past this: the concurrency defer can legitimately hold ~30 min. */
const RUN_STALE_QUEUED_MS = 60 * 60_000;

/**
 * Returns all generation runs for a case, ordered by form+version.
 * The run with highest version per (form, party) is marked isCurrent.
 *
 * @api-id API-AI-02
 */
export async function getRunsForCase(
  actor: Actor,
  caseId: string,
): Promise<(GenerationRunRow & { isCurrent: boolean })[]> {
  await requireCaseAccess(actor, caseId);

  // Lazy zombie reaper: without it, a dead queued/running row would hold the
  // uq_ai_runs_active_target lock forever and block re-generation.
  const now = Date.now();
  await sweepStaleRunsForCase(caseId, {
    runningBefore: new Date(now - RUN_STALE_RUNNING_MS).toISOString(),
    queuedBefore: new Date(now - RUN_STALE_QUEUED_MS).toISOString(),
  });

  const runs = await listRunsForCase(caseId);

  // Mark isCurrent: highest version per (form_definition_id, party_id) with status=completed
  const currentMap = new Map<string, string>(); // key → run.id
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const key = `${run.form_definition_id}:${run.party_id ?? "null"}`;
    if (!currentMap.has(key)) {
      currentMap.set(key, run.id); // runs are ordered version DESC, so first = highest
    }
  }

  return runs.map((run) => {
    const key = `${run.form_definition_id}:${run.party_id ?? "null"}`;
    return { ...run, isCurrent: currentMap.get(key) === run.id };
  });
}

// ---------------------------------------------------------------------------
// Generated-letter accessors (Ola 2 — Generaciones review)
// ---------------------------------------------------------------------------

/**
 * Short-lived signed URL of a completed run's generated letter (bucket `generated`,
 * `output_path`). null when the run hasn't produced a file yet. Cross-tenant safe.
 */
export async function getGenerationOutputUrl(actor: Actor, runId: string): Promise<string | null> {
  const run = await findRunById(runId);
  if (!run) throw new AiEngineError("AI_RUN_NOT_FOUND");
  await requireCaseAccess(actor, run.case_id);
  if (!run.output_path) return null;
  return createSignedDownloadUrl("generated", run.output_path);
}

/**
 * Lightweight run status for client-side polling after a regeneration (async job).
 */
export async function getRunStatus(
  actor: Actor,
  runId: string,
): Promise<{ id: string; status: string; version: number; outputAvailable: boolean }> {
  const run = await findRunById(runId);
  if (!run) throw new AiEngineError("AI_RUN_NOT_FOUND");
  await requireCaseAccess(actor, run.case_id);
  return {
    id: run.id,
    status: run.status,
    version: run.version,
    outputAvailable: run.status === "completed" && !!run.output_path,
  };
}

// ---------------------------------------------------------------------------
// API-AI-10: getCostsSummary
// ---------------------------------------------------------------------------

/**
 * Returns cost breakdown for the admin panel (RF-ADM-005).
 *
 * @api-id API-AI-10
 */
export async function getCostsSummary(
  actor: Actor,
  filters: { from: string; to: string },
) {
  can(actor, "dashboard", "view");
  return sumCosts(actor.orgId, filters);
}

// ---------------------------------------------------------------------------
// API-AI-10b: getAiCostsReport — full RF-ADM-005 report (per-query cost)
// ---------------------------------------------------------------------------

/** One AI invocation row for the per-query cost table (RF-ADM-005). */
export interface AiCostsReportQuery {
  id: string;
  source: "generations" | "extractions" | "translations";
  caseNumber: string | null;
  serviceLabel: string | null;
  model: string | null;
  costUsd: number;
  tokens: number;
  status: string;
  isTest: boolean;
  createdAt: string;
}

/** Full AI-cost report for the admin panel (RF-ADM-005 / RF-ADM-037). */
export interface AiCostsReport {
  /** Total spend in the period (excludes editor test runs). */
  totalUsd: number;
  /** Same total for the immediately-preceding window (period-over-period delta). */
  prevTotalUsd: number;
  /** Editor test-run spend, reported separately (RF-ADM-037 — not in metrics). */
  testUsd: number;
  /** Tokens consumed (input + output + cache) across non-test invocations. */
  totalTokens: number;
  /** Count of non-test invocations (all three engines). */
  runs: number;
  /** Count of non-test invocations that failed. */
  failedRuns: number;
  /** failedRuns / runs, rounded — null when there were no runs. */
  failureRatePct: number | null;
  /** Monthly AI budget (orgs.settings.ai_budget_usd, fallback 500). */
  budgetUsd: number;
  bySource: { generations: number; extractions: number; translations: number };
  byModel: { model: string; usd: number }[];
  byService: { serviceLabel: string; usd: number }[];
  byMonth: { month: string; usd: number }[];
  /** Per-query rows (non-test), newest first, capped for payload size. */
  queries: AiCostsReportQuery[];
  /** Top-5 costliest invocations (non-test) for the ranking. */
  topRuns: AiCostsReportQuery[];
}

const QUERY_TABLE_CAP = 100;

function round4(n: number): number {
  return parseFloat(n.toFixed(4));
}

function rowTokens(r: AiCostReportRow): number {
  return r.inputTokens + r.outputTokens + r.cacheTokens;
}

function toReportQuery(r: AiCostReportRow): AiCostsReportQuery {
  return {
    id: r.id,
    source: r.source,
    caseNumber: r.caseNumber,
    serviceLabel: r.serviceLabel,
    model: r.model,
    costUsd: round4(r.costUsd),
    tokens: rowTokens(r),
    status: r.status,
    isTest: r.isTest,
    createdAt: r.createdAt,
  };
}

/**
 * Detailed AI-cost report for /admin/ai-costs (RF-ADM-005): totals, tokens,
 * failure rate, budget, breakdowns by source/model/service/month, the per-query
 * table and the top-5 ranking. Editor test runs (is_test) are excluded from the
 * metrics and surfaced as `testUsd` only (RF-ADM-037). Aggregated in JS over the
 * period-bounded `aiCostRows` read — no migration.
 *
 * @api-id API-AI-10
 */
export async function getAiCostsReport(
  actor: Actor,
  input: { period: Period; from?: string; to?: string },
): Promise<AiCostsReport> {
  can(actor, "dashboard", "view");

  const { tz, budgetUsd } = await getOrgCostContext(actor.orgId);
  const range = resolvePeriodRange(input.period, { from: input.from, to: input.to, tz });

  const [rows, prevRows] = await Promise.all([
    aiCostRows(actor.orgId, range.from.toISOString(), range.to.toISOString()),
    aiCostRows(actor.orgId, range.prevFrom.toISOString(), range.prevTo.toISOString()),
  ]);

  const nonTest = rows.filter((r) => !r.isTest);

  let totalUsd = 0;
  let testUsd = 0;
  let totalTokens = 0;
  let failedRuns = 0;
  const bySource = { generations: 0, extractions: 0, translations: 0 };
  const byModel = new Map<string, number>();
  const byService = new Map<string, number>();
  const byMonth = new Map<string, number>();

  for (const r of rows) {
    if (r.isTest) {
      testUsd += r.costUsd;
      continue;
    }
    totalUsd += r.costUsd;
    totalTokens += rowTokens(r);
    bySource[r.source] += r.costUsd;
    if (r.status === "failed") failedRuns += 1;
    if (r.model) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.costUsd);
    const svc = r.serviceLabel ?? "Sin servicio";
    byService.set(svc, (byService.get(svc) ?? 0) + r.costUsd);
    const month = r.createdAt.slice(0, 7); // "YYYY-MM"
    byMonth.set(month, (byMonth.get(month) ?? 0) + r.costUsd);
  }

  const prevTotalUsd = prevRows.reduce((s, r) => (r.isTest ? s : s + r.costUsd), 0);
  const runs = nonTest.length;

  const byDateDesc = [...nonTest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byCostDesc = [...nonTest].sort((a, b) => b.costUsd - a.costUsd);

  return {
    totalUsd: round4(totalUsd),
    prevTotalUsd: round4(prevTotalUsd),
    testUsd: round4(testUsd),
    totalTokens,
    runs,
    failedRuns,
    failureRatePct: runs > 0 ? Math.round((failedRuns / runs) * 100) : null,
    budgetUsd,
    bySource: {
      generations: round4(bySource.generations),
      extractions: round4(bySource.extractions),
      translations: round4(bySource.translations),
    },
    byModel: [...byModel.entries()]
      .map(([model, usd]) => ({ model, usd: round4(usd) }))
      .sort((a, b) => b.usd - a.usd),
    byService: [...byService.entries()]
      .map(([serviceLabel, usd]) => ({ serviceLabel, usd: round4(usd) }))
      .sort((a, b) => b.usd - a.usd),
    byMonth: [...byMonth.entries()]
      .map(([month, usd]) => ({ month, usd: round4(usd) }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    queries: byDateDesc.slice(0, QUERY_TABLE_CAP).map(toReportQuery),
    topRuns: byCostDesc.slice(0, 5).map(toReportQuery),
  };
}

// ---------------------------------------------------------------------------
// Etapa D — Pre-Mortem: types + service layer
// ---------------------------------------------------------------------------

/**
 * One quality finding from the Pre-Mortem validator (an error / discrepancy /
 * formatting / filling issue in the generated artifact).
 */
export interface PreMortemFinding {
  severity: FindingSeverity;   // critico | moderado | sugerencia
  category: FindingCategory;
  location: string;            // field / section / page
  description: string;
  correction: string;
}

/** What the Pre-Mortem validates: an ai_letter run or a pdf_automation response. */
export type PreMortemTarget =
  | { kind: "ai_letter"; runId?: string }         // runId omitted → latest eligible
  | { kind: "pdf_automation"; responseId: string };

/**
 * A persisted Pre-Mortem quality validation (returned from assessPreMortemRisk and
 * listed by getPreMortemAssessmentsForCase).
 */
export interface PreMortemAssessment {
  id: string;
  caseId: string;
  targetKind: "ai_letter" | "pdf_automation";
  runId: string | null;
  responseId: string | null;
  formDefinitionId: string | null;
  score: number;               // 0..100
  semaforo: Semaforo;          // green | amber | red
  verdict: Verdict;            // would_approve | needs_corrections | would_reject
  summary: string | null;
  findings: PreMortemFinding[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdBy: string | null; // DB column is nullable (system/job-created assessments)
  createdAt: string;
  /** Async lifecycle: queued/running rows are in-flight validations (no report yet). */
  status: "queued" | "running" | "completed" | "failed";
  error: string | null;
}

/** A document that can be validated (feeds the tab selector). */
export interface ValidableTarget {
  kind: "ai_letter" | "pdf_automation";
  formDefinitionId: string;
  labelI18n: unknown;          // resolved to locale in the VM layer
  runId?: string;
  responseId?: string;
  partyId?: string | null;
  status?: string;
  createdAt?: string;
}

/** Token budget for embedding query: truncate the memo to avoid Gemini limits. */
const PREMORTEM_EMBED_MAX_CHARS = 8_000;
/** Default model for the Pre-Mortem critic (high-quality analytical task). */
const PREMORTEM_DEFAULT_MODEL = "claude-opus-4-7";
/** Fallback if the default is not available. */
const PREMORTEM_FALLBACK_MODEL = DEFAULT_GENERATION_MODEL; // claude-sonnet-4-6
/** Top-k neighbours to retrieve from pgvector. */
const PREMORTEM_RETRIEVAL_K = 8;
/** Token budget for dataset injection into the critic prompt. */
const PREMORTEM_DATASET_BUDGET = 30_000;
/** Chars of masked case context (extractions) injected into the validator prompt. */
const PREMORTEM_CONTEXT_BUDGET = 30_000;
/**
 * GUARANTEED FLOOR of generated-artifact chars injected into the validator
 * prompt. The real budget is DYNAMIC (computePreMortemDocBudget): the document
 * gets every char of context left after the rubric and the source material, so
 * QA judges the WHOLE artifact whenever it fits — a clipped view penalized text
 * the validator could not see (Henry 2026-07-17: quality over cost, always).
 */
const PREMORTEM_MEMO_BUDGET = 260_000;
/** Total input-char target for the validator call (~175k tokens at ~4 chars/token,
 *  leaving system prompt + categories + 8k output inside a 200k-token context). */
const PREMORTEM_TOTAL_INPUT_CHAR_TARGET = 700_000;
/** Scaffolding allowance: system prompt, finding categories, task instructions. */
const PREMORTEM_PROMPT_OVERHEAD_CHARS = 20_000;

/**
 * Dynamic artifact budget: everything the model context can still take after the
 * rubric and the source/context material, never below the guaranteed floor. A
 * huge rubric+source combination can only shrink the artifact down to the floor
 * (260k) — and the head-tail clip stays visible-marked, never silent.
 */
export function computePreMortemDocBudget(guideChars: number, sourceOrContextChars: number): number {
  const remaining =
    PREMORTEM_TOTAL_INPUT_CHAR_TARGET - guideChars - sourceOrContextChars - PREMORTEM_PROMPT_OVERHEAD_CHARS;
  return Math.max(PREMORTEM_MEMO_BUDGET, remaining);
}
/**
 * Chars of the SOURCE material (questionnaire answers + declaración + evidencias,
 * with OCR) injected so the validator can catch contradictions / incoherence /
 * vagueness against the exact record the memo was generated from.
 */
const PREMORTEM_SOURCE_BUDGET = 40_000;
/** web_search server-tool call cap for the validator (official examples). */
const PREMORTEM_WEB_SEARCH_MAX_USES = 5;
/** Validator wall-clock budget. Large ai_letter targets (a ~100-page appeal
 *  brief + rubric + full source material + web_search) run well past 4 minutes —
 *  the old 240s abort was killing them ("Request was aborted."). Must stay under
 *  the case pages' route maxDuration so the synchronous action fits in prod. */
const PREMORTEM_CALL_TIMEOUT_MS = 700_000;
/** Output token budget — I-589 has 460 fields → reports can be long. */
const PREMORTEM_MAX_OUTPUT_TOKENS = 8_192;

/**
 * Retrieves similar dataset items using semantic search (embedText + matchDatasetItems).
 * Falls back to lexical `selectDatasetItems` when:
 *   - the embedding call fails
 *   - matchDatasetItems returns empty (no embeddings backfilled yet)
 *   - datasetId is null
 *
 * @internal — exposed here for testability; used by assessPreMortemRisk.
 */
export async function retrieveDatasetItemsWithFallback(
  datasetId: string | null,
  queryText: string,
): Promise<DatasetItem[]> {
  if (!datasetId) return [];

  // Attempt semantic retrieval
  try {
    const embedding = await embedText(queryText.slice(0, PREMORTEM_EMBED_MAX_CHARS));
    const hits = await matchDatasetItems(datasetId, embedding, PREMORTEM_RETRIEVAL_K, null);
    if (hits.length > 0) {
      return hits.map((h) => ({
        id: h.id,
        title: h.title,
        content: h.content,
        tags: h.tags,
        outcome: h.outcome,
        jurisdiction: h.jurisdiction,
        token_count: h.token_count ?? 0,
        created_at: h.created_at,
        meta: h.meta,
      }));
    }
  } catch (err) {
    logger.warn({ err, datasetId }, "ai-engine: semantic retrieval failed — falling back to lexical");
  }

  // Fallback: lexical selection
  const allItems = await loadDatasetItems(datasetId);
  const { selectedItems } = selectDatasetItems(allItems, {}, PREMORTEM_DATASET_BUDGET);
  return selectedItems;
}

/**
 * Resolves the memo text for a run: prefers `output_text`; falls back to
 * transcribing the stored PDF (`output_path`, bucket "generated") via Gemini —
 * the credible-fear engine stores the memo as a PDF, not plain text.
 * @throws AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN") if neither yields text.
 */
async function resolveMemoText(outputText: string | null, outputPath: string | null): Promise<string> {
  if (outputText && outputText.trim().length > 0) return outputText;
  if (outputPath) {
    const extracted = await extractRawTextFromStorage({
      bucket: "generated",
      path: outputPath,
      mimeType: "application/pdf",
    });
    if (extracted && extracted.trim().length > 0) return extracted;
  }
  throw new AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN", {
    reason: "Run has no usable memo text (output_text empty and output_path missing/unreadable)",
  });
}

/**
 * Truncates `text` to `budget` chars keeping a head+tail slice (the tail of a memo
 * carries the perjury declaration), inserting a visible marker and logging when it
 * clips — never a silent cap (the validator must know it saw a partial document).
 */
function budgetTextHeadTail(text: string, budget: number, label: string, caseId: string): string {
  if (text.length <= budget) return text;
  logger.info(
    { job: "assessPreMortemRisk", caseId, label, originalChars: text.length, budget, omitted: text.length - budget },
    "ai-engine: pre-mortem context truncated to budget",
  );
  return headTailClip(text, budget, label);
}

/**
 * Loads the SOURCE material a memo (ai_letter) was generated from — the frozen
 * questionnaire answers + uploaded documents (declaración + evidencias, with OCR) —
 * so the Pre-Mortem can validate the memo against the exact record (contradictions,
 * incoherence, vagueness). Prefers the run's frozen `resolved_inputs`; falls back to
 * re-resolving the config's declared slugs for older runs that froze empty inputs.
 * Returns empty inputs (never throws) when nothing resolves.
 */
async function loadPreMortemSourceInputs(
  snapshot: ConfigSnapshot | null,
  partyId: string | null,
  caseId: string,
  cfg: { input_form_slugs: string[] | null; input_document_slugs: string[] | null } | null,
): Promise<ResolvedInputs> {
  const frozen = snapshot?.resolved_inputs;
  if (frozen && ((frozen.documents?.length ?? 0) > 0 || (frozen.forms?.length ?? 0) > 0)) {
    return await loadResolvedInputs(snapshot as ConfigSnapshot);
  }
  const formSlugs = cfg?.input_form_slugs ?? [];
  const docSlugs = cfg?.input_document_slugs ?? [];
  if (formSlugs.length > 0 || docSlugs.length > 0) {
    const resolved = await resolveGenerationInputs(caseId, partyId, formSlugs, docSlugs);
    return await loadResolvedInputs({ resolved_inputs: resolved } as ConfigSnapshot);
  }
  return { documents: [], forms: [] };
}

/** Renders resolved pdf_automation fields as a compact table for the validator. */
function renderFieldsForValidation(
  fields: Array<{ pdfFieldName: string | null; label: string; fieldType: string; value: string | string[] | boolean | null; visible: boolean; required: boolean; empty: boolean; doNotFill: boolean }>,
  missingRequired: string[],
): string {
  const rows = fields
    .map((f) => {
      const val = f.doNotFill
        ? "(left blank — do-not-fill section)"
        : !f.visible
          ? "(hidden — not applicable)"
          : f.value === null || f.value === ""
            ? "(empty)"
            : typeof f.value === "boolean"
              ? f.value ? "[x]" : "[ ]"
              : Array.isArray(f.value)
                ? f.value.join(", ")
                : String(f.value);
      const flags = [f.required ? "required" : "", f.doNotFill ? "do-not-fill" : ""].filter(Boolean).join(",");
      return `- [${f.pdfFieldName ?? "—"}] ${f.label}${flags ? ` (${flags})` : ""}: ${val}`;
    })
    .join("\n");
  const missing =
    missingRequired.length > 0 ? `\n\nMISSING REQUIRED FIELDS: ${missingRequired.join(", ")}` : "";
  return (
    "## AUTOFILLED OFFICIAL FORM — resolved field values (exactly what would be filed; PII masked)\n\n" +
    rows +
    missing
  );
}

/** Lifecycle status of an assessment row (async QStash pipeline). */
export type PreMortemRunStatus = "queued" | "running" | "completed" | "failed";

/** Everything the validator call needs, resolved actor-free on the job side. */
interface PreMortemContext {
  caseId: string;
  targetKind: "ai_letter" | "pdf_automation";
  runId: string | null;
  responseId: string | null;
  formDefinitionId: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
}

/**
 * Resolves the FROZEN target (run_id/response_id fixed at enqueue time — never
 * re-resolved to "latest") into the full validator context: artifact text
 * (masked), rubric, source material, dynamic budgets and the final prompts.
 *
 * Actor-free: authorization happened in startPreMortemValidation before the row
 * was inserted; the job trusts the frozen row. Every throw here is DETERMINISTIC
 * for the job (a missing guide/artifact does not heal on retry).
 *
 * @throws AiEngineError("PREMORTEM_NO_TARGET") when the frozen artifact is gone.
 * @throws AiEngineError("PREMORTEM_NO_GUIDE") when the form's guide is missing/disabled.
 */
async function resolvePreMortemContext(input: {
  caseId: string;
  targetKind: "ai_letter" | "pdf_automation";
  runId: string | null;
  responseId: string | null;
}): Promise<PreMortemContext> {
  const targetKind = input.targetKind;
  const runId = input.runId;
  const responseId = input.responseId;
  let formDefinitionId = "";
  let configModel: string | null = null;
  let documentBlock = ""; // the artifact rendered (masked) for the prompt
  // ai_letter path: masked memo held here until the rubric+source sizes are known
  // (the artifact budget is dynamic — it takes whatever context they leave free).
  let pendingMaskedMemo: string | null = null;
  // For an ai_letter memo: the SOURCE material it was generated from (questionnaire
  // answers + declaración + evidencias) — injected so the validator can check the
  // memo for contradictions / incoherence / vagueness against the exact record.
  let aiLetterSourceInputs: ResolvedInputs | null = null;

  if (targetKind === "ai_letter") {
    if (!runId) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Frozen target has no runId" });
    const run = await findRunById(runId);
    if (!run) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Frozen run not found", runId });
    // IDOR belt-and-braces: the frozen row was validated at enqueue, but never
    // trust a cross-case artifact into a prompt.
    if (run.case_id !== input.caseId) throw new AuthzError("forbidden_case");

    const outputText = await resolveMemoText(run.output_text, run.output_path);
    formDefinitionId = run.form_definition_id ?? "";
    const cfg = formDefinitionId ? await findGenerationConfig(formDefinitionId) : null;
    configModel = cfg?.model ?? run.model ?? null;

    // Load the source material (frozen resolved_inputs, or re-resolved config slugs).
    try {
      aiLetterSourceInputs = await loadPreMortemSourceInputs(
        run.config_snapshot as ConfigSnapshot | null,
        run.party_id,
        input.caseId,
        cfg,
      );
    } catch (err) {
      logger.warn({ err, caseId: input.caseId, runId }, "ai-engine: pre-mortem source-material load failed (non-fatal)");
    }

    // Mask BEFORE truncating: a cut landing mid-token (SSN/A-number/passport) would
    // break maskPii's contiguous match and leak raw PII to the provider. Truncating an
    // already-masked string can only garble a mask token (cosmetic), never leak.
    // The budget itself is applied LATER (dynamic — needs the rubric+source sizes).
    pendingMaskedMemo = maskPii(outputText);
  } else {
    if (!responseId) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Frozen target has no responseId" });
    // resolveFormResponseFieldValuesSystem runs the SAME resolution generateFilledPdf
    // does (incl. ES→EN translation + N/A policy) → validate exactly what would be
    // filed. System variant: the job has no actor (authz happened at enqueue).
    const cases = (await import("@/backend/modules/cases")) as {
      resolveFormResponseFieldValuesSystem: (responseId: string) => Promise<{
        caseId: string;
        formDefinitionId: string;
        fields: Array<{ pdfFieldName: string | null; label: string; fieldType: string; source: string; value: string | string[] | boolean | null; visible: boolean; required: boolean; empty: boolean; doNotFill: boolean }>;
        missingRequired: string[];
      }>;
    };
    const resolved = await cases.resolveFormResponseFieldValuesSystem(responseId);
    if (resolved.caseId !== input.caseId) throw new AuthzError("forbidden_case");
    formDefinitionId = resolved.formDefinitionId;
    documentBlock = maskPii(renderFieldsForValidation(resolved.fields, resolved.missingRequired));
  }

  if (!formDefinitionId) {
    throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Target has no form_definition" });
  }

  // --- Load the guide (rubric) ---
  const guide = await findFormFillGuide(formDefinitionId);
  if (!guide || !guide.enabled || !guide.guide_markdown.trim()) {
    throw new AiEngineError("PREMORTEM_NO_GUIDE", { formDefinitionId });
  }

  // --- Build the case/source context (masked, bounded). For an ai_letter memo we
  // inject the SOURCE material it was generated from (questionnaire answers +
  // declaración + evidencias, with OCR) so the validator can flag contradictions /
  // incoherence / vagueness against the record. For a pdf_automation form (or a memo
  // with no resolvable source) we inject the case extractions (e.g. DOB in the form
  // vs the passport extraction). ---
  let contextBlock = "(No case context available.)";
  let sourceBlock = "";
  if (aiLetterSourceInputs && (aiLetterSourceInputs.documents.length > 0 || aiLetterSourceInputs.forms.length > 0)) {
    const src = buildCaseContextBlocks(aiLetterSourceInputs).join("\n");
    if (src.trim()) {
      sourceBlock = budgetTextHeadTail(src, PREMORTEM_SOURCE_BUDGET, "material fuente", input.caseId);
    }
  }
  if (!sourceBlock) {
    try {
      const cases = (await import("@/backend/modules/cases")) as {
        getCaseExtractionsSystem: (caseId: string) => Promise<unknown[]>;
      };
      const extractions = await cases.getCaseExtractionsSystem(input.caseId);
      if (Array.isArray(extractions) && extractions.length > 0) {
        contextBlock = maskPii(JSON.stringify(extractions)).slice(0, PREMORTEM_CONTEXT_BUDGET);
      }
    } catch (err) {
      logger.warn({ err, caseId: input.caseId }, "ai-engine: pre-mortem case-context load failed (non-fatal)");
    }
  }

  // --- Apply the DYNAMIC artifact budget (ai_letter): the memo takes every char
  // the rubric + source/context leave free, so QA sees the whole document. ---
  if (pendingMaskedMemo !== null) {
    const docBudget = computePreMortemDocBudget(
      guide.guide_markdown.length,
      sourceBlock ? sourceBlock.length : contextBlock.length,
    );
    documentBlock =
      "## GENERATED LETTER (sensitive — identifiers masked)\n\n" +
      budgetTextHeadTail(pendingMaskedMemo, docBudget, "memo", input.caseId);
  }

  // --- Build validator prompt ---
  const model = configModel ?? PREMORTEM_DEFAULT_MODEL;
  const categoriesBlock = Object.values(FINDING_CATEGORIES_META)
    .map((c) => `- ${c.category}: ${c.label.en} — ${c.help.en}`)
    .join("\n");

  const systemPrompt =
    "RESPONDE EXCLUSIVAMENTE EN ESPAÑOL. Todo el texto libre que generes — `summary` y, en cada hallazgo, `description` y `correction` — DEBE estar redactado en español de España/Latinoamérica (el personal legal lee español). Aunque el documento, la guía y los nombres de campo estén en inglés, tu redacción va en español. " +
    "Eres un revisor de control de calidad (QA) meticuloso de expedientes migratorios de EE. UU. " +
    "A partir de una guía de llenado (la rúbrica), un documento generado (una carta de IA o un formulario oficial autollenado) y el contexto del caso, " +
    "encuentra cada error, discordancia, problema de formato, mal llenado de campos, marcador sin resolver, campo faltante e incoherencia interna, " +
    "y juzga si el documento tiene calidad suficiente para ser APROBADO. " +
    "Usa web_search para consultar ejemplos/instrucciones oficiales y calibrar la calidad. " +
    "Sé preciso y cita el campo o la sección exacta en cada hallazgo. " +
    "Mantén los campos de enumeración (`severity`, `category`, `semaforo`, `verdict`) EXACTAMENTE con los códigos dados (no los traduzcas); `location` puede conservar el nombre oficial del campo/sección en inglés. " +
    "DEBES responder únicamente con JSON válido, sin texto antes ni después.";

  const contextSection = sourceBlock
    ? "\n\n---\n## MATERIAL FUENTE (lo que el cliente declaró — el documento debe ser fiel y sin contradicciones)\n\n" + sourceBlock
    : "\n\n---\n## CASE CONTEXT (source data — PII masked; use to detect discrepancies)\n\n" + contextBlock;

  const userMessage =
    "## FILLING GUIDE (the rubric — validate strictly against it)\n\n" + guide.guide_markdown +
    "\n\n---\n" + documentBlock +
    contextSection +
    "\n\n---\n## FINDING CATEGORIES (use ONLY these category codes)\n\n" + categoriesBlock +
    "\n\n---\n## TAREA\n\n" +
    "Valida el documento contra la guía y el material del caso. Si hay MATERIAL FUENTE, compáralo con el documento y señala toda contradicción de hechos (fechas, lugares, personas, nexo), incoherencia interna, y afirmación vaga o no soportada por la fuente. Asigna un puntaje de calidad general (0-100), un semáforo y un veredicto sobre si sería aprobado. Enumera cada problema como un hallazgo. " +
    "Recuerda: `summary`, `description` y `correction` van EN ESPAÑOL; `severity`/`category`/`semaforo`/`verdict` van con los códigos exactos.\n\n" +
    "Responde SOLO con este JSON (sin prosa, sin fences de markdown):\n" +
    "{\n" +
    '  "score": 0,\n' +
    '  "semaforo": "green" | "amber" | "red",\n' +
    '  "verdict": "would_approve" | "needs_corrections" | "would_reject",\n' +
    '  "summary": "<evaluación general en 2-3 frases, EN ESPAÑOL>",\n' +
    '  "findings": [\n' +
    "    {\n" +
    '      "severity": "critico" | "moderado" | "sugerencia",\n' +
    '      "category": "<uno de los códigos de categoría de arriba>",\n' +
    '      "location": "<nombre del campo o sección>",\n' +
    '      "description": "<qué está mal — EN ESPAÑOL>",\n' +
    '      "correction": "<cómo corregirlo — EN ESPAÑOL>"\n' +
    "    }\n" +
    "  ]\n" +
    "}";

  return {
    caseId: input.caseId,
    targetKind,
    runId,
    responseId,
    formDefinitionId,
    model,
    systemPrompt,
    userMessage,
  };
}

/** What one validator call produced (before persistence). */
interface PreMortemCallResult {
  score: number;
  semaforo: Semaforo;
  verdict: Verdict;
  summary: string | null;
  findings: PreMortemFinding[];
  modelUsed: string;
  usage: AnthropicUsage;
  costUsd: number | null;
}

/**
 * Runs the single long validator call and parses/calibrates the report.
 *
 * Model fallback happens ONLY for fast-fail 400/model errors (they return in
 * seconds). A slow failure (timeout/5xx) throws: after a 700s call there is no
 * headroom for a second one inside the webhook's 800s maxDuration — the QStash
 * retry (via requeue in the job) is the retry mechanism, and a failed call
 * produced nothing so re-calling never doubles the spend.
 */
async function runPreMortemCall(ctx: PreMortemContext): Promise<PreMortemCallResult> {
  const client = getAnthropicClient();
  const { model, systemPrompt, userMessage } = ctx;
  let validatorText: string;
  let usage: AnthropicUsage;
  let modelUsed: string;

  try {
    const result = await callAnthropic(client, {
      model,
      system: systemPrompt,
      user: userMessage,
      maxTokens: PREMORTEM_MAX_OUTPUT_TOKENS,
      tools: [buildWebSearchTool(PREMORTEM_WEB_SEARCH_MAX_USES, model)],
      timeoutMs: PREMORTEM_CALL_TIMEOUT_MS,
    });
    validatorText = result.text;
    usage = result.usage;
    modelUsed = result.model;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, caseId: ctx.caseId, model }, "ai-engine: pre-mortem validator call failed");
    // Fast-fail detection must be NARROW: a bare `includes("model")` would match
    // any message that merely mentions a model name (e.g. some timeout wrappers)
    // and trigger a second full-length call inside the same 800s invocation.
    if (model !== PREMORTEM_FALLBACK_MODEL && (errMsg.includes("400") || errMsg.includes("model_not_found"))) {
      try {
        const fb = await callAnthropic(client, {
          model: PREMORTEM_FALLBACK_MODEL,
          system: systemPrompt,
          user: userMessage,
          maxTokens: PREMORTEM_MAX_OUTPUT_TOKENS,
          tools: [buildWebSearchTool(PREMORTEM_WEB_SEARCH_MAX_USES, PREMORTEM_FALLBACK_MODEL)],
          timeoutMs: PREMORTEM_CALL_TIMEOUT_MS,
        });
        validatorText = fb.text;
        usage = fb.usage;
        modelUsed = fb.model;
      } catch (fbErr) {
        throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", fbErr);
      }
    } else {
      throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", err);
    }
  }

  const costUsd = computeAnthropicCost(usage, modelUsed);

  // --- Parse + validate ---
  type ValidatorOutput = {
    score?: unknown;
    semaforo?: unknown;
    verdict?: unknown;
    summary?: unknown;
    findings?: Array<{ severity?: unknown; category?: unknown; location?: unknown; description?: unknown; correction?: unknown }>;
  };
  let parsed: ValidatorOutput | null = null;
  try {
    parsed = stripFencesAndParse<ValidatorOutput>(validatorText);
  } catch {
    // leave null → safe defaults
  }

  const score =
    typeof parsed?.score === "number" && Number.isFinite(parsed.score)
      ? Math.min(100, Math.max(0, Math.round(parsed.score)))
      : 50;
  const semaforo: Semaforo = isSemaforo(parsed?.semaforo) ? (parsed!.semaforo as Semaforo) : semaforoFromScore(score);
  const summary = typeof parsed?.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : null;

  const findings: PreMortemFinding[] = (parsed?.findings ?? [])
    .filter((f): f is NonNullable<typeof f> => f != null && isFindingSeverity(f.severity) && isFindingCategory(f.category))
    .map((f) => ({
      severity: f.severity as FindingSeverity,
      category: f.category as FindingCategory,
      location: typeof f.location === "string" ? f.location : "",
      description: typeof f.description === "string" ? f.description : "",
      correction: typeof f.correction === "string" ? f.correction : "",
    }))
    .sort((a, b) => compareFindingSeverity(a.severity, b.severity));

  // The rubrics' §5.3 approval criterion is a DETERMINISTIC rule — enforce it in
  // code instead of trusting the model's verdict field (a 79 with zero críticos
  // was coming back "needs_corrections" on the model's mood): with críticos it
  // can never approve; without them, ≥75 approves; <50 always rejects.
  const hasCritico = findings.some((f) => f.severity === "critico");
  const verdict: Verdict =
    score < 50 ? "would_reject"
    : hasCritico ? "needs_corrections"
    : score >= 75 ? "would_approve"
    : "needs_corrections";
  const modelVerdict = isVerdict(parsed?.verdict) ? (parsed!.verdict as Verdict) : null;
  if (modelVerdict && modelVerdict !== verdict) {
    logger.info(
      { caseId: ctx.caseId, modelVerdict, calibratedVerdict: verdict, score, hasCritico },
      "ai-engine: pre-mortem verdict calibrated per rubric §5.3",
    );
  }

  return { score, semaforo, verdict, summary, findings, modelUsed, usage, costUsd };
}

/**
 * API — Enqueues an async Pre-Mortem validation (QStash job model).
 *
 * Authorizes (staff-only + case access + IDOR), FREEZES the concrete artifact
 * (run_id/response_id — never re-resolved later), fails fast on a missing guide,
 * rejects if a generation of the same form is in flight (the artifact would be
 * obsolete by the time the report lands), and inserts the 'queued' row — whose
 * partial unique index IS the atomic anti-duplicate lock. Then enqueues
 * run-premortem with a per-ROW dedupeId and an explicit 780s endpoint timeout
 * (QStash's 60s default would fire a CONCURRENT retry mid-call = double spend).
 *
 * @throws AiEngineError("PREMORTEM_NO_TARGET" | "PREMORTEM_NO_GUIDE" |
 *         "PREMORTEM_IN_PROGRESS" | "PREMORTEM_TARGET_REGENERATING")
 */
export async function startPreMortemValidation(
  actor: Actor,
  input: { caseId: string; target: PreMortemTarget },
): Promise<{ assessmentId: string }> {
  await requireCaseAccess(actor, input.caseId);
  // Staff-only work product — never exposed to clients, even case members.
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const target = input.target;
  let targetKind: "ai_letter" | "pdf_automation";
  let runId: string | null = null;
  let responseId: string | null = null;
  let formDefinitionId = "";
  let partyId: string | null = null;

  if (target.kind === "ai_letter") {
    targetKind = "ai_letter";
    let run: Awaited<ReturnType<typeof findRunById>>;
    if (target.runId) {
      run = await findRunById(target.runId);
      if (!run) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Provided run not found", runId: target.runId });
    } else {
      const eligible = await findLatestEligibleRunForPreMortem(input.caseId);
      if (!eligible) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "No completed ai_letter run with an enabled guide", caseId: input.caseId });
      run = await findRunById(eligible.runId);
      if (!run) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Eligible run not found", runId: eligible.runId });
    }
    // IDOR: the run MUST belong to the already-authorized case.
    if (run.case_id !== input.caseId) throw new AuthzError("forbidden_case");
    runId = run.id;
    formDefinitionId = run.form_definition_id ?? "";
    partyId = run.party_id;
  } else {
    targetKind = "pdf_automation";
    responseId = target.responseId;
    // Light meta only — the heavy field resolution happens in the job.
    const cases = (await import("@/backend/modules/cases")) as {
      getFormResponseMeta: (responseId: string) => Promise<{ caseId: string; formDefinitionId: string } | null>;
    };
    const meta = await cases.getFormResponseMeta(responseId);
    if (!meta) throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Response not found", responseId });
    // IDOR: the response MUST belong to the already-authorized case.
    if (meta.caseId !== input.caseId) throw new AuthzError("forbidden_case");
    formDefinitionId = meta.formDefinitionId;
  }

  if (!formDefinitionId) {
    throw new AiEngineError("PREMORTEM_NO_TARGET", { reason: "Target has no form_definition" });
  }

  // Fail fast + synchronously on config errors the staff can act on immediately.
  const guide = await findFormFillGuide(formDefinitionId);
  if (!guide || !guide.enabled || !guide.guide_markdown.trim()) {
    throw new AiEngineError("PREMORTEM_NO_GUIDE", { formDefinitionId });
  }

  // Cross-lock: validating a letter while it regenerates would report on an
  // artifact that is obsolete the moment the new version lands. (One direction
  // only — regenerating DURING a validation is fine: the report stays anchored
  // to its historical run_id.)
  if (targetKind === "ai_letter") {
    const regenerating = await findActiveRun(input.caseId, formDefinitionId, partyId);
    if (regenerating) {
      throw new AiEngineError("PREMORTEM_TARGET_REGENERATING", { formDefinitionId });
    }
  }

  const inserted = await insertPreMortemQueued({
    case_id: input.caseId,
    target_kind: targetKind,
    run_id: runId,
    response_id: responseId,
    form_definition_id: formDefinitionId,
    status: "queued",
    created_by: actor.userId,
  });
  if (inserted === "duplicate") {
    throw new AiEngineError("PREMORTEM_IN_PROGRESS", { formDefinitionId });
  }

  try {
    await enqueueJob(
      {
        jobKey: "run-premortem",
        entityId: inserted.id,
        attempt: 1,
        // Per-ROW dedupe: a per-target dedupeId would make QStash silently drop
        // legitimate re-validations inside its dedup window (queued zombie row).
        dedupeId: `run-premortem:${inserted.id}`,
        orgId: actor.orgId,
        assessmentId: inserted.id,
      },
      { retries: 2, timeout: "780s" },
    );
  } catch (err) {
    // Compensate: an unenqueued 'queued' row would hold the artifact lock until
    // the lazy sweep — free it immediately instead.
    await markPreMortemFailed(inserted.id, "enqueue_failed");
    throw err;
  }

  await writeAudit(actor, "ai.premortem.queued", "case_pre_mortem_assessment", inserted.id, {
    after: { caseId: input.caseId, targetKind, runId, responseId },
  });

  logger.info(
    { job: "startPreMortemValidation", assessmentId: inserted.id, caseId: input.caseId, targetKind, runId, responseId },
    "ai-engine: pre-mortem validation queued",
  );

  return { assessmentId: inserted.id };
}

export interface RunPreMortemPayload {
  jobKey: "run-premortem";
  entityId: string;
  attempt: number;
  dedupeId: string;
  orgId: string;
  assessmentId: string;
}

/** In-process persist retries after a SUCCESSFUL (paid) validator call. */
const PREMORTEM_PERSIST_RETRIES = 3;
const PREMORTEM_PERSIST_BACKOFF_MS = 150;
/** Running past this = the invocation is dead (Vercel hard-kills at 800s). */
const PREMORTEM_STALE_RUNNING_MS = 15 * 60_000;
/** Queued past this = the enqueue was lost (QStash delivers in seconds). */
const PREMORTEM_STALE_QUEUED_MS = 30 * 60_000;

/**
 * Executes the run-premortem QStash job (called by jobs/run-premortem.ts).
 *
 * Cost discipline around the single long Anthropic call:
 *   1. Atomic claim queued→running — a lost claim SKIPS (at-least-once delivery
 *      must never trigger a second paid call; no stale re-claim either: a zombie
 *      may have completed the call server-side, so re-running risks double spend).
 *   2. Deterministic resolve errors (guide/artifact gone) → failed, NO retry.
 *   3. Call failure → revert to queued + throw (QStash retries; nothing was paid for).
 *   4. Persist failure AFTER a successful call → in-process retries, then failed
 *      WITHOUT rethrow (never re-run a paid 700s call for a DB hiccup).
 */
export async function executePreMortemJob(payload: RunPreMortemPayload): Promise<JobOutcome> {
  const row = await findPreMortemAssessmentById(payload.assessmentId);
  if (!row) {
    logger.warn({ assessmentId: payload.assessmentId }, "ai-engine: run-premortem row not found — skipping");
    return "skipped";
  }
  if (row.status === "completed" || row.status === "failed") {
    return "skipped";
  }

  const claimed = await claimPreMortemAssessment(row.id);
  if (!claimed) {
    logger.info({ assessmentId: row.id }, "ai-engine: run-premortem claim lost (concurrent delivery) — skipping");
    return "skipped";
  }

  let ctx: PreMortemContext;
  try {
    ctx = await resolvePreMortemContext({
      caseId: row.case_id,
      targetKind: (row.target_kind as "ai_letter" | "pdf_automation") ?? "ai_letter",
      runId: row.run_id,
      responseId: row.response_id,
    });
  } catch (err) {
    if (err instanceof AiEngineError || (err as Error | null)?.name === "AuthzError") {
      // Deterministic: retrying cannot heal a missing guide/artifact.
      const msg = err instanceof AiEngineError ? err.code : (err as Error).message;
      await markPreMortemFailed(row.id, `resolve: ${msg}`);
      return "failed";
    }
    // Transient infra (storage/network) — revert the claim and let QStash retry.
    await requeuePreMortemAssessment(row.id);
    throw err;
  }

  let result: PreMortemCallResult;
  try {
    result = await runPreMortemCall(ctx);
  } catch (err) {
    // Revert the claim so the QStash retry re-runs the call. NOTE: a client-side
    // timeout can abort a request Anthropic already accepted (and billed) — this
    // retry is a DELIBERATE reliability-over-cost tradeoff (Henry 2026-07-17:
    // "no importa el costo, lo tiene que hacer bien"): a real client's validation
    // must land even if a lost response costs one extra call. Bounded: retries=2
    // caps the worst case at 3 paid calls per assessment.
    await requeuePreMortemAssessment(row.id);
    throw err;
  }

  for (let attempt = 1; attempt <= PREMORTEM_PERSIST_RETRIES; attempt++) {
    try {
      const { rowsAffected } = await completePreMortemAssessment(row.id, {
        score: result.score,
        semaforo: result.semaforo,
        verdict: result.verdict,
        summary: result.summary,
        findings: result.findings as unknown as import("@/shared/database.types").Json,
        model: result.modelUsed,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cost_usd: result.costUsd,
      });
      if (rowsAffected === 0) {
        // Cancelled/failed meanwhile — keep the spend, don't resurrect the row.
        logger.warn({ assessmentId: row.id }, "ai-engine: run-premortem result discarded (row left running state meanwhile)");
        return "skipped";
      }
      logger.info(
        { job: "executePreMortemJob", assessmentId: row.id, caseId: row.case_id, score: result.score, verdict: result.verdict, findingCount: result.findings.length, model: result.modelUsed, costUsd: result.costUsd },
        "ai-engine: pre-mortem validation completed",
      );
      return "completed";
    } catch (err) {
      logger.error({ err, assessmentId: row.id, attempt }, "ai-engine: run-premortem persist failed");
      if (attempt < PREMORTEM_PERSIST_RETRIES) {
        await new Promise((r) => setTimeout(r, PREMORTEM_PERSIST_BACKOFF_MS * attempt));
      }
    }
  }
  // Paid call, unpersistable result: NEVER re-run — fail and keep the spend traceable.
  await markPreMortemFailed(row.id, "persist_failed_after_successful_call");
  return "failed";
}

/** job-failed callback: marks the assessment failed after QStash exhausts retries. */
export async function markPreMortemFailedByCallback(assessmentId: string, errorMsg: string): Promise<void> {
  logger.error({ assessmentId, errorMsg }, "ai-engine: run-premortem exhausted retries — marking failed");
  await markPreMortemFailed(assessmentId, errorMsg);
}

/**
 * Cancels a QUEUED validation (user regret). Running rows are not cancellable —
 * the provider call is already in flight and paid; the job's guarded terminal
 * write (WHERE status='running') makes a cancelled queued row a clean no-op.
 */
export async function cancelPreMortemValidation(
  actor: Actor,
  assessmentId: string,
): Promise<{ cancelled: boolean }> {
  const row = await findPreMortemAssessmentById(assessmentId);
  if (!row) throw new AiEngineError("PREMORTEM_NO_TARGET", { assessmentId });
  await requireCaseAccess(actor, row.case_id);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const cancelled = await cancelQueuedPreMortemAssessment(assessmentId);
  return { cancelled };
}

/** Lightweight poll endpoint for the UI: the row's lifecycle status. */
export async function getPreMortemStatus(
  actor: Actor,
  assessmentId: string,
): Promise<{ id: string; status: PreMortemRunStatus }> {
  const row = await findPreMortemAssessmentById(assessmentId);
  if (!row) throw new AiEngineError("PREMORTEM_NO_TARGET", { assessmentId });
  await requireCaseAccess(actor, row.case_id);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  return { id: row.id, status: (row.status as PreMortemRunStatus) ?? "completed" };
}

/**
 * Lists the Pre-Mortem assessment history for a case (newest first).
 * Requires case access.
 */
export async function getPreMortemAssessmentsForCase(
  actor: Actor,
  caseId: string,
): Promise<PreMortemAssessment[]> {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind"); // staff-only work product

  // Lazy zombie reaper: heal stale in-flight rows exactly where they are read
  // (no cron needed). Deliberately a write on the read path — self-curing UI.
  const now = Date.now();
  await sweepStalePreMortemForCase(caseId, {
    runningBefore: new Date(now - PREMORTEM_STALE_RUNNING_MS).toISOString(),
    queuedBefore: new Date(now - PREMORTEM_STALE_QUEUED_MS).toISOString(),
  });

  const rows = await listPreMortemAssessmentsForCase(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    targetKind: (row.target_kind as "ai_letter" | "pdf_automation") ?? "ai_letter",
    runId: row.run_id,
    responseId: row.response_id,
    formDefinitionId: row.form_definition_id,
    score: row.score ?? 0,
    semaforo: isSemaforo(row.semaforo) ? (row.semaforo as Semaforo) : semaforoFromScore(row.score ?? 0),
    verdict: isVerdict(row.verdict) ? (row.verdict as Verdict) : "needs_corrections",
    summary: row.summary,
    findings: (Array.isArray(row.findings) ? row.findings : []) as unknown as PreMortemFinding[],
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    createdBy: row.created_by,
    createdAt: row.created_at,
    status: (row.status as PreMortemAssessment["status"]) ?? "completed",
    error: row.error ?? null,
  }));
}

/**
 * Returns true if the Pre-Mortem tab should be enabled for the given case —
 * i.e. if any form_definition for the case's service has a Pre-Mortem guide with
 * enabled=true (covers both ai_letter and pdf_automation).
 */
export async function isPreMortemEnabledForCase(
  actor: Actor,
  caseId: string,
): Promise<boolean> {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") return false; // staff-only feature → no tab for clients
  return findGuideEnabledFormForCase(caseId);
}

/**
 * Lists the documents that can be validated in the Pre-Mortem tab: for each form of
 * the case's service with an enabled guide, the completed ai_letter runs and the
 * pdf_automation responses that have an artifact. Newest first.
 */
export async function listValidableTargetsForCase(
  actor: Actor,
  caseId: string,
): Promise<ValidableTarget[]> {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") return [];

  const guided = await listGuideEnabledFormsForCase(caseId);
  if (guided.length === 0) return [];

  const letterForms = guided.filter((f) => f.kind === "ai_letter");
  const automationForms = guided.filter((f) => f.kind === "pdf_automation");
  const labelByForm = new Map(guided.map((f) => [f.id, f.label_i18n]));

  const targets: ValidableTarget[] = [];

  // ai_letter → completed runs with a usable memo.
  const runs = await listCompletedRunsForForms(caseId, letterForms.map((f) => f.id));
  for (const run of runs) {
    if (!run.output_text && !run.output_path) continue;
    targets.push({
      kind: "ai_letter",
      formDefinitionId: run.form_definition_id,
      labelI18n: labelByForm.get(run.form_definition_id) ?? null,
      runId: run.id,
      partyId: run.party_id,
      createdAt: run.created_at,
    });
  }

  // pdf_automation → responses that have a generated artifact (or are submitted/approved).
  const responses = await listFormResponsesForForms(caseId, automationForms.map((f) => f.id));
  for (const r of responses) {
    const hasArtifact = !!r.filled_pdf_path || r.status === "submitted" || r.status === "approved";
    if (!hasArtifact) continue;
    targets.push({
      kind: "pdf_automation",
      formDefinitionId: r.form_definition_id,
      labelI18n: labelByForm.get(r.form_definition_id) ?? null,
      responseId: r.id,
      partyId: r.party_id,
      status: r.status,
      createdAt: r.created_at,
    });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Re-export sumMonthlyCosts for budget aggregation job
// ---------------------------------------------------------------------------

export { sumMonthlyCosts };
