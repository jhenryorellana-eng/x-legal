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
// Atomic case creation (migration 0026 — create_case_atomic RPC)
//
// Inserts case + member + parties + contract + payment_plan + installments in a
// single transaction. Replaces the previous sequential inserts that could leave
// an orphaned case (payment_pending with no contract/plan) on partial failure.
// ---------------------------------------------------------------------------

export interface CreateCaseAtomicPayload {
  case: {
    org_id: string;
    case_number: string;
    service_id: string;
    service_plan_id: string;
    current_phase_id: string | null;
    status: string;
    primary_client_id: string;
    assigned_paralegal_id: string | null;
    assigned_sales_id: string | null;
  };
  member: { user_id: string; access_role: string };
  parties: Array<{
    person_record_id: string | null;
    user_id: string | null;
    party_role: string;
    position: number;
  }>;
  contract: {
    org_id: string;
    lead_id: string | null;
    service_id: string;
    service_plan_id: string;
    status: string;
    plan_snapshot: unknown;
    parties_snapshot: unknown;
    document_snapshot: unknown;
    created_by: string | null;
    terms_version: string | null;
    signing_token: string | null;
    signing_expires_at: string | null;
  };
  plan: {
    total_cents: number;
    downpayment_cents: number;
    installment_count: number;
    frequency: "weekly" | "monthly";
    notes: string | null;
  };
  installments: Array<{
    number: number;
    is_downpayment: boolean;
    amount_cents: number;
    due_date: string;
    status: string;
  }>;
}

export async function createCaseAtomic(
  payload: CreateCaseAtomicPayload,
): Promise<{ caseId: string; contractId: string; planId: string }> {
  const supabase = createServiceClient();
  // The create_case_atomic RPC is added by migration 0026 and is not yet in the
  // generated Database types — cast through unknown to call it untyped.
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )("create_case_atomic", { p: payload });

  if (error) {
    throw new Error(`cases.repository: createCaseAtomic failed — ${error.message}`);
  }
  const r = (data ?? {}) as { case_id?: string; contract_id?: string; plan_id?: string };
  if (!r.case_id || !r.contract_id || !r.plan_id) {
    throw new Error("cases.repository: createCaseAtomic returned an incomplete result");
  }
  return { caseId: r.case_id, contractId: r.contract_id, planId: r.plan_id };
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

/** Inserts a case_milestone_history row. `entered_at` is the approximate
 *  "reached" date of the milestone. */
export async function insertMilestoneHistory(row: {
  caseId: string;
  milestoneId: string;
  enteredBy: string | null;
  note: string | null;
}): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("case_milestone_history").insert({
    case_id: row.caseId,
    milestone_id: row.milestoneId,
    entered_by: row.enteredBy,
    note: row.note,
    entered_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(
      `cases.repository: insertMilestoneHistory failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Stage / ownership (responsable interno — eje propio)
// ---------------------------------------------------------------------------

export type CaseStageHistoryRow = Tables<"case_stage_history">;

/** Inserts an immutable case_stage_history row (service-role; authz in service). */
export async function insertStageHistory(row: {
  caseId: string;
  fromStage: string | null;
  toStage: string;
  fromOwnerId: string | null;
  toOwnerId: string | null;
  actorId: string | null;
  note: string | null;
}): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase.from("case_stage_history").insert({
    case_id: row.caseId,
    from_stage: row.fromStage,
    to_stage: row.toStage,
    from_owner_id: row.fromOwnerId,
    to_owner_id: row.toOwnerId,
    actor_id: row.actorId,
    note: row.note,
  });
  if (error) {
    throw new Error(`cases.repository: insertStageHistory failed — ${error.message}`);
  }
}

/** Lists a case's stage history (oldest first). Service-role read (staff-only surface). */
export async function listCaseStageHistory(
  caseId: string,
): Promise<CaseStageHistoryRow[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("case_stage_history")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  if (error) {
    throw new Error(`cases.repository: listCaseStageHistory failed — ${error.message}`);
  }
  return data ?? [];
}

/**
 * Staff in an org with `can_edit` on a module — the eligible owners for a stage
 * (STAGE_MODULE). Admins are eligible for every stage regardless of the matrix
 * and are appended by the service. Service-role read.
 */
export async function listStaffWithModuleEdit(
  orgId: string,
  moduleKey: string,
): Promise<Array<{ userId: string; displayName: string; role: string }>> {
  const supabase = await createServiceClient();
  // staff_id → staff_profiles.user_id → users.id. Nest the users embed inside
  // staff_profiles (there is no direct FK from this table to users). `!inner`
  // turns the org/active constraints into real joins.
  const { data, error } = await supabase
    .from("employee_module_permissions")
    .select("staff_id, staff_profiles!inner(display_name, role, users!inner(org_id, is_active))")
    .eq("module_key", moduleKey)
    .eq("can_edit", true)
    .eq("staff_profiles.users.org_id", orgId)
    .eq("staff_profiles.users.is_active", true);
  if (error) {
    throw new Error(`cases.repository: listStaffWithModuleEdit failed — ${error.message}`);
  }
  const rows = (data ?? []) as unknown as Array<{
    staff_id: string;
    staff_profiles: { display_name: string; role: string } | null;
  }>;
  return rows
    .filter((r) => r.staff_profiles)
    .map((r) => ({
      userId: r.staff_id,
      displayName: r.staff_profiles!.display_name,
      role: r.staff_profiles!.role,
    }));
}

/** Resolves a staff member's display name (responsable). Service-role read. */
export async function findStaffDisplayName(userId: string): Promise<string | null> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("display_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.display_name ?? null;
}

/**
 * Translation progress for a case (gating signal for the sales handoff).
 * "to translate" = live documents (status uploaded|approved) NOT marked as
 * already-English (translation_not_required=false); "completed" = those with a
 * finished es-en translation. Service-role read.
 */
export async function getTranslationProgress(
  caseId: string,
): Promise<{ toTranslate: number; completed: number }> {
  const supabase = await createServiceClient();
  const { data: docs, error: docErr } = await supabase
    .from("case_documents")
    .select("id")
    .eq("case_id", caseId)
    .eq("translation_not_required", false)
    .in("status", ["uploaded", "approved"]);
  if (docErr) {
    throw new Error(`cases.repository: getTranslationProgress(docs) failed — ${docErr.message}`);
  }
  const docIds = (docs ?? []).map((d) => d.id);
  if (docIds.length === 0) return { toTranslate: 0, completed: 0 };

  const { data: trans, error: trErr } = await supabase
    .from("document_translations")
    .select("case_document_id")
    .in("case_document_id", docIds)
    .eq("direction", "es-en")
    .eq("status", "completed");
  if (trErr) {
    throw new Error(`cases.repository: getTranslationProgress(trans) failed — ${trErr.message}`);
  }
  const completedIds = new Set((trans ?? []).map((t) => t.case_document_id));
  return { toTranslate: docIds.length, completed: completedIds.size };
}

/**
 * Flags a document as already-English (no ES→EN translation needed) or back.
 * Scoped to the case for safety. Service-role write (authz in service).
 */
export async function setDocumentTranslationNotRequiredRow(
  caseId: string,
  caseDocumentId: string,
  value: boolean,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("case_documents")
    .update({ translation_not_required: value, updated_at: new Date().toISOString() })
    .eq("id", caseDocumentId)
    .eq("case_id", caseId);
  if (error) {
    throw new Error(`cases.repository: setDocumentTranslationNotRequiredRow failed — ${error.message}`);
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
  service_phase_id?: string | null;
  questionnaire_instance_id?: string | null;
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
      service_phase_id: row.service_phase_id ?? null,
      questionnaire_instance_id: row.questionnaire_instance_id ?? null,
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
    answers_translated: Record<string, string>;
    translation_status: string;
    reviewed_by: string;
    reviewed_at: string;
    correction_due_at: string | null;
    rejection_reason_i18n: import("@/shared/database.types").Json;
    /** Ola 3 — re-pin a dynamic questionnaire draft to the current instance after
     *  a regeneration (keeps pin == the schema the answers are keyed to). */
    questionnaire_instance_id: string | null;
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
 * Finds the latest ACTIVE document for a (case, requirement_slug, party_id).
 * "Active" = the current chain head: status in ('uploaded','approved'),
 * excluding 'replaced' (superseded) and 'rejected' (bad scan). Used by
 * resolveBySource when source='document_extraction' — the form field
 * autocompletes as soon as the extraction completes, without waiting for
 * staff approval (product decision: AI prefill is assistance the client
 * can edit; staff still reviews the submitted form response).
 */
export async function findLatestActiveDocumentBySlug(
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
    .in("status", ["uploaded", "approved"])
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
 *
 * Returns the run's outputs. NOTE: there is no `output` column — historically this
 * selected a non-existent `output` and always returned null (the generation_output
 * source was silently broken). It now returns the real columns: `output_structured`
 * (navigable JSON, for generation_output dot-paths) + `output_text` (the raw
 * markdown, used by ai_field synthesis) + `output_path`.
 */
export async function findCompletedGenerationByFormSlug(
  caseId: string,
  formSlug: string,
  partyId: string | null,
): Promise<{ outputStructured: unknown; outputText: string | null; outputPath: string | null } | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("ai_generation_runs")
    .select("output_structured, output_text, output_path, form_definitions!inner(slug)")
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
  const row = data[0] as unknown as {
    output_structured: unknown;
    output_text: string | null;
    output_path: string | null;
  };
  return {
    outputStructured: row.output_structured ?? null,
    outputText: row.output_text ?? null,
    outputPath: row.output_path ?? null,
  };
}

/**
 * Downloads the latest active (uploaded/approved) case document for a requirement
 * slug, returning its raw bytes + mime type. Used by the `ai_field` (kind:document)
 * source so the AI can INTERPRET the file directly (Gemini multimodal). Returns null
 * if no such document exists or the download fails.
 */
export async function downloadDocumentBytesBySlug(
  caseId: string,
  requirementSlug: string,
  partyId: string | null,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const supabase = createServiceClient();
  let query = supabase
    .from("case_documents")
    .select("storage_path, mime_type, required_document_types!inner(slug)")
    .eq("case_id", caseId)
    .eq("required_document_types.slug", requirementSlug)
    .in("status", ["uploaded", "approved"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (partyId) {
    query = query.eq("party_id", partyId);
  } else {
    query = query.is("party_id", null);
  }

  const { data } = await query;
  if (!data || data.length === 0) return null;
  const row = data[0] as unknown as { storage_path: string; mime_type: string };

  const { data: file } = await supabase.storage.from("case-documents").download(row.storage_path);
  if (!file) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, mimeType: row.mime_type };
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

export interface ClientCaseSummaryRow {
  id: string;
  case_number: string;
  service_id: string;
  status: string;
  service_label_i18n: unknown;
}

/**
 * Case summaries for one client (org-scoped) — powers the RF-VAN-019
 * duplicate-service notice in the "Nuevo caso" modal ("{Nombre} ya tiene un
 * caso de {Servicio}"). Two reads (cases, then service labels) following the
 * repo's batch-hydration style.
 */
export async function getCaseSummariesByClient(
  orgId: string,
  clientId: string,
): Promise<ClientCaseSummaryRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cases")
    .select("id, case_number, service_id, status")
    .eq("org_id", orgId)
    .eq("primary_client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new Error(`cases.repository: getCaseSummariesByClient — ${error.message}`);
  }
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const serviceIds = [...new Set(rows.map((c) => c.service_id))];
  const { data: services } = await supabase
    .from("services")
    .select("id, label_i18n")
    .in("id", serviceIds);
  const labelById = new Map((services ?? []).map((s) => [s.id, s.label_i18n as unknown]));

  return rows.map((c) => ({
    id: c.id,
    case_number: c.case_number,
    service_id: c.service_id,
    status: c.status,
    service_label_i18n: labelById.get(c.service_id) ?? null,
  }));
}

/** Finds a form definition by id. */
export async function findFormDefinitionById(
  formDefinitionId: string,
): Promise<{ id: string; slug: string; kind: string; filled_by: string; is_per_party: boolean; party_roles: string[] | null; is_active: boolean; label_i18n: unknown; requires_documents_complete: boolean } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("form_definitions")
    .select("id, slug, kind, filled_by, is_per_party, party_roles, is_active, label_i18n, requires_documents_complete")
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
 * Hard-deletes a case document row by ID (service client). Used only for
 * never-reviewed ('uploaded') documents the client removes/overwrites — the
 * Storage object is deleted separately by the caller. Reviewed documents
 * (approved/rejected) are never hard-deleted (audit trail).
 */
export async function deleteCaseDocumentRow(documentId: string): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("case_documents")
    .delete()
    .eq("id", documentId);

  if (error) {
    throw new Error(
      `cases.repository: deleteCaseDocumentRow failed — ${error.message}`,
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

/**
 * Finds an existing override for the (case, requirement, party) triple.
 *
 * The unique constraint treats NULL party_id as distinct, so the service layer
 * does find-or-create instead of upsert to avoid duplicate null-party rows.
 */
export async function findRequirementOverride(
  caseId: string,
  requiredDocumentTypeId: string | null,
  partyId: string | null,
): Promise<CaseRequirementOverrideRow | null> {
  const supabase = await createServerClient();
  let query = supabase
    .from("case_requirement_overrides")
    .select("*")
    .eq("case_id", caseId);

  query = requiredDocumentTypeId
    ? query.eq("required_document_type_id", requiredDocumentTypeId)
    : query.is("required_document_type_id", null);
  query = partyId ? query.eq("party_id", partyId) : query.is("party_id", null);

  const { data } = await query.maybeSingle();
  return data ?? null;
}

/** Inserts a requirement override row. Returns the created row. */
export async function insertRequirementOverride(
  row: TablesInsert<"case_requirement_overrides">,
): Promise<CaseRequirementOverrideRow> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("case_requirement_overrides")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `cases.repository: insertRequirementOverride failed — ${error?.message}`,
    );
  }
  return data;
}

/** Updates a requirement override row by ID. */
export async function updateRequirementOverride(
  id: string,
  fields: TablesUpdate<"case_requirement_overrides">,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("case_requirement_overrides")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw new Error(
      `cases.repository: updateRequirementOverride failed — ${error.message}`,
    );
  }
}

/** Deletes a requirement override row (restores the catalog default). */
export async function deleteRequirementOverride(
  caseId: string,
  overrideId: string,
): Promise<void> {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("case_requirement_overrides")
    .delete()
    .eq("id", overrideId)
    .eq("case_id", caseId);

  if (error) {
    throw new Error(
      `cases.repository: deleteRequirementOverride failed — ${error.message}`,
    );
  }
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

/**
 * Updates the legal name of a client profile (the petitioner party is stored as
 * a `users` row whose name lives in `client_profiles`). Service client — admin
 * mutation gated upstream in the service.
 */
export async function updateClientProfileName(
  userId: string,
  name: { firstName: string; lastName: string },
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("client_profiles")
    .update({ first_name: name.firstName, last_name: name.lastName, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    throw new Error(`cases.repository: updateClientProfileName failed — ${error.message}`);
  }
}

/**
 * Updates the name of a person_record (additional case parties — spouse, minors,
 * etc.). Service client — admin mutation gated upstream in the service.
 */
export async function updatePersonRecordName(
  personRecordId: string,
  name: { firstName: string; lastName: string },
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("person_records")
    .update({ first_name: name.firstName, last_name: name.lastName, updated_at: new Date().toISOString() })
    .eq("id", personRecordId);

  if (error) {
    throw new Error(`cases.repository: updatePersonRecordName failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// List cases (paginated)
// ---------------------------------------------------------------------------

export interface ListCasesFilters {
  orgId: string;
  status?: string;
  assignedParalegalId?: string;
  assignedSalesId?: string;
  /** Filters by current_owner_id (responsable interno). */
  ownerId?: string;
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

/** Service row with the contract-content columns — for re-assembling the frozen
 *  contract document when a case party is corrected before signing (DOC-51). */
export async function findServiceContractRow(serviceId: string): Promise<{
  label_i18n: unknown;
  contract_object_i18n: unknown;
  contract_scope_i18n: unknown;
  contract_special_clause_i18n: unknown;
} | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("services")
    .select("label_i18n, contract_object_i18n, contract_scope_i18n, contract_special_clause_i18n")
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
 * Phones (users.phone_e164) for a batch of client user ids → map by id. One
 * query (not N+1). Uses the service client: the ids come from an already
 * org-scoped case listing, so reading their phone for the staff clients list is
 * safe. Used by listCasesAdmin to make the clients search match by phone.
 */
export async function findClientPhonesByIds(
  userIds: string[],
): Promise<Record<string, string | null>> {
  if (userIds.length === 0) return {};
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id, phone_e164")
    .in("id", userIds);
  const map: Record<string, string | null> = {};
  for (const row of (data ?? []) as Array<{ id: string; phone_e164: string | null }>) {
    map[row.id] = row.phone_e164 ?? null;
  }
  return map;
}

/**
 * Client profile FULL legal name (first_name + last_name) — RLS-scoped.
 * Used to freeze the principal applicant into the contract parties snapshot
 * (the public signing page renders the full name, not the display name).
 */
export async function findClientFullName(
  userId: string,
): Promise<{ first_name: string; last_name: string } | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("client_profiles")
    .select("first_name, last_name")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
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
  if (filters.ownerId) {
    query = query.eq("current_owner_id", filters.ownerId);
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

// ---------------------------------------------------------------------------
// Bookable-case search (staff "Nueva cita" modal) — batched, no N+1
// ---------------------------------------------------------------------------

export interface EnrichedBookableCaseRow {
  caseId: string;
  caseNumber: string;
  serviceId: string;
  primaryClientId: string | null;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  phone: string | null;
  timezone: string | null;
  serviceLabelI18n: Tables<"services">["label_i18n"] | null;
}

/**
 * Active cases of an org enriched with client name/phone/timezone and service
 * label, resolved in 4 batched queries (cases → users, client_profiles,
 * services by id-IN) so the staff "Nueva cita" search never does N+1.
 * `scanLimit` bounds the active-case scan; the service filters/limits results.
 */
export async function getActiveCasesEnriched(
  orgId: string,
  scanLimit = 300,
): Promise<EnrichedBookableCaseRow[]> {
  const supabase = createServiceClient();

  const { data: cases, error } = await supabase
    .from("cases")
    .select("id, case_number, service_id, primary_client_id")
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(scanLimit);
  if (error) throw new Error(`cases.repository: getActiveCasesEnriched — ${error.message}`);
  if (!cases || cases.length === 0) return [];

  const clientIds = [...new Set(cases.map((c) => c.primary_client_id).filter(Boolean) as string[])];
  const serviceIds = [...new Set(cases.map((c) => c.service_id).filter(Boolean) as string[])];

  const [usersRes, profilesRes, servicesRes] = await Promise.all([
    clientIds.length
      ? supabase.from("users").select("id, phone_e164, timezone").in("id", clientIds)
      : Promise.resolve({ data: [] as { id: string; phone_e164: string | null; timezone: string | null }[], error: null }),
    clientIds.length
      ? supabase
          .from("client_profiles")
          .select("user_id, first_name, last_name, preferred_name")
          .in("user_id", clientIds)
      : Promise.resolve({ data: [] as { user_id: string; first_name: string | null; last_name: string | null; preferred_name: string | null }[], error: null }),
    serviceIds.length
      ? supabase.from("services").select("id, label_i18n").in("id", serviceIds)
      : Promise.resolve({ data: [] as { id: string; label_i18n: Tables<"services">["label_i18n"] }[], error: null }),
  ]);
  // Fail loudly rather than degrade silently to blank names/labels (a transient
  // sub-query error must not surface as a case with no client/service).
  if (usersRes.error) throw new Error(`cases.repository: getActiveCasesEnriched(users) — ${usersRes.error.message}`);
  if (profilesRes.error) throw new Error(`cases.repository: getActiveCasesEnriched(profiles) — ${profilesRes.error.message}`);
  if (servicesRes.error) throw new Error(`cases.repository: getActiveCasesEnriched(services) — ${servicesRes.error.message}`);

  const userById = new Map((usersRes.data ?? []).map((u) => [u.id, u]));
  const profileByUser = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p]));
  const serviceById = new Map((servicesRes.data ?? []).map((s) => [s.id, s]));

  return cases.map((c) => {
    const user = c.primary_client_id ? userById.get(c.primary_client_id) : undefined;
    const profile = c.primary_client_id ? profileByUser.get(c.primary_client_id) : undefined;
    const service = c.service_id ? serviceById.get(c.service_id) : undefined;
    return {
      caseId: c.id,
      caseNumber: c.case_number,
      serviceId: c.service_id,
      primaryClientId: c.primary_client_id,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      preferredName: profile?.preferred_name ?? null,
      phone: user?.phone_e164 ?? null,
      timezone: user?.timezone ?? null,
      serviceLabelI18n: service?.label_i18n ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Board-alert batch queries (service_role — no RLS, staff-only reads)
// All functions accept a list of caseIds and return one row per distinct case_id
// so callers can build Record<caseId, T> without N+1.
// ---------------------------------------------------------------------------

/**
 * Returns the count of documents with status='uploaded' per case_id.
 * Used by getCaseBoardAlerts → needsReview signal.
 */
export async function countUploadedDocsByCases(
  caseIds: string[],
): Promise<Array<{ case_id: string; count: number }>> {
  if (caseIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("case_documents")
    .select("case_id")
    .in("case_id", caseIds)
    .eq("status", "uploaded");
  if (error) throw new Error(`cases.repository: countUploadedDocsByCases — ${error.message}`);
  // Aggregate in JS (Supabase JS client doesn't expose GROUP BY directly)
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.case_id] = (counts[row.case_id] ?? 0) + 1;
  }
  return Object.entries(counts).map(([case_id, count]) => ({ case_id, count }));
}

/**
 * Returns the set of caseIds that have at least one expediente with
 * status='corrections_needed'.
 * Used by getCaseBoardAlerts → lawyerCorrections signal.
 */
export async function findCasesWithLawyerCorrections(
  caseIds: string[],
): Promise<string[]> {
  if (caseIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("expedientes")
    .select("case_id")
    .in("case_id", caseIds)
    .eq("status", "corrections_needed");
  if (error) throw new Error(`cases.repository: findCasesWithLawyerCorrections — ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.case_id))];
}

/**
 * Returns the set of caseIds that have at least one ai_generation_run with
 * status='failed'.
 * Used by getCaseBoardAlerts → generationFailed signal.
 *
 * NOTE: cases repo already queries ai_generation_runs (findCompletedGenerationByFormSlug),
 * so this remains within the module's established data scope.
 */
export async function findCasesWithGenerationFailed(
  caseIds: string[],
): Promise<string[]> {
  if (caseIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ai_generation_runs")
    .select("case_id")
    .in("case_id", caseIds)
    .eq("status", "failed");
  if (error) throw new Error(`cases.repository: findCasesWithGenerationFailed — ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.case_id))];
}

/**
 * Returns the set of caseIds that have at least one overdue RFE document.
 *
 * Overdue = case_documents with:
 *   - status IN ('rejected', 'uploaded')  — pending re-submission
 *   - correction_due_at IS NOT NULL AND correction_due_at < now()
 *
 * Used by getCaseBoardAlerts → rfeOverdue signal.
 */
export async function findCasesWithRfeOverdue(
  caseIds: string[],
): Promise<string[]> {
  if (caseIds.length === 0) return [];
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("case_documents")
    .select("case_id")
    .in("case_id", caseIds)
    .in("status", ["rejected", "uploaded"])
    .not("correction_due_at", "is", null)
    .lt("correction_due_at", now);
  if (error) throw new Error(`cases.repository: findCasesWithRfeOverdue — ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.case_id))];
}

/**
 * Returns the set of caseIds that have an RFE in progress but NOT yet overdue.
 *
 * In progress = case_documents with:
 *   - status = 'rejected'  — awaiting client re-submission
 *   - correction_due_at IS NOT NULL AND correction_due_at >= now()
 *
 * Used by getCaseBoardAlerts → rfeInProgress signal (amber left rail on the card).
 */
export async function findCasesWithRfeInProgress(
  caseIds: string[],
): Promise<string[]> {
  if (caseIds.length === 0) return [];
  const supabase = createServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("case_documents")
    .select("case_id")
    .in("case_id", caseIds)
    .eq("status", "rejected")
    .not("correction_due_at", "is", null)
    .gte("correction_due_at", now);
  if (error) throw new Error(`cases.repository: findCasesWithRfeInProgress — ${error.message}`);
  return [...new Set((data ?? []).map((r) => r.case_id))];
}
