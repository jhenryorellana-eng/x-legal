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

/**
 * Finds a case by looking up a contract's case_id.
 * Used for idempotency check in createCaseFromContract:
 * "if the contractId already has a case, return it".
 */
export async function findCaseByContractId(
  contractId: string,
): Promise<{ caseId: string } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contracts")
    .select("case_id")
    .eq("id", contractId)
    .maybeSingle();
  if (!data?.case_id) return null;
  return { caseId: data.case_id };
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

/**
 * Calls the next_case_number() SQL function for an org.
 * Returns a string like 'ULP-2026-0001'.
 */
export async function nextCaseNumber(orgId: string): Promise<string> {
  const supabase = await createServiceClient();
  const { data, error } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: string | null; error: { message: string } | null }>)(
    "next_case_number",
    { org: orgId },
  );
  if (error || !data) {
    throw new Error(`cases.repository: nextCaseNumber failed — ${error?.message}`);
  }
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

// ---------------------------------------------------------------------------
// Form responses (case_form_responses)
// ---------------------------------------------------------------------------

export type CaseFormResponseRow = Tables<"case_form_responses">;

/**
 * Finds an existing form response for a case/form/party triple.
 * Uses service client (bypasses RLS — caller must verify case access first).
 */
export async function findFormResponse(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<CaseFormResponseRow | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("case_form_responses")
    .select("*")
    .eq("case_id", caseId)
    .eq("form_definition_id", formDefinitionId);

  if (partyId) {
    query = query.eq("party_id", partyId);
  } else {
    query = query.is("party_id", null);
  }

  const { data } = await query.maybeSingle();
  return data ?? null;
}

/** Finds a form response by its primary key. */
export async function findFormResponseById(
  responseId: string,
): Promise<CaseFormResponseRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_form_responses")
    .select("*")
    .eq("id", responseId)
    .maybeSingle();
  return data ?? null;
}

/** Inserts a new form response row (draft, frozen version). */
export async function insertFormResponse(row: {
  case_id: string;
  form_definition_id: string;
  automation_version_id: string | null;
  party_id: string | null;
  status: string;
}): Promise<CaseFormResponseRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("case_form_responses")
    .insert({
      case_id: row.case_id,
      form_definition_id: row.form_definition_id,
      automation_version_id: row.automation_version_id,
      party_id: row.party_id,
      status: row.status,
      answers: {},
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`cases.repository: insertFormResponse failed — ${error?.message}`);
  }
  return data;
}

/**
 * Merges a patch of answers into the existing answers JSONB.
 * Last-written-per-key wins (RF-DIA-023 CA2).
 *
 * Preferred path: the `merge_form_answers` RPC does `answers || patch` in a single
 * atomic statement — no read-modify-write race between concurrent autosaves
 * (multi-device / multi-tab). Falls back to read-then-write if the RPC migration
 * (0018) is not yet applied; the fallback is functionally correct, only losing
 * atomicity under truly-simultaneous saves.
 */
export async function mergeFormAnswers(
  responseId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const supabase = createServiceClient();

  // Typed as a localized cast: the RPC is added in migration 0018; until the DB
  // types are regenerated post-apply it isn't in the generated function union.
  // NOTE: must `.bind(supabase)` — detaching the method (`const f = supabase.rpc`)
  // loses `this`, so supabase-js reads `this.rest` on undefined and throws.
  const callRpc = supabase.rpc.bind(supabase) as unknown as (
    fn: "merge_form_answers",
    args: { p_response_id: string; p_patch: import("@/shared/database.types").Json },
  ) => Promise<{ error: { message?: string } | null }>;
  const { error: rpcErr } = await callRpc("merge_form_answers", {
    p_response_id: responseId,
    p_patch: patch as import("@/shared/database.types").Json,
  });
  if (!rpcErr) return;

  // Only fall back when the function is genuinely absent (migration not applied).
  const fnAbsent = /merge_form_answers/i.test(rpcErr.message ?? "") &&
    /does not exist|could not find|schema cache/i.test(rpcErr.message ?? "");
  if (!fnAbsent) {
    throw new Error(`cases.repository: mergeFormAnswers rpc failed — ${rpcErr.message}`);
  }

  // Fallback: read-modify-write (apply migration 0018 to remove the race window).
  const { data: current, error: fetchErr } = await supabase
    .from("case_form_responses")
    .select("answers")
    .eq("id", responseId)
    .single();

  if (fetchErr || !current) {
    throw new Error(`cases.repository: mergeFormAnswers fetch failed — ${fetchErr?.message}`);
  }

  const existingAnswers = (current.answers as Record<string, unknown>) ?? {};
  const merged = { ...existingAnswers, ...patch };

  const { error } = await supabase
    .from("case_form_responses")
    .update({ answers: merged as import("@/shared/database.types").Json, updated_at: new Date().toISOString() })
    .eq("id", responseId);

  if (error) {
    throw new Error(`cases.repository: mergeFormAnswers update failed — ${error.message}`);
  }
}

/** Updates status and optional fields on a form response. */
export async function updateFormResponse(
  responseId: string,
  fields: Partial<{
    status: string;
    submitted_at: string;
    filled_pdf_path: string;
  }>,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("case_form_responses")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", responseId);

  if (error) {
    throw new Error(`cases.repository: updateFormResponse failed — ${error.message}`);
  }
}

/** Lists all form responses for a case. */
export async function listFormResponsesForCase(
  caseId: string,
): Promise<CaseFormResponseRow[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_form_responses")
    .select("*")
    .eq("case_id", caseId);
  return data ?? [];
}

/**
 * Finds the most recently approved document for a (case, requirement_slug, party_id).
 * Used by resolveBySource when source='document_extraction'.
 */
export async function findApprovedDocumentBySlug(
  caseId: string,
  requirementSlug: string,
  partyId: string | null,
): Promise<{ id: string; storage_path: string } | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("case_documents")
    .select("id, storage_path, required_document_types!inner(slug)")
    .eq("case_id", caseId)
    .eq("required_document_types.slug", requirementSlug)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1);

  if (partyId) {
    query = query.eq("party_id", partyId);
  } else {
    query = query.is("party_id", null);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;
  return { id: data[0].id, storage_path: data[0].storage_path };
}

/**
 * Finds a document extraction row by case_document_id.
 */
export async function findDocumentExtractionByCaseDocId(
  caseDocumentId: string,
): Promise<{ status: string; payload: unknown } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("document_extractions")
    .select("status, payload")
    .eq("case_document_id", caseDocumentId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Finds the most-recent completed ai_generation_run for (case, form_slug, party_id).
 */
export async function findCompletedGenerationByFormSlug(
  caseId: string,
  formSlug: string,
  partyId: string | null,
): Promise<{ output: unknown } | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("ai_generation_runs")
    .select("output, form_definitions!inner(slug)")
    .eq("case_id", caseId)
    .eq("form_definitions.slug", formSlug)
    .eq("status", "completed")
    .order("version", { ascending: false })
    .limit(1);

  if (partyId) {
    query = query.eq("party_id", partyId);
  } else {
    query = query.is("party_id", null);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;
  return { output: (data[0] as unknown as { output: unknown }).output };
}

/**
 * Finds client profile fields for a user.
 * PII fields are returned as-is (encrypted); decryption is caller's responsibility.
 */
export async function findClientProfileForForm(userId: string): Promise<{
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  country_of_origin: string | null;
  address: unknown;
  pii_encrypted: unknown;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("client_profiles")
    .select("first_name, last_name, preferred_name, country_of_origin, address, pii_encrypted")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

/** Finds user-level contact fields (phone, email) for a user. */
export async function findUserContactFields(userId: string): Promise<{
  phone_e164: string | null;
  email: string | null;
} | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("phone_e164, email")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Lists all non-replaced documents with their extraction status for the staff tab.
 */
export async function listDocumentExtractionsForCase(caseId: string): Promise<Array<{
  caseDocumentId: string;
  requirementSlug: string | null;
  partyId: string | null;
  documentStatus: string;
  extractionStatus: string | null;
  extractionPayload: unknown;
}>> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("case_documents")
    .select(`
      id,
      status,
      party_id,
      required_document_types(slug),
      document_extractions(status, payload)
    `)
    .eq("case_id", caseId)
    .neq("status", "replaced");

  if (!data) return [];

  return data.map((row) => {
    const rec = row as unknown as Record<string, unknown>;
    const rdt = rec["required_document_types"] as { slug?: string } | null;
    const ext = rec["document_extractions"] as Array<{ status?: string; payload?: unknown }> | null;
    const extraction = Array.isArray(ext) ? ext[0] : null;
    return {
      caseDocumentId: row.id,
      requirementSlug: rdt?.slug ?? null,
      partyId: row.party_id,
      documentStatus: row.status,
      extractionStatus: extraction?.status ?? null,
      extractionPayload: extraction?.payload ?? null,
    };
  });
}

/** Finds the primary_client_id for a case. */
export async function findCasePrimaryClient(caseId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("primary_client_id")
    .eq("id", caseId)
    .maybeSingle();
  return data?.primary_client_id ?? null;
}

/** Finds a form definition by id. */
export async function findFormDefinitionById(
  formDefinitionId: string,
): Promise<{ id: string; slug: string; kind: string; filled_by: string; is_per_party: boolean; party_roles: string[] | null; is_active: boolean; label_i18n: unknown } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("form_definitions")
    .select("id, slug, kind, filled_by, is_per_party, party_roles, is_active, label_i18n")
    .eq("id", formDefinitionId)
    .maybeSingle();
  return data ?? null;
}

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

// ---------------------------------------------------------------------------
// Client-surface enriched reads (F2 — read-only, RLS-scoped via server client)
//
// These power the (cliente) screens. They DO NOT mutate. The cases module is the
// owner of `cases`/`case_documents`/`case_parties`; service-label/phase catalog
// data comes from the `services`/`service_phases` tables it already references by
// FK. Person/party names come from `person_records` / `client_profiles`.
// ---------------------------------------------------------------------------

export interface ServiceLite {
  id: string;
  slug: string;
  label_i18n: Tables<"services">["label_i18n"];
  icon: string;
  color: string;
}

/** Reads a service's display fields (label/icon/color) — RLS-scoped. */
export async function findServiceLite(
  serviceId: string,
): Promise<ServiceLite | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("services")
    .select("id, slug, label_i18n, icon, color")
    .eq("id", serviceId)
    .maybeSingle();
  return data ?? null;
}

export type ServicePhaseRow = Tables<"service_phases">;

/** Returns all phases of a service ordered by position (for "Phase x of y"). */
export async function listServicePhases(
  serviceId: string,
): Promise<ServicePhaseRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("service_phases")
    .select("*")
    .eq("service_id", serviceId)
    .order("position");
  return data ?? [];
}

export type ServiceMilestoneRow = Tables<"service_phase_milestones">;

/** Returns all milestones of a service's phases ordered by phase then position. */
export async function listServiceMilestones(
  serviceId: string,
): Promise<Array<ServiceMilestoneRow & { phase_position: number }>> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("service_phase_milestones")
    .select("*, service_phases!inner(service_id, position)")
    .eq("service_phases.service_id", serviceId)
    .order("position");
  if (!data) return [];
  return data.map((m) => {
    const rec = m as unknown as Record<string, unknown>;
    const phase = rec["service_phases"] as { position?: number } | null;
    return {
      ...(m as unknown as ServiceMilestoneRow),
      phase_position: phase?.position ?? 0,
    };
  });
}

/** Person record (party name) lookup by id — RLS-scoped. */
export async function findPersonRecord(
  personId: string,
): Promise<{ first_name: string; last_name: string } | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("person_records")
    .select("first_name, last_name")
    .eq("id", personId)
    .maybeSingle();
  return data ?? null;
}

/** Plan kind (self | with_lawyer) lookup by service_plan id — RLS-scoped. */
export async function findPlanKind(planId: string): Promise<string | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("service_plans")
    .select("kind")
    .eq("id", planId)
    .maybeSingle();
  return data?.kind ?? null;
}

/** Client profile display name (preferred_name ?? first_name) — RLS-scoped. */
export async function findClientDisplayName(
  userId: string,
): Promise<string | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("client_profiles")
    .select("first_name, preferred_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  return data.preferred_name ?? data.first_name;
}

/**
 * All documents for a case (latest chain heads not filtered here — the service
 * layer reduces by requirement/party). Used to derive the documents matrix.
 */
export async function listCaseDocuments(
  caseId: string,
): Promise<CaseDocumentRow[]> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("case_documents")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });
  return data ?? [];
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
