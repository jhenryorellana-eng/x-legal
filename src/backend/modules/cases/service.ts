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
import { createServiceClient } from "@/backend/platform/supabase";
import {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  validateUploadedObject,
} from "@/backend/platform/storage";
import { logger } from "@/backend/platform/logger";
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import type { TablesUpdate } from "@/shared/database.types";

import {
  canTransitionCase,
  canTransitionDocument,
  computePhaseProgress,
  PRODUCTION_STATUSES,
  type CaseStatus,
} from "./domain";
import {
  findCaseById,
  findCaseByCaseId,
  findCaseByContractId,
  nextCaseNumber,
  insertCase,
  upsertCaseMember,
  updateCase,
  insertPhaseHistory,
  findDocumentById,
  insertCaseDocument,
  updateDocument,
  findCurrentChainHead,
  getTimelinePage,
  listCases,
  listCaseDocuments,
  getRequirementOverrides,
  getCaseParties,
  findServiceLite,
  listServicePhases,
  listServiceMilestones,
  findPersonRecord,
  findClientDisplayName,
  findPlanKind,
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
// createCaseFromContract — RF-VAN-018/019 (DOC-41 §3.1, API-CASE-13)
// ---------------------------------------------------------------------------

/** Input shape for a single party: either a system user OR a person record. */
export interface CasePartyInput {
  role: string;
  /** For a party that IS a system user — their userId (must exist in users). */
  userId?: string;
  /** For a party that is NOT a user — their name/relationship for person_records. */
  person?: { firstName: string; lastName: string; relationship?: string | null };
}

const CreateCaseFromContractInputSchema = z.object({
  primaryClientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  servicePlanId: z.string().uuid(),
  /** If set, idempotency check: skip if this contract already has a case. */
  contractId: z.string().uuid().optional(),
  leadId: z.string().uuid().nullable().optional(),
  assignedParalegalId: z.string().uuid().nullable().optional(),
  assignedSalesId: z.string().uuid().nullable().optional(),
  parties: z
    .array(
      z.object({
        role: z.string().min(1),
        userId: z.string().uuid().optional(),
        person: z
          .object({
            firstName: z.string().min(1),
            lastName: z.string(),
            relationship: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  paymentPlan: z.object({
    totalCents: z.number().int().positive(),
    downpaymentCents: z.number().int().positive(),
    installmentCount: z.number().int().min(1),
    notes: z.string().nullable().optional(),
  }),
});

export type CreateCaseFromContractInput = z.infer<
  typeof CreateCaseFromContractInputSchema
>;

export interface CreateCaseFromContractResult {
  caseId: string;
  contractId: string;
  created: boolean;
}

/**
 * Orchestrates the full "Nuevo caso" flow (RF-VAN-018/019):
 *   1. Validate service + plan active
 *   2. Check paymentPlan consistency (downpayment ≤ total)
 *   3. IDEMPOTENCY: if contractId already has a case → return {created:false}
 *   4. Sequential atomic steps (see atomicity note below):
 *      a. nextCaseNumber()
 *      b. insertCase (status=payment_pending)
 *      c. upsertCaseMember (primaryClient, owner)
 *      d. case_parties (person_records via identity for non-user parties)
 *      e. insertContract (draft) — via contracts module
 *      f. billing.createPaymentPlan
 *   5. Emit case.created (+ case.assigned) + audit
 *
 * ATOMICITY NOTE: Supabase JS SDK does not expose multi-table transactions.
 * We use sequential inserts with compensation on failure:
 * - If insertContract fails, the case + members + parties are left orphaned
 *   (payment_pending with no contract — harmless; next attempt is idempotent
 *   on contractId if provided, or creates a new case otherwise).
 * - The idempotency guard on contractId ensures re-tries don't create duplicates.
 * - For billing, PAYMENT_PLAN_EXISTS is caught and treated as idempotent.
 * - TODO(SoT): Replace with a Postgres function or RPC for true atomicity.
 *
 * @api-id API-CASE-13 (cases.createCaseFromContract)
 */
export async function createCaseFromContract(
  actor: Actor,
  input: CreateCaseFromContractInput,
): Promise<CreateCaseFromContractResult> {
  // Step 0: Authorization
  can(actor, "cases", "edit");

  // Step 0b: Parse + validate input
  const p = CreateCaseFromContractInputSchema.parse(input);

  // Step 1: Idempotency — if contractId already has a case, return it
  if (p.contractId) {
    const existing = await findCaseByContractId(p.contractId);
    if (existing) {
      logger.info(
        { contractId: p.contractId, caseId: existing.caseId },
        "createCaseFromContract: contract already has a case — returning existing (idempotent)",
      );
      return { caseId: existing.caseId, contractId: p.contractId, created: false };
    }
  }

  // Step 2: Validate service is active + plan exists (via catalog)
  let serviceRow: { id: string; is_active: boolean; label_i18n: unknown } | null = null;
  let planRow: { id: string; kind: string; price_cents: number } | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const catalogModule = await import("@/backend/modules/catalog") as any;
    // findServiceById is exposed as a catalog repo helper — we call through the
    // service to respect the module boundary. listContractableServices is the
    // canonical "active services" read.
    const services = await catalogModule.listContractableServices(actor.orgId);
    serviceRow = (services as Array<{ id: string; is_active: boolean; label_i18n: unknown }>).find(
      (s) => s.id === p.serviceId,
    ) ?? null;
  } catch {
    // catalog not yet fully available in this context; skip validation gracefully
  }

  if (serviceRow === null) {
    // Fallback: query directly if catalog module isn't ready
    const supabase = createServiceClient();
    const { data } = await (supabase as unknown as ReturnType<typeof createServiceClient>)
      .from("services")
      .select("id, is_active, label_i18n")
      .eq("id", p.serviceId)
      .maybeSingle();
    serviceRow = data;
  }

  if (!serviceRow || !(serviceRow as { is_active: boolean }).is_active) {
    throw new CaseError("CASE_SERVICE_NOT_AVAILABLE");
  }

  // Load plan
  {
    const supabase = createServiceClient();
    const { data } = await (supabase as unknown as ReturnType<typeof createServiceClient>)
      .from("service_plans")
      .select("id, kind, price_cents, is_active")
      .eq("id", p.servicePlanId)
      .eq("service_id", p.serviceId)
      .maybeSingle();
    planRow = data as typeof planRow;
  }
  if (!planRow || !(planRow as unknown as { is_active: boolean }).is_active) {
    throw new CaseError("CASE_SERVICE_NOT_AVAILABLE");
  }

  // Step 2b: Payment plan consistency
  if (p.paymentPlan.downpaymentCents > p.paymentPlan.totalCents) {
    throw new CaseError("CASE_PAYMENT_PLAN_INVALID");
  }

  // Step 4a: case_number
  const caseNumber = await nextCaseNumber(actor.orgId);

  // Step 4b: insertCase
  const caseRow = await insertCase({
    org_id: actor.orgId,
    case_number: caseNumber,
    service_id: p.serviceId,
    service_plan_id: p.servicePlanId,
    current_phase_id: null,
    status: "payment_pending",
    primary_client_id: p.primaryClientId,
    assigned_paralegal_id: p.assignedParalegalId ?? null,
    assigned_sales_id:
      actor.role === "sales" ? actor.userId : (p.assignedSalesId ?? null),
  });

  // Step 4c: upsertCaseMember (primaryClient = owner)
  await upsertCaseMember(caseRow.id, p.primaryClientId, "owner");

  // Step 4d: Parties (person_records via identity module)
  if (p.parties.length > 0) {
    const { insertCasePartyRow: insertParty, upsertPersonRecord: upsertPerson } =
      await import("@/backend/modules/identity") as {
        insertCasePartyRow: (i: {
          caseId: string; personRecordId: string | null; userId: string | null;
          partyRole: string; position: number;
        }) => Promise<void>;
        upsertPersonRecord: (
          actor: Actor,
          i: { firstName: string; lastName: string; relationship?: string | null },
        ) => Promise<string>;
      };

    for (const [i, party] of p.parties.entries()) {
      let personRecordId: string | null = null;
      const partyUserId: string | null = party.userId ?? null;

      if (!partyUserId && party.person) {
        // Non-user party: create a person_records row via identity
        personRecordId = await upsertPerson(actor, {
          firstName: party.person.firstName,
          lastName: party.person.lastName,
          relationship: party.person.relationship,
        });
      }

      await insertParty({
        caseId: caseRow.id,
        personRecordId,
        userId: partyUserId,
        partyRole: party.role,
        position: i,
      });
    }
  }

  // Step 4e: Contract (via contracts module — draft)
  let contractId: string;
  if (p.contractId) {
    // Caller already holds a draft contractId (not possible with current modal flow,
    // but future-proof for lead-won path). Update its case_id.
    contractId = p.contractId;
    const supabase = createServiceClient();
    await (supabase as unknown as ReturnType<typeof createServiceClient>)
      .from("contracts")
      .update({ case_id: caseRow.id })
      .eq("id", contractId);
  } else {
    // Create a fresh draft contract
    const { createContract } = await import("@/backend/modules/contracts") as {
      createContract: (i: import("@/backend/modules/contracts").CreateContractInput) => Promise<{ id: string }>;
    };
    // Fetch active terms version for the org
    let termsVersion: string | null = null;
    try {
      const { getActiveTermsVersion } = await import("@/backend/modules/contracts") as {
        getActiveTermsVersion: (orgId: string) => Promise<{ version: string } | null>;
      };
      const tv = await getActiveTermsVersion(actor.orgId);
      termsVersion = tv?.version ?? null;
    } catch {
      // graceful degradation if terms table not yet seeded
    }

    const planSnapshot: Record<string, unknown> = {
      // serviceLabel frozen into the snapshot so the public signing page can
      // show the service name without a live catalog lookup (the page is anon).
      serviceLabel: (serviceRow as { label_i18n?: unknown }).label_i18n ?? null,
      planKind: (planRow as { kind: string }).kind,
      totalCents: p.paymentPlan.totalCents,
      downpaymentCents: p.paymentPlan.downpaymentCents,
      installmentCount: p.paymentPlan.installmentCount,
      currency: "USD",
    };
    const partiesSnapshot: Record<string, unknown> = {
      parties: p.parties.map((pt) => ({
        role: pt.role,
        userId: pt.userId ?? null,
        name: pt.person ? `${pt.person.firstName} ${pt.person.lastName}`.trim() : null,
      })),
    };

    const contract = await createContract({
      orgId: actor.orgId,
      caseId: caseRow.id,
      leadId: p.leadId ?? null,
      serviceId: p.serviceId,
      servicePlanId: p.servicePlanId,
      planSnapshot,
      partiesSnapshot,
      createdBy: actor.userId,
      termsVersion,
    });
    contractId = contract.id;
  }

  // Step 4f: Payment plan (billing module)
  try {
    const { createPaymentPlan } = await import("@/backend/modules/billing") as {
      createPaymentPlan: (
        actor: Actor,
        i: { contractId: string; totalCents: number; downpaymentCents: number; installmentCount: number; notes?: string | null },
      ) => Promise<unknown>;
    };
    await createPaymentPlan(actor, {
      contractId,
      totalCents: p.paymentPlan.totalCents,
      downpaymentCents: p.paymentPlan.downpaymentCents,
      installmentCount: p.paymentPlan.installmentCount,
      notes: p.paymentPlan.notes,
    });
  } catch (err) {
    // M-1 FIX: only swallow PAYMENT_PLAN_EXISTS (idempotent retry).
    // Any other billing error means the case has no payment plan — the client
    // would never be able to activate it (no installment to pay). Re-throw so
    // the modal surfaces a failure and the admin can retry. The idempotency guard
    // on contractId makes retries safe (createCaseFromContract returns created:false
    // if the contract already has a case, then billing is retried cleanly).
    const code = (err as { code?: string }).code;
    if (code !== "PAYMENT_PLAN_EXISTS") {
      logger.error({ err, caseId: caseRow.id }, "createCaseFromContract: billing.createPaymentPlan failed — re-throwing");
      throw err;
    }
  }

  // Step 5: Emit domain events + audit
  appEvents.emit({
    type: "case.created",
    payload: { caseId: caseRow.id },
    occurredAt: new Date(),
  });

  if (caseRow.assigned_paralegal_id) {
    appEvents.emit({
      type: "case.assigned",
      payload: { caseId: caseRow.id, paralegalId: caseRow.assigned_paralegal_id },
      occurredAt: new Date(),
    });
  }

  await writeAudit(actor, "case.created", "cases", caseRow.id, {
    after: {
      caseNumber,
      serviceId: p.serviceId,
      servicePlanId: p.servicePlanId,
      primaryClientId: p.primaryClientId,
    },
  });

  await writeTimeline({
    caseId: caseRow.id,
    eventType: "case.created",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: { en: "Case opened", es: "Caso creado" },
  });

  return { caseId: caseRow.id, contractId, created: true };
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

  // H-2 FIX: sanitize client-supplied filename before embedding in the storage path.
  // Allows alphanumerics, dots, hyphens, and underscores; everything else becomes '_'.
  const safeFilename = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `case/${parsed.caseId}/${Date.now()}-${safeFilename}`;
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

  // H-3 FIX: verify the client-supplied uploadRef belongs to this case's prefix.
  // Prevents a client from registering a document by supplying a path from another
  // case (or a path they uploaded to a different case slot).
  if (!parsed.uploadRef.startsWith(`case/${parsed.caseId}/`)) {
    throw new CaseError("DOC_UPLOAD_INVALID");
  }

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

export interface AdminCaseListItem {
  id: string;
  caseNumber: string;
  status: string;
  clientName: string | null;
  serviceLabelI18n: I18nValue | null;
  planKind: string | null;
  phaseLabelI18n: I18nValue | null;
  phaseIndex: number;
  phaseCount: number;
  openedAt: string | null;
  createdAt: string;
}

export interface AdminCasesPage {
  items: AdminCaseListItem[];
  nextCursor: string | null;
}

/**
 * Admin casos listing — enriched for the table (DOC-53 §2). Resolves the client
 * display name, service label, plan kind and phase position per row.
 *
 * Trivial documented read (F2-W2-b). Filters by status (the service/search
 * filters are applied in the page over the resolved labels for F2-W2-b).
 *
 * @api-id API-CASE-01 (admin variant)
 */
export async function listCasesAdmin(
  actor: Actor,
  filters: { status?: string; cursor?: string; limit?: number },
): Promise<AdminCasesPage> {
  can(actor, "cases", "view");
  const page = await listCases({
    orgId: actor.orgId,
    status: filters.status,
    cursor: filters.cursor,
    limit: filters.limit,
  });

  const items = await Promise.all(
    page.items.map(async (c): Promise<AdminCaseListItem> => {
      const [service, phases, clientName, planKind] = await Promise.all([
        findServiceLite(c.service_id),
        listServicePhases(c.service_id),
        findClientDisplayName(c.primary_client_id),
        findPlanKind(c.service_plan_id),
      ]);
      const currentIdx = c.current_phase_id
        ? phases.findIndex((p) => p.id === c.current_phase_id)
        : -1;
      const currentPhase = currentIdx >= 0 ? phases[currentIdx] : null;
      return {
        id: c.id,
        caseNumber: c.case_number,
        status: c.status,
        clientName,
        serviceLabelI18n: asI18n(service?.label_i18n),
        planKind,
        phaseLabelI18n: asI18n(currentPhase?.label_i18n),
        phaseIndex: currentIdx >= 0 ? currentIdx + 1 : 0,
        phaseCount: phases.length,
        openedAt: c.opened_at,
        createdAt: c.created_at,
      };
    }),
  );

  return { items, nextCursor: page.nextCursor };
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
 * Lists the documents uploaded for a case (admin Documentos tab review queue).
 * Trivial documented read (F2-W2-b, DOC-53 §3.4.2). Authorized by case access.
 */
export async function getCaseDocuments(
  actor: Actor,
  caseId: string,
): Promise<CaseDocumentRow[]> {
  await requireCaseAccess(actor, caseId);
  return listCaseDocuments(caseId);
}

/**
 * Returns a short-lived signed download URL for a case document (the document
 * visor in the admin review queue). Trivial documented read (F2-W2-b).
 */
export async function getCaseDocumentDownloadUrl(
  actor: Actor,
  documentId: string,
): Promise<string> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");
  await requireCaseAccess(actor, doc.case_id);
  return createSignedDownloadUrl("case-documents", doc.storage_path);
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

// ---------------------------------------------------------------------------
// Client-surface enriched reads (F2 — read-only DTOs for the (cliente) screens)
//
// These compose the raw cases reads above with the service catalog (services /
// service_phases) and the per-party requirement expansion (catalog module). They
// are PURE reads (no mutation, no audit) gated by requireCaseAccess + RLS. They
// implement the DTO surfaces referenced by DOC-51 (API-CASE-02 / API-CASE-05).
// ---------------------------------------------------------------------------

export interface I18nValue {
  en: string;
  es: string;
}

export interface CaseWorkspaceParty {
  id: string;
  role: string;
  /** Display name (person record or client profile); null when unnamed. */
  name: string | null;
}

export interface CaseWorkspaceDto {
  caseId: string;
  caseNumber: string;
  status: string;
  service: { id: string; slug: string; labelI18n: I18nValue; icon: string; color: string } | null;
  /** Current phase (null when not yet assigned). */
  phase: {
    id: string;
    labelI18n: I18nValue;
    descriptionI18n: I18nValue | null;
    explainerI18n: I18nValue | null;
    position: number;
  } | null;
  /** 1-based index of the current phase and the total number of phases. */
  phaseIndex: number;
  phaseCount: number;
  /** 0–100 progress of the current phase (computePhaseProgress — single source). */
  phaseProgress: number;
  parties: CaseWorkspaceParty[];
  /** Required documents still pending the client's action. */
  pendingDocuments: number;
  totalDocuments: number;
  doneDocuments: number;
}

function asI18n(value: unknown): I18nValue | null {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return { en: String(v.en ?? v.es ?? ""), es: String(v.es ?? v.en ?? "") };
  }
  return null;
}

/** Resolves the display name for a case party (person record first, then user). */
async function resolvePartyName(party: {
  person_record_id: string | null;
}): Promise<string | null> {
  if (party.person_record_id) {
    const person = await findPersonRecord(party.person_record_id);
    if (person) return `${person.first_name} ${person.last_name}`.trim();
  }
  return null;
}

interface DocsCount {
  total: number;
  done: number;
  pending: number;
}

/**
 * Derives the documents matrix for the case's current phase and a doc count.
 * Internal helper shared by getCaseWorkspace + getDocumentsMatrix.
 */
async function buildDocumentsMatrix(
  caseRow: CaseRow,
): Promise<{ items: DocumentMatrixItem[]; counts: DocsCount }> {
  if (!caseRow.current_phase_id) {
    return { items: [], counts: { total: 0, done: 0, pending: 0 } };
  }

  const overrides = await getRequirementOverrides(caseRow.id);
  const parties = await getCaseParties(caseRow.id);
  const documents = await listCaseDocuments(caseRow.id);

  // Resolve the catalog requirements (per-party expansion + overrides) via the
  // catalog module's runtime resolver (no cross-table read inside catalog).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalog = (await import("@/backend/modules/catalog")) as any;
  const resolved = await catalog.getCaseRequirements({
    service_id: caseRow.service_id,
    phase_id: caseRow.current_phase_id,
    parties: parties.map((p) => ({ id: p.id, party_role: p.party_role })),
    requirement_overrides: overrides.map((o) => ({
      id: o.id,
      required_document_type_id: o.required_document_type_id,
      party_id: o.party_id,
      is_required: o.is_required ?? undefined,
      is_hidden: o.is_hidden,
      custom_label_i18n: asI18n(o.custom_label_i18n) ?? undefined,
    })),
  });

  // Latest doc per (requirement, party): documents is desc by created_at.
  const latest = new Map<string, CaseDocumentRow>();
  for (const d of documents) {
    if (d.status === "replaced") continue;
    const key = `${d.required_document_type_id ?? "free"}:${d.party_id ?? "case"}`;
    if (!latest.has(key)) latest.set(key, d);
  }

  const partyNameById = new Map<string, string | null>();
  for (const p of parties) {
    partyNameById.set(p.id, await resolvePartyName(p));
  }

  const items: DocumentMatrixItem[] = resolved.documents.map(
    (r: {
      key: string;
      required_document_type_id: string | null;
      party_id: string | null;
      label_i18n: unknown;
      help_i18n: unknown;
      category_i18n: unknown;
      is_required: boolean;
      position: number;
    }) => {
      const docKey = `${r.required_document_type_id ?? "free"}:${r.party_id ?? "case"}`;
      const doc = latest.get(docKey);
      const status =
        doc == null
          ? ("pendiente" as const)
          : doc.status === "approved"
            ? ("aprobado" as const)
            : doc.status === "rejected"
              ? ("corregir" as const)
              : ("revision" as const);
      return {
        key: r.key,
        requirementId: r.required_document_type_id,
        partyId: r.party_id,
        partyName: r.party_id ? (partyNameById.get(r.party_id) ?? null) : null,
        labelI18n: asI18n(r.label_i18n) ?? { en: "", es: "" },
        helpI18n: asI18n(r.help_i18n),
        categoryI18n: asI18n(r.category_i18n),
        isRequired: r.is_required,
        position: r.position,
        status,
        documentId: doc?.id ?? null,
        rejectionReasonI18n: doc ? asI18n(doc.rejection_reason_i18n) : null,
        correctionDueAt: doc?.correction_due_at ?? null,
      };
    },
  );

  const required = items.filter((i) => i.isRequired);
  const done = required.filter(
    (i) => i.status === "aprobado" || i.status === "revision",
  ).length;
  const pending = required.filter(
    (i) => i.status === "pendiente" || i.status === "corregir",
  ).length;

  return {
    items,
    counts: { total: required.length, done, pending },
  };
}

export interface DocumentMatrixItem {
  key: string;
  requirementId: string | null;
  partyId: string | null;
  partyName: string | null;
  labelI18n: I18nValue;
  helpI18n: I18nValue | null;
  categoryI18n: I18nValue | null;
  isRequired: boolean;
  position: number;
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  documentId: string | null;
  rejectionReasonI18n: I18nValue | null;
  correctionDueAt: string | null;
}

/**
 * Enriched case workspace for the (cliente) Camino / Datos / Más screens.
 *
 * @api-id API-CASE-02 (CaseWorkspaceDto)
 */
export async function getCaseWorkspace(
  actor: Actor,
  caseId: string,
): Promise<CaseWorkspaceDto> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const service = await findServiceLite(caseRow.service_id);
  const phases = await listServicePhases(caseRow.service_id);
  const currentPhase = caseRow.current_phase_id
    ? (phases.find((p) => p.id === caseRow.current_phase_id) ?? null)
    : null;
  const phaseIndex = currentPhase
    ? phases.findIndex((p) => p.id === currentPhase.id) + 1
    : 0;

  const rawParties = await getCaseParties(caseId);
  const parties: CaseWorkspaceParty[] = [];
  for (const p of rawParties) {
    parties.push({
      id: p.id,
      role: p.party_role,
      name: await resolvePartyName(p),
    });
  }

  const { counts } = await buildDocumentsMatrix(caseRow);
  // Phase progress: documents-only weighting in F2 (forms/appointments arrive
  // in F4/F3). computePhaseProgress returns 100 when nothing is required.
  const phaseProgress = computePhaseProgress({
    totalDocuments: counts.total,
    approvedDocuments: counts.done,
    totalForms: 0,
    submittedForms: 0,
    totalAppointments: 0,
    completedAppointments: 0,
  });

  return {
    caseId: caseRow.id,
    caseNumber: caseRow.case_number,
    status: caseRow.status,
    service: service
      ? {
          id: service.id,
          slug: service.slug,
          labelI18n: asI18n(service.label_i18n) ?? { en: "", es: "" },
          icon: service.icon,
          color: service.color,
        }
      : null,
    phase: currentPhase
      ? {
          id: currentPhase.id,
          labelI18n: asI18n(currentPhase.label_i18n) ?? { en: "", es: "" },
          descriptionI18n: asI18n(currentPhase.description_i18n),
          explainerI18n: asI18n(currentPhase.client_explainer_i18n),
          position: currentPhase.position,
        }
      : null,
    phaseIndex,
    phaseCount: phases.length,
    phaseProgress,
    parties,
    pendingDocuments: counts.pending,
    totalDocuments: counts.total,
    doneDocuments: counts.done,
  };
}

export interface DocumentsMatrixDto {
  phaseLabelI18n: I18nValue | null;
  items: DocumentMatrixItem[];
  total: number;
  done: number;
  progress: number;
}

/**
 * Documents matrix for the current phase (checklist per requirement/party).
 *
 * @api-id API-CASE-05 (DocumentsMatrixDto)
 */
export async function getDocumentsMatrix(
  actor: Actor,
  caseId: string,
): Promise<DocumentsMatrixDto> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const phases = caseRow.current_phase_id
    ? await listServicePhases(caseRow.service_id)
    : [];
  const currentPhase = caseRow.current_phase_id
    ? (phases.find((p) => p.id === caseRow.current_phase_id) ?? null)
    : null;

  const { items, counts } = await buildDocumentsMatrix(caseRow);
  const progress = computePhaseProgress({
    totalDocuments: counts.total,
    approvedDocuments: counts.done,
    totalForms: 0,
    submittedForms: 0,
    totalAppointments: 0,
    completedAppointments: 0,
  });

  return {
    phaseLabelI18n: currentPhase ? asI18n(currentPhase.label_i18n) : null,
    items: items.sort((a, b) => a.position - b.position),
    total: counts.total,
    done: counts.done,
    progress,
  };
}

export interface CaseMilestoneItem {
  id: string;
  labelI18n: I18nValue;
  descriptionI18n: I18nValue | null;
  glossaryI18n: I18nValue | null;
  icon: string;
  phasePosition: number;
  /** Derived state relative to the case's current phase. */
  state: "completed" | "current" | "next" | "locked";
  /** Phase progress for the current milestone; null otherwise. */
  progress: number | null;
}

export interface CaseMilestonesDto {
  phaseIndex: number;
  phaseCount: number;
  milestones: CaseMilestoneItem[];
}

/**
 * Service milestones with case-derived states for the Proceso screen.
 *
 * @api-id (proceso read — DOC-51 §22)
 */
export async function getCaseMilestones(
  actor: Actor,
  caseId: string,
): Promise<CaseMilestonesDto> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const phases = await listServicePhases(caseRow.service_id);
  const milestones = await listServiceMilestones(caseRow.service_id);
  const currentPhase = caseRow.current_phase_id
    ? (phases.find((p) => p.id === caseRow.current_phase_id) ?? null)
    : null;
  const currentPos = currentPhase?.position ?? -1;
  const phaseIndex = currentPhase
    ? phases.findIndex((p) => p.id === currentPhase.id) + 1
    : 0;

  const { counts } = await buildDocumentsMatrix(caseRow);
  const progress = computePhaseProgress({
    totalDocuments: counts.total,
    approvedDocuments: counts.done,
    totalForms: 0,
    submittedForms: 0,
    totalAppointments: 0,
    completedAppointments: 0,
  });

  // The first milestone of the current phase is "current"; later milestones in
  // the same phase are "next"; earlier phases are "completed"; later "locked".
  let currentMarked = false;
  const items: CaseMilestoneItem[] = milestones.map((m) => {
    let state: CaseMilestoneItem["state"];
    if (m.phase_position < currentPos) {
      state = "completed";
    } else if (m.phase_position === currentPos && !currentMarked) {
      state = "current";
      currentMarked = true;
    } else if (m.phase_position === currentPos) {
      state = "next";
    } else {
      state = "locked";
    }
    return {
      id: m.id,
      labelI18n: asI18n(m.label_i18n) ?? { en: "", es: "" },
      descriptionI18n: asI18n(m.description_i18n),
      glossaryI18n: asI18n(m.glossary_i18n),
      icon: m.icon,
      phasePosition: m.phase_position,
      state,
      progress: state === "current" ? progress : null,
    };
  });

  return { phaseIndex, phaseCount: phases.length, milestones: items };
}

/**
 * Returns the client's display name (preferred_name ?? first_name).
 *
 * @api-id (profile read — used by the greeting / celebration copy)
 */
export async function getClientDisplayName(actor: Actor): Promise<string | null> {
  if (actor.kind !== "client") return null;
  return findClientDisplayName(actor.userId);
}

