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
import { ComputedSourceRefSchema, parseComputedSourceRef, findComputedCycle } from "@/shared/form-logic/computed";
import { FIELD_EMPTY_POLICIES, VERSION_EMPTY_POLICIES } from "@/shared/form-logic/empty-policy";
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

/** Bilingual list of strings (e.g. the contract scope/stages). Draft = partial. */
export const I18nStringListDraftSchema = z
  .object({ es: z.array(z.string()), en: z.array(z.string()) })
  .partial();
export type I18nStringListDraft = z.infer<typeof I18nStringListDraftSchema>;

// Enum values must match DB CHECK constraints exactly (DOC-30 §0 rule: text+CHECK, no ENUM types)
export const ServiceCategorySchema = z.enum(["migratorio", "empresarial", "familiar"]);
export const PlanKindSchema = z.enum(["self", "with_lawyer"]);
export const AppointmentKindSchema = z.enum(["video", "phone", "presencial"]);
// 'questionnaire' = complementary, PDF-less form whose answers feed an ai_letter
// generation. Reuses the whole question infra (groups/questions); its version has
// no PDF (source_pdf_path nullable). See migration 0053.
export const FormKindSchema = z.enum(["ai_letter", "pdf_automation", "questionnaire"]);
export const FilledBySchema = z.enum(["client", "staff", "both"]);
export const VersionStatusSchema = z.enum(["draft", "published", "archived"]);
export const FieldTypeSchema = z.enum([
  "text",
  "number",
  "date",
  "checkbox",
  "select",
  "textarea",
  // multiselect: a checkbox GROUP where several boxes may be ticked at once (each
  // option carries its own pdf_field_name). validation.minSelected enforces a floor
  // (e.g. I-589 Part B.1 asylum bases: at least one basis must be marked).
  "multiselect",
]);
// 'ai_field' = a field whose value is produced by AI at resolution time from a
// connected source (a client document the AI INTERPRETS, or an ai_letter
// generation the AI SYNTHESIZES), guided by a per-field instruction. See
// resolveAiFields (ai-engine) + resolveBySource (cases). Etapa B.
// 'computed' = a derived total: an exact arithmetic function (sum/subtract) of
// other questions' answers, resolved deterministically at fill time — never shown
// to the client, never sent to AI. See shared/form-logic/computed.ts (EOIR-26A
// 1.A / 2.B / Part-3 TOTAL). Ola apelación EOIR-26A.
// 'current_date' = today's date in the org timezone, resolved at PDF-generation
// time (never asked, never sent to AI). For date fields it flows through the same
// formatPdfDate() the extracted dates use → MM/DD/YYYY. EOIR-26 items #9 / #12(B).
// 'web_research' = a value produced by an INTERACTIVE web search: the staff types a
// query into a search box, and a server action calls Anthropic with the web_search
// tool + a config-as-data system prompt (source_ref.system_prompt_template, with a
// {{INPUT}} token). The result lands as a normal answer (read-only box, with a
// manual escape hatch). resolveBySource returns null — it never auto-resolves. First
// use: EOIR-26 item #12 (find the OCC/OPLA service address from the court address).
// 'field_copy' = copy the PERSISTED answer of another question, possibly of ANOTHER
// form of the same case (source_ref.{form_slug,target_question_id}). Materialized on
// the questionnaire submit so downstream (the letter) sees it. First use: Proof of
// Service questionnaire (Chief Counsel address ← EOIR-26 item #12). See resolveBySource.
export const QuestionSourceSchema = z.enum([
  "client_answer",
  "document_extraction",
  "generation_output",
  "profile",
  "ai_field",
  "computed",
  "current_date",
  "web_research",
  "field_copy",
]);
/** What an ai_field connects to: a client-uploaded document or an ai_letter output. */
export const AiFieldConnectedKindSchema = z.enum(["document", "ai_letter"]);
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
  // Per-service contract content (DOC-51) — rendered in the signing page + PDF.
  contract_object_i18n: I18nTextDraftSchema.nullable(),
  contract_scope_i18n: I18nStringListDraftSchema.nullable(),
  contract_special_clause_i18n: I18nTextDraftSchema.nullable(),
  // Per-service certified-translation signing (migration 0057): the signer name +
  // a signature image (catalog-assets path) stamped on the generated translation PDF.
  translation_signer_name: z.string().nullable(),
  translation_signature_path: z.string().nullable(),
  // Per-service expediente assembly guide (migration 0087): English plain-text
  // canonical filing order the AI assembly planner injects into its prompt.
  // NULL → the planner falls back to its generic legal-order rules.
  expediente_guidance: z.string().nullable(),
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
  contract_object_i18n: I18nTextDraftSchema.nullable().optional(),
  contract_scope_i18n: I18nStringListDraftSchema.nullable().optional(),
  contract_special_clause_i18n: I18nTextDraftSchema.nullable().optional(),
  translation_signer_name: z.string().max(160).nullable().optional(),
  translation_signature_path: z.string().nullable().optional(),
  expediente_guidance: z.string().max(20000).nullable().optional(),
  position: z.number().int().optional(),
});
export type UpdateServiceDto = z.infer<typeof UpdateServiceDtoSchema>;

// ---------------------------------------------------------------------------
// Service Plan
// ---------------------------------------------------------------------------

export const PaymentFrequencySchema = z.enum(["weekly", "monthly"]);
export type CatalogPaymentFrequency = z.infer<typeof PaymentFrequencySchema>;

export const ServicePlanSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().uuid(),
  kind: PlanKindSchema,
  price_cents: z.number().int().positive(),
  currency: z.string().length(3).default("USD"),
  requires_lawyer_validation: z.boolean().default(false),
  default_installments: z.number().int().min(1).default(1),
  default_downpayment_cents: z.number().int().min(0).nullable(),
  default_frequency: PaymentFrequencySchema.default("monthly"),
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
  default_frequency: PaymentFrequencySchema.default("monthly"),
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
  /** Approximate week (anchored on cases.opened_at) — drives the "Semana N"
   *  label and the ordering against scheduled citas. Null = no estimate. */
  week_offset: z.number().int().min(1).nullable(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

export const CreateMilestoneDtoSchema = z.object({
  service_phase_id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  label_i18n: I18nTextDraftSchema,
  description_i18n: I18nTextDraftSchema.nullable().optional(),
  glossary_i18n: I18nTextDraftSchema.nullable().optional(),
  icon: z.string().optional(),
  week_offset: z.number().int().min(1).nullable().optional(),
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

/** A single objective the admin defines for a cita (stored in objectives_i18n). */
export const ServiceObjectiveSchema = z.object({
  id: z.string().min(1),
  text: I18nTextDraftSchema,
});
export type ServiceObjective = z.infer<typeof ServiceObjectiveSchema>;

export const ServiceAppointmentScheduleItemSchema = z.object({
  sequence_number: z.number().int().min(1),
  duration_minutes: z.number().int().min(5),
  kind: AppointmentKindSchema.default("video"),
  week_offset: z.number().int().min(1),
  label_i18n: I18nTextDraftSchema.nullable().optional(),
  /** Ordered objectives for this cita (shown in the detail; marked on complete). */
  objectives: z.array(ServiceObjectiveSchema).optional(),
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
// Stage SLA — plazo (cuenta regresiva) por etapa de responsabilidad.
//
// El admin configura, por servicio, cuántos DÍAS tiene cada etapa (sales/legal/
// operations) para terminar su trabajo. La tarjeta kanban del responsable muestra
// una cuenta regresiva contra ese deadline. El estimado total del servicio para
// entregar el expediente es la SUMA de las etapas. Excluye 'done' (terminal).
// ---------------------------------------------------------------------------

/** Etapas de responsabilidad con plazo configurable (mirror de cases.current_stage sin 'done'). */
export const STAGE_SLA_KEYS = ["sales", "legal", "operations"] as const;
export type StageSlaKey = (typeof STAGE_SLA_KEYS)[number];

/** Días por etapa, con las claves faltantes como null (etapa sin plazo). */
export type StageSlaDays = Record<StageSlaKey, number | null>;

export const StageSlaItemSchema = z.object({
  stage: z.enum(STAGE_SLA_KEYS),
  duration_days: z.number().int().min(1).max(365),
});
export type StageSlaItem = z.infer<typeof StageSlaItemSchema>;

export const UpsertStageSlasDtoSchema = z.object({
  service_id: z.string().uuid(),
  items: z
    .array(StageSlaItemSchema)
    .refine(
      (items) => new Set(items.map((i) => i.stage)).size === items.length,
      { message: "DUPLICATE_STAGE" },
    ),
});
export type UpsertStageSlasDto = z.infer<typeof UpsertStageSlasDtoSchema>;

// ---------------------------------------------------------------------------
// Deadline policy — plazo legal externo por servicio + paso "Calificación".
//
// Config-as-data (genérico, NO hardcodea el slug del servicio): is_enabled activa
// el paso de Calificación en el alta; la calculadora usa deadline_days (calendario)
// + min_business_days_to_accept (hábiles) para el aviso "no aceptar"; y la etapa
// anchored_stage ancla su stage_due_at al deadline (min(entered + tope hábiles,
// deadline − mail_buffer hábiles)). El "tope" es el duration_days de esa etapa en
// service_stage_slas (no se duplica aquí).
// ---------------------------------------------------------------------------

export interface DeadlinePolicy {
  serviceId: string;
  isEnabled: boolean;
  anchorLabelI18n: I18nTextDraft;
  deadlineDays: number;
  minBusinessDaysToAccept: number;
  mailBufferBusinessDays: number;
  anchoredStage: StageSlaKey | null;
}

export const UpsertDeadlinePolicyDtoSchema = z.object({
  service_id: z.string().uuid(),
  is_enabled: z.boolean(),
  anchor_label_i18n: I18nTextDraftSchema,
  deadline_days: z.number().int().min(1).max(365),
  min_business_days_to_accept: z.number().int().min(0).max(90),
  mail_buffer_business_days: z.number().int().min(0).max(30),
  anchored_stage: z.enum(STAGE_SLA_KEYS).nullable(),
});
export type UpsertDeadlinePolicyDto = z.infer<typeof UpsertDeadlinePolicyDtoSchema>;

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
  // Whether parties of this role appear/commit in the signed contract.
  // Independent of is_required (case data-entry) and cardinality. The implicit
  // applicant (petitioner) is always in the contract regardless of this flag.
  include_in_contract: z.boolean().default(true),
  position: z.number().int().default(0),
});
export type ServicePartyRole = z.infer<typeof ServicePartyRoleSchema>;

export const UpsertServicePartyRoleDtoSchema = z.object({
  service_id: z.string().uuid(),
  role_key: PartyRoleKeySchema,
  label_i18n: I18nTextDraftSchema,
  cardinality: PartyRoleCardinalitySchema.default("single"),
  is_required: z.boolean().default(false),
  include_in_contract: z.boolean().default(true),
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
  accepted_format: z.enum(["pdf", "png"]).default("pdf"),
  allow_multiple: z.boolean().default(false),
  // Coverage: the AI may detect this type INSIDE another upload of the same
  // phase (combined PDF). Requires ai_extract + extraction_schema + pdf format.
  detectable_in_combined: z.boolean().default(false),
  detection_hints_i18n: I18nTextDraftSchema.nullable(),
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
  accepted_format: z.enum(["pdf", "png"]).default("pdf"),
  allow_multiple: z.boolean().default(false),
  detectable_in_combined: z.boolean().default(false),
  detection_hints_i18n: I18nTextDraftSchema.nullable().optional(),
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
  // Ola 2 gate override: false exempts this form from the "documents 100%" gate.
  requires_documents_complete: z.boolean().optional(),
});
export type CreateFormDto = z.infer<typeof CreateFormDtoSchema>;

// ---------------------------------------------------------------------------
// Ola 3 — questionnaire generation config (per-case AI question generation)
// ---------------------------------------------------------------------------
export const QuestionnaireGenerationConfigSchema = z.object({
  form_definition_id: z.string().uuid(),
  mode: z.enum(["global", "automatic", "hybrid"]),
  generation_prompt: z.string().max(8000).nullable().optional(),
  input_document_slugs: z.array(z.string()).default([]),
  input_form_slugs: z.array(z.string()).default([]),
  prerequisite_form_slugs: z.array(z.string()).default([]),
  prerequisite_document_slugs: z.array(z.string()).default([]),
  // 0 = "review only": generate NO new questions, just draft the base questions
  // from the record (a letter questionnaire the client only reviews). 1–60 = the
  // number of AI-generated questions to add.
  target_question_count: z.number().int().min(0).max(60).nullable().optional(),
  model: z.enum(GENERATION_MODELS).nullable().optional(),
  hybrid_layout: z.enum(["append_group", "merge_by_topic"]).default("append_group"),
  auto_trigger: z.boolean().default(true),
  allow_client_trigger: z.boolean().default(false),
  on_new_evidence: z.enum(["never", "flag", "auto"]).default("flag"),
  draft_answers_enabled: z.boolean().default(false),
  draft_answers_prompt: z.string().max(8000).nullable().optional(),
}).refine(
  // "Review only" (0 generated questions) only makes sense in hybrid, where the
  // base catalog questions still exist to be drafted. In automatic/global it would
  // leave a permanently empty questionnaire — a dead end for the client.
  (c) => !(c.target_question_count === 0 && c.mode !== "hybrid"),
  { message: "target_question_count=0 (solo revisar) requiere mode='hybrid'", path: ["target_question_count"] },
);
export type QuestionnaireGenerationConfigInput = z.infer<typeof QuestionnaireGenerationConfigSchema>;

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
  // NULL for a 'questionnaire' version (no PDF — it only holds groups/questions).
  source_pdf_path: z.string().nullable(),
  /** Language of the official PDF/AcroForm. Drives client-answer translation. */
  source_language: FormLanguageSchema.default("en"),
  detected_fields: z.array(DetectedFieldSchema).default([]),
  status: VersionStatusSchema.default("draft"),
  published_at: z.string().datetime().nullable(),
  created_by: z.string().uuid().nullable(),
  // Form-wide default for how APPLICABLE-but-EMPTY fields render in the PDF:
  // `auto` (legacy: only free-text → N/A), `na` (every text-backed empty → N/A),
  // or `blank`. A per-question `empty_policy` overrides this. See migration 0070
  // and src/shared/form-logic/empty-policy.ts.
  default_empty_policy: z.enum(VERSION_EMPTY_POLICIES).default("auto"),
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
  // When true, the generator leaves every field in this group BLANK by design (no
  // value, no N/A backfill) — e.g. I-589 Part D signature, Parts F/G "to be completed
  // at the interview/hearing". Default false. See migration 0065.
  do_not_fill: z.boolean().default(false),
});
export type QuestionGroup = z.infer<typeof QuestionGroupSchema>;

export const SourceRefSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("client_answer"),
    // Optional config-as-data default (ola apelación): pre-fills an untouched
    // question (e.g. EOIR-26 item 8 "will a brief be filed?" = yes by service
    // design). Editable prefill — the client's answer always wins.
    source_ref: z.union([
      z.null(),
      z.object({ default_value: z.string().min(1).max(500) }),
    ]),
  }),
  z.object({
    source: z.literal("document_extraction"),
    source_ref: z.object({
      document_slug: z.string(),
      json_path: z.string(),
      // Maps an extracted value (booleans/enums, matched case-insensitively) to
      // an OPTION value so selects can be prefilled; a miss falls back to
      // default_value — a mapped select never receives a raw non-option value.
      value_map: z.record(z.string(), z.string()).optional(),
      default_value: z.string().min(1).max(500).optional(),
    }),
  }),
  z.object({
    source: z.literal("generation_output"),
    source_ref: z.object({ form_slug: z.string(), output_path: z.string() }),
  }),
  z.object({
    source: z.literal("profile"),
    // `format` (optional) post-processes the resolved value — e.g. split a phone into
    // its area code / local number for forms that print them in separate boxes.
    source_ref: z.object({ profile_field: z.string(), format: z.string().optional() }),
  }),
  z.object({
    source: z.literal("ai_field"),
    source_ref: z.object({
      connected: z.object({
        kind: AiFieldConnectedKindSchema,
        slug: z.string(),
        // Additional requirement documents the interpreter also reads (kind:
        // document only) — e.g. EOIR-26 #6 reads the decision PLUS the asylum
        // package + evidences. Capped: the whole set travels inline to Gemini.
        context_slugs: z.array(z.string()).max(5).optional(),
      }),
      instruction: z.string(),
      // Optional per-field model override; falls back to the per-flavor default
      // (Gemini for documents, Anthropic for ai_letter synthesis).
      model: z.string().nullable().optional(),
      // Character ceiling for the produced text (0/absent = unbounded). Declared
      // HERE, as data, so the admin sets it per field instead of re-typing a
      // limit into the instruction prose. It is appended to the prompt and
      // verified after the provider answers — an over-long value would be
      // silently CLIPPED by the PDF widget. See shared/form-logic/ai-field-format.
      max_chars: z.number().int().min(0).max(20000).optional(),
    }),
  }),
  z.object({
    source: z.literal("computed"),
    // A derived total: `op` over the answers of the `inputs` questions (ids in the
    // same version). See shared/form-logic/computed.ts. The operand ids are checked
    // to exist (and not self-reference) at publication in validateSourceRef.
    source_ref: ComputedSourceRefSchema,
  }),
  z.object({
    // Today's date (org timezone) at generation time — no config to carry, so
    // source_ref is always null. Determinism = same day → same value.
    source: z.literal("current_date"),
    source_ref: z.null(),
  }),
  z.object({
    source: z.literal("web_research"),
    source_ref: z.object({
      // Server-only prompt with a {{INPUT}} token (what the staff types). NEVER sent
      // to the client DTO — same principle as ai_improve.instruction. The runWebResearch
      // action fills it and calls Anthropic web_search.
      system_prompt_template: z.string().min(1).max(4000),
      // Optional official source to steer web_search toward (e.g. the ICE OPLA directory).
      reference_url: z.string().url().max(500).optional(),
      // Anthropic web_search server tool `max_uses`, clamped.
      max_uses: z.number().int().min(1).max(8).default(5),
      // UI labels for the search box + read-only result box (these DO reach the client).
      search_label_i18n: I18nTextDraftSchema.nullable().optional(),
      result_label_i18n: I18nTextDraftSchema.nullable().optional(),
      // Optional dynamic help tokens: token → a document-extraction path. Their resolved
      // values are interpolated into help_i18n server-side (e.g. {{a_number}} from the
      // judge's decision, {{nationality}} from the I-589). Resolved like document_extraction.
      help_tokens: z
        .record(z.string(), z.object({ document_slug: z.string(), json_path: z.string() }))
        .optional(),
    }),
  }),
  z.object({
    source: z.literal("field_copy"),
    // Copy the PERSISTED answer of another question — of THIS form or another form of
    // the same case. Reads the stored answer (never re-resolves the target's own
    // source), so there is no resolution recursion. `target_pdf_field_name` is a stable
    // fallback when the target form was re-published and the id changed across versions.
    source_ref: z.object({
      form_slug: z.string().min(1),
      target_question_id: z.string().uuid(),
      target_pdf_field_name: z.string().nullable().optional(),
    }),
  }),
]);

// Per-question "Mejorar con IA" config (migration 0086). null = the client
// never sees the improve button; { instruction } = enabled, the instruction
// carries the field-specific FORMAT rules (the anti-invention guardrails live
// in ai-engine's fixed system prompt, not here). The instruction is server-only:
// the client DTO exposes just a boolean.
export const AiImproveSchema = z.object({
  instruction: z.string().min(1).max(4000),
});
export type AiImproveConfig = z.infer<typeof AiImproveSchema>;

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
  // Per-field empty-fill policy: `inherit` (use the version default), `na`,
  // `blank`, or `custom` (`empty_placeholder`). See migration 0070 and
  // src/shared/form-logic/empty-policy.ts.
  empty_policy: z.enum(FIELD_EMPTY_POLICIES).default("inherit"),
  empty_placeholder: z.string().nullable().default(null),
  // Write the answer to the PDF VERBATIM — never machine-translated nor PII-masked
  // (A-Numbers, SSNs, passports, names, cities). Keeps `maskPii` output off the
  // federal form. Default false. See migration 0070.
  no_translate: z.boolean().default(false),
  // "Mejorar con IA" (migration 0086). Deliberately `.optional()` WITHOUT a
  // default: the editor autosave upserts the full row with Zod-materialized
  // defaults, and a default here would wipe the config on every unrelated save.
  // Writes go exclusively through updateQuestionAiImprove (omitted from the
  // upsert schema in service.ts).
  ai_improve: AiImproveSchema.nullable().optional(),
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
  // (ola apelación) word CEILING: 0 = no ceiling (legacy — old configs parse and
  // behave byte-identically). The engine prompts a hard limit, bounds the
  // expansion pass by it and condenses drafts that exceed it by >15%.
  max_words: z.number().int().min(0).max(20000).default(0),
  max_tokens: z.number().int().min(256).max(16000).default(4000),
  guidance: z.string().default(""),
  type: z.enum(["doctrinal", "narrative", "analysis"]).default("analysis"),
  // Optional per-section model override (e.g. Opus for the dense nexus section).
  model: z.enum(GENERATION_MODELS).nullable().optional(),
  // When true the assembled document omits this section's `## heading` (the heading is
  // still the model's writing instruction). Court documents (Statement of Reasons,
  // Proof of Service) use it so the output is a clean caption/body, not headed sections.
  hide_heading: z.boolean().optional(),
}).refine((s) => s.max_words === 0 || s.max_words >= s.min_words, {
  message: "max_words debe ser 0 (sin techo) o mayor o igual que min_words",
  path: ["max_words"],
});
export type GenerationSection = z.infer<typeof GenerationSectionSchema>;

/** Structural blocks the document is assembled from, in admin-defined order. */
export const ASSEMBLY_BLOCK_TYPES = ["cover", "toc", "body", "chronology", "conclusions", "annexes", "closing"] as const;
export const AssemblyBlockSchema = z.object({
  type: z.enum(ASSEMBLY_BLOCK_TYPES),
  enabled: z.boolean().default(true),
});
/** One cover-page row: a fixed label + a value that may contain {{tokens}} resolved
 *  from the case / document-extraction context at generation time. */
export const CoverRowSchema = z.object({
  label: z.string().default(""),
  value: z.string().default(""),
});
export const GenerationAssemblySchema = z.object({
  // Legacy on/off flags — kept for backward compatibility; superseded by `blocks`.
  cover: z.boolean().default(false),
  toc: z.boolean().default(false),
  // Insert the research-derived chronology table into the body (court documents).
  chronology: z.boolean().default(false),
  // Append the "ANNEXES — INDEX OF EXHIBITS" block (jurisprudence + country sources).
  annexes: z.boolean().default(false),
  closing: z.string().nullable().optional(),
  // --- structured, admin-orderable document structure (preferred when present) ---
  blocks: z.array(AssemblyBlockSchema).optional(),
  cover_page: z
    .object({
      title: z.string().optional(),
      rows: z.array(CoverRowSchema).optional(),
    })
    .optional(),
});
export type GenerationAssembly = z.infer<typeof GenerationAssemblySchema>;

// ---------------------------------------------------------------------------
// Mailing cover sheet ("Carátula de Envío") — deterministic, NON-AI document
// ---------------------------------------------------------------------------

/** Where a variable value on the cover comes from: a CONFIRMED answer of a
 *  companion-questionnaire question, referenced by form slug + question wording
 *  (same convention as `letter_fill`, resolved against loadResolvedInputs). */
export const MailingCoverAnswerRefSchema = z.object({
  form_slug: z.string().min(1),
  /** Question wording (question_i18n text, as stored) whose confirmed answer to read. */
  question: z.string().min(1),
});

/** One envelope block: a fixed recipient header + an optional variable address
 *  (e.g. the OPLA/OCC address the client found with the buscador IA). */
export const MailingCoverEnvelopeSchema = z.object({
  /** Fixed recipient lines, rendered verbatim (e.g. "Board of Immigration Appeals", …). */
  recipient_lines: z.array(z.string()).default([]),
  /** Optional variable address appended below the fixed lines. null = fully fixed. */
  address_from: MailingCoverAnswerRefSchema.nullable().default(null),
});

/** Deterministic mailing cover sheet. Its PRESENCE on a config routes the
 *  generation to the no-LLM render path and prepends the sheet before the
 *  expediente index. */
export const MailingCoverConfigSchema = z.object({
  /** Firm's return address lines (fixed for every client). */
  return_address: z.array(z.string()).default([]),
  /** Sender/return NAME (top of each envelope) — a confirmed questionnaire answer. */
  sender_name: MailingCoverAnswerRefSchema.nullable().default(null),
  /** One block per recipient/envelope (scalable: 1..N). */
  envelopes: z.array(MailingCoverEnvelopeSchema).default([]),
  /** Layout tuning in points (US Letter) so the admin controls the spacing.
   *  Optional — the ai-engine resolver applies the same defaults at render time. */
  spacing: z
    .object({
      block_gap_pt: z.number().min(0).max(400).default(120),
      line_height: z.number().min(1).max(3).default(1.5),
      font_size_pt: z.number().min(8).max(24).default(13),
      margin_pt: z.number().min(0).max(200).default(96),
    })
    .optional(),
});
export type MailingCoverConfig = z.infer<typeof MailingCoverConfigSchema>;

/** A curated baseline source the admin pins on a letter — always downloaded and
 *  filed as an exhibit alongside whatever the AI cites. */
export const CuratedSourceSchema = z.object({
  url: z.string().url(),
  title: z.string().default(""),
  category: z.string().default(""),
});
/** Cited-source kinds that may be auto-downloaded as physical exhibits. */
export const EXHIBIT_SOURCE_KIND_VALUES = [
  "country_condition",
  "jurisprudence",
  "admin_curated",
  "dataset",
] as const;

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
  pre_mortem_enabled: z.boolean().default(false),
  web_search_max_uses: z.number().int().min(1).max(10).default(5),
  research_instructions: z.string().nullable().optional(),
  research_model: z.enum(GENERATION_MODELS).nullable().optional(),
  sections: z.array(GenerationSectionSchema).default([]),
  rules_enabled: z.boolean().default(true),
  rules_text: z.string().nullable().optional(),
  assembly: GenerationAssemblySchema.nullable().optional(),
  // --- deterministic mailing cover sheet (non-AI); presence = no-LLM render + prepend before index ---
  mailing_cover: MailingCoverConfigSchema.nullable().optional(),
  // --- automatic exhibits (anexos): download + file the cited sources ---
  attach_sources_enabled: z.boolean().default(false),
  attach_sources_kinds: z.array(z.enum(EXHIBIT_SOURCE_KIND_VALUES)).default(["country_condition", "jurisprudence"]),
  curated_sources: z.array(CuratedSourceSchema).default([]),
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
  /** Accepted upload format for this document (admin-configured): pdf | png. */
  accepted_format: "pdf" | "png";
  /** Admin-configured: client may upload more than one file for this requirement. */
  allow_multiple: boolean;
  position: number;
  /**
   * True only in the staff-facing resolution (`includeHidden`): the requirement
   * carries an `is_hidden` override and is NOT shown to the client. In the
   * client-facing resolution these items are dropped entirely (never present).
   */
  is_hidden?: boolean;
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
  /**
   * ALL document requirement slugs of the service (with or without ai_extract).
   * `ai_field` (kind:document) interprets the raw file via Gemini multimodal, so it
   * does NOT require a predefined extraction_schema — only that the document exists.
   */
  allDocumentSlugs: string[];
  /**
   * ALL form definition slugs of the service (any kind). Used to validate a
   * `field_copy` source_ref (the form it copies from must exist in the service).
   * Absent → the field_copy form-existence check is skipped (isolated unit tests).
   */
  formSlugs?: string[];
  /**
   * ALL question ids in the version being validated. Populated by
   * validateVersionPublication so a `computed` source can be checked to reference
   * only existing operand questions. Absent → the computed operand-existence check
   * is skipped (unit tests that validate a single question in isolation).
   */
  questionIds?: ReadonlySet<string>;
  /**
   * Question id → source, for the version being validated. Populated alongside
   * questionIds. Used to reject a `computed` operand whose source the evaluator
   * cannot read (resolveComputedValues only reads client_answer values and other
   * computed totals — a profile/document_extraction/ai_field operand would silently
   * contribute 0). Absent → the operand-source check is skipped.
   */
  questionSourceById?: ReadonlyMap<string, string>;
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
  // Give validateSourceRef the full id set + id→source map so a `computed` source can
  // be checked to reference only existing operand questions of a readable source.
  const ctxWithIds: VersionCtx = {
    ...ctx,
    questionIds: new Set(questions.map((q) => q.id)),
    questionSourceById: new Map(questions.map((q) => [q.id, q.source])),
  };

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
    issues.push(...validateSourceRef(q, ctxWithIds));
  }

  // (e2) computed graph must be acyclic (a multi-hop A→B→A cycle passes the per-question
  // self-reference check but would ship silent $0.00 totals).
  const computedCycle = findComputedCycle(questions);
  if (computedCycle) {
    issues.push(
      blocking("CATALOG_SOURCE_REF_INVALID", `ciclo de campos calculados: ${computedCycle.join(" → ")}.`),
    );
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
  // A select/multiselect question with a prefill knob (value_map / default_value)
  // must only ever produce values that exist among its options — anything else
  // would seed an impossible selection.
  const optionValueIssues = (): PublicationIssue[] => {
    if (q.field_type !== "select" && q.field_type !== "multiselect") return [];
    const optionValues = new Set(
      (Array.isArray(q.options) ? (q.options as Array<{ value?: unknown }>) : []).map((o) =>
        String(o?.value ?? ""),
      ),
    );
    if (optionValues.size === 0) return [];
    const ref = (q.source_ref ?? {}) as { value_map?: Record<string, string>; default_value?: string };
    const issues: PublicationIssue[] = [];
    for (const mapped of Object.values(ref.value_map ?? {})) {
      if (!optionValues.has(mapped)) {
        issues.push(
          blocking(
            "CATALOG_SOURCE_REF_INVALID",
            `value_map produce "${mapped}", que no es un value de las opciones de la pregunta.`,
          ),
        );
      }
    }
    if (ref.default_value !== undefined && !optionValues.has(ref.default_value)) {
      issues.push(
        blocking(
          "CATALOG_SOURCE_REF_INVALID",
          `default_value "${ref.default_value}" no es un value de las opciones de la pregunta.`,
        ),
      );
    }
    return issues;
  };

  switch (q.source) {
    case "client_answer":
      return optionValueIssues();
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
          ...optionValueIssues(),
        ];
      }
      return optionValueIssues();
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
    case "ai_field": {
      const ref = q.source_ref as
        | {
            connected?: { kind?: string; slug?: string; context_slugs?: string[] };
            instruction?: string;
          }
        | null;
      const slug = ref?.connected?.slug ?? "";
      const kind = ref?.connected?.kind;
      const contextSlugs = ref?.connected?.context_slugs ?? [];
      if (!slug || !ref?.instruction?.trim()) {
        return [
          blocking("CATALOG_SOURCE_REF_INVALID", "ai_field requiere connected.slug e instruction."),
        ];
      }
      if (kind === "document") {
        if (!ctx.allDocumentSlugs.includes(slug)) {
          return [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              `documento "${slug}" no es un requirement del servicio.`,
            ),
          ];
        }
        if (contextSlugs.includes(slug)) {
          return [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              "el documento principal no puede repetirse como documento de contexto.",
            ),
          ];
        }
        const badCtx = contextSlugs.filter((s) => !ctx.allDocumentSlugs.includes(s));
        return badCtx.length === 0
          ? []
          : [
              blocking(
                "CATALOG_SOURCE_REF_INVALID",
                `documento(s) de contexto "${badCtx.join('", "')}" no es/son requirement(s) del servicio.`,
              ),
            ];
      }
      if (kind === "ai_letter") {
        if (contextSlugs.length > 0) {
          return [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              "context_slugs solo aplica a conexiones de documento.",
            ),
          ];
        }
        return ctx.aiLetterSlugs.includes(slug)
          ? []
          : [
              blocking(
                "CATALOG_SOURCE_REF_INVALID",
                `carta "${slug}" no es un ai_letter del servicio.`,
              ),
            ];
      }
      return [blocking("CATALOG_SOURCE_REF_INVALID", `ai_field.connected.kind "${kind}" inválido.`)];
    }
    case "computed": {
      const ref = parseComputedSourceRef(q.source_ref);
      if (!ref) {
        return [
          blocking(
            "CATALOG_SOURCE_REF_INVALID",
            "computed requiere { op: 'sum'|'subtract', inputs: [questionId, …] }.",
          ),
        ];
      }
      // subtract is minuend − sum(rest): it needs at least two operands to mean a
      // subtraction (a 1-input copy should be expressed as `sum`).
      if (ref.op === "subtract" && ref.inputs.length < 2) {
        return [
          blocking("CATALOG_SOURCE_REF_INVALID", "computed 'subtract' requiere al menos 2 inputs."),
        ];
      }
      if (ref.inputs.includes(q.id)) {
        return [blocking("CATALOG_SOURCE_REF_INVALID", "una pregunta computed no puede referirse a sí misma.")];
      }
      // Operand existence (only when the full id set is available — i.e. at publish).
      if (ctx.questionIds) {
        const missing = ref.inputs.filter((id) => !ctx.questionIds!.has(id));
        if (missing.length > 0) {
          return [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              `computed referencia preguntas inexistentes: "${missing.join('", "')}".`,
            ),
          ];
        }
      }
      // Operand source: the evaluator (resolveComputedValues) only reads client_answer
      // values and other computed totals. A profile/document_extraction/ai_field operand
      // would silently contribute 0 → a wrong-but-plausible total. Reject it at publish.
      if (ctx.questionSourceById) {
        const badSource = ref.inputs.filter((id) => {
          const src = ctx.questionSourceById!.get(id);
          return src !== undefined && src !== "client_answer" && src !== "computed";
        });
        if (badSource.length > 0) {
          return [
            blocking(
              "CATALOG_SOURCE_REF_INVALID",
              `computed solo puede operar preguntas 'client_answer' o 'computed'; inválidas: "${badSource.join('", "')}".`,
            ),
          ];
        }
      }
      return [];
    }
    case "current_date":
      // No config to validate — today's date carries no slug/path/operands.
      return [];
    case "web_research": {
      const ref = q.source_ref as { system_prompt_template?: string } | null;
      const tpl = (ref?.system_prompt_template ?? "").trim();
      if (!tpl) {
        return [blocking("CATALOG_SOURCE_REF_INVALID", "web_research requiere system_prompt_template.")];
      }
      // The template must carry the {{INPUT}} token — otherwise the staff's query is
      // dropped and the model researches nothing in particular.
      if (!tpl.includes("{{INPUT}}")) {
        return [
          blocking(
            "CATALOG_SOURCE_REF_INVALID",
            "web_research.system_prompt_template debe incluir el token {{INPUT}}.",
          ),
        ];
      }
      return [];
    }
    case "field_copy": {
      const ref = q.source_ref as { form_slug?: string; target_question_id?: string } | null;
      if (!ref?.form_slug || !ref?.target_question_id) {
        return [
          blocking("CATALOG_SOURCE_REF_INVALID", "field_copy requiere form_slug y target_question_id."),
        ];
      }
      // A question cannot copy itself.
      if (ref.target_question_id === q.id) {
        return [blocking("CATALOG_SOURCE_REF_INVALID", "field_copy no puede copiarse a sí misma.")];
      }
      // The target form must belong to the service (checked only when the full slug
      // index is available — i.e. at publication). The target QUESTION id is version-
      // specific and cannot be checked cross-form here → a runtime pdf_field_name
      // fallback covers a re-published target (see resolveBySource).
      if (ctx.formSlugs && !ctx.formSlugs.includes(ref.form_slug)) {
        return [
          blocking(
            "CATALOG_SOURCE_REF_INVALID",
            `field_copy.form_slug "${ref.form_slug}" no es un formulario del servicio.`,
          ),
        ];
      }
      return [];
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
    accepted_format: doc.accepted_format,
    allow_multiple: doc.allow_multiple,
    position: doc.position,
  };
}

/**
 * Merges case_requirement_overrides onto the expanded catalog requirements.
 * DOC-40 §2.7.
 *
 * `includeHidden` toggles the audience:
 *  - omitted/false (client view): hidden requirements are removed entirely.
 *  - true (staff view): hidden requirements are kept, flagged `is_hidden=true`,
 *    so staff can see and restore them. Clients never receive these items.
 */
export function applyRequirementOverrides(
  expanded: ExpandedRequirement[],
  overrides: RequirementOverrideInput[],
  opts: { includeHidden?: boolean } = {},
): ExpandedRequirement[] {
  const { includeHidden = false } = opts;
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
        accepted_format: "pdf",
        allow_multiple: false,
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
      if (ov.is_hidden) {
        // Client view drops it; staff view keeps it flagged so it can be restored.
        return includeHidden
          ? [{ ...req, is_hidden: true, override_id: ov.id }]
          : [];
      }
      return [{ ...req, is_required: ov.is_required ?? req.is_required, override_id: ov.id }];
    });
  }

  return out.sort((a, b) => a.position - b.position);
}

/**
 * True when an override HIDES the given (required_document_type_id, party_id) combo.
 * Uses the SAME match rule as {@link applyRequirementOverrides} (an override with
 * `party_id === null` hides the requirement for EVERY party). Extracted so callers
 * that only need the boolean — e.g. the expediente assembler filtering an
 * already-fetched approved-documents list — don't have to re-expand the whole catalog
 * via getCaseRequirements. A custom override (`required_document_type_id === null`)
 * never hides a real uploaded document.
 */
export function isRequirementHiddenFor(
  overrides: Array<{
    required_document_type_id: string | null;
    party_id: string | null;
    is_hidden?: boolean | null;
  }>,
  requiredDocumentTypeId: string,
  partyId: string | null,
): boolean {
  return overrides.some(
    (ov) =>
      ov.is_hidden === true &&
      ov.required_document_type_id !== null &&
      ov.required_document_type_id === requiredDocumentTypeId &&
      (ov.party_id === null || ov.party_id === partyId),
  );
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

// ---------------------------------------------------------------------------
// Procedural posture (Wave 2 / D3) — config-as-data, evaluated deterministically
// ---------------------------------------------------------------------------

/**
 * How a case was actually decided, which governs what it is even possible to ask
 * the client about.
 *
 * Case U26-000038 was decided by PRETERMISSION — the judge granted DHS's motion
 * and never reached the merits. No credibility finding, no particular-social-group
 * analysis and no relocation analysis exist anywhere in the record. The question
 * generator, unaware of this, produced merits-appeal questions that were
 * unanswerable BY CONSTRUCTION, the drafting pass could not answer them, and the
 * old gap-filler papered over the hole. Naming the posture is what stops that at
 * the source.
 *
 * Deliberately narrow, so a declarative rule set cannot rot into a rules engine.
 * A posture may do exactly three things:
 *   1. add required source documents,
 *   2. inject a prompt fragment into the question playbook,
 *   3. set flags.
 * No priorities, no ordering, no nested logic — and detection reads STRUCTURED
 * extraction fields, never regex over raw_text.
 */
export type PostureOperator = "equals" | "not_equals" | "is_true" | "is_false" | "in";

export interface PostureCondition {
  /** Top-level key of the decision document's extraction payload. */
  field: string;
  op: PostureOperator;
  value?: unknown;
}

export interface PostureRule {
  slug: string;
  /** Flat AND. An empty list never matches — a catch-all posture is a bug. */
  conditions: PostureCondition[];
  /** Documents this posture makes mandatory (drives the hard source gate). */
  requiredSourceSlugs: string[];
  /** Extra instructions appended to the question-generation system prompt. */
  questionPlaybookPrompt: string | null;
}

function evalCondition(payload: Record<string, unknown>, c: PostureCondition): boolean {
  const present = Object.prototype.hasOwnProperty.call(payload, c.field);
  const actual = payload[c.field];
  switch (c.op) {
    case "equals":
      return present && actual === c.value;
    // Absence is not a value: an extraction that never produced the field cannot
    // be said to differ from anything.
    case "not_equals":
      return present && actual !== c.value;
    // Strict booleans only. `"false"` and `0` are extraction noise, not answers.
    case "is_true":
      return actual === true;
    case "is_false":
      return actual === false;
    case "in":
      return present && Array.isArray(c.value) && c.value.includes(actual);
    default:
      return false; // unknown operator → never matches
  }
}

/**
 * Picks the posture a decision's extraction payload satisfies.
 *
 * Precedence is SPECIFICITY (number of conditions), computed here in code —
 * never a priority column, which is how such tables become unmaintainable. Ties
 * break by slug so the same payload always yields the same posture across runs.
 * Returns null when nothing matches: the caller must surface "unknown posture",
 * never guess one.
 */
export function detectPosture(
  payload: Record<string, unknown>,
  rules: PostureRule[],
): PostureRule | null {
  const matches = rules.filter(
    (r) => r.conditions.length > 0 && r.conditions.every((c) => evalCondition(payload, c)),
  );
  if (matches.length === 0) return null;
  return matches.sort(
    (a, b) => b.conditions.length - a.conditions.length || a.slug.localeCompare(b.slug),
  )[0];
}
