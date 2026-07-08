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
import { toDownloadFilename } from "@/shared/strings";
import {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  validateUploadedObject,
  deleteObject,
  downloadBytesFromStorage,
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
  resolveEmptyPolicy,
  isVerbatimValue,
  type VersionEmptyPolicy,
  type FieldEmptyPolicy,
} from "@/shared/form-logic/empty-policy";

import {
  canTransitionCase,
  canTransitionDocument,
  computePhaseProgress,
  resolveNextPhase,
  resolveNextMilestone,
  resolveFirstMilestone,
  addWeeksToAnchorIso,
  validateAnswerTypes,
  buildPartiesSnapshot,
  selectContractAdditionalParties,
  findCardinalityViolation,
  PRODUCTION_STATUSES,
  computeStageChecklist,
  canTransferStage,
  nextStage,
  STAGE_MODULE,
  type CaseStatus,
  type CaseStage,
  type StageChecklist,
  type FormResponseStatus,
  type QuestionValidationRule,
  type PartiesSnapshotShape,
} from "./domain";
import {
  findCaseById,
  findCaseByCaseId,
  findCaseByContractId,
  nextCaseNumber,
  createCaseAtomic,
  updateCase,
  insertPhaseHistory,
  insertMilestoneHistory,
  findDocumentById,
  insertCaseDocument,
  updateDocument,
  deleteCaseDocumentRow,
  findCurrentChainHead,
  getTimelinePage,
  listCases,
  listCaseDocuments,
  getRequirementOverrides,
  findRequirementOverride,
  insertRequirementOverride,
  updateRequirementOverride,
  deleteRequirementOverride,
  getCaseParties,
  updateClientProfileName,
  updatePersonRecordName,
  findServiceLite,
  findServiceContractRow,
  listServicePhases,
  listServiceMilestones,
  findPersonRecord,
  findClientDisplayName,
  findClientPhonesByIds,
  findClientFullName,
  findPlanKind,
  findFormResponse,
  findFormResponseById,
  listFormResponsesForCase,
  insertFormResponse,
  mergeFormAnswers,
  updateFormResponse,
  findLatestActiveDocumentBySlug,
  findDocumentExtractionByCaseDocId,
  findCompletedGenerationByFormSlug,
  downloadDocumentBytesBySlug,
  findClientProfileForForm,
  findUserContactFields,
  listDocumentExtractionsForCase,
  findCasePrimaryClient,
  getCaseSummariesByClient,
  findFormDefinitionById,
  countUploadedDocsByCases,
  findCasesWithLawyerCorrections,
  findCasesWithGenerationFailed,
  findCasesWithRfeOverdue,
  findCasesWithRfeInProgress,
  getActiveCasesEnriched,
  insertStageHistory,
  listCaseStageHistory,
  listStaffWithModuleEdit,
  getTranslationProgress,
  findStaffDisplayName,
  setDocumentTranslationNotRequiredRow,
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
      | "CASE_ALREADY_LAST_PHASE"
      | "CASE_PHASE_NOT_PRINTED"
      | "CASE_ALREADY_LAST_MILESTONE"
      | "CASE_NO_MILESTONES"
      | "CASE_SERVICE_NOT_AVAILABLE"
      | "CASE_PAYMENT_PLAN_INVALID"
      | "CASE_PARTY_ROLE_INVALID"
      | "CASE_PARTY_CARDINALITY"
      | "CASE_PARTY_NOT_FOUND"
      | "CASE_CONTRACT_LOCKED"
      | "DOC_NOT_FOUND"
      | "DOC_INVALID_STATE"
      | "DOC_REJECTION_REASON_REQUIRED"
      | "DOC_REQUIREMENT_NOT_FOUND"
      | "REQUIREMENT_NOT_OPTIONAL"
      | "DOC_PARTY_NOT_ELIGIBLE"
      | "DOC_UPLOAD_INVALID"
      | "DOC_FORMAT_NOT_ALLOWED"
      | "DOC_NOT_LEGIBLE"
      | "DOC_NAME_REQUIRED"
      | "DOC_ALREADY_APPROVED"
      | "DOC_LOCKED"
      | "DOC_REVIEWED"
      | "FORM_NOT_FOUND"
      | "FORM_VERSION_NOT_PUBLISHED"
      | "FORM_VERSION_MISMATCH"
      | "FORM_NOT_EDITABLE_BY_CLIENT"
      | "FORM_NOT_SUBMITTABLE"
      | "FORM_VALIDATION_FAILED"
      | "FORM_PDF_BLOCKED"
      | "FORM_PDF_REQUIRED_MISSING"
      | "FORM_RESPONSE_NOT_FOUND"
      | "FORM_REJECTION_REASON_REQUIRED"
      | "FORM_PROFILE_FIELD_FORBIDDEN"
      // Stage / ownership (responsable interno)
      | "STAGE_TERMINAL"
      | "STAGE_FORBIDDEN"
      | "STAGE_NOT_READY"
      | "STAGE_NO_OWNER"
      | "STAGE_OWNER_REQUIRED"
      | "STAGE_INVALID_OWNER",
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
    "milestone.advanced": "chevrons-right",
    "appointment.booked": "calendar",
    "appointment.cancelled": "alert-circle",
    "appointment.rescheduled": "refresh-cw",
    "appointment.completed": "check-circle",
    "appointment.no_show": "alert-circle",
  };
  return map[eventType] ?? "info";
}

/** Color map for timeline events. */
function colorForEvent(eventType: string, actorKind: string): string {
  if (eventType === "document.rejected") return "amber"; // never red (RF-TRX-022)
  if (eventType === "document.approved") return "green";
  if (eventType === "downpayment.confirmed") return "green";
  if (eventType === "phase.advanced") return "gold";
  if (eventType === "milestone.advanced") return "gold";
  // Appointment lifecycle (DOC-43): booked/completed positive (green), reschedule
  // neutral (gold), cancelled soft-warning (amber), no_show is the factual record
  // (red — the historical bitácora supports it; push notifications stay amber).
  if (eventType === "appointment.booked") return "green";
  if (eventType === "appointment.completed") return "green";
  if (eventType === "appointment.rescheduled") return "gold";
  if (eventType === "appointment.cancelled") return "amber";
  if (eventType === "appointment.no_show") return "red";
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
// appendAppointmentTimeline — public projection of scheduling events to the
// case timeline (DOC-43 / DOC-41 §3.14). Cases remains the SOLE writer of the
// case timeline; the scheduling consumers in register-consumers call this.
// ---------------------------------------------------------------------------

export type AppointmentTimelineEventType =
  | "appointment.booked"
  | "appointment.cancelled"
  | "appointment.rescheduled"
  | "appointment.completed"
  | "appointment.no_show";

const APPOINTMENT_TIMELINE_CONTENT: Record<
  AppointmentTimelineEventType,
  { titleI18n: { es: string; en: string }; bodyI18n?: { es: string; en: string } }
> = {
  "appointment.booked": {
    titleI18n: { es: "Cita agendada", en: "Appointment booked" },
  },
  "appointment.cancelled": {
    titleI18n: { es: "Cita cancelada", en: "Appointment cancelled" },
  },
  "appointment.rescheduled": {
    titleI18n: { es: "Cita reprogramada", en: "Appointment rescheduled" },
  },
  "appointment.completed": {
    titleI18n: { es: "Cita completada", en: "Appointment completed" },
    bodyI18n: { es: "Asististe a tu cita.", en: "You attended your appointment." },
  },
  "appointment.no_show": {
    titleI18n: { es: "No asististe a la cita", en: "You missed your appointment" },
    bodyI18n: {
      es: "Se registró una inasistencia. Podrás reagendar más adelante.",
      en: "A no-show was recorded. You'll be able to reschedule later.",
    },
  },
};

/**
 * Projects a scheduling appointment lifecycle event onto the case timeline,
 * visible to the client. Body copy is locale-neutral (no exact date) so no
 * timezone formatting is coupled to the backend — the cita screen shows the
 * precise date/time. (DOC-41 §3.14, RF-TRX-024 CA3.)
 */
export async function appendAppointmentTimeline(input: {
  caseId: string;
  eventType: AppointmentTimelineEventType;
  actorKind: "client" | "team" | "system";
  actorUserId?: string | null;
  /** Overrides the default body copy (e.g. an objectives summary for completed). */
  bodyOverride?: { es: string; en: string } | null;
}): Promise<void> {
  const content = APPOINTMENT_TIMELINE_CONTENT[input.eventType];
  await writeTimeline({
    caseId: input.caseId,
    eventType: input.eventType,
    actorKind: input.actorKind,
    actorUserId: input.actorUserId ?? null,
    titleI18n: content.titleI18n,
    bodyI18n: input.bodyOverride ?? content.bodyI18n ?? null,
    visibleToClient: true,
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
    frequency: z.enum(["weekly", "monthly"]).default("monthly"),
    notes: z.string().nullable().optional(),
  }),
});

// z.input (not z.infer): callers may omit defaulted fields like `frequency` —
// the service's .parse() fills them in.
export type CreateCaseFromContractInput = z.input<
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
 *   4. Compute everything (nextCaseNumber, party roles + person_records, contract
 *      snapshots + terms, installment math) then write atomically:
 *      a. nextCaseNumber()
 *      b. parties: validate roles + resolve person_records (identity)
 *      c. contract snapshots + active terms version
 *      d. installments (billing.buildInstallments)
 *      e. createCaseAtomic() — case + member + parties + contract + payment_plan
 *         + installments in ONE transaction (migration 0026 create_case_atomic)
 *   5. Emit case.created (+ case.assigned) + audit
 *
 * ATOMICITY: the writes go through the create_case_atomic RPC (one transaction),
 * so a failure mid-creation rolls back everything — a partially-created case
 * (payment_pending with no contract/plan) can no longer be orphaned (this replaced
 * the old sequential-insert flow that left exactly such orphans, e.g. ULP-2026-0002).
 * person_records are still resolved in TS before the RPC; a stray person_record on
 * a rolled-back case is harmless (no case references it).
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

  // A sales actor owns the cases they create.
  const assignedSalesId =
    actor.role === "sales" ? actor.userId : (p.assignedSalesId ?? null);

  // Step 4b: Parties. The applicant is the principal party (role 'petitioner',
  // position 0); additional parties from the modal are validated against the
  // service's declared roles. person_records (identity-owned) are resolved here,
  // BEFORE the atomic write — a stray person_record on a rolled-back case is
  // harmless. The resulting array is inserted atomically by create_case_atomic.
  const { upsertPersonRecord: upsertPerson } =
    await import("@/backend/modules/identity") as {
      upsertPersonRecord: (
        actor: Actor,
        i: { firstName: string; lastName: string; relationship?: string | null },
      ) => Promise<string>;
    };

  // Role keys whose parties appear in the contract snapshot (the implicit
  // petitioner is always included separately). Populated from the service config.
  const contractIncludedRoles = new Set<string>();
  // role_key → bilingual label, used to render the committed parties in the contract.
  const roleLabelByKey = new Map<string, { es?: string; en?: string }>();
  if (p.parties.length > 0) {
    let roles: Array<{
      role_key: string;
      cardinality: string;
      include_in_contract: boolean;
      label_i18n: { es?: string; en?: string } | null;
    }>;
    try {
      const catalogModule = (await import("@/backend/modules/catalog")) as {
        listServicePartyRoles: (
          id: string,
        ) => Promise<
          Array<{
            role_key: string;
            cardinality: string;
            include_in_contract: boolean;
            label_i18n: { es?: string; en?: string } | null;
          }>
        >;
      };
      roles = await catalogModule.listServicePartyRoles(p.serviceId);
    } catch {
      // Transient catalog failure — surface a retryable error, NOT a false
      // "invalid role" (the roles may well be valid; we just couldn't load them).
      throw new CaseError("CASE_SERVICE_NOT_AVAILABLE");
    }
    const allowed = new Set(roles.map((r) => r.role_key));
    const singleRoleKeys = new Set(
      roles.filter((r) => r.cardinality === "single").map((r) => r.role_key),
    );
    for (const r of roles) {
      if (r.include_in_contract) contractIncludedRoles.add(r.role_key);
      roleLabelByKey.set(r.role_key, r.label_i18n ?? {});
    }

    for (const party of p.parties) {
      if (party.role === PRINCIPAL_ROLE_KEY || !allowed.has(party.role)) {
        throw new CaseError("CASE_PARTY_ROLE_INVALID", { role: party.role });
      }
    }
    // Cardinality: a 'single' role may be supplied at most once.
    const violation = findCardinalityViolation(
      p.parties.map((party) => party.role),
      singleRoleKeys,
    );
    if (violation) throw new CaseError("CASE_PARTY_CARDINALITY", { role: violation });
  }

  const partiesPayload: Array<{
    person_record_id: string | null;
    user_id: string | null;
    party_role: string;
    position: number;
  }> = [
    // Principal applicant (the primary client) — position 0.
    { person_record_id: null, user_id: p.primaryClientId, party_role: PRINCIPAL_ROLE_KEY, position: 0 },
  ];
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
    partiesPayload.push({
      person_record_id: personRecordId,
      user_id: partyUserId,
      party_role: party.role,
      position: i + 1,
    });
  }

  // Step 4c: Contract snapshots + active terms version.
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
    // serviceLabel frozen into the snapshot so the public signing page can show
    // the service name without a live catalog lookup (the page is anon).
    serviceLabel: (serviceRow as { label_i18n?: unknown }).label_i18n ?? null,
    planKind: (planRow as { kind: string }).kind,
    totalCents: p.paymentPlan.totalCents,
    downpaymentCents: p.paymentPlan.downpaymentCents,
    installmentCount: p.paymentPlan.installmentCount,
    frequency: p.paymentPlan.frequency,
    currency: "USD",
    // Optional per-contract discount/promo reason, frozen for the record.
    discountNote: p.paymentPlan.notes ?? null,
  };
  // The principal applicant (petitioner) must be the FIRST party in the snapshot
  // — the public signing page renders parties_snapshot.parties directly. Its
  // full name lives in client_profiles (NOT users); resolve it here (graceful
  // null if no profile yet). Additional parties keep their inline names.
  const principalFullName = await findClientFullName(p.primaryClientId);
  const principalName = principalFullName
    ? `${principalFullName.first_name} ${principalFullName.last_name}`.trim() || null
    : null;
  // The contract commits only the parties whose role is `include_in_contract`
  // (the petitioner is always added by buildPartiesSnapshot). All parties are
  // still inserted into case_parties above — this filter shapes ONLY the snapshot.
  const contractAdditional = selectContractAdditionalParties(
    p.parties.map((pt) => ({
      role: pt.role,
      userId: pt.userId ?? null,
      name: pt.person ? `${pt.person.firstName} ${pt.person.lastName}`.trim() : null,
    })),
    contractIncludedRoles,
  );
  const partiesSnapshot: Record<string, unknown> = buildPartiesSnapshot(
    { userId: p.primaryClientId, name: principalName },
    contractAdditional,
  ) as unknown as Record<string, unknown>;

  // Step 4d: Installments — downpayment + monthly cuotas (billing domain math).
  // Provisional due dates anchored to today; re-anchored when the contract is signed.
  const { buildInstallments } = await import("@/backend/modules/billing") as {
    buildInstallments: (i: {
      totalCents: number; downpaymentCents: number; installmentCount: number; startDate: string;
      frequency?: "weekly" | "monthly";
    }) => Array<{ number: number; amountCents: number; dueDate: string; isDownpayment: boolean }>;
  };
  const installmentsPayload = buildInstallments({
    totalCents: p.paymentPlan.totalCents,
    downpaymentCents: p.paymentPlan.downpaymentCents,
    installmentCount: p.paymentPlan.installmentCount,
    startDate: new Date().toISOString().slice(0, 10),
    frequency: p.paymentPlan.frequency,
  }).map((d) => ({
    number: d.number,
    is_downpayment: d.isDownpayment,
    amount_cents: d.amountCents,
    due_date: d.dueDate,
    status: "pending",
  }));

  // Step 4d-bis: Freeze the assembled bilingual contract document (DOC-51). Built
  // from the service content + EL CONSULTOR org config + plan + the FILTERED
  // committed parties. Immutable legal record: editing the service/org later never
  // alters this contract. Rendered by the signing page + PDF (self-contained).
  const documentSnapshot = await buildContractDocumentSnapshot({
    orgId: actor.orgId,
    serviceRow,
    clientName: principalName,
    committed: contractAdditional,
    roleLabelByKey,
    fees: {
      totalCents: p.paymentPlan.totalCents,
      downpaymentCents: p.paymentPlan.downpaymentCents,
      installmentCount: p.paymentPlan.installmentCount,
      frequency: p.paymentPlan.frequency,
    },
    schedule: installmentsPayload.map((d) => ({
      number: d.number,
      amountCents: d.amount_cents,
      dueDate: d.due_date,
      isDownpayment: d.is_downpayment,
    })),
  });

  // Step 4e: ATOMIC write (migration 0026). case + member + parties + contract +
  // payment_plan + installments in ONE transaction — on failure nothing persists,
  // so a partially-created case (payment_pending with no plan) can never be left.
  const atomic = await createCaseAtomic({
    case: {
      org_id: actor.orgId,
      case_number: caseNumber,
      service_id: p.serviceId,
      service_plan_id: p.servicePlanId,
      current_phase_id: null,
      status: "payment_pending",
      primary_client_id: p.primaryClientId,
      assigned_paralegal_id: p.assignedParalegalId ?? null,
      assigned_sales_id: assignedSalesId,
    },
    member: { user_id: p.primaryClientId, access_role: "owner" },
    parties: partiesPayload,
    contract: {
      org_id: actor.orgId,
      lead_id: p.leadId ?? null,
      service_id: p.serviceId,
      service_plan_id: p.servicePlanId,
      status: "draft",
      plan_snapshot: planSnapshot,
      parties_snapshot: partiesSnapshot,
      document_snapshot: documentSnapshot,
      created_by: actor.userId,
      terms_version: termsVersion,
      signing_token: null,
      signing_expires_at: null,
    },
    plan: {
      total_cents: p.paymentPlan.totalCents,
      downpayment_cents: p.paymentPlan.downpaymentCents,
      installment_count: p.paymentPlan.installmentCount,
      frequency: p.paymentPlan.frequency,
      notes: p.paymentPlan.notes ?? null,
    },
    installments: installmentsPayload,
  });

  const caseId = atomic.caseId;
  const contractId = atomic.contractId;

  // Step 5: Emit domain events + audit
  await appEvents.emitAndWait({
    type: "case.created",
    payload: { caseId },
    occurredAt: new Date(),
  });

  // Initial responsible (etapa 'sales') = the assigned sales rep (the creator,
  // typically Vanessa). Projects the case card onto their personal `cases` board
  // via case.owner_changed. `assigned_paralegal_id` stays as a *preselection*
  // used later as the default owner at the Legal handoff (transferCase).
  if (assignedSalesId) {
    await updateCase(caseId, { current_owner_id: assignedSalesId });
    await insertStageHistory({
      caseId,
      fromStage: null,
      toStage: "sales",
      fromOwnerId: null,
      toOwnerId: assignedSalesId,
      actorId: actor.userId,
      note: "case created",
    });
    await appEvents.emitAndWait({
      type: "case.owner_changed",
      payload: {
        caseId,
        orgId: actor.orgId,
        fromOwnerId: null,
        toOwnerId: assignedSalesId,
      },
      occurredAt: new Date(),
    });
  }

  await writeAudit(actor, "case.created", "cases", caseId, {
    after: {
      caseNumber,
      serviceId: p.serviceId,
      servicePlanId: p.servicePlanId,
      primaryClientId: p.primaryClientId,
    },
  });

  await writeTimeline({
    caseId,
    eventType: "case.created",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: { en: "Case opened", es: "Caso creado" },
  });

  return { caseId, contractId, created: true };
}

// ---------------------------------------------------------------------------
// listCaseSummariesForClient — RF-VAN-019 duplicate-service notice
// ---------------------------------------------------------------------------

export interface ClientCaseSummary {
  caseId: string;
  caseNumber: string;
  serviceId: string;
  /** Raw services.label_i18n — the action layer resolves it to the locale. */
  serviceLabelI18n: unknown;
  status: string;
}

/**
 * Lists lightweight case summaries for one client of the actor's org. Powers
 * the non-blocking "⚠ {Nombre} ya tiene un caso de {Servicio}" notice in the
 * "Nuevo caso" modal (RF-VAN-019) — a client may legitimately hold N cases,
 * so this only informs, never blocks.
 */
export async function listCaseSummariesForClient(
  actor: Actor,
  clientId: string,
): Promise<ClientCaseSummary[]> {
  can(actor, "cases", "view");
  const parsedClientId = zUuid.parse(clientId);

  const rows = await getCaseSummariesByClient(actor.orgId, parsedClientId);
  return rows.map((r) => ({
    caseId: r.id,
    caseNumber: r.case_number,
    serviceId: r.service_id,
    serviceLabelI18n: r.service_label_i18n,
    status: r.status,
  }));
}

// ---------------------------------------------------------------------------
// updateCaseParty — admin renames a case party (RF-ADM / contract correction)
// ---------------------------------------------------------------------------

const UpdateCasePartySchema = z.object({
  caseId: zUuid,
  partyId: zUuid,
  firstName: z.string().trim().min(1).max(80),
  // last name optional (single-name parties), consistent with provisioning.
  lastName: z.string().trim().max(80).default(""),
});

export type UpdateCasePartyInput = z.infer<typeof UpdateCasePartySchema>;

/** Resolves a party's FULL legal name (person record OR client profile). */
async function resolvePartyFullName(party: {
  person_record_id: string | null;
  user_id: string | null;
}): Promise<string | null> {
  if (party.person_record_id) {
    const pr = await findPersonRecord(party.person_record_id);
    return pr ? `${pr.first_name} ${pr.last_name}`.trim() || null : null;
  }
  if (party.user_id) {
    const cp = await findClientFullName(party.user_id);
    return cp ? `${cp.first_name} ${cp.last_name}`.trim() || null : null;
  }
  return null;
}

/**
 * Rebuilds the contract parties snapshot from the live `case_parties` (the
 * principal/petitioner first, additional in position order). Returns null when
 * the case has no resolvable principal party.
 */
async function buildSnapshotFromCaseParties(
  caseId: string,
): Promise<PartiesSnapshotShape | null> {
  const parties = await getCaseParties(caseId); // ordered by position
  const principal = parties.find(
    (p) => p.party_role === PRINCIPAL_ROLE_KEY && p.user_id,
  );
  if (!principal || !principal.user_id) return null;

  // Filter the additional parties to those whose role is included in the contract
  // (same rule as createCaseFromContract). Resolve the service from the case.
  const caseRow = await findCaseById(caseId);
  const includedRoles = caseRow
    ? await loadContractIncludedRoles(caseRow.service_id)
    : new Set<string>();
  const additional = selectContractAdditionalParties(
    parties
      .filter((p) => p.id !== principal.id)
      .map((p) => ({ role: p.party_role, userId: p.user_id, party: p })),
    includedRoles,
  );

  const additionalResolved: Array<{ role: string; userId: string | null; name: string | null }> = [];
  for (const a of additional) {
    additionalResolved.push({
      role: a.role,
      userId: a.userId,
      name: await resolvePartyFullName(a.party),
    });
  }
  return buildPartiesSnapshot(
    { userId: principal.user_id, name: await resolvePartyFullName(principal) },
    additionalResolved,
  );
}

/**
 * Loads the set of role_keys whose parties are included in the contract for a
 * service (`service_party_roles.include_in_contract`). The implicit petitioner
 * is always in the contract and is NOT a row here. Throws a retryable error on
 * a transient catalog failure (never silently drops parties).
 */
async function loadContractIncludedRoles(serviceId: string): Promise<Set<string>> {
  try {
    const catalogModule = (await import("@/backend/modules/catalog")) as {
      listServicePartyRoles: (
        id: string,
      ) => Promise<Array<{ role_key: string; include_in_contract: boolean }>>;
    };
    const roles = await catalogModule.listServicePartyRoles(serviceId);
    return new Set(roles.filter((r) => r.include_in_contract).map((r) => r.role_key));
  } catch {
    throw new CaseError("CASE_SERVICE_NOT_AVAILABLE");
  }
}

type I18nMaybe = { es?: string; en?: string } | null | undefined;
type I18nListMaybe = { es?: string[]; en?: string[] } | null | undefined;

/**
 * Assembles + freezes the bilingual contract document (DOC-51). Built from the
 * service content (object/scope/special), EL CONSULTOR org config, the plan and
 * the ALREADY-FILTERED committed parties. Returns `{ es, en }` so the anonymous
 * signing page can render either locale without a live lookup. Resilient: a
 * failure to load org/contracts degrades to null (the signing page falls back).
 */
async function buildContractDocumentSnapshot(input: {
  orgId: string;
  serviceRow: unknown;
  clientName: string | null;
  committed: ReadonlyArray<{ role: string; name: string | null }>;
  roleLabelByKey: Map<string, { es?: string; en?: string }>;
  fees: {
    totalCents: number;
    downpaymentCents: number;
    installmentCount: number;
    frequency?: "weekly" | "monthly";
  };
  schedule: Array<{ number: number; amountCents: number; dueDate: string; isDownpayment: boolean }>;
}): Promise<Record<string, unknown> | null> {
  try {
    const [{ buildContractDocument }, { getOrgContractInfo }] = await Promise.all([
      import("@/backend/modules/contracts") as Promise<{
        buildContractDocument: (i: unknown) => unknown;
      }>,
      import("@/backend/modules/org") as Promise<{
        getOrgContractInfo: (orgId: string) => Promise<{
          companyName: string;
          representativeName: string | null;
          phone: string | null;
          zelleEmail: string | null;
        }>;
      }>,
    ]);
    const consultor = await getOrgContractInfo(input.orgId);
    const svc = input.serviceRow as {
      label_i18n?: I18nMaybe;
      contract_object_i18n?: I18nMaybe;
      contract_scope_i18n?: I18nListMaybe;
      contract_special_clause_i18n?: I18nMaybe;
    };
    const dateIso = new Date().toISOString().slice(0, 10);

    const docFor = (locale: "es" | "en") => {
      const pick = (v: I18nMaybe): string | null => (v ? (v[locale] ?? v.es ?? v.en ?? null) : null);
      const pickList = (v: I18nListMaybe): string[] | null =>
        v ? (v[locale] ?? v.es ?? v.en ?? null) : null;
      return buildContractDocument({
        locale,
        dateIso,
        consultor,
        serviceLabel: pick(svc.label_i18n) ?? "",
        client: { name: input.clientName },
        committedParties: input.committed.map((a) => ({
          roleLabel: pick(input.roleLabelByKey.get(a.role)) ?? a.role,
          name: a.name ?? "",
        })),
        objeto: pick(svc.contract_object_i18n),
        alcance: pickList(svc.contract_scope_i18n),
        especial: pick(svc.contract_special_clause_i18n),
        fees: { ...input.fees, currency: "USD" },
        schedule: input.schedule,
      });
    };

    return { es: docFor("es"), en: docFor("en") };
  } catch (err) {
    // Non-fatal: the contract still has plan_snapshot + parties_snapshot; the
    // signing page can fall back. Never block case creation on doc assembly —
    // but log it so a silent degradation is visible in production.
    logger.warn(
      { err, orgId: input.orgId },
      "cases: buildContractDocumentSnapshot failed — degrading to null",
    );
    return null;
  }
}

/**
 * Re-assembles the frozen contract `document_snapshot` from CURRENT case data —
 * used after a party name is corrected before signing, so the document the client
 * sees on /firma stays in sync. Fees come from the contract's plan_snapshot; the
 * schedule is provisional (re-anchored on signing) so it is rebuilt from the plan.
 * Returns null (degrades to no-op) on any missing piece.
 */
async function buildDocumentSnapshotForResync(
  orgId: string,
  caseId: string,
  planSnapshot: Record<string, unknown> | null | undefined,
): Promise<Record<string, unknown> | null> {
  try {
    const caseRow = await findCaseById(caseId);
    if (!caseRow) return null;
    const serviceRow = await findServiceContractRow(caseRow.service_id);
    if (!serviceRow) return null;

    const parties = await getCaseParties(caseId);
    const principal = parties.find((p) => p.party_role === PRINCIPAL_ROLE_KEY && p.user_id);
    if (!principal || !principal.user_id) return null;

    // Service party roles → included set + label map (single load).
    const includedRoles = new Set<string>();
    const roleLabelByKey = new Map<string, { es?: string; en?: string }>();
    const catalogModule = (await import("@/backend/modules/catalog")) as {
      listServicePartyRoles: (
        id: string,
      ) => Promise<Array<{ role_key: string; include_in_contract: boolean; label_i18n: { es?: string; en?: string } | null }>>;
    };
    for (const r of await catalogModule.listServicePartyRoles(caseRow.service_id)) {
      if (r.include_in_contract) includedRoles.add(r.role_key);
      roleLabelByKey.set(r.role_key, r.label_i18n ?? {});
    }

    const committedRaw = selectContractAdditionalParties(
      parties.filter((p) => p.id !== principal.id).map((p) => ({ role: p.party_role, party: p })),
      includedRoles,
    );
    const committed: Array<{ role: string; name: string | null }> = [];
    for (const c of committedRaw) committed.push({ role: c.role, name: await resolvePartyFullName(c.party) });

    const plan = (planSnapshot ?? {}) as {
      totalCents?: number; downpaymentCents?: number; installmentCount?: number; frequency?: string;
    };
    const fees = {
      totalCents: Number(plan.totalCents) || 0,
      downpaymentCents: Number(plan.downpaymentCents) || 0,
      installmentCount: Number(plan.installmentCount) || 1,
      // Pre-0063 snapshots have no frequency → monthly (historic behavior).
      frequency: (plan.frequency === "weekly" ? "weekly" : "monthly") as "weekly" | "monthly",
    };
    const { buildInstallments } = (await import("@/backend/modules/billing")) as {
      buildInstallments: (i: {
        totalCents: number; downpaymentCents: number; installmentCount: number; startDate: string;
        frequency?: "weekly" | "monthly";
      }) => Array<{ number: number; amountCents: number; dueDate: string; isDownpayment: boolean }>;
    };
    const schedule = buildInstallments({ ...fees, startDate: new Date().toISOString().slice(0, 10) }).map((d) => ({
      number: d.number,
      amountCents: d.amountCents,
      dueDate: d.dueDate,
      isDownpayment: d.isDownpayment,
    }));

    return buildContractDocumentSnapshot({
      orgId,
      serviceRow,
      clientName: await resolvePartyFullName(principal),
      committed,
      roleLabelByKey,
      fees,
      schedule,
    });
  } catch (err) {
    // Best-effort: a regen failure must never block the party-name correction.
    logger.warn({ err, caseId }, "cases: buildDocumentSnapshotForResync failed — skipping doc resync");
    return null;
  }
}

/**
 * Admin-only: corrects the name of a case party. Updates the live truth
 * (`client_profiles` for the petitioner, `person_records` for additional
 * parties) and re-syncs the contract's `parties_snapshot`.
 *
 * Blocked when the contract is already `signed` (immutable legal record):
 * throws CASE_CONTRACT_LOCKED — neither the live name nor the snapshot change.
 *
 * @api-id (internal) RF-ADM party correction
 */
export async function updateCaseParty(
  actor: Actor,
  input: UpdateCasePartyInput,
): Promise<{ resynced: boolean }> {
  can(actor, "cases", "edit");
  // Naming is an org-data correction reserved to admin (the petitioner's profile
  // is also their login identity). Ampliar a sales: añadir "sales" aquí + acción.
  if (actor.kind !== "staff" || actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }
  const parsed = UpdateCasePartySchema.parse(input);
  await requireCaseAccess(actor, parsed.caseId);

  // Signed contract is an immutable legal record — block the edit entirely.
  const { getContractForCase } = (await import("@/backend/modules/contracts")) as {
    getContractForCase: (
      a: Actor,
      caseId: string,
    ) => Promise<{ id: string; status: string; plan_snapshot?: Record<string, unknown> } | null>;
  };
  const contract = await getContractForCase(actor, parsed.caseId);
  if (contract?.status === "signed") {
    throw new CaseError("CASE_CONTRACT_LOCKED");
  }

  const parties = await getCaseParties(parsed.caseId);
  const party = parties.find((p) => p.id === parsed.partyId);
  if (!party) throw new CaseError("CASE_PARTY_NOT_FOUND");

  const beforeName = await resolvePartyFullName(party);

  // Write the live truth: petitioner → client_profiles; additional → person_records.
  if (party.user_id) {
    await updateClientProfileName(party.user_id, { firstName: parsed.firstName, lastName: parsed.lastName });
  } else if (party.person_record_id) {
    await updatePersonRecordName(party.person_record_id, { firstName: parsed.firstName, lastName: parsed.lastName });
  } else {
    throw new CaseError("CASE_PARTY_NOT_FOUND");
  }

  // Re-sync the contract snapshot (no-op when there is no contract; the signed
  // case already threw above). cases owns the model; contracts owns the snapshot.
  let resynced = false;
  if (contract) {
    const snapshot = await buildSnapshotFromCaseParties(parsed.caseId);
    if (snapshot) {
      const { resyncPartiesSnapshot, resyncDocumentSnapshot } = (await import("@/backend/modules/contracts")) as {
        resyncPartiesSnapshot: (
          a: Actor,
          caseId: string,
          snap: Record<string, unknown>,
        ) => Promise<{ resynced: boolean }>;
        resyncDocumentSnapshot: (
          a: Actor,
          caseId: string,
          snap: Record<string, unknown>,
        ) => Promise<{ resynced: boolean }>;
      };
      const r = await resyncPartiesSnapshot(actor, parsed.caseId, snapshot as unknown as Record<string, unknown>);
      resynced = r.resynced;
      // Also regenerate the FROZEN document_snapshot the signing page renders, so
      // a pre-signature name correction is reflected in the contract the client
      // sees (best-effort: a failure must not block the name correction).
      try {
        const docSnap = await buildDocumentSnapshotForResync(
          actor.orgId,
          parsed.caseId,
          contract.plan_snapshot,
        );
        if (docSnap) await resyncDocumentSnapshot(actor, parsed.caseId, docSnap);
      } catch (err) {
        logger.warn({ err, caseId: parsed.caseId }, "cases: document_snapshot resync failed — skipping");
      }
    }
  }

  await writeAudit(actor, "case.party.renamed", "case_parties", parsed.partyId, {
    before: { name: beforeName },
    after: { firstName: parsed.firstName, lastName: parsed.lastName, resynced },
  });
  await writeTimeline({
    caseId: parsed.caseId,
    eventType: "case.party.renamed",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: { en: "Party name updated", es: "Nombre de parte actualizado" },
  });

  return { resynced };
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

  // We need the first phase + milestone from catalog to seed the case pointers.
  // If unavailable, activate without them (degrades cleanly).
  let firstPhaseId: string | null = null;
  let firstMilestoneId: string | null = null;
  try {
     
    const catalogModule = await import("@/backend/modules/catalog") as any;
    if (typeof catalogModule.getCatalogFirstPhase === "function") {
      const phase = await catalogModule.getCatalogFirstPhase(caseRow.service_id);
      firstPhaseId = phase?.id ?? null;
    }
    if (typeof catalogModule.getCatalogFirstMilestone === "function") {
      const milestone = await catalogModule.getCatalogFirstMilestone(caseRow.service_id);
      firstMilestoneId = milestone?.id ?? null;
    }
  } catch (err) {
    logger.warn(
      { err, caseId: payload.caseId },
      "cases.onDownpaymentConfirmed: could not get first phase/milestone — activating without them",
    );
  }

  await updateCase(caseRow.id, {
    status: "active",
    opened_at: new Date().toISOString(),
    current_phase_id: firstPhaseId,
    current_milestone_id: firstMilestoneId,
  });

  if (firstPhaseId) {
    await insertPhaseHistory({
      caseId: caseRow.id,
      phaseId: firstPhaseId,
      enteredBy: null,
      note: "case opened (downpayment confirmed)",
    });
  }
  if (firstMilestoneId) {
    await insertMilestoneHistory({
      caseId: caseRow.id,
      milestoneId: firstMilestoneId,
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
  /**
   * Client-chosen name for the document. Used (and required) only for
   * `allow_multiple` requirements and free uploads; for single required slots
   * the server derives the name from the requirement label + party and ignores
   * this value.
   */
  displayName: z.string().max(200).nullable().optional(),
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

  // Resolve the requirement ONCE: drives the format check, the semantic name,
  // the multiple-vs-single replace logic, and the ai_extract enqueue below.
  let requirement:
    | {
        accepted_format: "pdf" | "png";
        ai_extract: boolean;
        allow_multiple: boolean;
        label_i18n: unknown;
      }
    | null = null;
  if (parsed.requirementId) {
    const sb = createServiceClient();
    const { data: rdt } = await sb
      .from("required_document_types")
      .select("accepted_format, ai_extract, allow_multiple, label_i18n")
      .eq("id", parsed.requirementId)
      .maybeSingle();
    requirement = {
      accepted_format: (rdt?.accepted_format as "pdf" | "png" | null) ?? "pdf",
      ai_extract: rdt?.ai_extract ?? false,
      allow_multiple: rdt?.allow_multiple ?? false,
      label_i18n: rdt?.label_i18n ?? null,
    };
    // Per-document accepted format (admin-configured, pdf | png). Free staff
    // uploads (no requirement) are unconstrained.
    const allowedExt = requirement.accepted_format === "png" ? ["png"] : ["pdf"];
    if (!allowedExt.includes(ext)) {
      await deleteObject("case-documents", parsed.uploadRef);
      throw new CaseError("DOC_FORMAT_NOT_ALLOWED", {
        acceptedFormat: requirement.accepted_format,
      });
    }
  }

  // Quality gate (first filter): a CLEARLY illegible / heavily blurred scan is
  // rejected BEFORE the document is registered — the object is deleted and no
  // case_documents row / event is created. Conservative + fail-open (ai-engine).
  // Applies to every upload to case-documents (client + staff). The human
  // reviewer (reviewDocument) remains the final word for borderline cases.
  if (validated.bytes) {
    const aiEngine = await import("@/backend/modules/ai-engine");
    const verdict = await aiEngine.assessDocumentLegibility({
      bytes: validated.bytes,
      mimeType,
    });
    if (!verdict.legible || verdict.blurLevel === "heavy") {
      await deleteObject("case-documents", parsed.uploadRef);
      throw new CaseError("DOC_NOT_LEGIBLE", {
        reasonEs: verdict.reasonEs,
        reasonEn: verdict.reasonEn,
      });
    }
  }

  // Semantic display name (drives the download filename):
  //  - single required slot → derived from the requirement label (ES) + party
  //    name ("Pasaporte de Juan"); the client cannot override it.
  //  - multiple / free upload → client-typed (required for multiple).
  const allowMultiple = requirement?.allow_multiple ?? false;
  let displayName: string;
  if (parsed.requirementId && !allowMultiple) {
    const labelEs = asI18n(requirement?.label_i18n)?.es?.trim() || "Documento";
    let partyName: string | null = null;
    if (parsed.partyId) {
      const party = (await getCaseParties(parsed.caseId)).find(
        (p) => p.id === parsed.partyId,
      );
      if (party) partyName = await resolvePartyName(party);
    }
    displayName = partyName ? `${labelEs} de ${partyName}` : labelEs;
  } else {
    const typed = parsed.displayName?.trim() ?? "";
    if (allowMultiple && !typed) {
      await deleteObject("case-documents", parsed.uploadRef);
      throw new CaseError("DOC_NAME_REQUIRED");
    }
    // Free staff upload with no name → fall back to the raw filename (sans ext).
    displayName = typed || parsed.originalFilename.replace(/\.[^.]+$/, "");
  }

  // Re-upload / overwrite semantics. Multiple slots: every file coexists (no
  // head lookup). Single slot, by the previous document's status:
  //  - approved → locked: no replacement allowed.
  //  - uploaded → never reviewed: hard-delete the previous file + row.
  //  - rejected → reviewed: keep as a traceable 'replaced' link (correction).
  let prev: CaseDocumentRow | null = null;
  if (!allowMultiple) {
    prev = await findCurrentChainHead(
      parsed.caseId,
      parsed.requirementId ?? null,
      parsed.partyId ?? null,
    );
    if (prev?.status === "approved") {
      await deleteObject("case-documents", parsed.uploadRef);
      throw new CaseError("DOC_ALREADY_APPROVED");
    }
  }

  // Tag the document with the phase active now (Etapa C — prior-phase visibility).
  const caseForPhase = await findCaseById(parsed.caseId);

  const doc = await insertCaseDocument({
    case_id: parsed.caseId,
    required_document_type_id: parsed.requirementId ?? null,
    party_id: parsed.partyId ?? null,
    uploaded_by: actor.userId,
    storage_path: parsed.uploadRef,
    original_filename: parsed.originalFilename,
    display_name: displayName,
    mime_type: mimeType,
    size_bytes: 0, // size validated by storage, exact value not critical here
    status: "uploaded",
    service_phase_id: caseForPhase?.current_phase_id ?? null,
    // Only the rejected→correction case keeps a traceable chain link; a
    // hard-overwritten 'uploaded' predecessor is deleted, so no link remains.
    replaces_document_id: prev?.status === "rejected" ? prev.id : null,
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason_i18n: null,
    correction_due_at: null,
  });

  if (prev?.status === "uploaded") {
    await deleteObject("case-documents", prev.storage_path);
    await deleteCaseDocumentRow(prev.id);
  } else if (prev?.status === "rejected") {
    await updateDocument(prev.id, { status: "replaced" });
  }

  // Hook F4: auto-enqueue extraction if the requirement has ai_extract=true (DOC-26 §2.2)
  if (parsed.requirementId && requirement?.ai_extract) {
    try {
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
    } catch (err) {
      // Non-fatal: extraction is async assistance, never blocks the upload confirmation
      logger.warn({ err, docId: doc.id }, "cases: failed to enqueue extract-document — continuing");
    }
  }

  // emitAndWait (not emit): the notification insert + push enqueue must complete
  // before the serverless request freezes (same pattern as reviewDocument).
  await appEvents.emitAndWait({
    type: "document.uploaded",
    payload: {
      caseId: parsed.caseId,
      documentId: doc.id,
      uploadedByKind: actor.kind === "client" ? "client" : "staff",
    },
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

/**
 * Deletes a never-reviewed ('uploaded') case document — the client (or staff)
 * removing a mistaken upload, or freeing a single slot before re-uploading.
 * Hard delete: Storage object + DB row. Reviewed documents are immutable:
 *   approved → DOC_LOCKED · rejected → DOC_REVIEWED (use the correction flow).
 *
 * @api-id API-CASE-09
 */
export async function deleteCaseDocument(
  actor: Actor,
  documentId: string,
): Promise<void> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");
  await requireCaseAccess(actor, doc.case_id);

  if (doc.status === "approved") throw new CaseError("DOC_LOCKED");
  if (doc.status === "rejected") throw new CaseError("DOC_REVIEWED");
  if (doc.status !== "uploaded") throw new CaseError("DOC_INVALID_STATE");

  await deleteObject("case-documents", doc.storage_path);
  await deleteCaseDocumentRow(doc.id);

  await writeTimeline({
    caseId: doc.case_id,
    eventType: "document.deleted",
    actorKind: actor.kind === "client" ? "client" : "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: { en: "Document removed", es: "Documento eliminado" },
  });

  if (actor.kind === "staff") {
    await writeAudit(actor, "case.document.deleted_by_staff", "case_documents", doc.id, {
      before: { caseId: doc.case_id, documentId: doc.id },
    });
  }
}

const RenameDocumentSchema = z.object({
  documentId: zUuid,
  displayName: z.string().max(200),
});
export type RenameDocumentInput = z.infer<typeof RenameDocumentSchema>;

/**
 * Renames a case document's human/semantic name (display_name). Staff use this
 * to fix a non-fitting name the client typed on a multiple-file slot — it drives
 * the download filename (e.g. "reporte-policial.pdf"). The file content and the
 * raw original_filename are untouched (audit trail intact).
 *
 * @api-id API-CASE-10
 */
export async function renameCaseDocument(
  actor: Actor,
  input: RenameDocumentInput,
): Promise<CaseDocumentRow> {
  const parsed = RenameDocumentSchema.parse(input);
  const doc = await findDocumentById(parsed.documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");
  await requireCaseAccess(actor, doc.case_id);

  const name = parsed.displayName.trim();
  if (!name) throw new CaseError("DOC_NAME_REQUIRED");

  await updateDocument(doc.id, { display_name: name });

  await writeTimeline({
    caseId: doc.case_id,
    eventType: "document.renamed",
    actorKind: actor.kind === "client" ? "client" : "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: { en: "Document renamed", es: "Documento renombrado" },
  });

  if (actor.kind === "staff") {
    await writeAudit(actor, "case.document.renamed", "case_documents", doc.id, {
      after: { displayName: name },
    });
  }

  return (await findDocumentById(doc.id)) ?? { ...doc, display_name: name };
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
// setRequirementVisibility — staff hides/shows an OPTIONAL document per case
// (RF-TRX-002, DOC-41 §3.5). Backed by case_requirement_overrides.is_hidden.
// ---------------------------------------------------------------------------

export interface SetRequirementVisibilityInput {
  caseId: string;
  /** Catalog requirement id (required_document_type_id). */
  requirementId: string | null;
  /** Specific party instance (per-party docs) or null for the whole document. */
  partyId: string | null;
  /** true → hide from client; false → restore. */
  hidden: boolean;
}

/**
 * Hides or restores an OPTIONAL document requirement for a single case so it no
 * longer shows to the client (e.g. a requirement that does not apply to this
 * case). Per-instance: a per-party doc can be hidden for one party only.
 *
 * Decisions (confirmed): only admin + sales may toggle; only optional
 * requirements (is_required=false) can be hidden — required docs are always
 * shown. Restoring deletes the override (back to the catalog default).
 */
export async function setRequirementVisibility(
  actor: Actor,
  input: SetRequirementVisibilityInput,
): Promise<void> {
  can(actor, "cases", "edit");
  // Only admin + sales configure case documents (paralegal/finance excluded).
  if (actor.kind !== "staff" || (actor.role !== "admin" && actor.role !== "sales")) {
    throw new AuthzError("forbidden_module");
  }
  await requireCaseAccess(actor, input.caseId);

  const caseRow = await findCaseById(input.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");
  if (!caseRow.current_phase_id) throw new CaseError("CASE_PHASE_INVALID");

  // Resolve the requirement in this case's context (staff view → includes hidden
  // so a previously-hidden item can be located and restored).
  const parties = await getCaseParties(input.caseId);
  const overrides = await getRequirementOverrides(input.caseId);
   
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
    include_hidden: true,
  });

  const target = (resolved.documents as Array<{
    required_document_type_id: string | null;
    party_id: string | null;
    is_required: boolean;
  }>).find(
    (d) =>
      d.required_document_type_id === input.requirementId &&
      d.party_id === input.partyId,
  );
  if (!target) throw new CaseError("DOC_REQUIREMENT_NOT_FOUND");

  // Only optional requirements may be hidden (required docs are always shown).
  if (input.hidden && target.is_required) {
    throw new CaseError("REQUIREMENT_NOT_OPTIONAL");
  }

  const existing = await findRequirementOverride(
    input.caseId,
    input.requirementId,
    input.partyId,
  );

  if (input.hidden) {
    if (existing) {
      await updateRequirementOverride(existing.id, { is_hidden: true });
    } else {
      await insertRequirementOverride({
        case_id: input.caseId,
        required_document_type_id: input.requirementId,
        party_id: input.partyId,
        is_hidden: true,
        created_by: actor.userId,
      });
    }
  } else if (existing) {
    // Restore: if the override only carried visibility, delete it (clean
    // default). If it also carries a label/requirement override, keep those.
    if (existing.is_required === null && existing.custom_label_i18n === null) {
      await deleteRequirementOverride(input.caseId, existing.id);
    } else {
      await updateRequirementOverride(existing.id, { is_hidden: false });
    }
  }

  await writeAudit(
    actor,
    input.hidden ? "case.requirement.hidden" : "case.requirement.shown",
    "case_requirement_overrides",
    input.caseId,
    {
      after: {
        requirementId: input.requirementId,
        partyId: input.partyId,
        hidden: input.hidden,
      },
    },
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
// advanceCasePhase — phase boundary = close phase & restart the cycle
// ---------------------------------------------------------------------------

const AdvancePhaseSchema = z.object({
  caseId: zUuid,
  /** Explicit later phase; when omitted, advances to the next phase by position. */
  toPhaseId: zUuid.nullable().optional(),
  /** Sales owner for the new phase (required only when several are eligible). */
  toOwnerId: zUuid.nullable().optional(),
  /** Admin-only: bypass the "expediente printed" gate. */
  force: z.boolean().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type AdvanceCasePhaseInput = z.infer<typeof AdvancePhaseSchema>;

export interface AdvanceCasePhaseResult {
  phaseId: string;
  /** 1-based index of the resulting phase. */
  phaseIndex: number;
  phaseCount: number;
  labelI18n: I18nValue | null;
  /** True when this advance completed the case (last phase). */
  completed: boolean;
  /** Stage the case lands in after advancing ('sales' on a new phase, 'done' on completion). */
  stage: CaseStage;
  /** New responsible (the sales owner), or null when completed. */
  ownerId: string | null;
}

/**
 * Crosses the phase boundary: closes the current phase and either restarts the
 * cycle on the next phase (back to the `sales` stage / Vanessa) or completes the
 * case when there is no next phase. Manual, staff-driven — **admin + finance**
 * (Andrium prints the phase's expediente, then advances). Gated on the current
 * phase's expediente being `printed` (admin may `force`).
 *
 * On a next-phase advance it resets `current_stage='sales'`, reassigns the case
 * to a sales owner, moves the kanban card (case.owner_changed), records the
 * phase + stage transitions, surfaces it on the client timeline, and notifies
 * sales + client (case.phase_advanced). On the last phase it marks the case
 * `completed` and emits `case.completed` for retention hooks.
 *
 * @api-id API-CASE-26 (advance phase)
 */
export async function advanceCasePhase(
  actor: Actor,
  input: AdvanceCasePhaseInput,
): Promise<AdvanceCasePhaseResult> {
  // The phase boundary is an operations action (it follows printing). Andrium
  // (finance) holds `printing:edit`; admin bypasses. Sales/paralegal excluded.
  if (
    actor.kind !== "staff" ||
    (actor.role !== "admin" && actor.role !== "finance")
  ) {
    throw new AuthzError("forbidden_module");
  }
  can(actor, "printing", "edit");
  const parsed = AdvancePhaseSchema.parse(input);
  await requireCaseAccess(actor, parsed.caseId);

  const caseRow = await findCaseById(parsed.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");
  if (!caseRow.current_phase_id) throw new CaseError("CASE_PHASE_INVALID");

  const fromStage = (caseRow.current_stage ?? "operations") as CaseStage;
  const fromOwnerId = caseRow.current_owner_id;
  const isAdmin = actor.role === "admin";

  // Gate: only advance from the operations stage (right after printing) with the
  // current phase's expediente `printed`. The stage guard also prevents a double
  // advance (the printed expediente lingers as the latest until the next phase
  // builds one). Admin may `force` past both checks.
  if (!(isAdmin && parsed.force)) {
    if (fromStage !== "operations") {
      throw new CaseError("STAGE_NOT_READY");
    }
    let latestExpedienteStatus: string | null = null;
    try {
      const exp = (await import("@/backend/modules/expediente")) as {
        getCaseExpedientes: (a: Actor, c: string) => Promise<Array<{ status: string; attempt_no: number }>>;
      };
      const rows = await exp.getCaseExpedientes(actor, caseRow.id);
      // DESC by attempt_no → the first row is the current phase's latest expediente.
      latestExpedienteStatus = rows[0]?.status ?? null;
    } catch (err) {
      // Fail closed: an unreadable expediente status blocks the advance below.
      logger.warn({ err, caseId: caseRow.id }, "advanceCasePhase: expediente gate read failed");
      latestExpedienteStatus = null;
    }
    if (latestExpedienteStatus !== "printed") {
      throw new CaseError("CASE_PHASE_NOT_PRINTED");
    }
  }

  const phases = await listServicePhases(caseRow.service_id);
  const refs = phases.map((p) => ({ id: p.id, position: p.position }));

  // Resolve the target: an explicit later phase, or the immediate next one.
  let target: { id: string; position: number } | null;
  if (parsed.toPhaseId) {
    const cur = refs.find((p) => p.id === caseRow.current_phase_id);
    const tgt = refs.find((p) => p.id === parsed.toPhaseId);
    if (!cur || !tgt || tgt.position <= cur.position) {
      throw new CaseError("CASE_INVALID_TRANSITION");
    }
    target = tgt;
  } else {
    target = resolveNextPhase(refs, caseRow.current_phase_id);
  }

  // ── Last phase: advancing completes the case ─────────────────────────────
  if (!target) {
    await updateCase(caseRow.id, {
      current_stage: "done",
      current_owner_id: null,
      status: "completed",
      completed_at: new Date().toISOString(),
    });
    await insertStageHistory({
      caseId: caseRow.id,
      fromStage,
      toStage: "done",
      fromOwnerId,
      toOwnerId: null,
      actorId: actor.userId,
      note: parsed.note ?? "case completed",
    });
    await writeTimeline({
      caseId: caseRow.id,
      eventType: "case.completed",
      actorKind: "team",
      actorUserId: actor.userId,
      visibleToClient: true,
      titleI18n: {
        es: "¡Tu caso fue completado! Gracias por confiar en nosotros.",
        en: "Your case is complete! Thank you for trusting us.",
      },
    });
    await writeAudit(actor, "case.completed", "cases", caseRow.id, {
      before: { status: caseRow.status, stage: fromStage },
      after: { status: "completed", stage: "done" },
    });
    // Remove the kanban card from the operations board + fire retention hooks.
    await appEvents.emitAndWait({
      type: "case.owner_changed",
      payload: { caseId: caseRow.id, orgId: actor.orgId, fromOwnerId, toOwnerId: null },
      occurredAt: new Date(),
    });
    await appEvents.emitAndWait({
      type: "case.completed",
      payload: { caseId: caseRow.id, orgId: actor.orgId, clientId: caseRow.primary_client_id },
      occurredAt: new Date(),
    });
    const currentPhase = phases.find((p) => p.id === caseRow.current_phase_id);
    return {
      phaseId: caseRow.current_phase_id,
      phaseIndex: phases.findIndex((p) => p.id === caseRow.current_phase_id) + 1,
      phaseCount: phases.length,
      labelI18n: asI18n(currentPhase?.label_i18n),
      completed: true,
      stage: "done",
      ownerId: null,
    };
  }

  // ── Next phase: restart the cycle at the sales stage (back to Vanessa) ───
  const salesCandidates = await eligibleOwnersForStage(actor.orgId, "sales");
  let salesOwnerId: string;
  if (parsed.toOwnerId) {
    if (!salesCandidates.some((c) => c.userId === parsed.toOwnerId)) {
      throw new CaseError("STAGE_INVALID_OWNER");
    }
    salesOwnerId = parsed.toOwnerId;
  } else if (
    caseRow.assigned_sales_id &&
    salesCandidates.some((c) => c.userId === caseRow.assigned_sales_id)
  ) {
    salesOwnerId = caseRow.assigned_sales_id;
  } else if (salesCandidates.length === 1) {
    salesOwnerId = salesCandidates[0].userId;
  } else if (salesCandidates.length === 0) {
    throw new CaseError("STAGE_NO_OWNER");
  } else {
    throw new CaseError("STAGE_OWNER_REQUIRED", { candidates: salesCandidates });
  }

  const targetPhase = phases.find((p) => p.id === target!.id)!;
  const labelI18n = asI18n(targetPhase.label_i18n);
  const phaseName = (l: "es" | "en") => (labelI18n ? (labelI18n[l] ?? "") : "");

  await updateCase(caseRow.id, {
    current_phase_id: target.id,
    current_stage: "sales",
    current_owner_id: salesOwnerId,
    assigned_sales_id: salesOwnerId,
    status: "active",
  });
  await insertPhaseHistory({
    caseId: caseRow.id,
    phaseId: target.id,
    enteredBy: actor.userId,
    note: parsed.note ?? null,
  });
  await insertStageHistory({
    caseId: caseRow.id,
    fromStage,
    toStage: "sales",
    fromOwnerId,
    toOwnerId: salesOwnerId,
    actorId: actor.userId,
    note: "phase advanced — cycle restart",
  });
  await writeTimeline({
    caseId: caseRow.id,
    eventType: "phase.advanced",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      es: `Tu caso avanzó a la fase: ${phaseName("es")}`,
      en: `Your case advanced to phase: ${phaseName("en")}`,
    },
  });
  await writeAudit(actor, "case.phase_advanced", "cases", caseRow.id, {
    before: { phaseId: caseRow.current_phase_id, stage: fromStage, ownerId: fromOwnerId },
    after: { phaseId: target.id, stage: "sales", ownerId: salesOwnerId },
  });
  // Move the kanban card to the new sales owner (off the operations board).
  await appEvents.emitAndWait({
    type: "case.owner_changed",
    payload: { caseId: caseRow.id, orgId: actor.orgId, fromOwnerId, toOwnerId: salesOwnerId },
    occurredAt: new Date(),
  });
  // Notify sales (Vanessa) + client (consumer → notifyFromEvent via the F2 matrix).
  await appEvents.emitAndWait({
    type: "case.phase_advanced",
    payload: {
      caseId: caseRow.id,
      orgId: actor.orgId,
      phaseEs: phaseName("es"),
      phaseEn: phaseName("en"),
    },
    occurredAt: new Date(),
  });

  return {
    phaseId: target.id,
    phaseIndex: phases.findIndex((p) => p.id === target!.id) + 1,
    phaseCount: phases.length,
    labelI18n,
    completed: false,
    stage: "sales",
    ownerId: salesOwnerId,
  };
}

// ---------------------------------------------------------------------------
// advanceCaseMilestone — manual milestone progression (admin/paralegal)
// ---------------------------------------------------------------------------

const AdvanceMilestoneSchema = z.object({
  caseId: zUuid,
  /** Explicit milestone to jump to (must be strictly ahead); else the next one. */
  toMilestoneId: zUuid.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export type AdvanceCaseMilestoneInput = z.infer<typeof AdvanceMilestoneSchema>;

export interface AdvanceCaseMilestoneResult {
  milestoneId: string;
  labelI18n: I18nValue | null;
  /** True when advancing crossed into a new phase (current_phase_id moved too). */
  phaseChanged: boolean;
}

/**
 * Advances a case to the next milestone (or an explicit later one). Manual,
 * staff-driven (admin + paralegal). Milestones are the progression unit; when the
 * target milestone belongs to a different phase, the case's `current_phase_id` is
 * moved in sync (documents/forms/citas key off the phase). Records
 * case_milestone_history (+ case_phase_history on a phase change), surfaces a
 * client-visible timeline event, and audits it.
 *
 * @api-id API-CASE-27 (advance milestone)
 */
export async function advanceCaseMilestone(
  actor: Actor,
  input: AdvanceCaseMilestoneInput,
): Promise<AdvanceCaseMilestoneResult> {
  can(actor, "cases", "edit");
  if (
    actor.kind !== "staff" ||
    (actor.role !== "admin" && actor.role !== "paralegal")
  ) {
    throw new AuthzError("forbidden_module");
  }
  const parsed = AdvanceMilestoneSchema.parse(input);
  await requireCaseAccess(actor, parsed.caseId);

  const caseRow = await findCaseById(parsed.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const milestones = await listServiceMilestones(caseRow.service_id);
  if (milestones.length === 0) throw new CaseError("CASE_NO_MILESTONES");
  const refs = milestones.map((m) => ({
    id: m.id,
    phasePosition: m.phase_position,
    position: m.position,
  }));
  const ordered = [...refs].sort(
    (a, b) => a.phasePosition - b.phasePosition || a.position - b.position,
  );

  // Seed the current pointer from the case, or the first milestone if unset.
  const currentId = caseRow.current_milestone_id ?? resolveFirstMilestone(refs)?.id ?? null;

  let target: { id: string; phasePosition: number; position: number } | null;
  if (parsed.toMilestoneId) {
    const curIdx = currentId ? ordered.findIndex((m) => m.id === currentId) : -1;
    const tgtIdx = ordered.findIndex((m) => m.id === parsed.toMilestoneId);
    if (tgtIdx < 0 || tgtIdx <= curIdx) throw new CaseError("CASE_INVALID_TRANSITION");
    target = ordered[tgtIdx];
  } else {
    target = resolveNextMilestone(refs, currentId);
  }
  if (!target) throw new CaseError("CASE_ALREADY_LAST_MILESTONE");

  const targetRow = milestones.find((m) => m.id === target!.id)!;
  const phases = await listServicePhases(caseRow.service_id);
  const targetPhase = phases.find((p) => p.position === target!.phasePosition) ?? null;
  const phaseChanged = !!targetPhase && targetPhase.id !== caseRow.current_phase_id;

  const updates: TablesUpdate<"cases"> = { current_milestone_id: target.id };
  if (phaseChanged && targetPhase) updates.current_phase_id = targetPhase.id;
  await updateCase(caseRow.id, updates);

  await insertMilestoneHistory({
    caseId: caseRow.id,
    milestoneId: target.id,
    enteredBy: actor.userId,
    note: parsed.note ?? null,
  });
  if (phaseChanged && targetPhase) {
    await insertPhaseHistory({
      caseId: caseRow.id,
      phaseId: targetPhase.id,
      enteredBy: actor.userId,
      note: parsed.note ?? null,
    });
  }

  const labelI18n = asI18n(targetRow.label_i18n);
  const name = (l: "es" | "en") => (labelI18n ? (labelI18n[l] ?? "") : "");
  await writeTimeline({
    caseId: caseRow.id,
    eventType: "milestone.advanced",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      es: `Tu caso avanzó a: ${name("es")}`,
      en: `Your case advanced to: ${name("en")}`,
    },
  });

  await writeAudit(actor, "case.milestone_advanced", "cases", caseRow.id, {
    before: {
      milestoneId: caseRow.current_milestone_id,
      phaseId: caseRow.current_phase_id,
    },
    after: {
      milestoneId: target.id,
      phaseId: phaseChanged && targetPhase ? targetPhase.id : caseRow.current_phase_id,
    },
  });

  return { milestoneId: target.id, labelI18n, phaseChanged };
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
  /** Primary client phone (E.164) — powers the clients search. */
  clientPhone: string | null;
  serviceLabelI18n: I18nValue | null;
  /** Brand/Material icon name for the service (catalog `services.icon`). */
  serviceIcon: string | null;
  /** Service accent color token/hex (catalog `services.color`). */
  serviceColor: string | null;
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

  // Batch the client phones in one query (not N+1) for the clients search.
  const clientIds = page.items
    .map((c) => c.primary_client_id)
    .filter((x): x is string => !!x);
  const phonesById = await findClientPhonesByIds(clientIds);

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
        clientPhone: c.primary_client_id ? (phonesById[c.primary_client_id] ?? null) : null,
        serviceLabelI18n: asI18n(service?.label_i18n),
        serviceIcon: service?.icon ?? null,
        serviceColor: service?.color ?? null,
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

export interface BookableCaseResult {
  caseId: string;
  name: string;
  phone: string | null;
  clientTz: string | null;
  serviceLabel: string;
}

/**
 * Searches the org's ACTIVE cases for the staff "Nueva cita" client picker.
 * Matches the query (case-insensitive) against the client's display/legal name,
 * the case number, or the client's phone. Enrichment is batched in the repo
 * (no N+1). Returns up to `limit` results. Empty query → most-recent active.
 *
 * @api-id API-SCH-13
 */
export async function searchBookableCases(
  actor: Actor,
  query: string,
  locale: "es" | "en" = "es",
  limit = 20,
): Promise<BookableCaseResult[]> {
  can(actor, "cases", "view");

  const rows = await getActiveCasesEnriched(actor.orgId);
  const q = query.trim().toLowerCase();
  const results: BookableCaseResult[] = [];

  for (const r of rows) {
    const legal = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
    const name = r.preferredName ?? (legal || r.caseNumber);
    const label = asI18n(r.serviceLabelI18n);
    const haystack = `${name} ${legal} ${r.caseNumber} ${r.phone ?? ""}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    results.push({
      caseId: r.caseId,
      name,
      phone: r.phone,
      clientTz: r.timezone,
      serviceLabel: label?.[locale] ?? label?.es ?? label?.en ?? "",
    });
    if (results.length >= limit) break;
  }

  return results;
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
 * Returns a case document's raw bytes + metadata for inline preview. Authorized
 * by case access. Streamed through a same-origin route handler so the file can
 * be viewed (PDF/image) without exposing a signed URL or forcing a download.
 */
export async function getCaseDocumentBytes(
  actor: Actor,
  documentId: string,
): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");
  await requireCaseAccess(actor, doc.case_id);
  const bytes = await downloadBytesFromStorage("case-documents", doc.storage_path);

  // Semantic download filename: slugified display name + the real extension.
  // display_name is set on every new upload; legacy rows fall back to the raw
  // original filename base (still slugified for a clean, intuitive download).
  const extFromPath = doc.storage_path.includes(".")
    ? doc.storage_path.split(".").pop()!
    : "";
  const extFromOriginal = doc.original_filename?.includes(".")
    ? doc.original_filename.split(".").pop()!
    : "";
  const ext = (extFromPath || extFromOriginal || "").toLowerCase();
  const baseName =
    doc.display_name?.trim() ||
    doc.original_filename?.replace(/\.[^.]+$/, "") ||
    "documento";

  return {
    bytes,
    mimeType: doc.mime_type ?? "application/octet-stream",
    filename: toDownloadFilename(baseName, ext),
  };
}

/**
 * Returns the Gemini extraction status + extracted fields for a case document.
 * The client polls this after uploading an ai_extract document to render the
 * "analizando con IA…" state and the read-only review of what was read.
 * Authorized via the owning case (requireCaseAccess). Never returns raw_text.
 *
 * Status `null` means no extraction row exists yet (job not started / not an
 * ai_extract document) — the client keeps polling until a timeout.
 *
 * @api-id API-CASE-08
 */
export async function getDocumentExtractionStatus(
  actor: Actor,
  documentId: string,
): Promise<{
  status: "pending" | "completed" | "failed" | null;
  payload: Record<string, unknown> | null;
}> {
  const doc = await findDocumentById(documentId);
  if (!doc) throw new CaseError("DOC_NOT_FOUND");
  await requireCaseAccess(actor, doc.case_id);

  const ext = await findDocumentExtractionByCaseDocId(documentId);
  if (!ext) return { status: null, payload: null };

  const status = ext.status as "pending" | "completed" | "failed";
  let payload: Record<string, unknown> | null = null;
  if (status === "completed" && ext.payload && typeof ext.payload === "object") {
    // Defensive: raw_text is excluded from payload at write time, but strip it
    // here too so it never reaches the client review UI.
    const { raw_text: _rawText, ...rest } = ext.payload as Record<string, unknown>;
    payload = rest;
  }
  return { status, payload };
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
  /** Legal name parts (for admin edit prefill); null when unnamed. */
  firstName: string | null;
  lastName: string | null;
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
  /** Primary client's account phone (users.phone_e164) — for the header subtitle. */
  clientPhone: string | null;
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
  user_id?: string | null;
}): Promise<string | null> {
  if (party.person_record_id) {
    const person = await findPersonRecord(party.person_record_id);
    if (person) return `${person.first_name} ${person.last_name}`.trim();
  }
  // The applicant/petitioner party is stored with user_id (no person_record),
  // so per-party docs on the applicant resolve their name from the client profile.
  if (party.user_id) {
    return findClientDisplayName(party.user_id);
  }
  return null;
}

/**
 * Resolves a party's legal name PARTS (first/last) — for admin edit prefill.
 * Petitioner from client_profiles, additional parties from person_records.
 */
async function resolvePartyNameParts(party: {
  person_record_id: string | null;
  user_id?: string | null;
}): Promise<{ firstName: string | null; lastName: string | null }> {
  if (party.person_record_id) {
    const person = await findPersonRecord(party.person_record_id);
    if (person) return { firstName: person.first_name, lastName: person.last_name };
  }
  if (party.user_id) {
    const cp = await findClientFullName(party.user_id);
    if (cp) return { firstName: cp.first_name, lastName: cp.last_name };
  }
  return { firstName: null, lastName: null };
}

interface DocsCount {
  total: number;
  done: number;
  pending: number;
}

/** Maps a stored case document row to the per-file view-model used by the
 *  documents matrix (one entry per uploaded file within a requirement slot). */
function toUploadVM(d: CaseDocumentRow): UploadedDocVM {
  return {
    documentId: d.id,
    displayName: d.display_name ?? d.original_filename,
    originalFilename: d.original_filename,
    status:
      d.status === "approved"
        ? "aprobado"
        : d.status === "rejected"
          ? "corregir"
          : "revision",
    mimeType: d.mime_type,
    createdAt: d.created_at,
    rejectionReasonI18n: asI18n(d.rejection_reason_i18n),
    correctionDueAt: d.correction_due_at,
    translationNotRequired: d.translation_not_required ?? false,
  };
}

/**
 * Derives the documents matrix for the case's current phase and a doc count.
 * Internal helper shared by getCaseWorkspace + getDocumentsMatrix.
 */
async function buildDocumentsMatrix(
  caseRow: CaseRow,
  opts: { includeHidden?: boolean } = {},
): Promise<{ items: DocumentMatrixItem[]; counts: DocsCount }> {
  if (!caseRow.current_phase_id) {
    return { items: [], counts: { total: 0, done: 0, pending: 0 } };
  }

  const overrides = await getRequirementOverrides(caseRow.id);
  const parties = await getCaseParties(caseRow.id);
  const documents = await listCaseDocuments(caseRow.id);

  // Resolve the catalog requirements (per-party expansion + overrides) via the
  // catalog module's runtime resolver (no cross-table read inside catalog).
  // includeHidden=true (staff) keeps hidden requirements flagged; the client
  // view (default) drops them entirely.
   
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
    include_hidden: opts.includeHidden ?? false,
  });

  // All non-replaced docs per (requirement, party) key — `documents` is desc by
  // created_at. Single slots use the head (first); multiple slots expose the list.
  const byKey = new Map<string, CaseDocumentRow[]>();
  for (const d of documents) {
    if (d.status === "replaced") continue;
    const key = `${d.required_document_type_id ?? "free"}:${d.party_id ?? "case"}`;
    const list = byKey.get(key);
    if (list) list.push(d);
    else byKey.set(key, [d]);
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
      is_hidden?: boolean;
      accepted_format?: "pdf" | "png";
      ai_extract?: boolean;
      allow_multiple?: boolean;
      position: number;
    }) => {
      const docKey = `${r.required_document_type_id ?? "free"}:${r.party_id ?? "case"}`;
      const slotDocs = byKey.get(docKey) ?? [];
      const allowMultiple = r.allow_multiple ?? false;
      const uploads: UploadedDocVM[] = slotDocs.map(toUploadVM);
      const head = slotDocs[0];

      // Slot status. Single slot: mirrors the head document. Multiple slot is a
      // container — pendiente if empty, aprobado when every file is approved,
      // otherwise revision (per-file states live in `uploads`).
      let status: DocumentMatrixItem["status"];
      if (allowMultiple) {
        status =
          uploads.length === 0
            ? "pendiente"
            : uploads.every((u) => u.status === "aprobado")
              ? "aprobado"
              : "revision";
      } else {
        status =
          head == null
            ? "pendiente"
            : head.status === "approved"
              ? "aprobado"
              : head.status === "rejected"
                ? "corregir"
                : "revision";
      }

      return {
        key: r.key,
        requirementId: r.required_document_type_id,
        partyId: r.party_id,
        partyName: r.party_id ? (partyNameById.get(r.party_id) ?? null) : null,
        labelI18n: asI18n(r.label_i18n) ?? { en: "", es: "" },
        helpI18n: asI18n(r.help_i18n),
        categoryI18n: asI18n(r.category_i18n),
        isRequired: r.is_required,
        isHidden: r.is_hidden ?? false,
        acceptedFormat: r.accepted_format ?? "pdf",
        aiExtract: r.ai_extract ?? false,
        allowMultiple,
        position: r.position,
        status,
        documentId: head?.id ?? null,
        uploads,
        rejectionReasonI18n: head ? asI18n(head.rejection_reason_i18n) : null,
        correctionDueAt: head?.correction_due_at ?? null,
        translationNotRequired: head?.translation_not_required ?? false,
      };
    },
  );

  // Count BOTH required and optional requirements (DOC-41: the client sees every
  // requested document). The only way a document stops counting is when staff
  // hides (disables) it for this specific case — case_requirement_overrides.is_hidden,
  // which only applies to optional ones. Hidden items are flagged for staff and
  // dropped entirely for the client, so filtering them here is correct for both.
  const counted = items.filter((i) => !i.isHidden);
  const done = counted.filter(
    (i) => i.status === "aprobado" || i.status === "revision",
  ).length;
  const pending = counted.filter(
    (i) => i.status === "pendiente" || i.status === "corregir",
  ).length;

  return {
    items,
    counts: { total: counted.length, done, pending },
  };
}

/** One uploaded file within a requirement slot (the unit a multiple slot lists). */
export interface UploadedDocVM {
  documentId: string;
  /** Semantic/human name (display_name, falling back to the raw filename). */
  displayName: string;
  originalFilename: string;
  status: "revision" | "aprobado" | "corregir";
  mimeType: string;
  createdAt: string;
  rejectionReasonI18n: I18nValue | null;
  correctionDueAt: string | null;
  translationNotRequired: boolean;
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
  /** Staff view only: true when an override hides this requirement from the client. */
  isHidden: boolean;
  /** Accepted upload format for this document (admin-configured): pdf | png. */
  acceptedFormat: "pdf" | "png";
  /** True when the document has AI extraction enabled (ai_extract=true). */
  aiExtract: boolean;
  /** Admin-configured: the client may upload more than one file for this slot. */
  allowMultiple: boolean;
  position: number;
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  /** Head/latest document id (single slot), or latest of the list (multiple). */
  documentId: string | null;
  /** All current (non-replaced) files for this slot. 0/1 for single, N for multiple. */
  uploads: UploadedDocVM[];
  rejectionReasonI18n: I18nValue | null;
  correctionDueAt: string | null;
  /** Staff marked this document as already-English (excluded from translation gating). */
  translationNotRequired: boolean;
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

  // Merge per-case extra/intermediate citas (added by staff on this single case)
  // so the client sees them as hitos in their "Mi proceso" cronograma. Degrades
  // to a no-op when there are no extras (or the table is absent pre-migration).
  try {
    const scheduling = await import("@/backend/modules/scheduling");
    const extras = await scheduling.getCaseRouteExtras(caseId);
    for (const e of extras) {
      citas.push({
        sequenceNumber: e.sequenceNumber,
        durationMinutes: e.durationMinutes,
        kind: e.kind,
        weekOffset: e.weekOffset,
        phaseLabelI18n: asI18n(e.phaseLabelI18n),
        citaLabelI18n: asI18n(e.labelI18n),
        estDate: addWeeksToAnchorIso(anchorIso, e.weekOffset),
      });
    }
    citas.sort((a, b) => a.weekOffset - b.weekOffset || a.sequenceNumber - b.sequenceNumber);
  } catch (err) {
    logger.warn({ err, caseId }, "cases.getCaseTimeline: route extras merge skipped");
  }

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
    const parts = await resolvePartyNameParts(p);
    parties.push({
      id: p.id,
      role: p.party_role,
      name: await resolvePartyName(p),
      firstName: parts.firstName,
      lastName: parts.lastName,
    });
  }

  // Primary client's account phone for the header subtitle (staff surfaces).
  const clientPhone = caseRow.primary_client_id
    ? ((await findUserContactFields(caseRow.primary_client_id))?.phone_e164 ?? null)
    : null;

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
    clientPhone,
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
  opts: { includeHidden?: boolean } = {},
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

  // Defense in depth: hidden requirements are only ever exposed to staff. Even
  // if includeHidden leaks to a client-facing caller, clients never see them.
  const includeHidden = opts.includeHidden === true && actor.kind === "staff";
  const { items, counts } = await buildDocumentsMatrix(caseRow, { includeHidden });
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
  /** Approximate week of the milestone (admin-configured), or null. */
  weekOffset: number | null;
  /** Derived state relative to the case's current milestone (global order). */
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

  // Milestones are the progression unit: state derives from current_milestone_id
  // in global order (phase, then position). Fallback for cases activated before
  // milestone tracking existed: the first milestone of the current phase.
  const ordered = [...milestones].sort(
    (a, b) => a.phase_position - b.phase_position || a.position - b.position,
  );
  let currentId: string | null = caseRow.current_milestone_id ?? null;
  if (!currentId && currentPhase) {
    currentId = ordered.find((m) => m.phase_position === currentPhase.position)?.id ?? null;
  }
  const currentIdx = currentId ? ordered.findIndex((m) => m.id === currentId) : -1;

  const items: CaseMilestoneItem[] = ordered.map((m, idx) => {
    let state: CaseMilestoneItem["state"];
    if (currentIdx < 0) state = "locked";
    else if (idx < currentIdx) state = "completed";
    else if (idx === currentIdx) state = "current";
    else if (idx === currentIdx + 1) state = "next";
    else state = "locked";
    return {
      id: m.id,
      labelI18n: asI18n(m.label_i18n) ?? { en: "", es: "" },
      descriptionI18n: asI18n(m.description_i18n),
      glossaryI18n: asI18n(m.glossary_i18n),
      icon: m.icon,
      phasePosition: m.phase_position,
      weekOffset: m.week_offset ?? null,
      state,
      progress: state === "current" ? progress : null,
    };
  });

  return { phaseIndex, phaseCount: phases.length, milestones: items };
}

// ---------------------------------------------------------------------------
// getCaseProgressTimeline — unified "Mi proceso" timeline (milestones + citas)
// ---------------------------------------------------------------------------

export type ProgressTimelineItem =
  | {
      kind: "milestone";
      id: string;
      labelI18n: I18nValue;
      descriptionI18n: I18nValue | null;
      glossaryI18n: I18nValue | null;
      icon: string;
      weekOffset: number | null;
      state: "completed" | "current" | "next" | "locked";
      progress: number | null;
    }
  | {
      kind: "appointment";
      id: string;
      labelI18n: I18nValue | null;
      citaKind: string;
      weekOffset: number;
      sequenceNumber: number;
      status: "completed" | "booked" | "unbooked";
      appointmentId: string | null;
      startsAt: string | null;
    };

export interface CaseProgressTimelineDto {
  phaseIndex: number;
  phaseCount: number;
  started: boolean;
  totalWeeks: number;
  items: ProgressTimelineItem[];
}

/**
 * Unified client "Mi proceso" timeline: legal milestones (states from
 * current_milestone_id) interleaved with the service's citas (cronograma
 * template resolved against the case's real appointments), ordered by week.
 * Catalog/scheduling are imported dynamically to avoid a static module cycle.
 *
 * @api-id API-CASE-28 (progress timeline)
 */
export async function getCaseProgressTimeline(
  actor: Actor,
  caseId: string,
): Promise<CaseProgressTimelineDto> {
  const ms = await getCaseMilestones(actor, caseId); // requireCaseAccess inside
  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

   
  const catalog = (await import("@/backend/modules/catalog")) as any;
  const cron = await catalog.getServiceCronograma(caseRow.service_id);
   
  const scheduling = (await import("@/backend/modules/scheduling")) as any;
  const appts: Array<{
    id: string;
    service_phase_id: string | null;
    sequence_number: number | null;
    status: string;
    starts_at: string;
  }> = await scheduling.getCaseAppointments(actor, caseId).catch(() => []);

  const milestoneItems: ProgressTimelineItem[] = ms.milestones.map((m) => ({
    kind: "milestone",
    id: m.id,
    labelI18n: m.labelI18n,
    descriptionI18n: m.descriptionI18n,
    glossaryI18n: m.glossaryI18n,
    icon: m.icon,
    weekOffset: m.weekOffset,
    state: m.state,
    progress: m.progress,
  }));

  const apptItems: ProgressTimelineItem[] = (
    (cron.citas ?? []) as Array<{
      phaseId: string;
      sequenceNumber: number;
      kind: string;
      weekOffset: number;
      labelI18n: unknown;
    }>
  ).map((c) => {
    const match = appts.find(
      (a) =>
        a.service_phase_id === c.phaseId &&
        a.sequence_number === c.sequenceNumber &&
        (a.status === "scheduled" || a.status === "completed"),
    );
    const status: "completed" | "booked" | "unbooked" =
      match?.status === "completed" ? "completed" : match ? "booked" : "unbooked";
    return {
      kind: "appointment",
      id: `${c.phaseId}:${c.sequenceNumber}`,
      labelI18n: asI18n(c.labelI18n),
      citaKind: c.kind,
      weekOffset: c.weekOffset,
      sequenceNumber: c.sequenceNumber,
      status,
      appointmentId: match?.id ?? null,
      startsAt: match?.starts_at ?? null,
    };
  });

  // Interleave by week; same week → milestone before appointment. Milestones with
  // no week sort to the end (admin is expected to set a week for proper ordering).
  const items = [...milestoneItems, ...apptItems].sort((a, b) => {
    const wa = a.weekOffset ?? Number.MAX_SAFE_INTEGER;
    const wb = b.weekOffset ?? Number.MAX_SAFE_INTEGER;
    if (wa !== wb) return wa - wb;
    return (a.kind === "milestone" ? 0 : 1) - (b.kind === "milestone" ? 0 : 1);
  });

  return {
    phaseIndex: ms.phaseIndex,
    phaseCount: ms.phaseCount,
    started: caseRow.opened_at != null,
    totalWeeks: cron.totalWeeks ?? 0,
    items,
  };
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
/**
 * Request-scoped memo cache for prefill resolution. A single form load resolves
 * MANY questions against the SAME client profile / primary client / contact row;
 * without this each `source='profile'` question re-queries them (N+1). Callers
 * that resolve one question in isolation (e.g. a single ai_field) omit it.
 */
export interface FormResolveCache {
  primaryClientId?: Promise<string | null>;
  profile?: Promise<Awaited<ReturnType<typeof findClientProfileForForm>>>;
  userContact?: Promise<Awaited<ReturnType<typeof findUserContactFields>>>;
}

export async function resolveBySource(
  question: {
    id: string;
    source: string;
    source_ref: unknown;
  },
  responseAnswers: Record<string, unknown>,
  caseId: string,
  partyId: string | null,
  cache?: FormResolveCache,
): Promise<unknown> {
  // Memoized loaders — dedupe the profile/client/contact lookups across every
  // question in one form load. Concurrent (Promise.all) callers share the promise.
  // EVICT on rejection: a memoized REJECTED promise would turn one transient DB
  // hiccup into "every profile-sourced field on the form goes blank" (each caller
  // reuses the same rejection instead of retrying). Clearing the slot on failure
  // keeps a failure isolated to the question that hit it.
  const loadPrimaryClient = (): Promise<string | null> => {
    if (!cache) return findCasePrimaryClient(caseId);
    return (cache.primaryClientId ??= findCasePrimaryClient(caseId).catch((e) => {
      cache.primaryClientId = undefined;
      throw e;
    }));
  };
  const loadProfile = (pid: string): Promise<Awaited<ReturnType<typeof findClientProfileForForm>>> => {
    if (!cache) return findClientProfileForForm(pid);
    return (cache.profile ??= findClientProfileForForm(pid).catch((e) => {
      cache.profile = undefined;
      throw e;
    }));
  };
  const loadUserContact = (pid: string): Promise<Awaited<ReturnType<typeof findUserContactFields>>> => {
    if (!cache) return findUserContactFields(pid);
    return (cache.userContact ??= findUserContactFields(pid).catch((e) => {
      cache.userContact = undefined;
      throw e;
    }));
  };
  const source = question.source;
  const sourceRef = (question.source_ref ?? {}) as Record<string, unknown>;

  if (source === "client_answer") {
    return responseAnswers[question.id] ?? null;
  }

  if (source === "document_extraction") {
    const documentSlug = sourceRef["document_slug"] as string | undefined;
    const jsonPath = sourceRef["json_path"] as string | undefined;
    if (!documentSlug) return null;

    const approvedDoc = await findLatestActiveDocumentBySlug(caseId, documentSlug, partyId);
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

    // Only the structured output is dot-path navigable; without a path, fall back to
    // the raw text (a plain markdown letter has no navigable structure).
    const root = run.outputStructured ?? null;
    if (!outputPath) return root ?? run.outputText ?? null;
    if (root == null) return null;

    const parts = outputPath.split(".");
    let current: unknown = root;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return null;
      current = (current as Record<string, unknown>)[part];
    }
    return current ?? null;
  }

  if (source === "ai_field") {
    const connected = sourceRef["connected"] as { kind?: string; slug?: string } | undefined;
    const instruction = sourceRef["instruction"] as string | undefined;
    const model = (sourceRef["model"] as string | undefined) ?? null;
    if (!connected?.kind || !connected?.slug || !instruction) return null;
    const map = await resolveAiFields(caseId, partyId, [
      { id: question.id, connected: { kind: connected.kind, slug: connected.slug }, instruction, model },
    ]);
    return map[question.id] ?? null;
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

    // Find primary client for the case (memoized across the form load)
    const primaryClientId = await loadPrimaryClient();
    if (!primaryClientId) return null;

    // Resolve the raw profile value, then apply the optional `format` transform (e.g.
    // split a phone into area code / local number for forms with separate boxes).
    const format = sourceRef["format"] as string | undefined;
    let raw: unknown = null;

    // PII resolution is LOCAL — never forwarded to AI (DOC-74 §7.1)
    if (profileField.startsWith("pii.")) {
      const piiKey = profileField.slice(4); // e.g. "ssn"
      const profile = await loadProfile(primaryClientId);
      if (!profile) return null;

      const piiEncrypted = profile.pii_encrypted as Record<string, unknown> | null;
      if (!piiEncrypted || !piiEncrypted[piiKey]) return null;

      const { decryptPiiField } = await import("@/backend/platform/crypto");
      try {
        raw = decryptPiiField(piiEncrypted[piiKey] as import("@/backend/platform/crypto").EncryptedField);
      } catch {
        logger.warn({ piiKey }, "resolveBySource: PII decryption failed — returning null");
        return null;
      }
    } else if (profileField.startsWith("address.")) {
      // Address sub-fields
      const addrKey = profileField.slice(8);
      const profile = await loadProfile(primaryClientId);
      const address = (profile?.address ?? {}) as Record<string, unknown>;
      raw = address[addrKey] ?? null;
    } else if (profileField === "phone_e164" || profileField === "email") {
      // Contact fields on users table
      const user = await loadUserContact(primaryClientId);
      raw = profileField === "phone_e164" ? (user?.phone_e164 ?? null) : (user?.email ?? null);
    } else {
      // Standard profile fields
      const profile = await loadProfile(primaryClientId);
      if (!profile) return null;
      raw = (profile as unknown as Record<string, unknown>)[profileField] ?? null;
    }

    return formatProfileValue(raw, format);
  }

  return null;
}

/**
 * Optional post-processing of a resolved `profile` value. Currently supports splitting
 * a US phone number (E.164 or raw digits) into the pieces USCIS forms print separately:
 *   us_area_code  → "305"        (the 3-digit area code, for the "( )" box)
 *   us_local_number → "555-1234" (the 7-digit local number)
 *   us_phone      → "(305) 555-1234"
 * Unknown/absent format → value unchanged. Reusable for any form with split phone boxes.
 */
function formatProfileValue(value: unknown, format: string | undefined): unknown {
  if (value == null || !format) return value;
  const digits = String(value).replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value; // not a US 10-digit number — leave as-is
  const area = local.slice(0, 3);
  const number = `${local.slice(3, 6)}-${local.slice(6, 10)}`;
  switch (format) {
    case "us_area_code": return area;
    case "us_local_number": return number;
    case "us_phone": return `(${area}) ${number}`;
    default: return value;
  }
}

/** A single ai_field to resolve: question id + its connected source + per-field prompt. */
export interface AiFieldResolveInput {
  id: string;
  connected: { kind: string; slug: string };
  instruction: string;
  model?: string | null;
}

/**
 * Resolves a batch of `ai_field` questions, grouping by connected source so each
 * document/letter is loaded once and the AI is called ONCE per (kind, slug, model)
 * group (returning a per-question value map). This keeps the synchronous PDF fill
 * fast even with many AI-written fields. Best-effort: a field whose source is
 * missing or whose AI call fails is simply absent from the result (left blank).
 *
 * The cases module loads the source content (it owns case_documents / runs); the
 * ai-engine module owns the providers + PII masking (Gemini for documents,
 * Anthropic for letter synthesis).
 */
export async function resolveAiFields(
  caseId: string,
  partyId: string | null,
  fields: AiFieldResolveInput[],
): Promise<Record<string, string>> {
  if (fields.length === 0) return {};

  const groups = new Map<string, AiFieldResolveInput[]>();
  for (const f of fields) {
    if (!f.connected?.kind || !f.connected?.slug || !f.instruction) continue;
    const key = `${f.connected.kind}::${f.connected.slug}::${f.model ?? ""}`;
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  if (groups.size === 0) return {};

  const aiEngine = (await import("@/backend/modules/ai-engine")) as {
    interpretDocumentFields: (i: {
      fileBase64: string;
      mimeType: string;
      fields: Array<{ id: string; instruction: string }>;
      model?: string | null;
    }) => Promise<Record<string, string>>;
    synthesizeLetterFields: (i: {
      letterText: string;
      fields: Array<{ id: string; instruction: string }>;
      model?: string | null;
    }) => Promise<Record<string, string>>;
  };

  const out: Record<string, string> = {};
  for (const grp of groups.values()) {
    const first = grp[0];
    const reqs = grp.map((f) => ({ id: f.id, instruction: f.instruction }));
    const model = first.model ?? null;
    try {
      if (first.connected.kind === "document") {
        const doc = await downloadDocumentBytesBySlug(caseId, first.connected.slug, partyId);
        if (!doc) continue;
        const fileBase64 = Buffer.from(doc.bytes).toString("base64");
        Object.assign(out, await aiEngine.interpretDocumentFields({ fileBase64, mimeType: doc.mimeType, fields: reqs, model }));
      } else if (first.connected.kind === "ai_letter") {
        const run = await findCompletedGenerationByFormSlug(caseId, first.connected.slug, partyId);
        if (!run?.outputText) continue;
        Object.assign(out, await aiEngine.synthesizeLetterFields({ letterText: run.outputText, fields: reqs, model }));
      }
    } catch (err) {
      logger.warn({ err, kind: first.connected.kind, slug: first.connected.slug }, "resolveAiFields: group failed — leaving fields blank");
    }
  }
  return out;
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
  /** Bilingual staff reason when status='rejected' (shown to the client, amber). */
  rejectionReasonI18n: I18nValue | null;
  /** Optional correction deadline (ISO) when status='rejected'. */
  correctionDueAt: string | null;
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
    // Shared across every question in this form load so the profile / primary
    // client / contact row are fetched once, not once per prefilled question.
    const resolveCache: FormResolveCache = {};

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
              resolveCache,
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
    rejectionReasonI18n: asI18n(existingResponse?.rejection_reason_i18n) ?? null,
    correctionDueAt: existingResponse?.correction_due_at ?? null,
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
  /** The anchor definition. For an ai_letter with a companion questionnaire this
   *  is the ai_letter id (the deliverable); see `fillFormDefinitionId` for the
   *  form the client actually fills. */
  formDefinitionId: string;
  /** The form the "fill / review" action opens. Equals `formDefinitionId` for a
   *  plain form; for an ai_letter with a companion questionnaire it is the
   *  questionnaire id (the questions that feed the AI). The wizard reads/writes
   *  responses against THIS id, so status reads stay consistent. */
  fillFormDefinitionId: string;
  labelI18n: I18nValue;
  /** 'ai_letter' | 'pdf_automation' | 'questionnaire'. */
  kind: string;
  /** null (case-level) or a party id (one entry per party when is_per_party). */
  partyId: string | null;
  /** Party display name when this is a per-party entry (e.g. "Mateo"). */
  partyName: string | null;
  /** null (untouched) | 'draft' | 'submitted' | 'approved' | … */
  status: string | null;
  /** 'client' | 'staff' | 'both' — who fills it (drives the staff read-only lock). */
  filledBy: string;
  /** The response row id (null when untouched) — needed by staff approve/generate. */
  responseId: string | null;
  /** Path to the generated official PDF (null = not generated yet). */
  filledPdfPath: string | null;
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
        companion_questionnaire_id: string | null;
      }>
    >;
  };
  if (!catalog.listFormDefinitions) return [];

  const defs = await catalog.listFormDefinitions(caseRow.current_phase_id);

  // A companion questionnaire is surfaced THROUGH its parent ai_letter card (one
  // "Memorándum" entry whose fill target is the questionnaire), never as its own
  // card — listing both was the duplicate (Bug C).
  const companionIds = new Set(
    defs.map((d) => d.companion_questionnaire_id).filter((x): x is string => !!x),
  );

  const clientDefs = defs.filter(
    (d) =>
      (d.filled_by === "client" || d.filled_by === "both") &&
      !(d.kind === "questionnaire" && companionIds.has(d.id)),
  );

  const parties = await getCaseParties(caseId);
  const items: ClientFormListItem[] = [];

  for (const d of clientDefs) {
    const label = asI18n(d.label_i18n) ?? { en: "", es: "" };
    // The client fills the companion questionnaire (it gathers the AI context);
    // the ai_letter itself is generated by staff. Both the fill route and the
    // status pill track the questionnaire when present.
    const fillId = d.companion_questionnaire_id ?? d.id;
    if (d.is_per_party && parties.length > 0) {
      for (const p of parties) {
        const resp = await findFormResponse(caseId, fillId, p.id);
        items.push({
          formDefinitionId: d.id,
          fillFormDefinitionId: fillId,
          labelI18n: label,
          kind: d.kind,
          partyId: p.id,
          partyName: await resolvePartyName(p),
          status: resp?.status ?? null,
          filledBy: d.filled_by,
          responseId: resp?.id ?? null,
          filledPdfPath: resp?.filled_pdf_path ?? null,
          position: d.position,
        });
      }
    } else {
      const resp = await findFormResponse(caseId, fillId, null);
      items.push({
        formDefinitionId: d.id,
        fillFormDefinitionId: fillId,
        labelI18n: label,
        kind: d.kind,
        partyId: null,
        partyName: null,
        status: resp?.status ?? null,
        filledBy: d.filled_by,
        responseId: resp?.id ?? null,
        filledPdfPath: resp?.filled_pdf_path ?? null,
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
// Prior-phase materials (Etapa C) — staff read-only view of docs + forms from
// phases the case has already passed.
// ---------------------------------------------------------------------------

export interface PriorPhaseDoc {
  documentId: string;
  displayName: string;
  status: string;
  mimeType: string;
  createdAt: string;
  partyName: string | null;
}
export interface PriorPhaseForm {
  responseId: string;
  formDefinitionId: string;
  label: { es: string; en: string };
  status: string;
  partyName: string | null;
  filledPdfPath: string | null;
  submittedAt: string | null;
}
export interface PriorPhaseGroup {
  phaseId: string;
  label: { es: string; en: string };
  position: number;
  documents: PriorPhaseDoc[];
  forms: PriorPhaseForm[];
}

/**
 * Read-only materials (documents + form responses) from phases the case has
 * already PASSED (position < current phase). Grouped by phase, newest phase
 * first. Empty phases are omitted. Staff-facing; requires case access.
 *
 * @api-id API-CASE-PRIORPHASE
 */
export async function getPriorPhaseMaterials(
  actor: Actor,
  caseId: string,
): Promise<{ phases: PriorPhaseGroup[] }> {
  await requireCaseAccess(actor, caseId);
  const caseRow = await findCaseById(caseId);
  if (!caseRow) return { phases: [] };

  const phases = await listServicePhases(caseRow.service_id);
  const currentPos =
    phases.find((p) => p.id === caseRow.current_phase_id)?.position ?? Number.POSITIVE_INFINITY;
  const priorPhases = phases.filter((p) => p.position < currentPos);
  if (priorPhases.length === 0) return { phases: [] };

  const [docs, forms, parties] = await Promise.all([
    listCaseDocuments(caseId),
    listFormResponsesForCase(caseId),
    getCaseParties(caseId),
  ]);
  const partyNameById = new Map<string, string | null>();
  for (const p of parties) partyNameById.set(p.id, await resolvePartyName(p));

  const phaseId = (r: { service_phase_id?: string | null }) => r.service_phase_id ?? null;

  const groups = await Promise.all(
    priorPhases
      .sort((a, b) => b.position - a.position) // newest passed phase first
      .map(async (ph) => {
        const documents: PriorPhaseDoc[] = docs
          .filter((d) => phaseId(d) === ph.id && d.status !== "replaced")
          .map((d) => ({
            documentId: d.id,
            displayName: d.display_name ?? d.original_filename,
            status: d.status,
            mimeType: d.mime_type,
            createdAt: d.created_at,
            partyName: d.party_id ? (partyNameById.get(d.party_id) ?? null) : null,
          }));
        const formsForPhase = forms.filter((f) => phaseId(f) === ph.id);
        const formItems: PriorPhaseForm[] = await Promise.all(
          formsForPhase.map(async (f) => {
            const formDef = await findFormDefinitionById(f.form_definition_id);
            return {
              responseId: f.id,
              formDefinitionId: f.form_definition_id,
              label: asI18n(formDef?.label_i18n) ?? { en: "", es: "" },
              status: f.status,
              partyName: f.party_id ? (partyNameById.get(f.party_id) ?? null) : null,
              filledPdfPath: f.filled_pdf_path,
              submittedAt: f.submitted_at,
            };
          }),
        );
        return {
          phaseId: ph.id,
          label: asI18n(ph.label_i18n) ?? { en: "", es: "" },
          position: ph.position,
          documents,
          forms: formItems,
        } satisfies PriorPhaseGroup;
      }),
  );

  return { phases: groups.filter((g) => g.documents.length > 0 || g.forms.length > 0) };
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
 * Creates or updates a form draft with a partial patch of answers (API-CASE-16).
 *
 * Thin wrapper around the implementation that logs EVERY rejection (errorCode + ids,
 * PII-safe — never the answer values) so a blocked client autosave is diagnosable
 * from the logs instead of guesswork, then re-throws unchanged.
 *
 * @api-id API-CASE-16
 */
export async function saveFormDraft(
  actor: Actor,
  input: SaveFormDraftInput,
): Promise<CaseFormResponseRow> {
  try {
    return await saveFormDraftImpl(actor, input);
  } catch (err) {
    if (err instanceof CaseError) {
      logger.warn(
        {
          caseId: input.caseId,
          formDefinitionId: input.formDefinitionId,
          partyId: input.partyId ?? null,
          errorCode: err.code,
          details: err.details,
        },
        "saveFormDraft rejected",
      );
    }
    throw err;
  }
}

/**
 * Staff edit of a form response's answers, allowed in ANY status (draft /
 * submitted / approved) — the divergence from RF-DIA-023 decided by Henry
 * (2026-07-08): Diana / admin correct answers from the side-by-side review.
 *
 * Gated by the `formEdit` module permission (admin bypasses; paralegal has it by
 * preset; e.g. sales does NOT even though it has cases:edit). Reuses the client
 * autosave engine end-to-end (same merge + version-integrity), so the durable
 * IndexedDB write-ahead / offline queue protect staff edits too. Status is never
 * changed here (an approved form stays approved); the official PDF is refreshed
 * separately via generateFilledPdf ("Actualizar PDF").
 */
export async function staffUpdateFormAnswers(
  actor: Actor,
  input: SaveFormDraftInput,
): Promise<CaseFormResponseRow> {
  can(actor, "formEdit", "edit"); // AuthzError('forbidden_module') if denied
  return saveFormDraftImpl(actor, input, /* staffEdit */ true);
}

/**
 * Creates or updates a form draft with a partial patch of answers.
 * Merge per-key: only keys present in patch are updated (RF-DIA-023).
 * Freezes automation_version_id to the published version on first create.
 * FORM_VERSION_MISMATCH if patch keys don't belong to the saved version.
 */
async function saveFormDraftImpl(
  actor: Actor,
  input: SaveFormDraftInput,
  /**
   * Staff edit path (staffUpdateFormAnswers): skips the draft-only gate so a
   * privileged staff (formEdit) can correct answers of a submitted/approved form.
   * The permission itself is enforced by the caller. Never set from the client path.
   */
  staffEdit = false,
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

    const caseForPhase = await findCaseById(parsed.caseId);
    response = await insertFormResponse({
      case_id: parsed.caseId,
      form_definition_id: parsed.formDefinitionId,
      automation_version_id: published?.id ?? null,
      party_id: partyId,
      status: "draft",
      service_phase_id: caseForPhase?.current_phase_id ?? null,
    });
  } else {
    // Existing response: the client autosave allows only `draft`. The staff edit
    // path (formEdit) may correct answers of a submitted/approved form — the status
    // is deliberately left unchanged (an approved form stays approved).
    if (!staffEdit && response.status !== "draft") {
      throw new CaseError("FORM_NOT_SUBMITTABLE");
    }
  }

  // Structural integrity ONLY: the patch keys must belong to the response's frozen
  // version. A re-published form whose questions got new ids → the client is on a
  // stale render (FORM_VERSION_MISMATCH). We deliberately do NOT validate VALUE
  // FORMAT (regex / min / max / select whitelist) on a draft autosave: a draft is a
  // work-in-progress and a partial value (a ZIP "330" before "33012", an A-number
  // mid-entry, a number momentarily out of range) is EXPECTED while typing. Rejecting
  // it here returns a "permanent" error that BRICKS the whole-form autosave for the
  // rest of the session and silently drops keystrokes — the user then sees "No
  // pudimos guardar" on every field. Format is enforced at SUBMIT (submitFormResponse,
  // full validateAnswerTypes) and shown as inline UI hints — never as an autosave gate
  // (DOC-41 §3.8: "validación pre-envío sin bloquear guardado parcial").
  if (response.automation_version_id && Object.keys(parsed.patch).length > 0) {
    const questions = await getQuestionsForVersion(response.automation_version_id);

    if (questions.length > 0) {
      const validQuestionIds = new Set(questions.map((q) => q.id));
      const unknownKeys = Object.keys(parsed.patch).filter((k) => !validQuestionIds.has(k));
      if (unknownKeys.length > 0) {
        throw new CaseError("FORM_VERSION_MISMATCH", { unknownKeys });
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
  // A rejected form is editable again → the client corrects and resubmits it
  // (rejected → submitted). Only 'draft' and 'rejected' are submittable states.
  if (!response || (response.status !== "draft" && response.status !== "rejected")) {
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

  // emitAndWait (not emit): the sales notification insert + push enqueue must
  // complete before the serverless request freezes. The matrix rule only fires
  // when submittedByKind === "client" (staff filling a form doesn't alert sales).
  await appEvents.emitAndWait({
    type: "form_response.submitted",
    payload: {
      caseId: parsed.caseId,
      responseId: response.id,
      formDefinitionId: parsed.formDefinitionId,
      partyId,
      submittedByKind: actor.kind === "client" ? "client" : "staff",
    },
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

  await updateFormResponse(response.id, {
    status: "approved",
    reviewed_by: actor.userId,
    reviewed_at: new Date().toISOString(),
  });

  await appEvents.emitAndWait({
    type: "form_response.approved",
    payload: {
      caseId: response.case_id,
      responseId: response.id,
      formDefinitionId: response.form_definition_id,
      partyId: response.party_id,
    },
    occurredAt: new Date(),
  });

  await writeTimeline({
    caseId: response.case_id,
    eventType: "form_response.approved",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      en: "Form approved",
      es: "Formulario aprobado",
    },
  });

  await writeAudit(
    actor,
    "case.form_response.approved",
    "case_form_responses",
    response.id,
    { after: { status: "approved" } },
  );
}

// ---------------------------------------------------------------------------
// API-CASE-18b: rejectFormResponse (staff only)
// ---------------------------------------------------------------------------

const RejectFormResponseSchema = z.object({
  responseId: zUuid,
  reason: z
    .object({
      en: z.string().trim().optional(),
      es: z.string().trim().optional(),
    })
    .optional(),
  /** Optional correction deadline (ISO). Null/absent = no hard deadline. */
  correctionDueAt: z.string().nullable().optional(),
});

export type RejectFormResponseInput = z.infer<typeof RejectFormResponseSchema>;

/**
 * Staff returns a submitted form response to the client for correction:
 * submitted → rejected. Mirror of reviewDocument's reject branch (RF-DIA-014).
 * A bilingual reason is required; the client edits the same response and
 * resubmits it (rejected → submitted).
 *
 * @api-id API-CASE-18b
 */
export async function rejectFormResponse(
  actor: Actor,
  input: RejectFormResponseInput,
): Promise<void> {
  can(actor, "cases", "edit");
  const parsed = RejectFormResponseSchema.parse(input);

  const response = await findFormResponseById(parsed.responseId);
  if (!response) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  // Cross-tenant guard (same as approveFormResponse): findFormResponseById uses
  // the service client (RLS bypass), so verify the actor's case membership.
  await requireCaseAccess(actor, response.case_id);

  if (response.status !== "submitted") {
    throw new CaseError("FORM_NOT_SUBMITTABLE");
  }
  if (!parsed.reason?.en && !parsed.reason?.es) {
    throw new CaseError("FORM_REJECTION_REASON_REQUIRED");
  }

  await updateFormResponse(response.id, {
    status: "rejected",
    reviewed_by: actor.userId,
    reviewed_at: new Date().toISOString(),
    rejection_reason_i18n: (parsed.reason ?? null) as unknown as import("@/shared/database.types").Json,
    correction_due_at: parsed.correctionDueAt ?? null,
  });

  await appEvents.emitAndWait({
    type: "form_response.rejected",
    payload: {
      caseId: response.case_id,
      responseId: response.id,
      formDefinitionId: response.form_definition_id,
      partyId: response.party_id,
    },
    occurredAt: new Date(),
  });

  await writeTimeline({
    caseId: response.case_id,
    eventType: "form_response.rejected",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: true,
    titleI18n: {
      en: "Form returned for correction",
      es: "Formulario devuelto para corrección",
    },
  });

  await writeAudit(
    actor,
    "case.form_response.rejected",
    "case_form_responses",
    response.id,
    { after: { status: "rejected" } },
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
 * USCIS forms expect US date format. The wizard's `<input type="date">` yields an
 * ISO value ("YYYY-MM-DD"); reformat it to "MM/DD/YYYY" so the filled PDF matches
 * the field label (e.g. "Date of Birth (mm/dd/yyyy)"). Month/year-only fields
 * (labelled "Mo/Yr" — their question text says "mes/año") render as "MM/YYYY".
 * A value that is not ISO (already formatted, or free text) is returned untouched.
 */
function formatPdfDate(value: string, monthYearOnly: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) return ""; // never emit a placeholder date — blank in, blank out
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(trimmed);
  if (!m) return value;
  const [, yyyy, mm, dd] = m;
  if (monthYearOnly || !dd) return `${mm}/${yyyy}`;
  return `${mm}/${dd}/${yyyy}`;
}

/** validation.minSelected for a multiselect group (e.g. Part B.1 ≥ 1); 0 when unset. */
function readMinSelected(validation: unknown): number {
  if (validation && typeof validation === "object" && "minSelected" in validation) {
    const v = (validation as { minSelected?: unknown }).minSelected;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  }
  return 0;
}

/** A date question is month/year-only when its prompt asks for "mes/año" (Mo/Yr). */
function isMonthYearDateQuestion(questionI18n: unknown): boolean {
  const es =
    questionI18n && typeof questionI18n === "object" && "es" in questionI18n
      ? String((questionI18n as { es?: unknown }).es ?? "")
      : "";
  return /mes\s*\/?\s*a[nñ]o/i.test(es);
}

/** The Spanish prompt of a question (or English fallback), used as translation context. */
function questionLabel(questionI18n: unknown): string {
  if (questionI18n && typeof questionI18n === "object") {
    const o = questionI18n as { es?: unknown; en?: unknown };
    return String(o.es ?? o.en ?? "").trim();
  }
  return "";
}

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
    getPublishedAutomationVersion: (id: string) => Promise<{ id: string; source_pdf_path: string; detected_fields: unknown; source_language?: string; default_empty_policy?: string | null } | null>;
    listQuestionGroups: (versionId: string) => Promise<Array<{ id: string; do_not_fill?: boolean | null }>>;
    listQuestions: (groupId: string) => Promise<Array<{
      id: string;
      source: string;
      source_ref: unknown;
      pdf_field_name: string | null;
      is_required: boolean;
      field_type: string;
      condition: unknown;
      options: unknown;
      validation?: unknown;
      question_i18n?: unknown;
      empty_policy?: string | null;
      empty_placeholder?: string | null;
      no_translate?: boolean | null;
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

  // Collect all questions for the version. Each question is tagged with its group's
  // do_not_fill flag: a "do not fill" section (I-589 Part D signature, Parts F/G) is
  // left ENTIRELY blank by legal design — no value, no N/A backfill.
  const questions: Array<{
    id: string;
    source: string;
    source_ref: unknown;
    pdf_field_name: string | null;
    is_required: boolean;
    field_type: string;
    condition: unknown;
    options: unknown;
    validation?: unknown;
    question_i18n?: unknown;
    do_not_fill?: boolean;
    empty_policy?: string | null;
    empty_placeholder?: string | null;
    no_translate?: boolean | null;
  }> = [];

  if (catalog.listQuestionGroups && catalog.listQuestions) {
    const groups = await catalog.listQuestionGroups(published.id);
    for (const g of groups) {
      const doNotFill = g.do_not_fill === true;
      const qs = await catalog.listQuestions(g.id);
      questions.push(...qs.map((q) => ({ ...q, do_not_fill: doNotFill })));
    }
  }

  const answers = (response.answers ?? {}) as Record<string, unknown>;
  const caseId = response.case_id;
  const partyId = response.party_id;

  // Answer-translation context. The filed AcroForm must be in the PDF's source_language
  // (English for USCIS). Free-text answers the client typed in Spanish are translated
  // ES→EN — preserving proper nouns (names/places) — in ONE batched AI call BEFORE the
  // fill loop (below), then cached in `answers_translated` so a regeneration re-uses it.
  const sourceLang: "en" | "es" = published.source_language === "es" ? "es" : "en";
  // Form-wide policy for how APPLICABLE-but-EMPTY fields render (blank / N/A / custom).
  // Read defensively (db:types is blocked with the current token) — falls back to the
  // legacy `auto` behaviour when the column is absent. A per-question override wins.
  const versionEmptyDefault: VersionEmptyPolicy =
    published.default_empty_policy === "na" || published.default_empty_policy === "blank"
      ? published.default_empty_policy
      : "auto";
  // Freshly translated free-text, keyed by question id. NOTE: we do NOT seed from the
  // stored answers_translated cache — a cached translation can be stale (the client, or
  // staff, changed the answer after it was translated), and the FILED PDF must always
  // reflect the CURRENT answer. So the batch below re-translates every visible free-text
  // field at generation (one AI call) and overwrites the cache.
  const answersTranslated: Record<string, string> = {};
  const needsTranslation = sourceLang === "en"; // English AcroForm ⇒ translate any Spanish free-text

  // Batch-resolve ai_field questions (one provider call per connected source) BEFORE
  // the fill loop, so the synchronous PDF fill stays fast even with many AI-written
  // fields. Only VISIBLE fields WITHOUT an explicit client answer are sent to the AI:
  // a hidden conditional field — e.g. a Part B/C textarea gated on a "No" checkbox —
  // is never resolved (the "solo si marcan Sí" rule, for free).
  const aiFieldReqs: AiFieldResolveInput[] = [];
  for (const q of questions) {
    if (q.source !== "ai_field") continue;
    const cs = deriveFieldState(parseConditionOrNull(q.condition), q.is_required, answers);
    if (!cs.visible) continue;
    const own0 = answers[q.id];
    if (own0 !== undefined && own0 !== null && own0 !== "") continue;
    const ref = (q.source_ref ?? {}) as {
      connected?: { kind?: string; slug?: string };
      instruction?: string;
      model?: string | null;
    };
    if (!ref.connected?.kind || !ref.connected?.slug || !ref.instruction) continue;
    aiFieldReqs.push({
      id: q.id,
      connected: { kind: ref.connected.kind, slug: ref.connected.slug },
      instruction: ref.instruction,
      model: ref.model ?? null,
    });
  }
  const aiFieldValues = await resolveAiFields(caseId, partyId, aiFieldReqs);

  // Batch-translate free-text answers ES→EN in ONE AI call (preserving names/places),
  // BEFORE the fill loop, so the synchronous fill stays fast (no per-field await). Only
  // VISIBLE, still-untranslated, non-empty text/textarea client answers are sent; the
  // result is merged into `answersTranslated` and cached (write-back) for regenerations.
  if (needsTranslation) {
    const toTranslate: Array<{ id: string; text: string; fieldLabel?: string }> = [];
    for (const q of questions) {
      if (q.do_not_fill) continue;
      if (q.field_type !== "text" && q.field_type !== "textarea") continue;
      const cs = deriveFieldState(parseConditionOrNull(q.condition), q.is_required, answers);
      if (!cs.visible) continue;
      const own = answers[q.id];
      const val = typeof own === "string" ? own.trim() : "";
      if (!val) continue;
      // VERBATIM: an A-Number/SSN/passport/name/city/code is written to the PDF exactly
      // as stored — never sent to the translator (which masks PII → an "A-•••-•••" token
      // would otherwise land on a federal form). Explicit `no_translate` flag OR the
      // structured-value safety net. Such fields keep their raw answer.
      if (q.no_translate === true || isVerbatimValue(val)) continue;
      toTranslate.push({ id: q.id, text: val, fieldLabel: questionLabel(q.question_i18n) });
    }
    if (toTranslate.length > 0) {
      try {
        const { translateAnswersBatch } = (await import("@/backend/modules/ai-engine")) as {
          translateAnswersBatch: (i: {
            items: Array<{ id: string; text: string; fieldLabel?: string }>;
            direction: "es-en" | "en-es";
            preserveProperNouns?: boolean;
          }) => Promise<Record<string, string>>;
        };
        const translated = await translateAnswersBatch({ items: toTranslate, direction: "es-en", preserveProperNouns: true });
        if (Object.keys(translated).length > 0) {
          Object.assign(answersTranslated, translated);
          try {
            await updateFormResponse(response.id, { answers_translated: answersTranslated });
          } catch { /* cache write is best-effort */ }
        }
      } catch { /* best-effort — never block PDF generation on translation */ }
    }
  }

  // Resolve all field values
  const fieldValues: Record<string, string | boolean> = {};
  const missingRequired: string[] = [];
  // pdf_field_name → placeholder for VISIBLE, applicable, still-empty fields whose empty
  // policy stamps a value (8 CFR 1208.3(c)(3)). Hidden blocks, do-not-fill sections, and
  // fields under a `blank` policy are deliberately absent, so they stay blank. The
  // placeholder is per-field (version default `na` → "N/A"; a `custom` field → its string).
  const naTargets = new Map<string, string>();

  for (const q of questions) {
    // Do-not-fill section (I-589 Part D signature, Parts F/G): left ENTIRELY blank by
    // legal design — no value AND no "N/A" backfill.
    if (q.do_not_fill) continue;

    // A SELECT/MULTISELECT may map a GROUP of checkboxes (Sex, Marital, a Yes/No pair,
    // the Part B.1 asylum bases): each option carries its own pdf_field_name. select →
    // exactly one box on; multiselect → several. Such a question can have a null
    // top-level pdf_field_name.
    const isOptionGroup =
      (q.field_type === "select" || q.field_type === "multiselect") && Array.isArray(q.options);
    const optionFields = isOptionGroup
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
    let resolved: unknown;
    if (own !== undefined && own !== null && own !== "") {
      resolved = own;
    } else if (q.source === "ai_field") {
      // Pre-resolved in the batch above (one provider call per source).
      resolved = aiFieldValues[q.id] ?? null;
    } else {
      resolved = await resolveBySource(
        { id: q.id, source: q.source, source_ref: q.source_ref },
        answers,
        caseId,
        partyId,
      );
    }

    // Defensive: a value starting with « (guillemet) can only be a mis-seeded placeholder
    // or prompt token — the real resolution never produces one. Treat it as empty so it
    // never reaches a federal form (a single visible « would be an instant rejection).
    if (typeof resolved === "string" && resolved.trimStart().startsWith("«")) resolved = null;

    // MULTISELECT (e.g. Part B.1 asylum bases): value is a list. Tick every chosen box,
    // turn the rest OFF, and enforce validation.minSelected / required (≥ N boxes).
    if (q.field_type === "multiselect") {
      const selected = Array.isArray(resolved)
        ? resolved.map((v) => String(v))
        : resolved != null && resolved !== "" ? [String(resolved)] : [];
      const need = Math.max(readMinSelected(q.validation), condState.required ? 1 : 0);
      if (selected.length < need) {
        missingRequired.push(q.pdf_field_name ?? q.id);
        continue;
      }
      if (optionFields) {
        const chosen = new Set(selected);
        for (const o of optionFields) {
          if (o?.pdf_field_name) fieldValues[o.pdf_field_name] = chosen.has(String(o.value));
        }
      }
      continue;
    }

    const isEmpty = resolved === null || resolved === undefined || resolved === "";
    if (isEmpty && condState.required) {
      missingRequired.push(q.pdf_field_name ?? q.id);
      continue;
    }
    if (isEmpty) {
      // Applicable but unanswered → the empty policy decides blank vs a placeholder.
      // `auto` keeps the legacy "free-text only → N/A"; `na`/`custom` also cover dates;
      // `blank` leaves it empty. Selects/checkboxes can't hold text → always blank.
      if (q.pdf_field_name) {
        const res = resolveEmptyPolicy(
          {
            fieldType: q.field_type,
            emptyPolicy: (q.empty_policy ?? undefined) as FieldEmptyPolicy | undefined,
            emptyPlaceholder: q.empty_placeholder ?? undefined,
          },
          versionEmptyDefault,
        );
        if (res.mode === "fill") naTargets.set(q.pdf_field_name, res.placeholder);
      }
      continue;
    }

    // SELECT → checkbox group: tick the chosen option's box AND explicitly turn the
    // siblings OFF, so a Yes/No · Sex · Marital group can never show two ticks. An
    // option with no pdf_field_name (e.g. "married=yes" on a lone "I am not married"
    // box) simply ticks nothing.
    if (hasOptionFields && optionFields) {
      for (const o of optionFields) {
        if (o?.pdf_field_name) fieldValues[o.pdf_field_name] = String(o.value) === String(resolved);
      }
      continue;
    }

    if (typeof resolved === "boolean") {
      fieldValues[q.pdf_field_name!] = resolved;
    } else {
      let str = String(resolved);
      // Free-text fields (text/textarea): use the batched/on-device translation if we have
      // one (dates/numbers/selects map to codes and are never translated). A verbatim field
      // (no_translate / structured value) is never in `answersTranslated` — guard anyway so
      // a masked token can never reach the PDF, whatever populated the cache.
      const verbatim = q.no_translate === true || isVerbatimValue(str);
      if (!verbatim && needsTranslation && (q.field_type === "text" || q.field_type === "textarea")) {
        const pre = answersTranslated[q.id];
        if (typeof pre === "string" && pre.trim()) str = pre;
      } else if (q.field_type === "date") {
        // USCIS expects MM/DD/YYYY (or MM/YYYY for Mo/Yr fields); the wizard stores ISO.
        str = formatPdfDate(str, isMonthYearDateQuestion(q.question_i18n));
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
  // incomplete, but "N/A" is an allowed response. Backfill ONLY the applicable,
  // still-empty fields collected above (naTargets → per-field placeholder) — never
  // fields that belong to a hidden block, a do-not-fill section, or a checkbox.
  const { fillAcroForm, backfillNaTextFields } = await import("@/backend/platform/pdf");
  const detectedForNa = (published.detected_fields ?? []) as Array<{
    pdf_field_name: string;
    field_type: string;
    page: number;
  }>;
  backfillNaTextFields(detectedForNa, fieldValues, naTargets);
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

/**
 * Read-only signed URL of a form response's already-generated official PDF
 * (filled_pdf_path), or null when it hasn't been generated yet. Used by the
 * side-by-side review screen to show the official PDF without regenerating it.
 */
export async function getFormResponsePdfUrl(
  actor: Actor,
  responseId: string,
): Promise<string | null> {
  can(actor, "cases", "view");
  const response = await findFormResponseById(responseId);
  if (!response) throw new CaseError("FORM_RESPONSE_NOT_FOUND");
  await requireCaseAccess(actor, response.case_id);
  if (!response.filled_pdf_path) return null;
  return createSignedDownloadUrl("generated", response.filled_pdf_path);
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
/**
 * Lists the cases the actor is the RESPONSIBLE (current_owner_id) for — the
 * source of each staff member's personal `cases` kanban (Vanessa, Diana, Andrium).
 * Generalises the old listCasesForParalegal (which keyed off assigned_paralegal_id)
 * to the new ownership axis.
 */
export async function listCasesByOwner(
  actor: Actor,
): Promise<AdminCaseListItem[]> {
  can(actor, "cases", "view");
  const page = await listCases({
    orgId: actor.orgId,
    ownerId: actor.userId,
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
        clientPhone: null, // kanban boards don't search by phone
        serviceLabelI18n: asI18n(service?.label_i18n),
        serviceIcon: service?.icon ?? null,
        serviceColor: service?.color ?? null,
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

// ---------------------------------------------------------------------------
// Case ownership stage — responsable / etapa (eje propio)
// ---------------------------------------------------------------------------

export interface StageChecklistItemDto {
  key: string;
  done: boolean;
  /** false = la categoría no tiene trabajo aún (total 0) → se muestra "no aplica". */
  applicable: boolean;
  placeholder: boolean;
}

export interface StageOwnerOption {
  userId: string;
  displayName: string;
  role: string;
}

export interface CaseStageInfoDto {
  stage: CaseStage;
  ownerId: string | null;
  ownerName: string | null;
  nextStage: CaseStage | null;
  checklist: StageChecklistItemDto[];
  allDone: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** owner/admin AND checklist complete → "Traspasar" enabled (without force). */
  canTransfer: boolean;
  /** Eligible responsibles for the CURRENT stage (admin reassign). */
  eligibleOwners: StageOwnerOption[];
  /** Eligible responsibles for the NEXT stage (transfer target picker). */
  nextStageOwners: StageOwnerOption[];
}

/** Builds the stage checklist for a case row (gather signals + pure domain compute). */
async function buildStageChecklist(actor: Actor, caseRow: CaseRow): Promise<StageChecklist> {
  const stage = (caseRow.current_stage ?? "sales") as CaseStage;

  // Documents: strict "approved" count for the gate.
  const { items: docItems, counts: docCounts } = await buildDocumentsMatrix(caseRow);
  const docsApproved = docItems.filter((i) => !i.isHidden && i.status === "aprobado").length;

  // Forms.
  let formsTotal = 0;
  let formsDone = 0;
  try {
    const forms = await getClientFormsForCase(actor, caseRow.id);
    formsTotal = forms.length;
    formsDone = forms.filter((f) => f.status === "submitted" || f.status === "approved").length;
  } catch {
    // best-effort: a forms read failure must not crash the checklist
  }

  // Appointment route (scheduling) — dynamic import avoids a module cycle.
  let citasTotal = 0;
  let citasCompleted = 0;
  try {
    const sched = (await import("@/backend/modules/scheduling")) as {
      getCaseRuta: (a: Actor, c: string) => Promise<{ total: number; citas: Array<{ status: string }> }>;
    };
    const ruta = await sched.getCaseRuta(actor, caseRow.id);
    citasTotal = ruta.total;
    citasCompleted = ruta.citas.filter((c) => c.status === "completed").length;
  } catch {
    // best-effort
  }

  const tr = await getTranslationProgress(caseRow.id);

  // Expediente status (legal/operations gating) — dynamic import avoids a cycle.
  let expedienteStatus: string | null = null;
  if (stage === "legal" || stage === "operations") {
    try {
      const exp = (await import("@/backend/modules/expediente")) as {
        getCaseExpedientes: (a: Actor, c: string) => Promise<Array<{ status: string; attempt_no: number }>>;
      };
      const rows = await exp.getCaseExpedientes(actor, caseRow.id);
      // getCaseExpedientes is DESC by attempt_no → first is the current attempt.
      expedienteStatus = rows[0]?.status ?? null;
    } catch {
      // best-effort: an expediente read failure must not crash the checklist
    }
  }

  return computeStageChecklist(stage, {
    // Initial payment confirmed ⇔ the case has left payment_pending (Andrium
    // approved the first installment, which activates the case). Sales→Legal
    // handoff is gated on this (decisión de Henry).
    initialPaymentConfirmed: caseRow.status !== "payment_pending",
    citasTotal,
    citasCompleted,
    docsTotal: docCounts.total,
    docsApproved,
    formsTotal,
    formsDone,
    docsToTranslate: tr.toTranslate,
    translationsCompleted: tr.completed,
    expedienteStatus,
  });
}

/** Eligible responsibles for a stage = staff with can_edit on STAGE_MODULE[stage]. */
async function eligibleOwnersForStage(orgId: string, stage: CaseStage): Promise<StageOwnerOption[]> {
  if (stage === "done") return [];
  const staff = await listStaffWithModuleEdit(orgId, STAGE_MODULE[stage]);
  return staff.map((s) => ({ userId: s.userId, displayName: s.displayName, role: s.role }));
}

/**
 * Stage info for the case detail UI: responsable, etapa, checklist gating, and
 * the eligible owners for reassign / transfer. Staff-only.
 *
 * @api-id API-CASE-STAGE-01
 */
export async function getCaseStageInfo(actor: Actor, caseId: string): Promise<CaseStageInfoDto> {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const caseRow = await findCaseById(caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const stage = (caseRow.current_stage ?? "sales") as CaseStage;
  const checklist = await buildStageChecklist(actor, caseRow);
  const isAdmin = actor.role === "admin";
  const isOwner = caseRow.current_owner_id === actor.userId;
  const canTransfer = canTransferStage(stage, checklist, { isOwner, isAdmin }) === null;
  const ns = nextStage(stage);

  const [ownerName, eligibleOwners, nextStageOwners] = await Promise.all([
    caseRow.current_owner_id
      ? findStaffDisplayName(caseRow.current_owner_id).catch(() => null)
      : Promise.resolve(null),
    eligibleOwnersForStage(actor.orgId, stage).catch(() => [] as StageOwnerOption[]),
    ns
      ? eligibleOwnersForStage(actor.orgId, ns).catch(() => [] as StageOwnerOption[])
      : Promise.resolve([] as StageOwnerOption[]),
  ]);

  return {
    stage,
    ownerId: caseRow.current_owner_id,
    ownerName,
    nextStage: ns,
    checklist: checklist.items.map((i) => ({
      key: i.key,
      done: i.done,
      applicable: i.applicable !== false,
      placeholder: i.placeholder ?? false,
    })),
    allDone: checklist.allDone,
    isOwner,
    isAdmin,
    canTransfer,
    eligibleOwners,
    nextStageOwners,
  };
}

const TransferCaseSchema = z.object({
  caseId: zUuid,
  toOwnerId: zUuid.nullable().optional(),
  force: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});
export type TransferCaseInput = z.infer<typeof TransferCaseSchema>;

/**
 * Transfers the case to the NEXT stage + a new responsible. Gated by the current
 * stage's checklist (an admin may `force`). Moves the kanban card to the new
 * owner's board and removes it from the previous one (via case.owner_changed).
 * Does NOT touch cases.status. Staff-only (current owner or admin).
 *
 * @api-id API-CASE-STAGE-02
 */
export async function transferCase(
  actor: Actor,
  input: TransferCaseInput,
): Promise<{ stage: CaseStage; ownerId: string | null }> {
  const p = TransferCaseSchema.parse(input);
  await requireCaseAccess(actor, p.caseId);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");

  const caseRow = await findCaseById(p.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const stage = (caseRow.current_stage ?? "sales") as CaseStage;
  const isAdmin = actor.role === "admin";
  const isOwner = caseRow.current_owner_id === actor.userId;

  const checklist = await buildStageChecklist(actor, caseRow);
  const denied = canTransferStage(stage, checklist, {
    isOwner,
    isAdmin,
    force: Boolean(p.force) && isAdmin,
  });
  if (denied) throw new CaseError(denied);

  const toStage = nextStage(stage);
  if (!toStage) throw new CaseError("STAGE_TERMINAL");

  // Resolve the next responsible.
  let toOwnerId: string | null = null;
  if (toStage !== "done") {
    const candidates = await eligibleOwnersForStage(actor.orgId, toStage);
    if (p.toOwnerId) {
      // Target must be an org-scoped, permission-eligible owner — for admins too
      // (defense in depth against cross-org / stale identifiers).
      if (!candidates.some((c) => c.userId === p.toOwnerId)) {
        throw new CaseError("STAGE_INVALID_OWNER");
      }
      toOwnerId = p.toOwnerId;
    } else if (candidates.length === 1) {
      toOwnerId = candidates[0].userId;
    } else if (candidates.length === 0) {
      throw new CaseError("STAGE_NO_OWNER");
    } else {
      throw new CaseError("STAGE_OWNER_REQUIRED", { candidates });
    }
  }

  const fromOwnerId = caseRow.current_owner_id;

  const fields: TablesUpdate<"cases"> = {
    current_stage: toStage,
    current_owner_id: toOwnerId,
  };
  // Keep the legacy paralegal pointer consistent when entering Legal.
  if (toStage === "legal") fields.assigned_paralegal_id = toOwnerId;
  await updateCase(p.caseId, fields);

  await insertStageHistory({
    caseId: p.caseId,
    fromStage: stage,
    toStage,
    fromOwnerId,
    toOwnerId,
    actorId: actor.userId,
    note: p.note ?? null,
  });

  await writeAudit(actor, "case.stage_transferred", "cases", p.caseId, {
    before: { stage, ownerId: fromOwnerId },
    after: { stage: toStage, ownerId: toOwnerId },
  });

  await writeTimeline({
    caseId: p.caseId,
    eventType: "case.stage_transferred",
    actorKind: "team",
    actorUserId: actor.userId,
    visibleToClient: false,
    titleI18n: { en: `Case handed off to ${toStage}`, es: `Caso traspasado a ${toStage}` },
  });

  await appEvents.emitAndWait({
    type: "case.owner_changed",
    payload: { caseId: p.caseId, orgId: actor.orgId, fromOwnerId, toOwnerId },
    occurredAt: new Date(),
  });

  return { stage: toStage, ownerId: toOwnerId };
}

const AssignCaseOwnerSchema = z.object({
  caseId: zUuid,
  ownerId: zUuid,
});
export type AssignCaseOwnerInput = z.infer<typeof AssignCaseOwnerSchema>;

/**
 * Reassigns the case's responsible WITHIN the current stage (admin only). Moves
 * the kanban card to the new owner's board. Does not advance the stage.
 *
 * @api-id API-CASE-STAGE-03
 */
export async function assignCaseOwner(
  actor: Actor,
  input: AssignCaseOwnerInput,
): Promise<void> {
  const p = AssignCaseOwnerSchema.parse(input);
  await requireCaseAccess(actor, p.caseId);
  if (actor.kind !== "staff" || actor.role !== "admin") {
    throw new AuthzError("forbidden_module");
  }

  const caseRow = await findCaseById(p.caseId);
  if (!caseRow) throw new CaseError("CASE_NOT_FOUND");

  const fromOwnerId = caseRow.current_owner_id;
  if (fromOwnerId === p.ownerId) return; // no-op

  const stage = (caseRow.current_stage ?? "sales") as CaseStage;
  // Target must be an org-scoped, permission-eligible owner for the current stage.
  const candidates = await eligibleOwnersForStage(actor.orgId, stage);
  if (!candidates.some((c) => c.userId === p.ownerId)) {
    throw new CaseError("STAGE_INVALID_OWNER");
  }

  const fields: TablesUpdate<"cases"> = { current_owner_id: p.ownerId };
  if (stage === "legal") fields.assigned_paralegal_id = p.ownerId;
  if (stage === "sales") fields.assigned_sales_id = p.ownerId;
  await updateCase(p.caseId, fields);

  await insertStageHistory({
    caseId: p.caseId,
    fromStage: stage,
    toStage: stage,
    fromOwnerId,
    toOwnerId: p.ownerId,
    actorId: actor.userId,
    note: "reassigned",
  });

  await writeAudit(actor, "case.owner_reassigned", "cases", p.caseId, {
    before: { ownerId: fromOwnerId },
    after: { ownerId: p.ownerId },
  });

  await appEvents.emitAndWait({
    type: "case.owner_changed",
    payload: { caseId: p.caseId, orgId: actor.orgId, fromOwnerId, toOwnerId: p.ownerId },
    occurredAt: new Date(),
  });
}

/** Stage history for a case (staff-only read, oldest first). */
export async function getCaseStageHistory(actor: Actor, caseId: string) {
  await requireCaseAccess(actor, caseId);
  if (actor.kind !== "staff") throw new AuthzError("wrong_kind");
  return listCaseStageHistory(caseId);
}

const SetDocTranslationNotRequiredSchema = z.object({
  caseId: zUuid,
  caseDocumentId: zUuid,
  value: z.boolean(),
});
export type SetDocumentTranslationNotRequiredInput = z.infer<typeof SetDocTranslationNotRequiredSchema>;

/**
 * Marks a document as already-English (no ES→EN translation needed) or back.
 * Staff with cases:edit. Toggles whether it counts in the sales translation gate.
 *
 * @api-id API-CASE-STAGE-04
 */
export async function setDocumentTranslationNotRequired(
  actor: Actor,
  input: SetDocumentTranslationNotRequiredInput,
): Promise<void> {
  const p = SetDocTranslationNotRequiredSchema.parse(input);
  await requireCaseAccess(actor, p.caseId);
  can(actor, "cases", "edit");
  await setDocumentTranslationNotRequiredRow(p.caseId, p.caseDocumentId, p.value);
  await writeAudit(actor, "document.translation_flag", "case_documents", p.caseDocumentId, {
    after: { translationNotRequired: p.value },
  });
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
  /** RFE awaiting client re-submission, not yet past its due date (amber rail). */
  rfeInProgress: boolean;
}

export async function getCaseBoardAlerts(
  actor: Actor,
  caseIds: string[],
): Promise<Record<string, CaseBoardAlert>> {
  can(actor, "cases", "view");
  if (caseIds.length === 0) return {};

  const [uploadedCounts, lawyerCorrectionIds, generationFailedIds, rfeOverdueIds, rfeInProgressIds] =
    await Promise.all([
      countUploadedDocsByCases(caseIds),
      findCasesWithLawyerCorrections(caseIds),
      findCasesWithGenerationFailed(caseIds),
      findCasesWithRfeOverdue(caseIds),
      findCasesWithRfeInProgress(caseIds),
    ]);

  const uploadedByCase = new Map(uploadedCounts.map((r) => [r.case_id, r.count]));
  const lawyerSet = new Set(lawyerCorrectionIds);
  const genFailedSet = new Set(generationFailedIds);
  const rfeSet = new Set(rfeOverdueIds);
  const rfeInProgressSet = new Set(rfeInProgressIds);

  const result: Record<string, CaseBoardAlert> = {};
  for (const id of caseIds) {
    const overdue = rfeSet.has(id);
    result[id] = {
      needsReview: uploadedByCase.get(id) ?? 0,
      lawyerCorrections: lawyerSet.has(id),
      generationFailed: genFailedSet.has(id),
      rfeOverdue: overdue,
      // An overdue RFE is not also "in progress" — the card shows the stronger signal.
      rfeInProgress: !overdue && rfeInProgressSet.has(id),
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

  // Idempotent: if already at or past ready_for_delivery, skip the STATUS change.
  const alreadyDone: string[] = ["ready_for_delivery", "delivered", "completed", "cancelled", "on_hold"];
  if (!alreadyDone.includes(caseRow.status)) {
    // Direct service_role update — ruta corta (bypasses canTransitionCase domain gate)
    await updateCase(caseId, { status: "ready_for_delivery" });
    logger.info({ caseId }, "cases: case transitioned to ready_for_delivery via expediente.sent_to_finance");
  }

  // Reconciliation (single handoff): sending the expediente to Andrium also
  // advances the responsibility stage legal→operations and assigns the case to
  // the operations (printing) owner — so there is ONE handoff trigger, not a
  // separate manual "Traspasar". Idempotent: only acts while still in legal.
  if (caseRow.current_stage === "legal") {
    let toOwnerId: string | null = null;
    try {
      const candidates = await eligibleOwnersForStage(caseRow.org_id, "operations");
      toOwnerId = candidates[0]?.userId ?? null;
    } catch {
      // best-effort: missing operations owner → leave unassigned (admin assigns)
    }
    const fromOwnerId = caseRow.current_owner_id;
    await updateCase(caseId, { current_stage: "operations", current_owner_id: toOwnerId });
    await insertStageHistory({
      caseId,
      fromStage: "legal",
      toStage: "operations",
      fromOwnerId,
      toOwnerId,
      actorId: fromOwnerId,
      note: "Auto: expediente enviado a Andrium",
    }).catch((err) => logger.warn({ err, caseId }, "cases.onExpedienteSentToFinanceCase: stage history failed — non-fatal"));
    await appEvents.emitAndWait({
      type: "case.owner_changed",
      payload: { caseId, orgId: caseRow.org_id, fromOwnerId, toOwnerId },
      occurredAt: new Date(),
    });
    logger.info({ caseId, toOwnerId }, "cases: stage advanced legal→operations via expediente.sent_to_finance");
  }
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

