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
  maskPii,
  buildWebSearchTool,
  countWords,
  lastWords,
  buildSectionUserMessage,
  buildExpansionUserMessage,
  assembleDocument,
  curateInternalFields,
  sumUsage as _sumUsage,
  type GenerationRequest,
  type ConfigSnapshot,
  type GenerationSectionSpec,
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
  findGenerationConfig,
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

  // Call Anthropic (streaming transport, DOC-74 §2.5). Optional native web_search
  // tool (live research) + optional sectioned long-form generation (generalizes v1).
  const model = snapshot.model ?? DEFAULT_GENERATION_MODEL;
  const sections = snapshot.sections ?? [];
  const tools = snapshot.web_search_enabled
    ? [buildWebSearchTool(snapshot.web_search_max_uses ?? 5)]
    : undefined;
  const needsChunking = decideChunking(snapshot.max_output_tokens, 10000);

  let outputText: string;
  let stopReason = "end_turn";
  let usage: AnthropicUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  let modelUsed = model;

  try {
    const client = getAnthropicClient();

    // Build system blocks for Anthropic API with cache_control (stable prefix).
    const systemBlocks = prompt.system.map((block) => ({
      type: "text" as const,
      text: block.text,
      ...(block.cacheControl ? { cache_control: { type: "ephemeral" as const } } : {}),
    }));

    // One Anthropic call → normalized result. Streaming required for large outputs.
    const streamOnce = async (userContent: string, maxTokens: number) => {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages: [{ role: "user" as const, content: userContent }],
        ...(tools ? { tools } : {}),
      });
      const message = await stream.finalMessage();
      const u: AnthropicUsage = {
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
      return { text, stopReason: message.stop_reason ?? "end_turn", usage: u, model: message.model ?? model };
    };

    const addU = (a: AnthropicUsage, b: AnthropicUsage): AnthropicUsage => ({
      inputTokens: a.inputTokens + b.inputTokens,
      outputTokens: a.outputTokens + b.outputTokens,
      cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
      cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    });

    const baseUserContent = prompt.messages[0]?.content ?? "";

    if (sections.length > 0) {
      // Sectioned long-form: generate each section in order, enforce the word
      // floor (one expansion pass below floor), accumulate, then assemble.
      const parts: string[] = [];
      let prevTail = "";
      for (const sec of sections) {
        if (await isCancelled(run.id)) return "cancelled";
        const secContent = buildSectionUserMessage(baseUserContent, sec, prevTail, snapshot.research_instructions);
        let res = await streamOnce(secContent, sec.max_tokens);
        usage = addU(usage, res.usage);
        if (sec.min_words > 0 && countWords(res.text) < sec.min_words) {
          const exp = await streamOnce(buildExpansionUserMessage(secContent, res.text, sec.min_words), sec.max_tokens);
          usage = addU(usage, exp.usage);
          if (countWords(exp.text) > countWords(res.text)) res = exp;
        }
        parts.push(`## ${sec.heading}\n\n${res.text.trim()}`);
        prevTail = lastWords(res.text, 1200);
        modelUsed = res.model;
      }
      outputText = assembleDocument(sections, parts, snapshot.assembly ?? null);
    } else {
      const res = await streamOnce(baseUserContent, snapshot.max_output_tokens);
      outputText = res.text;
      stopReason = res.stopReason;
      usage = res.usage;
      modelUsed = res.model;
    }
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
}): Promise<{ text: string }> {
  const { text } = await translateText({ text: maskPii(input.text), direction: input.direction });
  return { text };
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
