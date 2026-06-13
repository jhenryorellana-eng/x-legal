/**
 * Cases module — service layer (use cases).
 *
 * Authorization: can() / requireCaseAccess() is ALWAYS the first line.
 * Mutations: writeAudit on every staff mutation.
 * Timeline: writeTimeline (internal, not exported) via audit.appendCaseTimeline.
 * Events: appEvents.emit() for domain events.
 *
 * @module cases/service
 */

import { z } from "zod";

import { can, requireCaseAccess, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import { createSignedUploadUrl, validateUploadedObject } from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import type { TablesUpdate } from "@/shared/database.types";

import {
  canTransitionCase,
  canTransitionDocument,
  PRODUCTION_STATUSES,
  type CaseStatus,
} from "./domain";
import {
  findCaseById,
  findCaseByCaseId,
  updateCase,
  insertPhaseHistory,
  findDocumentById,
  insertCaseDocument,
  updateDocument,
  findCurrentChainHead,
  getTimelinePage,
  listCases,
  getRequirementOverrides,
  getCaseParties,
  type CaseRow,
  type CaseDocumentRow,
  type TimelinePage,
  type CasesPage,
} from "./repository";

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class CaseError extends Error {
  constructor(
    public readonly code:
      | "CASE_NOT_FOUND"
      | "CASE_INVALID_TRANSITION"
      | "CASE_FORBIDDEN_TRANSITION"
      | "CASE_NOT_IN_PRODUCTION"
      | "CASE_NOTE_REQUIRED"
      | "CASE_PHASE_INVALID"
      | "CASE_SERVICE_NOT_AVAILABLE"
      | "CASE_PAYMENT_PLAN_INVALID"
      | "DOC_NOT_FOUND"
      | "DOC_INVALID_STATE"
      | "DOC_REJECTION_REASON_REQUIRED"
      | "DOC_REQUIREMENT_NOT_FOUND"
      | "DOC_PARTY_NOT_ELIGIBLE"
      | "DOC_UPLOAD_INVALID",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "CaseError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Icon map for timeline events. */
function iconForEvent(eventType: string): string {
  const map: Record<string, string> = {
    "case.created": "file-plus",
    "case.status_changed": "refresh-cw",
    "downpayment.confirmed": "dollar-sign",
    "document.uploaded": "upload",
    "document.approved": "check-circle",
    "document.rejected": "alert-circle",
    "terms.accepted": "file-check",
    "phase.advanced": "chevrons-right",
  };
  return map[eventType] ?? "info";
}

/** Color map for timeline events. */
function colorForEvent(eventType: string, actorKind: string): string {
  if (eventType === "document.rejected") return "amber"; // never red (RF-TRX-022)
  if (eventType === "document.approved") return "green";
  if (eventType === "downpayment.confirmed") return "green";
  if (eventType === "phase.advanced") return "gold";
  if (actorKind === "system") return "blue";
  return "gray";
}

/**
 * Internal timeline writer — NOT exported.
 * Cases module's sole writer delegates to audit.appendCaseTimeline (RF-TRX-024 CA3).
 */
async function writeTimeline(entry: {
  caseId: string;
  eventType: string;
  actorKind: "client" | "team" | "system";
  actorUserId?: string | null;
  titleI18n?: { en: string; es: string };
  bodyI18n?: { en: string; es: string } | null;
  visibleToClient: boolean;
  occurredAt?: Date;
}): Promise<void> {
  const titleI18n = entry.titleI18n ?? {
    en: entry.eventType,
    es: entry.eventType,
  };

  await appendCaseTimeline({
    caseId: entry.caseId,
    eventType: entry.eventType,
    actorKind: entry.actorKind,
    actorUserId: entry.actorUserId ?? null,
    titleI18n,
    bodyI18n: entry.bodyI18n ?? null,
    icon: iconForEvent(entry.eventType),
    color: colorForEvent(entry.eventType, entry.actorKind),
    visibleToClient: entry.visibleToClient,
    occurredAt: entry.occurredAt ?? new Date(),
  });
}

// ---------------------------------------------------------------------------
// onDownpaymentConfirmed — consumer of billing.downpayment.confirmed
// ---------------------------------------------------------------------------

/**
 * Activates a case after downpayment is confirmed.
 *
 * Consumed via appEvents. Runs with service client (system actor).
 * Idempotent: if case is not in payment_pending, silently no-ops.
 *
 * @api-id (event consumer, not an HTTP endpoint)
 */
export async function onDownpaymentConfirmed(payload: {
  caseId: string;
  installmentId: string;
}): Promise<void> {
  const caseRow = await findCaseByCaseId(payload.caseId);
  if (!caseRow) {
    logger.warn(
      { caseId: payload.caseId },
      "cases.onDownpaymentConfirmed: case not found — skipping",
    );
    return;
  }

  if (caseRow.status !== "payment_pending") {
    // Idempotent: already activated (or cancelled/on_hold) — skip
    return;
  }

  // We need the first phase from catalog to set current_phase_id.
  // getCatalogFirstPhase is added in F3; if unavailable, activate without phase.
  let firstPhaseId: string | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const catalogModule = await import("@/backend/modules/catalog") as any;
    if (typeof catalogModule.getCatalogFirstPhase === "function") {
      const phase = await catalogModule.getCatalogFirstPhase(caseRow.service_id);
      firstPhaseId = phase?.id ?? null;
    }
  } catch (err) {
    logger.warn(
      { err, caseId: payload.caseId },
      "cases.onDownpaymentConfirmed: could not get first phase — activating without phase",
    );
  }

  await updateCase(caseRow.id, {
    status: "active",
    opened_at: new Date().toISOString(),
    current_phase_id: firstPhaseId,
  });

  if (firstPhaseId) {
    await insertPhaseHistory({
      caseId: caseRow.id,
      phaseId: firstPhaseId,
      enteredBy: null,
      note: "case opened (downpayment confirmed)",
    });
  }

  await writeTimeline({
    caseId: caseRow.id,
    eventType: "downpayment.confirmed",
    actorKind: "system",
    visibleToClient: true,
    titleI18n: {
      en: "Your case is now active",
      es: "Tu caso está ahora activo",
    },
  });
}

// ---------------------------------------------------------------------------
// Document upload (2-step: URL → confirm)
// ---------------------------------------------------------------------------

const RequestUploadSchema = z.object({
  caseId: z.string().uuid(),
  requirementId: z.string().uuid().nullable().optional(),
  partyId: z.string().uuid().nullable().optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

export type RequestUploadInput = z.infer<typeof RequestUploadSchema>;

/**
 * Step 1: request a signed upload URL for a case document.
 *
 * @api-id API-CASE-06
 */
export async function startDocumentUpload(
  actor: Actor,
  input: RequestUploadInput,
): Promise<{ signedUrl: string; uploadRef: string }> {
  await requireCaseAccess(actor, input.caseId);
  const parsed = RequestUploadSchema.parse(input);

  const caseRow = await findCaseById(parsed.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  if (
    !PRODUCTION_STATUSES.includes(caseRow.status as CaseStatus) &&
    actor.kind !== "staff"
  ) {
    throw new CaseError("CASE_NOT_IN_PRODUCTION");
  }

  // Free file upload: staff only
  if (!parsed.requirementId && actor.kind !== "staff") {
    throw new CaseError("DOC_REQUIREMENT_NOT_FOUND");
  }

  const storagePath = `case/${parsed.caseId}/${Date.now()}-${parsed.filename}`;
  const result = await createSignedUploadUrl("case-documents", storagePath);

  return { signedUrl: result.signedUrl, uploadRef: result.path };
}

const ConfirmUploadSchema = z.object({
  caseId: z.string().uuid(),
  uploadRef: z.string().min(1),
  requirementId: z.string().uuid().nullable().optional(),
  partyId: z.string().uuid().nullable().optional(),
  originalFilename: z.string().min(1),
});

export type ConfirmUploadInput = z.infer<typeof ConfirmUploadSchema>;

/**
 * Step 2: confirm document upload and register it in the DB.
 *
 * @api-id API-CASE-07
 */
export async function confirmDocumentUpload(
  actor: Actor,
  input: ConfirmUploadInput,
): Promise<CaseDocumentRow> {
  await requireCaseAccess(actor, input.caseId);
  const parsed = ConfirmUploadSchema.parse(input);

  // Validate the uploaded object exists in storage
  const validated = await validateUploadedObject(
    "case-documents",
    parsed.uploadRef,
    "case-documents",
  );

  if (!validated.ok) {
    throw new CaseError("DOC_UPLOAD_INVALID");
  }

  // Derive filename and mime from the path (storage validates these)
  const derivedFilename = parsed.uploadRef.split("/").pop() ?? parsed.originalFilename;
  const ext = derivedFilename.split(".").pop()?.toLowerCase() ?? "";
  const extToMime: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    heic: "image/heic",
    webp: "image/webp",
  };
  const mimeType = extToMime[ext] ?? "application/octet-stream";

  // Replace chain head if any
  const prev = await findCurrentChainHead(
    parsed.caseId,
    parsed.requirementId ?? null,
    parsed.partyId ?? null,
  );

  const doc = await insertCaseDocument({
    case_id: parsed.caseId,
    required_document_type_id: parsed.requirementId ?? null,
    party_id: parsed.partyId ?? null,
    uploaded_by: actor.userId,
    storage_path: parsed.uploadRef,
    original_filename: parsed.originalFilename,
    mime_type: mimeType,
    size_bytes: 0, // size validated by storage, exact value not critical here
    status: "uploaded",
    replaces_document_id: prev?.id ?? null,
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason_i18n: null,
    correction_due_at: null,
  });

  // Mark previous as replaced
  if (prev) {
    await updateDocument(prev.id, { status: "replaced" });
  }

  appEvents.emit({
    type: "document.uploaded",
    payload: { caseId: parsed.caseId, documentId: doc.id },
    occurredAt: new Date(),
  });

  await writeTimeline({
    caseId: parsed.caseId,
    eventType: "document.uploaded",
    actorKind: actor.kind === "client" ? "client" : "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      en: "Document uploaded",
      es: "Documento subido",
    },
  });

  if (actor.kind === "staff") {
    await writeAudit(
      actor,
      "case.document.uploaded_by_staff",
      "case_documents",
      doc.id,
      { after: { caseId: parsed.caseId, documentId: doc.id } },
    );
  }

  return doc;
}

// ---------------------------------------------------------------------------
// reviewDocument — approve / reject (staff only)
// ---------------------------------------------------------------------------

const ReviewDocumentSchema = z.object({
  documentId: z.string().uuid(),
  verdict: z.enum(["approve", "reject"]),
  reason: z
    .object({ en: z.string(), es: z.string() })
    .nullable()
    .optional(),
  correctionDueAt: z.string().nullable().optional(),
});

export type ReviewDocumentInput = z.infer<typeof ReviewDocumentSchema>;

/**
 * Approves or rejects a case document with bilingual reason.
 *
 * @api-id API-CASE-14
 */
export async function reviewDocument(
  actor: Actor,
  input: ReviewDocumentInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = ReviewDocumentSchema.parse(input);

  const doc = await findDocumentById(parsed.documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");

  if (parsed.verdict === "approve") {
    const err = canTransitionDocument(
      doc.status as import("./domain").CaseDocumentStatus,
      "approved",
    );
    if (err) throw new CaseError("DOC_INVALID_STATE");

    await updateDocument(doc.id, {
      status: "approved",
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
    });

    appEvents.emit({
      type: "document.approved",
      payload: { caseId: doc.case_id, documentId: doc.id },
      occurredAt: new Date(),
    });

    await writeTimeline({
      caseId: doc.case_id,
      eventType: "document.approved",
      actorKind: "team",
      actorUserId: actor.userId,
      visibleToClient: true,
      titleI18n: {
        en: "Document approved",
        es: "Documento aprobado",
      },
    });
  } else {
    const err = canTransitionDocument(
      doc.status as import("./domain").CaseDocumentStatus,
      "rejected",
    );
    if (err) throw new CaseError("DOC_INVALID_STATE");

    if (!parsed.reason?.en && !parsed.reason?.es) {
      throw new CaseError("DOC_REJECTION_REASON_REQUIRED");
    }

    await updateDocument(doc.id, {
      status: "rejected",
      reviewed_by: actor.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason_i18n: (parsed.reason ?? null) as unknown as import("@/shared/database.types").Json,
      correction_due_at: parsed.correctionDueAt ?? null,
    });

    appEvents.emit({
      type: "document.rejected",
      payload: { caseId: doc.case_id, documentId: doc.id },
      occurredAt: new Date(),
    });

    await writeTimeline({
      caseId: doc.case_id,
      eventType: "document.rejected",
      actorKind: "team",
      actorUserId: actor.userId,
      visibleToClient: true,
      titleI18n: {
        en: "Document returned for correction",
        es: "Documento devuelto para corrección",
      },
    });
  }

  await writeAudit(
    actor,
    `case.document.${parsed.verdict}`,
    "case_documents",
    doc.id,
    { after: { verdict: parsed.verdict } },
  );
}

// ---------------------------------------------------------------------------
// changeCaseStatus — admin transitions
// ---------------------------------------------------------------------------

const ChangeStatusSchema = z.object({
  caseId: z.string().uuid(),
  target: z.enum([
    "active",
    "in_validation",
    "ready_for_delivery",
    "delivered",
    "completed",
    "cancelled",
    "on_hold",
  ]),
  note: z.string().nullable().optional(),
});

export type ChangeStatusInput = z.infer<typeof ChangeStatusSchema>;

/**
 * Transitions a case to a new status.
 *
 * Notes are required when transitioning to cancelled or on_hold.
 */
export async function changeCaseStatus(
  actor: Actor,
  input: ChangeStatusInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = ChangeStatusSchema.parse(input);

  const caseRow = await findCaseById(parsed.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const role = actor.role as import("./domain").StaffRole;
  const err = canTransitionCase(
    caseRow.status as CaseStatus,
    parsed.target,
    role,
  );
  if (err === "CASE_INVALID_TRANSITION") throw new CaseError("CASE_INVALID_TRANSITION");
  if (err === "CASE_FORBIDDEN_TRANSITION")
    throw new AuthzError("forbidden_module");

  if (
    (parsed.target === "cancelled" || parsed.target === "on_hold") &&
    !parsed.note
  ) {
    throw new CaseError("CASE_NOTE_REQUIRED");
  }

  const updates: TablesUpdate<"cases"> = {
    status: parsed.target,
  };
  if (parsed.target === "completed") {
    updates.completed_at = new Date().toISOString();
  }

  await updateCase(caseRow.id, updates);

  const visibleToClient = ["completed", "delivered"].includes(parsed.target);

  await writeTimeline({
    caseId: caseRow.id,
    eventType: "case.status_changed",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient,
    titleI18n: {
      en: `Case status changed to ${parsed.target}`,
      es: `Estado del caso cambiado a ${parsed.target}`,
    },
  });

  await writeAudit(
    actor,
    "case.status_changed",
    "cases",
    caseRow.id,
    { before: { status: caseRow.status }, after: { status: parsed.target } },
  );
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/**
 * Returns a list of cases for the actor's org.
 *
 * @api-id API-CASE-01 (list)
 */
export async function getCasesForClient(
  actor: Actor,
  filters: { status?: string; cursor?: string; limit?: number },
): Promise<CasesPage> {
  can(actor, "cases", "view");
  return listCases({
    orgId: actor.orgId,
    status: filters.status,
    cursor: filters.cursor,
    limit: filters.limit,
  });
}

/**
 * Returns a single case by ID.
 *
 * @api-id API-CASE-02
 */
export async function getCaseOverview(
  actor: Actor,
  caseId: string,
): Promise<CaseRow> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");
  return caseRow;
}

/**
 * Returns the requirement overrides for a case.
 *
 * @api-id API-CASE-05
 */
export async function getCaseRequirements(
  actor: Actor,
  caseId: string,
) {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const overrides = await getRequirementOverrides(caseId);
  const parties = await getCaseParties(caseId);

  return { caseRow, overrides, parties };
}

/**
 * Returns paginated timeline for a case.
 *
 * Clients only receive visible_to_client=true entries.
 *
 * @api-id API-CASE-04
 */
export async function getTimeline(
  actor: Actor,
  caseId: string,
  opts: { cursor?: string; limit?: number },
): Promise<TimelinePage> {
  await requireCaseAccess(actor, caseId);
  return getTimelinePage(caseId, {
    visibleToClientOnly: actor.kind === "client",
    cursor: opts.cursor,
    limit: opts.limit,
  });
}

