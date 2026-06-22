/**
 * Catalog module domain — pure types, Zod schemas, and domain rules.
 *
 * No IO, no imports from platform or framework. Only Zod + shared/.
 * All enum values are exactly the CHECK values from the DB migrations.
 *
 * Source of truth: DOC-40 §2 (schemas) + DOC-40 §2.4/§2.5/§2.6 (rules).
 */

import { z } from "zod";
import { GENERATION_MODELS } from "@/shared/constants/ai-models";
import { ConditionSchema } from "@/shared/form-logic/conditions";
import {
  PARTY_ROLE_KEYS,
  PARTY_ROLE_CARDINALITIES,
} from "@/shared/constants/party-roles";

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

/**
 * Bilingual i18n text. Strict (both required) only at publication time —
 * during editing, a draft (partial) version is used.
 */
export const I18nTextSchema = z.object({
  es: z.string().min(1),
  en: z.string().min(1),
});
export const I18nTextDraftSchema = z.object({ es: z.string(), en: z.string() }).partial();
export type I18nText = z.infer<typeof I18nTextSchema>;
export type I18nTextDraft = z.infer<typeof I18nTextDraftSchema>;

// Enum values must match DB CHECK constraints exactly (DOC-30 §0 rule: text+CHECK, no ENUM types)
export const ServiceCategorySchema = z.enum(["migratorio", "empresarial", "familiar"]);
export const PlanKindSchema = z.enum(["self", "with_lawyer"]);
export const AppointmentKindSchema = z.enum(["video", "phone", "presencial"]);
export const FormKindSchema = z.enum(["ai_letter", "pdf_automation"]);
export const FilledBySchema = z.enum(["client", "staff", "both"]);
export const VersionStatusSchema = z.enum(["draft", "published", "archived"]);
export const FieldTypeSchema = z.enum(["text", "number", "date", "checkbox", "select", "textarea"]);
export const QuestionSourceSchema = z.enum([
  "client_answer",
  "document_extraction",
  "generation_output",
  "profile",
]);
export const DatasetSourceKindSchema = z.enum(["eoir", "uscis", "court_public", "manual"]);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const ServiceSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "slug must be kebab-case"),
  category: ServiceCategorySchema,
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable(),
  long_description_i18n: I18nTextDraftSchema.nullable(),
  benefits_i18n: z.array(I18nTextDraftSchema).nullable(),
  icon: z.string().default("doc"),
  color: z.enum(["accent", "gold", "green", "red", "navy", "purple"]).default("accent"),
  is_active: z.boolean().default(false),
  archived_at: z.string().datetime().nullable(),
  is_public: z.boolean().default(true),
  entry_parent_service_id: z.string().uuid().nullable(),
  entry_phase_id: z.string().uuid().nullable(),
  position: z.number().int().default(0),
});
export type Service = z.infer<typeof ServiceSchema>;

export const CreateServiceDtoSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  category: ServiceCategorySchema,
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  icon: z.string().optional(),
  color: z.enum(["accent", "gold", "green", "red", "navy", "purple"]).optional(),
  is_public: z.boolean().optional(),
  entry_parent_service_id: z.string().uuid().nullable().optional(),
  entry_phase_id: z.string().uuid().nullable().optional(),
});
export type CreateServiceDto = z.infer<typeof CreateServiceDtoSchema>;

export const UpdateServiceDtoSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  category: ServiceCategorySchema.optional(),
  label_i18n: I18nTextDraftSchema.optional(),
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  long_description_i18n: I18nTextDraftSchema.nullable().optional(),
  benefits_i18n: z.array(I18nTextDraftSchema).nullable().optional(),
  icon: z.string().optional(),
  color: z.enum(["accent", "gold", "green", "red", "navy", "purple"]).optional(),
  is_public: z.boolean().optional(),
  entry_parent_service_id: z.string().uuid().nullable().optional(),
  entry_phase_id: z.string().uuid().nullable().optional(),
  position: z.number().int().optional(),
});
export type UpdateServiceDto = z.infer<typeof UpdateServiceDtoSchema>;

// ---------------------------------------------------------------------------
// Service Plan
// ---------------------------------------------------------------------------

export const ServicePlanSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  kind: PlanKindSchema,
  price_cents: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  requires_lawyer_validation: z.boolean().default(false),
  default_installments: z.number().int().min(1).default(1),
  default_downpayment_cents: z.number().int().min(0).nullable(),
  is_active: z.boolean().default(true),
});
export type ServicePlan = z.infer<typeof ServicePlanSchema>;

export const UpsertPlanDtoSchema = z.object({
  service_id: z.string().uuid(),
  kind: PlanKindSchema,
  price_cents: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  requires_lawyer_validation: z.boolean().optional(),
  default_installments: z.number().int().min(1).default(1),
  default_downpayment_cents: z.number().int().min(0).nullable().optional(),
  is_active: z.boolean().default(true),
});
export type UpsertPlanDto = z.infer<typeof UpsertPlanDtoSchema>;

// ---------------------------------------------------------------------------
// Service Phase
// ---------------------------------------------------------------------------

export const ServicePhaseSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  slug: z.string(),
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable(),
  client_explainer_i18n: I18nTextDraftSchema.nullable(),
  position: z.number().int(),
});
export type ServicePhase = z.infer<typeof ServicePhaseSchema>;

export const CreatePhaseDtoSchema = z.object({
  service_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  client_explainer_i18n: I18nTextDraftSchema.nullable().optional(),
});
export type CreatePhaseDto = z.infer<typeof CreatePhaseDtoSchema>;

export const UpdatePhaseDtoSchema = z.object({
  label_i18n: I18nTextDraftSchema.optional(),
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  client_explainer_i18n: I18nTextDraftSchema.nullable().optional(),
});
export type UpdatePhaseDto = z.infer<typeof UpdatePhaseDtoSchema>;

// ---------------------------------------------------------------------------
// Milestone
// ---------------------------------------------------------------------------

export const MilestoneSchema = z.object({
  id: z.string().uuid(),
  service_phase_id: z.string().uuid(),
  slug: z.string(),
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable(),
  glossary_i18n: I18nTextDraftSchema.nullable(),
  icon: z.string().default("route"),
  position: z.number().int(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const CreateMilestoneDtoSchema = z.object({
  service_phase_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  glossary_i18n: I18nTextDraftSchema.nullable().optional(),
  icon: z.string().optional(),
});
export type CreateMilestoneDto = z.infer<typeof CreateMilestoneDtoSchema>;

// ---------------------------------------------------------------------------
// Phase Appointment Policy
// ---------------------------------------------------------------------------

export const PhaseAppointmentPolicySchema = z.object({
  service_phase_id: z.string().uuid(),
  appointment_count: z.number().int().min(1).default(1),
  duration_minutes: z.number().int().min(5).default(30),
  kind: AppointmentKindSchema.default("video"),
});
export type PhaseAppointmentPolicy = z.infer<typeof PhaseAppointmentPolicySchema>;

// ---------------------------------------------------------------------------
// Service Appointment Schedule — per-appointment config within a phase (the
// "cronograma"). Each cita carries its OWN duration + week offset (week from
// the case anchor, cases.opened_at). A phase with no appointments can still
// contribute trailing "trámite" weeks via service_phases.processing_weeks.
// When schedule rows exist they supersede PhaseAppointmentPolicy (kept as the
// legacy fallback + source of `kind`). Informational cronograma only — it does
// not constrain the booking engine.
// ---------------------------------------------------------------------------

export const ServiceAppointmentScheduleItemSchema = z.object({
  sequence_number: z.number().int().min(1),
  duration_minutes: z.number().int().min(5),
  kind: AppointmentKindSchema.default("video"),
  week_offset: z.number().int().min(1),
  label_i18n: I18nTextDraftSchema.nullable().optional(),
});
export type ServiceAppointmentScheduleItem = z.infer<typeof ServiceAppointmentScheduleItemSchema>;

export const UpsertAppointmentScheduleDtoSchema = z.object({
  service_phase_id: z.string().uuid(),
  processing_weeks: z.number().int().min(0).default(0),
  items: z
    .array(ServiceAppointmentScheduleItemSchema)
    .refine(
      (items) => new Set(items.map((i) => i.sequence_number)).size === items.length,
      { message: "DUPLICATE_SEQUENCE" },
    ),
});
export type UpsertAppointmentScheduleDto = z.infer<typeof UpsertAppointmentScheduleDtoSchema>;

// ---------------------------------------------------------------------------
// Service Party Role — the ADDITIONAL case parties a service declares
// (besides the implicit applicant). DOC-41. role_key mirrors the
// case_parties.party_role CHECK; cardinality single|multiple.
// ---------------------------------------------------------------------------

const PartyRoleKeySchema = z.enum(PARTY_ROLE_KEYS);
const PartyRoleCardinalitySchema = z.enum(PARTY_ROLE_CARDINALITIES);

export const ServicePartyRoleSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  role_key: PartyRoleKeySchema,
  label_i18n: I18nTextDraftSchema,
  cardinality: PartyRoleCardinalitySchema.default("single"),
  is_required: z.boolean().default(false),
  position: z.number().int().default(0),
});
export type ServicePartyRole = z.infer<typeof ServicePartyRoleSchema>;

export const UpsertServicePartyRoleDtoSchema = z.object({
  service_id: z.string().uuid(),
  role_key: PartyRoleKeySchema,
  label_i18n: I18nTextDraftSchema,
  cardinality: PartyRoleCardinalitySchema.default("single"),
  is_required: z.boolean().default(false),
  position: z.number().int().default(0),
});
export type UpsertServicePartyRoleDto = z.infer<typeof UpsertServicePartyRoleDtoSchema>;

// ---------------------------------------------------------------------------
// Required Document Type
// ---------------------------------------------------------------------------

export const RequiredDocumentTypeSchema = z.object({
  id: z.string().uuid(),
  service_phase_id: z.string().uuid(),
  slug: z.string(),
  label_i18n: I18nTextDraftSchema,
  help_i18n: I18nTextDraftSchema.nullable(),
  category_i18n: I18nTextDraftSchema.nullable(),
  is_required: z.boolean().default(true),
  is_per_party: z.boolean().default(false),
  party_roles: z.array(z.string()).nullable(),
  ai_extract: z.boolean().default(false),
  extraction_schema: z.record(z.string(), z.unknown()).nullable(),
  position: z.number().int().default(0),
  is_active: z.boolean().default(true),
});
export type RequiredDocumentType = z.infer<typeof RequiredDocumentTypeSchema>;

export const CreateRequiredDocDtoSchema = z.object({
  service_phase_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label_i18n: I18nTextDraftSchema,
  help_i18n: I18nTextDraftSchema.nullable().optional(),
  category_i18n: I18nTextDraftSchema.nullable().optional(),
  is_required: z.boolean().default(true),
  is_per_party: z.boolean().default(false),
  party_roles: z.array(z.string()).nullable().optional(),
  ai_extract: z.boolean().default(false),
  extraction_schema: z.record(z.string(), z.unknown()).nullable().optional(),
  position: z.number().int().default(0),
});
export type CreateRequiredDocDto = z.infer<typeof CreateRequiredDocDtoSchema>;

// ---------------------------------------------------------------------------
// Form Definition
// ---------------------------------------------------------------------------

export const FormDefinitionSchema = z.object({
  id: z.string().uuid(),
  service_phase_id: z.string().uuid(),
  slug: z.string(),
  kind: FormKindSchema,
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable(),
  filled_by: FilledBySchema.default("client"),
  position: z.number().int().default(0),
  is_active: z.boolean().default(true),
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

export const CreateFormDtoSchema = z.object({
  service_phase_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  kind: FormKindSchema,
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  filled_by: FilledBySchema.optional(),
  position: z.number().int().optional(),
});
export type CreateFormDto = z.infer<typeof CreateFormDtoSchema>;

// ---------------------------------------------------------------------------
// Automation Version (pdf_automation)
// ---------------------------------------------------------------------------

export const DetectedFieldSchema = z.object({
  pdf_field_name: z.string(),
  field_type: z.enum(["text", "checkbox", "radio", "dropdown", "signature", "unknown"]),
  page: z.number().int().min(1),
  rect: z.tuple([z.number(), z.number(), z.number(), z.number()]),
});
export type DetectedField = z.infer<typeof DetectedFieldSchema>;

export const FormLanguageSchema = z.enum(["en", "es"]);
export type FormLanguage = z.infer<typeof FormLanguageSchema>;

export const AutomationVersionSchema = z.object({
  id: z.string().uuid(),
  form_definition_id: z.string().uuid(),
  version: z.number().int().min(1),
  source_pdf_path: z.string(),
  /** Language of the official PDF/AcroForm. Drives client-answer translation. */
  source_language: FormLanguageSchema.default("en"),
  detected_fields: z.array(DetectedFieldSchema).default([]),
  status: VersionStatusSchema.default("draft"),
  published_at: z.string().datetime().nullable(),
  created_by: z.string().uuid().nullable(),
});
export type AutomationVersion = z.infer<typeof AutomationVersionSchema>;

// ---------------------------------------------------------------------------
// Question Group + Question
// ---------------------------------------------------------------------------

export const QuestionGroupSchema = z.object({
  id: z.string().uuid(),
  automation_version_id: z.string().uuid(),
  title_i18n: I18nTextDraftSchema,
  position: z.number().int(),
});
export type QuestionGroup = z.infer<typeof QuestionGroupSchema>;

export const SourceRefSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("client_answer"), source_ref: z.null() }),
  z.object({
    source: z.literal("document_extraction"),
    source_ref: z.object({ document_slug: z.string(), json_path: z.string() }),
  }),
  z.object({
    source: z.literal("generation_output"),
    source_ref: z.object({ form_slug: z.string(), output_path: z.string() }),
  }),
  z.object({
    source: z.literal("profile"),
    source_ref: z.object({ profile_field: z.string() }),
  }),
]);

export const QuestionSchema = z.object({
  id: z.string().uuid(),
  group_id: z.string().uuid(),
  question_i18n: I18nTextDraftSchema,
  help_i18n: I18nTextDraftSchema.nullable(),
  field_type: FieldTypeSchema,
  options: z
    .array(
      z.object({
        value: z.string(),
        label_i18n: I18nTextDraftSchema,
        // For a SELECT mapped to a GROUP of checkboxes (Sex Male/Female, Marital
        // Single/Married/…, a Yes/No pair), the chosen option marks THIS AcroForm
        // checkbox. null/absent = the question fills its own pdf_field_name.
        pdf_field_name: z.string().nullable().optional(),
      }),
    )
    .nullable(),
  pdf_field_name: z.string().nullable(),
  source: QuestionSourceSchema.default("client_answer"),
  source_ref: z.record(z.string(), z.unknown()).nullable(),
  is_required: z.boolean().default(true),
  position: z.number().int(),
  validation: z.record(z.string(), z.unknown()).nullable(),
  // Conditional/dynamic visibility (show/lock/require depending on another
  // answer). NULL = unconditional. See src/shared/form-logic/conditions.ts.
  condition: ConditionSchema.nullable().default(null),
});
export type Question = z.infer<typeof QuestionSchema>;

// ---------------------------------------------------------------------------
// Generation Config (ai_letter)
// ---------------------------------------------------------------------------

/**
 * A configurable section of a long-form generation (generalizes v1's 17 asylum
 * memorandum sections). The engine generates each section in order, enforcing
 * `min_words` (one expansion pass if below), then assembles them.
 */
export const GenerationSectionSchema = z.object({
  key: z.string().min(1),
  heading: z.string().min(1),
  min_words: z.number().int().min(0).max(20000).default(0),
  max_tokens: z.number().int().min(256).max(16000).default(4000),
  guidance: z.string().default(""),
  type: z.enum(["doctrinal", "narrative", "analysis"]).default("analysis"),
});
export type GenerationSection = z.infer<typeof GenerationSectionSchema>;

export const GenerationAssemblySchema = z.object({
  cover: z.boolean().default(false),
  toc: z.boolean().default(false),
  closing: z.string().nullable().optional(),
});
export type GenerationAssembly = z.infer<typeof GenerationAssemblySchema>;

export const GenerationConfigSchema = z.object({
  form_definition_id: z.string().uuid(),
  system_prompt: z.string().min(1),
  input_document_slugs: z.array(z.string()).default([]),
  input_form_slugs: z.array(z.string()).default([]),
  dataset_id: z.string().uuid().nullable(),
  model: z.enum(GENERATION_MODELS).default("claude-fable-5"),
  max_output_tokens: z.number().int().min(1024).max(64000).default(32000),
  output_format: z.enum(["pdf", "docx", "md"]).default("pdf"),
  output_language: z.enum(["es", "en", "both"]).default("en"),
  // --- v1-grade engine (generic, configurable) ---
  web_search_enabled: z.boolean().default(false),
  web_search_max_uses: z.number().int().min(1).max(10).default(5),
  research_instructions: z.string().nullable().optional(),
  research_model: z.enum(GENERATION_MODELS).nullable().optional(),
  sections: z.array(GenerationSectionSchema).default([]),
  rules_enabled: z.boolean().default(true),
  rules_text: z.string().nullable().optional(),
  assembly: GenerationAssemblySchema.nullable().optional(),
});
export type GenerationConfig = z.infer<typeof GenerationConfigSchema>;

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------

export const DatasetSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string().min(1),
  purpose: z.string().nullable(),
  source_kind: DatasetSourceKindSchema.default("manual"),
  is_active: z.boolean().default(true),
});
export type Dataset = z.infer<typeof DatasetSchema>;

export const DatasetItemSchema = z
  .object({
    id: z.string().uuid(),
    dataset_id: z.string().uuid(),
    title: z.string().min(1),
    jurisdiction: z.string().nullable(),
    outcome: z.string().nullable(),
    content: z.string().nullable(),
    file_path: z.string().nullable(),
    tags: z.array(z.string()).default([]),
    token_count: z.number().int().nullable(),
  })
  .refine((i) => i.content !== null || i.file_path !== null, {
    message: "CATALOG_DATASET_ITEM_EMPTY",
  });
export type DatasetItem = z.infer<typeof DatasetItemSchema>;

// ---------------------------------------------------------------------------
// Publication check types
// ---------------------------------------------------------------------------

export interface PublicationIssue {
  code: string;
  severity: "blocking" | "warning";
  ref?: { entity: string; id?: string; slug?: string; pdf_field_name?: string };
  detail: string;
}

export interface PublicationCheck {
  ok: boolean;
  issues: PublicationIssue[];
}

// ---------------------------------------------------------------------------
// getCaseRequirements types
// ---------------------------------------------------------------------------

export interface ExpandedRequirement {
  /** Stable key: `${docTypeId|'custom:'+ovId}:${partyId|'case'}` */
  key: string;
  required_document_type_id: string | null;
  override_id?: string;
  party_id: string | null;
  label_i18n: I18nTextDraft;
  help_i18n: I18nTextDraft | null;
  category_i18n: I18nTextDraft | null;
  is_required: boolean;
  ai_extract: boolean;
  extraction_schema: Record<string, unknown> | null;
  position: number;
}

export interface RequirementOverrideInput {
  id: string;
  required_document_type_id: string | null;
  party_id: string | null;
  is_required?: boolean;
  is_hidden?: boolean;
  custom_label_i18n?: I18nTextDraft;
}

export interface ResolvedForm {
  form_definition_id: string;
  slug: string;
  kind: "ai_letter" | "pdf_automation";
  label_i18n: I18nTextDraft;
  description_i18n: I18nTextDraft | null;
  filled_by: "client" | "staff" | "both";
  position: number;
  automation: { published_version_id: string; version: number } | null;
  generation: {
    configured: boolean;
    output_format: string;
    output_language: string;
    has_dataset: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// VersionCtx — for source_ref validation in §2.6/§2.7
// ---------------------------------------------------------------------------

export interface VersionCtx {
  documentSlugsWithSchema: Record<string, object | null>;
  aiLetterSlugs: string[];
  profileFields: string[];
}

// ---------------------------------------------------------------------------
// Helpers used by validation rules
// ---------------------------------------------------------------------------

export function blocking(code: string, detail: string, ref?: PublicationIssue["ref"]): PublicationIssue {
  return { code, severity: "blocking", detail, ...(ref ? { ref } : {}) };
}

export function warning(code: string, detail: string, ref?: PublicationIssue["ref"]): PublicationIssue {
  return { code, severity: "warning", detail, ...(ref ? { ref } : {}) };
}

function isComplete(i18n: I18nTextDraft | null | undefined): boolean {
  if (!i18n) return false;
  return !!(i18n.es?.trim() && i18n.en?.trim());
}

function requireI18n(
  issues: PublicationIssue[],
  i18n: I18nTextDraft | null | undefined,
  field: string,
): void {
  if (!isComplete(i18n)) {
    issues.push(
      blocking("CATALOG_I18N_INCOMPLETE", `El campo ${field} requiere texto en ES e EN.`, { entity: field }),
    );
  }
}

// ---------------------------------------------------------------------------
// §2.4 — validateServicePublication
// ---------------------------------------------------------------------------

/**
 * Pure domain rule: validates all pre-conditions for activating a service.
 * Returns a PublicationCheck with full issue list.
 *
 * DOC-40 §2.4, RF-ADM-022.
 */
export function validateServicePublication(input: {
  service: Service;
  plans: ServicePlan[];
  phases: ServicePhase[];
}): PublicationCheck {
  const issues: PublicationIssue[] = [];
  const { service, plans, phases } = input;

  if (service.archived_at) {
    issues.push(
      blocking(
        "CATALOG_SERVICE_ARCHIVED",
        "Un servicio archivado no puede activarse; restáuralo primero.",
      ),
    );
  }

  // 1. At least one active plan
  if (!plans.some((p) => p.is_active)) {
    issues.push(
      blocking("CATALOG_NO_ACTIVE_PLAN", "El servicio necesita al menos un plan activo."),
    );
  }

  // Coherence: with_lawyer plan must have requires_lawyer_validation=true (RF-ADM-023 E2)
  for (const p of plans) {
    if (p.kind === "with_lawyer" && !p.requires_lawyer_validation) {
      issues.push(
        blocking(
          "CATALOG_PLAN_INCONSISTENT",
          "El plan with_lawyer debe tener requires_lawyer_validation=true.",
        ),
      );
    }
  }

  // 2. At least one phase
  if (phases.length === 0) {
    issues.push(blocking("CATALOG_NO_PHASES", "El servicio necesita al menos una fase."));
  }

  // 3. i18n gate (DOC-23 §3.2 / DOC-14 convention)
  requireI18n(issues, service.label_i18n, "services.label_i18n");
  if (service.is_public) {
    requireI18n(issues, service.description_i18n, "services.description_i18n");
  }
  for (const ph of phases) {
    requireI18n(issues, ph.label_i18n, `service_phases(${ph.slug}).label_i18n`);
  }
  for (const ph of phases) {
    if (!isComplete(ph.client_explainer_i18n)) {
      issues.push(
        warning(
          "CATALOG_EXPLAINER_MISSING",
          `La fase ${ph.slug} no tiene explicación para el cliente (recomendado).`,
        ),
      );
    }
  }

  return { ok: issues.every((i) => i.severity !== "blocking"), issues };
}

// ---------------------------------------------------------------------------
// §2.5 — validateEntryServiceLink
// ---------------------------------------------------------------------------

/**
 * Pure domain rule: validates the entry service relationship (RF-ADM-021).
 */
export function validateEntryServiceLink(input: {
  service: Pick<Service, "id" | "entry_parent_service_id" | "entry_phase_id">;
  parent: Service | null;
  parentPhaseIds: string[];
}): PublicationIssue[] {
  const { service, parent, parentPhaseIds } = input;
  const issues: PublicationIssue[] = [];
  const hasParent = service.entry_parent_service_id !== null;
  const hasPhase = service.entry_phase_id !== null;

  if (hasParent !== hasPhase) {
    issues.push(
      blocking(
        "CATALOG_ENTRY_INCONSISTENT",
        "entry_parent_service_id y entry_phase_id deben definirse juntos.",
      ),
    );
  }
  if (!hasParent) return issues;

  if (service.entry_parent_service_id === service.id) {
    issues.push(
      blocking("CATALOG_ENTRY_CHAIN_FORBIDDEN", "Un servicio no puede ser entrada de sí mismo."),
    );
  }
  if (!parent) {
    issues.push(blocking("CATALOG_SERVICE_NOT_FOUND", "El servicio padre no existe."));
  }
  if (parent?.entry_parent_service_id) {
    issues.push(
      blocking(
        "CATALOG_ENTRY_CHAIN_FORBIDDEN",
        "El padre no puede ser a su vez un servicio de entrada (no se permiten cadenas).",
      ),
    );
  }
  if (service.entry_phase_id && !parentPhaseIds.includes(service.entry_phase_id)) {
    issues.push(
      blocking(
        "CATALOG_ENTRY_PHASE_MISMATCH",
        "entry_phase_id no es una fase del servicio padre.",
      ),
    );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// §2.6 — validateVersionPublication
// ---------------------------------------------------------------------------

/**
 * Pure domain rule: validates all pre-conditions for publishing a form version.
 * DOC-40 §2.6, RF-ADM-035.
 */
export function validateVersionPublication(input: {
  version: AutomationVersion;
  groups: QuestionGroup[];
  questions: Question[];
  ctx: VersionCtx;
}): PublicationCheck {
  const issues: PublicationIssue[] = [];
  const { version, groups, questions, ctx } = input;

  if (version.status !== "draft") {
    issues.push(blocking("CATALOG_VERSION_NOT_DRAFT", "Solo una versión draft puede publicarse."));
  }
  if (version.detected_fields.length === 0) {
    issues.push(
      blocking(
        "CATALOG_NO_ACROFORM_FIELDS",
        "La versión no tiene campos detectados (PDF sin AcroForm).",
      ),
    );
  }
  if (groups.length === 0 || questions.length === 0) {
    issues.push(blocking("CATALOG_VERSION_EMPTY", "La versión no tiene grupos/preguntas."));
  }

  const detectedNames = new Set(version.detected_fields.map((f) => f.pdf_field_name));
  const seenPdfNames = new Map<string, Question>();

  for (const q of questions) {
    // (a) bilingual text
    requireI18n(issues, q.question_i18n, `form_questions(${q.id}).question_i18n`);

    // (b) pdf_field_name must exist in detected_fields
    if (q.pdf_field_name !== null && !detectedNames.has(q.pdf_field_name)) {
      issues.push(
        blocking(
          "CATALOG_PDF_FIELD_UNKNOWN",
          `"${q.pdf_field_name}" no existe en detected_fields.`,
          { entity: "form_questions", pdf_field_name: q.pdf_field_name },
        ),
      );
    }

    // (c) no duplicate pdf_field_name mappings
    if (q.pdf_field_name) {
      if (seenPdfNames.has(q.pdf_field_name)) {
        issues.push(
          blocking(
            "CATALOG_PDF_FIELD_DUPLICATED",
            `Dos preguntas mapean "${q.pdf_field_name}".`,
            { entity: "form_questions", pdf_field_name: q.pdf_field_name },
          ),
        );
      }
      seenPdfNames.set(q.pdf_field_name, q);
    }

    // (d) select must have options
    if (q.field_type === "select" && (!q.options || q.options.length === 0)) {
      issues.push(
        blocking("CATALOG_SELECT_WITHOUT_OPTIONS", `La pregunta ${q.id} es select sin opciones.`),
      );
    }

    // (e) source_ref validation
    issues.push(...validateSourceRef(q, ctx));
  }

  // (f) unmapped fields → WARNING
  for (const f of version.detected_fields) {
    if (!seenPdfNames.has(f.pdf_field_name) && f.field_type !== "signature") {
      issues.push(
        warning(
          "CATALOG_PDF_FIELD_UNMAPPED",
          `Campo "${f.pdf_field_name}" (pág. ${f.page}) sin pregunta asignada.`,
          { entity: "form_automation_versions", pdf_field_name: f.pdf_field_name },
        ),
      );
    }
  }

  return { ok: issues.every((i) => i.severity !== "blocking"), issues };
}

/**
 * Validates a single question's source_ref against the service context.
 * DOC-40 §2.6 rules (d/e) + §2.7.
 */
export function validateSourceRef(q: Question, ctx: VersionCtx): PublicationIssue[] {
  switch (q.source) {
    case "client_answer":
      return [];
    case "document_extraction": {
      const ref = q.source_ref as { document_slug?: string; json_path?: string } | null;
      if (!ref?.document_slug || !(ref.document_slug in ctx.documentSlugsWithSchema)) {
        return [
          blocking(
            "CATALOG_SOURCE_REF_INVALID",
            `document_slug "${ref?.document_slug}" no es un requirement con ai_extract=true.`,
          ),
        ];
      }
      const schema = ctx.documentSlugsWithSchema[ref.document_slug];
      if (schema && ref.json_path && !jsonPathExistsInSchema(schema, ref.json_path)) {
        return [
          warning(
            "CATALOG_SOURCE_PATH_UNKNOWN",
            `json_path "${ref.json_path}" no existe en el extraction_schema.`,
          ),
        ];
      }
      return [];
    }
    case "generation_output": {
      const ref = q.source_ref as { form_slug?: string } | null;
      return ctx.aiLetterSlugs.includes(ref?.form_slug ?? "")
        ? []
        : [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              `form_slug "${ref?.form_slug}" no es un ai_letter del servicio.`,
            ),
          ];
    }
    case "profile": {
      const ref = q.source_ref as { profile_field?: string } | null;
      return (ctx.profileFields as string[]).includes(ref?.profile_field ?? "")
        ? []
        : [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              `profile_field "${ref?.profile_field}" no está en la lista blanca.`,
            ),
          ];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// §2.7 — Other pure rules
// ---------------------------------------------------------------------------

/** True if the service is available for contracting today. */
export const isServiceContractable = (s: Service): boolean =>
  s.is_active && s.archived_at === null;

/** Returns the next version number for an automation version series. */
export const nextVersionNumber = (versions: Pick<AutomationVersion, "version">[]): number =>
  versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;

/**
 * Expands per-party requirements for a phase.
 * Returns ExpandedRequirement[] with stable keys.
 * DOC-40 §2.7.
 */
export function expandPerPartyRequirements(
  docs: RequiredDocumentType[],
  parties: Array<{ id: string; party_role: string }>,
): ExpandedRequirement[] {
  return docs
    .filter((d) => d.is_active)
    .flatMap((d) => {
      if (!d.is_per_party) {
        return [toExpanded(d, null)];
      }
      const eligible = parties.filter((p) =>
        (d.party_roles ?? []).includes(p.party_role),
      );
      // 0 eligible parties → 0 items (RF-ADM-028 A1 — no error)
      return eligible.map((p) => toExpanded(d, p.id));
    });
}

function toExpanded(doc: RequiredDocumentType, partyId: string | null): ExpandedRequirement {
  return {
    key: `${doc.id}:${partyId ?? "case"}`,
    required_document_type_id: doc.id,
    party_id: partyId,
    label_i18n: doc.label_i18n,
    help_i18n: doc.help_i18n,
    category_i18n: doc.category_i18n,
    is_required: doc.is_required,
    ai_extract: doc.ai_extract,
    extraction_schema: doc.extraction_schema as Record<string, unknown> | null,
    position: doc.position,
  };
}

/**
 * Merges case_requirement_overrides onto the expanded catalog requirements.
 * DOC-40 §2.7.
 */
export function applyRequirementOverrides(
  expanded: ExpandedRequirement[],
  overrides: RequirementOverrideInput[],
): ExpandedRequirement[] {
  let out = [...expanded];

  for (const ov of overrides) {
    if (ov.required_document_type_id === null) {
      // Custom requirement for this case only
      out.push({
        key: `custom:${ov.id}:${ov.party_id ?? "case"}`,
        required_document_type_id: null,
        override_id: ov.id,
        party_id: ov.party_id,
        label_i18n: ov.custom_label_i18n ?? {},
        help_i18n: null,
        category_i18n: null,
        is_required: ov.is_required ?? true,
        ai_extract: false,
        extraction_schema: null,
        position: Number.MAX_SAFE_INTEGER,
      });
      continue;
    }

    // Override on a catalog requirement
    out = out.flatMap((req) => {
      const matches =
        req.required_document_type_id === ov.required_document_type_id &&
        (ov.party_id === null || ov.party_id === req.party_id);
      if (!matches) return [req];
      if (ov.is_hidden) return [];
      return [{ ...req, is_required: ov.is_required ?? req.is_required, override_id: ov.id }];
    });
  }

  return out.sort((a, b) => a.position - b.position);
}

// ---------------------------------------------------------------------------
// JSON Schema helpers for extraction_schema validation
// ---------------------------------------------------------------------------

/**
 * Validates that a JSON Schema is syntactically valid and restricted to the
 * Gemini-portable subset (DOC-40 §2.7 / RF-ADM-029).
 *
 * Allowed: type object/array/string/number/boolean, enum, description,
 * required, nullable, properties, items.
 * Disallowed: $ref (recursive), if/then/else, anyOf/oneOf/not, $defs.
 */
export function validateExtractionSchema(schema: unknown): { valid: boolean; reason?: string } {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return { valid: false, reason: "schema must be a plain object" };
  }
  const FORBIDDEN_KEYS = ["$ref", "if", "then", "else", "anyOf", "oneOf", "not", "$defs", "definitions"];
  // Recursive walk — Gemini portability check must cover the entire schema tree.
  const obj = schema as Record<string, unknown>;
  const found = FORBIDDEN_KEYS.filter((k) => k in obj);
  if (found.length > 0) {
    return { valid: false, reason: `Forbidden keys: ${found.join(", ")}` };
  }
  // H-3: "raw_text" is injected by the extraction engine at runtime.
  // Schemas that define it as a property would conflict with the engine's output.
  const properties = obj.properties as Record<string, unknown> | undefined;
  if (properties && "raw_text" in properties) {
    return {
      valid: false,
      reason: '"raw_text" es un campo reservado inyectado por el motor de extracción.',
    };
  }
  // Recurse into properties (object schemas) and items (array schemas)
  const nestedContainers: unknown[] = [
    ...Object.values(properties ?? {}),
    obj.items,
  ].filter(Boolean);
  for (const nested of nestedContainers) {
    const sub = validateExtractionSchema(nested);
    if (!sub.valid) return sub;
  }
  return { valid: true };
}

/**
 * Checks whether a simple dot-notation json_path exists in a JSON Schema.
 * Best-effort — returns true on any ambiguity to avoid false blocking.
 */
export function jsonPathExistsInSchema(schema: object, jsonPath: string): boolean {
  try {
    const parts = jsonPath.split(".").filter(Boolean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = schema;
    for (const part of parts) {
      if (!node || typeof node !== "object") return false;
      // Navigate through properties / items
      if (node.properties && part in node.properties) {
        node = node.properties[part];
      } else if (node.items) {
        node = node.items;
      } else {
        return false;
      }
    }
    return true;
  } catch {
    return true; // permissive on parse errors
  }
}

// ---------------------------------------------------------------------------
// CatalogError factory
// ---------------------------------------------------------------------------

export class CatalogError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogError";
  }
}

export function catalogError(code: string, detail?: string): CatalogError {
  return new CatalogError(code, detail ?? code);
}

/** Throws CatalogError if any blocking issues exist. */
export function assertNoIssues(issues: PublicationIssue[]): void {
  const blocking = issues.filter((i) => i.severity === "blocking");
  if (blocking.length > 0) {
    throw new CatalogError(blocking[0].code, blocking[0].detail);
  }
}

/** Maps a Postgres FK violation error to a CatalogError. */
export function isFkViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return e.code === "23503";
}
