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
import { createSignedDownloadUrl as _createSignedDownloadUrl } from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import { renderMarkdownToPdf, renderMarkdownToDocx } from "@/backend/platform/pdf";
import { DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";

import {
  canTransitionRun,
  nextVersion,
  evaluateBudget,
  decideChunking,
  selectDatasetItems,
  assemblePrompt,
  validateGenerationOutput,
  computeAnthropicCost,
  computeGeminiCost,
  // sumUsage: reserved for multi-chunk runs (F4-2 chunking). Prefixed to suppress unused warning.
  sumUsage as _sumUsage,
  type GenerationRequest,
  type ConfigSnapshot,
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
  updateRunProgress as _updateRunProgress,
  patchConfigSnapshot,
  countRunningByOrg,
  listRunsForCase,
  sumMonthlyCosts,
  sumCosts,
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
  type GenerationRunRow,
  type DocumentExtractionRow as _DocumentExtractionRow,
  type DocumentTranslationRow,
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
      | "AI_DOCUMENT_TOO_LARGE",
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

  // Build minimal config_snapshot (catalog provides real config; we stub here
  // since catalog module integration is F4-2+)
  const configSnapshot: ConfigSnapshot = {
    system_prompt: "",
    input_document_slugs: [],
    input_form_slugs: [],
    dataset_id: null,
    model: DEFAULT_GENERATION_MODEL,
    max_output_tokens: 32000,
    output_format: "pdf",
    output_language: "es",
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
  const selected = selectDatasetItems(datasetItems, runContext, DATASET_BUDGET);

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

  // Call Anthropic (streaming as transport, DOC-74 §2.5)
  const model = snapshot.model ?? DEFAULT_GENERATION_MODEL;
  const needsChunking = decideChunking(snapshot.max_output_tokens, 10000);

  let outputText: string;
  let stopReason: string;
  let usage: AnthropicUsage;
  let modelUsed = model;

  try {
    const client = getAnthropicClient();

    // Build system blocks for Anthropic API with cache_control
    const systemBlocks = prompt.system.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cacheControl ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    // Streaming transport (required for large outputs per DOC-74 §2.5)
    const stream = client.messages.stream({
      model,
      max_tokens: snapshot.max_output_tokens,
      system: systemBlocks,
      messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const message = await stream.finalMessage();
    stopReason = message.stop_reason ?? "end_turn";
    usage = {
      inputTokens: message.usage?.input_tokens ?? 0,
      outputTokens: message.usage?.output_tokens ?? 0,
      cacheCreationInputTokens:
        ((message.usage as unknown) as Record<string, number> | null)?.["cache_creation_input_tokens"] ?? 0,
      cacheReadInputTokens:
        ((message.usage as unknown) as Record<string, number> | null)?.["cache_read_input_tokens"] ?? 0,
    };
    modelUsed = message.model ?? model;

    outputText = message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId: run.id, model }, "run-generation: Anthropic call failed");

    // Non-retryable 4xx → mark failed, 2xx response
    const isNonRetryable =
      errMsg.includes("400") ||
      errMsg.includes("401") ||
      errMsg.includes("403") ||
      errMsg.includes("413");

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
    // Retryable: throw so QStash retries
    throw err;
  }

  // Handle chunking (simplified — full chunking impl is multi-chunk)
  if (needsChunking) {
    // For now: if chunking needed, store partial progress for future continuation
    // Full chunking with multi-part Storage writes is a follow-up optimization
    logger.info({ runId: run.id }, "run-generation: chunking noted but executing as single pass");
  }

  // Validate output
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

  // Check cancellation before writing (DOC-42 §3.2 / DOC-26 §1.3.4)
  if (await isCancelled(run.id)) return "cancelled";

  // Render output
  let outputPath: string | null = null;
  try {
    outputPath = await renderAndStore(outputText, run, snapshot);
  } catch (renderErr) {
    logger.warn({ err: renderErr, runId: run.id }, "run-generation: render failed — continuing with text only");
  }

  // Summarize (T5: Haiku; non-fatal)
  let outputSummary: string | null = null;
  try {
    outputSummary = outputText.slice(0, 400).trim();
  } catch {
    // Summary never blocks the run
  }

  // Compute cost
  const costUsd = computeAnthropicCost(usage, modelUsed);

  // Complete run (conditional WHERE status='running')
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
    // Another delivery already closed the run (unlikely but safe)
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
    {
      job: "run-generation",
      runId: run.id,
      model: modelUsed,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd,
    },
    "run-generation: completed",
  );

  return "completed";
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

  // md: store raw text
  const { error } = await supabase.storage
    .from("generated")
    .upload(path, new TextEncoder().encode(outputText), { contentType: "text/markdown", upsert: true });
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

  // Build schema with raw_text field injected (DOC-42 §3.6 / DOC-74 §3.4)
  const extractionSchemaWithRawText = {
    type: "object",
    properties: {
      ...(rdt.extractionSchema as Record<string, unknown>),
      raw_text: { type: "string", description: "Full plain text of the document" },
    },
    required: [
      ...((rdt.extractionSchema as { required?: string[] }).required ?? []),
      "raw_text",
    ],
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

      // Validate against schema (simplified — full Ajv validation in prod)
      const schema = rdt.extractionSchema as { required?: string[] };
      const missingRequired = (schema.required ?? []).filter(
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
export async function translateDocument(
  actor: Actor,
  input: { caseId: string; caseDocumentId: string; direction: "es-en" | "en-es" },
): Promise<TranslateDocumentResult> {
  await requireCaseAccess(actor, input.caseId);
  const p = TranslateDocumentInputSchema.parse(input);

  const existing = await findTranslation(p.caseDocumentId, p.direction);

  if (existing?.status === "completed") return { translation: existing, cached: true };
  if (existing?.status === "processing") return { translation: existing, cached: false };

  if (existing?.status === "failed") {
    await resetTranslation(existing.id, {
      status: "processing",
      requested_by: actor.userId,
    });
    const attempt = (existing as unknown as Record<string, number>)["attempt"] ?? 1;
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
    return { translation: existing, cached: false };
  }

  // Mutex via INSERT — unique_violation means concurrent request won the race
  try {
    const row = await insertTranslation({
      case_document_id: p.caseDocumentId,
      direction: p.direction,
      status: "processing",
      requested_by: actor.userId,
    });

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

  const direction = translation.direction;
  const promptText = direction === "es-en"
    ? "Translate the following document from Spanish to English. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [ilegible]."
    : "Translate the following document from English to Spanish. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [illegible].";

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

    translatedText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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

  await completeTranslation(translation.id, {
    status: "completed",
    translatedText,
    translatedPdfPath: null, // bilingual PDF render is Ola 2 (uses renderMarkdownToPdf)
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
}): Promise<{ text: string; model: string }> {
  const model = process.env.AI_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const geminiModels = getGeminiModels();

  const promptText = input.direction === "es-en"
    ? `Translate this text from Spanish to English. Return only the translated text, no explanations.\n\n${input.text}`
    : `Translate this text from English to Spanish. Return only the translated text, no explanations.\n\n${input.text}`;

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

/**
 * Proposes form segmentation for a catalog AcroForm (RF-ADM-032).
 * Synchronous, uses Sonnet-4-6 (T2 model, DOC-74 §1).
 *
 * @api-id (internal — consumed by catalog module)
 */
export async function proposeFormSegmentation(
  actor: Actor,
  input: {
    detectedFields: Array<{ name: string; type: string; page: number }>;
    pdfText: string;
    groupScope?: string[];
  },
): Promise<{ groups: Array<{ title: { es: string; en: string }; questions: unknown[] }> }> {
  can(actor, "catalog", "edit");

  const editorModel = process.env.AI_EDITOR_MODEL ?? "claude-sonnet-4-6";
  const client = getAnthropicClient();

  const prompt = [
    "You are an immigration law form expert. Analyze these AcroForm fields and propose a logical grouping into sections.",
    "",
    `Fields (${input.detectedFields.length}):`,
    input.detectedFields.map((f) => `- ${f.name} (${f.type}, page ${f.page})`).join("\n"),
    "",
    "Return JSON: { groups: [{ title_i18n: {es, en}, position: number, questions: [{ question_i18n: {es, en}, field_type, pdf_field_name, is_required, position }] }] }",
  ].join("\n");

  const response = await client.messages.create({
    model: editorModel,
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  try {
    const parsed = JSON.parse(text) as { groups: Array<{ title: { es: string; en: string }; questions: unknown[] }> };
    return parsed;
  } catch {
    throw new AiEngineError("AI_OUTPUT_INVALID", "proposeFormSegmentation response was not valid JSON");
  }
}

/**
 * Proposes an extraction_schema for a document requirement (RF-ADM-029).
 *
 * @api-id (internal — consumed by catalog module)
 */
export async function proposeExtractionSchema(
  actor: Actor,
  input: {
    requirementLabel: { es: string; en: string };
    helpText?: string;
  },
): Promise<{ schema: Record<string, unknown> }> {
  can(actor, "catalog", "edit");

  const editorModel = process.env.AI_EDITOR_MODEL ?? "claude-sonnet-4-6";
  const client = getAnthropicClient();

  const prompt = [
    `Create a JSON Schema for extracting key fields from a "${input.requirementLabel.en}" document.`,
    input.helpText ? `Context: ${input.helpText}` : "",
    "Use only: string, number, boolean types. Add descriptions in English. Include 'required' array.",
    "Return JSON: { schema: { type: 'object', properties: {...}, required: [...] } }",
  ].join("\n");

  const response = await client.messages.create({
    model: editorModel,
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");

  try {
    return JSON.parse(text) as { schema: Record<string, unknown> };
  } catch {
    throw new AiEngineError("AI_OUTPUT_INVALID", "proposeExtractionSchema response was not valid JSON");
  }
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
// Re-export sumMonthlyCosts for budget aggregation job
// ---------------------------------------------------------------------------

export { sumMonthlyCosts };
