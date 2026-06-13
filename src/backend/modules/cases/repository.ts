/**
 * Cases module — repository (data access layer).
 *
 * All queries go through Supabase clients:
 * - createServerClient: for actor-bound reads (RLS scopes to org)
 * - createServiceClient: for system/event-handler writes that bypass RLS
 *
 * @module cases/repository
 */

import {
  createServerClient,
  createServiceClient,
} from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

// ---------------------------------------------------------------------------
// Row types (re-exported for service layer)
// ---------------------------------------------------------------------------

export type CaseRow = Tables<"cases">;
export type CaseDocumentRow = Tables<"case_documents">;
export type CaseTimelineRow = Tables<"case_timeline">;
export type CaseMemberRow = Tables<"case_members">;
export type CasePartyRow = Tables<"case_parties">;
export type CasePhaseHistoryRow = Tables<"case_phase_history">;
export type CaseRequirementOverrideRow = Tables<"case_requirement_overrides">;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** Finds a case by ID using the server client (RLS-scoped). */
export async function findCaseById(caseId: string): Promise<CaseRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .single();

  if (error || !data) return null;
  return data;
}

/** Finds a case by contract_id using the service client (for event handlers). */
export async function findCaseByCaseId(
  caseId: string,
): Promise<CaseRow | null> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("cases")
    .select("*")
    .eq("id", caseId)
    .single();

  if (error || !data) return null;
  return data;
}

/** Finds a case by its case_number for idempotency checks. */
export async function findCaseByNumber(
  orgId: string,
  caseNumber: string,
): Promise<CaseRow | null> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("*")
    .eq("org_id", orgId)
    .eq("case_number", caseNumber)
    .maybeSingle();

  return data ?? null;
}

/** Inserts a new case row. Returns the created row. */
export async function insertCase(
  row: TablesInsert<"cases">,
): Promise<CaseRow> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("cases")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`cases.repository: insertCase failed — ${error?.message}`);
  }
  return data;
}

/** Updates a case row. Throws if the row is not found or update fails. */
export async function updateCase(
  caseId: string,
  fields: TablesUpdate<"cases">,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("cases")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", caseId);

  if (error) {
    throw new Error(`cases.repository: updateCase failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Case members
// ---------------------------------------------------------------------------

/** Inserts a case_members row (idempotent via upsert on conflict). */
export async function upsertCaseMember(
  caseId: string,
  userId: string,
  accessRole: string,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("case_members").upsert(
    { case_id: caseId, user_id: userId, access_role: accessRole },
    { onConflict: "case_id,user_id" },
  );

  if (error) {
    throw new Error(
      `cases.repository: upsertCaseMember failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Phase history
// ---------------------------------------------------------------------------

/** Inserts a case_phase_history row. */
export async function insertPhaseHistory(row: {
  caseId: string;
  phaseId: string;
  enteredBy: string | null;
  note: string | null;
}): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("case_phase_history").insert({
    case_id: row.caseId,
    phase_id: row.phaseId,
    entered_by: row.enteredBy,
    note: row.note,
    entered_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(
      `cases.repository: insertPhaseHistory failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Finds a case document by ID using the server client. */
export async function findDocumentById(
  documentId: string,
): Promise<CaseDocumentRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("case_documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) return null;
  return data;
}

/** Inserts a case document row. Returns the created row. */
export async function insertCaseDocument(
  row: TablesInsert<"case_documents">,
): Promise<CaseDocumentRow> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("case_documents")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `cases.repository: insertCaseDocument failed — ${error?.message}`,
    );
  }
  return data;
}

/** Updates a case document row by ID. */
export async function updateDocument(
  documentId: string,
  fields: TablesUpdate<"case_documents">,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("case_documents")
    .update(fields)
    .eq("id", documentId);

  if (error) {
    throw new Error(
      `cases.repository: updateDocument failed — ${error.message}`,
    );
  }
}

/**
 * Finds the current chain head (most recent, non-replaced document) for a
 * given case/requirement/party triple.
 *
 * "Chain head" = a document row whose `id` is NOT referenced by any other
 * row's `replaces_document_id`, meaning it is the latest in the re-upload chain.
 */
export async function findCurrentChainHead(
  caseId: string,
  requirementId: string | null,
  partyId: string | null,
): Promise<CaseDocumentRow | null> {
  const supabase = await createServiceClient();

  let query = supabase
    .from("case_documents")
    .select("*")
    .eq("case_id", caseId)
    .in("status", ["uploaded", "approved", "rejected"]);

  if (requirementId) {
    query = query.eq("required_document_type_id", requirementId);
  } else {
    query = query.is("required_document_type_id", null);
  }

  if (partyId) {
    query = query.eq("party_id", partyId);
  } else {
    query = query.is("party_id", null);
  }

  const { data } = await query.order("created_at", { ascending: false }).limit(1);

  if (!data || data.length === 0) return null;
  return data[0];
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Inserts a case_timeline row via service client.
 * Called exclusively from audit.appendCaseTimeline — NOT called directly.
 */
export async function insertTimelineEntry(
  row: TablesInsert<"case_timeline">,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("case_timeline").insert(row);

  if (error) {
    throw new Error(
      `cases.repository: insertTimelineEntry failed — ${error.message}`,
    );
  }
}

export interface TimelinePage {
  items: CaseTimelineRow[];
  nextCursor: string | null;
}

/** Paginated timeline for a case. Clients only see visible_to_client entries. */
export async function getTimelinePage(
  caseId: string,
  opts: {
    visibleToClientOnly?: boolean;
    cursor?: string;
    limit?: number;
  },
): Promise<TimelinePage> {
  const limit = opts.limit ?? 20;
  const supabase = await createServerClient();

  let query = supabase
    .from("case_timeline")
    .select("*")
    .eq("case_id", caseId)
    .order("occurred_at", { ascending: false })
    .limit(limit + 1);

  if (opts.visibleToClientOnly) {
    query = query.eq("visible_to_client", true);
  }

  if (opts.cursor) {
    query = query.lt("occurred_at", opts.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(
      `cases.repository: getTimelinePage failed — ${error.message}`,
    );
  }

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return {
    items,
    nextCursor:
      hasMore && items.length > 0
        ? items[items.length - 1].occurred_at
        : null,
  };
}

// ---------------------------------------------------------------------------
// Requirement overrides
// ---------------------------------------------------------------------------

export async function getRequirementOverrides(
  caseId: string,
): Promise<CaseRequirementOverrideRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("case_requirement_overrides")
    .select("*")
    .eq("case_id", caseId);

  return data ?? [];
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

export async function getCaseParties(caseId: string): Promise<CasePartyRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("case_parties")
    .select("*")
    .eq("case_id", caseId)
    .order("position");

  return data ?? [];
}

// ---------------------------------------------------------------------------
// List cases (paginated)
// ---------------------------------------------------------------------------

export interface ListCasesFilters {
  orgId: string;
  status?: string;
  assignedParalegalId?: string;
  assignedSalesId?: string;
  cursor?: string;
  limit?: number;
}

export interface CasesPage {
  items: CaseRow[];
  nextCursor: string | null;
}

export async function listCases(filters: ListCasesFilters): Promise<CasesPage> {
  const limit = filters.limit ?? 20;
  const supabase = await createServerClient();

  let query = supabase
    .from("cases")
    .select("*")
    .eq("org_id", filters.orgId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);

  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.assignedParalegalId) {
    query = query.eq("assigned_paralegal_id", filters.assignedParalegalId);
  }
  if (filters.assignedSalesId) {
    query = query.eq("assigned_sales_id", filters.assignedSalesId);
  }
  if (filters.cursor) {
    query = query.lt("created_at", filters.cursor);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`cases.repository: listCases failed — ${error.message}`);
  }

  const items = data ?? [];
  const hasMore = items.length > limit;
  if (hasMore) items.pop();

  return {
    items,
    nextCursor:
      hasMore && items.length > 0 ? items[items.length - 1].created_at : null,
  };
}
