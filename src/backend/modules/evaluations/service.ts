/**
 * Evaluations module — service layer (use cases).
 *
 * Owns the lifecycle of `case_evaluations` (+ `case_evaluation_runs`):
 *   - getOrCreateClientEvaluation: lazy session for the client screen (iframe)
 *   - getSessionForJuez / consumeAttempt: server-to-server API for Juez
 *   - processJuezWebhook: HMAC verification + completed/failed dispatch
 *   - grantExtraAttempt: admin-only +1 attempt
 *   - reconcileStaleEvaluations: polling fallback (QStash job)
 *
 * Security notes (mold: integrations/service.ts — DOC-70 pattern):
 *   - NEVER log secrets, tokens, or PII (correlate with jobId only).
 *   - HMAC verified with crypto.timingSafeEqual (constant-time).
 *   - org_id resolved from DB by token (never from payload).
 *   - PDF fetch: https + host-suffix whitelist + safeFetch (SSRF re-check per
 *     hop) + size cap + %PDF- magic bytes, ALL before responding 200 — Juez
 *     deletes its copy after our 200.
 *
 * @module evaluations/service
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { providerEnv } from "@/backend/platform/env";
import { safeFetch } from "@/backend/platform/safe-fetch";
import { assertPublicUrl } from "@/backend/platform/ssrf";
import {
  uploadBytesToStorage,
  createSignedDownloadUrl,
  validateMagicBytes,
} from "@/backend/platform/storage";
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
} from "@/backend/platform/webhook-events";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";
import { getExternalTool, type ExternalToolConfig } from "@/backend/modules/catalog";
import {
  EVALUATION_PDF_MAX_BYTES,
  JUEZ_EMBED_PATH,
  JUEZ_STATUS_PATH,
  JUEZ_API_KEY_HEADER,
  JUEZ_TOOL_KEY,
  JUEZ_WEBHOOK_SOURCE,
  type EvaluationStatus,
} from "@/shared/constants/evaluations";
import {
  EvaluationsError,
  JuezWebhookSchema,
  isAllowedPdfHost,
  canConsumeAttempt,
  type ClientEvaluationVM,
  type ClientEvaluationSummary,
  type ConsumeResult,
  type EvaluationReportMeta,
  type JuezSessionDto,
  type JuezWebhook,
  type StaffEvaluationVM,
} from "./domain";
import {
  casAttemptsUsed,
  setAttemptsUsed,
  findEvaluationById,
  findCaseBasic,
  findClientInfoForCase,
  findEvaluationByCase,
  findEvaluationByToken,
  findRunByJobId,
  insertEvaluation,
  insertRun,
  listRunsForEvaluation,
  listStaleInProgress,
  transitionRun,
  updateEvaluation,
  type EvaluationRow,
  type EvaluationWithCase,
} from "./repository";
import { emitEvaluationCompleted, emitEvaluationFailed } from "./events";

const GENERATED_BUCKET = "generated";

/** Case statuses where the client may NOT use the tool (gate of getOrCreate). */
const BLOCKED_CASE_STATUSES = new Set(["draft", "payment_pending", "cancelled"]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function reportMetaOf(row: EvaluationRow): EvaluationReportMeta {
  return (row.report_meta ?? {}) as EvaluationReportMeta;
}

/**
 * Converges attempts_used onto the run-derived truth: one attempt per run in
 * status consumed|completed (failed runs were refunded by definition).
 *
 * This is the crash-safe half of the refund/count logic: run-state transitions
 * are CAS-guarded (exactly-once), and the webhook_events barrier re-runs the
 * whole handler on a mid-flight crash (`claim === "retry"`) — re-running this
 * sync lands on the same value, so a refund/count can never be lost NOR
 * double-applied (reviewer STRONG-2).
 */
async function syncAttemptsUsedWithRuns(evaluationId: string): Promise<number> {
  const runs = await listRunsForEvaluation(evaluationId);
  const target = runs.filter((r) => r.status === "consumed" || r.status === "completed").length;

  for (let i = 0; i < 3; i++) {
    const row = await findEvaluationById(evaluationId);
    if (!row) return target;
    if (row.attempts_used === target) return target;
    if (await setAttemptsUsed(evaluationId, row.attempts_used, target)) return target;
  }
  logger.warn({ evaluationId, target }, "evaluations: syncAttemptsUsedWithRuns gave up under contention");
  return target;
}

function buildIframeUrl(config: ExternalToolConfig, accessToken: string): string {
  return `${config.baseUrl}${JUEZ_EMBED_PATH}?t=${accessToken}`;
}

async function requireToolConfig(serviceId: string): Promise<ExternalToolConfig> {
  const config = await getExternalTool(serviceId);
  if (!config || !config.isEnabled) throw new EvaluationsError("TOOL_NOT_ENABLED");
  return config;
}

function toClientVM(row: EvaluationRow, config: ExternalToolConfig): ClientEvaluationVM {
  return {
    status: row.status as EvaluationStatus,
    attemptsAllowed: row.attempts_allowed,
    attemptsUsed: row.attempts_used,
    iframeUrl: buildIframeUrl(config, row.access_token),
    instructions: config.instructionsI18n,
    pdfAvailable: row.pdf_storage_path !== null,
    reportMeta: reportMetaOf(row),
    deliveredAt: row.delivered_at,
  };
}

// ---------------------------------------------------------------------------
// Client reads (case workspace)
// ---------------------------------------------------------------------------

/**
 * Lazy getOrCreate of the evaluation session for the client screen.
 *
 * Gates: case access (member/staff) → case not draft/payment_pending/cancelled
 * → service has an ENABLED external tool. The UNIQUE (case_id, tool_key)
 * resolves the double-create race (23505 → re-read).
 */
export async function getOrCreateClientEvaluation(
  actor: Actor,
  caseId: string,
): Promise<ClientEvaluationVM> {
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseBasic(caseId);
  if (!caseRow) throw new EvaluationsError("CASE_NOT_FOUND");
  if (BLOCKED_CASE_STATUSES.has(caseRow.status)) {
    throw new EvaluationsError("CASE_NOT_ACTIVE", { status: caseRow.status });
  }

  const config = await requireToolConfig(caseRow.service_id);

  const existing = await findEvaluationByCase(caseId, config.toolKey);
  if (existing) return toClientVM(existing, config);

  const { row, conflict } = await insertEvaluation({
    org_id: caseRow.org_id,
    case_id: caseId,
    tool_key: config.toolKey,
    attempts_allowed: config.defaultAttempts,
  });
  if (row) return toClientVM(row, config);
  if (conflict) {
    const raced = await findEvaluationByCase(caseId, config.toolKey);
    if (raced) return toClientVM(raced, config);
  }
  throw new EvaluationsError("EVALUATION_NOT_FOUND");
}

/**
 * Cheap read for the camino CTA. Never creates the row.
 * null = the case's service has no enabled external tool (no CTA).
 */
export async function getClientEvaluationSummary(
  actor: Actor,
  caseId: string,
): Promise<ClientEvaluationSummary | null> {
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseBasic(caseId);
  if (!caseRow) return null;
  const config = await getExternalTool(caseRow.service_id);
  if (!config || !config.isEnabled) return null;

  const row = await findEvaluationByCase(caseId, config.toolKey);
  return {
    configured: true,
    status: (row?.status as EvaluationStatus | undefined) ?? "not_started",
    pdfAvailable: row?.pdf_storage_path != null,
  };
}

/** Signed URL (5 min) of the delivered PDF for the client screen. */
export async function getClientEvaluationPdfUrl(
  actor: Actor,
  caseId: string,
): Promise<string> {
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseBasic(caseId);
  if (!caseRow) throw new EvaluationsError("CASE_NOT_FOUND");
  const row = await findEvaluationByCase(caseId, JUEZ_TOOL_KEY);
  if (!row || !row.pdf_storage_path) throw new EvaluationsError("PDF_NOT_AVAILABLE");

  return createSignedDownloadUrl(GENERATED_BUCKET, row.pdf_storage_path);
}

// ---------------------------------------------------------------------------
// Staff panel
// ---------------------------------------------------------------------------

/**
 * The staff tab panel — ONE call per case page. null when the case's service
 * has no enabled external tool (tab hidden).
 */
export async function getStaffEvaluationPanel(
  actor: Actor,
  caseId: string,
): Promise<StaffEvaluationVM | null> {
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseBasic(caseId);
  if (!caseRow) return null;
  const config = await getExternalTool(caseRow.service_id);
  if (!config || !config.isEnabled) return null;

  const row = await findEvaluationByCase(caseId, config.toolKey);
  if (!row) {
    return {
      evaluationId: null,
      status: "not_started",
      attemptsAllowed: config.defaultAttempts,
      attemptsUsed: 0,
      pdfAvailable: false,
      deliveredAt: null,
      reportMeta: {},
      runs: [],
      toolKey: config.toolKey,
    };
  }

  const runs = await listRunsForEvaluation(row.id);
  return {
    evaluationId: row.id,
    status: row.status as EvaluationStatus,
    attemptsAllowed: row.attempts_allowed,
    attemptsUsed: row.attempts_used,
    pdfAvailable: row.pdf_storage_path !== null,
    deliveredAt: row.delivered_at,
    reportMeta: reportMetaOf(row),
    runs: runs.map((r) => ({
      jobId: r.job_id,
      status: r.status as StaffEvaluationVM["runs"][number]["status"],
      createdAt: r.created_at,
      error: r.error,
    })),
    toolKey: config.toolKey,
  };
}

/** Signed URL (5 min) of the delivered PDF for the staff tab. */
export async function getStaffEvaluationPdfUrl(
  actor: Actor,
  caseId: string,
): Promise<string> {
  can(actor, "cases", "view");
  await requireCaseAccess(actor, caseId);

  const row = await findEvaluationByCase(caseId, JUEZ_TOOL_KEY);
  if (!row || !row.pdf_storage_path) throw new EvaluationsError("PDF_NOT_AVAILABLE");
  return createSignedDownloadUrl(GENERATED_BUCKET, row.pdf_storage_path);
}

/**
 * Admin-only: grants ONE extra attempt (RF: "1 intento adicional sin pagar").
 * Creates the session lazily if the client never opened the screen (so the
 * grant is never lost). Audited; staff-only timeline entry.
 */
export async function grantExtraAttempt(
  actor: Actor,
  caseId: string,
): Promise<StaffEvaluationVM> {
  can(actor, "cases", "edit");
  if (actor.role !== "admin") throw new AuthzError("forbidden_module");
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseBasic(caseId);
  if (!caseRow) throw new EvaluationsError("CASE_NOT_FOUND");
  const config = await requireToolConfig(caseRow.service_id);

  let row = await findEvaluationByCase(caseId, config.toolKey);
  if (!row) {
    const inserted = await insertEvaluation({
      org_id: caseRow.org_id,
      case_id: caseId,
      tool_key: config.toolKey,
      attempts_allowed: config.defaultAttempts,
    });
    row = inserted.row ?? (await findEvaluationByCase(caseId, config.toolKey));
    if (!row) throw new EvaluationsError("EVALUATION_NOT_FOUND");
  }

  const nextAllowed = row.attempts_allowed + 1;
  await updateEvaluation(row.id, {
    attempts_allowed: nextAllowed,
    // A failed session becomes retryable again with the fresh attempt.
    ...(row.status === "failed" ? { status: "pending" } : {}),
  });

  await writeAudit(actor, "evaluation.attempt_granted", "case_evaluations", row.id, {
    after: { attemptsAllowed: nextAllowed, caseId },
  });

  await appendCaseTimeline({
    caseId,
    eventType: "evaluation.attempt_granted",
    actorKind: "team",
    actorUserId: actor.userId,
    titleI18n: {
      es: "Intento adicional de evaluación otorgado",
      en: "Extra evaluation attempt granted",
    },
    visibleToClient: false,
  });

  const panel = await getStaffEvaluationPanel(actor, caseId);
  if (!panel) throw new EvaluationsError("TOOL_NOT_ENABLED");
  return panel;
}

// ---------------------------------------------------------------------------
// Server-to-server API for Juez (routes authenticate by x-api-key first)
// ---------------------------------------------------------------------------

/**
 * Constant-time check of the `x-api-key` header for the /api/juez/* routes.
 * Both sides are sha256-hashed first so timingSafeEqual never throws on a
 * length mismatch. false → the route answers a dry 401 (also when the `juez`
 * provider env group is not configured in this environment).
 */
export function verifyJuezApiKey(presented: string | null): boolean {
  if (!presented) return false;

  let expected: string;
  try {
    expected = providerEnv("juez").JUEZ_API_KEY;
  } catch {
    logger.warn({}, "evaluations: juez provider env not configured — rejecting API call");
    return false;
  }

  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Session state for Juez. null → route responds 404 (dry). */
export async function getSessionForJuez(token: string): Promise<JuezSessionDto | null> {
  const row = await findEvaluationByToken(token);
  if (!row) return null;

  const client = await findClientInfoForCase(row.case.primary_client_id);

  let pdfUrl: string | null = null;
  if (row.status === "delivered" && row.pdf_storage_path) {
    try {
      pdfUrl = await createSignedDownloadUrl(GENERATED_BUCKET, row.pdf_storage_path);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, evaluationId: row.id },
        "evaluations: failed to sign delivered PDF for Juez session — serving without it",
      );
    }
  }

  return {
    token,
    client,
    attemptsAllowed: row.attempts_allowed,
    attemptsUsed: row.attempts_used,
    status: row.status as EvaluationStatus,
    pdfUrl,
  };
}

/**
 * Consumes ONE attempt for a Juez jobId. Idempotent per jobId.
 *
 * Order (closes every race):
 *  1. Run row exists → already_consumed (no counter change).
 *  2. CAS increment of attempts_used (optimistic loop) → no_attempts when full.
 *  3. Insert run; 23505 (same jobId raced) → refund our increment → already_consumed.
 */
export async function consumeAttempt(
  token: string,
  jobId: string,
): Promise<ConsumeResult | null> {
  const row = await findEvaluationByToken(token);
  if (!row) return null;

  const existingRun = await findRunByJobId(row.id, jobId);
  if (existingRun) {
    return {
      outcome: "already_consumed",
      attemptsAllowed: row.attempts_allowed,
      attemptsUsed: row.attempts_used,
    };
  }

  // Optimistic CAS loop on the counter (max 3 rounds under contention).
  let used = row.attempts_used;
  let swapped = false;
  for (let i = 0; i < 3 && !swapped; i++) {
    if (!canConsumeAttempt(row.attempts_allowed, used)) return { outcome: "no_attempts" };
    swapped = await casAttemptsUsed(row.id, used, 1);
    if (!swapped) {
      const fresh = await findEvaluationByToken(token);
      if (!fresh) return null;
      used = fresh.attempts_used;
    }
  }
  if (!swapped) return { outcome: "no_attempts" };

  const inserted = await insertRun({
    org_id: row.org_id,
    evaluation_id: row.id,
    job_id: jobId,
    status: "consumed",
  });
  if (inserted.conflict) {
    // Same jobId raced us between step 1 and here — undo our increment.
    await casAttemptsUsed(row.id, used + 1, -1).catch(() => void 0);
    return {
      outcome: "already_consumed",
      attemptsAllowed: row.attempts_allowed,
      attemptsUsed: used,
    };
  }

  await updateEvaluation(row.id, { status: "in_progress", last_job_id: jobId });

  logger.info(
    { evaluationId: row.id, jobId, attemptsUsed: used + 1 },
    "evaluations: attempt consumed",
  );

  return {
    outcome: "consumed",
    attemptsAllowed: row.attempts_allowed,
    attemptsUsed: used + 1,
  };
}

// ---------------------------------------------------------------------------
// Inbound webhook (Juez → x-legal)
// ---------------------------------------------------------------------------

/**
 * Verifies HMAC-SHA256 signature, parses payload, and dispatches.
 * Callers MUST catch EvaluationsError signature codes and return 401.
 */
export async function processJuezWebhook(
  rawBody: string,
  signature: string | null,
): Promise<void> {
  const env = providerEnv("juez");

  if (!signature) {
    logger.warn({}, "evaluations: webhook received without signature — rejecting");
    throw new EvaluationsError("WEBHOOK_SIGNATURE_MISSING");
  }

  const expectedHex = createHmac("sha256", env.JUEZ_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");
  const sigValid = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);

  if (!sigValid) {
    logger.warn(
      { sigLength: signature.length },
      "evaluations: webhook signature invalid — rejecting",
    );
    throw new EvaluationsError("WEBHOOK_SIGNATURE_INVALID");
  }

  let parsed: JuezWebhook;
  try {
    parsed = JuezWebhookSchema.parse(JSON.parse(rawBody));
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "evaluations: webhook payload parse failed — no-op 200",
    );
    return; // Malformed payload from a legitimate (signed) sender — safe no-op.
  }

  const row = await findEvaluationByToken(parsed.token);
  if (!row) {
    logger.warn({ jobId: parsed.jobId }, "evaluations: webhook for unknown token — no-op 200");
    return;
  }

  if (parsed.event === "evaluation.completed") {
    await applyEvaluationCompleted(parsed, row);
  } else {
    await applyEvaluationFailed(parsed, row);
  }
}

/**
 * Applies evaluation.completed: downloads the PDF (whitelist + SSRF-safe +
 * size cap + magic bytes) into the `generated` bucket BEFORE acking — Juez
 * deletes its copy after our 200. Idempotent via webhook_events {jobId}:completed.
 */
export async function applyEvaluationCompleted(
  payload: JuezWebhook,
  row: EvaluationWithCase,
): Promise<void> {
  const idempotencyKey = `${payload.jobId}:completed`;
  const claim = await claimWebhookEvent({
    source: JUEZ_WEBHOOK_SOURCE,
    idempotencyKey,
    orgId: row.org_id,
    eventType: "evaluation.completed",
    rawBody: payload as unknown as import("@/shared/database.types").Json,
    signatureValid: true,
  });
  if (claim === "duplicate") {
    logger.info({ jobId: payload.jobId }, "evaluations: completed — duplicate delivery, skipping");
    return;
  }

  // Run row: webhook-before-consume is a legitimate race — create it here and
  // count the attempt (the generation DID happen). The counter converges onto
  // the run-derived truth, so a crash between insert and sync self-heals on
  // the webhook_events retry (STRONG-2).
  let run = await findRunByJobId(row.id, payload.jobId);
  if (!run) {
    const inserted = await insertRun({
      org_id: row.org_id,
      evaluation_id: row.id,
      job_id: payload.jobId,
      status: "consumed",
    });
    run = inserted.row ?? (await findRunByJobId(row.id, payload.jobId));
    await syncAttemptsUsedWithRuns(row.id).catch(() => void 0);
  }

  const result = payload.result;
  if (!result) throw new EvaluationsError("PDF_NOT_AVAILABLE"); // schema guarantees; belt+braces

  // ── Download the PDF (ALL guards before the 200) ──────────────────────────
  if (!isAllowedPdfHost(result.pdfUrl)) {
    logger.error({ jobId: payload.jobId }, "evaluations: pdfUrl host not allowed");
    throw new EvaluationsError("PDF_HOST_NOT_ALLOWED");
  }

  let res: Response;
  try {
    res = await safeFetch(result.pdfUrl, { timeoutMs: 30_000 });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, jobId: payload.jobId },
      "evaluations: PDF download failed (network/ssrf)",
    );
    throw new EvaluationsError("PDF_DOWNLOAD_FAILED");
  }
  if (!res.ok) {
    logger.error({ httpStatus: res.status, jobId: payload.jobId }, "evaluations: PDF download non-2xx");
    throw new EvaluationsError("PDF_DOWNLOAD_FAILED", { httpStatus: res.status });
  }

  const contentLength = Number(res.headers.get("content-length") ?? "0");
  if (contentLength > EVALUATION_PDF_MAX_BYTES) throw new EvaluationsError("PDF_TOO_LARGE");

  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > EVALUATION_PDF_MAX_BYTES) throw new EvaluationsError("PDF_TOO_LARGE");

  const magic = validateMagicBytes("evaluation.pdf", bytes.subarray(0, 16));
  if (!magic.ok) throw new EvaluationsError("PDF_INVALID", { reason: magic.reason });

  const pdfPath = `evaluations/${row.case_id}/${payload.jobId}.pdf`;
  await uploadBytesToStorage(GENERATED_BUCKET, pdfPath, bytes, "application/pdf");

  // ── Persist state ──────────────────────────────────────────────────────────
  const reportMeta = {
    score: result.score ?? null,
    nivel: result.nivel ?? null,
    headline: result.headline ?? null,
  };

  await updateEvaluation(row.id, {
    status: "delivered",
    pdf_storage_path: pdfPath,
    report_meta: reportMeta,
    delivered_at: payload.completedAt ?? new Date().toISOString(),
    last_job_id: payload.jobId,
  });

  if (run) {
    await transitionRun(run.id, "consumed", {
      status: "completed",
      pdf_storage_path: pdfPath,
      report_meta: reportMeta,
    }).catch(() => void 0);
  }

  await appendCaseTimeline({
    caseId: row.case_id,
    eventType: "evaluation.completed",
    actorKind: "system",
    actorUserId: null,
    titleI18n: {
      es: "Tu evaluación está lista",
      en: "Your evaluation is ready",
    },
    visibleToClient: true,
    color: "green",
  });

  await emitEvaluationCompleted({
    caseId: row.case_id,
    orgId: row.org_id,
    evaluationId: row.id,
    jobId: payload.jobId,
    score: result.score ?? null,
  });

  await markWebhookEventProcessed(JUEZ_WEBHOOK_SOURCE, idempotencyKey);

  logger.info(
    { evaluationId: row.id, jobId: payload.jobId, caseId: row.case_id },
    "evaluations: completed — PDF stored and delivered",
  );
}

/**
 * Applies evaluation.failed: refunds the attempt EXACTLY ONCE (run transition
 * consumed→failed is the barrier). The session goes back to pending while
 * attempts remain, else failed.
 */
export async function applyEvaluationFailed(
  payload: JuezWebhook,
  row: EvaluationWithCase,
): Promise<void> {
  const idempotencyKey = `${payload.jobId}:failed`;
  const claim = await claimWebhookEvent({
    source: JUEZ_WEBHOOK_SOURCE,
    idempotencyKey,
    orgId: row.org_id,
    eventType: "evaluation.failed",
    rawBody: payload as unknown as import("@/shared/database.types").Json,
    signatureValid: true,
  });
  if (claim === "duplicate") return;

  const run = await findRunByJobId(row.id, payload.jobId);

  if (run && run.status === "consumed") {
    // Exactly-once transition; the refund itself is applied by the run-derived
    // counter sync below (crash-safe: a webhook_events retry re-runs the sync).
    await transitionRun(run.id, "consumed", {
      status: "failed",
      error: payload.error ?? "GENERATION_FAILED",
    });
  } else if (!run) {
    // Never consumed — record the failure; the sync leaves counters untouched
    // (failed runs don't count).
    await insertRun({
      org_id: row.org_id,
      evaluation_id: row.id,
      job_id: payload.jobId,
      status: "failed",
      error: payload.error ?? "GENERATION_FAILED",
    }).catch(() => void 0);
  }
  // run completed → terminal; failed-after-completed is a no-op.

  // Refund = converge attempts_used onto the runs (consumed|completed count).
  // Runs ALWAYS (even when the transition already happened on a prior crashed
  // attempt) — this is what makes the refund impossible to lose (STRONG-2).
  const usedAfterSync = await syncAttemptsUsedWithRuns(row.id).catch(() => row.attempts_used);

  const fresh = await findEvaluationByToken(payload.token);
  if (fresh && fresh.status !== "delivered") {
    const hasAttempts = canConsumeAttempt(fresh.attempts_allowed, usedAfterSync);
    await updateEvaluation(row.id, {
      status: hasAttempts ? "pending" : "failed",
      report_meta: {
        ...(fresh.report_meta as Record<string, unknown>),
        lastError: payload.error ?? "GENERATION_FAILED",
      },
    });

    await appendCaseTimeline({
      caseId: row.case_id,
      eventType: "evaluation.failed",
      actorKind: "system",
      actorUserId: null,
      titleI18n: hasAttempts
        ? {
            es: "Hubo un problema técnico con tu evaluación — puedes intentarlo de nuevo",
            en: "There was a technical problem with your evaluation — you can try again",
          }
        : {
            es: "Hubo un problema técnico con tu evaluación",
            en: "There was a technical problem with your evaluation",
          },
      visibleToClient: true,
      color: "amber",
    });

    await emitEvaluationFailed({
      caseId: row.case_id,
      orgId: row.org_id,
      evaluationId: row.id,
      jobId: payload.jobId,
      error: payload.error ?? "GENERATION_FAILED",
    });
  }

  await markWebhookEventProcessed(JUEZ_WEBHOOK_SOURCE, idempotencyKey);

  logger.info(
    { evaluationId: row.id, jobId: payload.jobId },
    "evaluations: failed — attempt refunded per run transition",
  );
}

// ---------------------------------------------------------------------------
// Reconciliation polling (QStash job — webhook fallback)
// ---------------------------------------------------------------------------

interface JuezStatusResponse {
  status: "pending" | "done" | "error";
  completedAt?: string;
  webhookDelivered?: boolean;
  result?: { pdfUrl: string; score?: number | null; nivel?: string | null; headline?: string | null };
  error?: string;
}

/**
 * Polls Juez for sessions stuck in_progress (>15 min) and applies the result
 * through the SAME handlers as the webhook (same idempotency keys → natural
 * dedupe when both arrive).
 */
export async function reconcileStaleEvaluations(): Promise<void> {
  const stale = await listStaleInProgress(15);
  if (stale.length === 0) return;

  const env = providerEnv("juez");
  const configCache = new Map<string, ExternalToolConfig | null>();

  for (const row of stale) {
    if (!row.last_job_id) continue;

    let config = configCache.get(row.case.service_id);
    if (config === undefined) {
      config = await getExternalTool(row.case.service_id);
      configCache.set(row.case.service_id, config);
    }
    if (!config) continue;

    let res: Response;
    try {
      // SSRF guard: base_url is staff-editable config-as-data — same defense as
      // the PDF download (reviewer STRONG-3). safeFetch can't carry the api-key
      // header, so: assertPublicUrl first + redirect:"error" (no unguarded hops).
      const statusUrl = `${config.baseUrl}${JUEZ_STATUS_PATH}?jobId=${encodeURIComponent(row.last_job_id)}`;
      await assertPublicUrl(statusUrl);
      res = await fetch(statusUrl, {
        headers: { [JUEZ_API_KEY_HEADER]: env.JUEZ_API_KEY },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
        redirect: "error",
      });
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, evaluationId: row.id },
        "evaluations: reconcile GET failed (network/timeout)",
      );
      continue;
    }

    if (res.status === 202) continue; // still pending on Juez
    if (!res.ok) {
      logger.warn(
        { httpStatus: res.status, evaluationId: row.id },
        "evaluations: reconcile GET returned error",
      );
      continue;
    }

    const body = (await res.json().catch(() => null)) as JuezStatusResponse | null;
    if (!body) continue;

    if (body.status === "done" && body.result) {
      const synthetic: JuezWebhook = {
        event: "evaluation.completed",
        token: row.access_token,
        jobId: row.last_job_id,
        completedAt: body.completedAt ?? null,
        result: {
          pdfUrl: body.result.pdfUrl,
          score: body.result.score ?? null,
          nivel: body.result.nivel ?? null,
          headline: body.result.headline ?? null,
        },
        error: null,
      };
      await applyEvaluationCompleted(synthetic, row).catch((err: unknown) => {
        logger.error(
          { err: (err as Error).message, evaluationId: row.id },
          "evaluations: reconcile — applyEvaluationCompleted failed",
        );
      });
    } else if (body.status === "error") {
      const synthetic: JuezWebhook = {
        event: "evaluation.failed",
        token: row.access_token,
        jobId: row.last_job_id,
        completedAt: null,
        result: null,
        error: body.error ?? "GENERATION_FAILED",
      };
      await applyEvaluationFailed(synthetic, row).catch((err: unknown) => {
        logger.error(
          { err: (err as Error).message, evaluationId: row.id },
          "evaluations: reconcile — applyEvaluationFailed failed",
        );
      });
    }
  }
}
