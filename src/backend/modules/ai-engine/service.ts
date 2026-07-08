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
import { enqueueJob } from "@/backend/platform/qstash";
import { getAnthropicClient } from "@/backend/platform/anthropic";
import { getGeminiModels, DEFAULT_GEMINI_MODEL } from "@/backend/platform/gemini";
import { isAiStubEnabled } from "@/backend/platform/ai-stub";
import {
  createSignedDownloadUrl as _createSignedDownloadUrl,
  uploadBytesToStorage,
  downloadBytesFromStorage,
} from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import { renderMarkdownToPdf, renderMarkdownToDocx, renderCertifiedTranslationPdf } from "@/backend/platform/pdf";
import { checkUrlReachable, keepReachable } from "@/backend/platform/url-utils";
import { embedText } from "@/backend/platform/embeddings";
import { DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";
import {
  isDenialReasonCode,
  DENIAL_REASONS,
  type DenialReasonCode,
} from "@/shared/constants/denial-reasons";
import { resolvePeriodRange, type Period } from "@/shared/period";
import { isVerbatimValue } from "@/shared/form-logic/empty-policy";

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
  buildWebSearchTool,
  countWords,
  lastWords,
  buildSectionUserMessage,
  buildExpansionUserMessage,
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
} from "./domain";

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
  upsertExtraction,
  findTranslation,
  findTranslationById,
  insertTranslation,
  resetTranslation,
  completeTranslation,
  getCaseDocumentForAi,
  getTranslationSource,
  loadDatasetItems,
  loadResolvedInputs,
  findGenerationConfig,
  matchDatasetItems,
  insertPreMortemAssessment,
  listPreMortemAssessmentsForCase,
  findPreMortemEnabledConfigForCase,
  findLatestEligibleRunForPreMortem,
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
      | "PREMORTEM_NO_ELIGIBLE_RUN",
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "AiEngineError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const _AI_DOCUMENT_MAX_PAGES = 100;
const AI_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024; // 25 MB
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
    resolved_inputs: { documents: [], forms: [] },
    dataset_injection: null,
  };

  const run = await insertRun({
    case_id: p.caseId,
    form_definition_id: p.formDefinitionId,
    party_id: p.partyId ?? null,
    status: "queued",
    version,
    is_test: p.isTest ?? false,
    requested_by: actor.userId,
    config_snapshot: configSnapshot as unknown as import("@/shared/database.types").Json,
  });

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

  emitGenerationCompleted({
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
function deriveCoverContext(inputs: ResolvedInputs, analysis: ResearchAnalysis | null): Record<string, string> {
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
  set("applicant_name", pick("full_name", "name", "applicant_name", "nombre_completo"));
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
      let res = await callAnthropic(client, { model: secModel, system: prompt.system, user: secContent, maxTokens: sec.max_tokens });
      account(res);
      if (sec.min_words > 0 && countWords(res.text) < sec.min_words) {
        const exp = await callAnthropic(client, {
          model: secModel,
          system: prompt.system,
          user: buildExpansionUserMessage(secContent, res.text, sec.min_words),
          maxTokens: sec.max_tokens,
        });
        account(exp);
        if (countWords(exp.text) > countWords(res.text)) res = exp;
      }
      parts.push(`## ${sec.heading}\n\n${stripLeadingHeading(res.text.trim(), sec.heading)}`);
      prevTail = lastWords(res.text, 1200);
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

  // Size/page limits (DOC-74 §3.3)
  if (doc.sizeBytes > AI_DOCUMENT_MAX_BYTES) {
    await upsertExtraction({
      case_document_id: doc.id,
      status: "failed",
      model: process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      error: `AI_DOCUMENT_TOO_LARGE: file ${Math.round(doc.sizeBytes / 1024 / 1024)}MB exceeds 25MB limit`,
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
          maxOutputTokens: 8192,
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

  emitExtractionCompleted({ caseId: doc.caseId, caseDocumentId: doc.id });

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
    let response;

    if (source.rawText) {
      // Use raw_text directly (no PDF resend)
      response = await geminiModels.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: `${promptText}\n\n---\n${source.rawText}` },
            ],
          },
        ],
        config: {
          temperature: 0.2,
          maxOutputTokens: 65536,
        },
      });
    } else if (source.storagePath) {
      // Fetch PDF and translate multimodal
      const { createServiceClient } = await import("@/backend/platform/supabase");
      const supabase = createServiceClient();
      const { data: fileData } = await supabase.storage
        .from("case-documents")
        .download(source.storagePath);

      const fileBytes = fileData ? new Uint8Array(await fileData.arrayBuffer()) : new Uint8Array();
      const fileBase64 = Buffer.from(fileBytes).toString("base64");

      response = await geminiModels.generateContent({
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

    translatedText = stripMarkdownFence(response.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
    inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

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
  const base64 = Buffer.from(input.bytes).toString("base64");

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
  fields: AiFieldRequest[];
  model?: string | null;
}): Promise<Record<string, string>> {
  if (input.fields.length === 0) return {};
  if (isAiStubEnabled()) {
    return Object.fromEntries(input.fields.map((f) => [f.id, `[stub-doc: ${f.instruction.slice(0, 60)}]`]));
  }
  const model = input.model || process.env.AI_GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const prompt =
    "Eres un asistente legal que INTERPRETA un documento (no extraes un dato literal: " +
    "lees, comprendes y redactas). Para cada campo, produce el texto solicitado basándote " +
    "ÚNICAMENTE en el contenido real del documento. Si el documento no lo respalda, devuelve " +
    "cadena vacía para ese id (NO inventes).\n\nCampos:\n" +
    buildAiFieldList(input.fields) +
    '\n\nResponde en JSON: {"answers":[{"id":"<id>","value":"<texto>"}]}.';
  try {
    const response = await getGeminiModels().generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: input.mimeType, data: input.fileBase64 } },
            { text: prompt },
          ],
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

  const context = {
    case: input.caseLabel,
    serviceCategory: input.serviceCategory ?? null,
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

  const buildUserPrompt = (feedback?: string): string => {
    const lines = [
      "CONTEXT (JSON):",
      JSON.stringify(context, null, 2),
      "",
      "RULES:",
      "0. ALL section titles MUST be written in ENGLISH — the case file is filed with USCIS / the immigration court in English. Translate the artifact labels to natural English titles. Keep party PERSON NAMES verbatim (do not translate names).",
      "1. Order the sections following the canonical legal sequence for the case type. General order:",
      "   a) Initial instructions / petition / main USCIS form, b) sworn declarations & affidavits,",
      "   c) documents of each beneficiary/minor, d) documents of the petitioner/sponsor, e) witnesses, f) supporting evidence.",
      "   Example (Juvenile Visa / custody): Petition for Temporary Guardianship → Sworn Declaration of the Minor → Affidavit of Mother/Sponsor → Documents of the Minor → Documents of the Petitioner → Affidavit of Witness.",
      "   Example (Asylum): Form I-589 → Credible Fear Memorandum → documents per family member (beneficiary minor, spouse, each child) → supporting evidence.",
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
 * One predicted denial reason from the Pre-Mortem critic.
 * `code` is a stable `DenialReasonCode` — the UI resolves labels via DENIAL_REASONS.
 */
export interface PreMortemReason {
  code: DenialReasonCode;
  probability: number; // 0..1
  rationale: string;
  correction: string;
}

/**
 * A persisted Pre-Mortem assessment (returned from assessPreMortemRisk and listed
 * by getPreMortemAssessmentsForCase).
 */
export interface PreMortemAssessment {
  id: string;
  caseId: string;
  runId: string | null;
  formDefinitionId: string | null;
  overallRisk: "low" | "medium" | "high";
  summary: string;
  reasons: PreMortemReason[];
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdBy: string;
  createdAt: string;
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
 * Runs the Pre-Mortem critic for a case and persists the assessment.
 *
 * Flow:
 *  a. Resolve run (explicit runId or the latest eligible completed run).
 *  b. Load output_text (the legal memo).
 *  c. Retrieve similar precedents (semantic → lexical fallback).
 *  d. Call Anthropic critic (masked PII, structured JSON output).
 *  e. Persist to case_pre_mortem_assessments.
 *  f. Return the typed PreMortemAssessment.
 *
 * @throws AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN") if no completed eligible run found.
 * @throws AiEngineError("AI_PROVIDER_UNAVAILABLE") on Anthropic failure.
 */
export async function assessPreMortemRisk(
  actor: Actor,
  input: { caseId: string; runId?: string },
): Promise<PreMortemAssessment> {
  await requireCaseAccess(actor, input.caseId);
  // Staff-only work product (internal denial-risk strategy) — never exposed to
  // clients, even case members. Server actions are POST endpoints, so the
  // staff-only UI is not an authorization boundary on its own.
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  // --- Step a/b: Resolve run + output_text ---
  let outputText: string;
  let resolvedRunId: string;
  let formDefinitionId: string | null = null;
  let configModel: string | null = null;
  let datasetId: string | null = null;

  if (input.runId) {
    // Explicit run provided — look it up
    const run = await findRunById(input.runId);
    if (!run) {
      throw new AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN", {
        reason: "Provided run not found",
        runId: input.runId,
      });
    }
    // The run MUST belong to the already-authorized case. findRunById takes a
    // GLOBAL runId; without this an actor could pass their own caseId + another
    // org's runId and exfiltrate that memo's PII (IDOR). Mirrors cancelGeneration.
    if (run.case_id !== input.caseId) {
      throw new AuthzError("forbidden_case");
    }
    outputText = await resolveMemoText(run.output_text, run.output_path);
    resolvedRunId = run.id;
    formDefinitionId = run.form_definition_id ?? null;
    // Load config for model + dataset_id
    if (formDefinitionId) {
      const cfg = await findGenerationConfig(formDefinitionId);
      configModel = cfg?.model ?? null;
      datasetId = cfg?.dataset_id ?? null;
    }
  } else {
    // Auto-select: find the latest completed run whose form_definition has pre_mortem_enabled=true
    const eligible = await findLatestEligibleRunForPreMortem(input.caseId);
    if (!eligible) {
      throw new AiEngineError("PREMORTEM_NO_ELIGIBLE_RUN", {
        reason: "No completed run with pre_mortem_enabled=true found for this case",
        caseId: input.caseId,
      });
    }
    outputText = await resolveMemoText(eligible.outputText, eligible.outputPath);
    resolvedRunId = eligible.runId;
    formDefinitionId = eligible.formDefinitionId;
    configModel = eligible.model;
    // Load dataset_id from config
    const cfg = await findGenerationConfig(formDefinitionId);
    datasetId = cfg?.dataset_id ?? null;
  }

  // --- Step c: Retrieve similar precedents ---
  const precedentItems = await retrieveDatasetItemsWithFallback(
    datasetId,
    outputText.slice(0, PREMORTEM_EMBED_MAX_CHARS),
  );

  // Build precedent context block for the prompt
  const precedentBlock = precedentItems.length > 0
    ? precedentItems
        .map((item) => {
          const outcome = item.outcome ? ` [${item.outcome}]` : "";
          const jurisdiction = item.jurisdiction ? ` (${item.jurisdiction})` : "";
          return `<precedent title="${item.title}"${outcome}${jurisdiction}>\n${item.content ?? "(sin contenido)"}\n</precedent>`;
        })
        .join("\n\n")
    : "(No se encontraron precedentes similares en el dataset.)";

  // Build the denial reason taxonomy block
  const taxonomyBlock = Object.values(DENIAL_REASONS)
    .map((r) => `- ${r.code}: ${r.label.en} — ${r.help.en}`)
    .join("\n");

  // --- Step d: Call Anthropic critic ---
  const maskedMemo = maskPii(outputText);
  const model = configModel ?? PREMORTEM_DEFAULT_MODEL;

  const systemPrompt =
    "You are a senior U.S. immigration attorney playing the role of a skeptical asylum adjudicator. " +
    "Your task is to read a legal memorandum prepared for an asylum case and predict the most likely " +
    "grounds on which an immigration judge or asylum officer would DENY the claim. " +
    "You also have access to similar precedent cases (won and lost) for reference. " +
    "Be critical and precise. Your goal is to surface real weaknesses so the legal team can fix them " +
    "before filing — not to validate the memo. " +
    "You MUST respond with valid JSON only, no prose before or after.";

  const userMessage =
    "## LEGAL MEMORANDUM (sensitive — identifiers masked)\n\n" +
    maskedMemo +
    "\n\n---\n## SIMILAR PRECEDENTS\n\n" +
    precedentBlock +
    "\n\n---\n## DENIAL REASON TAXONOMY (use ONLY these codes)\n\n" +
    taxonomyBlock +
    '\n\n---\n## TASK\n\n' +
    'Analyze the memorandum and predict the most likely denial grounds. ' +
    'For each ground, assign a probability (0.0–1.0) and provide:\n' +
    '  - rationale: why this ground is a risk based on the memo\n' +
    '  - correction: what the legal team should add/fix to address it\n\n' +
    'Respond ONLY with this JSON (no prose, no markdown fences):\n' +
    '{\n' +
    '  "overallRisk": "low" | "medium" | "high",\n' +
    '  "summary": "<2-3 sentence overall assessment>",\n' +
    '  "reasons": [\n' +
    '    {\n' +
    '      "code": "<DenialReasonCode from the taxonomy above>",\n' +
    '      "probability": 0.0,\n' +
    '      "rationale": "<why this is a risk>",\n' +
    '      "correction": "<what to fix>"\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    'Include only reasons with probability > 0.10. Sort reasons by probability descending.';

  const client = getAnthropicClient();
  let criticText: string;
  let usage: AnthropicUsage;
  let modelUsed: string;

  try {
    const result = await callAnthropic(client, {
      model,
      system: systemPrompt,
      user: userMessage,
      maxTokens: 4096,
      timeoutMs: 180_000,
    });
    criticText = result.text;
    usage = result.usage;
    modelUsed = result.model;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg, caseId: input.caseId, model }, "ai-engine: pre-mortem critic call failed");
    // Retry once with fallback model if the primary model was rejected
    if (model !== PREMORTEM_FALLBACK_MODEL && (errMsg.includes("400") || errMsg.includes("model"))) {
      try {
        const fallback = await callAnthropic(client, {
          model: PREMORTEM_FALLBACK_MODEL,
          system: systemPrompt,
          user: userMessage,
          maxTokens: 4096,
          timeoutMs: 180_000,
        });
        criticText = fallback.text;
        usage = fallback.usage;
        modelUsed = fallback.model;
      } catch (fallbackErr) {
        throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", fallbackErr);
      }
    } else {
      throw new AiEngineError("AI_PROVIDER_UNAVAILABLE", err);
    }
  }

  const costUsd = computeAnthropicCost(usage, modelUsed);

  // --- Parse critic JSON (tolerant) ---
  type CriticOutput = {
    overallRisk?: string;
    summary?: string;
    reasons?: Array<{
      code?: unknown;
      probability?: unknown;
      rationale?: unknown;
      correction?: unknown;
    }>;
  };

  let parsed: CriticOutput | null = null;
  try {
    parsed = stripFencesAndParse<CriticOutput>(criticText);
  } catch {
    // strip failed — leave as null, we'll use an empty result
  }

  // Validate overallRisk
  const rawRisk = parsed?.overallRisk ?? "medium";
  const overallRisk: "low" | "medium" | "high" =
    rawRisk === "low" || rawRisk === "high" ? rawRisk : "medium";

  const summary = typeof parsed?.summary === "string" && parsed.summary.trim()
    ? parsed.summary.trim()
    : "Pre-mortem analysis completed.";

  // Filter + validate reasons
  const reasons: PreMortemReason[] = (parsed?.reasons ?? [])
    .filter((r): r is NonNullable<typeof r> => r != null && isDenialReasonCode(r.code))
    .map((r) => ({
      code: r.code as DenialReasonCode,
      probability: typeof r.probability === "number"
        ? Math.min(1, Math.max(0, r.probability))
        : 0,
      rationale: typeof r.rationale === "string" ? r.rationale : "",
      correction: typeof r.correction === "string" ? r.correction : "",
    }))
    .sort((a, b) => b.probability - a.probability);

  // --- Step e: Persist ---
  const { id: assessmentId, created_at } = await insertPreMortemAssessment({
    case_id: input.caseId,
    run_id: resolvedRunId,
    form_definition_id: formDefinitionId,
    overall_risk: overallRisk,
    summary,
    reasons: reasons as unknown as import("@/shared/database.types").Json,
    model: modelUsed,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: costUsd,
    created_by: actor.userId,
  });

  logger.info(
    {
      job: "assessPreMortemRisk",
      caseId: input.caseId,
      runId: resolvedRunId,
      overallRisk,
      reasonCount: reasons.length,
      model: modelUsed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
    },
    "ai-engine: pre-mortem assessment completed",
  );

  return {
    id: assessmentId,
    caseId: input.caseId,
    runId: resolvedRunId,
    formDefinitionId,
    overallRisk,
    summary,
    reasons,
    model: modelUsed,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd,
    createdBy: actor.userId,
    createdAt: created_at,
  };
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

  const rows = await listPreMortemAssessmentsForCase(caseId);

  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    runId: row.run_id,
    formDefinitionId: row.form_definition_id,
    overallRisk: (row.overall_risk as "low" | "medium" | "high") ?? "medium",
    summary: row.summary,
    reasons: (Array.isArray(row.reasons) ? row.reasons : []) as unknown as PreMortemReason[],
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

/**
 * Returns true if the Pre-Mortem tab should be enabled for the given case —
 * i.e. if any form_definition for the case's service has pre_mortem_enabled=true.
 */
export async function isPreMortemEnabledForCase(
  actor: Actor,
  caseId: string,
): Promise<boolean> {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") return false; // staff-only feature → no tab for clients
  return findPreMortemEnabledConfigForCase(caseId);
}

// ---------------------------------------------------------------------------
// Re-export sumMonthlyCosts for budget aggregation job
// ---------------------------------------------------------------------------

export { sumMonthlyCosts };
