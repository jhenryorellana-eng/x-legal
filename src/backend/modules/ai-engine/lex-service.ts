/**
 * ai-engine module — Lex case chat: service layer (use cases).
 *
 * Lex is the staff-only AI chat inside the case workspace "Lex" tab. Its
 * knowledge is ONLY the case: RAG over case_knowledge_chunks (reindexed from
 * document extractions + form responses + a factual case profile) plus a
 * service-scoped web search. One private thread per (case, staff member).
 *
 * Flows:
 *   - getLexThread / sendLexMessage / getLexMessageStatus — staff UI (actor-gated).
 *   - reindexCaseKnowledge — incremental, content-hash gated (idempotent).
 *   - executeLexReindexJob — QStash job; self re-enqueues while extractions pend.
 *   - executeLexAnswerJob — QStash job; retrieval → Anthropic (+web_search) →
 *     terminal write on the assistant placeholder. SINGLE-SPEND: a completed
 *     message is a hard no-op.
 *
 * Authorization: requireCaseAccess ALWAYS first; Lex is staff-only (clients get
 * AuthzError wrong_kind) and threads are private to their owner.
 *
 * @module ai-engine/lex-service
 */

import { requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { enqueueJob } from "@/backend/platform/qstash";
import { getAnthropicClient } from "@/backend/platform/anthropic";
import { embedText, toVectorLiteral } from "@/backend/platform/embeddings";
import { isAiStubEnabled } from "@/backend/platform/ai-stub";
import { logger } from "@/backend/platform/logger";
import type { Json } from "@/shared/database.types";

import {
  maskPii,
  buildWebSearchTool,
  computeAnthropicCost,
  type AnthropicUsage,
} from "./domain";
import {
  buildAnswersDocument,
  buildCaseProfile,
  buildLexSystemPrompt,
  chunkText,
  sha256,
  mapRowToMessageVM,
  DEFAULT_LEX_MODEL,
  type LexSource,
  type LexSourceKind,
  type LexThreadVM,
  type LexMessageVM,
} from "./lex-domain";
import * as repo from "./lex-repository";
import { enqueueLexReindex } from "./events";
import type { JobOutcome } from "./service";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class LexError extends Error {
  constructor(
    public readonly code: "LEX_MESSAGE_INVALID" | "LEX_BUSY" | "LEX_NOT_FOUND",
    public readonly details?: unknown,
  ) {
    super(code);
    this.name = "LexError";
  }
}

// ---------------------------------------------------------------------------
// Job payload types (contract with src/backend/jobs/lex-*.ts)
// ---------------------------------------------------------------------------

export interface LexAnswerJobPayload {
  jobKey: "lex-answer";
  /** assistant message id (entityId mirrors messageId). */
  entityId: string;
  attempt: number;
  dedupeId: string;
  orgId: string;
  messageId: string;
  threadId: string;
  caseId: string;
}

export interface LexReindexJobPayload {
  jobKey: "lex-reindex-case";
  /** caseId (entityId mirrors caseId). */
  entityId: string;
  attempt: number;
  dedupeId: string;
  /**
   * Optional on purpose: event-driven enqueues omit it so the webhook's
   * permanent (source, dedupeId) idempotency barrier does not swallow FUTURE
   * re-uploads of the same case (the reindex is internally idempotent — the
   * content-hash diff is the real dedupe).
   */
  orgId?: string;
  caseId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LEX_MESSAGE_MAX_CHARS = 2000;
const LEX_HISTORY_MESSAGES = 10;
const LEX_MATCH_COUNT = 12;
const LEX_ANSWER_MAX_TOKENS = 2048;
/** Per-call hard timeout — bounded well under the 280s QStash endpoint timeout. */
const LEX_ANSWER_TIMEOUT_MS = 180_000;
const LEX_WEB_SEARCH_MAX_USES = 3;
/** Reindex self re-enqueue while extractions are pending (never an error). */
const LEX_REINDEX_MAX_ATTEMPTS = 6;
const LEX_REINDEX_RETRY_DELAY_S = 30;

// ---------------------------------------------------------------------------
// getLexThread — staff read of their own (case, employee) thread
// ---------------------------------------------------------------------------

export async function getLexThread(actor: Actor, caseId: string): Promise<LexThreadVM> {
  await requireCaseAccess(actor, caseId);
  // Staff-only work product — the client never sees Lex threads.
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  // Day-zero bootstrap: cases that predate Lex (or whose events were lost)
  // have no chunks, and no future event may ever fire for them. Opening the
  // tab is the earliest signal — enqueue the first index build here so it is
  // usually ready before the first question. Fire-and-forget: neither a failed
  // count (null = unknown) nor a failed enqueue may break reading the thread,
  // and re-enqueueing is inert (QStash publish-dedup + content-hash diff).
  if ((await repo.countCaseChunks(caseId)) === 0) {
    await enqueueLexReindex(caseId);
  }

  const thread = await repo.findThread(caseId, actor.userId);
  if (!thread) return { threadId: null, messages: [] }; // lazy: no thread until first send
  const rows = await repo.listMessages(thread.id);
  return { threadId: thread.id, messages: rows.map(mapRowToMessageVM) };
}

// ---------------------------------------------------------------------------
// sendLexMessage — validates, persists user+placeholder, enqueues lex-answer
// ---------------------------------------------------------------------------

export async function sendLexMessage(
  actor: Actor,
  caseId: string,
  content: string,
): Promise<{ threadId: string; messageId: string }> {
  const trimmed = (content ?? "").trim();
  if (trimmed.length < 1 || trimmed.length > LEX_MESSAGE_MAX_CHARS) {
    throw new LexError("LEX_MESSAGE_INVALID");
  }
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const orgId = await repo.findCaseOrgId(caseId);
  if (!orgId) throw new AuthzError("forbidden_case");

  const thread = await repo.getOrCreateThread(caseId, actor.userId);
  const running = await repo.findRunningMessage(thread.id);
  if (running) throw new LexError("LEX_BUSY");

  await repo.insertMessage({
    thread_id: thread.id,
    role: "user",
    content: trimmed,
    status: "completed",
  });
  const assistant = await repo.insertMessage({
    thread_id: thread.id,
    role: "assistant",
    content: "",
    status: "running",
  });

  try {
    await enqueueJob(
      {
        jobKey: "lex-answer",
        entityId: assistant.id,
        attempt: 1,
        dedupeId: `lex-answer:${assistant.id}`,
        orgId,
        messageId: assistant.id,
        threadId: thread.id,
        caseId,
      },
      // timeout under the webhook maxDuration so QStash never fires a
      // concurrent retry mid-call (same discipline as run-premortem).
      { retries: 2, timeout: "280s" },
    );
  } catch (err) {
    // Never leave a stuck 'running' placeholder (it would lock the thread LEX_BUSY).
    await repo
      .updateAssistantMessage(assistant.id, { status: "failed", error: "enqueue_failed" })
      .catch(() => undefined);
    throw err;
  }

  return { threadId: thread.id, messageId: assistant.id };
}

// ---------------------------------------------------------------------------
// getLexMessageStatus — polling endpoint for the UI (owner-only)
// ---------------------------------------------------------------------------

export async function getLexMessageStatus(
  actor: Actor,
  messageId: string,
): Promise<LexMessageVM | null> {
  const msg = await repo.getMessageById(messageId);
  if (!msg) return null;
  const thread = await repo.getThreadById(msg.thread_id);
  if (!thread) return null;

  await requireCaseAccess(actor, thread.case_id);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");
  // Threads are private per employee: no cross-staff reads, even with cases access.
  if (thread.staff_user_id !== actor.userId) throw new AuthzError("forbidden_case");

  return mapRowToMessageVM(msg);
}

// ---------------------------------------------------------------------------
// reindexCaseKnowledge — incremental, content-hash gated (idempotent)
// ---------------------------------------------------------------------------

export interface LexReindexResult {
  /** Chunks (re-)embedded + upserted. */
  indexed: number;
  /** Chunks whose content_hash matched (no re-embed). */
  skipped: number;
  /** Orphan/stale chunks removed. */
  removed: number;
}

interface LexTargetSource {
  kind: LexSourceKind;
  sourceId: string;
  label: string;
  text: string;
}

/**
 * Builds the target source set: factual case profile + indexable documents
 * (raw_text of completed extractions) + indexable form responses (Q/A document).
 */
async function buildTargetSources(caseId: string): Promise<LexTargetSource[]> {
  const [profile, docs, forms] = await Promise.all([
    repo.getCaseForProfile(caseId),
    repo.listIndexableDocuments(caseId),
    repo.listIndexableFormResponses(caseId),
  ]);

  const sources: LexTargetSource[] = [];
  if (profile) {
    sources.push({
      kind: "case_profile",
      sourceId: caseId,
      label: `Perfil del caso ${profile.caseNumber}`,
      text: buildCaseProfile({
        caseNumber: profile.caseNumber,
        serviceName: profile.serviceName,
        planName: profile.planName,
        currentPhase: profile.currentPhase,
        status: profile.status,
        currentStage: profile.currentStage,
        parties: profile.parties,
      }),
    });
  }
  for (const d of docs) {
    sources.push({ kind: "document_extraction", sourceId: d.documentId, label: d.label, text: d.rawText });
  }
  for (const f of forms) {
    const text = buildAnswersDocument(f.answers, f.questionLabels);
    if (text) sources.push({ kind: "form_response", sourceId: f.responseId, label: f.formLabel, text });
  }
  return sources.filter((s) => s.text.trim());
}

/**
 * Diffs the target source set against the stored chunks and only embeds what
 * changed (content_hash per (source_kind, source_id, chunk_index)). Orphans
 * (deleted/replaced/rejected documents, responses back to draft) and stale
 * tails of shrunk sources are swept at the end. Safe to re-run any time.
 */
export async function reindexCaseKnowledge(caseId: string): Promise<LexReindexResult> {
  const targets = await buildTargetSources(caseId);
  const existing = await repo.listExistingChunks(caseId);
  const hashByKey = new Map(
    existing.map((c) => [`${c.source_kind}:${c.source_id}:${c.chunk_index}`, c.content_hash] as const),
  );

  let indexed = 0;
  let skipped = 0;
  let removed = 0;

  for (const source of targets) {
    const chunks = chunkText(source.text);
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const hash = sha256(content);
      if (hashByKey.get(`${source.kind}:${source.sourceId}:${i}`) === hash) {
        skipped++;
        continue;
      }
      const vec = await embedText(content);
      await repo.upsertChunk({
        case_id: caseId,
        source_kind: source.kind,
        source_id: source.sourceId,
        source_label: source.label,
        chunk_index: i,
        content,
        content_hash: hash,
        embedding: toVectorLiteral(vec),
      });
      indexed++;
    }
    // Same source, fewer chunks than stored → prune the stale tail.
    removed += await repo.deleteSourceChunksFrom(caseId, source.kind, source.sourceId, chunks.length);
  }

  removed += await repo.deleteChunksNotIn(
    caseId,
    targets.map((t) => ({ source_kind: t.kind, source_id: t.sourceId })),
  );

  return { indexed, skipped, removed };
}

// ---------------------------------------------------------------------------
// executeLexReindexJob — QStash job entrypoint
// ---------------------------------------------------------------------------

/**
 * Runs the reindex, then — while ai_extract documents still lack a completed
 * extraction — re-enqueues itself with a short delay (extraction output is the
 * main index input). Pending extractions are NOT an error: the job always
 * succeeds; the delay chain simply stops after LEX_REINDEX_MAX_ATTEMPTS.
 */
export async function executeLexReindexJob(payload: LexReindexJobPayload): Promise<JobOutcome> {
  const result = await reindexCaseKnowledge(payload.caseId);
  logger.info(
    { job: "lex-reindex-case", caseId: payload.caseId, attempt: payload.attempt, ...result },
    "ai-engine: lex reindex done",
  );

  if (await repo.hasPendingExtractions(payload.caseId)) {
    const attempt = payload.attempt ?? 1;
    if (attempt < LEX_REINDEX_MAX_ATTEMPTS) {
      await enqueueJob(
        {
          jobKey: "lex-reindex-case",
          entityId: payload.caseId,
          attempt: attempt + 1,
          // Per-attempt dedupeId: each delayed hop is a distinct delivery.
          dedupeId: `lex-reindex:${payload.caseId}:${attempt + 1}`,
          ...(payload.orgId ? { orgId: payload.orgId } : {}),
          caseId: payload.caseId,
        },
        { retries: 2, delay: LEX_REINDEX_RETRY_DELAY_S, timeout: "280s" },
      );
      return "deferred";
    }
    logger.info(
      { caseId: payload.caseId },
      "ai-engine: lex reindex — extractions still pending after max attempts; index left without them",
    );
  }
  return "completed";
}

// ---------------------------------------------------------------------------
// executeLexAnswerJob — QStash job entrypoint
// ---------------------------------------------------------------------------

/** Marks the assistant message failed; never throws (best-effort terminal write). */
async function markLexFailed(messageId: string, errorMsg: string): Promise<void> {
  try {
    await repo.updateAssistantMessage(messageId, {
      status: "failed",
      error: errorMsg.slice(0, 500),
    });
  } catch (err) {
    logger.error({ err, messageId }, "ai-engine: lex markLexFailed failed");
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Deduped chunk citations (by label) for the assistant message sources. */
function chunkSources(labels: string[]): LexSource[] {
  const seen = new Set<string>();
  const out: LexSource[] = [];
  for (const label of labels) {
    const clean = label.trim() || "Caso";
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push({ kind: "chunk", label: clean });
  }
  return out;
}

/**
 * Extracts web citations from the response content blocks
 * (web_search_tool_result → web_search_result entries), deduped by URI.
 * Tolerant of error-shaped results (they carry no url).
 */
function extractWebSources(blocks: unknown[]): LexSource[] {
  const byUri = new Map<string, LexSource>();
  for (const b of blocks) {
    const block = b as { type?: string; content?: unknown };
    if (block?.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
    for (const item of block.content) {
      const it = item as { type?: string; url?: unknown; title?: unknown };
      if (it?.type === "web_search_result" && typeof it.url === "string" && it.url) {
        if (!byUri.has(it.url)) {
          byUri.set(it.url, {
            kind: "web",
            uri: it.url,
            title: typeof it.title === "string" ? it.title : null,
          });
        }
      }
    }
  }
  return [...byUri.values()];
}

/**
 * Answers one Lex question: retrieval (Gemini embed + case-scoped RPC) →
 * Anthropic with the web_search server tool → terminal write on the assistant
 * placeholder.
 *
 * Cost discipline (same single-spend pattern as executePreMortemJob):
 *   - status 'completed' at entry → hard no-op (at-least-once delivery must
 *     never re-run a paid call).
 *   - Deterministic failures (no question, case gone, empty model output) →
 *     failed, NO rethrow (QStash must not retry).
 *   - Provider/infra failures (429/5xx/network) → failed + RETHROW so QStash
 *     retries; the retry re-enters (only 'completed' skips) and re-runs.
 */
export async function executeLexAnswerJob(payload: LexAnswerJobPayload): Promise<JobOutcome> {
  const msg = await repo.getMessageById(payload.messageId);
  if (!msg) {
    logger.warn({ messageId: payload.messageId }, "ai-engine: lex-answer message not found — skipping");
    return "skipped";
  }
  // SINGLE-SPEND: completed is terminal.
  if (msg.status === "completed") return "skipped";

  const thread = await repo.getThreadById(msg.thread_id);
  if (!thread) {
    logger.warn({ messageId: msg.id }, "ai-engine: lex-answer thread not found — skipping");
    return "skipped";
  }
  const caseId = thread.case_id;

  // The question is the user message immediately before the assistant placeholder.
  const history = await repo.listMessages(thread.id);
  const placeholderIdx = history.findIndex((m) => m.id === msg.id);
  const prior = placeholderIdx > 0 ? history.slice(0, placeholderIdx) : history.filter((m) => m.id !== msg.id);
  const userMsg = [...prior].reverse().find((m) => m.role === "user");
  const question = userMsg?.content?.trim() ?? "";
  if (!userMsg || !question) {
    await markLexFailed(msg.id, "no_user_question");
    return "failed"; // deterministic — retrying cannot heal
  }

  const caseInfo = await repo.getCaseForProfile(caseId);
  if (!caseInfo) {
    await markLexFailed(msg.id, "case_not_found");
    return "failed"; // deterministic
  }

  // Retrieval — case-scoped by the RPC signature. The RPC itself degrades to
  // [] on error (Lex answers "sin contexto" instead of failing the chat).
  let chunks: repo.LexMatchedChunk[] = [];
  try {
    const vec = await embedText(question);
    chunks = await repo.matchCaseKnowledge(caseId, toVectorLiteral(vec), LEX_MATCH_COUNT);
  } catch (err) {
    // Embedding infra failure (429/5xx/network) is retryable.
    await markLexFailed(msg.id, errMessage(err));
    throw err;
  }

  const profileLabel = `Perfil del caso ${caseInfo.caseNumber}`;
  const sourceLabels = [profileLabel, ...chunks.map((c) => c.sourceLabel)];

  // E2E stub (DOC-81): deterministic answer, no Anthropic call, zero cost.
  // Retrieval above still runs — embedText is stub-deterministic.
  if (isAiStubEnabled()) {
    await repo.updateAssistantMessage(msg.id, {
      status: "completed",
      content:
        `Respuesta de prueba de Lex (stub E2E) para la pregunta: "${question}". ` +
        `Fuentes del caso consultadas: ${chunks.length}.`,
      sources: chunkSources(sourceLabels) as unknown as Json,
      model: "e2e-stub",
      input_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
      error: null,
    });
    return "completed";
  }

  const locale = await repo.getUserLocale(thread.staff_user_id);
  const model =
    (await repo.getOrgLexModel(caseInfo.orgId)) ?? process.env.AI_LEX_MODEL ?? DEFAULT_LEX_MODEL;

  // --- Prompt assembly (context PII-masked BEFORE injection — DOC-74 §7.1) ---
  const systemPrompt = buildLexSystemPrompt({
    serviceName: caseInfo.serviceName || "el servicio del caso",
    locale,
  });

  const profileText = buildCaseProfile({
    caseNumber: caseInfo.caseNumber,
    serviceName: caseInfo.serviceName,
    planName: caseInfo.planName,
    currentPhase: caseInfo.currentPhase,
    status: caseInfo.status,
    currentStage: caseInfo.currentStage,
    parties: caseInfo.parties,
  });

  // Numbered, citable fragments — the profile goes in full; profile chunks are
  // excluded from the numbered list to avoid injecting it twice.
  const contextParts: string[] = ["## PERFIL DEL CASO", maskPii(profileText)];
  const docChunks = chunks.filter((c) => c.sourceKind !== "case_profile");
  if (docChunks.length > 0) {
    contextParts.push("", "## FRAGMENTOS DEL CASO (fuentes citables)");
    docChunks.forEach((c, i) => {
      contextParts.push("", `[${i + 1}] (${c.sourceLabel || "Caso"})`, maskPii(c.content));
    });
  }

  const apiMessages: Array<{ role: "user" | "assistant"; content: string }> = prior
    .filter((m) => m.id !== userMsg.id && m.content.trim())
    .slice(-LEX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role === "assistant" ? ("assistant" as const) : ("user" as const), content: m.content }));
  apiMessages.push({
    role: "user",
    content: [...contextParts, "", "---", "", "PREGUNTA DEL STAFF:", question].join("\n"),
  });

  // --- Anthropic call (streaming not needed at 2048 tokens; hard wall-clock
  // bound via AbortController — same reasoning as callAnthropic in service.ts) ---
  let response;
  try {
    const client = getAnthropicClient();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LEX_ANSWER_TIMEOUT_MS);
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: LEX_ANSWER_MAX_TOKENS,
          // Ephemeral cache on the system prompt (DOC-74 §2.3 prompt caching).
          system: [{ type: "text" as const, text: systemPrompt, cache_control: { type: "ephemeral" as const } }],
          tools: [buildWebSearchTool(LEX_WEB_SEARCH_MAX_USES, model)],
          messages: apiMessages,
        },
        { timeout: LEX_ANSWER_TIMEOUT_MS, maxRetries: 1, signal: ctrl.signal },
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msgText = errMessage(err);
    logger.error({ err: msgText, caseId, messageId: msg.id, model }, "ai-engine: lex-answer Anthropic call failed");
    await markLexFailed(msg.id, msgText);
    // Non-retryable 4xx (bad request/auth/payload) → definitive failure.
    // Everything else (429/5xx/network/abort) → rethrow for the QStash retry.
    const nonRetryable = ["400", "401", "403", "413"].some((c) => msgText.includes(c));
    if (nonRetryable) return "failed";
    throw err;
  }

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("")
    .trim();
  if (!text) {
    await markLexFailed(msg.id, "empty_model_output");
    return "failed"; // deterministic — no content to persist
  }

  const usage: AnthropicUsage = {
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    cacheCreationInputTokens:
      ((response.usage as unknown) as Record<string, number> | null)?.["cache_creation_input_tokens"] ?? 0,
    cacheReadInputTokens:
      ((response.usage as unknown) as Record<string, number> | null)?.["cache_read_input_tokens"] ?? 0,
  };
  const modelUsed = response.model ?? model;
  const costUsd = computeAnthropicCost(usage, modelUsed);

  const sources: LexSource[] = [
    ...chunkSources(sourceLabels),
    ...extractWebSources(response.content as unknown[]),
  ];

  await repo.updateAssistantMessage(msg.id, {
    status: "completed",
    content: text,
    sources: sources as unknown as Json,
    model: modelUsed,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: costUsd,
    error: null,
  });

  logger.info(
    { job: "executeLexAnswerJob", messageId: msg.id, caseId, model: modelUsed, costUsd, chunkCount: chunks.length },
    "ai-engine: lex-answer completed",
  );
  return "completed";
}
