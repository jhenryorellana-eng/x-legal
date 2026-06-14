/**
 * Catalog repository — data access layer.
 *
 * ONLY this file touches Supabase for the catalog module.
 * Returns raw DB rows; domain parsing is done in service.ts.
 * Uses service client for all writes (the catalog tables require staff
 * permissions at the Postgres layer; service client bypasses RLS).
 *
 * DOC-40 §4.
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

// ---------------------------------------------------------------------------
// Row type aliases (keep DB types isolated to this file)
// ---------------------------------------------------------------------------

export type ServiceRow = Tables<"services">;
export type ServicePlanRow = Tables<"service_plans">;
export type ServicePhaseRow = Tables<"service_phases">;
export type MilestoneRow = Tables<"service_phase_milestones">;
export type PolicyRow = Tables<"phase_appointment_policies">;
export type RequiredDocRow = Tables<"required_document_types">;
export type FormDefinitionRow = Tables<"form_definitions">;
export type AutomationVersionRow = Tables<"form_automation_versions">;
export type QuestionGroupRow = Tables<"form_question_groups">;
export type QuestionRow = Tables<"form_questions">;
export type GenerationConfigRow = Tables<"ai_generation_configs">;
export type DatasetRow = Tables<"ai_datasets">;
export type DatasetItemRow = Tables<"ai_dataset_items">;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function db() {
  return createServiceClient();
}

function throwOnError<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`catalog.repo.${context}: ${error.message}`);
  if (data === null) throw new Error(`catalog.repo.${context}: no data returned`);
  return data;
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function insertService(
  row: TablesInsert<"services">,
): Promise<ServiceRow> {
  const { data, error } = await db()
    .from("services")
    .insert(row)
    .select()
    .single();
  return throwOnError(data, error, "insertService");
}

export async function findServiceById(id: string): Promise<ServiceRow | null> {
  const { data } = await db().from("services").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function updateService(
  id: string,
  patch: TablesUpdate<"services">,
): Promise<ServiceRow> {
  const { data, error } = await db()
    .from("services")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateService");
}

export async function slugExists(orgId: string, slug: string): Promise<boolean> {
  const { data } = await db()
    .from("services")
    .select("id")
    .eq("org_id", orgId)
    .eq("slug", slug)
    .maybeSingle();
  return data !== null;
}

/**
 * Counts cases referencing a service (slug lock, RF-ADM-020 E1).
 * TODO(F2): move behind the cases module index once it exists. Direct table
 * read here because the cases MODULE is F2 while the table exists since 0004.
 * Fail-closed: on error returns 1 (locks the slug — renames are retryable).
 */
export async function countCasesReferencingService(serviceId: string): Promise<number> {
  const { count, error } = await db()
    .from("cases")
    .select("id", { count: "exact", head: true })
    .eq("service_id", serviceId);
  if (error || count == null) return 1; // fail-closed
  return count;
}

export async function listServicesForEditor(
  orgId: string,
  opts: { include_archived?: boolean } = {},
): Promise<ServiceRow[]> {
  let q = db().from("services").select("*").eq("org_id", orgId).order("position");
  if (!opts.include_archived) q = q.is("archived_at", null);
  const { data, error } = await q;
  if (error) throw new Error(`catalog.repo.listServicesForEditor: ${error.message}`);
  return data ?? [];
}

export async function reorderServicesTx(orgId: string, orderedIds: string[]): Promise<void> {
  // Batch update positions (no UNIQUE on services.position yet — P-40-6)
  const updates = orderedIds.map((id, idx) =>
    db().from("services").update({ position: idx }).eq("id", id).eq("org_id", orgId),
  );
  await Promise.all(updates);
}

export async function listContractableServicesFromDb(orgId: string): Promise<ServiceRow[]> {
  const { data, error } = await db()
    .from("services")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("position");
  if (error) throw new Error(`catalog.repo.listContractableServices: ${error.message}`);
  return data ?? [];
}

export async function getPublicCatalogFromDb(orgId: string) {
  const { data, error } = await db()
    .from("services")
    .select(`id, slug, category, label_i18n, description_i18n, icon, color, position,
             service_plans(kind, price_cents, currency, is_active)`)
    .eq("org_id", orgId)
    .eq("is_active", true)
    .eq("is_public", true)
    .is("archived_at", null)
    .order("position");
  if (error) throw new Error(`catalog.repo.getPublicCatalog: ${error.message}`);
  return data ?? [];
}

export async function getServiceDetailBySlugFromDb(orgId: string, slug: string) {
  const { data, error } = await db()
    .from("services")
    .select(`*,
             service_plans(*),
             service_phases(id, slug, label_i18n, description_i18n, client_explainer_i18n, position,
               service_phase_milestones(slug, label_i18n, glossary_i18n, icon, position))`)
    .eq("org_id", orgId)
    .eq("slug", slug)
    .single();
  if (error) throw new Error(`catalog.repo.getServiceDetailBySlug: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function listPlans(serviceId: string): Promise<ServicePlanRow[]> {
  const { data, error } = await db()
    .from("service_plans")
    .select("*")
    .eq("service_id", serviceId);
  if (error) throw new Error(`catalog.repo.listPlans: ${error.message}`);
  return data ?? [];
}

export async function upsertPlanByKind(
  row: TablesInsert<"service_plans"> & { id?: string },
): Promise<ServicePlanRow> {
  const { data, error } = await db()
    .from("service_plans")
    .upsert(row, { onConflict: "service_id,kind" })
    .select()
    .single();
  return throwOnError(data, error, "upsertPlanByKind");
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export async function listPhases(serviceId: string): Promise<ServicePhaseRow[]> {
  const { data, error } = await db()
    .from("service_phases")
    .select("*")
    .eq("service_id", serviceId)
    .order("position");
  if (error) throw new Error(`catalog.repo.listPhases: ${error.message}`);
  return data ?? [];
}

export async function findPhaseById(id: string): Promise<ServicePhaseRow | null> {
  const { data } = await db().from("service_phases").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function insertPhase(row: TablesInsert<"service_phases">): Promise<ServicePhaseRow> {
  const { data, error } = await db().from("service_phases").insert(row).select().single();
  return throwOnError(data, error, "insertPhase");
}

export async function updatePhase(
  id: string,
  patch: TablesUpdate<"service_phases">,
): Promise<ServicePhaseRow> {
  const { data, error } = await db()
    .from("service_phases")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updatePhase");
}

export async function deletePhase(phaseId: string): Promise<void> {
  const { error } = await db().from("service_phases").delete().eq("id", phaseId);
  if (error) throw error; // caller maps FK violation
}

export async function phaseSlugExists(serviceId: string, slug: string): Promise<boolean> {
  const { data } = await db()
    .from("service_phases")
    .select("id")
    .eq("service_id", serviceId)
    .eq("slug", slug)
    .maybeSingle();
  return data !== null;
}

export async function nextPhasePosition(serviceId: string): Promise<number> {
  const { data } = await db()
    .from("service_phases")
    .select("position")
    .eq("service_id", serviceId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? -1) + 1;
}

export async function reorderPhasesTx(serviceId: string, orderedIds: string[]): Promise<void> {
  const updates = orderedIds.map((id, idx) =>
    db()
      .from("service_phases")
      .update({ position: idx })
      .eq("id", id)
      .eq("service_id", serviceId),
  );
  await Promise.all(updates);
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export async function listMilestones(phaseId: string): Promise<MilestoneRow[]> {
  const { data, error } = await db()
    .from("service_phase_milestones")
    .select("*")
    .eq("service_phase_id", phaseId)
    .order("position");
  if (error) throw new Error(`catalog.repo.listMilestones: ${error.message}`);
  return data ?? [];
}

export async function insertMilestone(
  row: TablesInsert<"service_phase_milestones">,
): Promise<MilestoneRow> {
  const { data, error } = await db()
    .from("service_phase_milestones")
    .insert(row)
    .select()
    .single();
  return throwOnError(data, error, "insertMilestone");
}

export async function updateMilestone(
  id: string,
  patch: TablesUpdate<"service_phase_milestones">,
): Promise<MilestoneRow> {
  const { data, error } = await db()
    .from("service_phase_milestones")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateMilestone");
}

export async function deleteMilestone(id: string): Promise<void> {
  const { error } = await db().from("service_phase_milestones").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Phase appointment policy
// ---------------------------------------------------------------------------

export async function upsertPhasePolicy(
  row: TablesInsert<"phase_appointment_policies">,
): Promise<PolicyRow> {
  const { data, error } = await db()
    .from("phase_appointment_policies")
    .upsert(row, { onConflict: "service_phase_id" })
    .select()
    .single();
  return throwOnError(data, error, "upsertPhasePolicy");
}

export async function findPhasePolicy(phaseId: string): Promise<PolicyRow | null> {
  const { data } = await db()
    .from("phase_appointment_policies")
    .select("*")
    .eq("service_phase_id", phaseId)
    .maybeSingle();
  return data;
}

// ---------------------------------------------------------------------------
// Required documents
// ---------------------------------------------------------------------------

export async function listRequiredDocs(phaseId: string): Promise<RequiredDocRow[]> {
  const { data, error } = await db()
    .from("required_document_types")
    .select("*")
    .eq("service_phase_id", phaseId)
    .eq("is_active", true)
    .order("position");
  if (error) throw new Error(`catalog.repo.listRequiredDocs: ${error.message}`);
  return data ?? [];
}

export async function insertRequiredDocument(
  row: TablesInsert<"required_document_types">,
): Promise<RequiredDocRow> {
  const { data, error } = await db()
    .from("required_document_types")
    .insert(row)
    .select()
    .single();
  return throwOnError(data, error, "insertRequiredDocument");
}

export async function updateRequiredDocument(
  id: string,
  patch: TablesUpdate<"required_document_types">,
): Promise<RequiredDocRow> {
  const { data, error } = await db()
    .from("required_document_types")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateRequiredDocument");
}

export async function requiredDocSlugExists(phaseId: string, slug: string): Promise<boolean> {
  const { data } = await db()
    .from("required_document_types")
    .select("id")
    .eq("service_phase_id", phaseId)
    .eq("slug", slug)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Form definitions
// ---------------------------------------------------------------------------

export async function listFormDefinitions(phaseId: string): Promise<FormDefinitionRow[]> {
  const { data, error } = await db()
    .from("form_definitions")
    .select("*")
    .eq("service_phase_id", phaseId)
    .eq("is_active", true)
    .order("position");
  if (error) throw new Error(`catalog.repo.listFormDefinitions: ${error.message}`);
  return data ?? [];
}

export async function findFormDefinition(id: string): Promise<FormDefinitionRow | null> {
  const { data } = await db().from("form_definitions").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function insertFormDefinition(
  row: TablesInsert<"form_definitions">,
): Promise<FormDefinitionRow> {
  const { data, error } = await db().from("form_definitions").insert(row).select().single();
  return throwOnError(data, error, "insertFormDefinition");
}

export async function updateFormDefinition(
  id: string,
  patch: TablesUpdate<"form_definitions">,
): Promise<FormDefinitionRow> {
  const { data, error } = await db()
    .from("form_definitions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateFormDefinition");
}

export async function formSlugExists(phaseId: string, slug: string): Promise<boolean> {
  const { data } = await db()
    .from("form_definitions")
    .select("id")
    .eq("service_phase_id", phaseId)
    .eq("slug", slug)
    .maybeSingle();
  return data !== null;
}

// ---------------------------------------------------------------------------
// Automation versions
// ---------------------------------------------------------------------------

export async function listVersions(formDefinitionId: string): Promise<AutomationVersionRow[]> {
  const { data, error } = await db()
    .from("form_automation_versions")
    .select("*")
    .eq("form_definition_id", formDefinitionId)
    .order("version");
  if (error) throw new Error(`catalog.repo.listVersions: ${error.message}`);
  return data ?? [];
}

export async function insertAutomationVersion(
  row: TablesInsert<"form_automation_versions">,
): Promise<AutomationVersionRow> {
  const { data, error } = await db()
    .from("form_automation_versions")
    .insert(row)
    .select()
    .single();
  return throwOnError(data, error, "insertAutomationVersion");
}

export async function updateVersion(
  id: string,
  patch: TablesUpdate<"form_automation_versions">,
): Promise<AutomationVersionRow> {
  const { data, error } = await db()
    .from("form_automation_versions")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateVersion");
}

export async function findVersionById(id: string): Promise<AutomationVersionRow | null> {
  const { data } = await db()
    .from("form_automation_versions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function getPublishedVersion(
  formDefinitionId: string,
): Promise<AutomationVersionRow | null> {
  const { data } = await db()
    .from("form_automation_versions")
    .select("*")
    .eq("form_definition_id", formDefinitionId)
    .eq("status", "published")
    .maybeSingle();
  return data;
}

export async function getAutomationVersionById(
  versionId: string,
): Promise<AutomationVersionRow | null> {
  const { data } = await db()
    .from("form_automation_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  return data;
}

/**
 * Atomically transitions the current published version to archived, and
 * the given draft version to published. Uses an RPC to ensure the transition
 * is transactional (DOC-40 §4.4).
 *
 * If no RPC exists yet, falls back to a two-step update (slightly less safe;
 * the partial unique index on BD is the final guard).
 */
export async function publishVersionTx(versionId: string): Promise<void> {
  const client = createServiceClient();

  // Try the RPC first (catalog_publish_version — migration §4.4)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: rpcError } = await (client.rpc as any)("catalog_publish_version", {
    p_version_id: versionId,
  });

  if (rpcError) {
    // If RPC doesn't exist yet (migration not applied), do a manual two-step.
    // The partial unique index `unique(form_definition_id) where status='published'`
    // will catch concurrent publishes with a unique violation.
    logger.warn({ versionId, rpcError: rpcError.message }, "catalog: catalog_publish_version RPC unavailable — falling back to two-step update");
    const row = await findVersionById(versionId);
    if (!row) throw new Error("CATALOG_VERSION_NOT_FOUND");

    // Archive current published
    await client
      .from("form_automation_versions")
      .update({ status: "archived" })
      .eq("form_definition_id", row.form_definition_id)
      .eq("status", "published");

    // Publish this version
    const { error } = await client
      .from("form_automation_versions")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", versionId)
      .eq("status", "draft");

    if (error) throw new Error(`CATALOG_PUBLISH_CONFLICT: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Question groups + questions
// ---------------------------------------------------------------------------

export async function listQuestionGroups(versionId: string): Promise<QuestionGroupRow[]> {
  const { data, error } = await db()
    .from("form_question_groups")
    .select("*")
    .eq("automation_version_id", versionId)
    .order("position");
  if (error) throw new Error(`catalog.repo.listQuestionGroups: ${error.message}`);
  return data ?? [];
}

export async function listQuestions(groupId: string): Promise<QuestionRow[]> {
  const { data, error } = await db()
    .from("form_questions")
    .select("*")
    .eq("group_id", groupId)
    .order("position");
  if (error) throw new Error(`catalog.repo.listQuestions: ${error.message}`);
  return data ?? [];
}

export async function upsertQuestionGroup(
  row: TablesInsert<"form_question_groups"> & { id?: string },
): Promise<QuestionGroupRow> {
  const { data, error } = await db()
    .from("form_question_groups")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  return throwOnError(data, error, "upsertQuestionGroup");
}

export async function deleteQuestionGroup(groupId: string): Promise<void> {
  const { error } = await db().from("form_question_groups").delete().eq("id", groupId);
  if (error) throw error;
}

export async function upsertQuestion(
  row: TablesInsert<"form_questions"> & { id?: string },
): Promise<QuestionRow> {
  const { data, error } = await db()
    .from("form_questions")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();
  return throwOnError(data, error, "upsertQuestion");
}

export async function deleteQuestion(questionId: string): Promise<void> {
  const { error } = await db().from("form_questions").delete().eq("id", questionId);
  if (error) throw error;
}

export async function findVersionByGroup(groupId: string): Promise<AutomationVersionRow | null> {
  const { data: group } = await db()
    .from("form_question_groups")
    .select("automation_version_id")
    .eq("id", groupId)
    .maybeSingle();
  if (!group) return null;
  return findVersionById(group.automation_version_id);
}

/** Resolves the automation version that owns a given question (via its group). */
export async function findVersionByQuestion(questionId: string): Promise<AutomationVersionRow | null> {
  const { data: question } = await db()
    .from("form_questions")
    .select("group_id")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return null;
  return findVersionByGroup(question.group_id);
}

// ---------------------------------------------------------------------------
// Generation configs
// ---------------------------------------------------------------------------

export async function findGenerationConfig(
  formDefinitionId: string,
): Promise<GenerationConfigRow | null> {
  const { data } = await db()
    .from("ai_generation_configs")
    .select("*")
    .eq("form_definition_id", formDefinitionId)
    .maybeSingle();
  return data;
}

export async function upsertGenerationConfig(
  row: TablesInsert<"ai_generation_configs">,
): Promise<GenerationConfigRow> {
  const { data, error } = await db()
    .from("ai_generation_configs")
    .upsert(row, { onConflict: "form_definition_id" })
    .select()
    .single();
  return throwOnError(data, error, "upsertGenerationConfig");
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------

export async function listDatasets(orgId: string): Promise<DatasetRow[]> {
  const { data, error } = await db()
    .from("ai_datasets")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`catalog.repo.listDatasets: ${error.message}`);
  return data ?? [];
}

export async function findDataset(id: string): Promise<DatasetRow | null> {
  const { data } = await db().from("ai_datasets").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function insertDataset(row: TablesInsert<"ai_datasets">): Promise<DatasetRow> {
  const { data, error } = await db().from("ai_datasets").insert(row).select().single();
  return throwOnError(data, error, "insertDataset");
}

export async function updateDataset(
  id: string,
  patch: TablesUpdate<"ai_datasets">,
): Promise<DatasetRow> {
  const { data, error } = await db()
    .from("ai_datasets")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateDataset");
}

export async function findDatasetItem(id: string): Promise<DatasetItemRow | null> {
  const { data } = await db().from("ai_dataset_items").select("*").eq("id", id).maybeSingle();
  return data;
}

export async function insertDatasetItem(
  row: TablesInsert<"ai_dataset_items">,
): Promise<DatasetItemRow> {
  const { data, error } = await db().from("ai_dataset_items").insert(row).select().single();
  return throwOnError(data, error, "insertDatasetItem");
}

export async function updateDatasetItem(
  id: string,
  patch: TablesUpdate<"ai_dataset_items">,
): Promise<DatasetItemRow> {
  const { data, error } = await db()
    .from("ai_dataset_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  return throwOnError(data, error, "updateDatasetItem");
}

export async function deleteDataset(id: string): Promise<void> {
  const { error } = await db().from("ai_datasets").delete().eq("id", id);
  if (error) throw error; // caller maps FK violation to CATALOG_DATASET_IN_USE
}

export async function deleteDatasetItem(id: string): Promise<void> {
  const { error } = await db().from("ai_dataset_items").delete().eq("id", id);
  if (error) throw error;
}

/** Lists every item of a dataset (admin detail view, RF-ADM-039). */
export async function listDatasetItems(datasetId: string): Promise<DatasetItemRow[]> {
  const { data, error } = await db()
    .from("ai_dataset_items")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`catalog.repo.listDatasetItems: ${error.message}`);
  return data ?? [];
}

/** Counts the generation configs that inject a given dataset (RF-ADM-040 "Usado por"). */
export async function countDatasetUsage(datasetId: string): Promise<number> {
  const { count, error } = await db()
    .from("ai_generation_configs")
    .select("form_definition_id", { count: "exact", head: true })
    .eq("dataset_id", datasetId);
  if (error) throw new Error(`catalog.repo.countDatasetUsage: ${error.message}`);
  return count ?? 0;
}

/** Lists the generation configs that reference a dataset, enriched for the "Usos" tab. */
export async function listDatasetUsage(
  datasetId: string,
): Promise<Array<{ formId: string; formSlug: string; phaseId: string }>> {
  const { data, error } = await db()
    .from("ai_generation_configs")
    .select("form_definition_id, form_definitions(slug, service_phase_id)")
    .eq("dataset_id", datasetId);
  if (error) throw new Error(`catalog.repo.listDatasetUsage: ${error.message}`);
  return (data ?? []).map((r) => {
    const fd = (r as { form_definitions?: { slug?: string; service_phase_id?: string } })
      .form_definitions;
    return {
      formId: r.form_definition_id as string,
      formSlug: fd?.slug ?? "",
      phaseId: fd?.service_phase_id ?? "",
    };
  });
}

// ---------------------------------------------------------------------------
// getPhaseCatalog — runtime resolver
// ---------------------------------------------------------------------------

export interface PhaseCatalog {
  phase: ServicePhaseRow;
  milestones: MilestoneRow[];
  policy: PolicyRow | null;
  docs: RequiredDocRow[];
  forms: FormDefinitionRow[];
}

export async function getPhaseCatalog(phaseId: string): Promise<PhaseCatalog | null> {
  const { data: phase, error } = await db()
    .from("service_phases")
    .select("*")
    .eq("id", phaseId)
    .maybeSingle();
  if (error) throw new Error(`catalog.repo.getPhaseCatalog: ${error.message}`);
  if (!phase) return null;

  const [milestones, policy, docs, forms] = await Promise.all([
    db()
      .from("service_phase_milestones")
      .select("*")
      .eq("service_phase_id", phaseId)
      .order("position")
      .then((r) => r.data ?? []),
    db()
      .from("phase_appointment_policies")
      .select("*")
      .eq("service_phase_id", phaseId)
      .maybeSingle()
      .then((r) => r.data),
    db()
      .from("required_document_types")
      .select("*")
      .eq("service_phase_id", phaseId)
      .eq("is_active", true)
      .order("position")
      .then((r) => r.data ?? []),
    db()
      .from("form_definitions")
      .select("*")
      .eq("service_phase_id", phaseId)
      .eq("is_active", true)
      .order("position")
      .then((r) => r.data ?? []),
  ]);

  return { phase, milestones, policy, docs, forms };
}

// ---------------------------------------------------------------------------
// getServiceSlugIndex — for source_ref validation
// ---------------------------------------------------------------------------

export interface ServiceSlugIndex {
  documents: string[];
  documentsWithSchema: Record<string, object | null>;
  forms: string[];
  aiLetterSlugs: string[];
}

export async function getServiceSlugIndex(serviceId: string): Promise<ServiceSlugIndex> {
  const phases = await listPhases(serviceId);
  const phaseIds = phases.map((p) => p.id);

  if (phaseIds.length === 0) {
    return { documents: [], documentsWithSchema: {}, forms: [], aiLetterSlugs: [] };
  }

  const [docs, forms] = await Promise.all([
    db()
      .from("required_document_types")
      .select("slug, ai_extract, extraction_schema")
      .in("service_phase_id", phaseIds)
      .then((r) => r.data ?? []),
    db()
      .from("form_definitions")
      .select("slug, kind")
      .in("service_phase_id", phaseIds)
      .then((r) => r.data ?? []),
  ]);

  const documentsWithSchema: Record<string, object | null> = {};
  for (const d of docs) {
    if (d.ai_extract) {
      documentsWithSchema[d.slug] = (d.extraction_schema as object | null) ?? null;
    }
  }

  return {
    documents: docs.map((d) => d.slug),
    documentsWithSchema,
    forms: forms.map((f) => f.slug),
    aiLetterSlugs: forms.filter((f) => f.kind === "ai_letter").map((f) => f.slug),
  };
}

// ---------------------------------------------------------------------------
// getVersionTree — for publishVersion + preview
// ---------------------------------------------------------------------------

export interface VersionTree {
  version: AutomationVersionRow;
  groups: (QuestionGroupRow & { questions: QuestionRow[] })[];
  questions: QuestionRow[];
}

export async function getVersionTree(versionId: string): Promise<VersionTree | null> {
  const version = await findVersionById(versionId);
  if (!version) return null;

  const groups = await listQuestionGroups(versionId);
  const allQuestions: QuestionRow[] = [];
  const hydratedGroups = await Promise.all(
    groups.map(async (g) => {
      const qs = await listQuestions(g.id);
      allQuestions.push(...qs);
      return { ...g, questions: qs };
    }),
  );

  return { version, groups: hydratedGroups, questions: allQuestions };
}
