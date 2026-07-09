/**
 * Integrations module — service layer (use cases).
 *
 * Owns the entire lifecycle of `legal_validations`:
 *   - sendToLawyer:         Builds the package and POSTs to SaaS Abogados
 *   - processVerdictWebhook: HMAC verification + applyVerdict dispatch
 *   - applyVerdict:         Shared idempotent handler (webhook + polling)
 *   - reconcileFromPolling: Cron polling handler (DOC-26 §2.8)
 *
 * Security notes:
 *   - NEVER log secrets, API keys, or PII.
 *   - HMAC verified with crypto.timingSafeEqual (constant-time).
 *   - Signature absent/invalid → 401 + webhook_events row (signature_valid=false).
 *   - org_id resolved from DB (never from payload).
 *
 * @module integrations/service
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { can } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { logger } from "@/backend/platform/logger";
import { providerEnv } from "@/backend/platform/env";
import {
  claimWebhookEvent,
  markWebhookEventProcessed,
} from "@/backend/platform/webhook-events";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";
import {
  AbogadosVerdictWebhookSchema,
  AbogadosPollingResponseSchema,
  buildClientLabel,
  buildAnnexIndex,
  serializeAutomatedForm,
  type AbogadosVerdictWebhook,
  type AnnexIndexItem,
  type SerializeFormInput,
} from "./domain";
import {
  insertValidation,
  findActiveValidation,
  findByExternalValidationId,
  findLatestByCaseId,
  updateValidation,
  listValidationsForCase,
  listValidations as repoListValidations,
  findCaseById,
  findPlanKind,
  findServiceForCase,
  findClientProfile,
  findExpedienteWithItems,
  findGenerationOutputText,
  findDocumentExtractionText,
  updateExpedienteStatus,
  type LegalValidationWithOrg,
  type LegalValidationRow,
  type ListValidationsFilters,
} from "./repository";
import {
  emitValidationSent,
  emitVerdictReceived,
} from "./events";
import {
  ABOGADOS_SOURCE,
  ABOGADOS_API_KEY_HEADER,
  ABOGADOS_VALIDATIONS_PATH,
} from "@/shared/constants/integrations";

// ---------------------------------------------------------------------------
// Lenient UUID schema (same as mold modules)
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const zUuid = z.string().regex(UUID_RE, "uuid");

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class IntegrationsError extends Error {
  constructor(
    public readonly code:
      | "PLAN_NOT_WITH_LAWYER"
      | "EXPEDIENTE_NOT_COMPILED"
      | "VALIDATION_ALREADY_ACTIVE"
      | "ABOGADOS_API_ERROR"
      | "ABOGADOS_API_UNAUTHORIZED"
      | "ABOGADOS_API_BAD_REQUEST"
      | "CASE_NOT_FOUND"
      | "EXPEDIENTE_NOT_FOUND"
      | "VALIDATION_NOT_FOUND"
      | "WEBHOOK_SIGNATURE_INVALID"
      | "WEBHOOK_SIGNATURE_MISSING"
      | "CASE_STATUS_UPDATE_FAILED",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "IntegrationsError";
  }
}

// ---------------------------------------------------------------------------
// sendToLawyer — RF-DIA-038 (DOC-70 §2, §3)
// ---------------------------------------------------------------------------

const SendToLawyerSchema = z.object({
  caseId: zUuid,
  expedienteId: zUuid,
});

export type SendToLawyerInput = z.infer<typeof SendToLawyerSchema>;

/**
 * Builds the text package and POSTs it to SaaS Abogados.
 *
 * Gate order:
 *   1. can(actor, 'validations', 'edit')
 *   2. plan.kind === 'with_lawyer'
 *   3. expediente.status === 'compiled'
 *   4. no active validation for the case
 *
 * Handles all response codes from DOC-70 §3.
 */
export async function sendToLawyer(
  actor: Actor,
  input: SendToLawyerInput,
): Promise<{ validationId: string; external: string | null }> {
  can(actor, "validations", "edit");
  const parsed = SendToLawyerSchema.parse(input);

  // 1. Load case
  const caseRow = await findCaseById(parsed.caseId);
  if (!caseRow) throw new IntegrationsError("CASE_NOT_FOUND");

  // 2. Plan gate
  const planKind = await findPlanKind(caseRow.service_plan_id);
  if (planKind !== "with_lawyer") {
    throw new IntegrationsError("PLAN_NOT_WITH_LAWYER");
  }

  // 3. Load expediente + items
  const { expediente, items } = await findExpedienteWithItems(parsed.expedienteId);
  if (!expediente || expediente.case_id !== parsed.caseId) {
    throw new IntegrationsError("EXPEDIENTE_NOT_FOUND");
  }
  // New flow: Diana marks the expediente "Listo" (`ready`) before the Traspaso a
  // Abogado. `compiled` still accepted for the legacy/admin path.
  if (expediente.status !== "ready" && expediente.status !== "compiled") {
    throw new IntegrationsError("EXPEDIENTE_NOT_COMPILED");
  }

  // 4. No active validation
  const active = await findActiveValidation(parsed.caseId);
  if (active) {
    throw new IntegrationsError("VALIDATION_ALREADY_ACTIVE", {
      activeId: active.id,
      status: active.status,
    });
  }

  // 5. Build PII-safe client_label
  const clientProfile = await findClientProfile(caseRow.primary_client_id);
  const clientLabel = clientProfile
    ? buildClientLabel(clientProfile.first_name, clientProfile.last_name)
    : null;

  // 6. Resolve service slug + name
  const service = await findServiceForCase(caseRow.service_id);
  const serviceSlug = service?.slug ?? null;
  const labelI18n = service?.label_i18n as { es?: string } | null;
  const serviceName = labelI18n?.es ?? null;

  // 7. Build documents[] from expediente items
  const documents = await buildDocumentsArray(items);

  // 8. Insert validation row with status='pending'
  const env = providerEnv("abogados");

  const validationRow = await insertValidation({
    case_id: parsed.caseId,
    expediente_id: parsed.expedienteId,
    attempt_no: expediente.attempt_no,
    status: "pending",
    sent_at: null,
    external_validation_id: null,
  });

  // 9. POST to SaaS Abogados
  const postPayload = {
    external_case_id: parsed.caseId,
    source: ABOGADOS_SOURCE,
    case_number: caseRow.case_number,
    service_slug: serviceSlug,
    service_name: serviceName,
    client_label: clientLabel,
    documents,
    review: null,
    callback_url: env.ABOGADOS_CALLBACK_URL,
  };

  let httpResponse: Response;
  try {
    httpResponse = await fetch(
      `${env.ABOGADOS_API_URL}${ABOGADOS_VALIDATIONS_PATH}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [ABOGADOS_API_KEY_HEADER]: env.ABOGADOS_API_KEY,
        },
        body: JSON.stringify(postPayload),
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch (err) {
    // Timeout or network failure → retry-able (5xx semantics)
    logger.error(
      { err: (err as Error).message, caseId: parsed.caseId },
      "integrations: POST to SaaS Abogados failed (network/timeout)",
    );
    await updateValidation(validationRow.id, { status: "sent" });
    throw new IntegrationsError("ABOGADOS_API_ERROR", { reason: "network_timeout" });
  }

  await handlePostResponse(httpResponse, validationRow, parsed, actor, caseRow, expediente);

  return {
    validationId: validationRow.id,
    external: null, // caller can read from the returned row if needed
  };
}

// ---------------------------------------------------------------------------
// Internal: handle POST responses (DOC-70 §3)
// ---------------------------------------------------------------------------

async function handlePostResponse(
  res: Response,
  validationRow: LegalValidationRow,
  parsed: SendToLawyerInput,
  actor: Actor,
  caseRow: Awaited<ReturnType<typeof findCaseById>>,
  expediente: { id: string; case_id: string; attempt_no: number; status: string },
): Promise<void> {
  const env = providerEnv("abogados");

  if (res.status === 202) {
    const body = await res.json() as {
      validation_id: string;
      status: string;
      semaforo: string | null;
      prereview: string;
    };

    await updateValidation(validationRow.id, {
      status: "queued",
      external_validation_id: body.validation_id,
      sent_at: new Date().toISOString(),
      semaforo: body.semaforo ?? null,
    });

    // Expediente → sent_to_lawyer; Case → in_validation
    await updateExpedienteStatus(expediente.id, "sent_to_lawyer").catch((err: unknown) => {
      logger.warn({ err, expedienteId: expediente.id }, "integrations: failed to update expediente status");
    });

    await setCaseStatusSystem(parsed.caseId, "in_validation");

    emitValidationSent({
      caseId: parsed.caseId,
      expedienteId: parsed.expedienteId,
      validationId: validationRow.id,
      externalValidationId: body.validation_id,
      attemptNo: expediente.attempt_no,
      semaforo: body.semaforo ?? null,
    });

    await appendCaseTimeline({
      caseId: parsed.caseId,
      eventType: "validation.sent",
      actorKind: "team",
      actorUserId: actor.userId,
      titleI18n: {
        en: `Expediente sent to lawyer (attempt ${expediente.attempt_no})`,
        es: `Expediente enviado al abogado (intento ${expediente.attempt_no})`,
      },
      visibleToClient: false,
    });

    await writeAudit(
      actor,
      "validation.sent",
      "legal_validations",
      validationRow.id,
      {
        after: {
          externalValidationId: body.validation_id,
          status: "queued",
          attemptNo: expediente.attempt_no,
        },
      },
    );
    return;
  }

  if (res.status === 200) {
    // 200-dedup: adopt existing validation_id, NO new attempt
    const body = await res.json() as {
      validation_id: string;
      status: string;
      semaforo: string | null;
      deduplicated: boolean;
    };

    await updateValidation(validationRow.id, {
      status: body.status as string,
      external_validation_id: body.validation_id,
      sent_at: new Date().toISOString(),
      semaforo: body.semaforo ?? null,
    });

    logger.info(
      { caseId: parsed.caseId, validationId: body.validation_id },
      "integrations: 200-dedup — adopted existing SaaS validation",
    );
    return;
  }

  if (res.status === 401) {
    const body = await res.json().catch(() => ({ error: "401" })) as { error: string };
    await updateValidation(validationRow.id, {
      status: "error",
      error: `401 api key: ${body.error}`,
    });

    // Expediente back to compiled
    await updateExpedienteStatus(expediente.id, "compiled").catch(() => void 0);

    logger.error(
      { caseId: parsed.caseId },
      "integrations: 401 from SaaS — ABOGADOS_API_KEY misconfigured or rotated",
    );
    throw new IntegrationsError("ABOGADOS_API_UNAUTHORIZED", { httpStatus: 401 });
  }

  if (res.status === 400) {
    const body = await res.json().catch(() => ({ error: "400" })) as { error: string; details?: unknown };
    await updateValidation(validationRow.id, {
      status: "error",
      error: `400 bad request: ${body.error}`,
    });

    await updateExpedienteStatus(expediente.id, "compiled").catch(() => void 0);

    logger.error(
      { caseId: parsed.caseId, details: body.details },
      "integrations: 400 from SaaS — serialization bug in V2",
    );
    throw new IntegrationsError("ABOGADOS_API_BAD_REQUEST", {
      httpStatus: 400,
      details: body.details,
    });
  }

  if (res.status === 409) {
    // Race — two concurrent POSTs; reconcile via GET
    logger.warn(
      { caseId: parsed.caseId },
      "integrations: 409 — concurrent POST race; reconciling via GET",
    );
    // Fetch current state from SaaS GET (DOC-70 §6)
    const getRes = await fetch(
      `${env.ABOGADOS_API_URL}${ABOGADOS_VALIDATIONS_PATH}/${encodeURIComponent(parsed.caseId)}?source=${encodeURIComponent(ABOGADOS_SOURCE)}`,
      {
        headers: { [ABOGADOS_API_KEY_HEADER]: env.ABOGADOS_API_KEY },
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(() => null);

    if (getRes?.ok) {
      const getBody = await getRes.json() as { validation: { id: string; status: string; semaforo: string | null } };
      const existing = getBody.validation;
      await updateValidation(validationRow.id, {
        status: existing.status,
        external_validation_id: existing.id,
        sent_at: new Date().toISOString(),
        semaforo: existing.semaforo ?? null,
      });
    }
    return;
  }

  // 5xx or unexpected → keep status='sent' and throw for QStash retry
  await updateValidation(validationRow.id, { status: "sent" });
  logger.error(
    { caseId: parsed.caseId, httpStatus: res.status },
    "integrations: 5xx/unexpected from SaaS — will retry via QStash",
  );
  throw new IntegrationsError("ABOGADOS_API_ERROR", { httpStatus: res.status });
}

// ---------------------------------------------------------------------------
// Internal: build documents[] from expediente items (DOC-70 §2.4)
// ---------------------------------------------------------------------------

async function buildDocumentsArray(
  items: Array<{
    id: string;
    position: number;
    title: string;
    item_type: string;
    page_count: number | null;
    ref_id: string | null;
    external_file_path: string | null;
    include_in_toc: boolean;
  }>,
): Promise<Array<{ name: string; kind: string; content: string }>> {
  const documents: Array<{ name: string; kind: string; content: string }> = [];
  const annexItems: AnnexIndexItem[] = [];

  for (const item of items) {
    if (item.item_type === "cover") {
      // Cover — never sent (DOC-70 §2.4)
      annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
      continue;
    }

    if (item.item_type === "external_file") {
      // External files — only in index (DOC-70 §2.4)
      annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
      continue;
    }

    if (item.item_type === "ai_generation" && item.ref_id) {
      const run = await findGenerationOutputText(item.ref_id);
      if (run?.output_text) {
        documents.push({
          name: `${item.title} (v${run.version ?? 1})`,
          kind: "declaration",
          content: run.output_text,
        });
        annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: true });
        continue;
      }
      // No output_text — only include in index
      annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
      continue;
    }

    if (item.item_type === "automated_form" && item.ref_id) {
      const formText = await serializeFormFromResponse(item.ref_id, item.title);
      if (formText) {
        documents.push({
          name: item.title,
          kind: "official_form",
          content: formText,
        });
        annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: true });
        continue;
      }
      annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
      continue;
    }

    if (item.item_type === "client_document" && item.ref_id) {
      const extraction = await findDocumentExtractionText(item.ref_id);
      if (extraction?.raw_text) {
        documents.push({
          name: item.title,
          kind: "other",
          content: `[Texto extraído por OCR/IA del documento subido por el cliente — el original es un escaneo]\n\n${extraction.raw_text}`,
        });
        annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: true });
      } else {
        annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
      }
      continue;
    }

    // Fallback — only in index
    annexItems.push({ position: item.position, title: item.title, item_type: item.item_type, page_count: item.page_count, textIncluded: false });
  }

  // Always append annex index as last document
  documents.push(buildAnnexIndex(annexItems));

  return documents;
}

/** Serializes an automated form response into text (DOC-70 §2.4.1). */
async function serializeFormFromResponse(
  formResponseId: string,
  title: string,
): Promise<string | null> {
  try {
    const supabase = (await import("@/backend/platform/supabase")).createServiceClient();

    // 1. Load form response (answers + version id)
    const { data: formResponse } = await supabase
      .from("case_form_responses")
      .select("case_id, form_definition_id, party_id, answers, automation_version_id")
      .eq("id", formResponseId)
      .maybeSingle();

    if (!formResponse) return null;

    const versionId = formResponse.automation_version_id;
    if (!versionId) return null;

    const answers = (formResponse.answers ?? {}) as Record<string, unknown>;

    // 2. Load question groups + questions (catalog module-pub; dynamic import to
    // keep the module load graph acyclic — type-checked against the real exports).
    const { listQuestionGroups, listQuestions } = await import("@/backend/modules/catalog");

    const rawGroups = await listQuestionGroups(versionId);

    const groups = await Promise.all(
      rawGroups.map(async (g) => {
        const rawQuestions = await listQuestions(g.id);
        const titleI18n = g.title_i18n as { es?: string } | null;
        return {
          id: g.id,
          title_i18n: { es: titleI18n?.es ?? "", en: "" },
          position: g.position,
          questions: rawQuestions.map((q) => {
            const questionI18n = q.question_i18n as { es?: string } | null;
            const opts = q.options as Array<{ value: string; label_i18n: { es: string } }> | null;
            return {
              id: q.id,
              question_i18n: { es: questionI18n?.es ?? "" },
              pdf_field_name: q.pdf_field_name ?? q.id,
              field_type: q.field_type,
              is_required: q.is_required,
              options: opts ?? null,
              answer: answers[q.id] ?? null,
            };
          }),
        };
      }),
    );

    const serializeInput: SerializeFormInput = {
      label: title,
      versionNo: 1, // version number not stored on case_form_responses; use 1
      versionLabel: "publicada",
      partyLabel: null,
      groups,
    };

    return serializeAutomatedForm(serializeInput);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, formResponseId },
      "integrations: failed to serialize form — skipping",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// applyVerdict — shared idempotent handler (DOC-70 §4.4)
// ---------------------------------------------------------------------------

/**
 * System-context case status change (webhook / polling — NO request session).
 *
 * `cases.changeCaseStatus` reads the case via the RLS-scoped server client,
 * which sees nothing without a session. In the webhook/cron context we update
 * `cases.status` via the service-role client (same pattern as the expediente
 * status updates). The verdict→status mapping is fixed by DOC-70 §7.2.
 */
async function setCaseStatusSystem(
  caseId: string,
  target: "in_validation" | "ready_for_delivery" | "active",
): Promise<void> {
  const supabase = (await import("@/backend/platform/supabase")).createServiceClient();
  const { error } = await supabase.from("cases").update({ status: target }).eq("id", caseId);
  if (error) {
    logger.error({ err: error.message, caseId, target }, "integrations: setCaseStatusSystem failed");
    throw new IntegrationsError("CASE_STATUS_UPDATE_FAILED");
  }
}

/**
 * Applies a SaaS verdict to V2 state.
 *
 * Called by both processVerdictWebhook and reconcileFromPolling.
 * OWNS idempotency: claimWebhookEvent with key '{validation_id}:{verdict_at}'.
 *
 * Effects per verdict:
 *   validated        → legal_validations=validated, expediente=approved, case=ready_for_delivery
 *   needs_corrections → legal_validations=needs_corrections, expediente=corrections_needed, case stays in_validation
 *   cancelled        → legal_validations=cancelled, expediente=compiled, case=active
 */
export async function applyVerdict(
  payload: AbogadosVerdictWebhook,
  validationRow: LegalValidationWithOrg,
): Promise<void> {
  const idempotencyKey = `${payload.validation_id}:${payload.verdict_at}`;
  const orgId = validationRow.org_id;

  const claim = await claimWebhookEvent({
    source: "abogados",
    idempotencyKey,
    orgId,
    eventType: "validation.verdict",
    rawBody: payload as unknown as import("@/shared/database.types").Json,
    signatureValid: true,
  });

  if (claim === "duplicate") {
    logger.info(
      { validationId: validationRow.id, idempotencyKey },
      "integrations: applyVerdict — duplicate delivery, skipping",
    );
    return;
  }

  const caseId = validationRow.case_id;
  const expedienteId = validationRow.expediente_id;

  if (payload.verdict === "validated") {
    await updateValidation(validationRow.id, {
      status: "validated",
      verdict: "validated",
      verdict_notes: payload.verdict_notes ?? null,
      verdict_findings: (payload.verdict_findings ?? []) as unknown as import("@/shared/database.types").Json,
      verdict_at: payload.verdict_at,
      return_to: payload.return_to ?? null,
      semaforo: payload.semaforo ?? null,
      ai_score: payload.ai_score ?? null,
    });

    await updateExpedienteStatus(expedienteId, "approved").catch((err: unknown) => {
      logger.warn({ err, expedienteId }, "integrations: applyVerdict — failed to set expediente=approved");
    });

    await setCaseStatusSystem(caseId, "ready_for_delivery");

    // Henry's flow (with_lawyer): once the lawyer validates, the approved expediente
    // flows straight to Andrium — no manual "send" by Diana. sendToFinanceSystem
    // emits expediente.sent_to_finance, which advances legal→operations + queues it
    // for Andrium (same consumer as the self-plan handoff).
    try {
      const { sendToFinanceSystem } = await import("@/backend/modules/expediente");
      await sendToFinanceSystem({ caseId, expedienteId, orgId });
    } catch (err: unknown) {
      logger.warn({ err, expedienteId }, "integrations: applyVerdict — auto send-to-Andrium failed");
    }

    emitVerdictReceived({
      caseId,
      expedienteId,
      validationId: validationRow.id,
      externalValidationId: payload.validation_id,
      attemptNo: validationRow.attempt_no,
      verdict: "validated",
      verdictNotes: payload.verdict_notes ?? null,
      returnTo: payload.return_to ?? null,
      semaforo: payload.semaforo ?? null,
      aiScore: payload.ai_score ?? null,
    });

    await appendCaseTimeline({
      caseId,
      eventType: "validation.verdict_received",
      actorKind: "system",
      actorUserId: null,
      titleI18n: {
        en: "Expediente validated by lawyer",
        es: "Expediente validado por el abogado",
      },
      visibleToClient: true,
      color: "green",
    });
  } else if (payload.verdict === "needs_corrections") {
    await updateValidation(validationRow.id, {
      status: "needs_corrections",
      verdict: "needs_corrections",
      verdict_notes: payload.verdict_notes ?? null,
      verdict_findings: (payload.verdict_findings ?? []) as unknown as import("@/shared/database.types").Json,
      verdict_at: payload.verdict_at,
      return_to: payload.return_to ?? null,
      semaforo: payload.semaforo ?? null,
      ai_score: payload.ai_score ?? null,
    });

    await updateExpedienteStatus(expedienteId, "corrections_needed").catch((err: unknown) => {
      logger.warn({ err, expedienteId }, "integrations: applyVerdict — failed to set expediente=corrections_needed");
    });

    // Case stays in_validation (no changeCaseStatus call)

    emitVerdictReceived({
      caseId,
      expedienteId,
      validationId: validationRow.id,
      externalValidationId: payload.validation_id,
      attemptNo: validationRow.attempt_no,
      verdict: "needs_corrections",
      verdictNotes: payload.verdict_notes ?? null,
      returnTo: payload.return_to ?? null,
      semaforo: payload.semaforo ?? null,
      aiScore: payload.ai_score ?? null,
    });

    await appendCaseTimeline({
      caseId,
      eventType: "validation.verdict_received",
      actorKind: "system",
      actorUserId: null,
      titleI18n: {
        en: "We are making final adjustments to your expediente",
        es: "Estamos haciendo ajustes finales a tu expediente",
      },
      visibleToClient: true,
      color: "amber",
    });
  } else if (payload.verdict === "cancelled") {
    await updateValidation(validationRow.id, {
      status: "cancelled",
      verdict: "cancelled",
      verdict_at: payload.verdict_at,
    });

    await updateExpedienteStatus(expedienteId, "compiled").catch((err: unknown) => {
      logger.warn({ err, expedienteId }, "integrations: applyVerdict — failed to restore expediente=compiled");
    });

    await setCaseStatusSystem(caseId, "active");
  }

  await markWebhookEventProcessed("abogados", idempotencyKey);

  logger.info(
    { validationId: validationRow.id, verdict: payload.verdict, caseId },
    "integrations: applyVerdict — applied",
  );
}

// ---------------------------------------------------------------------------
// processVerdictWebhook — verifies HMAC and dispatches (DOC-70 §4.2)
// ---------------------------------------------------------------------------

/**
 * Verifies HMAC-SHA256 signature, parses payload, and dispatches to applyVerdict.
 *
 * Security (DOC-70 §4.2, §8):
 *   - Reads raw body BEFORE any parse (signature is over raw bytes).
 *   - HMAC-SHA256 hex over raw body with ABOGADOS_WEBHOOK_SECRET.
 *   - crypto.timingSafeEqual for constant-time comparison.
 *   - Lengths verified BEFORE timingSafeEqual (it throws on mismatch).
 *   - Absent/invalid signature → throws IntegrationsError.
 *
 * Callers MUST catch and return 401 on IntegrationsError.
 */
export async function processVerdictWebhook(
  rawBody: string,
  signature: string | null,
): Promise<void> {
  const env = providerEnv("abogados");

  // 1. Signature MUST be present
  if (!signature) {
    logger.warn({}, "integrations: webhook received without signature — rejecting");
    await recordInvalidWebhook(rawBody, "", "missing").catch(() => void 0);
    throw new IntegrationsError("WEBHOOK_SIGNATURE_MISSING");
  }

  // 2. Compute expected HMAC-SHA256 hex
  const expectedHex = createHmac("sha256", env.ABOGADOS_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // 3. Constant-time comparison (verify lengths first — timingSafeEqual throws on mismatch)
  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expectedHex, "hex");

  const sigValid =
    sigBuf.length === expBuf.length &&
    timingSafeEqual(sigBuf, expBuf);

  if (!sigValid) {
    logger.warn(
      { sigLength: signature.length },
      "integrations: webhook signature invalid — rejecting",
    );
    // Record forensic row — best effort; don't block 401 on failure
    await recordInvalidWebhook(rawBody, signature, "invalid").catch(() => void 0);
    throw new IntegrationsError("WEBHOOK_SIGNATURE_INVALID");
  }

  // 4. Parse payload
  let parsed: AbogadosVerdictWebhook;
  try {
    const raw = JSON.parse(rawBody) as unknown;
    parsed = AbogadosVerdictWebhookSchema.parse(raw);
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      "integrations: webhook payload parse failed — no-op 200",
    );
    return; // Malformed payload from a legitimate sender — safe no-op
  }

  // 5. Source guard
  if (parsed.source !== ABOGADOS_SOURCE) {
    logger.info(
      { source: parsed.source },
      "integrations: webhook source mismatch — no-op 200",
    );
    return;
  }

  // 6. Find local validation row (by external_validation_id, fallback by case_id+max attempt)
  let validationRow: LegalValidationWithOrg | null =
    await findByExternalValidationId(parsed.validation_id);

  if (!validationRow) {
    validationRow = await findLatestByCaseId(parsed.external_case_id);
  }

  if (!validationRow) {
    logger.warn(
      { validationId: parsed.validation_id, externalCaseId: parsed.external_case_id },
      "integrations: no local validation row found — no-op 200",
    );
    return;
  }

  // 7. Apply verdict
  await applyVerdict(parsed, validationRow);
}

/**
 * Records a rejected webhook for forensic audit (DOC-70 §4.2).
 *
 * The rejection is ALWAYS logged (never silent), even when the org can't be
 * resolved. `webhook_events.org_id` is NOT NULL, so the persisted forensic row
 * is written only when the case (and thus its org) is known; otherwise the log
 * is the forensic record.
 */
async function recordInvalidWebhook(
  rawBody: string,
  signature: string,
  reason: "missing" | "invalid",
): Promise<void> {
  const supabase = (await import("@/backend/platform/supabase")).createServiceClient();

  // Parse just enough to get external_case_id for the org lookup.
  let orgId: string | null = null;
  try {
    const partial = JSON.parse(rawBody) as { external_case_id?: string };
    if (partial.external_case_id) {
      const { data } = await supabase
        .from("cases")
        .select("org_id")
        .eq("id", partial.external_case_id)
        .maybeSingle();
      orgId = data?.org_id ?? null;
    }
  } catch {
    // best effort — body may be unparseable
  }

  // Forensic LOG — always, even when org_id is unknown (no silent drop).
  logger.warn(
    { reason, sigPrefix: signature ? signature.slice(0, 8) : null, orgResolved: orgId !== null },
    "integrations: rejected webhook (forensic)",
  );

  if (!orgId) return; // org_id is NOT NULL — the log above is the record.

  await supabase.from("webhook_events").insert({
    source: "abogados",
    idempotency_key: `invalid:${reason}:${Date.now()}`,
    org_id: orgId,
    event_type: "validation.verdict",
    raw_body: rawBody as unknown as import("@/shared/database.types").Json,
    signature_valid: false,
  });
}

// ---------------------------------------------------------------------------
// reconcileFromPolling — cron handler (DOC-26 §2.8)
// ---------------------------------------------------------------------------

/**
 * Polls the SaaS for a single row and applies any pending verdict.
 *
 * Called by the `retry-abogados-polling` job per candidate row.
 * Shares applyVerdict for idempotency (same webhook_events key).
 */
export async function reconcileFromPolling(
  row: LegalValidationWithOrg,
): Promise<void> {
  // The GET keys on case_id, so rows WITHOUT external_validation_id (recovered
  // from a 409 or a lost POST response) are reconciled too — DOC-70 §6 lists
  // "fila V2 sin external_validation_id" as an explicit polling use case.
  const env = providerEnv("abogados");

  let getRes: Response;
  try {
    getRes = await fetch(
      `${env.ABOGADOS_API_URL}${ABOGADOS_VALIDATIONS_PATH}/${encodeURIComponent(row.case_id)}?source=${encodeURIComponent(ABOGADOS_SOURCE)}`,
      {
        headers: { [ABOGADOS_API_KEY_HEADER]: env.ABOGADOS_API_KEY },
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (err) {
    logger.error(
      { err: (err as Error).message, validationId: row.id },
      "integrations: polling GET failed (network/timeout)",
    );
    return; // Non-fatal; next cron run will retry
  }

  if (!getRes.ok) {
    if (getRes.status === 404) {
      logger.warn(
        { validationId: row.id, caseId: row.case_id },
        "integrations: polling — SaaS returned 404",
      );
      return;
    }
    logger.error(
      { httpStatus: getRes.status, validationId: row.id },
      "integrations: polling GET returned error",
    );
    return;
  }

  const body = await getRes.json() as unknown;
  const pollingParsed = AbogadosPollingResponseSchema.safeParse(body);
  if (!pollingParsed.success) {
    logger.warn(
      { validationId: row.id },
      "integrations: polling — failed to parse GET response",
    );
    return;
  }

  const v = pollingParsed.data.validation;

  // Always refresh semaforo / ai_score / status mirror
  const patch: import("@/shared/database.types").TablesUpdate<"legal_validations"> = {};
  if (v.semaforo !== undefined) patch.semaforo = v.semaforo ?? null;
  if (v.ai_score !== undefined) patch.ai_score = v.ai_score ?? null;
  // Recover orphan rows: adopt the SaaS validation_id if we never captured it (DOC-70 §6).
  if (!row.external_validation_id && v.id) patch.external_validation_id = v.id;
  if (v.status && !["validated", "needs_corrections", "error", "cancelled"].includes(row.status)) {
    patch.status = v.status;
  }

  if (Object.keys(patch).length > 0) {
    await updateValidation(row.id, patch).catch((err: unknown) => {
      logger.warn({ err, validationId: row.id }, "integrations: polling — patch update failed");
    });
  }

  // Apply verdict if present and not yet processed
  if (v.verdict && v.verdict_at) {
    const verdictPayload: AbogadosVerdictWebhook = {
      event: "validation.verdict",
      validation_id: v.id,
      external_case_id: v.external_case_id,
      source: v.source,
      case_number: v.case_number ?? null,
      verdict: v.verdict,
      verdict_notes: v.verdict_notes ?? null,
      verdict_findings: v.verdict_findings ?? null,
      verdict_at: v.verdict_at,
      review_seconds: v.review_seconds ?? null,
      return_to: v.return_to ?? null,
      semaforo: v.semaforo ?? null,
      ai_score: v.ai_score ?? null,
    };

    await applyVerdict(verdictPayload, row);
    return;
  }

  // >72h without verdict → mark error and notify
  const sentAt = row.sent_at ? new Date(row.sent_at).getTime() : null;
  const age72h = 72 * 60 * 60 * 1000;
  if (sentAt && Date.now() - sentAt > age72h) {
    logger.warn(
      { validationId: row.id, caseId: row.case_id, sentAt: row.sent_at },
      "integrations: polling — >72h without verdict; flagging for human review",
    );
    await updateValidation(row.id, {
      error: `No verdict received after 72h (polling). SaaS status: ${v.status}. Requires human review.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Lists validations for a case (staff view).
 */
export async function getValidationsForCase(
  actor: Actor,
  caseId: string,
): Promise<LegalValidationRow[]> {
  can(actor, "validations", "view");
  return listValidationsForCase(caseId);
}

/**
 * Lists validations with filters (admin/staff UI).
 */
export async function listValidationsAdmin(
  actor: Actor,
  filters: ListValidationsFilters,
): Promise<LegalValidationRow[]> {
  can(actor, "validations", "view");
  return repoListValidations(filters);
}

// ---------------------------------------------------------------------------
// Re-export repo types for index.ts
// ---------------------------------------------------------------------------

export type { LegalValidationRow, LegalValidationWithOrg, ListValidationsFilters };
