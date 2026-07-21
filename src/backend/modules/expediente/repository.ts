/**
 * Expediente module — repository (data access layer).
 *
 * ALL reads and writes go through createServiceClient() (bypasses RLS).
 * The service layer is the single writer; authorization happens there first.
 *
 * @module expediente/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { deleteObject } from "@/backend/platform/storage";
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
  /** The party this cover is for (per-party covers), if any. */
  partyId: string | null;
}

export interface MaterialGenerations {
  refId: string;
  title: string;
  createdAt: string;
  outputPath: string;
  partyId: string | null;
  /** Raw grouping keys so the service can keep only the CURRENT run per (form, party). */
  formDefinitionId: string;
  version: number;
}

export interface MaterialForms {
  refId: string;
  title: string;
  createdAt: string;
  filledPdfPath: string;
  partyId: string | null;
}

/** Resolves the Spanish-first label from a form_definitions join (or a fallback). */
function formLabelFromJoin(fd: unknown, fallback: string): string {
  const label = (fd as { label_i18n?: { es?: string; en?: string } } | null)?.label_i18n;
  return label?.es || label?.en || fallback;
}

export interface MaterialDocuments {
  refId: string;
  title: string;
  createdAt: string;
  storagePath: string;
  /** Semantic display name typed by the client (falls back to original_filename). */
  displayName: string | null;
  originalFilename: string;
  /** The party this upload belongs to (may be null on multi-file / unassigned slots). */
  partyId: string | null;
  /** Requirement label (i18n) for the slot this document was uploaded to. */
  requirementLabel: { es: string; en: string } | null;
}

/** Loads the library of addable items for a case (cover renders). */
export async function listCoverRendersForMaterial(
  caseId: string,
): Promise<MaterialCovers[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cover_renders")
    .select("id, pdf_path, created_at, data")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => {
    const d = (r.data ?? {}) as { title?: unknown; partyId?: unknown };
    return {
      refId: r.id,
      title: typeof d.title === "string" && d.title.trim() ? d.title : "Carátula",
      createdAt: r.created_at,
      pdfPath: r.pdf_path,
      partyId: typeof d.partyId === "string" ? d.partyId : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Translations + cover deletion (AI assembly + cover edit/delete)
// ---------------------------------------------------------------------------

/** Completed translations for a case, keyed for attaching to their source doc. */
export async function listCompletedTranslationsForCase(
  caseId: string,
): Promise<Array<{ translationId: string; caseDocumentId: string; translatedPdfPath: string }>> {
  const supabase = createServiceClient();
  // document_translations has no case_id; join through case_documents.
  const { data } = await supabase
    .from("document_translations")
    .select("id, case_document_id, translated_pdf_path, status, case_documents!inner(case_id)")
    .eq("status", "completed")
    .not("translated_pdf_path", "is", null)
    .eq("case_documents.case_id", caseId);
  return (data ?? [])
    .filter((r) => r.translated_pdf_path !== null)
    .map((r) => ({
      translationId: r.id,
      caseDocumentId: r.case_document_id,
      translatedPdfPath: r.translated_pdf_path as string,
    }));
}

/** Finds a translation by id (for resolveItemBytes of 'translation' items). */
export async function findTranslationById(
  id: string,
): Promise<{ id: string; translated_pdf_path: string | null } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("document_translations")
    .select("id, translated_pdf_path")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Finds an exhibit by id (for ref validation + resolveItemBytes of 'exhibit' items). */
export async function findExhibitById(
  id: string,
): Promise<{ id: string; pdf_path: string | null; status: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_exhibits")
    .select("id, pdf_path, status")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Counts how many expediente_items reference a given cover render. */
export async function countCoverItemRefs(coverRenderId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count } = await supabase
    .from("expediente_items")
    .select("id", { count: "exact", head: true })
    .eq("item_type", "cover")
    .eq("ref_id", coverRenderId);
  return count ?? 0;
}

/** Deletes a cover render (only call when no expediente_item references it).
 *  Also removes the rendered cover PDF from the 'generated' bucket so we don't
 *  leave orphaned files behind (best-effort — never blocks the row delete). */
export async function deleteCoverRender(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("cover_renders")
    .select("pdf_path")
    .eq("id", id)
    .maybeSingle();
  if (row?.pdf_path) await deleteObject("generated", row.pdf_path);
  const { error } = await supabase.from("cover_renders").delete().eq("id", id);
  if (error) throw new Error(`expediente.repository: deleteCoverRender — ${error.message}`);
}

/** Loads completed ai_generation_runs for a case. */
export async function listGenerationRunsForMaterial(
  caseId: string,
): Promise<MaterialGenerations[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("ai_generation_runs")
    .select("id, output_path, created_at, party_id, version, form_definition_id, form_definitions(label_i18n)")
    .eq("case_id", caseId)
    .eq("status", "completed")
    .not("output_path", "is", null)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r) => r.output_path !== null)
    .map((r) => ({
      refId: r.id,
      title: formLabelFromJoin(r.form_definitions, "Carta generada"),
      createdAt: r.created_at,
      outputPath: r.output_path as string,
      partyId: r.party_id ?? null,
      formDefinitionId: r.form_definition_id,
      version: r.version,
    }));
}

/** Loads case_form_responses with a filled PDF for a case. */
export async function listFormResponsesForMaterial(
  caseId: string,
): Promise<MaterialForms[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_form_responses")
    .select("id, filled_pdf_path, created_at, party_id, form_definitions(label_i18n)")
    .eq("case_id", caseId)
    .not("filled_pdf_path", "is", null)
    .order("created_at", { ascending: false });
  return (data ?? [])
    .filter((r) => r.filled_pdf_path !== null)
    .map((r) => ({
      refId: r.id,
      title: formLabelFromJoin(r.form_definitions, "Formulario"),
      createdAt: r.created_at,
      filledPdfPath: r.filled_pdf_path as string,
      partyId: r.party_id ?? null,
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

// ---------------------------------------------------------------------------
// Print queue — Andrium panel (API-EXP-18, RF-AND-023)
// ---------------------------------------------------------------------------

export interface PrintQueueItemRepo {
  expedienteId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  serviceLabel: { es: string; en: string } | null;
  attemptNo: number;
  pageCount: number | null;
  status: string;
  sentToFinanceAt: string | null;
  sentByName: string | null;
  withLawyer: boolean;
  shippedAt: string | null;
  filedAt: string | null;
  trackingRef: string | null;
  hasPdf: boolean;
}

/**
 * Returns expedientes in the Andrium print queue for an org.
 * Status filter: sent_to_finance | printed (both if not provided).
 * Ordered by sent_to_finance_at ASC (FIFO queue).
 *
 * RF-AND-023 / DOC-45 §3.9 / API-EXP-18.
 * Uses service_role — caller (listPrintQueue) already ran can('printing','view').
 */
export async function listPrintQueue(
  orgId: string,
  statusFilter?: string,
): Promise<PrintQueueItemRepo[]> {
  const supabase = createServiceClient();

  // Build the select: expedientes → cases → case_members→users→client_profiles,
  // services, service_plans, staff_profiles (for sentBy). The client name path
  // mirrors the working billing repo join (cases.primary_client_id has no FK to
  // client_profiles, so we resolve via case_members → users → client_profiles).
  const selectStr = `
    id, attempt_no, page_count, status, compiled_pdf_path,
    sent_to_finance_at, shipped_at, filed_at, tracking_ref,
    cases!inner(
      id, case_number, org_id,
      case_members(
        user_id,
        users!inner(kind, is_active, client_profiles(first_name, last_name))
      ),
      services(label_i18n),
      service_plans(requires_lawyer_validation)
    ),
    sent_by:staff_profiles!expedientes_sent_to_finance_by_fkey(display_name)
  `;

  // LOW note: `.eq("cases.org_id", orgId)` with a LEFT JOIN is unreliable in
  // PostgREST — cases!inner above makes it an INNER JOIN so the filter is
  // effective at the DB level. The JS `.filter()` in the mapping below is the
  // authoritative defense-in-depth guarantee — do not remove it.
  let query = supabase
    .from("expedientes")
    .select(selectStr)
    .eq("cases.org_id", orgId)
    .order("sent_to_finance_at", { ascending: true });

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  } else {
    query = query.in("status", ["sent_to_finance", "printed"]);
  }

  const { data, error } = await query;
  if (error) throw new Error(`expediente.repository: listPrintQueue — ${error.message}`);

  type RawRow = {
    id: string;
    attempt_no: number;
    page_count: number | null;
    status: string;
    compiled_pdf_path: string | null;
    sent_to_finance_at: string | null;
    shipped_at: string | null;
    filed_at: string | null;
    tracking_ref: string | null;
    cases: {
      id: string;
      case_number: string;
      org_id: string;
      case_members: Array<{
        user_id: string;
        users: {
          kind: string;
          is_active: boolean;
          client_profiles:
            | { first_name: string; last_name: string }
            | Array<{ first_name: string; last_name: string }>
            | null;
        };
      }>;
      services: { label_i18n: unknown } | null;
      service_plans: { requires_lawyer_validation: boolean } | null;
    };
    sent_by: { display_name: string } | null;
  };

  const rows = (data ?? []) as unknown as RawRow[];

  return rows
    .filter((r) => r.cases.org_id === orgId)
    .map((r): PrintQueueItemRepo => {
      // Client name via case_members → users → client_profiles (primary client).
      // PostgREST may return the to-one embed as an object OR a single-item array.
      const clientMember = (r.cases.case_members ?? []).filter(
        (m) => m.users.is_active && m.users.kind === "client",
      )[0];
      const cpRaw = clientMember?.users?.client_profiles;
      const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw;
      const clientName = cp
        ? `${cp.first_name} ${cp.last_name}`.trim()
        : clientMember?.user_id ?? "—";

      // Service label — stored as { es, en } JSON
      let serviceLabel: { es: string; en: string } | null = null;
      if (r.cases.services?.label_i18n) {
        const raw = r.cases.services.label_i18n as Record<string, string>;
        if (typeof raw.es === "string" && typeof raw.en === "string") {
          serviceLabel = { es: raw.es, en: raw.en };
        }
      }

      const withLawyer = r.cases.service_plans?.requires_lawyer_validation ?? false;

      return {
        expedienteId: r.id,
        caseId: r.cases.id,
        caseNumber: r.cases.case_number,
        clientName,
        serviceLabel,
        attemptNo: r.attempt_no,
        pageCount: r.page_count,
        status: r.status,
        sentToFinanceAt: r.sent_to_finance_at,
        sentByName: r.sent_by?.display_name ?? null,
        withLawyer,
        shippedAt: r.shipped_at,
        filedAt: r.filed_at,
        trackingRef: r.tracking_ref,
        hasPdf: r.compiled_pdf_path !== null,
      };
    });
}

// ---------------------------------------------------------------------------
// Print history — Andrium panel (API-EXP-20, RF-AND-027)
// ---------------------------------------------------------------------------

export interface PrintHistoryAttemptRepo {
  expedienteId: string;
  attemptNo: number;
  status: string;
  sentToFinanceAt: string | null;
  printedAt: string | null;
  shippedAt: string | null;
  filedAt: string | null;
  builtByName: string | null;
  printedByName: string | null;
  withLawyer: boolean;
  lawyerVerdict: string | null;
}

/**
 * Per-case expediente attempt history with resolved staff names + lawyer verdict.
 * Resolves built_by / printed_by → display_name via FK joins; the lawyer verdict
 * comes from legal_validations (by expediente_id, no PostgREST FK assumed).
 * Ordered by attempt_no DESC (latest first). Service-role; caller ran can('printing','view').
 *
 * RF-AND-027 / API-EXP-20.
 */
export async function listPrintHistory(
  orgId: string,
  caseId: string,
): Promise<PrintHistoryAttemptRepo[]> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("expedientes")
    .select(`
      id, attempt_no, status, sent_to_finance_at, printed_at, shipped_at, filed_at,
      cases!inner(org_id, service_plans(requires_lawyer_validation)),
      built_by_staff:staff_profiles!expedientes_built_by_fkey(display_name),
      printed_by_staff:staff_profiles!expedientes_printed_by_fkey(display_name)
    `)
    .eq("case_id", caseId)
    .eq("cases.org_id", orgId)
    .order("attempt_no", { ascending: false });
  if (error) throw new Error(`expediente.repository: listPrintHistory — ${error.message}`);

  type RawRow = {
    id: string;
    attempt_no: number;
    status: string;
    sent_to_finance_at: string | null;
    printed_at: string | null;
    shipped_at: string | null;
    filed_at: string | null;
    cases: { org_id: string; service_plans: { requires_lawyer_validation: boolean } | null };
    built_by_staff: { display_name: string } | null;
    printed_by_staff: { display_name: string } | null;
  };
  const rows = ((data ?? []) as unknown as RawRow[]).filter((r) => r.cases.org_id === orgId);

  // Lawyer verdict per attempt — keyed by expediente_id (separate read).
  const ids = rows.map((r) => r.id);
  const verdictByExp = new Map<string, string>();
  if (ids.length > 0) {
    const { data: vData } = await supabase
      .from("legal_validations")
      .select("expediente_id, verdict, status")
      .in("expediente_id", ids);
    for (const v of (vData ?? []) as Array<{ expediente_id: string; verdict: string | null; status: string | null }>) {
      const value = v.verdict ?? v.status ?? "";
      if (value) verdictByExp.set(v.expediente_id, value);
    }
  }

  return rows.map((r) => ({
    expedienteId: r.id,
    attemptNo: r.attempt_no,
    status: r.status,
    sentToFinanceAt: r.sent_to_finance_at,
    printedAt: r.printed_at,
    shippedAt: r.shipped_at,
    filedAt: r.filed_at,
    builtByName: r.built_by_staff?.display_name ?? null,
    printedByName: r.printed_by_staff?.display_name ?? null,
    withLawyer: r.cases.service_plans?.requires_lawyer_validation ?? false,
    lawyerVerdict: verdictByExp.get(r.id) ?? null,
  }));
}

/**
 * Loads approved case_documents for a case, EXCLUDING any whose requirement was
 * hidden for this case (case_requirement_overrides.is_hidden=true, per-party aware).
 * A hidden requirement's document must never reach the expediente — no cover, no item
 * — so this single source of "material" filters it for every consumer (auto-assembly
 * and Diana's manual picker). Free-uploaded docs (no requirement FK) are never hidden.
 */
export async function listApprovedDocumentsForMaterial(
  caseId: string,
): Promise<MaterialDocuments[]> {
  // Dynamic import of catalog module-pub (matches service.ts:getServiceAssemblyGuidance)
  // — keeps the heavy catalog barrel out of expediente's static import graph.
  const { isRequirementHiddenFor } = await import("@/backend/modules/catalog");
  const supabase = createServiceClient();
  const [{ data }, { data: hiddenRows, error: hiddenError }] = await Promise.all([
    supabase
      .from("case_documents")
      .select("id, required_document_type_id, storage_path, original_filename, display_name, party_id, created_at, required_document_types(label_i18n, signature_role)")
      .eq("case_id", caseId)
      .eq("status", "approved")
      .order("created_at", { ascending: false }),
    supabase
      .from("case_requirement_overrides")
      .select("required_document_type_id, party_id")
      .eq("case_id", caseId)
      .eq("is_hidden", true),
  ]);
  // Fail CLOSED: if the hidden-requirement read errors we cannot guarantee a hidden
  // document won't leak into the expediente, so abort rather than silently assume
  // "nothing hidden" (unlike the case_documents read, whose empty fallback is safe).
  if (hiddenError) {
    throw new Error(
      `listApprovedDocumentsForMaterial: could not read case_requirement_overrides for case ${caseId}: ${hiddenError.message}`,
    );
  }
  const hidden = (hiddenRows ?? []).map((o) => ({ ...o, is_hidden: true as const }));
  return (data ?? [])
    .filter((r) => {
      // A signature-source document (signature_role set) is an INPUT for stamping the
      // generated artifacts, never a filed piece — exclude it from the expediente.
      const rdt = r.required_document_types as { signature_role?: string | null } | null;
      if (rdt?.signature_role) return false;
      return (
        r.required_document_type_id == null ||
        !isRequirementHiddenFor(hidden, r.required_document_type_id, r.party_id ?? null)
      );
    })
    .map((r) => {
      const rdt = r.required_document_types as { label_i18n: unknown } | null;
      const requirementLabel =
        rdt && typeof rdt.label_i18n === "object" && rdt.label_i18n !== null
          ? (rdt.label_i18n as { es: string; en: string })
          : null;
      return {
        refId: r.id,
        title: r.display_name ?? r.original_filename ?? "Document",
        createdAt: r.created_at,
        storagePath: r.storage_path,
        displayName: r.display_name ?? null,
        originalFilename: r.original_filename,
        partyId: r.party_id ?? null,
        requirementLabel,
      };
    });
}
