/**
 * Integrations module — repository (data access layer).
 *
 * ALL reads and writes go through createServiceClient() (bypasses RLS).
 * The service layer is the single writer; authorization happens there first.
 *
 * @module integrations/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate, Json } from "@/shared/database.types";
import { LEGAL_VALIDATION_ACTIVE_STATUSES } from "./domain";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type LegalValidationRow = Tables<"legal_validations">;

/** Extended row that also carries the resolved org_id (from cases JOIN). */
export type LegalValidationWithOrg = LegalValidationRow & { org_id: string };

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

/**
 * Inserts a new legal_validation row.
 *
 * The org_id is NOT stored on the table itself; it is resolved from the
 * `cases` table when needed (claimWebhookEvent requires it).
 */
export async function insertValidation(
  input: TablesInsert<"legal_validations">,
): Promise<LegalValidationRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("legal_validations")
    .insert(input)
    .select()
    .single();
  if (error || !data)
    throw new Error(`integrations.repository: insertValidation — ${error?.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Finds the most recent ACTIVE validation for a case
 * (status ∈ pending | sent | queued | in_review).
 *
 * Used to block concurrent sends (DOC-70 §5).
 */
export async function findActiveValidation(
  caseId: string,
): Promise<LegalValidationRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("legal_validations")
    .select("*")
    .eq("case_id", caseId)
    .in("status", LEGAL_VALIDATION_ACTIVE_STATUSES as unknown as string[])
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Finds a validation by its external_validation_id (the SaaS-side id).
 * Returns the row with its org_id resolved via cases JOIN.
 */
export async function findByExternalValidationId(
  externalValidationId: string,
): Promise<LegalValidationWithOrg | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("legal_validations")
    .select("*, cases!inner(org_id)")
    .eq("external_validation_id", externalValidationId)
    .maybeSingle();
  if (!data) return null;

  const { cases, ...row } = data as LegalValidationRow & { cases: { org_id: string } };
  return { ...row, org_id: cases.org_id };
}

/**
 * Finds the most recent validation for a case (by attempt_no DESC).
 * Fallback lookup when external_validation_id is not yet known.
 */
export async function findLatestByCaseId(
  caseId: string,
): Promise<LegalValidationWithOrg | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("legal_validations")
    .select("*, cases!inner(org_id)")
    .eq("case_id", caseId)
    .order("attempt_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  const { cases, ...row } = data as LegalValidationRow & { cases: { org_id: string } };
  return { ...row, org_id: cases.org_id };
}

/**
 * Updates a legal_validation row.
 */
export async function updateValidation(
  id: string,
  patch: TablesUpdate<"legal_validations">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("legal_validations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error)
    throw new Error(`integrations.repository: updateValidation — ${error.message}`);
}

/**
 * Lists all validations for a case ordered by attempt_no DESC.
 */
export async function listValidationsForCase(
  caseId: string,
): Promise<LegalValidationRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("legal_validations")
    .select("*")
    .eq("case_id", caseId)
    .order("attempt_no", { ascending: false });
  if (error)
    throw new Error(`integrations.repository: listValidationsForCase — ${error.message}`);
  return data ?? [];
}

/** Filters for listValidations (staff UI). */
export interface ListValidationsFilters {
  caseId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Lists validations with optional filters (staff admin view).
 */
export async function listValidations(
  filters: ListValidationsFilters,
): Promise<LegalValidationRow[]> {
  const supabase = createServiceClient();
  let query = supabase
    .from("legal_validations")
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.caseId) query = query.eq("case_id", filters.caseId);
  if (filters.status) query = query.eq("status", filters.status);

  const pageSize = filters.pageSize ?? 20;
  const page = filters.page ?? 1;
  const offset = (page - 1) * pageSize;
  query = query.range(offset, offset + pageSize - 1);

  const { data, error } = await query;
  if (error)
    throw new Error(`integrations.repository: listValidations — ${error.message}`);
  return data ?? [];
}

/**
 * Lists rows eligible for polling:
 * status ∈ {sent, queued, in_review} AND sent_at < now - 24h.
 *
 * Uses the partial index `WHERE (status IN ('sent','queued','in_review'))`.
 * DOC-70 §6, DOC-26 §2.8.
 */
export async function listPollingCandidates(): Promise<LegalValidationWithOrg[]> {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("legal_validations")
    .select("*, cases!inner(org_id)")
    .in("status", ["sent", "queued", "in_review"])
    .lt("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(200); // safety cap — a single cron run won't process more than this

  if (error)
    throw new Error(`integrations.repository: listPollingCandidates — ${error.message}`);

  if (!data) return [];
  return data.map((row) => {
    const { cases, ...rest } = row as LegalValidationRow & { cases: { org_id: string } };
    return { ...rest, org_id: cases.org_id };
  });
}

// ---------------------------------------------------------------------------
// Case & expediente reads (cross-module shortcut via service client)
// These avoid importing from cases/expediente internal layers.
// ---------------------------------------------------------------------------

/** Finds a case by id (service-role read). Returns minimal fields. */
export async function findCaseById(caseId: string): Promise<{
  id: string;
  org_id: string;
  case_number: string;
  status: string;
  service_id: string;
  service_plan_id: string;
  primary_client_id: string;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("id, org_id, case_number, status, service_id, service_plan_id, primary_client_id")
    .eq("id", caseId)
    .maybeSingle();
  return data ?? null;
}

/** Returns kind ('self' | 'with_lawyer') for a service plan. */
export async function findPlanKind(planId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("service_plans")
    .select("kind")
    .eq("id", planId)
    .maybeSingle();
  return data?.kind ?? null;
}

/** Returns slug and label_i18n for a service. */
export async function findServiceForCase(serviceId: string): Promise<{
  slug: string;
  label_i18n: Json;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("services")
    .select("slug, label_i18n")
    .eq("id", serviceId)
    .maybeSingle();
  return data ?? null;
}

/** Returns first_name and last_name for the primary client of a case. */
export async function findClientProfile(userId: string): Promise<{
  first_name: string;
  last_name: string;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("client_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Returns expediente_items for an expediente, ordered by position. */
export async function findExpedienteWithItems(expedienteId: string): Promise<{
  expediente: { id: string; case_id: string; attempt_no: number; status: string } | null;
  items: Array<{
    id: string;
    position: number;
    title: string;
    item_type: string;
    page_count: number | null;
    ref_id: string | null;
    external_file_path: string | null;
    include_in_toc: boolean;
  }>;
}> {
  const supabase = createServiceClient();

  const { data: exp } = await supabase
    .from("expedientes")
    .select("id, case_id, attempt_no, status")
    .eq("id", expedienteId)
    .maybeSingle();

  if (!exp) return { expediente: null, items: [] };

  const { data: items, error } = await supabase
    .from("expediente_items")
    .select("id, position, title, item_type, page_count, ref_id, external_file_path, include_in_toc")
    .eq("expediente_id", expedienteId)
    .order("position", { ascending: true });

  if (error)
    throw new Error(`integrations.repository: findExpedienteWithItems — ${error.message}`);

  return {
    expediente: exp,
    items: (items ?? []).map((i) => ({
      id: i.id,
      position: i.position,
      title: i.title,
      item_type: i.item_type,
      page_count: i.page_count,
      ref_id: i.ref_id,
      external_file_path: i.external_file_path,
      include_in_toc: i.include_in_toc,
    })),
  };
}

/** Returns output_text for a completed ai_generation_run. */
export async function findGenerationOutputText(runId: string): Promise<{
  output_text: string | null;
  title: string | null;
  version: number | null;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_generation_runs")
    .select("output_text, version")
    .eq("id", runId)
    .eq("status", "completed")
    .maybeSingle();
  if (!data) return null;
  return {
    output_text: data.output_text,
    title: null, // resolved from expediente_item.title
    version: data.version,
  };
}

/** Returns raw_text from document_extractions for a case_document. */
export async function findDocumentExtractionText(caseDocumentId: string): Promise<{
  raw_text: string | null;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("document_extractions")
    .select("raw_text")
    .eq("case_document_id", caseDocumentId)
    .eq("status", "completed")
    .maybeSingle();
  return data ?? null;
}

/**
 * Updates expediente status — called by the integrations service to set
 * sent_to_lawyer, approved, corrections_needed, compiled, etc.
 *
 * Uses service_role (bypasses RLS) — authorization is enforced in service.ts.
 * This is the repository-level escape hatch for cross-module status writes
 * (DOC-70 §4.4, §7.2) where the expediente module does not expose a
 * status-transition public API for system actors.
 */
export async function updateExpedienteStatus(
  expedienteId: string,
  status: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("expedientes")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", expedienteId);
  if (error)
    throw new Error(`integrations.repository: updateExpedienteStatus — ${error.message}`);
}
