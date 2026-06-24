/**
 * Catalog service — use cases.
 *
 * Pattern: can() → parse Zod → domain rules → repo → audit → event (only 2 canonical).
 *
 * DOC-40 §3. Every mutation calls can(actor, 'catalog', 'edit') as first line,
 * then delegates to writeAudit() from the audit module.
 *
 * STUBS (F4): pdf_automation cycle steps 2-5 (detectAcroFields, aiProposeStructure,
 * generateTestPdf), proposeExtractionSchema, testGeneration — these reference
 * dependencies (pdf-lib, anthropic, ai-engine) not yet integrated in F1.
 */

import { can } from "@/backend/platform/authz";
import { appEvents } from "@/backend/platform/events";
import type { Actor } from "@/backend/platform/authz";
import { writeAudit } from "@/backend/modules/audit";
import { PROFILE_SOURCE_FIELDS } from "@/shared/constants/profile-fields";
import { isPartyRoleKey } from "@/shared/constants/party-roles";
import { GENERATION_MODELS } from "@/shared/constants/ai-models";
import { deriveFieldState, parseConditionOrNull, type QuestionCondition } from "@/shared/form-logic/conditions";
import type { ProposedQuestion } from "@/backend/modules/ai-engine";
import { detectAcroFields as platformDetectAcroFields, fillAcroForm, extractPdfText, backfillNaTextFields } from "@/backend/platform/pdf";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { getAnthropicClient } from "@/backend/platform/anthropic";

import {
  CreateServiceDtoSchema,
  UpdateServiceDtoSchema,
  UpsertPlanDtoSchema,
  CreatePhaseDtoSchema,
  UpdatePhaseDtoSchema,
  CreateMilestoneDtoSchema,
  CreateRequiredDocDtoSchema,
  UpsertServicePartyRoleDtoSchema,
  UpsertAppointmentScheduleDtoSchema,
  CreateFormDtoSchema,
  QuestionSchema,
  validateServicePublication,
  validateEntryServiceLink,
  expandPerPartyRequirements,
  applyRequirementOverrides,
  validateVersionPublication,
  validateSourceRef,
  validateExtractionSchema,
  isServiceContractable,
  catalogError,
  assertNoIssues,
  isFkViolation,
  nextVersionNumber,
  GenerationSectionSchema,
  GenerationAssemblySchema,
} from "./domain";

import { z } from "zod";

// Q-1: Zod schema for upsertQuestion input.
// id is optional (absent = INSERT, present = UPDATE/upsert).
const UpsertQuestionSchema = QuestionSchema.partial({ id: true, position: true }).extend({
  group_id: z.string().uuid(),
});

import type {
  Service,
  ServicePlan,
  ServicePhase,
  Milestone,
  FormDefinition,
  AutomationVersion,
  QuestionGroup,
  Question,
  GenerationConfig,
  GenerationSection,
  GenerationAssembly,
  Dataset,
  DatasetItem,
  PublicationCheck,
  ExpandedRequirement,
  RequirementOverrideInput,
  ResolvedForm,
  CreateServiceDto,
  UpdateServiceDto,
  UpsertPlanDto,
  CreatePhaseDto,
  UpdatePhaseDto,
  CreateMilestoneDto,
  CreateRequiredDocDto,
  ServicePartyRole,
  UpsertServicePartyRoleDto,
  UpsertAppointmentScheduleDto,
  CreateFormDto,
} from "./domain";

import * as repo from "./repository";
import type { PolicyRow, AppointmentScheduleRow, FormDefinitionRow, RequiredDocRow } from "./repository";

// ---------------------------------------------------------------------------
// Type helpers (convert DB rows to domain objects)
// ---------------------------------------------------------------------------

// The domain schemas are kept loose (partial i18n allowed in drafts).
// We simply return the DB rows as-is through the domain type since the DB
// column shapes match the Zod schemas (minus strict i18n validation).

// ---------------------------------------------------------------------------
// §3.1 Services
// ---------------------------------------------------------------------------

/**
 * Creates a new service in draft mode (is_active=false always).
 *
 * @api-id API-CAT-08
 */
export async function createService(actor: Actor, input: CreateServiceDto): Promise<Service> {
  can(actor, "catalog", "edit");
  const dto = CreateServiceDtoSchema.parse(input);

  if (await repo.slugExists(actor.orgId, dto.slug)) {
    throw catalogError("CATALOG_SLUG_TAKEN", `Slug "${dto.slug}" is already in use.`);
  }

  if (dto.entry_parent_service_id) {
    const parent = await repo.findServiceById(dto.entry_parent_service_id);
    const phases = await repo.listPhases(dto.entry_parent_service_id);
    const issues = validateEntryServiceLink({
      service: { id: "new", ...dto, entry_parent_service_id: dto.entry_parent_service_id ?? null, entry_phase_id: dto.entry_phase_id ?? null },
      parent: parent as unknown as Service | null,
      parentPhaseIds: phases.map((p) => p.id),
    });
    assertNoIssues(issues);
  }

  const row = await repo.insertService({
    org_id: actor.orgId,
    slug: dto.slug,
    category: dto.category,
    label_i18n: dto.label_i18n ?? {},
    description_i18n: dto.description_i18n ?? null,
    icon: dto.icon ?? "doc",
    color: dto.color ?? "accent",
    is_active: false,
    is_public: dto.is_public ?? true,
    entry_parent_service_id: dto.entry_parent_service_id ?? null,
    entry_phase_id: dto.entry_phase_id ?? null,
  });

  await writeAudit(actor, "catalog.service.created", "services", row.id, { after: row });
  return row as unknown as Service;
}

/**
 * Updates a service's editable fields.
 *
 * @api-id API-CAT-09
 */
export async function updateService(
  actor: Actor,
  id: string,
  patch: UpdateServiceDto,
): Promise<Service> {
  can(actor, "catalog", "edit");
  const dto = UpdateServiceDtoSchema.parse(patch);

  const before = await repo.findServiceById(id);
  if (!before) throw catalogError("CATALOG_SERVICE_NOT_FOUND");

  // M-5: org ownership check (defense in depth; RLS is last line)
  if (before.org_id !== actor.orgId) throw catalogError("CATALOG_SERVICE_NOT_FOUND");

  if (before.archived_at) {
    throw catalogError("CATALOG_SERVICE_ARCHIVED", "Restore the service before editing.");
  }

  if (dto.slug && dto.slug !== before.slug) {
    // Slug lock: frozen once cases exist (RF-ADM-020 E1).
    // TODO(F2): route through the cases module index once it exists. Until
    // then the count lives in catalog/repository as a direct table read —
    // a bundler-resolved import of a nonexistent module breaks the build.
    const casesCount = await repo.countCasesReferencingService(id);
    if (casesCount > 0) throw catalogError("CATALOG_SLUG_LOCKED");
    if (await repo.slugExists(actor.orgId, dto.slug)) {
      throw catalogError("CATALOG_SLUG_TAKEN");
    }
  }

  if (
    (dto.entry_parent_service_id !== undefined || dto.entry_phase_id !== undefined) &&
    (dto.entry_parent_service_id ?? before.entry_parent_service_id)
  ) {
    const parentId = dto.entry_parent_service_id ?? before.entry_parent_service_id;
    const phaseId = dto.entry_phase_id ?? before.entry_phase_id;
    const parent = parentId ? await repo.findServiceById(parentId) : null;
    const phases = parentId ? await repo.listPhases(parentId) : [];
    const issues = validateEntryServiceLink({
      service: { id, entry_parent_service_id: parentId ?? null, entry_phase_id: phaseId ?? null },
      parent: parent as unknown as Service | null,
      parentPhaseIds: phases.map((p) => p.id),
    });
    assertNoIssues(issues);
  }

  const after = await repo.updateService(id, dto as Parameters<typeof repo.updateService>[1]);
  await writeAudit(actor, "catalog.service.updated", "services", id, { before, after });
  return after as unknown as Service;
}

/**
 * Activates (publishes) a service after passing the checklist.
 *
 * @api-id API-CAT-10
 */
export async function activateService(
  actor: Actor,
  id: string,
): Promise<PublicationCheck> {
  can(actor, "catalog", "edit");

  const service = await repo.findServiceById(id);
  if (!service) throw catalogError("CATALOG_SERVICE_NOT_FOUND");

  // M-5: org ownership check (defense in depth; RLS is last line)
  if (service.org_id !== actor.orgId) throw catalogError("CATALOG_SERVICE_NOT_FOUND");

  const [plans, phases] = await Promise.all([repo.listPlans(id), repo.listPhases(id)]);

  const check = validateServicePublication({
    service: service as unknown as Service,
    plans: plans as unknown as ServicePlan[],
    phases: phases as unknown as ServicePhase[],
  });

  if (!check.ok) return check;

  await repo.updateService(id, { is_active: true });
  await writeAudit(actor, "catalog.service.activated", "services", id, {
    before: { is_active: service.is_active },
    after: { is_active: true },
  });

  appEvents.emit({
    type: "service.published",
    payload: {
      org_id: actor.orgId,
      service_id: service.id,
      slug: service.slug,
      category: service.category as "migratorio" | "empresarial" | "familiar",
      label_i18n: service.label_i18n as { es: string; en: string },
      is_public: service.is_public,
      is_entry_service: service.entry_parent_service_id !== null,
      published_by: actor.userId,
      occurred_at: new Date().toISOString(),
    },
    occurredAt: new Date(),
  });

  return check;
}

/**
 * @api-id API-CAT-11
 */
export async function deactivateService(actor: Actor, id: string): Promise<void> {
  can(actor, "catalog", "edit");
  // L-1: load before for audit diff
  const before = await repo.findServiceById(id);
  if (!before) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  // M-5: org ownership check (entity already loaded)
  if (before.org_id !== actor.orgId) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  await repo.updateService(id, { is_active: false });
  await writeAudit(actor, "catalog.service.deactivated", "services", id, {
    before: { is_active: before.is_active },
    after: { is_active: false },
  });
}

/**
 * @api-id API-CAT-12
 */
export async function archiveService(actor: Actor, id: string): Promise<void> {
  can(actor, "catalog", "edit");
  const before = await repo.findServiceById(id);
  if (!before) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  // M-5: org ownership check (defense in depth; RLS is last line)
  if (before.org_id !== actor.orgId) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  await repo.updateService(id, { is_active: false, archived_at: new Date().toISOString() });
  await writeAudit(actor, "catalog.service.archived", "services", id, { before });
}

/**
 * @api-id API-CAT-13
 */
export async function restoreService(actor: Actor, id: string): Promise<void> {
  can(actor, "catalog", "edit");
  // L-2: validate existence and archived state (no silent 0-row updates)
  const before = await repo.findServiceById(id);
  if (!before) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  if (!before.archived_at) {
    throw catalogError("CATALOG_SERVICE_NOT_ARCHIVED", "Service is not archived; nothing to restore.");
  }
  // M-5: org ownership check (entity already loaded)
  if (before.org_id !== actor.orgId) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  await repo.updateService(id, { archived_at: null });
  await writeAudit(actor, "catalog.service.restored", "services", id, {
    before: { archived_at: before.archived_at },
    after: { archived_at: null },
  });
}

/**
 * @api-id API-CAT-15
 */
export async function reorderServices(actor: Actor, orderedIds: string[]): Promise<void> {
  can(actor, "catalog", "edit");
  await repo.reorderServicesTx(actor.orgId, orderedIds);
  await writeAudit(actor, "catalog.service.reordered", "services", null, { after: orderedIds });
}

// ---------------------------------------------------------------------------
// §3.2 Plans — RF-ADM-023
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-16
 */
export async function upsertServicePlan(
  actor: Actor,
  input: UpsertPlanDto,
): Promise<ServicePlan> {
  can(actor, "catalog", "edit");
  const dto = UpsertPlanDtoSchema.parse(input);

  // Enforce coherence (RF-ADM-023 E2)
  if (dto.kind === "with_lawyer") dto.requires_lawyer_validation = true;
  if (dto.kind === "self") dto.requires_lawyer_validation = false;

  const plan = await repo.upsertPlanByKind(dto as Parameters<typeof repo.upsertPlanByKind>[0]);
  await writeAudit(actor, "catalog.plan.updated", "service_plans", plan.id, { after: plan });
  return plan as unknown as ServicePlan;
}

// ---------------------------------------------------------------------------
// §3.3 Phases — RF-ADM-024/025/026
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-17
 */
export async function createPhase(actor: Actor, input: CreatePhaseDto): Promise<ServicePhase> {
  can(actor, "catalog", "edit");
  const dto = CreatePhaseDtoSchema.parse(input);

  if (await repo.phaseSlugExists(dto.service_id, dto.slug)) {
    throw catalogError("CATALOG_PHASE_SLUG_TAKEN");
  }

  const position = await repo.nextPhasePosition(dto.service_id);
  const phase = await repo.insertPhase({
    service_id: dto.service_id,
    slug: dto.slug,
    label_i18n: dto.label_i18n ?? {},
    description_i18n: dto.description_i18n ?? null,
    client_explainer_i18n: dto.client_explainer_i18n ?? null,
    position,
  });

  await writeAudit(actor, "catalog.phase.created", "service_phases", phase.id, { after: phase });
  return phase as unknown as ServicePhase;
}

/**
 * @api-id API-CAT-18
 */
export async function updatePhase(
  actor: Actor,
  id: string,
  patch: UpdatePhaseDto,
): Promise<ServicePhase> {
  can(actor, "catalog", "edit");
  const dto = UpdatePhaseDtoSchema.parse(patch);
  const phase = await repo.updatePhase(id, dto as Parameters<typeof repo.updatePhase>[1]);
  await writeAudit(actor, "catalog.phase.updated", "service_phases", id, { after: phase });
  return phase as unknown as ServicePhase;
}

/**
 * @api-id API-CAT-19
 */
export async function deletePhase(actor: Actor, phaseId: string): Promise<void> {
  can(actor, "catalog", "edit");
  try {
    await repo.deletePhase(phaseId);
  } catch (e) {
    if (isFkViolation(e)) throw catalogError("CATALOG_PHASE_IN_USE");
    throw e;
  }
  await writeAudit(actor, "catalog.phase.deleted", "service_phases", phaseId, {});
}

/**
 * @api-id API-CAT-20
 */
export async function reorderPhases(
  actor: Actor,
  serviceId: string,
  orderedIds: string[],
): Promise<void> {
  can(actor, "catalog", "edit");
  await repo.reorderPhasesTx(serviceId, orderedIds);
  await writeAudit(actor, "catalog.phase.updated", "service_phases", null, { after: orderedIds });
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-21
 */
export async function createMilestone(
  actor: Actor,
  input: CreateMilestoneDto,
): Promise<Milestone> {
  can(actor, "catalog", "edit");
  const dto = CreateMilestoneDtoSchema.parse(input);

  // Calculate next position
  const existing = await repo.listMilestones(dto.service_phase_id);
  const position = existing.reduce((m, m2) => Math.max(m, m2.position), -1) + 1;

  const milestone = await repo.insertMilestone({
    service_phase_id: dto.service_phase_id,
    slug: dto.slug,
    label_i18n: dto.label_i18n ?? {},
    description_i18n: dto.description_i18n ?? null,
    glossary_i18n: dto.glossary_i18n ?? null,
    icon: dto.icon ?? "route",
    position,
  });

  await writeAudit(actor, "catalog.milestone.created", "service_phase_milestones", milestone.id, {
    after: milestone,
  });
  return milestone as unknown as Milestone;
}

/**
 * @api-id API-CAT-22
 */
export async function updateMilestone(
  actor: Actor,
  id: string,
  patch: Partial<CreateMilestoneDto>,
): Promise<Milestone> {
  can(actor, "catalog", "edit");
  const milestone = await repo.updateMilestone(
    id,
    patch as Parameters<typeof repo.updateMilestone>[1],
  );
  await writeAudit(actor, "catalog.milestone.updated", "service_phase_milestones", id, {
    after: milestone,
  });
  return milestone as unknown as Milestone;
}

/**
 * @api-id API-CAT-23
 */
export async function deleteMilestone(actor: Actor, milestoneId: string): Promise<void> {
  can(actor, "catalog", "edit");
  await repo.deleteMilestone(milestoneId);
  await writeAudit(actor, "catalog.milestone.deleted", "service_phase_milestones", milestoneId, {});
}

// ---------------------------------------------------------------------------
// Phase appointment policy
// ---------------------------------------------------------------------------

export async function upsertPhasePolicy(
  actor: Actor,
  input: { service_phase_id: string; appointment_count?: number; duration_minutes?: number; kind?: string },
): Promise<PolicyRow> {
  can(actor, "catalog", "edit");
  const policy = await repo.upsertPhasePolicy(
    input as Parameters<typeof repo.upsertPhasePolicy>[0],
  );
  await writeAudit(actor, "catalog.phase_policy.updated", "phase_appointment_policies", input.service_phase_id, {
    after: policy,
  });
  return policy;
}

// ---------------------------------------------------------------------------
// §3.4 Required documents — RF-ADM-027/028/029
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-25
 */
export async function createRequiredDocument(
  actor: Actor,
  input: CreateRequiredDocDto,
): Promise<RequiredDocRow> {
  can(actor, "catalog", "edit");
  const dto = CreateRequiredDocDtoSchema.parse(input);

  if (dto.is_per_party && (!dto.party_roles || dto.party_roles.length === 0)) {
    throw catalogError("CATALOG_PER_PARTY_WITHOUT_ROLES");
  }
  if (dto.party_roles?.some((r) => !isPartyRoleKey(r))) {
    throw catalogError("CATALOG_PER_PARTY_INVALID_ROLE");
  }

  if (dto.ai_extract && dto.extraction_schema) {
    const { valid, reason } = validateExtractionSchema(dto.extraction_schema);
    if (!valid) throw catalogError("CATALOG_EXTRACTION_SCHEMA_INVALID", reason);
  }

  if (await repo.requiredDocSlugExists(dto.service_phase_id, dto.slug)) {
    throw catalogError("CATALOG_DOC_SLUG_TAKEN");
  }

  const doc = await repo.insertRequiredDocument(
    dto as Parameters<typeof repo.insertRequiredDocument>[0],
  );
  await writeAudit(actor, "catalog.required_document.created", "required_document_types", doc.id, {
    after: doc,
  });
  return doc;
}

/**
 * @api-id API-CAT-26
 */
export async function updateRequiredDocument(
  actor: Actor,
  id: string,
  patch: Partial<CreateRequiredDocDto>,
): Promise<RequiredDocRow> {
  can(actor, "catalog", "edit");

  if (patch.is_per_party && (!patch.party_roles || patch.party_roles.length === 0)) {
    throw catalogError("CATALOG_PER_PARTY_WITHOUT_ROLES");
  }
  if (patch.party_roles?.some((r) => !isPartyRoleKey(r))) {
    throw catalogError("CATALOG_PER_PARTY_INVALID_ROLE");
  }

  if (patch.ai_extract && patch.extraction_schema) {
    const { valid, reason } = validateExtractionSchema(patch.extraction_schema);
    if (!valid) throw catalogError("CATALOG_EXTRACTION_SCHEMA_INVALID", reason);
  }

  const doc = await repo.updateRequiredDocument(
    id,
    patch as Parameters<typeof repo.updateRequiredDocument>[1],
  );
  await writeAudit(actor, "catalog.required_document.updated", "required_document_types", id, {
    after: doc,
  });
  return doc;
}

/**
 * Editor-assisted extraction schema proposal (RF-ADM-029 / DOC-74 §2.6).
 *
 * Delegates to ai-engine.proposeExtractionSchema (T2, Sonnet) which generates
 * a JSON Schema portable to Gemini. Validates the result against the Gemini
 * subset rules before returning. Does NOT persist — the Admin edits and saves
 * via updateRequiredDocument.
 *
 * @api-id API-CAT-28
 */
export async function proposeExtractionSchema(
  actor: Actor,
  input: { service_phase_id: string; label: string; help?: string; sample_pdf_path?: string },
): Promise<object> {
  can(actor, "catalog", "edit");

  // Import ai-engine via module-pub boundary
  const { proposeExtractionSchema: aiProposeExtractionSchema } = await import("@/backend/modules/ai-engine");

  const result = await aiProposeExtractionSchema(actor, {
    requirementLabel: { es: input.label, en: input.label }, // label supplied in the UI language; AI will enrich
    helpText: input.help,
    sampleDocRef: input.sample_pdf_path,
  } as Parameters<typeof aiProposeExtractionSchema>[1]);

  // Extract the schema from the result (ai-engine returns { schema: {...} })
  const schema = (result as { schema?: Record<string, unknown> }).schema ?? result;

  // Validate against Gemini subset (blocking — same check as when saving)
  const { valid, reason } = validateExtractionSchema(schema);
  if (!valid) throw catalogError("CATALOG_EXTRACTION_SCHEMA_INVALID", reason);

  return schema;
}

/**
 * Validates an extraction_schema against the Gemini-portable subset rules
 * (same check applied when saving a required document). Pure + synchronous —
 * exposed for live validation feedback in the admin "Esquema…" editor so the
 * frontend never has to duplicate the rule set (single source of truth).
 *
 * @api-id API-CAT-28b
 */
export function checkExtractionSchema(
  actor: Actor,
  input: { schema: unknown },
): { valid: boolean; reason?: string } {
  can(actor, "catalog", "edit");
  return validateExtractionSchema(input.schema);
}

// ---------------------------------------------------------------------------
// §3.5 Form definitions (pdf_automation lifecycle)
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-29
 */
export async function createFormDefinition(
  actor: Actor,
  input: CreateFormDto,
): Promise<FormDefinition> {
  can(actor, "catalog", "edit");
  const dto = CreateFormDtoSchema.parse(input);

  if (await repo.formSlugExists(dto.service_phase_id, dto.slug)) {
    throw catalogError("CATALOG_FORM_SLUG_TAKEN");
  }

  const form = await repo.insertFormDefinition(
    dto as Parameters<typeof repo.insertFormDefinition>[0],
  );
  await writeAudit(actor, "catalog.form.created", "form_definitions", form.id, { after: form });
  return form as unknown as FormDefinition;
}

/**
 * @api-id API-CAT-30
 */
export async function updateFormDefinition(
  actor: Actor,
  id: string,
  patch: Partial<CreateFormDto> & { is_active?: boolean },
): Promise<FormDefinition> {
  can(actor, "catalog", "edit");

  const before = await repo.findFormDefinition(id);
  if (!before) throw catalogError("CATALOG_FORM_NOT_FOUND");

  // kind is IMMUTABLE (RF-ADM-030 A1)
  if ("kind" in patch && patch.kind !== before.kind) {
    throw catalogError(
      "CATALOG_FORM_KIND_IMMUTABLE",
      "Form kind cannot be changed after creation. Archive and recreate.",
    );
  }

  const form = await repo.updateFormDefinition(
    id,
    patch as Parameters<typeof repo.updateFormDefinition>[1],
  );
  await writeAudit(actor, "catalog.form.updated", "form_definitions", id, { after: form });
  return form as unknown as FormDefinition;
}

/**
 * Paso 1 — upload PDF + create draft version + run AcroField detection.
 *
 * Flow: confirm storage upload → create form_automation_versions draft (version=max+1)
 * → download PDF bytes → detectAcroFields (mupdf) → update detected_fields.
 * 0 fields → version stays draft with empty detected_fields (RF-ADM-031 E1).
 * PDF unreadable → CATALOG_PDF_UNREADABLE.
 *
 * @api-id API-CAT-32
 */
export async function createAutomationVersion(
  actor: Actor,
  input: { form_definition_id: string; uploaded_pdf_path: string; source_language?: "en" | "es" },
): Promise<AutomationVersion> {
  can(actor, "catalog", "edit");

  const form = await repo.findFormDefinition(input.form_definition_id);
  if (!form) throw catalogError("CATALOG_FORM_NOT_FOUND");
  if (form.kind !== "pdf_automation") throw catalogError("CATALOG_FORM_KIND_MISMATCH");

  // H-1: Enforce path-prefix isolation — prevents a staff user from pointing at
  // another entity's PDF in catalog-assets (cross-entity path traversal).
  if (!input.uploaded_pdf_path.startsWith(`forms/${input.form_definition_id}/`)) {
    throw catalogError("CATALOG_PDF_INVALID_PATH", "uploaded_pdf_path must be scoped to the form definition.");
  }

  // H-1: Validate the uploaded object (extension allowlist + magic-bytes check).
  // Also confirms the upload actually completed (object exists in storage).
  const { validateUploadedObject } = await import("@/backend/platform/storage");
  const storageCheck = await validateUploadedObject("catalog-assets", input.uploaded_pdf_path, "catalog-assets");
  if (!storageCheck.ok) {
    throw catalogError("CATALOG_PDF_UNREADABLE", storageCheck.reason ?? "PDF storage validation failed.");
  }

  // Determine next version number
  const existingVersions = await repo.listVersions(form.id);
  const versionNumber = nextVersionNumber(existingVersions as unknown as AutomationVersion[]);

  // Create draft version with empty detected_fields
  const versionRow = await repo.insertAutomationVersion({
    form_definition_id: form.id,
    version: versionNumber,
    source_pdf_path: input.uploaded_pdf_path,
    source_language: input.source_language ?? "en",
    detected_fields: [],
    status: "draft",
    created_by: actor.userId,
  });

  await writeAudit(actor, "catalog.form_version.created", "form_automation_versions", versionRow.id, {
    after: { form_definition_id: form.id, version: versionNumber, source_pdf_path: input.uploaded_pdf_path },
  });

  // Chain: immediately run field detection on the newly created version
  return redetectFields(actor, versionRow.id);
}

/**
 * Remaps a copied condition's controlling-question id (old → new). Dropped if the
 * controlling question wasn't part of the copy (should not happen on a full copy).
 */
function remapConditionIds(raw: unknown, oldToNew: Map<string, string>): QuestionCondition | null {
  const cond = parseConditionOrNull(raw);
  if (!cond) return null;
  const newQ = oldToNew.get(cond.when.question);
  if (!newQ) return null;
  return { ...cond, when: { ...cond.when, question: newQ } };
}

/**
 * Duplicates an immutable (published/archived) version into a fresh editable
 * DRAFT: same PDF + detected_fields, with ALL groups/questions copied and their
 * conditions remapped to the new question ids. Lets the admin keep iterating on a
 * published form without re-uploading the PDF or re-structuring from scratch — the
 * published version stays intact (cases that started on it keep using it).
 *
 * @api-id API-CAT-44
 */
export async function duplicateVersionAsDraft(actor: Actor, versionId: string): Promise<AutomationVersion> {
  can(actor, "catalog", "edit");
  const source = await repo.findVersionById(versionId);
  if (!source) throw catalogError("CATALOG_VERSION_NOT_FOUND");

  const existingVersions = await repo.listVersions(source.form_definition_id);
  const versionNumber = nextVersionNumber(existingVersions as unknown as AutomationVersion[]);

  const draft = await repo.insertAutomationVersion({
    form_definition_id: source.form_definition_id,
    version: versionNumber,
    source_pdf_path: source.source_pdf_path,
    source_language: (source.source_language as "en" | "es" | null) ?? "en",
    detected_fields: source.detected_fields,
    status: "draft",
    created_by: actor.userId,
  });

  // Copy groups + questions. Pass 1: create (without conditions) recording old→new
  // question ids; Pass 2: remap each condition's controlling id + persist.
  const tree = await repo.getVersionTree(versionId);
  const oldToNewQ = new Map<string, string>();
  if (tree) {
    for (const g of tree.groups) {
      const newGroup = await repo.upsertQuestionGroup({
        automation_version_id: draft.id,
        title_i18n: g.title_i18n,
        position: g.position,
      });
      for (const q of g.questions) {
        const newQ = await repo.upsertQuestion({
          group_id: newGroup.id,
          question_i18n: q.question_i18n,
          help_i18n: q.help_i18n,
          field_type: q.field_type,
          options: q.options,
          pdf_field_name: q.pdf_field_name,
          source: q.source,
          source_ref: q.source_ref,
          is_required: q.is_required,
          position: q.position,
          validation: q.validation,
        });
        oldToNewQ.set(q.id, newQ.id);
      }
    }
    for (const g of tree.groups) {
      for (const q of g.questions) {
        if (!q.condition) continue;
        const remapped = remapConditionIds(q.condition, oldToNewQ);
        if (remapped) {
          await repo.updateQuestionCondition(oldToNewQ.get(q.id)!, remapped as unknown as import("@/shared/database.types").Json);
        }
      }
    }
  }

  await writeAudit(actor, "catalog.form_version.created", "form_automation_versions", draft.id, {
    after: { form_definition_id: source.form_definition_id, version: versionNumber, duplicated_from: versionId },
  });
  return draft as unknown as AutomationVersion;
}

/**
 * Paso 2 — (re-)detect AcroForm fields from the stored PDF.
 *
 * Downloads the PDF from catalog-assets, runs detectAcroFields (mupdf),
 * and updates detected_fields on the draft version. Only operates on draft
 * versions (RF-ADM-035 A2: published/archived are immutable).
 *
 * @api-id API-CAT-33
 */
export async function redetectFields(
  actor: Actor,
  versionId: string,
): Promise<AutomationVersion> {
  can(actor, "catalog", "edit");

  const version = await repo.findVersionById(versionId);
  if (!version) throw catalogError("CATALOG_VERSION_NOT_FOUND");
  if (version.status !== "draft") throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");

  // Download PDF bytes from catalog-assets
  const supabase = createServiceClient();
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("catalog-assets")
    .download(version.source_pdf_path);

  if (dlErr || !fileData) {
    throw catalogError("CATALOG_PDF_UNREADABLE", `Cannot download PDF: ${dlErr?.message ?? "no data"}`);
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());

  // Detect AcroForm fields using mupdf
  let rawFields: import("@/backend/platform/pdf").DetectedField[];
  try {
    rawFields = await platformDetectAcroFields(bytes);
  } catch (err) {
    logger.warn({ err, versionId }, "catalog: detectAcroFields failed — PDF may be encrypted or malformed");
    throw catalogError("CATALOG_PDF_UNREADABLE", `AcroField detection failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Map platform DetectedField to domain DetectedField shape
  // platform: { name, type, page, rect } — domain: { pdf_field_name, field_type, page, rect }
  // field types: platform has 'combobox'/'radiobutton'/'button'; domain uses 'dropdown'/'radio'/'unknown'
  const domainTypeMap: Record<string, string> = {
    text: "text",
    checkbox: "checkbox",
    combobox: "dropdown",
    radiobutton: "radio",
    signature: "signature",
    button: "unknown",
  };

  const detectedFields = rawFields.map((f) => ({
    pdf_field_name: f.name,
    field_type: (domainTypeMap[f.type] ?? "unknown") as "text" | "checkbox" | "radio" | "dropdown" | "signature" | "unknown",
    page: f.page + 1, // mupdf is 0-indexed; domain schema uses 1-indexed
    rect: f.rect as [number, number, number, number],
  }));

  // Update the version with the detected fields (empty = no AcroForm fields found)
  const updated = await repo.updateVersion(versionId, {
    detected_fields: detectedFields as unknown as import("@/shared/database.types").Json,
  });

  // Note: 0 fields is valid — the UI will show "PDF sin campos rellenables"
  // and the checklist will block publication (RF-ADM-031 E1 / CATALOG_NO_ACROFORM_FIELDS)
  return updated as unknown as AutomationVersion;
}

/**
 * Paso 3 — AI-assisted form segmentation (RF-ADM-032 / DOC-74 §2.6).
 *
 * Reads detected_fields + optional PDF text context, calls ai-engine
 * proposeFormSegmentation (T2, Sonnet), then materializes the proposal
 * as draft groups + questions. Mode 'replace' overwrites non-confirmed
 * groups; mode 'merge' appends without touching existing content.
 *
 * @api-id API-CAT-34
 */
export async function aiProposeStructure(
  actor: Actor,
  input: { version_id: string; group_id?: string; mode: "replace" | "merge" },
): Promise<{ groups: number; questions: number }> {
  can(actor, "catalog", "edit");

  const version = await repo.findVersionById(input.version_id);
  if (!version) throw catalogError("CATALOG_VERSION_NOT_FOUND");
  if (version.status !== "draft") throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");

  const detectedFields = (version.detected_fields ?? []) as Array<{
    pdf_field_name: string;
    field_type: string;
    page: number;
    rect?: [number, number, number, number];
  }>;

  if (detectedFields.length === 0) {
    throw catalogError("CATALOG_NO_ACROFORM_FIELDS");
  }

  // Narrow to group scope if re-proposing for a single group
  let scopeFields = detectedFields;
  if (input.group_id) {
    const groupQs = await repo.listQuestions(input.group_id);
    const groupFieldNames = new Set(groupQs.map((q) => q.pdf_field_name).filter(Boolean));
    scopeFields = detectedFields.filter((f) => groupFieldNames.has(f.pdf_field_name));
    // A scoped re-proposal with no mapped fields would call the AI with an empty
    // field list (silent no-op / hallucination) — fail loudly instead.
    if (scopeFields.length === 0) {
      throw catalogError("CATALOG_NO_ACROFORM_FIELDS", "No AcroForm fields in this group's scope.");
    }
  }

  // Map domain detected_fields to the shape proposeFormSegmentation expects.
  // rect is passed so the model can reconstruct repeating tables SPATIALLY (rows
  // share y, columns share x) instead of guessing from the anonymous bracket index
  // — the index order does NOT follow visual order on USCIS forms.
  const aiFields = scopeFields.map((f) => ({
    name: f.pdf_field_name,
    type: f.field_type,
    page: f.page,
    rect: f.rect,
  }));
  const detectedNames = new Set(detectedFields.map((f) => f.pdf_field_name));

  // Form + service context so the AI can research the right official instructions.
  const formDef = await repo.findFormDefinition(version.form_definition_id);
  const phase = formDef?.service_phase_id ? await repo.findPhaseById(formDef.service_phase_id) : null;
  const service = phase?.service_id ? await repo.findServiceById(phase.service_id) : null;
  const pickEs = (v: unknown): string | undefined => {
    const o = v as { es?: string; en?: string } | null | undefined;
    return o?.es || o?.en || undefined;
  };
  const serviceContext = phase
    ? [pickEs(phase.label_i18n), pickEs(phase.client_explainer_i18n)].filter(Boolean).join(" — ")
    : undefined;

  // Extract the form's printed text to GROUND the proposal: the official labels
  // ("Your Occupation", "Name and Address of Employer", column headers, …) let the
  // model map otherwise-anonymous AcroForm field names ("TextField13[39]") to the
  // right question instead of guessing. Best-effort — a failure proceeds ungrounded.
  let pdfText = "";
  try {
    const dl = await createServiceClient().storage.from("catalog-assets").download(version.source_pdf_path);
    if (dl.data) pdfText = await extractPdfText(new Uint8Array(await dl.data.arrayBuffer()));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), versionId: input.version_id },
      "catalog: aiProposeStructure — PDF text extraction failed, proceeding without it",
    );
  }

  // M-4: Call AI FIRST, then delete existing groups — reduces the window where
  // the version is empty. If AI fails, existing groups are preserved intact.
  // Import ai-engine via its public index (module boundary — no direct service import)
  const { proposeFormSegmentation } = await import("@/backend/modules/ai-engine");
  const proposal = await proposeFormSegmentation(actor, {
    detectedFields: aiFields,
    pdfText,
    groupScope: input.group_id ? [input.group_id] : undefined,
    formName: pickEs(formDef?.label_i18n),
    formSlug: formDef?.slug,
    serviceName: pickEs(service?.label_i18n),
    serviceContext,
    profileFields: PROFILE_SOURCE_FIELDS,
  });

  // Coverage accountability (DOC-74): surface detected fields the proposal left
  // UNMAPPED so a silently-dropped applicant field is visible in the logs (purely
  // internal/office-use fields are expected to be uncovered). Deterministic — does
  // not trust the model to self-report.
  const proposedPdfNames = new Set(
    proposal.groups.flatMap((g) =>
      g.questions.map((q) => q.pdf_field_name).filter((n): n is string => !!n),
    ),
  );
  const uncovered = scopeFields.map((f) => f.pdf_field_name).filter((n) => !proposedPdfNames.has(n));
  logger.info(
    {
      versionId: input.version_id,
      detected: scopeFields.length,
      mapped: proposedPdfNames.size,
      uncovered: uncovered.length,
      uncoveredSample: uncovered.slice(0, 25),
    },
    "catalog: aiProposeStructure — field coverage",
  );

  // Materialize proposal as draft groups + questions
  let totalQuestions = 0;

  if (input.mode === "replace" && !input.group_id) {
    // Replace mode (full version): delete all existing groups + questions.
    // Done AFTER the AI call — if proposeFormSegmentation threw, we skip deletion.
    const existingGroups = await repo.listQuestionGroups(input.version_id);
    for (const g of existingGroups) {
      await repo.deleteQuestionGroup(g.id);
    }
  }

  // Conditions reference other questions by an AI-assigned `key`; questions get
  // their real ids only on insert. So we insert everything first (recording
  // key → id), then resolve + persist each condition in a second pass.
  const keyToId = new Map<string, string>();
  const pendingConditions: Array<{ questionId: string; raw: NonNullable<ProposedQuestion["condition"]> }> = [];

  for (let gi = 0; gi < proposal.groups.length; gi++) {
    const g = proposal.groups[gi];

    const titleI18n = g.title_i18n ?? g.title ?? { es: `Sección ${gi + 1}`, en: `Section ${gi + 1}` };
    const group = await repo.upsertQuestionGroup({
      automation_version_id: input.version_id,
      title_i18n: titleI18n as import("@/shared/database.types").Json,
      position: g.position ?? gi,
    });

    const questions = g.questions ?? [];
    for (let qi = 0; qi < questions.length; qi++) {
      const proposed = questions[qi];
      const safe = sanitizeProposedQuestion(proposed, qi, detectedNames);
      const inserted = await repo.upsertQuestion({
        group_id: group.id,
        question_i18n: safe.question_i18n as import("@/shared/database.types").Json,
        help_i18n: safe.help_i18n as import("@/shared/database.types").Json | null,
        field_type: safe.field_type,
        options: safe.options as import("@/shared/database.types").Json | null,
        pdf_field_name: safe.pdf_field_name,
        source: safe.source,
        source_ref: safe.source_ref as import("@/shared/database.types").Json | null,
        is_required: safe.is_required,
        position: safe.position,
        validation: safe.validation as import("@/shared/database.types").Json | null,
      });
      // Only register AI-assigned keys: a synthetic fallback could collide with
      // a real AI key and mis-wire a condition. Conditions only ever reference
      // explicit AI keys, so questions without one need no entry.
      const aiKey = typeof proposed.key === "string" && proposed.key ? proposed.key : null;
      if (aiKey) keyToId.set(aiKey, inserted.id);
      if (proposed.condition) pendingConditions.push({ questionId: inserted.id, raw: proposed.condition });
      totalQuestions++;
    }
  }

  // Pass 2 — resolve each condition's key reference to the real question id and
  // validate it; an unresolved/invalid condition is dropped (fail-safe). A persist
  // failure for one condition must NOT abort the whole proposal (conditions are
  // enrichment on top of already-inserted questions).
  for (const pc of pendingConditions) {
    const cond = resolveProposedCondition(pc.raw, keyToId, pc.questionId);
    if (!cond) continue;
    try {
      await repo.updateQuestionCondition(pc.questionId, cond as unknown as import("@/shared/database.types").Json);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), questionId: pc.questionId },
        "catalog: aiProposeStructure — condition persist failed, skipping",
      );
    }
  }

  await writeAudit(actor, "catalog.form_questions.updated", "form_automation_versions", input.version_id, {
    after: { source: "ai_proposal", groups: proposal.groups.length, questions: totalQuestions },
  });

  return { groups: proposal.groups.length, questions: totalQuestions };
}

/**
 * Resolves an AI-proposed condition: substitutes the `when.question` KEY for the
 * real question id (via keyToId) and validates the result with ConditionSchema.
 * Returns null (condition dropped) when the key is unknown or the shape is invalid.
 */
function resolveProposedCondition(
  raw: NonNullable<ProposedQuestion["condition"]>,
  keyToId: Map<string, string>,
  selfId: string,
): QuestionCondition | null {
  if (!raw || typeof raw !== "object" || !raw.when) return null;
  const keyRef = typeof raw.when.question === "string" ? raw.when.question : "";
  // Accept either an AI `key` (normal path) or, defensively, a raw id — but ONLY if
  // that id is among the questions we just minted for THIS version (keyToId.values()),
  // so a stray/foreign UUID can never leak into a condition.
  const mintedIds = new Set(keyToId.values());
  const resolvedId = keyToId.get(keyRef) ?? (mintedIds.has(keyRef) ? keyRef : undefined);
  // Drop unresolved refs AND self-references (a field gated on its own value would
  // hide itself forever on first render, since it has no answer yet).
  if (!resolvedId || resolvedId === selfId) return null;
  return parseConditionOrNull({
    when: { question: resolvedId, op: raw.when.op, value: raw.when.value },
    action: raw.action,
    lock_message_i18n: raw.lock_message_i18n ?? null,
  });
}

const FIELD_TYPES = ["text", "number", "date", "checkbox", "select", "textarea"] as const;
type FieldType = (typeof FIELD_TYPES)[number];
const QUESTION_SOURCES = ["client_answer", "document_extraction", "generation_output", "profile"] as const;
type QuestionSource = (typeof QUESTION_SOURCES)[number];

interface SafeQuestion {
  question_i18n: { es: string; en: string };
  help_i18n: { es: string; en: string } | null;
  field_type: FieldType;
  options: Array<{ value: string; label_i18n: { es: string; en: string } }> | null;
  pdf_field_name: string | null;
  source: QuestionSource;
  source_ref: Record<string, unknown> | null;
  is_required: boolean;
  position: number;
  validation: { regex?: string; min?: number; max?: number } | null;
}

/**
 * Sanitizes one AI-proposed question into a DB-safe draft row. The AI proposal is
 * UNTRUSTED: every field is validated against the schema CHECK constraints and the
 * profile whitelist before it can be persisted (fail-safe — unknown values degrade
 * to client_answer / text rather than throwing). The admin reviews + the publish
 * gate (validateSourceRef) is the final authority.
 */
function sanitizeProposedQuestion(
  q: ProposedQuestion,
  index: number,
  detectedNames: Set<string>,
): SafeQuestion {
  const i18n = (v: unknown): { es: string; en: string } => {
    const o = (v ?? {}) as { es?: unknown; en?: unknown };
    return { es: typeof o.es === "string" ? o.es : "", en: typeof o.en === "string" ? o.en : "" };
  };

  // field_type — fall back to text when unknown
  let fieldType: FieldType = (FIELD_TYPES as readonly string[]).includes(q.field_type ?? "")
    ? (q.field_type as FieldType)
    : "text";

  // options — only meaningful for select; require at least one valid {value}
  let options: SafeQuestion["options"] = null;
  if (fieldType === "select") {
    const raw = Array.isArray(q.options) ? q.options : [];
    const cleaned = raw
      .filter((o) => o && typeof o.value === "string" && o.value.length > 0)
      .map((o) => ({ value: o.value, label_i18n: i18n(o.label_i18n) }));
    if (cleaned.length > 0) options = cleaned;
    else fieldType = "text"; // a select with no options is invalid → degrade
  }

  // source — validate enum + the profile whitelist; degrade to client_answer
  let source: QuestionSource = (QUESTION_SOURCES as readonly string[]).includes(q.source ?? "")
    ? (q.source as QuestionSource)
    : "client_answer";
  let sourceRef: Record<string, unknown> | null =
    q.source_ref && typeof q.source_ref === "object" ? (q.source_ref as Record<string, unknown>) : null;

  if (source === "profile") {
    const field = sourceRef?.["profile_field"];
    if (typeof field !== "string" || !(PROFILE_SOURCE_FIELDS as readonly string[]).includes(field)) {
      source = "client_answer";
      sourceRef = null;
    } else {
      sourceRef = { profile_field: field };
    }
  } else if (source === "document_extraction") {
    if (typeof sourceRef?.["document_slug"] !== "string") {
      source = "client_answer";
      sourceRef = null;
    }
  } else if (source === "generation_output") {
    if (typeof sourceRef?.["form_slug"] !== "string") {
      source = "client_answer";
      sourceRef = null;
    }
  } else {
    sourceRef = null; // client_answer never carries a ref
  }

  // pdf_field_name — only keep names that actually exist in the AcroForm
  const pdfFieldName =
    typeof q.pdf_field_name === "string" && detectedNames.has(q.pdf_field_name) ? q.pdf_field_name : null;

  // help_i18n — keep only if it carries text
  const help = q.help_i18n ? i18n(q.help_i18n) : null;
  const helpI18n = help && (help.es || help.en) ? help : null;

  // validation — keep only well-typed {regex?, min?, max?}
  let validation: SafeQuestion["validation"] = null;
  if (q.validation && typeof q.validation === "object") {
    const v: { regex?: string; min?: number; max?: number } = {};
    if (typeof q.validation.regex === "string") v.regex = q.validation.regex;
    if (typeof q.validation.min === "number") v.min = q.validation.min;
    if (typeof q.validation.max === "number") v.max = q.validation.max;
    if (Object.keys(v).length > 0) validation = v;
  }

  return {
    question_i18n: i18n(q.question_i18n),
    help_i18n: helpI18n,
    field_type: fieldType,
    options,
    pdf_field_name: pdfFieldName,
    source,
    source_ref: sourceRef,
    is_required: typeof q.is_required === "boolean" ? q.is_required : true,
    position: typeof q.position === "number" ? q.position : index,
    validation,
  };
}

/**
 * @api-id API-CAT-35
 */
export async function upsertQuestionGroup(
  actor: Actor,
  input: { id?: string; automation_version_id: string; title_i18n?: Record<string, string>; position?: number },
): Promise<QuestionGroup> {
  can(actor, "catalog", "edit");

  const version = await repo.findVersionById(input.automation_version_id);
  if (!version) throw catalogError("CATALOG_VERSION_NOT_FOUND");
  if (version.status !== "draft") throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");

  const group = await repo.upsertQuestionGroup(
    input as Parameters<typeof repo.upsertQuestionGroup>[0],
  );
  await writeAudit(actor, "catalog.form_questions.updated", "form_question_groups", group.id, {
    after: group,
  });
  return group as unknown as QuestionGroup;
}

/**
 * @api-id API-CAT-36
 */
export async function deleteQuestionGroup(actor: Actor, groupId: string): Promise<void> {
  can(actor, "catalog", "edit");

  const version = await repo.findVersionByGroup(groupId);
  if (version && version.status !== "draft") {
    throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");
  }

  await repo.deleteQuestionGroup(groupId);
  await writeAudit(actor, "catalog.form_questions.updated", "form_question_groups", groupId, {});
}

/**
 * @api-id API-CAT-38
 */
export async function upsertQuestion(
  actor: Actor,
  input: Record<string, unknown>,
): Promise<Question> {
  can(actor, "catalog", "edit");

  // Q-1: validate at boundary (consistent with every other use case in this module)
  const dto = UpsertQuestionSchema.parse(input);

  const groupId = dto.group_id;
  const version = await repo.findVersionByGroup(groupId);
  if (!version) throw catalogError("CATALOG_FORM_NOT_FOUND");
  if (version.status !== "draft") throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");

  // source_ref validation
  if (dto.source && dto.source !== "client_answer") {
    const slugIndex = await repo.getServiceSlugIndex(version.form_definition_id);
    const ctx = {
      documentSlugsWithSchema: slugIndex.documentsWithSchema,
      aiLetterSlugs: slugIndex.aiLetterSlugs,
      profileFields: Array.from(PROFILE_SOURCE_FIELDS),
    };
    const sourceIssues = validateSourceRef(dto as unknown as import("./domain").Question, ctx);
    assertNoIssues(sourceIssues);
  }

  // pdf_field_name must exist in detected_fields
  if (dto.pdf_field_name) {
    const fieldName = dto.pdf_field_name;
    // detected_fields is stored as Json in DB — safe cast to array
    const detectedFields = (version.detected_fields ?? []) as Array<{ pdf_field_name: string }>;
    const detectedNames = new Set(detectedFields.map((f) => f.pdf_field_name));
    if (!detectedNames.has(fieldName)) {
      throw catalogError("CATALOG_PDF_FIELD_UNKNOWN", `Field "${fieldName}" not in detected_fields.`);
    }
  }

  const q = await repo.upsertQuestion(dto as Parameters<typeof repo.upsertQuestion>[0]);
  await writeAudit(actor, "catalog.form_questions.updated", "form_questions", q.id, { after: q });
  return q as unknown as Question;
}

/**
 * @api-id API-CAT-39
 */
export async function deleteQuestion(actor: Actor, questionId: string): Promise<void> {
  can(actor, "catalog", "edit");

  // M-3: Guard — questions on published/archived versions are immutable.
  // Resolves via: question → group → automation_version.
  const version = await repo.findVersionByQuestion(questionId);
  if (version && version.status !== "draft") {
    throw catalogError("CATALOG_VERSION_PUBLISHED_IMMUTABLE");
  }

  await repo.deleteQuestion(questionId);
  await writeAudit(actor, "catalog.form_questions.updated", "form_questions", questionId, {});
}

/**
 * Paso 5 — PDF de prueba en memoria (RF-ADM-034).
 *
 * Downloads the PDF, maps sample_answers (question_id → value) to pdf_field_name
 * using the same mapping as production, fills via fillAcroForm (mupdf), and
 * returns the bytes WITHOUT persisting them. Returns both the PDF bytes and a
 * list of required questions that had no sample answer (non-blocking).
 *
 * @api-id API-CAT-42
 */
export async function generateTestPdf(
  actor: Actor,
  input: { version_id: string; sample_answers: Record<string, unknown> },
): Promise<{ pdfBytes: Uint8Array; gaps: Array<{ question_id: string; pdf_field_name: string }> }> {
  can(actor, "catalog", "edit");

  const tree = await repo.getVersionTree(input.version_id);
  if (!tree) throw catalogError("CATALOG_VERSION_NOT_FOUND");

  // Download PDF from catalog-assets
  const supabase = createServiceClient();
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("catalog-assets")
    .download(tree.version.source_pdf_path);

  if (dlErr || !fileData) {
    throw catalogError("CATALOG_PDF_UNREADABLE", `Cannot download PDF: ${dlErr?.message ?? "no data"}`);
  }

  const bytes = new Uint8Array(await fileData.arrayBuffer());

  // Map question answers to PDF field names (same mapping as production)
  // sample_answers: { [question_id]: value }
  const valuesByPdfName: Record<string, string | boolean> = {};
  const gaps: Array<{ question_id: string; pdf_field_name: string }> = [];

  for (const q of tree.questions) {
    // SELECT mapped to a checkbox group: each option carries its own pdf_field_name
    // (Sex, Marital, a Yes/No pair); the chosen option's box is ticked. Same logic
    // as production generateFilledPdf.
    const optionFields =
      q.field_type === "select" && Array.isArray(q.options)
        ? (q.options as Array<{ value: string; pdf_field_name?: string | null }>)
        : null;
    const hasOptionFields = !!optionFields && optionFields.some((o) => o?.pdf_field_name);
    const fieldName = q.pdf_field_name;
    if (!fieldName && !hasOptionFields) continue; // intermediate field without AcroForm mapping

    // Conditional/dynamic: skip a field hidden by its condition (left blank, like
    // production); a condition can also flip whether it counts as a required gap.
    const condState = deriveFieldState(parseConditionOrNull(q.condition), q.is_required, input.sample_answers);
    if (!condState.visible) continue;

    const answerId = q.id;
    if (answerId in input.sample_answers) {
      const val = input.sample_answers[answerId];
      if (hasOptionFields) {
        const chosen = optionFields.find((o) => String(o.value) === String(val));
        if (chosen?.pdf_field_name) valuesByPdfName[chosen.pdf_field_name] = true;
      } else {
        valuesByPdfName[fieldName!] = typeof val === "boolean" ? val : String(val ?? "");
      }
    } else if (condState.required) {
      // Required field with no sample answer — record gap (non-blocking per RF-ADM-034 E1)
      gaps.push({ question_id: q.id, pdf_field_name: fieldName ?? q.id });
    }
  }

  // USCIS acceptance rule (8 CFR 1208.3(c)(3)): a blank field makes the form
  // incomplete, but "N/A" is an allowed response — backfill blank applicant text
  // fields on this form's pages so the test PDF reflects an acceptable filing.
  const detectedForNa = (tree.version.detected_fields ?? []) as Array<{
    pdf_field_name: string;
    field_type: string;
    page: number;
  }>;
  // Seed the page-scope with both top-level and per-option pdf field names (a page
  // of only checkbox-group SELECTs would otherwise be undercounted).
  const naFormFields = [
    ...tree.questions.map((q) => q.pdf_field_name).filter((n): n is string => !!n),
    ...tree.questions.flatMap((q) =>
      Array.isArray(q.options)
        ? (q.options as Array<{ pdf_field_name?: string | null }>)
            .map((o) => o?.pdf_field_name)
            .filter((n): n is string => !!n)
        : [],
    ),
  ];
  backfillNaTextFields(detectedForNa, valuesByPdfName, naFormFields);

  // Fill AcroForm using mupdf (same engine as production)
  const pdfBytes = await fillAcroForm(bytes, {}, valuesByPdfName);

  return { pdfBytes, gaps };
}

/**
 * Publishes an automation version.
 *
 * @api-id API-CAT-43
 */
export async function publishVersion(
  actor: Actor,
  input: { version_id: string; acknowledge_unmapped?: boolean },
): Promise<PublicationCheck> {
  can(actor, "catalog", "edit");

  const tree = await repo.getVersionTree(input.version_id);
  if (!tree) throw catalogError("CATALOG_VERSION_NOT_FOUND");

  // Build validation context
  const formDef = await repo.findFormDefinition(tree.version.form_definition_id);
  if (!formDef) throw catalogError("CATALOG_FORM_NOT_FOUND");

  // We need service-level slug index. Phase comes from form_definition.
  const slugIndex = await repo.getServiceSlugIndex(formDef.service_phase_id);

  const ctx = {
    documentSlugsWithSchema: slugIndex.documentsWithSchema,
    aiLetterSlugs: slugIndex.aiLetterSlugs,
    profileFields: Array.from(PROFILE_SOURCE_FIELDS),
  };

  const check = validateVersionPublication({
    version: tree.version as unknown as AutomationVersion,
    groups: tree.groups as unknown as QuestionGroup[],
    questions: tree.questions as unknown as Question[],
    ctx,
  });

  if (!check.ok) return check;

  const unmapped = check.issues.filter((i) => i.code === "CATALOG_PDF_FIELD_UNMAPPED");
  if (unmapped.length > 0 && !input.acknowledge_unmapped) {
    return { ok: false, issues: unmapped };
  }

  await repo.publishVersionTx(input.version_id);
  await writeAudit(
    actor,
    "catalog.form_version.published",
    "form_automation_versions",
    input.version_id,
    {},
  );

  // C-2: Load the phase directly by id to get its service_id.
  // Using listPhases(service_phase_id) was wrong — it expects a serviceId, not a phaseId —
  // causing service_id to be "" in the event. findPhaseById gives the correct row.
  const phase = await repo.findPhaseById(formDef.service_phase_id);
  if (!phase) {
    throw catalogError(
      "CATALOG_PHASE_NOT_FOUND",
      `Phase ${formDef.service_phase_id} not found when publishing version.`,
    );
  }

  appEvents.emit({
    type: "form_version.published",
    payload: {
      org_id: actor.orgId,
      service_id: phase.service_id,
      service_phase_id: formDef.service_phase_id,
      form_definition_id: formDef.id,
      form_slug: formDef.slug,
      automation_version_id: input.version_id,
      version: tree.version.version,
      previous_version_id: null, // simplified for F1 — full tracking in F4
      question_count: tree.questions.length,
      published_by: actor.userId,
      occurred_at: new Date().toISOString(),
    },
    occurredAt: new Date(),
  });

  return check;
}

/**
 * @api-id API-CAT-44
 */
export async function unpublishVersion(actor: Actor, versionId: string): Promise<void> {
  can(actor, "catalog", "edit");
  const version = await repo.findVersionById(versionId);
  if (!version) throw catalogError("CATALOG_VERSION_NOT_FOUND");
  if (version.status !== "published") throw catalogError("CATALOG_VERSION_NOT_DRAFT");

  await repo.updateVersion(versionId, { status: "archived" });
  await writeAudit(
    actor,
    "catalog.form_version.unpublished",
    "form_automation_versions",
    versionId,
    {},
  );
}

/**
 * @api-id API-CAT-45
 */
export async function setFormActive(
  actor: Actor,
  formId: string,
  active: boolean,
): Promise<void> {
  can(actor, "catalog", "edit");

  const form = await repo.findFormDefinition(formId);
  if (!form) throw catalogError("CATALOG_FORM_NOT_FOUND");

  if (active && form.kind === "ai_letter") {
    const config = await repo.findGenerationConfig(formId);
    if (!config) throw catalogError("CATALOG_GENERATION_NOT_CONFIGURED");
  }
  if (active && form.kind === "pdf_automation") {
    const published = await repo.getPublishedVersion(formId);
    if (!published) throw catalogError("CATALOG_NO_PUBLISHED_VERSION");
  }

  await repo.updateFormDefinition(formId, { is_active: active });
  await writeAudit(actor, "catalog.form.updated", "form_definitions", formId, {
    after: { is_active: active },
  });
}

// ---------------------------------------------------------------------------
// §3.6 ai_letter lifecycle
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-46
 */
export async function updateGenerationConfig(
  actor: Actor,
  input: {
    form_definition_id: string;
    system_prompt: string;
    input_document_slugs?: string[];
    input_form_slugs?: string[];
    dataset_id?: string | null;
    model?: string;
    max_output_tokens?: number;
    output_format?: string;
    output_language?: string;
    web_search_enabled?: boolean;
    web_search_max_uses?: number;
    research_instructions?: string | null;
    research_model?: string | null;
    sections?: GenerationSection[];
    rules_enabled?: boolean;
    rules_text?: string | null;
    assembly?: GenerationAssembly | null;
  },
): Promise<GenerationConfig> {
  can(actor, "catalog", "edit");

  const form = await repo.findFormDefinition(input.form_definition_id);
  if (!form) throw catalogError("CATALOG_FORM_NOT_FOUND");
  if (form.kind !== "ai_letter") throw catalogError("CATALOG_FORM_KIND_MISMATCH");

  const slugIndex = await repo.getServiceSlugIndex(form.service_phase_id);

  for (const s of input.input_document_slugs ?? []) {
    if (!slugIndex.documents.includes(s)) {
      throw catalogError("CATALOG_SOURCE_REF_INVALID", `Document slug "${s}" not found in service.`);
    }
  }
  for (const s of input.input_form_slugs ?? []) {
    if (!slugIndex.forms.includes(s)) {
      throw catalogError("CATALOG_SOURCE_REF_INVALID", `Form slug "${s}" not found in service.`);
    }
  }

  if (input.model && !(GENERATION_MODELS as readonly string[]).includes(input.model)) {
    throw catalogError("CATALOG_MODEL_NOT_ALLOWED");
  }

  if (input.dataset_id) {
    const ds = await repo.findDataset(input.dataset_id);
    if (!ds) throw catalogError("CATALOG_DATASET_NOT_FOUND");
    if (!ds.is_active) throw catalogError("CATALOG_DATASET_INACTIVE");
  }

  if (input.research_model && !(GENERATION_MODELS as readonly string[]).includes(input.research_model)) {
    throw catalogError("CATALOG_MODEL_NOT_ALLOWED");
  }

  // Validate/normalize sections (generic long-form config — generalizes v1's 17
  // asylum sections). Empty = single-call generation.
  const sections = (input.sections ?? []).map((s) => GenerationSectionSchema.parse(s));
  const assembly = input.assembly ? GenerationAssemblySchema.parse(input.assembly) : null;

  const config = await repo.upsertGenerationConfig({
    form_definition_id: input.form_definition_id,
    system_prompt: input.system_prompt,
    input_document_slugs: input.input_document_slugs ?? [],
    input_form_slugs: input.input_form_slugs ?? [],
    dataset_id: input.dataset_id ?? null,
    model: input.model ?? "claude-fable-5",
    max_output_tokens: input.max_output_tokens ?? 32000,
    output_format: input.output_format ?? "pdf",
    output_language: input.output_language ?? "en",
    web_search_enabled: input.web_search_enabled ?? false,
    web_search_max_uses: input.web_search_max_uses ?? 5,
    research_instructions: input.research_instructions ?? null,
    research_model: input.research_model ?? null,
    sections: sections as unknown as import("@/shared/database.types").Json,
    rules_enabled: input.rules_enabled ?? true,
    rules_text: input.rules_text ?? null,
    assembly: (assembly ?? null) as unknown as import("@/shared/database.types").Json,
    updated_by: actor.userId,
  });

  // Audit with redacted prompt (hash only, not the full text)
  await writeAudit(actor, "catalog.generation_config.updated", "ai_generation_configs", config.form_definition_id, {
    after: { ...config, system_prompt: `[redacted:${config.system_prompt.length}chars]` },
  });

  return config as unknown as GenerationConfig;
}

/**
 * Prueba de generación (RF-ADM-037): corrida real con is_test=true.
 *
 * Verifies the form has an ai_generation_config, then delegates entirely to
 * ai-engine.startGeneration({ ..., isTest: true }). The same pipeline as
 * production — no parallel code path. The admin can iterate: adjust config,
 * then call testGeneration again (regenerate creates a new version).
 *
 * @api-id API-CAT-47
 */
export async function testGeneration(
  actor: Actor,
  input: { form_definition_id: string; case_id: string; party_id?: string },
): Promise<{ run_id: string }> {
  can(actor, "catalog", "edit");

  // M-2: Verify the form belongs to the actor's org before running a generation.
  // form_definition → service_phase → service → org_id.
  const formDef = await repo.findFormDefinition(input.form_definition_id);
  if (!formDef) throw catalogError("CATALOG_FORM_NOT_FOUND");
  const phase = await repo.findPhaseById(formDef.service_phase_id);
  if (!phase) throw catalogError("CATALOG_FORM_NOT_FOUND");
  const service = await repo.findServiceById(phase.service_id);
  if (!service || service.org_id !== actor.orgId) throw catalogError("CATALOG_FORM_NOT_FOUND");

  // Verify form exists and has a generation config (RF-ADM-037 pre-check)
  const config = await repo.findGenerationConfig(input.form_definition_id);
  if (!config) throw catalogError("CATALOG_GENERATION_NOT_CONFIGURED");

  // Delegate to ai-engine (same pipeline as production, is_test=true)
  const { startGeneration } = await import("@/backend/modules/ai-engine");
  const result = await startGeneration(actor, {
    caseId: input.case_id,
    formDefinitionId: input.form_definition_id,
    partyId: input.party_id ?? null,
    isTest: true,
  });

  return { run_id: result.run.id };
}

// ---------------------------------------------------------------------------
// §3.7 Datasets — RF-ADM-038/039/040
// ---------------------------------------------------------------------------

/**
 * @api-id API-CAT-48
 */
export async function createDataset(
  actor: Actor,
  input: { name: string; purpose?: string; source_kind?: string },
): Promise<Dataset> {
  can(actor, "datasets", "edit");

  const ds = await repo.insertDataset({
    org_id: actor.orgId,
    name: input.name,
    purpose: input.purpose ?? null,
    source_kind: (input.source_kind ?? "manual") as string,
    created_by: actor.userId,
    is_active: true,
  });

  await writeAudit(actor, "catalog.dataset.created", "ai_datasets", ds.id, { after: ds });
  return ds as unknown as Dataset;
}

/**
 * @api-id API-CAT-49
 */
export async function updateDataset(
  actor: Actor,
  id: string,
  patch: { name?: string; purpose?: string; source_kind?: string; is_active?: boolean },
): Promise<Dataset> {
  can(actor, "datasets", "edit");

  // M-1: Verify org ownership before mutating (service client bypasses RLS).
  const existing = await repo.findDataset(id);
  if (!existing || existing.org_id !== actor.orgId) throw catalogError("CATALOG_DATASET_NOT_FOUND");

  const ds = await repo.updateDataset(
    id,
    patch as Parameters<typeof repo.updateDataset>[1],
  );
  await writeAudit(actor, "catalog.dataset.updated", "ai_datasets", id, { after: ds });
  return ds as unknown as Dataset;
}

/**
 * @api-id API-CAT-50
 */
export async function createDatasetItem(
  actor: Actor,
  input: {
    dataset_id: string;
    title: string;
    content?: string | null;
    file_path?: string | null;
    jurisdiction?: string | null;
    outcome?: string | null;
    tags?: string[];
  },
): Promise<DatasetItem> {
  can(actor, "datasets", "edit");

  if (!input.content && !input.file_path) {
    throw catalogError("CATALOG_DATASET_ITEM_EMPTY");
  }

  // H-2: Enforce path-prefix isolation for uploaded files.
  if (input.file_path) {
    if (!input.file_path.startsWith(`datasets/${input.dataset_id}/`)) {
      throw catalogError("CATALOG_FILE_PATH_INVALID", "file_path must be scoped to the dataset.");
    }
    const { validateUploadedObject } = await import("@/backend/platform/storage");
    const storageCheck = await validateUploadedObject("catalog-assets", input.file_path, "catalog-assets");
    if (!storageCheck.ok) {
      throw catalogError("CATALOG_PDF_UNREADABLE", storageCheck.reason ?? "Dataset file storage validation failed.");
    }
  }

  // OCR: a file-only item (e.g. a public won-case PDF) is transcribed to text so
  // it becomes injectable reference material. Best-effort — kept without content
  // if extraction fails (then excluded from injection until re-processed).
  let resolvedContent = input.content ?? null;
  if (!resolvedContent && input.file_path) {
    const { extractRawTextFromStorage } = await import("@/backend/modules/ai-engine");
    resolvedContent = await extractRawTextFromStorage({
      bucket: "catalog-assets",
      path: input.file_path,
    });
  }

  // Count tokens for the item text (RF-ADM-039 §3 / DOC-74 §4.2)
  // Uses claude-sonnet-4-6 tokenizer as a proxy for claude-fable-5
  // (same Anthropic tokenizer family). NULL → excluded from dataset injection.
  let token_count: number | null = null;
  const textToCount = resolvedContent;
  if (textToCount !== null) {
    try {
      const client = getAnthropicClient();
      const countResponse = await client.messages.countTokens({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: textToCount }],
      });
      token_count = countResponse.input_tokens;
    } catch {
      // Non-fatal — item saved with NULL token_count, excluded from injection
      logger.warn({ dataset_id: input.dataset_id }, "catalog: token count failed — item will be excluded from injection");
    }
  }

  const item = await repo.insertDatasetItem({
    dataset_id: input.dataset_id,
    title: input.title,
    content: resolvedContent,
    file_path: input.file_path ?? null,
    jurisdiction: input.jurisdiction ?? null,
    outcome: input.outcome ?? null,
    tags: input.tags ?? [],
    added_by: actor.userId,
    token_count,
  });

  await writeAudit(actor, "catalog.dataset_item.created", "ai_dataset_items", item.id, {
    after: { ...item, content: item.content ? "[redacted]" : null },
  });
  return item as unknown as DatasetItem;
}

/**
 * Updates a dataset item, recalculating token_count if content/file_path changed.
 *
 * @api-id API-CAT-51
 */
export async function updateDatasetItem(
  actor: Actor,
  itemId: string,
  patch: {
    title?: string;
    content?: string | null;
    file_path?: string | null;
    jurisdiction?: string | null;
    outcome?: string | null;
    tags?: string[];
  },
): Promise<DatasetItem> {
  can(actor, "datasets", "edit");

  // M-1: Verify item → dataset → org ownership (service client bypasses RLS).
  const existingItem = await repo.findDatasetItem(itemId);
  if (!existingItem) throw catalogError("CATALOG_DATASET_NOT_FOUND");
  const ownerDs = await repo.findDataset(existingItem.dataset_id);
  if (!ownerDs || ownerDs.org_id !== actor.orgId) throw catalogError("CATALOG_DATASET_NOT_FOUND");

  // H-2: Enforce path-prefix isolation when replacing the file reference.
  if (patch.file_path) {
    if (!patch.file_path.startsWith(`datasets/${existingItem.dataset_id}/`)) {
      throw catalogError("CATALOG_FILE_PATH_INVALID", "file_path must be scoped to the dataset.");
    }
    const { validateUploadedObject } = await import("@/backend/platform/storage");
    const storageCheck = await validateUploadedObject("catalog-assets", patch.file_path, "catalog-assets");
    if (!storageCheck.ok) {
      throw catalogError("CATALOG_PDF_UNREADABLE", storageCheck.reason ?? "Dataset file storage validation failed.");
    }
  }

  const contentChanged = "content" in patch || "file_path" in patch;
  let token_count: number | null | undefined = undefined; // undefined = don't update

  if (contentChanged) {
    const textToCount = patch.content ?? null;
    if (textToCount !== null) {
      try {
        const client = getAnthropicClient();
        const response = await client.messages.countTokens({
          model: "claude-sonnet-4-6",
          messages: [{ role: "user", content: textToCount }],
        });
        token_count = response.input_tokens;
      } catch {
        // Non-parseable / provider unavailable → NULL (excluded from injection per DOC-74 §4.2)
        token_count = null;
        logger.warn({ itemId }, "catalog: token count failed on updateDatasetItem — item will be excluded from injection");
      }
    } else {
      token_count = null; // file_path only (no in-memory text) → NULL until file parsed
    }
  }

  const updatePayload: Record<string, unknown> = { ...patch };
  if (token_count !== undefined) {
    updatePayload.token_count = token_count;
  }

  const item = await repo.updateDatasetItem(
    itemId,
    updatePayload as Parameters<typeof repo.updateDatasetItem>[1],
  );

  await writeAudit(actor, "catalog.dataset_item.updated", "ai_dataset_items", itemId, {
    after: { ...item, content: item.content ? "[redacted]" : null },
  });
  return item as unknown as DatasetItem;
}

/**
 * Deletes a dataset. FK restrict prevents deletion if referenced by ai_generation_configs.
 *
 * @api-id API-CAT-53
 */
export async function deleteDataset(actor: Actor, datasetId: string): Promise<void> {
  can(actor, "datasets", "edit");

  try {
    await repo.deleteDataset(datasetId);
  } catch (e) {
    if (isFkViolation(e)) throw catalogError("CATALOG_DATASET_IN_USE");
    throw e;
  }

  await writeAudit(actor, "catalog.dataset.deleted", "ai_datasets", datasetId, {});
}

/**
 * @api-id API-CAT-52
 */
export async function deleteDatasetItem(actor: Actor, itemId: string): Promise<void> {
  can(actor, "datasets", "edit");

  try {
    await repo.deleteDatasetItem(itemId);
  } catch (e) {
    if (isFkViolation(e)) throw catalogError("CATALOG_DATASET_IN_USE");
    throw e;
  }

  await writeAudit(actor, "catalog.dataset_item.deleted", "ai_dataset_items", itemId, {});
}

// ---------------------------------------------------------------------------
// §6 Runtime resolution — getCaseRequirements
// ---------------------------------------------------------------------------

/**
 * Resolves the catalog requirements for a case's current phase.
 *
 * Called by: cases module, server components.
 * Catalog does NOT read from cases tables — the caller passes parties + overrides.
 *
 * DOC-40 §6.1.
 */
export async function getCaseRequirements(input: {
  service_id: string;
  phase_id: string;
  parties: Array<{ id: string; party_role: string }>;
  requirement_overrides: RequirementOverrideInput[];
  /**
   * Staff view: keep `is_hidden` requirements flagged (so they can be restored)
   * instead of dropping them. Default false → client view (hidden removed).
   */
  include_hidden?: boolean;
}): Promise<{
  phase: Pick<ServicePhase, "id" | "slug" | "label_i18n" | "client_explainer_i18n" | "position">;
  milestones: Milestone[];
  appointment_policy: PolicyRow | null;
  documents: ExpandedRequirement[];
  forms: ResolvedForm[];
}> {
  const catalog = await repo.getPhaseCatalog(input.phase_id);
  if (!catalog) throw catalogError("CATALOG_PHASE_NOT_FOUND");

  const expanded = expandPerPartyRequirements(
    catalog.docs as unknown as import("./domain").RequiredDocumentType[],
    input.parties,
  );
  const documents = applyRequirementOverrides(expanded, input.requirement_overrides, {
    includeHidden: input.include_hidden ?? false,
  });

  const forms = await resolveForms(catalog.forms);

  return {
    phase: catalog.phase as unknown as Pick<ServicePhase, "id" | "slug" | "label_i18n" | "client_explainer_i18n" | "position">,
    milestones: catalog.milestones as unknown as Milestone[],
    appointment_policy: catalog.policy,
    documents,
    forms,
  };
}

async function resolveForms(formDefs: FormDefinitionRow[]): Promise<ResolvedForm[]> {
  return Promise.all(
    formDefs.map(async (f) => {
      let automation: ResolvedForm["automation"] = null;
      let generation: ResolvedForm["generation"] = null;

      if (f.kind === "pdf_automation") {
        const published = await repo.getPublishedVersion(f.id);
        if (published) {
          automation = { published_version_id: published.id, version: published.version };
        }
      }

      if (f.kind === "ai_letter") {
        const config = await repo.findGenerationConfig(f.id);
        generation = {
          configured: config !== null,
          output_format: config?.output_format ?? "pdf",
          output_language: config?.output_language ?? "en",
          has_dataset: config?.dataset_id !== null && config?.dataset_id !== undefined,
        };
      }

      return {
        form_definition_id: f.id,
        slug: f.slug,
        kind: f.kind as "ai_letter" | "pdf_automation",
        label_i18n: f.label_i18n as import("./domain").I18nTextDraft,
        description_i18n: f.description_i18n as import("./domain").I18nTextDraft | null,
        filled_by: f.filled_by as "client" | "staff" | "both",
        position: f.position,
        automation,
        generation,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Public catalog reads
// ---------------------------------------------------------------------------

export async function getPublicCatalog(orgId: string) {
  return repo.getPublicCatalogFromDb(orgId);
}

export async function getServiceDetailBySlug(orgId: string, slug: string) {
  return repo.getServiceDetailBySlugFromDb(orgId, slug);
}

export async function listContractableServices(orgId: string) {
  return repo.listContractableServicesFromDb(orgId);
}

/**
 * Lists a contractable service's plans for the "Nuevo caso" contract flow. No
 * `catalog` gate (unlike getServiceEditorTree, which requires catalog.view): a
 * SALES rep must be able to win a lead into a contract, and the plan pricing is
 * non-sensitive reference data. serviceId comes from the org's own
 * listContractableServices, so it is already org-scoped.
 */
export async function listContractableServicePlans(serviceId: string) {
  return repo.listPlans(serviceId);
}

/**
 * Returns the FIRST phase of a service for case activation (DOC-41 §3.4):
 * the explicit entry_phase_id if set, otherwise the lowest-position phase.
 * Internal cross-module read (no actor): consumed by cases.onDownpaymentConfirmed
 * when a case transitions payment_pending → active.
 *
 * @api-id API-CAT-31
 */
export async function getCatalogFirstPhase(
  serviceId: string,
): Promise<{ id: string; position: number } | null> {
  const service = await repo.findServiceById(serviceId);
  const phases = await repo.listPhases(serviceId); // ordered by position asc
  if (phases.length === 0) return null;
  const entry = service?.entry_phase_id
    ? phases.find((p) => p.id === service.entry_phase_id)
    : null;
  const chosen = entry ?? phases[0];
  return { id: chosen.id, position: chosen.position };
}

export async function getPublishedAutomationVersion(formDefinitionId: string) {
  return repo.getPublishedVersion(formDefinitionId);
}

export async function getAutomationVersionById(versionId: string) {
  return repo.getAutomationVersionById(versionId);
}

/**
 * Lists question groups for a given automation version.
 * Exported for cases/form-runtime use (form wizard + PDF fill).
 */
export async function listQuestionGroups(versionId: string) {
  return repo.listQuestionGroups(versionId);
}

/**
 * Lists questions for a given question group.
 * Exported for cases/form-runtime use (form wizard + PDF fill).
 */
export async function listQuestions(groupId: string) {
  return repo.listQuestions(groupId);
}

/**
 * Lists the active form definitions for a phase.
 * Exported for cases/form-runtime use (client forms list — DOC-51 §21).
 */
export async function listFormDefinitions(phaseId: string) {
  return repo.listFormDefinitions(phaseId);
}

export async function listDatasets(actor: Actor) {
  can(actor, "datasets", "view");
  return repo.listDatasets(actor.orgId);
}

export { isServiceContractable };

// ---------------------------------------------------------------------------
// Admin catalog reads (DOC-53 §4.1 / §4.2) — page-initial RSC reads.
// The public catalog reads above only return active+public services; the admin
// panel needs the full editor list (drafts, hidden, archived) and the full
// editor tree of a single service for the wizard/ficha.
// ---------------------------------------------------------------------------

export interface AdminServiceSummary {
  id: string;
  slug: string;
  category: string;
  label_i18n: import("./domain").I18nTextDraft;
  icon: string;
  color: string;
  is_active: boolean;
  is_public: boolean;
  archived_at: string | null;
  entry_parent_service_id: string | null;
  entry_phase_id: string | null;
  position: number;
  plan_kinds: string[];
  phase_count: number;
}

/**
 * Lists every service of the org for the admin catalog grid, including drafts,
 * hidden and (optionally) archived services, with plan + phase counts.
 *
 * @api-id API-CAT-01 (admin list — page-initial RSC read, DOC-53 §4.4)
 */
export async function listServicesAdmin(
  actor: Actor,
  opts: { include_archived?: boolean } = {},
): Promise<AdminServiceSummary[]> {
  can(actor, "catalog", "view");
  const services = await repo.listServicesForEditor(actor.orgId, opts);

  return Promise.all(
    services.map(async (s) => {
      const [plans, phases] = await Promise.all([
        repo.listPlans(s.id),
        repo.listPhases(s.id),
      ]);
      return {
        id: s.id,
        slug: s.slug,
        category: s.category,
        label_i18n: (s.label_i18n ?? {}) as import("./domain").I18nTextDraft,
        icon: s.icon ?? "doc",
        color: s.color ?? "accent",
        is_active: s.is_active,
        is_public: s.is_public,
        archived_at: s.archived_at,
        entry_parent_service_id: s.entry_parent_service_id,
        entry_phase_id: s.entry_phase_id,
        position: s.position ?? 0,
        plan_kinds: plans.filter((p) => p.is_active).map((p) => p.kind),
        phase_count: phases.length,
      };
    }),
  );
}

export interface ServiceEditorPhase {
  id: string;
  slug: string;
  label_i18n: import("./domain").I18nTextDraft;
  description_i18n: import("./domain").I18nTextDraft | null;
  client_explainer_i18n: import("./domain").I18nTextDraft | null;
  position: number;
  milestones: Milestone[];
  appointment_policy: PolicyRow | null;
  /** Per-cita cronograma rows (each with own duration + week_offset). Supersede the policy when present. */
  appointment_schedule: AppointmentScheduleRow[];
  /** Trailing "trámite" weeks this phase contributes to the client cronograma. */
  processing_weeks: number;
  documents: RequiredDocRow[];
  forms: (FormDefinitionRow & { published_version: number | null })[];
}

export interface ServiceEditorTree {
  service: Service;
  plans: ServicePlan[];
  /** The additional case parties this service declares (besides the applicant). */
  partyRoles: ServicePartyRole[];
  phases: ServiceEditorPhase[];
}

/**
 * Returns the full editor tree of a single service for the wizard / ficha:
 * service + plans + ordered phases, each with its milestones, appointment
 * policy, required documents and form definitions. Read-only.
 *
 * @api-id API-CAT-02 (admin service detail — page-initial RSC read, DOC-53 §4.2)
 */
export async function getServiceEditorTree(
  actor: Actor,
  serviceId: string,
): Promise<ServiceEditorTree | null> {
  can(actor, "catalog", "view");

  const service = await repo.findServiceById(serviceId);
  if (!service) return null;

  const [plans, partyRoleRows, phaseRows] = await Promise.all([
    repo.listPlans(serviceId),
    repo.listServicePartyRoles(serviceId),
    repo.listPhases(serviceId),
  ]);

  const phases: ServiceEditorPhase[] = await Promise.all(
    phaseRows.map(async (ph) => {
      const [milestones, policy, schedule, documents, forms] = await Promise.all([
        repo.listMilestones(ph.id),
        repo.findPhasePolicy(ph.id),
        repo.listAppointmentSchedule(ph.id),
        repo.listRequiredDocs(ph.id),
        repo.listFormDefinitions(ph.id),
      ]);
      // Enrich pdf_automation forms with their published version number (if any)
      // so the wizard can show "v3" vs "Borrador" without a second round-trip.
      const formsWithVersion = await Promise.all(
        forms.map(async (f) => {
          const published =
            f.kind === "pdf_automation" ? await repo.getPublishedVersion(f.id) : null;
          return { ...f, published_version: published?.version ?? null };
        }),
      );
      return {
        id: ph.id,
        slug: ph.slug,
        label_i18n: (ph.label_i18n ?? {}) as import("./domain").I18nTextDraft,
        description_i18n: (ph.description_i18n ?? null) as import("./domain").I18nTextDraft | null,
        client_explainer_i18n: (ph.client_explainer_i18n ?? null) as import("./domain").I18nTextDraft | null,
        position: ph.position,
        milestones: milestones as unknown as Milestone[],
        appointment_policy: policy,
        appointment_schedule: schedule,
        processing_weeks: ph.processing_weeks ?? 0,
        documents: documents,
        forms: formsWithVersion,
      };
    }),
  );

  return {
    service: service as unknown as Service,
    plans: plans as unknown as ServicePlan[],
    partyRoles: partyRoleRows.map(mapPartyRoleRow),
    phases,
  };
}

// ---------------------------------------------------------------------------
// Service party roles — admin config (DOC-41) + runtime read for "Nuevo caso"
// ---------------------------------------------------------------------------

function mapPartyRoleRow(r: repo.ServicePartyRoleRow): ServicePartyRole {
  return {
    id: r.id,
    service_id: r.service_id,
    role_key: r.role_key as ServicePartyRole["role_key"],
    label_i18n: (r.label_i18n ?? {}) as ServicePartyRole["label_i18n"],
    cardinality: r.cardinality as ServicePartyRole["cardinality"],
    is_required: r.is_required,
    position: r.position,
  };
}

/**
 * Lists the additional case parties a service declares — for the "Nuevo caso"
 * modal role picker. No catalog gate: sales/admin building a case need it, and
 * it is non-sensitive config. Returns [] for a service with none.
 *
 * @api-id API-CAT-30
 */
export async function listServicePartyRoles(serviceId: string): Promise<ServicePartyRole[]> {
  const rows = await repo.listServicePartyRoles(serviceId);
  return rows.map(mapPartyRoleRow);
}

/**
 * Creates a service party-role definition (admin catalog editor).
 * @api-id API-CAT-31
 */
export async function createServicePartyRole(
  actor: Actor,
  input: UpsertServicePartyRoleDto,
): Promise<ServicePartyRole> {
  can(actor, "catalog", "edit");
  const dto = UpsertServicePartyRoleDtoSchema.parse(input);
  // Org ownership: the service client bypasses RLS, so verify in code that the
  // target service belongs to the actor's org (defense in depth).
  await assertServiceInOrg(actor, dto.service_id);
  const row = await repo.insertServicePartyRole({
    service_id: dto.service_id,
    role_key: dto.role_key,
    label_i18n: dto.label_i18n as import("@/shared/database.types").Json,
    cardinality: dto.cardinality,
    is_required: dto.is_required,
    position: dto.position,
  });
  await writeAudit(actor, "catalog.service_party_role.created", "service_party_roles", row.id, {
    after: row,
  });
  return mapPartyRoleRow(row);
}

/**
 * Updates a service party-role definition (label, cardinality, required, position).
 * @api-id API-CAT-32
 */
export async function updateServicePartyRole(
  actor: Actor,
  id: string,
  patch: Partial<Omit<UpsertServicePartyRoleDto, "service_id" | "role_key">>,
): Promise<ServicePartyRole> {
  can(actor, "catalog", "edit");
  // Org ownership: load the row and assert its service belongs to the actor's org.
  const existing = await repo.findServicePartyRoleById(id);
  if (!existing) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  await assertServiceInOrg(actor, existing.service_id);
  const row = await repo.updateServicePartyRole(id, {
    ...(patch.label_i18n !== undefined
      ? { label_i18n: patch.label_i18n as import("@/shared/database.types").Json }
      : {}),
    ...(patch.cardinality !== undefined ? { cardinality: patch.cardinality } : {}),
    ...(patch.is_required !== undefined ? { is_required: patch.is_required } : {}),
    ...(patch.position !== undefined ? { position: patch.position } : {}),
  });
  await writeAudit(actor, "catalog.service_party_role.updated", "service_party_roles", id, {
    after: row,
  });
  return mapPartyRoleRow(row);
}

/**
 * Removes a service party-role definition (config only; existing case_parties
 * are unaffected — they store the role_key string independently).
 * @api-id API-CAT-33
 */
export async function deleteServicePartyRole(actor: Actor, id: string): Promise<void> {
  can(actor, "catalog", "edit");
  const existing = await repo.findServicePartyRoleById(id);
  if (!existing) throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  await assertServiceInOrg(actor, existing.service_id);
  await repo.deleteServicePartyRole(id);
  await writeAudit(actor, "catalog.service_party_role.deleted", "service_party_roles", id, {
    before: { id, service_id: existing.service_id, role_key: existing.role_key },
  });
}

// ---------------------------------------------------------------------------
// Appointment schedule (cronograma) — admin catalog editor
// ---------------------------------------------------------------------------

/**
 * Replaces the per-appointment schedule (cronograma) of a phase plus its
 * trailing "trámite" weeks. Each cita carries its own duration + week_offset;
 * the schedule supersedes phase_appointment_policies when present. The
 * cronograma is informational (client-facing); it does not constrain booking.
 *
 * @api-id API-CAT-34
 */
export async function upsertAppointmentSchedule(
  actor: Actor,
  input: UpsertAppointmentScheduleDto,
): Promise<AppointmentScheduleRow[]> {
  can(actor, "catalog", "edit");
  const dto = UpsertAppointmentScheduleDtoSchema.parse(input);
  // Org ownership: phase → service → org (service client bypasses RLS).
  const phase = await repo.findPhaseById(dto.service_phase_id);
  if (!phase) throw catalogError("CATALOG_PHASE_NOT_FOUND");
  await assertServiceInOrg(actor, phase.service_id);

  await repo.replaceAppointmentSchedule(
    dto.service_phase_id,
    dto.items.map((it, idx) => ({
      service_phase_id: dto.service_phase_id,
      sequence_number: it.sequence_number,
      duration_minutes: it.duration_minutes,
      kind: it.kind,
      week_offset: it.week_offset,
      label_i18n: (it.label_i18n ?? null) as import("@/shared/database.types").Json,
      position: idx,
    })),
  );
  await repo.setPhaseProcessingWeeks(dto.service_phase_id, dto.processing_weeks);

  await writeAudit(
    actor,
    "catalog.appointment_schedule.updated",
    "service_appointment_schedule",
    dto.service_phase_id,
    { after: { count: dto.items.length, processing_weeks: dto.processing_weeks } },
  );

  return repo.listAppointmentSchedule(dto.service_phase_id);
}

export interface ServiceCronogramaCita {
  phaseId: string;
  phaseLabelI18n: import("./domain").I18nTextDraft;
  sequenceNumber: number;
  durationMinutes: number;
  kind: string;
  weekOffset: number;
  labelI18n: import("./domain").I18nTextDraft | null;
}

export interface ServiceCronograma {
  citas: ServiceCronogramaCita[];
  /** Total trailing "trámite" weeks across all phases. */
  processingWeeks: number;
  /** Week of the last cita (0 when there are no citas). */
  lastWeek: number;
  /** lastWeek + processingWeeks — estimated total span in weeks. */
  totalWeeks: number;
}

/**
 * Returns the per-service cronograma — all phases' appointment schedule rows
 * (each cita's duration + week offset) plus their trailing processing weeks,
 * ordered by week then sequence. No gate: runtime client-facing config (like
 * listServicePartyRoles). The case layer anchors it on cases.opened_at to
 * compute concrete dates (cases.getCaseTimeline).
 *
 * @api-id API-CAT-35
 */
export async function getServiceCronograma(serviceId: string): Promise<ServiceCronograma> {
  const phases = await repo.listPhases(serviceId);
  const citas: ServiceCronogramaCita[] = [];
  let processingWeeks = 0;
  for (const ph of phases) {
    processingWeeks += ph.processing_weeks ?? 0;
    const rows = await repo.listAppointmentSchedule(ph.id);
    for (const r of rows) {
      citas.push({
        phaseId: ph.id,
        phaseLabelI18n: (ph.label_i18n ?? {}) as import("./domain").I18nTextDraft,
        sequenceNumber: r.sequence_number,
        durationMinutes: r.duration_minutes,
        kind: r.kind,
        weekOffset: r.week_offset,
        labelI18n: (r.label_i18n ?? null) as import("./domain").I18nTextDraft | null,
      });
    }
  }
  citas.sort((a, b) => a.weekOffset - b.weekOffset || a.sequenceNumber - b.sequenceNumber);
  const lastWeek = citas.reduce((m, c) => Math.max(m, c.weekOffset), 0);
  return { citas, processingWeeks, lastWeek, totalWeeks: lastWeek + processingWeeks };
}

/**
 * Asserts a service belongs to the actor's org. The catalog mutations use the
 * service client (RLS bypass), so this is the authoritative org-isolation check.
 */
async function assertServiceInOrg(actor: Actor, serviceId: string): Promise<void> {
  const svc = await repo.findServiceById(serviceId);
  if (!svc || svc.org_id !== actor.orgId) {
    throw catalogError("CATALOG_SERVICE_NOT_FOUND");
  }
}

// ---------------------------------------------------------------------------
// Form editor reads (DOC-53 §5) — page-initial RSC reads for the editor.
// ---------------------------------------------------------------------------

export interface EditorVersionTree {
  version: AutomationVersion;
  groups: Array<QuestionGroup & { questions: Question[] }>;
}

export interface FormEditorSourceOption {
  /** document slug or ai_letter form slug */
  slug: string;
  /** json_path keys derived from extraction_schema (document_extraction) */
  paths?: string[];
}

export interface FormEditorData {
  form: { id: string; slug: string; kind: string; label_i18n: import("./domain").I18nTextDraft; service_phase_id: string };
  service: { id: string; slug: string; label_i18n: import("./domain").I18nTextDraft };
  versions: AutomationVersion[];
  /** Editor tree of the open version (the draft, or the version requested). */
  openVersion: EditorVersionTree | null;
  /** Source pickers for the origin selector (RF-ADM-033). */
  sources: {
    documents: FormEditorSourceOption[];
    forms: string[];
    profileFields: string[];
  };
  /** ai_letter config (null for pdf_automation or unconfigured). */
  generationConfig: GenerationConfig | null;
}

/**
 * Returns everything the form editor needs for its initial render: the form +
 * its service, every automation version (chips), the editor tree of the open
 * version, the source pickers for the origin selector, and the ai_letter config.
 *
 * @api-id API-CAT-03 (form editor detail — page-initial RSC read, DOC-53 §5)
 */
export async function getFormEditorData(
  actor: Actor,
  formDefinitionId: string,
  openVersionId?: string,
): Promise<FormEditorData | null> {
  can(actor, "catalog", "view");

  const form = await repo.findFormDefinition(formDefinitionId);
  if (!form) return null;

  const phase = await repo.findPhaseById(form.service_phase_id);
  if (!phase) return null;
  const service = await repo.findServiceById(phase.service_id);
  if (!service) return null;

  const versionRows = await repo.listVersions(form.id);
  const versions = versionRows as unknown as AutomationVersion[];

  // The open version: explicit id, else the draft, else the latest.
  const targetId =
    openVersionId ??
    versionRows.find((v) => v.status === "draft")?.id ??
    versionRows[versionRows.length - 1]?.id;

  let openVersion: EditorVersionTree | null = null;
  if (targetId) {
    const tree = await repo.getVersionTree(targetId);
    if (tree) {
      openVersion = {
        version: tree.version as unknown as AutomationVersion,
        groups: tree.groups.map((g) => ({
          ...(g as unknown as QuestionGroup),
          questions: g.questions as unknown as Question[],
        })),
      };
    }
  }

  const slugIndex = await repo.getServiceSlugIndex(service.id);
  const documents: FormEditorSourceOption[] = Object.keys(slugIndex.documentsWithSchema).map(
    (slug) => ({
      slug,
      paths: schemaPaths(slugIndex.documentsWithSchema[slug]),
    }),
  );

  const generationConfig =
    form.kind === "ai_letter"
      ? ((await repo.findGenerationConfig(form.id)) as unknown as GenerationConfig | null)
      : null;

  return {
    form: {
      id: form.id,
      slug: form.slug,
      kind: form.kind,
      label_i18n: (form.label_i18n ?? {}) as import("./domain").I18nTextDraft,
      service_phase_id: form.service_phase_id,
    },
    service: {
      id: service.id,
      slug: service.slug,
      label_i18n: (service.label_i18n ?? {}) as import("./domain").I18nTextDraft,
    },
    versions,
    openVersion,
    sources: {
      documents,
      forms: slugIndex.aiLetterSlugs,
      profileFields: Array.from(PROFILE_SOURCE_FIELDS),
    },
    generationConfig,
  };
}

/** Derives top-level + one-level-nested keys from an extraction_schema object. */
function schemaPaths(schema: object | null): string[] {
  if (!schema || typeof schema !== "object") return [];
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") return [];
  const paths: string[] = [];
  for (const [key, val] of Object.entries(props)) {
    paths.push(key);
    const nested = (val as { properties?: Record<string, unknown> }).properties;
    if (nested && typeof nested === "object") {
      for (const sub of Object.keys(nested)) paths.push(`${key}.${sub}`);
    }
  }
  return paths;
}

/**
 * Builds a signed upload URL for an official PDF (catalog-assets, kind=form_pdf).
 * The path is generated server-side — clients never control it (DOC-27 §5).
 * Lives in module-pub because app/ cannot import platform/storage (boundary R).
 *
 * @api-id API-CAT-07 (assets upload-url, kind: form_pdf)
 */
export async function createFormPdfUploadUrl(
  actor: Actor,
  input: { form_definition_id: string; filename: string },
): Promise<{ signedUrl: string; path: string }> {
  can(actor, "catalog", "edit");
  const { createSignedUploadUrl } = await import("@/backend/platform/storage");
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `forms/${input.form_definition_id}/${Date.now()}-${safe}`;
  return createSignedUploadUrl("catalog-assets", path);
}

/**
 * Returns a short-lived signed download URL for a version's source PDF, so the
 * editor's PDF viewer (pdfjs in the browser) can render it. The bucket is
 * private; this is the boundary-clean way to expose it to the client.
 *
 * @api-id API-CAT-04 (form pdf download — editor viewer)
 */
export async function getVersionPdfUrl(actor: Actor, versionId: string): Promise<string | null> {
  can(actor, "catalog", "view");
  const version = await repo.findVersionById(versionId);
  if (!version) return null;
  const { createSignedDownloadUrl } = await import("@/backend/platform/storage");
  return createSignedDownloadUrl("catalog-assets", version.source_pdf_path);
}

/**
 * Builds a signed upload URL for a dataset file (catalog-assets, kind=dataset_file).
 *
 * @api-id API-CAT-07 (assets upload-url, kind: dataset_file)
 */
export async function createDatasetFileUploadUrl(
  actor: Actor,
  input: { dataset_id: string; filename: string },
): Promise<{ signedUrl: string; path: string }> {
  can(actor, "datasets", "edit");
  const { createSignedUploadUrl } = await import("@/backend/platform/storage");
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `datasets/${input.dataset_id}/${Date.now()}-${safe}`;
  return createSignedUploadUrl("catalog-assets", path);
}

// ---------------------------------------------------------------------------
// Dataset detail reads (DOC-53 §6.2) — page-initial RSC reads.
// ---------------------------------------------------------------------------

export interface DatasetSummary {
  id: string;
  name: string;
  purpose: string | null;
  source_kind: string;
  is_active: boolean;
  item_count: number;
  total_tokens: number;
  used_by: number;
}

/** Lists datasets enriched with item count, total tokens and usage count (RF-ADM-038). */
export async function listDatasetsAdmin(actor: Actor): Promise<DatasetSummary[]> {
  can(actor, "datasets", "view");
  const rows = await repo.listDatasets(actor.orgId);
  return Promise.all(
    rows.map(async (ds) => {
      const [items, usedBy] = await Promise.all([
        repo.listDatasetItems(ds.id),
        repo.countDatasetUsage(ds.id),
      ]);
      return {
        id: ds.id,
        name: ds.name,
        purpose: ds.purpose,
        source_kind: ds.source_kind,
        is_active: ds.is_active,
        item_count: items.length,
        total_tokens: items.reduce((sum, it) => sum + (it.token_count ?? 0), 0),
        used_by: usedBy,
      };
    }),
  );
}

export interface DatasetDetail {
  dataset: DatasetSummary;
  items: DatasetItem[];
  usage: Array<{ formId: string; formSlug: string; phaseId: string; serviceId: string }>;
}

/** Returns a dataset with its items and usage list (RF-ADM-039/040). */
export async function getDatasetDetail(
  actor: Actor,
  datasetId: string,
): Promise<DatasetDetail | null> {
  can(actor, "datasets", "view");
  const ds = await repo.findDataset(datasetId);
  if (!ds || ds.org_id !== actor.orgId) return null;

  const [items, usageRows, usedBy] = await Promise.all([
    repo.listDatasetItems(datasetId),
    repo.listDatasetUsage(datasetId),
    repo.countDatasetUsage(datasetId),
  ]);

  const usage = await Promise.all(
    usageRows.map(async (u) => {
      const phase = u.phaseId ? await repo.findPhaseById(u.phaseId) : null;
      return { ...u, serviceId: phase?.service_id ?? "" };
    }),
  );

  return {
    dataset: {
      id: ds.id,
      name: ds.name,
      purpose: ds.purpose,
      source_kind: ds.source_kind,
      is_active: ds.is_active,
      item_count: items.length,
      total_tokens: items.reduce((sum, it) => sum + (it.token_count ?? 0), 0),
      used_by: usedBy,
    },
    items: items as unknown as DatasetItem[],
    usage,
  };
}
