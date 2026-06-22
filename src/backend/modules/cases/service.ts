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
// Note: enqueueJob is imported dynamically in confirmDocumentUpload to avoid
// pulling qstash (which requires env vars) into the module at load time.
// This keeps the cases/__tests__ working without real env vars.
import { writeAudit, appendCaseTimeline } from "@/backend/modules/audit";

import type { TablesUpdate } from "@/shared/database.types";
import { PRINCIPAL_ROLE_KEY } from "@/shared/constants/party-roles";
import { parseConditionOrNull, deriveFieldState, type QuestionCondition } from "@/shared/form-logic/conditions";

import {
  canTransitionCase,
  canTransitionDocument,
  computePhaseProgress,
  addWeeksToAnchorIso,
  validateAnswerTypes,
  PRODUCTION_STATUSES,
  type CaseStatus,
  type FormResponseStatus,
  type QuestionValidationRule,
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
  findFormResponse,
  findFormResponseById,
  listFormResponsesForCase,
  insertFormResponse,
  mergeFormAnswers,
  updateFormResponse,
  findApprovedDocumentBySlug,
  findDocumentExtractionByCaseDocId,
  findCompletedGenerationByFormSlug,
  findClientProfileForForm,
  findUserContactFields,
  listDocumentExtractionsForCase,
  findCasePrimaryClient,
  findFormDefinitionById,
  countUploadedDocsByCases,
  findCasesWithLawyerCorrections,
  findCasesWithGenerationFailed,
  findCasesWithRfeOverdue,
  type CaseRow,
  type CaseDocumentRow,
  type CaseFormResponseRow,
  type TimelinePage,
  type CasesPage,
} from "./repository";

// ---------------------------------------------------------------------------
// Lenient UUID schema — matches the Postgres `uuid` type (any 8-4-4-4-12 hex),
// NOT Zod's `.uuid()` which enforces RFC-4122 version/variant bits. The app must
// accept every identifier its own database stores and returns (incl. non-v4 /
// seeded placeholder IDs); requireCaseAccess + DB FKs are the real authority, not
// the textual format. `.uuid()` rejected DB-valid IDs in write paths while reads
// (no Zod) accepted them — a latent inconsistency this removes.
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const zUuid = z.string().regex(UUID_RE, "uuid");

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
      | "CASE_PARTY_ROLE_INVALID"
      | "DOC_NOT_FOUND"
      | "DOC_INVALID_STATE"
      | "DOC_REJECTION_REASON_REQUIRED"
      | "DOC_REQUIREMENT_NOT_FOUND"
      | "DOC_PARTY_NOT_ELIGIBLE"
      | "DOC_UPLOAD_INVALID"
      | "FORM_NOT_FOUND"
      | "FORM_VERSION_NOT_PUBLISHED"
      | "FORM_VERSION_MISMATCH"
      | "FORM_NOT_EDITABLE_BY_CLIENT"
      | "FORM_NOT_SUBMITTABLE"
      | "FORM_VALIDATION_FAILED"
      | "FORM_PDF_BLOCKED"
      | "FORM_PDF_REQUIRED_MISSING"
      | "FORM_RESPONSE_NOT_FOUND"
      | "FORM_PROFILE_FIELD_FORBIDDEN",
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
  primaryClientId: zUuid,
  serviceId: zUuid,
  servicePlanId: zUuid,
  /** If set, idempotency check: skip if this contract already has a case. */
  contractId: zUuid.optional(),
  leadId: zUuid.nullable().optional(),
  assignedParalegalId: zUuid.nullable().optional(),
  assignedSalesId: zUuid.nullable().optional(),
  parties: z
    .array(
      z.object({
        role: z.string().min(1),
        userId: zUuid.optional(),
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
    // Fallback: query directly if catalog module isn't ready. Scope to the
    // actor's org — the service client bypasses RLS, so a missing org filter
    // would let a case be created against another org's service.
    const supabase = createServiceClient();
    const { data } = await (supabase as unknown as ReturnType<typeof createServiceClient>)
      .from("services")
      .select("id, is_active, label_i18n")
      .eq("id", p.serviceId)
      .eq("org_id", actor.orgId)
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

  // Step 4d: Parties. The applicant is auto-added as the principal party (role
  // 'petitioner', position 0); the additional parties from the modal are
  // validated against the service's declared roles and inserted after.
  {
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

    // Validate additional roles ⊆ the service's declared roles (clean error
    // instead of a raw DB constraint violation). The principal role is implicit
    // and must NOT appear among the additional parties.
    if (p.parties.length > 0) {
      let allowed: Set<string>;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const catalogModule = await import("@/backend/modules/catalog") as any;
        const roles = await catalogModule.listServicePartyRoles(p.serviceId);
        allowed = new Set((roles as Array<{ role_key: string }>).map((r) => r.role_key));
      } catch {
        // Transient catalog failure — surface a retryable error, NOT a false
        // "invalid role" (the roles may well be valid; we just couldn't load them).
        throw new CaseError("CASE_SERVICE_NOT_AVAILABLE");
      }
      for (const party of p.parties) {
        if (party.role === PRINCIPAL_ROLE_KEY || !allowed.has(party.role)) {
          throw new CaseError("CASE_PARTY_ROLE_INVALID", { role: party.role });
        }
      }
    }

    // Principal applicant first (the primary client).
    await insertParty({
      caseId: caseRow.id,
      personRecordId: null,
      userId: p.primaryClientId,
      partyRole: PRINCIPAL_ROLE_KEY,
      position: 0,
    });

    // Additional parties (person_records via identity), positions 1..N.
    for (const [i, party] of p.parties.entries()) {
      let personRecordId: string | null = null;
      const partyUserId: string | null = party.userId ?? null;

      if (!partyUserId && party.person) {
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
        position: i + 1,
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
  await appEvents.emitAndWait({
    type: "case.created",
    payload: { caseId: caseRow.id },
    occurredAt: new Date(),
  });

  if (caseRow.assigned_paralegal_id) {
    await appEvents.emitAndWait({
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
  caseId: zUuid,
  requirementId: zUuid.nullable().optional(),
  partyId: zUuid.nullable().optional(),
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
  caseId: zUuid,
  uploadRef: z.string().min(1),
  requirementId: zUuid.nullable().optional(),
  partyId: zUuid.nullable().optional(),
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

  // Hook F4: auto-enqueue extraction if the requirement has ai_extract=true (DOC-26 §2.2)
  if (parsed.requirementId) {
    try {
      const supabase = createServiceClient();
      const { data: rdt } = await supabase
        .from("required_document_types")
        .select("ai_extract")
        .eq("id", parsed.requirementId)
        .maybeSingle();

      if (rdt?.ai_extract) {
        const { enqueueJob } = await import("@/backend/platform/qstash");
        await enqueueJob(
          {
            jobKey: "extract-document",
            entityId: doc.id,
            attempt: 1,
            // Canonical dedupe key (DOC-26 §4.2) — no version suffix; reprocess uses :retry-N.
            dedupeId: `extract-document:${doc.id}`,
            caseDocumentId: doc.id,
            orgId: actor.orgId,
          },
          { retries: 3 },
        );
        logger.info(
          { caseDocumentId: doc.id, requirementId: parsed.requirementId },
          "cases: enqueued extract-document job (ai_extract=true)",
        );
      }
    } catch (err) {
      // Non-fatal: extraction is async assistance, never blocks the upload confirmation
      logger.warn({ err, docId: doc.id }, "cases: failed to enqueue extract-document — continuing");
    }
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
  documentId: zUuid,
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

    await appEvents.emitAndWait({
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

    await appEvents.emitAndWait({
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
  caseId: zUuid,
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
  // Client-only endpoint: a client lists their OWN cases. can() is staff-only
  // (it throws wrong_kind for clients — DOC-22 §5.2), so it must NOT be used
  // here. Row scoping to the client's cases is enforced by RLS (case_members);
  // listCases runs through the user-scoped server client. Staff use
  // listCasesAdmin instead.
  if (actor.kind !== "client") {
    throw new AuthzError("wrong_kind");
  }
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

export interface CaseTimelineCita {
  sequenceNumber: number;
  durationMinutes: number;
  kind: string;
  weekOffset: number;
  phaseLabelI18n: I18nValue | null;
  citaLabelI18n: I18nValue | null;
  /** Estimated date (ISO) for this cita, or null when the case has not started. */
  estDate: string | null;
}

export interface CaseTimelineDto {
  /** True once the case is active (opened_at set) — otherwise dates are null. */
  started: boolean;
  anchorDate: string | null;
  citas: CaseTimelineCita[];
  processingWeeks: number;
  totalWeeks: number;
  /** Estimated delivery date of the final expediente (ISO), or null if not started. */
  estimatedDeliveryDate: string | null;
}

/**
 * Client-facing cronograma + estimated expediente delivery date. Reads the
 * service's appointment schedule (catalog.getServicecronograma) and anchors it
 * on cases.opened_at (set when the case becomes active / downpayment confirmed).
 * Purely informational — dates are estimates, never a commitment, and recompute
 * from opened_at. Returns null dates while the case is still payment_pending.
 *
 * @api-id API-CASE-25 (cronograma)
 */
export async function getCaseTimeline(
  actor: Actor,
  caseId: string,
): Promise<CaseTimelineDto> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const catalog = (await import("@/backend/modules/catalog")) as any;
  const cron = await catalog.getServiceCronograma(caseRow.service_id);

  const anchorIso: string | null = caseRow.opened_at ?? null;
  const citas: CaseTimelineCita[] = (cron.citas ?? []).map(
    (c: {
      sequenceNumber: number;
      durationMinutes: number;
      kind: string;
      weekOffset: number;
      phaseLabelI18n: unknown;
      labelI18n: unknown;
    }) => ({
      sequenceNumber: c.sequenceNumber,
      durationMinutes: c.durationMinutes,
      kind: c.kind,
      weekOffset: c.weekOffset,
      phaseLabelI18n: asI18n(c.phaseLabelI18n),
      citaLabelI18n: asI18n(c.labelI18n),
      estDate: addWeeksToAnchorIso(anchorIso, c.weekOffset),
    }),
  );

  return {
    started: anchorIso != null,
    anchorDate: anchorIso,
    citas,
    processingWeeks: cron.processingWeeks ?? 0,
    totalWeeks: cron.totalWeeks ?? 0,
    estimatedDeliveryDate: addWeeksToAnchorIso(anchorIso, cron.totalWeeks ?? 0),
  };
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

// ---------------------------------------------------------------------------
// Form runtime — F4-Ola3 (API-CASE-16 through API-CASE-19)
// ---------------------------------------------------------------------------

/**
 * Resolves question definitions for an automation version.
 * Fetches groups then questions for each group.
 */
async function getQuestionsForVersion(
  versionId: string,
): Promise<QuestionValidationRule[]> {
  const { listQuestionGroups: listGroups, listQuestions } = await import(
    "@/backend/modules/catalog" as string
  ) as {
    listQuestionGroups?: (versionId: string) => Promise<Array<{ id: string }>>;
    listQuestions?: (groupId: string) => Promise<QuestionValidationRule[]>;
  };

  if (!listGroups || !listQuestions) {
    // catalog module not yet exposing these — degrade gracefully
    return [];
  }

  const groups = await listGroups(versionId);
  const questionArrays = await Promise.all(groups.map((g) => listQuestions(g.id)));
  return questionArrays.flat();
}

/**
 * Resolves a single answer value based on the question's source.
 *
 * Source routing (DOC-41 §3.10):
 * - client_answer      → answers[q.id] from the saved response
 * - document_extraction → approved doc by slug → document_extractions.payload @ json_path
 * - generation_output  → completed generation by form_slug → output @ output_path
 * - profile            → client profile fields (PII decrypted LOCALLY, never leaves server)
 *
 * PII fields are resolved locally via platform/crypto — they NEVER go to AI (DOC-74 §7.1).
 *
 * @api-id (helper — consumed by getFormForClient and generateFilledPdf)
 */
export async function resolveBySource(
  question: {
    id: string;
    source: string;
    source_ref: unknown;
  },
  responseAnswers: Record<string, unknown>,
  caseId: string,
  partyId: string | null,
): Promise<unknown> {
  const source = question.source;
  const sourceRef = (question.source_ref ?? {}) as Record<string, unknown>;

  if (source === "client_answer") {
    return responseAnswers[question.id] ?? null;
  }

  if (source === "document_extraction") {
    const documentSlug = sourceRef["document_slug"] as string | undefined;
    const jsonPath = sourceRef["json_path"] as string | undefined;
    if (!documentSlug) return null;

    const approvedDoc = await findApprovedDocumentBySlug(caseId, documentSlug, partyId);
    if (!approvedDoc) return null;

    const extraction = await findDocumentExtractionByCaseDocId(approvedDoc.id);
    if (!extraction || extraction.status !== "completed") return null;

    if (!jsonPath) return extraction.payload;

    // Navigate JSON path (dot-notation, no array support needed for V2)
    const parts = jsonPath.split(".");
    let current: unknown = extraction.payload;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current ?? null;
  }

  if (source === "generation_output") {
    const formSlug = sourceRef["form_slug"] as string | undefined;
    const outputPath = sourceRef["output_path"] as string | undefined;
    if (!formSlug) return null;

    const run = await findCompletedGenerationByFormSlug(caseId, formSlug, partyId);
    if (!run) return null;

    if (!outputPath) return run.output;

    const parts = outputPath.split(".");
    let current: unknown = run.output;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current ?? null;
  }

  if (source === "profile") {
    const profileField = sourceRef["profile_field"] as string | undefined;
    if (!profileField) return null;

    // Whitelist check — PROFILE_SOURCE_FIELDS (DOC-40 §2.7 / DOC-74 §7.1)
    const { PROFILE_SOURCE_FIELDS } = await import("@/shared/constants/profile-fields");
    if (!(PROFILE_SOURCE_FIELDS as readonly string[]).includes(profileField)) {
      logger.warn({ profileField }, "resolveBySource: forbidden profile field attempted");
      throw new CaseError("FORM_PROFILE_FIELD_FORBIDDEN", { field: profileField });
    }

    // Find primary client for the case
    const primaryClientId = await findCasePrimaryClient(caseId);
    if (!primaryClientId) return null;

    // PII resolution is LOCAL — never forwarded to AI (DOC-74 §7.1)
    if (profileField.startsWith("pii.")) {
      const piiKey = profileField.slice(4); // e.g. "ssn"
      const profile = await findClientProfileForForm(primaryClientId);
      if (!profile) return null;

      const piiEncrypted = profile.pii_encrypted as Record<string, unknown> | null;
      if (!piiEncrypted || !piiEncrypted[piiKey]) return null;

      const { decryptPiiField } = await import("@/backend/platform/crypto");
      try {
        return decryptPiiField(piiEncrypted[piiKey] as import("@/backend/platform/crypto").EncryptedField);
      } catch {
        logger.warn({ piiKey }, "resolveBySource: PII decryption failed — returning null");
        return null;
      }
    }

    // Address sub-fields
    if (profileField.startsWith("address.")) {
      const addrKey = profileField.slice(8);
      const profile = await findClientProfileForForm(primaryClientId);
      const address = (profile?.address ?? {}) as Record<string, unknown>;
      return address[addrKey] ?? null;
    }

    // Contact fields on users table
    if (profileField === "phone_e164" || profileField === "email") {
      const user = await findUserContactFields(primaryClientId);
      return profileField === "phone_e164" ? (user?.phone_e164 ?? null) : (user?.email ?? null);
    }

    // Standard profile fields
    const profile = await findClientProfileForForm(primaryClientId);
    if (!profile) return null;
    return (profile as unknown as Record<string, unknown>)[profileField] ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Wizard shape types
// ---------------------------------------------------------------------------

export interface FormQuestionDto {
  id: string;
  groupId: string;
  questionI18n: I18nValue;
  helpI18n: I18nValue | null;
  fieldType: string;
  options: Array<{ value: string; labelI18n: I18nValue }> | null;
  isRequired: boolean;
  position: number;
  source: string;
  /**
   * Validation rules from `form_questions.validation` jsonb ({regex?, min?, max?}).
   * Consumed by the client wizard to GENERATE its Zod schema (DOC-50 §6.2) — this
   * mirrors the same jsonb the server enforces in `validateAnswerTypes` (the
   * server is the source of truth; the client schema is UX courtesy).
   */
  validation: { regex?: string; min?: number; max?: number } | null;
  /** Pre-filled value from resolveBySource (null for client_answer). */
  prefillValue: unknown;
  /** Whether this value comes from a non-client source (pre-filled, client may not edit). */
  isPrefilled: boolean;
  /** Current answer saved in the response (null if none yet). */
  currentAnswer: unknown;
  /** Conditional visibility (show/lock/require). NULL = unconditional. */
  condition: QuestionCondition | null;
}

export interface FormGroupDto {
  id: string;
  titleI18n: I18nValue;
  position: number;
  questions: FormQuestionDto[];
}

export interface FormForClientDto {
  responseId: string | null;
  formDefinitionId: string;
  /** form_definitions.label_i18n — the wizard header title. */
  labelI18n: I18nValue;
  /** 'pdf_automation' | 'ai_letter' (Mi Historia is ai_letter). */
  kind: string;
  /** True when the form is answered once per party (DOC-51 §21 list). */
  isPerParty: boolean;
  versionId: string | null;
  status: string | null;
  submittedAt: string | null;
  filledPdfPath: string | null;
  filledBy: string;
  /** Language of the official PDF/AcroForm (pdf_automation). Drives answer
   *  translation when the client locale differs. Defaults 'en'. */
  sourceLanguage: "en" | "es";
  groups: FormGroupDto[];
}

/**
 * Resolves the published form version + questions + pre-filled values for the wizard.
 *
 * @api-id (read — consumed by wizard UI)
 */
export async function getFormForClient(
  actor: Actor,
  input: { caseId: string; formDefinitionId: string; partyId?: string | null },
): Promise<FormForClientDto> {
  await requireCaseAccess(actor, input.caseId);

  const formDef = await findFormDefinitionById(input.formDefinitionId);
  if (!formDef || !formDef.is_active) throw new CaseError("FORM_NOT_FOUND");

  // Clients cannot see staff-only forms
  if (actor.kind === "client" && formDef.filled_by === "staff") {
    throw new CaseError("FORM_NOT_EDITABLE_BY_CLIENT");
  }

  const partyId = input.partyId ?? null;
  const existingResponse = await findFormResponse(input.caseId, input.formDefinitionId, partyId);

  // Get published version (for pdf_automation)
  const catalog = await import("@/backend/modules/catalog" as string) as {
    getPublishedAutomationVersion: (id: string) => Promise<{ id: string; detected_fields: unknown; source_language?: string } | null>;
    listQuestionGroups: (versionId: string) => Promise<Array<{ id: string; title_i18n: unknown; position: number }>>;
    listQuestions: (groupId: string) => Promise<Array<{
      id: string;
      group_id: string;
      question_i18n: unknown;
      help_i18n: unknown;
      field_type: string;
      options: unknown;
      is_required: boolean;
      position: number;
      source: string;
      source_ref: unknown;
      validation: unknown;
      condition: unknown;
    }>>;
  };

  const published = await catalog.getPublishedAutomationVersion(input.formDefinitionId);

  const versionId = existingResponse?.automation_version_id ?? published?.id ?? null;

  let groups: FormGroupDto[] = [];

  if (versionId && catalog.listQuestionGroups && catalog.listQuestions) {
    const rawGroups = await catalog.listQuestionGroups(versionId);
    const answers = (existingResponse?.answers ?? {}) as Record<string, unknown>;

    groups = await Promise.all(rawGroups.map(async (g) => {
      const rawQuestions = await catalog.listQuestions(g.id);

      const questions: FormQuestionDto[] = await Promise.all(rawQuestions.map(async (q) => {
        const isPrefilled = q.source !== "client_answer";
        let prefillValue: unknown = null;

        if (isPrefilled) {
          try {
            prefillValue = await resolveBySource(
              { id: q.id, source: q.source, source_ref: q.source_ref },
              answers,
              input.caseId,
              partyId,
            );
          } catch {
            // Non-fatal — show as empty
            prefillValue = null;
          }
        }

        const opts = q.options as Array<{ value: string; label_i18n: unknown }> | null;
        const rawVal = q.validation as { regex?: string; min?: number; max?: number } | null | undefined;
        const validation =
          rawVal && (rawVal.regex !== undefined || rawVal.min !== undefined || rawVal.max !== undefined)
            ? {
                ...(rawVal.regex !== undefined ? { regex: rawVal.regex } : {}),
                ...(rawVal.min !== undefined ? { min: rawVal.min } : {}),
                ...(rawVal.max !== undefined ? { max: rawVal.max } : {}),
              }
            : null;
        return {
          id: q.id,
          groupId: g.id,
          questionI18n: asI18n(q.question_i18n) ?? { en: "", es: "" },
          helpI18n: asI18n(q.help_i18n),
          fieldType: q.field_type,
          options: opts
            ? opts.map((o) => ({ value: o.value, labelI18n: asI18n(o.label_i18n) ?? { en: o.value, es: o.value } }))
            : null,
          isRequired: q.is_required,
          position: q.position,
          source: q.source,
          validation,
          prefillValue,
          isPrefilled,
          currentAnswer: answers[q.id] ?? null,
          condition: parseConditionOrNull(q.condition),
        };
      }));

      return {
        id: g.id,
        titleI18n: asI18n(g.title_i18n) ?? { en: "", es: "" },
        position: g.position,
        questions: questions.sort((a, b) => a.position - b.position),
      };
    }));

    groups.sort((a, b) => a.position - b.position);
  }

  return {
    responseId: existingResponse?.id ?? null,
    formDefinitionId: input.formDefinitionId,
    labelI18n: asI18n(formDef.label_i18n) ?? { en: "", es: "" },
    kind: formDef.kind,
    isPerParty: formDef.is_per_party,
    versionId,
    status: existingResponse?.status ?? null,
    submittedAt: existingResponse?.submitted_at ?? null,
    filledPdfPath: existingResponse?.filled_pdf_path ?? null,
    filledBy: formDef.filled_by,
    sourceLanguage: (published?.source_language === "es" ? "es" : "en"),
    groups,
  };
}

// ---------------------------------------------------------------------------
// Forms LIST for the client (DOC-51 §21 list view)
// ---------------------------------------------------------------------------

export interface ClientFormListItem {
  formDefinitionId: string;
  labelI18n: I18nValue;
  /** 'ai_letter' | 'pdf_automation'. */
  kind: string;
  /** null (case-level) or a party id (one entry per party when is_per_party). */
  partyId: string | null;
  /** Party display name when this is a per-party entry (e.g. "Mateo"). */
  partyName: string | null;
  /** null (untouched) | 'draft' | 'submitted' | 'approved' | … */
  status: string | null;
  position: number;
}

/**
 * Lists the client-facing forms of the case's current phase (DOC-51 §21).
 *
 * Only `filled_by ∈ {client, both}` forms appear (staff-only forms are never
 * exposed, RF-CLI-031). A per-party form yields one entry per case party with
 * the party name visible. Each entry carries the response status so the list can
 * show the "Borrador"/"Enviado" pill.
 *
 * Trivial read (follows the getCaseWorkspace pattern) — the gates and RLS behind
 * `requireCaseAccess` are the real authority.
 *
 * @api-id (read — consumed by the forms list UI)
 */
export async function getClientFormsForCase(
  actor: Actor,
  caseId: string,
): Promise<ClientFormListItem[]> {
  await requireCaseAccess(actor, caseId);

  const caseRow = await findCaseById(caseId);
  if (!caseRow || !caseRow.current_phase_id) return [];

  const catalog = (await import("@/backend/modules/catalog" as string)) as {
    listFormDefinitions?: (phaseId: string) => Promise<
      Array<{
        id: string;
        label_i18n: unknown;
        kind: string;
        filled_by: string;
        is_per_party: boolean;
        position: number;
      }>
    >;
  };
  if (!catalog.listFormDefinitions) return [];

  const defs = await catalog.listFormDefinitions(caseRow.current_phase_id);
  const clientDefs = defs.filter((d) => d.filled_by === "client" || d.filled_by === "both");

  const parties = await getCaseParties(caseId);
  const items: ClientFormListItem[] = [];

  for (const d of clientDefs) {
    const label = asI18n(d.label_i18n) ?? { en: "", es: "" };
    if (d.is_per_party && parties.length > 0) {
      for (const p of parties) {
        const resp = await findFormResponse(caseId, d.id, p.id);
        items.push({
          formDefinitionId: d.id,
          labelI18n: label,
          kind: d.kind,
          partyId: p.id,
          partyName: await resolvePartyName(p),
          status: resp?.status ?? null,
          position: d.position,
        });
      }
    } else {
      const resp = await findFormResponse(caseId, d.id, null);
      items.push({
        formDefinitionId: d.id,
        labelI18n: label,
        kind: d.kind,
        partyId: null,
        partyName: null,
        status: resp?.status ?? null,
        position: d.position,
      });
    }
  }

  return items.sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// Staff form-response review list (RF-ADM-010 / DOC-53 §3.4.3)
// ---------------------------------------------------------------------------

export interface StaffFormResponseItem {
  responseId: string;
  formDefinitionId: string;
  labelI18n: I18nValue;
  /** 'pdf_automation' | 'ai_letter'. */
  kind: string;
  /** 'client' | 'staff' | 'both' — client-filled forms need approval before PDF. */
  filledBy: string;
  /** 'draft' | 'submitted' | 'approved'. */
  status: string;
  partyId: string | null;
  partyName: string | null;
  /** Storage path of the generated filled PDF (null until generated). */
  filledPdfPath: string | null;
  submittedAt: string | null;
}

/**
 * Lists every form RESPONSE of a case for staff review (RF-ADM-010). Unlike
 * getClientFormsForCase (which lists the client-facing form catalog of the
 * current phase), this returns the actual response rows — with their id, status
 * and generated-PDF path — so staff can approve and generate the filled PDF.
 *
 * Trivial read; requireCaseAccess + RLS are the authority.
 *
 * @api-id (read — consumed by the staff Formularios screen)
 */
export async function getCaseFormResponsesForStaff(
  actor: Actor,
  caseId: string,
): Promise<StaffFormResponseItem[]> {
  await requireCaseAccess(actor, caseId);

  const [rows, parties] = await Promise.all([
    listFormResponsesForCase(caseId),
    getCaseParties(caseId),
  ]);

  const partyNameById = new Map<string, string | null>();
  for (const p of parties) partyNameById.set(p.id, await resolvePartyName(p));

  const items = await Promise.all(
    rows.map(async (r) => {
      const formDef = await findFormDefinitionById(r.form_definition_id);
      return {
        responseId: r.id,
        formDefinitionId: r.form_definition_id,
        labelI18n: asI18n(formDef?.label_i18n) ?? { en: "", es: "" },
        kind: formDef?.kind ?? "",
        filledBy: formDef?.filled_by ?? "staff",
        status: r.status,
        partyId: r.party_id,
        partyName: r.party_id ? (partyNameById.get(r.party_id) ?? null) : null,
        filledPdfPath: r.filled_pdf_path,
        submittedAt: r.submitted_at,
      } satisfies StaffFormResponseItem;
    }),
  );

  // Most relevant first: submitted (await review) → approved → draft.
  const rank: Record<string, number> = { submitted: 0, approved: 1, draft: 2 };
  return items.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
}

// ---------------------------------------------------------------------------
// API-CASE-16: saveFormDraft
// ---------------------------------------------------------------------------

const SaveFormDraftSchema = z.object({
  caseId: zUuid,
  formDefinitionId: zUuid,
  partyId: zUuid.nullable().optional(),
  patch: z.record(z.string(), z.unknown()),
});

export type SaveFormDraftInput = z.infer<typeof SaveFormDraftSchema>;

/**
 * Creates or updates a form draft with a partial patch of answers.
 * Merge per-key: only keys present in patch are updated (RF-DIA-023).
 * Freezes automation_version_id to the published version on first create.
 * FORM_VERSION_MISMATCH if patch keys don't belong to the saved version.
 *
 * @api-id API-CASE-16
 */
export async function saveFormDraft(
  actor: Actor,
  input: SaveFormDraftInput,
): Promise<CaseFormResponseRow> {
  await requireCaseAccess(actor, input.caseId);
  const parsed = SaveFormDraftSchema.parse(input);
  const partyId = parsed.partyId ?? null;

  const formDef = await findFormDefinitionById(parsed.formDefinitionId);
  if (!formDef || !formDef.is_active) throw new CaseError("FORM_NOT_FOUND");

  // Clients cannot edit staff-only forms
  if (actor.kind === "client" && formDef.filled_by === "staff") {
    throw new CaseError("FORM_NOT_EDITABLE_BY_CLIENT");
  }

  let response = await findFormResponse(parsed.caseId, parsed.formDefinitionId, partyId);

  if (!response) {
    // First save: freeze the published version
    const catalog = await import("@/backend/modules/catalog" as string) as {
      getPublishedAutomationVersion: (id: string) => Promise<{ id: string } | null>;
    };
    const published = await catalog.getPublishedAutomationVersion(parsed.formDefinitionId);

    if (formDef.kind === "pdf_automation" && !published) {
      throw new CaseError("FORM_VERSION_NOT_PUBLISHED");
    }

    response = await insertFormResponse({
      case_id: parsed.caseId,
      form_definition_id: parsed.formDefinitionId,
      automation_version_id: published?.id ?? null,
      party_id: partyId,
      status: "draft",
    });
  } else {
    // Existing response: only draft can be edited
    if (response.status !== "draft") {
      throw new CaseError("FORM_NOT_SUBMITTABLE");
    }
  }

  // Validate answer types + check keys belong to the frozen version (FORM_VERSION_MISMATCH)
  if (response.automation_version_id && Object.keys(parsed.patch).length > 0) {
    const questions = await getQuestionsForVersion(response.automation_version_id);

    if (questions.length > 0) {
      const validQuestionIds = new Set(questions.map((q) => q.id));
      const unknownKeys = Object.keys(parsed.patch).filter((k) => !validQuestionIds.has(k));
      if (unknownKeys.length > 0) {
        throw new CaseError("FORM_VERSION_MISMATCH", { unknownKeys });
      }

      // Draft autosave: type-check only the answers in this patch — never enforce
      // required-ness on fields the user hasn't reached yet (that's submit's job).
      const errors = validateAnswerTypes(parsed.patch, questions, false);
      if (errors.length > 0) {
        throw new CaseError("FORM_VALIDATION_FAILED", { errors });
      }
    }
  }

  // Merge patch into existing answers
  await mergeFormAnswers(response.id, parsed.patch);

  const updated = await findFormResponseById(response.id);
  if (!updated) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  return updated;
}

// ---------------------------------------------------------------------------
// API-CASE-17: submitFormResponse
// ---------------------------------------------------------------------------

const SubmitFormResponseSchema = z.object({
  caseId: zUuid,
  formDefinitionId: zUuid,
  partyId: zUuid.nullable().optional(),
  /** Client-side best-effort translation of textual answers to the form's
   *  source language (Chrome Translator API). Keyed by question id. */
  answersTranslated: z.record(z.string(), z.string()).optional(),
  translationStatus: z.enum(["none", "partial", "pending_server", "done"]).optional(),
});

export type SubmitFormResponseInput = z.infer<typeof SubmitFormResponseSchema>;

/**
 * Submits a form response: validates all required answers server-side, transitions
 * draft → submitted.
 *
 * @api-id API-CASE-17
 */
export async function submitFormResponse(
  actor: Actor,
  input: SubmitFormResponseInput,
): Promise<CaseFormResponseRow> {
  await requireCaseAccess(actor, input.caseId);
  const parsed = SubmitFormResponseSchema.parse(input);
  const partyId = parsed.partyId ?? null;

  const response = await findFormResponse(parsed.caseId, parsed.formDefinitionId, partyId);
  if (!response || response.status !== "draft") {
    throw new CaseError("FORM_NOT_SUBMITTABLE");
  }

  // Full server-side validation (RF-TRX-027 — client is never the source of truth).
  // A pdf_automation form ALWAYS resolves to ≥1 question; an empty result means the
  // version couldn't be resolved (catalog read failed / version unpublished) — fail
  // CLOSED rather than silently submitting an unvalidated response.
  if (response.automation_version_id) {
    const questions = await getQuestionsForVersion(response.automation_version_id);
    if (questions.length === 0) {
      throw new CaseError("FORM_VERSION_NOT_PUBLISHED", {
        reason: "questions_unresolvable",
        versionId: response.automation_version_id,
      });
    }
    const answers = (response.answers ?? {}) as Record<string, unknown>;
    // Questions sourced from profile/document_extraction/generation_output are
    // filled at render/PDF time via resolveBySource — their value lives in the
    // source, not in `answers`. Resolve them so a REQUIRED prefilled field (e.g.
    // the client's name from profile) isn't falsely reported as "missing" on submit.
    const effective: Record<string, unknown> = { ...answers };
    for (const q of questions as Array<QuestionValidationRule & { source?: string; source_ref?: unknown }>) {
      const src = q.source ?? "client_answer";
      if (src === "client_answer") continue;
      const cur = effective[q.id];
      if (cur !== undefined && cur !== null && cur !== "") continue;
      try {
        const resolved = await resolveBySource(
          { id: q.id, source: src, source_ref: q.source_ref },
          answers,
          parsed.caseId,
          partyId,
        );
        if (resolved !== undefined && resolved !== null && resolved !== "") effective[q.id] = resolved;
      } catch {
        // leave empty — a genuinely missing required value still surfaces below
      }
    }
    const errors = validateAnswerTypes(effective, questions);
    if (errors.length > 0) {
      throw new CaseError("FORM_VALIDATION_FAILED", { errors });
    }
  }

  await updateFormResponse(response.id, {
    status: "submitted",
    submitted_at: new Date().toISOString(),
  });

  // Best-effort: persist the client's on-device translations (Feature: answer
  // translation). Wrapped so a pre-0020 schema (columns absent) never blocks the
  // submit — generateFilledPdf still translates on-demand server-side.
  if (parsed.translationStatus && parsed.translationStatus !== "none") {
    try {
      await updateFormResponse(response.id, {
        answers_translated: parsed.answersTranslated ?? {},
        translation_status: parsed.translationStatus,
      });
    } catch {
      /* columns land with migration 0020 — translation persistence degrades gracefully */
    }
  }

  appEvents.emit({
    type: "form_response.submitted",
    payload: { caseId: parsed.caseId, responseId: response.id },
    occurredAt: new Date(),
  });

  await writeTimeline({
    caseId: parsed.caseId,
    eventType: "form_response.submitted",
    actorKind: actor.kind === "client" ? "client" : "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      en: "Form submitted",
      es: "Formulario enviado",
    },
  });

  const updated = await findFormResponseById(response.id);
  if (!updated) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  return updated;
}

// ---------------------------------------------------------------------------
// API-CASE-18: approveFormResponse (staff only)
// ---------------------------------------------------------------------------

const ApproveFormResponseSchema = z.object({
  responseId: zUuid,
});

export type ApproveFormResponseInput = z.infer<typeof ApproveFormResponseSchema>;

/**
 * Staff approves a submitted form response: submitted → approved.
 * Gate: only applicable when filled_by='client' (DOC-41 §3.9).
 *
 * @api-id API-CASE-18
 */
export async function approveFormResponse(
  actor: Actor,
  input: ApproveFormResponseInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = ApproveFormResponseSchema.parse(input);

  const response = await findFormResponseById(parsed.responseId);
  if (!response) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  // Cross-tenant guard: findFormResponseById uses the service client (RLS bypass);
  // verify the actor belongs to this response's case before approving (else org A
  // could approve org B's response). (Same pattern as reviewDocument.)
  await requireCaseAccess(actor, response.case_id);

  if (response.status !== "submitted") {
    throw new CaseError("FORM_NOT_SUBMITTABLE");
  }

  await updateFormResponse(response.id, { status: "approved" });

  await writeAudit(
    actor,
    "case.form_response.approved",
    "case_form_responses",
    response.id,
    { after: { status: "approved" } },
  );
}

// ---------------------------------------------------------------------------
// API-CASE-19: generateFilledPdf (DOC-41 §3.10)
// ---------------------------------------------------------------------------

const GenerateFilledPdfSchema = z.object({
  responseId: zUuid,
});

export type GenerateFilledPdfInput = z.infer<typeof GenerateFilledPdfSchema>;

/**
 * Generates a filled PDF for an approved (or submitted-by-staff) form response.
 *
 * Gates:
 * - FORM_PDF_BLOCKED: response not in submitted/approved; or filled_by='client' and not approved.
 * - FORM_VERSION_MISMATCH: response was saved against a different version than the current published.
 *
 * Resolves all question values via resolveBySource, fills AcroForm via mupdf,
 * stores in bucket 'generated', updates filled_pdf_path.
 * Returns signed download URL.
 *
 * @api-id API-CASE-19
 */
export async function generateFilledPdf(
  actor: Actor,
  input: GenerateFilledPdfInput,
): Promise<string> {
  can(actor, "cases", "edit");
  const parsed = GenerateFilledPdfSchema.parse(input);

  const response = await findFormResponseById(parsed.responseId);
  if (!response) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  // Cross-tenant guard (CRITICAL): the filled PDF contains decrypted PII (SSN,
  // A-number, passport) resolved from the case's client. findFormResponseById
  // bypasses RLS — verify the actor owns this response's case before filling.
  await requireCaseAccess(actor, response.case_id);

  const formDef = await findFormDefinitionById(response.form_definition_id);
  if (!formDef) throw new CaseError("FORM_NOT_FOUND");

  // Gate: FORM_PDF_BLOCKED — status not in {submitted, approved}, OR client-filled not yet approved
  const validStatuses: FormResponseStatus[] = ["submitted", "approved"];
  if (!validStatuses.includes(response.status as FormResponseStatus)) {
    throw new CaseError("FORM_PDF_BLOCKED", { reason: "status", status: response.status });
  }
  if (formDef.filled_by === "client" && response.status !== "approved") {
    throw new CaseError("FORM_PDF_BLOCKED", { reason: "requires_approval", filledBy: formDef.filled_by });
  }

  // Gate: FORM_VERSION_MISMATCH — only fill against the currently published version
  const catalog = await import("@/backend/modules/catalog" as string) as {
    getPublishedAutomationVersion: (id: string) => Promise<{ id: string; source_pdf_path: string; detected_fields: unknown; source_language?: string } | null>;
    listQuestionGroups: (versionId: string) => Promise<Array<{ id: string }>>;
    listQuestions: (groupId: string) => Promise<Array<{
      id: string;
      source: string;
      source_ref: unknown;
      pdf_field_name: string | null;
      is_required: boolean;
      field_type: string;
      condition: unknown;
      options: unknown;
    }>>;
  };

  const published = await catalog.getPublishedAutomationVersion(response.form_definition_id);
  if (!published) {
    throw new CaseError("FORM_VERSION_NOT_PUBLISHED");
  }
  if (response.automation_version_id !== published.id) {
    throw new CaseError("FORM_VERSION_MISMATCH", {
      savedVersion: response.automation_version_id,
      publishedVersion: published.id,
    });
  }

  // Collect all questions for the version
  const questions: Array<{
    id: string;
    source: string;
    source_ref: unknown;
    pdf_field_name: string | null;
    is_required: boolean;
    field_type: string;
    condition: unknown;
    options: unknown;
  }> = [];

  if (catalog.listQuestionGroups && catalog.listQuestions) {
    const groups = await catalog.listQuestionGroups(published.id);
    for (const g of groups) {
      const qs = await catalog.listQuestions(g.id);
      questions.push(...qs);
    }
  }

  const answers = (response.answers ?? {}) as Record<string, unknown>;
  const caseId = response.case_id;
  const partyId = response.party_id;

  // Answer-translation context (Feature: client answer translation). When the
  // official PDF language differs from the language the client answered in, the
  // textual answers must be translated before filling the AcroForm. The client
  // pre-translates on-device (answers_translated); anything missing is filled in
  // here on-demand with the Gemini translator — so the PDF is always correct.
  const sourceLang: "en" | "es" = published.source_language === "es" ? "es" : "en";
  const translationStatus = (response.translation_status ?? "none") as string;
  const answersTranslated = (response.answers_translated ?? {}) as Record<string, unknown>;
  const needsTranslation = translationStatus !== "none";
  let translateAnswer: ((text: string) => Promise<string>) | null = null;
  if (needsTranslation) {
    // 2-language system: if translation is needed, answers are in the non-source language.
    const answerLang: "en" | "es" = sourceLang === "en" ? "es" : "en";
    const direction = `${answerLang}-${sourceLang}` as "es-en" | "en-es";
    // translateAnswerText masks structured PII (SSN/A-number/passport) before the
    // provider — structured PII for the form arrives via source='profile' (local).
    const { translateAnswerText } = (await import("@/backend/modules/ai-engine")) as {
      translateAnswerText: (i: { text: string; direction: "es-en" | "en-es" }) => Promise<{ text: string }>;
    };
    translateAnswer = async (text: string) => {
      try {
        const r = await translateAnswerText({ text, direction });
        return r.text?.trim() ? r.text : text;
      } catch {
        return text; // best-effort — never block PDF generation on translation
      }
    };
  }

  // Resolve all field values
  const fieldValues: Record<string, string | boolean> = {};
  const missingRequired: string[] = [];

  for (const q of questions) {
    // A SELECT may map a GROUP of checkboxes (Sex Male/Female, Marital, a Yes/No
    // pair): each option carries its own pdf_field_name and the chosen option's box
    // is the one we check. Such a question can have a null top-level pdf_field_name.
    const optionFields =
      q.field_type === "select" && Array.isArray(q.options)
        ? (q.options as Array<{ value: string; pdf_field_name?: string | null }>)
        : null;
    const hasOptionFields = !!optionFields && optionFields.some((o) => o?.pdf_field_name);
    if (!q.pdf_field_name && !hasOptionFields) continue; // intermediate — no AcroField mapping

    // Conditional/dynamic: a field hidden by its condition is left blank in the
    // PDF (v1 parity: "NO ⇒ blank"); a locked-off field is likewise not required.
    const condState = deriveFieldState(parseConditionOrNull(q.condition), q.is_required, answers);
    if (!condState.visible) continue;

    // Prefer an explicit client answer: an editable prefill (e.g. a profile field
    // the client had to fill because their profile was empty) is overridden by what
    // the client actually typed — resolveBySource(profile) would otherwise discard it.
    const own = answers[q.id];
    const resolved =
      own !== undefined && own !== null && own !== ""
        ? own
        : await resolveBySource(
            { id: q.id, source: q.source, source_ref: q.source_ref },
            answers,
            caseId,
            partyId,
          );

    const isEmpty = resolved === null || resolved === undefined || resolved === "";
    if (isEmpty && condState.required) {
      missingRequired.push(q.pdf_field_name ?? q.id);
      continue;
    }
    if (isEmpty) continue;

    // SELECT → checkbox group: tick the chosen option's box (an option with no
    // pdf_field_name, e.g. "No" on a single "I am married" checkbox, ticks nothing).
    if (hasOptionFields) {
      const chosen = optionFields.find((o) => String(o.value) === String(resolved));
      if (chosen?.pdf_field_name) fieldValues[chosen.pdf_field_name] = true;
      continue;
    }

    if (typeof resolved === "boolean") {
      fieldValues[q.pdf_field_name!] = resolved;
    } else {
      let str = String(resolved);
      // Translate only free-text fields (dates/numbers/selects map to codes).
      if (needsTranslation && (q.field_type === "text" || q.field_type === "textarea")) {
        const pre = answersTranslated[q.id];
        if (typeof pre === "string" && pre.trim()) {
          str = pre; // client already translated this one on-device
        } else if (translationStatus !== "done" && translateAnswer) {
          str = await translateAnswer(str); // fill the gap server-side
        }
      }
      fieldValues[q.pdf_field_name!] = str;
    }
  }

  if (missingRequired.length > 0) {
    throw new CaseError("FORM_PDF_REQUIRED_MISSING", { missing: missingRequired });
  }

  // Download source PDF from catalog-assets bucket
  const { createSignedDownloadUrl: getDownloadUrl, uploadBytesToStorage } = await import(
    "@/backend/platform/storage"
  );
  const sourcePdfUrl = await getDownloadUrl("catalog-assets", published.source_pdf_path);

  // Fetch PDF bytes
  const pdfResponse = await fetch(sourcePdfUrl);
  if (!pdfResponse.ok) {
    throw new Error(`generateFilledPdf: failed to fetch source PDF — ${pdfResponse.status}`);
  }
  const pdfBuffer = await pdfResponse.arrayBuffer();
  const pdfBytes = new Uint8Array(pdfBuffer);

  // USCIS acceptance rule (8 CFR 1208.3(c)(3)): a blank field makes the form
  // incomplete, but "N/A" is an allowed response. Backfill blank applicant text
  // fields on this form's pages so the filed PDF is not rejected for blanks.
  const { fillAcroForm, backfillNaTextFields } = await import("@/backend/platform/pdf");
  const detectedForNa = (published.detected_fields ?? []) as Array<{
    pdf_field_name: string;
    field_type: string;
    page: number;
  }>;
  // Seed the page-scope with BOTH top-level and per-option pdf field names, so a
  // page whose questions are all checkbox-group SELECTs (null top-level field) is
  // still recognised as in-scope for the N/A backfill.
  const naFormFields = [
    ...questions.map((q) => q.pdf_field_name).filter((n): n is string => !!n),
    ...questions.flatMap((q) =>
      Array.isArray(q.options)
        ? (q.options as Array<{ pdf_field_name?: string | null }>)
            .map((o) => o?.pdf_field_name)
            .filter((n): n is string => !!n)
        : [],
    ),
  ];
  backfillNaTextFields(detectedForNa, fieldValues, naFormFields);
  const filledBytes = await fillAcroForm(pdfBytes, {}, fieldValues);

  // Store in generated bucket
  const storagePath = `case/${caseId}/forms/${formDef.slug}-${response.id}.pdf`;
  await uploadBytesToStorage("generated", storagePath, filledBytes, "application/pdf");

  // Update response with the filled PDF path
  await updateFormResponse(response.id, { filled_pdf_path: storagePath });

  await writeAudit(
    actor,
    "case.form_response.pdf_generated",
    "case_form_responses",
    response.id,
    { after: { filledPdfPath: storagePath } },
  );

  await writeTimeline({
    caseId,
    eventType: "form.pdf_generated",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: {
      en: "PDF generated",
      es: "PDF generado",
    },
  });

  // Return signed download URL
  const { createSignedDownloadUrl } = await import("@/backend/platform/storage");
  return createSignedDownloadUrl("generated", storagePath);
}

// ---------------------------------------------------------------------------
// Staff Información tab: document extractions read
// ---------------------------------------------------------------------------

export interface DocumentExtractionSummary {
  caseDocumentId: string;
  requirementSlug: string | null;
  partyId: string | null;
  documentStatus: string;
  extractionStatus: string | null;
  extractionPayload: unknown;
}

/**
 * Returns document extraction statuses + payloads for a case.
 * Used by the staff shared-case Información tab.
 *
 * @api-id (staff read — DOC-53 Información tab)
 */
export async function getCaseExtractions(
  actor: Actor,
  caseId: string,
): Promise<DocumentExtractionSummary[]> {
  can(actor, "cases", "view");
  await requireCaseAccess(actor, caseId);
  return listDocumentExtractionsForCase(caseId);
}

// ---------------------------------------------------------------------------
// GAP reads — kanban board support (F5-Ola3)
// ---------------------------------------------------------------------------

/**
 * GAP-1: Lists cases assigned to the calling paralegal (or sales — whoever is actor.userId).
 *
 * Returns the same AdminCaseListItem shape as listCasesAdmin so the page needs no changes.
 * Paralegal sees their own cases only; admin can still use listCasesAdmin for full view.
 *
 * Signature: listCasesForParalegal(actor) → Promise<AdminCaseListItem[]>
 *
 * @api-id API-CASE-20
 */
export async function listCasesForParalegal(
  actor: Actor,
): Promise<AdminCaseListItem[]> {
  can(actor, "cases", "view");
  const page = await listCases({
    orgId: actor.orgId,
    assignedParalegalId: actor.userId,
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

  return items;
}

/**
 * GAP-3: Returns batch alert signals for a set of cases.
 *
 * All 4 signals are read via service_role (no RLS) — this is a staff-only read.
 * Runs 4 parallel IN queries (no N+1).
 *
 * Signals:
 *   needsReview      — count of case_documents with status='uploaded'
 *   lawyerCorrections — true if any expediente has status='corrections_needed'
 *   generationFailed  — true if any ai_generation_run has status='failed'
 *                       (cases repo already queries ai_generation_runs — same data scope)
 *   rfeOverdue        — true if any case_document has correction_due_at < now() and
 *                       status in ('rejected','uploaded')
 *
 * Signature: getCaseBoardAlerts(actor, caseIds) → Promise<Record<string, CaseBoardAlert>>
 *
 * @api-id API-CASE-21
 */
export interface CaseBoardAlert {
  needsReview: number;
  lawyerCorrections: boolean;
  generationFailed: boolean;
  rfeOverdue: boolean;
}

export async function getCaseBoardAlerts(
  actor: Actor,
  caseIds: string[],
): Promise<Record<string, CaseBoardAlert>> {
  can(actor, "cases", "view");
  if (caseIds.length === 0) return {};

  const [uploadedCounts, lawyerCorrectionIds, generationFailedIds, rfeOverdueIds] =
    await Promise.all([
      countUploadedDocsByCases(caseIds),
      findCasesWithLawyerCorrections(caseIds),
      findCasesWithGenerationFailed(caseIds),
      findCasesWithRfeOverdue(caseIds),
    ]);

  const uploadedByCase = new Map(uploadedCounts.map((r) => [r.case_id, r.count]));
  const lawyerSet = new Set(lawyerCorrectionIds);
  const genFailedSet = new Set(generationFailedIds);
  const rfeSet = new Set(rfeOverdueIds);

  const result: Record<string, CaseBoardAlert> = {};
  for (const id of caseIds) {
    result[id] = {
      needsReview: uploadedByCase.get(id) ?? 0,
      lawyerCorrections: lawyerSet.has(id),
      generationFailed: genFailedSet.has(id),
      rfeOverdue: rfeSet.has(id),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Service-role case status transitions (for event consumers — no actor session)
// ---------------------------------------------------------------------------

/**
 * Transitions cases.status using service_role (bypasses RLS).
 * Safe to call from event consumers that have no actor session.
 *
 * Uses findCaseByCaseId (service_role) — NOT findCaseById (createServerClient/RLS)
 * which would throw CASE_NOT_FOUND in event-consumer context (Ola-2 lesson).
 *
 * @internal — exported for event consumers only
 */
export async function transitionCaseSystem(
  caseId: string,
  target: CaseStatus,
): Promise<void> {
  const caseRow = await findCaseByCaseId(caseId);
  if (!caseRow) {
    logger.warn({ caseId, target }, "cases.transitionCaseSystem: case not found — skipping");
    return;
  }
  const err = canTransitionCase(caseRow.status as CaseStatus, target, "admin");
  if (err) {
    logger.warn({ caseId, from: caseRow.status, to: target, err }, "cases.transitionCaseSystem: invalid transition — skipping");
    return;
  }
  await updateCase(caseId, { status: target });
}

/**
 * Consumer: expediente.sent_to_finance → case transitions to ready_for_delivery.
 *
 * Ruta corta (plan self): may jump from active → ready_for_delivery in one step,
 * bypassing the standard state machine (same pattern as onDownpaymentConfirmed which
 * directly sets status='active' without domain guard).
 *
 * Direct DB update via service_role — no canTransitionCase gate (event-driven system
 * action where the state machine path may not match the expediente flow).
 *
 * Idempotent: if already ready_for_delivery or later, no-op.
 */
export async function onExpedienteSentToFinanceCase(payload: {
  caseId: string;
}): Promise<void> {
  const { caseId } = payload;
  const caseRow = await findCaseByCaseId(caseId);
  if (!caseRow) {
    logger.warn({ caseId }, "cases.onExpedienteSentToFinanceCase: case not found — skipping");
    return;
  }

  // Idempotent: if already at or past ready_for_delivery, skip
  const alreadyDone: string[] = ["ready_for_delivery", "delivered", "completed", "cancelled", "on_hold"];
  if (alreadyDone.includes(caseRow.status)) return;

  // Direct service_role update — ruta corta (bypasses canTransitionCase domain gate)
  await updateCase(caseId, { status: "ready_for_delivery" });
  logger.info({ caseId }, "cases: case transitioned to ready_for_delivery via expediente.sent_to_finance");
}

/**
 * Consumer: expediente.printed → case transitions to delivered.
 *
 * Idempotent: if already delivered or later, no-op.
 */
export async function onExpedientePrintedCase(payload: {
  caseId: string;
}): Promise<void> {
  const { caseId } = payload;
  const caseRow = await findCaseByCaseId(caseId);
  if (!caseRow) {
    logger.warn({ caseId }, "cases.onExpedientePrintedCase: case not found — skipping");
    return;
  }

  if (caseRow.status === "delivered" || caseRow.status === "completed") return;

  await transitionCaseSystem(caseId, "delivered");
  logger.info({ caseId }, "cases: case transitioned to delivered via expediente.printed");
}

