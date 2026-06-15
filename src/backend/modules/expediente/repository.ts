/**
 * Expediente module — repository (data access layer).
 *
 * ALL reads and writes go through createServiceClient() (bypasses RLS).
 * The service layer is the single writer; authorization happens there first.
 *
 * @module expediente/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

// ---------------------------------------------------------------------------
// Row types (re-exported for service layer)
// ---------------------------------------------------------------------------

export type ExpedienteRow = Tables<"expedientes">;
export type ExpedienteItemRow = Tables<"expediente_items">;
export type CoverTemplateRow = Tables<"cover_templates">;
export type CoverRenderRow = Tables<"cover_renders">;

// ---------------------------------------------------------------------------
// cover_templates
// ---------------------------------------------------------------------------

/** Lists active cover templates for an org. */
export async function listActiveCoverTemplates(
  orgId: string,
): Promise<CoverTemplateRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cover_templates")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(`expediente.repository: listActiveCoverTemplates — ${error.message}`);
  return data ?? [];
}

/** Finds a cover template by id. */
export async function findCoverTemplateById(
  id: string,
): Promise<CoverTemplateRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cover_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// cover_renders
// ---------------------------------------------------------------------------

/** Inserts a cover render row (immutable; re-render = new row). */
export async function insertCoverRender(
  input: TablesInsert<"cover_renders">,
): Promise<CoverRenderRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cover_renders")
    .insert(input)
    .select()
    .single();
  if (error || !data)
    throw new Error(`expediente.repository: insertCoverRender — ${error?.message}`);
  return data;
}

/** Lists all cover renders for a case (DESC by created_at). */
export async function listCoverRendersForCase(
  caseId: string,
): Promise<CoverRenderRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cover_renders")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`expediente.repository: listCoverRendersForCase — ${error.message}`);
  return data ?? [];
}

/** Finds a cover render by id (for logical FK validation). */
export async function findCoverRenderById(id: string): Promise<CoverRenderRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cover_renders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// expedientes
// ---------------------------------------------------------------------------

/** Finds an expediente by id. */
export async function findExpedienteById(
  id: string,
): Promise<ExpedienteRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("expedientes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Lists all expedientes for a case (DESC attempt_no). */
export async function listExpedientesForCase(
  caseId: string,
): Promise<ExpedienteRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expedientes")
    .select("*")
    .eq("case_id", caseId)
    .order("attempt_no", { ascending: false });
  if (error) throw new Error(`expediente.repository: listExpedientesForCase — ${error.message}`);
  return data ?? [];
}

/** Returns the maximum attempt_no for a case (0 if none). */
export async function maxAttemptNoForCase(caseId: string): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("expedientes")
    .select("attempt_no")
    .eq("case_id", caseId)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.attempt_no ?? 0;
}

/** Checks whether a draft expediente already exists for a case. */
export async function findDraftExpedienteForCase(
  caseId: string,
): Promise<ExpedienteRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("expedientes")
    .select("*")
    .eq("case_id", caseId)
    .eq("status", "draft")
    .maybeSingle();
  return data ?? null;
}

/** Inserts a new expediente. */
export async function insertExpediente(
  input: TablesInsert<"expedientes">,
): Promise<ExpedienteRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expedientes")
    .insert(input)
    .select()
    .single();
  if (error || !data)
    throw new Error(`expediente.repository: insertExpediente — ${error?.message}`);
  return data;
}

/** Updates an expediente. */
export async function updateExpediente(
  id: string,
  patch: TablesUpdate<"expedientes">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expedientes")
    .update(patch)
    .eq("id", id);
  if (error)
    throw new Error(`expediente.repository: updateExpediente — ${error.message}`);
}

// ---------------------------------------------------------------------------
// expediente_items
// ---------------------------------------------------------------------------

/** Lists all items for an expediente ordered by position ASC. */
export async function listItemsForExpediente(
  expedienteId: string,
): Promise<ExpedienteItemRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expediente_items")
    .select("*")
    .eq("expediente_id", expedienteId)
    .order("position", { ascending: true });
  if (error)
    throw new Error(`expediente.repository: listItemsForExpediente — ${error.message}`);
  return data ?? [];
}

/** Returns the maximum position for an expediente (0 if no items). */
export async function maxItemPositionForExpediente(
  expedienteId: string,
): Promise<number> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("expediente_items")
    .select("position")
    .eq("expediente_id", expedienteId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.position ?? 0;
}

/** Finds a single item by id. */
export async function findItemById(id: string): Promise<ExpedienteItemRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("expediente_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Inserts a new item. */
export async function insertItem(
  input: TablesInsert<"expediente_items">,
): Promise<ExpedienteItemRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expediente_items")
    .insert(input)
    .select()
    .single();
  if (error || !data)
    throw new Error(`expediente.repository: insertItem — ${error?.message}`);
  return data;
}

/** Deletes an item by id. */
export async function deleteItem(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expediente_items")
    .delete()
    .eq("id", id);
  if (error)
    throw new Error(`expediente.repository: deleteItem — ${error.message}`);
}

/** Updates an item's position. */
export async function updateItemPosition(
  id: string,
  position: number,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expediente_items")
    .update({ position })
    .eq("id", id);
  if (error)
    throw new Error(`expediente.repository: updateItemPosition — ${error.message}`);
}

/** Updates an item's page_count after compilation. */
export async function updateItemPageCount(
  id: string,
  pageCount: number,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expediente_items")
    .update({ page_count: pageCount })
    .eq("id", id);
  if (error)
    throw new Error(`expediente.repository: updateItemPageCount — ${error.message}`);
}

/** Updates an item's metadata (title, includeInToc). */
export async function updateItemMeta(
  id: string,
  patch: TablesUpdate<"expediente_items">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expediente_items")
    .update(patch)
    .eq("id", id);
  if (error)
    throw new Error(`expediente.repository: updateItemMeta — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Material library queries (getExpedienteMaterial)
// ---------------------------------------------------------------------------

/** Finds a cover render by id (used for logical FK validation in addItem). */
export async function verifyCoverRenderExists(id: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cover_renders")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  return data !== null;
}

/** Finds a completed ai_generation_run by id (returns its output_path). */
export async function findGenerationRunById(
  id: string,
): Promise<{ id: string; output_path: string | null; case_id: string; status: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_generation_runs")
    .select("id, output_path, case_id, status")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Finds a case_form_response by id (checks filled_pdf_path). */
export async function findFormResponseById(
  id: string,
): Promise<{ id: string; filled_pdf_path: string | null; case_id: string; status: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_form_responses")
    .select("id, filled_pdf_path, case_id, status")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Finds a case_document by id (for addItem logical FK + path resolution). */
export async function findCaseDocumentById(
  id: string,
): Promise<{ id: string; storage_path: string; case_id: string; status: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_documents")
    .select("id, storage_path, case_id, status")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

export interface MaterialCovers {
  refId: string;
  title: string;
  createdAt: string;
  pdfPath: string;
}

export interface MaterialGenerations {
  refId: string;
  title: string;
  createdAt: string;
  outputPath: string;
}

export interface MaterialForms {
  refId: string;
  title: string;
  createdAt: string;
  filledPdfPath: string;
}

export interface MaterialDocuments {
  refId: string;
  title: string;
  createdAt: string;
  storagePath: string;
}

/** Loads the library of addable items for a case (cover renders). */
export async function listCoverRendersForMaterial(
  caseId: string,
): Promise<MaterialCovers[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cover_renders")
    .select("id, pdf_path, created_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    refId: r.id,
    title: "Cover",
    createdAt: r.created_at,
    pdfPath: r.pdf_path,
  }));
}

/** Loads completed ai_generation_runs for a case. */
export async function listGenerationRunsForMaterial(
  caseId: string,
): Promise<MaterialGenerations[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_generation_runs")
    .select("id, output_path, created_at, form_definition_id")
    .eq("case_id", caseId)
    .eq("status", "completed")
    .not("output_path", "is", null)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r) => r.output_path !== null)
    .map((r) => ({
      refId: r.id,
      title: `Generation (form ${r.form_definition_id})`,
      createdAt: r.created_at,
      outputPath: r.output_path as string,
    }));
}

/** Loads case_form_responses with a filled PDF for a case. */
export async function listFormResponsesForMaterial(
  caseId: string,
): Promise<MaterialForms[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_form_responses")
    .select("id, filled_pdf_path, created_at")
    .eq("case_id", caseId)
    .not("filled_pdf_path", "is", null)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r) => r.filled_pdf_path !== null)
    .map((r) => ({
      refId: r.id,
      title: "Automated Form",
      createdAt: r.created_at,
      filledPdfPath: r.filled_pdf_path as string,
    }));
}

// ---------------------------------------------------------------------------
// Handoff to Andrium — plan lookup (sendToFinance gate)
// ---------------------------------------------------------------------------

/**
 * Returns whether the service plan for a case requires lawyer validation.
 * Reads cases → service_plan_id → service_plans.requires_lawyer_validation.
 * Uses service_role (no RLS) — called from sendToFinance which already ran can().
 *
 * Returns null if the case or plan row is missing (caller should treat as not found).
 */
export async function findCasePlanRequiresLawyerValidation(
  caseId: string,
): Promise<boolean | null> {
  const supabase = createServiceClient();
  const { data: caseRow } = await supabase
    .from("cases")
    .select("service_plan_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow?.service_plan_id) return null;

  const { data: planRow } = await supabase
    .from("service_plans")
    .select("requires_lawyer_validation")
    .eq("id", caseRow.service_plan_id)
    .maybeSingle();
  if (!planRow) return null;

  return planRow.requires_lawyer_validation ?? false;
}

/** Loads approved case_documents for a case. */
export async function listApprovedDocumentsForMaterial(
  caseId: string,
): Promise<MaterialDocuments[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_documents")
    .select("id, storage_path, original_filename, created_at")
    .eq("case_id", caseId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => ({
    refId: r.id,
    title: r.original_filename ?? "Document",
    createdAt: r.created_at,
    storagePath: r.storage_path,
  }));
}
