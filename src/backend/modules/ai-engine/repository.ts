/**
 * ai-engine module — repository (data access layer).
 *
 * Single-writer rule: ai-engine is the ONLY module that writes to:
 *   - ai_generation_runs
 *   - document_extractions
 *   - document_translations
 *
 * Other modules read these tables (cases prefill, expediente items).
 * This module reads (but never writes) case_documents and case_form_responses.
 *
 * Client choice:
 *   - Jobs (executeGenerationJob, executeExtractionJob, executeTranslationJob):
 *     createServiceClient — bypasses RLS, correct for server-side job runners.
 *   - User-facing reads (getRunsForCase, sumCosts):
 *     createServiceClient with explicit org_id filter (RLS enforced at service layer).
 *
 * DOC-42 §4.
 *
 * @module ai-engine/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { toVectorLiteral } from "@/backend/platform/embeddings";
import { DEFAULT_TZ } from "@/shared/period";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import type { ConfigSnapshot, ChunkProgress, SectionedProgress, DatasetItem } from "./domain";

// ---------------------------------------------------------------------------
// Row type aliases
// ---------------------------------------------------------------------------

export type GenerationRunRow = Tables<"ai_generation_runs">;
export type DocumentExtractionRow = Tables<"document_extractions">;
export type DocumentTranslationRow = Tables<"document_translations">;
export type DatasetItemRow = Tables<"ai_dataset_items">;
export type GenerationConfigRow = Tables<"ai_generation_configs">;

/**
 * Loads the ai_generation_config for a form definition. The ai-engine reads this
 * (catalog owns the editing) to freeze a real config_snapshot at run start.
 */
export async function findGenerationConfig(
  formDefinitionId: string,
): Promise<GenerationConfigRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("ai_generation_configs")
    .select("*")
    .eq("form_definition_id", formDefinitionId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, formDefinitionId }, "ai-engine: findGenerationConfig failed");
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Ola 3 — per-case questionnaire generation (config + instances)
// ai-engine is the single writer of case_questionnaire_instances (like
// document_extractions); catalog owns the config editing, ai-engine reads it.
// ---------------------------------------------------------------------------

export type QuestionnaireGenConfigRow = Tables<"questionnaire_generation_configs">;
export type QuestionnaireInstanceRow = Tables<"case_questionnaire_instances">;

/** Reads a questionnaire's generation config (catalog owns editing; ai-engine reads). */
export async function findQuestionnaireGenerationConfig(
  formDefinitionId: string,
): Promise<QuestionnaireGenConfigRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("questionnaire_generation_configs")
    .select("*")
    .eq("form_definition_id", formDefinitionId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, formDefinitionId }, "ai-engine: findQuestionnaireGenerationConfig failed");
    return null;
  }
  return data;
}

/** The current (latest) questionnaire instance for a (case, form, party). */
export async function findCurrentQuestionnaireInstance(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<QuestionnaireInstanceRow | null> {
  const client = createServiceClient();
  let q = client
    .from("case_questionnaire_instances")
    .select("*")
    .eq("case_id", caseId)
    .eq("form_definition_id", formDefinitionId)
    .eq("is_current", true);
  q = partyId ? q.eq("party_id", partyId) : q.is("party_id", null);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

export async function findQuestionnaireInstanceById(
  id: string,
): Promise<QuestionnaireInstanceRow | null> {
  const client = createServiceClient();
  const { data } = await client
    .from("case_questionnaire_instances")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Next version number for a (case, form, party) instance chain. */
export async function nextQuestionnaireInstanceVersion(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<number> {
  const client = createServiceClient();
  let q = client
    .from("case_questionnaire_instances")
    .select("version")
    .eq("case_id", caseId)
    .eq("form_definition_id", formDefinitionId)
    .order("version", { ascending: false })
    .limit(1);
  q = partyId ? q.eq("party_id", partyId) : q.is("party_id", null);
  const { data } = await q;
  const max = (data?.[0] as { version?: number } | undefined)?.version ?? 0;
  return max + 1;
}

/**
 * Creates a NEW current instance, demoting any prior current one first (the
 * partial unique index `case_qn_instance_current_uidx` allows only one is_current
 * per case/form/party). Conflict-safe: if a concurrent call already claimed the
 * current slot (unique violation 23505 — two simultaneous first-opens), re-reads
 * and returns THAT instance instead of throwing, so the caller stays idempotent
 * and never double-generates (the job dedupe on case/form/party finishes the job).
 */
export async function createQuestionnaireInstance(
  row: TablesInsert<"case_questionnaire_instances">,
): Promise<QuestionnaireInstanceRow> {
  const client = createServiceClient();
  let demote = client
    .from("case_questionnaire_instances")
    .update({ is_current: false })
    .eq("case_id", row.case_id)
    .eq("form_definition_id", row.form_definition_id)
    .eq("is_current", true);
  demote = row.party_id ? demote.eq("party_id", row.party_id) : demote.is("party_id", null);
  await demote;

  const { data, error } = await client
    .from("case_questionnaire_instances")
    .insert({ ...row, is_current: true })
    .select()
    .single();
  if (error || !data) {
    if ((error as { code?: string } | null)?.code === "23505") {
      const existing = await findCurrentQuestionnaireInstance(row.case_id, row.form_definition_id, row.party_id ?? null);
      if (existing) return existing;
    }
    throw new Error(`createQuestionnaireInstance failed: ${error?.message}`);
  }
  return data;
}

/**
 * Meta the on_new_evidence watcher needs about an uploaded document: its
 * requirement slug + party. Accepts both PostgREST embed shapes (object or
 * array — lesson of `30515ea`). Returns null when the document is gone or is a
 * free upload (no requirement).
 */
export async function findCaseDocumentMeta(
  caseDocumentId: string,
): Promise<{ requirementSlug: string | null; partyId: string | null } | null> {
  const client = createServiceClient();
  const { data } = await client
    .from("case_documents")
    .select("party_id, required_document_types(slug)")
    .eq("id", caseDocumentId)
    .maybeSingle();
  if (!data) return null;
  const rel = (data as { required_document_types?: { slug?: string } | Array<{ slug?: string }> | null })
    .required_document_types;
  const requirementSlug = (Array.isArray(rel) ? rel[0]?.slug : rel?.slug) ?? null;
  return { requirementSlug, partyId: (data as { party_id: string | null }).party_id ?? null };
}

/** Current READY questionnaire instances of a case — the ones a newly uploaded
 *  input document can turn stale. */
export async function listCurrentReadyQuestionnaireInstances(
  caseId: string,
): Promise<QuestionnaireInstanceRow[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_questionnaire_instances")
    .select("*")
    .eq("case_id", caseId)
    .eq("is_current", true)
    .eq("status", "ready");
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: listCurrentReadyQuestionnaireInstances failed");
    return [];
  }
  return (data ?? []) as QuestionnaireInstanceRow[];
}

export async function updateQuestionnaireInstance(
  id: string,
  patch: TablesUpdate<"case_questionnaire_instances">,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client.from("case_questionnaire_instances").update(patch).eq("id", id);
  if (error) logger.error({ err: error, id }, "ai-engine: updateQuestionnaireInstance failed");
}

/**
 * Of `slugs`, returns those with a submitted/approved response for this case
 * (used to evaluate questionnaire prerequisites, e.g. "the I-589 is completed").
 * A per-party prereq is satisfied by the matching party OR a case-level response.
 */
export async function findSubmittedFormSlugs(
  caseId: string,
  slugs: string[],
  partyId: string | null,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (slugs.length === 0) return out;
  const client = createServiceClient();
  const { data } = await client
    .from("case_form_responses")
    .select("status, party_id, form_definitions!inner(slug)")
    .eq("case_id", caseId)
    .in("form_definitions.slug", slugs)
    .in("status", ["submitted", "approved"]);
  const rows = (data ?? []) as Array<{ status: string; party_id: string | null; form_definitions: { slug: string } | null }>;
  for (const r of rows) {
    const slug = r.form_definitions?.slug;
    if (!slug) continue;
    if (partyId == null || r.party_id === partyId || r.party_id == null) out.add(slug);
  }
  return out;
}

/** The Spanish text of every published (base) question of a form — used by hybrid
 *  mode to tell the generator which questions are already covered. */
export async function listPublishedQuestionTexts(formDefinitionId: string): Promise<string[]> {
  const client = createServiceClient();
  const { data: ver } = await client
    .from("form_automation_versions")
    .select("id")
    .eq("form_definition_id", formDefinitionId)
    .eq("status", "published")
    .maybeSingle();
  const versionId = (ver as { id?: string } | null)?.id;
  if (!versionId) return [];
  const { data } = await client
    .from("form_questions")
    .select("question_i18n, form_question_groups!inner(automation_version_id)")
    .eq("form_question_groups.automation_version_id", versionId);
  const rows = (data ?? []) as Array<{ question_i18n: { es?: string; en?: string } | null }>;
  return rows.map((r) => r.question_i18n?.es ?? r.question_i18n?.en ?? "").filter(Boolean);
}

/** A question + its version, loaded for the T5 "Mejorar con IA" flow. Read-only
 *  consumption of catalog config (same precedent as resolveAiFields). */
export interface QuestionForImprove {
  id: string;
  question_i18n: { es?: string; en?: string } | null;
  field_type: string;
  ai_improve: { instruction?: string } | null;
  version: { id: string; status: string; form_definition_id: string };
}

export async function findQuestionForImprove(questionId: string): Promise<QuestionForImprove | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("form_questions")
    .select(
      "id, question_i18n, field_type, ai_improve, form_question_groups!inner(form_automation_versions!inner(id, status, form_definition_id))",
    )
    .eq("id", questionId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, questionId }, "ai-engine: findQuestionForImprove failed");
    return null;
  }
  if (!data) return null;

  // PostgREST returns 1:1 embeds as objects, but be tolerant of array shape
  // (same defense as the cases module — see commit 30515ea).
  const row = data as unknown as {
    id: string;
    question_i18n: { es?: string; en?: string } | null;
    field_type: string;
    ai_improve: { instruction?: string } | null;
    form_question_groups:
      | { form_automation_versions: QuestionForImprove["version"] | QuestionForImprove["version"][] }
      | Array<{ form_automation_versions: QuestionForImprove["version"] | QuestionForImprove["version"][] }>;
  };
  const group = Array.isArray(row.form_question_groups)
    ? row.form_question_groups[0]
    : row.form_question_groups;
  const version = Array.isArray(group?.form_automation_versions)
    ? group.form_automation_versions[0]
    : group?.form_automation_versions;
  if (!version) return null;

  return {
    id: row.id,
    question_i18n: row.question_i18n,
    field_type: row.field_type,
    ai_improve: row.ai_improve,
    version,
  };
}

// ---------------------------------------------------------------------------
// Generation runs
// ---------------------------------------------------------------------------

/**
 * Returns a run by id, including the case's org_id (resolved via JOIN).
 * org_id is needed for the concurrency gate (DOC-42 §3.2) and cost tracking.
 */
export async function findRunById(
  runId: string,
): Promise<(GenerationRunRow & { orgId: string }) | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("ai_generation_runs")
    .select("*, cases!inner(org_id)")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, runId }, "ai-engine: findRunById failed");
    return null;
  }
  if (!data) return null;

  const { cases, ...run } = data as GenerationRunRow & { cases: { org_id: string } };
  return { ...run, orgId: cases.org_id };
}

/**
 * Finds a run in status queued or running for the exact (case, form, party) tuple.
 * Used to prevent duplicate active runs (DOC-42 §3.1 — RF-DIA-017 A3).
 *
 * party_id null comparison is explicit (IS NULL vs = NULL difference in SQL).
 */
export async function findActiveRun(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<GenerationRunRow | null> {
  const client = createServiceClient();
  let query = client
    .from("ai_generation_runs")
    .select("*")
    .eq("case_id", caseId)
    .eq("form_definition_id", formDefinitionId)
    .in("status", ["queued", "running"]);

  if (partyId === null) {
    query = query.is("party_id", null);
  } else {
    query = query.eq("party_id", partyId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    logger.error({ err: error }, "ai-engine: findActiveRun failed");
    return null;
  }
  return data ?? null;
}

/**
 * Returns the maximum version for a (case, form, party) tuple.
 * Called inside insertRun to compute version = max + 1.
 */
export async function maxVersion(
  caseId: string,
  formDefinitionId: string,
  partyId: string | null,
): Promise<number | null> {
  const client = createServiceClient();
  let query = client
    .from("ai_generation_runs")
    .select("version")
    .eq("case_id", caseId)
    .eq("form_definition_id", formDefinitionId)
    .order("version", { ascending: false })
    .limit(1);

  if (partyId === null) {
    query = query.is("party_id", null);
  } else {
    query = query.eq("party_id", partyId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data?.version ?? null;
}

/**
 * Inserts a new generation run in status 'queued'.
 */
export async function insertRun(
  input: TablesInsert<"ai_generation_runs">,
): Promise<GenerationRunRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("ai_generation_runs")
    .insert(input)
    .select()
    .single();

  if (error || !data) {
    // Preserve the Postgres error code: 23505 on uq_ai_runs_active_target is the
    // atomic single-active-run guard — the service maps it to AI_RUN_DUPLICATE.
    const err = new Error(`ai-engine: insertRun failed — ${error?.message}`) as Error & { code?: string };
    if (error?.code) err.code = error.code;
    throw err;
  }
  return data;
}

/**
 * Updates run status (simple state transition).
 * Uses conditional WHERE to avoid stomping on concurrent terminal writes.
 */
export async function updateRunStatus(
  runId: string,
  status: string,
  extra?: Partial<TablesUpdate<"ai_generation_runs">>,
  /** Optional WHERE-status guard to close TOCTOU windows (e.g. cancel only queued/running). */
  whereStatus?: string[],
): Promise<void> {
  const client = createServiceClient();
  let query = client
    .from("ai_generation_runs")
    .update({ status, updated_at: new Date().toISOString(), ...extra })
    .eq("id", runId);
  if (whereStatus && whereStatus.length > 0) {
    query = query.in("status", whereStatus);
  }
  const { error } = await query;

  if (error) {
    logger.error({ err: error, runId, status }, "ai-engine: updateRunStatus failed");
    throw new Error(`ai-engine: updateRunStatus failed — ${error.message}`);
  }
}

/**
 * Completes a run (terminal: completed). Conditional WHERE status='running'.
 * Returns rowsAffected so the caller can detect if another delivery already closed it.
 */
export async function completeRun(
  runId: string,
  terminal: {
    outputPath: string | null;
    outputText: string;
    outputSummary: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUsd: number | null;
  },
): Promise<{ rowsAffected: number }> {
  const client = createServiceClient();
  // .select("id") returns the affected rows. NOTE: Supabase JS only populates
  // `count` when { count: 'exact' } is passed; without it, count is null and
  // rowsAffected would always be 0 — which would suppress the generation.completed
  // event. We count the returned rows instead (conditional WHERE status='running'
  // makes the terminal transition atomic + tells us if another delivery won).
  const { error, data } = await client
    .from("ai_generation_runs")
    .update({
      status: "completed",
      output_path: terminal.outputPath,
      output_text: terminal.outputText,
      output_summary: terminal.outputSummary,
      model: terminal.model,
      input_tokens: terminal.inputTokens,
      output_tokens: terminal.outputTokens,
      cache_creation_input_tokens: terminal.cacheCreationInputTokens,
      cache_read_input_tokens: terminal.cacheReadInputTokens,
      cost_usd: terminal.costUsd,
      completed_at: new Date().toISOString(),
      progress: null, // clear checkpoint on close
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .eq("status", "running")
    .select("id");

  if (error) {
    logger.error({ err: error, runId }, "ai-engine: completeRun failed");
    throw new Error(`ai-engine: completeRun failed — ${error.message}`);
  }
  return { rowsAffected: data?.length ?? 0 };
}

/**
 * Marks a run as failed with an error message.
 * Idempotent: does not overwrite already-terminal states.
 */
export async function markRunFailed(runId: string, errorMsg: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("ai_generation_runs")
    .update({
      status: "failed",
      error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId)
    .in("status", ["queued", "running"]); // don't overwrite cancelled/completed

  if (error) {
    logger.error({ err: error, runId }, "ai-engine: markRunFailed failed");
  }
}

/**
 * Checks whether a run is in 'cancelled' state.
 * Called before writing output (DOC-42 §3.2 / DOC-26 §1.3.4).
 */
export async function isCancelled(runId: string): Promise<boolean> {
  const client = createServiceClient();
  const { data } = await client
    .from("ai_generation_runs")
    .select("status")
    .eq("id", runId)
    .single();
  return data?.status === "cancelled";
}

/**
 * Updates the progress (checkpoint) jsonb column for chunked runs.
 */
export async function updateRunProgress(
  runId: string,
  progress: ChunkProgress | SectionedProgress,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("ai_generation_runs")
    .update({
      progress: progress as unknown as import("@/shared/database.types").Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    logger.error({ err: error, runId }, "ai-engine: updateRunProgress failed");
  }
}

/**
 * Patches the config_snapshot jsonb with new fields (e.g. dataset_injection).
 *
 * NOTE: read-modify-write (not atomic). This is BENIGN here because the only
 * caller writes `dataset_injection` exactly once, guarded by an
 * `if (!snapshot.dataset_injection)` check before calling — concurrent chunk
 * continuations would write the identical value. If future fields need
 * concurrent patching, switch to a server-side `jsonb` merge (`||`).
 */
export async function patchConfigSnapshot(
  runId: string,
  patch: Partial<ConfigSnapshot>,
): Promise<void> {
  // Fetch current snapshot, merge patch, write back
  const client = createServiceClient();
  const { data, error: fetchErr } = await client
    .from("ai_generation_runs")
    .select("config_snapshot")
    .eq("id", runId)
    .single();

  if (fetchErr || !data) return;

  const merged = {
    ...(data.config_snapshot as object),
    ...patch,
  };

  const { error } = await client
    .from("ai_generation_runs")
    .update({
      config_snapshot: merged as import("@/shared/database.types").Json,
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);

  if (error) {
    logger.error({ err: error, runId }, "ai-engine: patchConfigSnapshot failed");
  }
}

/**
 * Counts running jobs for an org excluding the current run.
 * Used for the concurrency gate (max 2 per org, DOC-74 §2.4).
 */
export async function countRunningByOrg(
  orgId: string,
  excludeRunId: string,
): Promise<number> {
  const client = createServiceClient();
  const { count, error } = await client
    .from("ai_generation_runs")
    .select("id, cases!inner(org_id)", { count: "exact", head: true })
    .eq("status", "running")
    .eq("cases.org_id", orgId)
    .neq("id", excludeRunId);

  if (error) return 0;
  return count ?? 0;
}

/**
 * Lists all runs for a case, ordered for the generation history UI (DOC-42 §3.10).
 */
export async function listRunsForCase(
  caseId: string,
): Promise<GenerationRunRow[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("ai_generation_runs")
    .select("*")
    .eq("case_id", caseId)
    .order("form_definition_id", { ascending: true })
    .order("version", { ascending: false });

  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: listRunsForCase failed");
    return [];
  }
  return data ?? [];
}

/**
 * Sums cost_usd for the current calendar month across all 3 AI cost sources.
 * Used for the pre-check budget evaluation (DOC-42 §2.5).
 */
export async function sumMonthlyCosts(
  orgId: string,
  monthUtc: string, // "YYYY-MM"
): Promise<{ totalUsd: number; bySource: Record<string, number> }> {
  const client = createServiceClient();
  const startDate = `${monthUtc}-01T00:00:00.000Z`;
  const [year, month] = monthUtc.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const endDate = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00.000Z`;

  // Generation runs
  const { data: genData } = await client
    .from("ai_generation_runs")
    .select("cost_usd, cases!inner(org_id)")
    .eq("cases.org_id", orgId)
    .gte("created_at", startDate)
    .lt("created_at", endDate)
    .not("cost_usd", "is", null);

  // Extractions
  const { data: extData } = await client
    .from("document_extractions")
    .select("cost_usd, case_documents!inner(cases!inner(org_id))")
    .eq("case_documents.cases.org_id", orgId)
    .gte("created_at", startDate)
    .lt("created_at", endDate)
    .not("cost_usd", "is", null);

  // Translations
  const { data: transData } = await client
    .from("document_translations")
    .select("cost_usd, case_documents!inner(cases!inner(org_id))")
    .eq("case_documents.cases.org_id", orgId)
    .gte("created_at", startDate)
    .lt("created_at", endDate)
    .not("cost_usd", "is", null);

  // Questionnaire generation (Ola 3)
  const { data: qnData } = await client
    .from("case_questionnaire_instances")
    .select("cost_usd, cases!inner(org_id)")
    .eq("cases.org_id", orgId)
    .gte("created_at", startDate)
    .lt("created_at", endDate)
    .not("cost_usd", "is", null);

  const genTotal = (genData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const extTotal = (extData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const transTotal = (transData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const qnTotal = (qnData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  return {
    totalUsd: parseFloat((genTotal + extTotal + transTotal + qnTotal).toFixed(4)),
    bySource: {
      generations: parseFloat(genTotal.toFixed(4)),
      extractions: parseFloat(extTotal.toFixed(4)),
      translations: parseFloat(transTotal.toFixed(4)),
      questionnaires: parseFloat(qnTotal.toFixed(4)),
    },
  };
}

/**
 * Returns detailed cost breakdown for the admin panel (DOC-42 §3.11 / RF-ADM-005).
 */
export async function sumCosts(
  orgId: string,
  filters: { from: string; to: string },
): Promise<{
  totalUsd: number;
  bySource: Record<string, number>;
  byMonth: Record<string, number>;
}> {
  const client = createServiceClient();

  const { data: genData } = await client
    .from("ai_generation_runs")
    .select("cost_usd, created_at, model, is_test, cases!inner(org_id)")
    .eq("cases.org_id", orgId)
    .gte("created_at", filters.from)
    .lte("created_at", filters.to)
    .not("cost_usd", "is", null);

  const { data: extData } = await client
    .from("document_extractions")
    .select("cost_usd, created_at, model, case_documents!inner(cases!inner(org_id))")
    .eq("case_documents.cases.org_id", orgId)
    .gte("created_at", filters.from)
    .lte("created_at", filters.to)
    .not("cost_usd", "is", null);

  const { data: transData } = await client
    .from("document_translations")
    .select("cost_usd, created_at, model, case_documents!inner(cases!inner(org_id))")
    .eq("case_documents.cases.org_id", orgId)
    .gte("created_at", filters.from)
    .lte("created_at", filters.to)
    .not("cost_usd", "is", null);

  const allRows = [
    ...(genData ?? []).map((r) => ({ source: "generations", cost: r.cost_usd ?? 0, date: r.created_at })),
    ...(extData ?? []).map((r) => ({ source: "extractions", cost: r.cost_usd ?? 0, date: r.created_at })),
    ...(transData ?? []).map((r) => ({ source: "translations", cost: r.cost_usd ?? 0, date: r.created_at })),
  ];

  const bySource: Record<string, number> = {};
  const byMonth: Record<string, number> = {};
  let totalUsd = 0;

  for (const row of allRows) {
    totalUsd += row.cost;
    bySource[row.source] = (bySource[row.source] ?? 0) + row.cost;
    const month = row.date.slice(0, 7); // "YYYY-MM"
    byMonth[month] = (byMonth[month] ?? 0) + row.cost;
  }

  return {
    totalUsd: parseFloat(totalUsd.toFixed(4)),
    bySource,
    byMonth,
  };
}

// ---------------------------------------------------------------------------
// Detailed cost report (RF-ADM-005) — per-query rows for /admin/ai-costs.
// ---------------------------------------------------------------------------

/** One AI invocation (generation / extraction / translation) with its cost. */
export interface AiCostReportRow {
  id: string;
  source: "generations" | "extractions" | "translations";
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  model: string | null;
  status: string;
  isTest: boolean;
  createdAt: string;
  caseNumber: string | null;
  serviceLabel: string | null;
}

/** PostgREST may return a to-one embed as an object or a single-element array. */
function embeddedServiceLabel(services: unknown): string | null {
  if (!services) return null;
  const obj = Array.isArray(services) ? services[0] : services;
  const label = (obj as { label_i18n?: Record<string, string> | null } | undefined)?.label_i18n;
  return label?.es ?? label?.en ?? null;
}

interface GenEmbeddedRow {
  id: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_creation_input_tokens: number | null;
  model: string | null;
  status: string;
  is_test: boolean | null;
  created_at: string;
  cases: { case_number: string | null; services: unknown } | null;
}

interface DocEmbeddedRow {
  id: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  model: string | null;
  status: string;
  created_at: string;
  case_documents: { cases: { case_number: string | null; services: unknown } | null } | null;
}

/**
 * Pulls every AI invocation in [from, to) across the three engines, org-scoped
 * via the existing embeds (generations→cases, extractions/translations→
 * case_documents→cases), enriched with the case number and service label for
 * the per-query table and the by-service breakdown. Bounded by the period (AI
 * run volume is small), so the service aggregates these rows in JS — no RPC.
 */
export async function aiCostRows(orgId: string, fromIso: string, toIso: string): Promise<AiCostReportRow[]> {
  const client = createServiceClient();

  const [gen, ext, trans] = await Promise.all([
    client
      .from("ai_generation_runs")
      .select(
        "id, cost_usd, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model, status, is_test, created_at, cases!inner(case_number, org_id, services(label_i18n))",
      )
      .eq("cases.org_id", orgId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .not("cost_usd", "is", null),
    client
      .from("document_extractions")
      .select(
        "id, cost_usd, input_tokens, output_tokens, model, status, created_at, case_documents!inner(cases!inner(case_number, org_id, services(label_i18n)))",
      )
      .eq("case_documents.cases.org_id", orgId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .not("cost_usd", "is", null),
    client
      .from("document_translations")
      .select(
        "id, cost_usd, input_tokens, output_tokens, model, status, created_at, case_documents!inner(cases!inner(case_number, org_id, services(label_i18n)))",
      )
      .eq("case_documents.cases.org_id", orgId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .not("cost_usd", "is", null),
  ]);

  if (gen.error) throw gen.error;
  if (ext.error) throw ext.error;
  if (trans.error) throw trans.error;

  const rows: AiCostReportRow[] = [];

  for (const r of (gen.data ?? []) as unknown as GenEmbeddedRow[]) {
    rows.push({
      id: r.id,
      source: "generations",
      costUsd: Number(r.cost_usd ?? 0),
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
      cacheTokens: (r.cache_read_input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0),
      model: r.model,
      status: r.status,
      isTest: r.is_test ?? false,
      createdAt: r.created_at,
      caseNumber: r.cases?.case_number ?? null,
      serviceLabel: embeddedServiceLabel(r.cases?.services),
    });
  }

  for (const list of [
    { data: ext.data, source: "extractions" as const },
    { data: trans.data, source: "translations" as const },
  ]) {
    for (const r of (list.data ?? []) as unknown as DocEmbeddedRow[]) {
      const c = r.case_documents?.cases;
      rows.push({
        id: r.id,
        source: list.source,
        costUsd: Number(r.cost_usd ?? 0),
        inputTokens: r.input_tokens ?? 0,
        outputTokens: r.output_tokens ?? 0,
        cacheTokens: 0,
        model: r.model,
        status: r.status,
        isTest: false, // extractions/translations have no is_test column (Gemini, never editor previews)
        createdAt: r.created_at,
        caseNumber: c?.case_number ?? null,
        serviceLabel: embeddedServiceLabel(c?.services),
      });
    }
  }

  return rows;
}

/** Org timezone + AI monthly budget (USD) from settings; both fall back. */
export async function getOrgCostContext(orgId: string): Promise<{ tz: string; budgetUsd: number }> {
  const client = createServiceClient();
  const { data } = await client.from("orgs").select("settings").eq("id", orgId).single();
  const settings = (data?.settings ?? {}) as { default_timezone?: string; ai_budget_usd?: number };
  const budget = settings.ai_budget_usd;
  return {
    tz: settings.default_timezone ?? DEFAULT_TZ,
    budgetUsd: typeof budget === "number" && budget > 0 ? budget : 500,
  };
}

// ---------------------------------------------------------------------------
// Document extractions
// ---------------------------------------------------------------------------

/**
 * Finds an extraction by case_document_id (1:1 table).
 */
export async function findExtraction(
  caseDocumentId: string,
): Promise<DocumentExtractionRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("document_extractions")
    .select("*")
    .eq("case_document_id", caseDocumentId)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, caseDocumentId }, "ai-engine: findExtraction failed");
    return null;
  }
  return data ?? null;
}

/**
 * Upserts an extraction row (ON CONFLICT case_document_id).
 * The 1:1 UNIQUE ensures idempotence — re-running never creates a duplicate.
 */
export async function upsertExtraction(
  row: TablesInsert<"document_extractions">,
): Promise<DocumentExtractionRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("document_extractions")
    .upsert(row, { onConflict: "case_document_id" })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`ai-engine: upsertExtraction failed — ${error?.message}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Document translations
// ---------------------------------------------------------------------------

/**
 * Finds a translation by (case_document_id, direction).
 */
export async function findTranslation(
  caseDocumentId: string,
  direction: string,
): Promise<DocumentTranslationRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("document_translations")
    .select("*")
    .eq("case_document_id", caseDocumentId)
    .eq("direction", direction)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, caseDocumentId, direction }, "ai-engine: findTranslation failed");
    return null;
  }
  return data ?? null;
}

/**
 * Finds a translation by its own id.
 */
export async function findTranslationById(
  id: string,
): Promise<DocumentTranslationRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("document_translations")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

/**
 * Inserts a new translation row (no upsert — INSERT raises unique_violation
 * on concurrent requests, which is the mutex signal, DOC-42 §3.7).
 */
export async function insertTranslation(
  row: TablesInsert<"document_translations">,
): Promise<DocumentTranslationRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("document_translations")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`ai-engine: insertTranslation — ${error?.message}`);
  }
  return data;
}

/**
 * Resets a failed translation to processing for retry.
 */
export async function resetTranslation(
  id: string,
  patch: Partial<TablesUpdate<"document_translations">>,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("document_translations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    logger.error({ err: error, id }, "ai-engine: resetTranslation failed");
    throw new Error(`ai-engine: resetTranslation failed — ${error.message}`);
  }
}

/**
 * Completes a translation. Conditional WHERE status='processing'.
 */
export async function completeTranslation(
  id: string,
  terminal: {
    status: "completed";
    translatedText: string;
    translatedPdfPath: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    completedAt: string;
  },
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("document_translations")
    .update({
      status: terminal.status,
      translated_text: terminal.translatedText,
      translated_pdf_path: terminal.translatedPdfPath,
      model: terminal.model,
      input_tokens: terminal.inputTokens,
      output_tokens: terminal.outputTokens,
      cost_usd: terminal.costUsd,
      completed_at: terminal.completedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "processing");

  if (error) {
    logger.error({ err: error, id }, "ai-engine: completeTranslation failed");
    throw new Error(`ai-engine: completeTranslation failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Cross-module reads (read-only; mutations belong to cases module)
// ---------------------------------------------------------------------------

export interface CaseDocumentForAi {
  id: string;
  caseId: string;
  /** The case's service_id — used to load the per-service translation signing config. */
  serviceId: string | null;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  requiredDocumentType: {
    aiExtract: boolean;
    extractionSchema: Record<string, unknown> | null;
    slug: string;
  } | null;
}

/**
 * Fetches a case_document with its required_document_type for extraction.
 * Read-only: mutations belong to the cases module.
 */
export async function getCaseDocumentForAi(
  caseDocumentId: string,
): Promise<CaseDocumentForAi | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_documents")
    .select(
      "id, case_id, storage_path, mime_type, size_bytes, required_document_types(ai_extract, extraction_schema, slug), cases(service_id)",
    )
    .eq("id", caseDocumentId)
    .maybeSingle();

  if (error || !data) return null;

  const rdt = Array.isArray(data.required_document_types)
    ? data.required_document_types[0]
    : data.required_document_types;
  const caseRow = Array.isArray(data.cases) ? data.cases[0] : data.cases;

  return {
    id: data.id,
    caseId: data.case_id,
    serviceId: caseRow?.service_id ?? null,
    storagePath: data.storage_path,
    mimeType: data.mime_type ?? "application/pdf",
    sizeBytes: data.size_bytes ?? 0,
    requiredDocumentType: rdt
      ? {
          aiExtract: rdt.ai_extract ?? false,
          extractionSchema: rdt.extraction_schema as Record<string, unknown> | null,
          slug: rdt.slug ?? "",
        }
      : null,
  };
}

/**
 * Returns the best available text source for translation:
 * raw_text from extraction if completed, else null (caller falls back to PDF).
 */
export async function getTranslationSource(
  caseDocumentId: string,
): Promise<{ rawText: string | null; storagePath: string | null; mimeType: string | null }> {
  const client = createServiceClient();

  const { data: extraction } = await client
    .from("document_extractions")
    .select("raw_text, status")
    .eq("case_document_id", caseDocumentId)
    .maybeSingle();

  if (extraction?.status === "completed" && extraction.raw_text) {
    return { rawText: extraction.raw_text, storagePath: null, mimeType: null };
  }

  // Fall back to the PDF itself
  const { data: doc } = await client
    .from("case_documents")
    .select("storage_path, mime_type")
    .eq("id", caseDocumentId)
    .maybeSingle();

  return {
    rawText: null,
    storagePath: doc?.storage_path ?? null,
    mimeType: doc?.mime_type ?? null,
  };
}

/**
 * Loads dataset items for a dataset, excluding items without token_count.
 */
export async function loadDatasetItems(
  datasetId: string | null,
): Promise<DatasetItem[]> {
  if (!datasetId) return [];

  const client = createServiceClient();
  const { data, error } = await client
    .from("ai_dataset_items")
    .select("id, title, content, tags, outcome, token_count, created_at, jurisdiction, meta")
    .eq("dataset_id", datasetId)
    .not("token_count", "is", null);

  if (error) {
    logger.error({ err: error, datasetId }, "ai-engine: loadDatasetItems failed");
    return [];
  }

  return (data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    tags: item.tags ?? [],
    outcome: item.outcome,
    token_count: item.token_count!,
    created_at: item.created_at,
    jurisdiction: item.jurisdiction,
    meta: ((item as { meta?: unknown }).meta ?? {}) as import("./domain").DatasetItemMeta,
  }));
}

/**
 * Loads resolved inputs (extraction payloads, form answers) from config_snapshot.
 */
export async function loadResolvedInputs(snapshot: ConfigSnapshot): Promise<{
  documents: Array<{
    slug: string;
    extractionPayload: Record<string, unknown>;
    rawText: string;
    label?: string;
  }>;
  forms: Array<{
    slug: string;
    answers: Record<string, unknown>;
  }>;
}> {
  const client = createServiceClient();
  const documents = [];
  const forms = [];

  for (const docRef of snapshot.resolved_inputs.documents) {
    const { data } = await client
      .from("document_extractions")
      .select("payload, raw_text")
      .eq("id", docRef.extraction_id)
      .maybeSingle();

    if (data) {
      // File label so an allow_multiple slug's N documents stay distinguishable
      // in the prompt ("[n/N] — label"). Best-effort: a deleted row → no label.
      const { data: docRow } = await client
        .from("case_documents")
        .select("display_name, original_filename")
        .eq("id", docRef.case_document_id)
        .maybeSingle();
      const label =
        (docRow as { display_name?: string | null; original_filename?: string | null } | null)
          ?.display_name ??
        (docRow as { original_filename?: string | null } | null)?.original_filename ??
        undefined;

      documents.push({
        slug: docRef.slug,
        extractionPayload: (data.payload as Record<string, unknown>) ?? {},
        rawText: data.raw_text ?? "",
        ...(label ? { label } : {}),
      });
    }
  }

  for (const formRef of snapshot.resolved_inputs.forms) {
    const { data } = await client
      .from("case_form_responses")
      .select("answers")
      .eq("id", formRef.response_id)
      .maybeSingle();

    if (data) {
      const rawAnswers = (data.answers as Record<string, unknown>) ?? {};
      // Re-key by human-readable question text so the prompt reads
      // "¿Pregunta?: respuesta" instead of "uuid: respuesta" (the AI needs wording).
      const labels = await loadQuestionLabelsForResponse(formRef.response_id);
      const answers: Record<string, unknown> = {};
      for (const [questionId, value] of Object.entries(rawAnswers)) {
        answers[labels.get(questionId) ?? questionId] = value;
      }
      forms.push({ slug: formRef.slug, answers });
    }
  }

  return { documents, forms };
}

/**
 * Resolves a generation config's `input_form_slugs` / `input_document_slugs` to
 * concrete case rows for THIS case+party, producing the `resolved_inputs` that
 * `startGeneration` freezes into the run snapshot (DOC-42 §3.1). Until now this
 * was left empty, so the companion-questionnaire answers (and document
 * extractions) never reached the prompt — the bug behind "editing an answer
 * doesn't change the letter".
 *
 * - forms: the client's `case_form_responses` for each `input_form_slug`, matched
 *   by party (a per-party letter falls back to a case-level questionnaire).
 * - documents: ALL active `case_documents` for each requirement slug (upload
 *   order), each with its completed extraction. allow_multiple requirements
 *   (e.g. evidencias-sustentatorias) upload several coexisting files and every
 *   one must reach the prompt — resolving only the newest silently dropped the
 *   rest. Capped at MAX_DOCS_PER_INPUT_SLUG (keeps the newest, warns).
 *
 * Degrades gracefully: an unmatched slug is simply omitted (letter generates with
 * whatever resolved), never throws.
 */
const MAX_DOCS_PER_INPUT_SLUG = 10;

export async function resolveGenerationInputs(
  caseId: string,
  partyId: string | null,
  formSlugs: string[],
  docSlugs: string[],
): Promise<ConfigSnapshot["resolved_inputs"]> {
  const client = createServiceClient();
  const forms: ConfigSnapshot["resolved_inputs"]["forms"] = [];
  const documents: ConfigSnapshot["resolved_inputs"]["documents"] = [];

  // FORMS — case_form_responses ⋈ form_definitions by slug (this case).
  if (formSlugs.length > 0) {
    const { data } = await client
      .from("case_form_responses")
      .select("id, party_id, form_definitions!inner(slug)")
      .eq("case_id", caseId)
      .in("form_definitions.slug", formSlugs);
    const rows = (data ?? []) as Array<{ id: string; party_id: string | null; form_definitions: { slug: string } | null }>;
    for (const slug of formSlugs) {
      const candidates = rows.filter((r) => r.form_definitions?.slug === slug);
      // Prefer the party-specific response; fall back to a case-level (null-party) one.
      const match =
        partyId != null
          ? (candidates.find((r) => r.party_id === partyId) ?? candidates.find((r) => r.party_id === null))
          : candidates.find((r) => r.party_id === null);
      if (match) forms.push({ slug, response_id: match.id });
    }
  }

  // DOCUMENTS — every active case_document per requirement slug (upload order)
  // + each one's latest completed extraction.
  for (const slug of docSlugs) {
    let q = client
      .from("case_documents")
      .select("id, required_document_types!inner(slug)")
      .eq("case_id", caseId)
      .eq("required_document_types.slug", slug)
      .in("status", ["uploaded", "approved"])
      .order("created_at", { ascending: true });
    q = partyId ? q.eq("party_id", partyId) : q.is("party_id", null);
    const { data: docs } = await q;
    let rows = (docs ?? []) as Array<{ id?: string }>;
    if (rows.length > MAX_DOCS_PER_INPUT_SLUG) {
      logger.warn(
        { caseId, slug, count: rows.length, cap: MAX_DOCS_PER_INPUT_SLUG },
        "ai-engine: input documents exceed cap; keeping the newest",
      );
      rows = rows.slice(rows.length - MAX_DOCS_PER_INPUT_SLUG);
    }
    for (const row of rows) {
      if (!row.id) continue;
      const { data: ext } = await client
        .from("document_extractions")
        .select("id")
        .eq("case_document_id", row.id)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(1);
      const extractionId = (ext?.[0] as { id?: string } | undefined)?.id;
      if (extractionId) documents.push({ slug, case_document_id: row.id, extraction_id: extractionId });
    }
  }

  return { documents, forms };
}

/**
 * Loads the `{questionId → question text (es)}` map for a form response, so
 * loadResolvedInputs can re-key the answers by human-readable question wording
 * instead of raw UUIDs (the AI prompt needs the question, not the id).
 */
async function loadQuestionLabelsForResponse(responseId: string): Promise<Map<string, string>> {
  const client = createServiceClient();
  const { data: resp } = await client
    .from("case_form_responses")
    .select("automation_version_id, questionnaire_instance_id, form_definition_id")
    .eq("id", responseId)
    .maybeSingle();
  const r = resp as {
    automation_version_id?: string | null;
    questionnaire_instance_id?: string | null;
    form_definition_id?: string | null;
  } | null;
  const labels = new Map<string, string>();

  // form_questions of a frozen automation version (global / pdf forms). For an Ola 3
  // dynamic questionnaire, also fold in the published version's labels so a HYBRID
  // form's base-question answers are re-keyed too (not just the AI-generated ones).
  const versionIds = new Set<string>();
  if (r?.automation_version_id) versionIds.add(r.automation_version_id);
  if (r?.questionnaire_instance_id && r?.form_definition_id) {
    const { data: pub } = await client
      .from("form_automation_versions")
      .select("id")
      .eq("form_definition_id", r.form_definition_id)
      .eq("status", "published")
      .maybeSingle();
    const pubId = (pub as { id?: string } | null)?.id;
    if (pubId) versionIds.add(pubId);
  }
  for (const versionId of versionIds) {
    const { data } = await client
      .from("form_questions")
      .select("id, question_i18n, form_question_groups!inner(automation_version_id)")
      .eq("form_question_groups.automation_version_id", versionId);
    for (const row of (data ?? []) as Array<{ id: string; question_i18n: unknown }>) {
      const q = row.question_i18n as { es?: string; en?: string } | null;
      const text = q?.es || q?.en;
      if (text) labels.set(row.id, text);
    }
  }

  // Ola 3 — AI-generated questions live in the instance schema (jsonb), not
  // form_questions. Re-key those answers by their question text too.
  if (r?.questionnaire_instance_id) {
    const { data: inst } = await client
      .from("case_questionnaire_instances")
      .select("schema")
      .eq("id", r.questionnaire_instance_id)
      .maybeSingle();
    const schema = (inst as { schema?: unknown } | null)?.schema as {
      groups?: Array<{ questions?: Array<{ id?: string; question_i18n?: { es?: string; en?: string } }> }>;
    } | null;
    for (const g of schema?.groups ?? []) {
      for (const q of g.questions ?? []) {
        const text = q.question_i18n?.es || q.question_i18n?.en;
        if (q.id && text) labels.set(q.id, text);
      }
    }
  }

  return labels;
}

// ---------------------------------------------------------------------------
// Semantic retrieval — match_dataset_items RPC (Etapa D / Pre-Mortem)
// ---------------------------------------------------------------------------

/**
 * Calls the pgvector RPC `match_dataset_items` to retrieve the k most similar
 * dataset items for the given embedding query vector.
 *
 * IMPORTANT: the client.rpc call MUST be inline (not destructured) — see project
 * MEMORY: "NEVER desligar un método de su objeto".
 *
 * Degrades to [] on any error (caller falls back to lexical selectDatasetItems).
 */
export async function matchDatasetItems(
  datasetId: string,
  queryEmbedding: number[],
  k: number,
  filterTags: string[] | null,
): Promise<Array<DatasetItem & { similarity: number }>> {
  if (!datasetId || queryEmbedding.length === 0) return [];

  const client = createServiceClient();
  const { data, error } = await client.rpc("match_dataset_items", {
    query_embedding: toVectorLiteral(queryEmbedding),
    p_dataset_id: datasetId,
    match_count: k,
    filter_tags: filterTags ?? undefined,
  });

  if (error) {
    logger.error({ err: error, datasetId, k }, "ai-engine: matchDatasetItems RPC failed");
    return [];
  }

  return ((data as Array<Record<string, unknown>>) ?? []).map((row) => ({
    id: row["id"] as string,
    title: row["title"] as string,
    content: (row["content"] as string | null) ?? null,
    tags: (row["tags"] as string[]) ?? [],
    outcome: (row["outcome"] as string | null) ?? null,
    jurisdiction: (row["jurisdiction"] as string | null) ?? null,
    token_count: (row["token_count"] as number | null) ?? 0,
    meta: ((row["meta"] as import("./domain").DatasetItemMeta | undefined) ?? {}) as import("./domain").DatasetItemMeta,
    created_at: new Date().toISOString(), // not returned by RPC; set to now as placeholder
    similarity: row["similarity"] as number,
  }));
}

// ---------------------------------------------------------------------------
// Pre-Mortem assessments CRUD (Etapa D)
// ---------------------------------------------------------------------------

export type PreMortemAssessmentRow = Tables<"case_pre_mortem_assessments">;

/**
 * Inserts a new pre-mortem assessment row.
 * Uses createServiceClient (service-role) — this call is server-side only.
 */
export async function insertPreMortemAssessment(
  row: TablesInsert<"case_pre_mortem_assessments">,
): Promise<{ id: string; created_at: string }> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .insert(row)
    .select("id, created_at")
    .single();

  if (error || !data) {
    throw new Error(`ai-engine: insertPreMortemAssessment failed — ${error?.message}`);
  }
  return { id: data.id, created_at: data.created_at };
}

/**
 * Lists all pre-mortem assessments for a case, newest first.
 */
export async function listPreMortemAssessmentsForCase(
  caseId: string,
): Promise<PreMortemAssessmentRow[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .select("*")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: listPreMortemAssessmentsForCase failed");
    return [];
  }
  return data ?? [];
}

/**
 * Inserts a 'queued' pre-mortem assessment row — the enqueue act IS the
 * concurrency claim: the partial unique index uq_premortem_active_target
 * (one queued/running row per artifact) turns a concurrent second start into
 * a 23505, surfaced to the caller as "duplicate".
 */
export async function insertPreMortemQueued(
  row: TablesInsert<"case_pre_mortem_assessments">,
): Promise<{ id: string; created_at: string } | "duplicate"> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .insert({ ...row, status: "queued" })
    .select("id, created_at")
    .single();

  if (error) {
    if (error.code === "23505") return "duplicate";
    throw new Error(`ai-engine: insertPreMortemQueued failed — ${error.message}`);
  }
  if (!data) throw new Error("ai-engine: insertPreMortemQueued returned no row");
  return { id: data.id, created_at: data.created_at };
}

export async function findPreMortemAssessmentById(
  id: string,
): Promise<PreMortemAssessmentRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, id }, "ai-engine: findPreMortemAssessmentById failed");
    return null;
  }
  return data ?? null;
}

/**
 * Atomic claim queued→running. Returns false when another QStash delivery
 * already claimed the row (or it reached a terminal state) — the caller MUST
 * skip without calling the provider (at-least-once delivery, single spend).
 */
export async function claimPreMortemAssessment(id: string): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (error) {
    logger.error({ err: error, id }, "ai-engine: claimPreMortemAssessment failed");
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Reverts running→queued so a QStash retry can re-claim after a call failure
 * that produced nothing (timeout/5xx). Guarded: never resurrects a terminal row.
 */
export async function requeuePreMortemAssessment(id: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "queued", started_at: null })
    .eq("id", id)
    .eq("status", "running");
  if (error) {
    logger.error({ err: error, id }, "ai-engine: requeuePreMortemAssessment failed");
  }
}

/**
 * Cancels a QUEUED validation (user regret). Running rows are not cancellable —
 * the provider call is already in flight and paid. Returns whether a row changed.
 */
export async function cancelQueuedPreMortemAssessment(id: string): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "failed", error: "cancelled_by_user" })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (error) {
    logger.error({ err: error, id }, "ai-engine: cancelQueuedPreMortemAssessment failed");
    return false;
  }
  return (data?.length ?? 0) > 0;
}

/**
 * Terminal completion of a claimed row. Guarded WHERE status='running' (same
 * pattern as completeRun): rowsAffected=0 means the row was cancelled/failed
 * meanwhile — the caller logs and skips, never re-runs the paid call.
 */
export async function completePreMortemAssessment(
  id: string,
  result: {
    score: number;
    semaforo: string;
    verdict: string;
    summary: string | null;
    findings: import("@/shared/database.types").Json;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number | null;
  },
): Promise<{ rowsAffected: number }> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_pre_mortem_assessments")
    .update({ ...result, status: "completed", error: null })
    .eq("id", id)
    .eq("status", "running")
    .select("id");
  if (error) {
    throw new Error(`ai-engine: completePreMortemAssessment failed — ${error.message}`);
  }
  return { rowsAffected: data?.length ?? 0 };
}

/** Marks a queued/running assessment failed. Never overwrites completed rows. */
export async function markPreMortemFailed(id: string, errorMsg: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "failed", error: errorMsg })
    .eq("id", id)
    .in("status", ["queued", "running"]);
  if (error) {
    logger.error({ err: error, id }, "ai-engine: markPreMortemFailed failed");
  }
}

/**
 * Lazy zombie reaper (read path): marks stale in-flight assessments of a case as
 * failed. A running row can't heartbeat (one long provider call), so staleness is
 * wall-clock: Vercel kills the invocation at maxDuration → anything running past
 * the cutoff is dead. Queued rows past their cutoff lost their enqueue. NEVER
 * auto-re-runs (the provider call may have completed server-side — re-calling
 * would double the spend); the staff re-clicks deliberately.
 */
export async function sweepStalePreMortemForCase(
  caseId: string,
  cutoffs: { runningBefore: string; queuedBefore: string },
): Promise<number> {
  const client = createServiceClient();
  let swept = 0;

  const { data: staleRunning, error: errRunning } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "failed", error: "stale_running_swept" })
    .eq("case_id", caseId)
    .eq("status", "running")
    .lt("started_at", cutoffs.runningBefore)
    .select("id");
  if (errRunning) {
    logger.error({ err: errRunning, caseId }, "ai-engine: sweepStalePreMortem (running) failed");
  } else {
    swept += staleRunning?.length ?? 0;
  }

  // updated_at, NOT created_at: a requeued row (call failure → QStash retry) is
  // old by created_at but healthy — the claim/requeue transitions touch
  // updated_at via the trigger, so the cutoff measures time since the LAST
  // lifecycle movement, never killing a live retry cycle.
  const { data: staleQueued, error: errQueued } = await client
    .from("case_pre_mortem_assessments")
    .update({ status: "failed", error: "stale_queued_swept" })
    .eq("case_id", caseId)
    .eq("status", "queued")
    .lt("updated_at", cutoffs.queuedBefore)
    .select("id");
  if (errQueued) {
    logger.error({ err: errQueued, caseId }, "ai-engine: sweepStalePreMortem (queued) failed");
  } else {
    swept += staleQueued?.length ?? 0;
  }

  if (swept > 0) {
    logger.warn({ caseId, swept }, "ai-engine: swept stale pre-mortem assessments to failed");
  }
  return swept;
}

/**
 * Lazy zombie reaper for GENERATION runs (read path). Needed because the
 * uq_ai_runs_active_target unique index would otherwise block re-generating
 * forever behind a dead queued/running row. Thresholds are conservative:
 * checkpoints touch updated_at every section (≤240s per call), and the
 * concurrency defer can legitimately hold 'queued' for ~30 min.
 */
export async function sweepStaleRunsForCase(
  caseId: string,
  cutoffs: { runningBefore: string; queuedBefore: string },
): Promise<number> {
  const client = createServiceClient();
  let swept = 0;

  const { data: staleRunning, error: errRunning } = await client
    .from("ai_generation_runs")
    .update({ status: "failed", error: "stale_running_swept", updated_at: new Date().toISOString() })
    .eq("case_id", caseId)
    .eq("status", "running")
    .lt("updated_at", cutoffs.runningBefore)
    .select("id");
  if (errRunning) {
    logger.error({ err: errRunning, caseId }, "ai-engine: sweepStaleRuns (running) failed");
  } else {
    swept += staleRunning?.length ?? 0;
  }

  const { data: staleQueued, error: errQueued } = await client
    .from("ai_generation_runs")
    .update({ status: "failed", error: "stale_queued_swept", updated_at: new Date().toISOString() })
    .eq("case_id", caseId)
    .eq("status", "queued")
    .lt("updated_at", cutoffs.queuedBefore)
    .select("id");
  if (errQueued) {
    logger.error({ err: errQueued, caseId }, "ai-engine: sweepStaleRuns (queued) failed");
  } else {
    swept += staleQueued?.length ?? 0;
  }

  if (swept > 0) {
    logger.warn({ caseId, swept }, "ai-engine: swept stale generation runs to failed");
  }
  return swept;
}

/** The Pre-Mortem filling guide (rubric) + enablement for a form_definition. */
export async function findFormFillGuide(
  formDefinitionId: string,
): Promise<{ guide_markdown: string; enabled: boolean; source_file_path: string | null } | null> {
  const client = createServiceClient();
  const { data } = await client
    .from("form_fill_guides")
    .select("guide_markdown, enabled, source_file_path")
    .eq("form_definition_id", formDefinitionId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Lists the form_definitions of the case's service that have a Pre-Mortem guide
 * with enabled=true (both kinds). Join path:
 *   cases.service_id → service_phases → form_definitions → form_fill_guides(enabled).
 *
 * Feeds the gating (isPreMortemEnabledForCase) and the validable-target selector.
 */
export async function listGuideEnabledFormsForCase(
  caseId: string,
): Promise<Array<{ id: string; kind: string; label_i18n: unknown }>> {
  const client = createServiceClient();

  const { data: caseRow } = await client
    .from("cases")
    .select("service_id")
    .eq("id", caseId)
    .maybeSingle();
  if (!caseRow) return [];

  const { data: phases } = await client
    .from("service_phases")
    .select("id")
    .eq("service_id", caseRow.service_id);
  if (!phases || phases.length === 0) return [];

  const phaseIds = phases.map((p) => p.id);

  const { data: formDefs } = await client
    .from("form_definitions")
    .select("id, kind, label_i18n")
    .in("service_phase_id", phaseIds);
  if (!formDefs || formDefs.length === 0) return [];

  const formIds = formDefs.map((f) => f.id);

  const { data: guides } = await client
    .from("form_fill_guides")
    .select("form_definition_id")
    .in("form_definition_id", formIds)
    .eq("enabled", true);

  const enabled = new Set((guides ?? []).map((g) => g.form_definition_id));
  return formDefs
    .filter((f) => enabled.has(f.id))
    .map((f) => ({ id: f.id, kind: f.kind, label_i18n: f.label_i18n }));
}

/** Gating boolean: does the case have any form with the Pre-Mortem guide enabled? */
export async function findGuideEnabledFormForCase(caseId: string): Promise<boolean> {
  return (await listGuideEnabledFormsForCase(caseId)).length > 0;
}

/** Completed ai_letter runs for the given forms (newest first). */
export async function listCompletedRunsForForms(
  caseId: string,
  formDefIds: string[],
): Promise<Array<{ id: string; form_definition_id: string; created_at: string; output_text: string | null; output_path: string | null; model: string | null; party_id: string | null }>> {
  if (formDefIds.length === 0) return [];
  const client = createServiceClient();
  const { data } = await client
    .from("ai_generation_runs")
    .select("id, form_definition_id, created_at, output_text, output_path, model, party_id")
    .eq("case_id", caseId)
    .eq("status", "completed")
    .in("form_definition_id", formDefIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/** Form responses for the given pdf_automation forms (newest first). */
export async function listFormResponsesForForms(
  caseId: string,
  formDefIds: string[],
): Promise<Array<{ id: string; form_definition_id: string; status: string; filled_pdf_path: string | null; created_at: string; party_id: string | null }>> {
  if (formDefIds.length === 0) return [];
  const client = createServiceClient();
  const { data } = await client
    .from("case_form_responses")
    .select("id, form_definition_id, status, filled_pdf_path, created_at, party_id")
    .eq("case_id", caseId)
    .in("form_definition_id", formDefIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

/**
 * Finds the most recent completed ai_letter run for a case whose form_definition
 * has a Pre-Mortem guide enabled. A run is eligible if it has the memo as text OR
 * as a stored PDF (output_path). Returns null if no such run exists.
 */
export async function findLatestEligibleRunForPreMortem(
  caseId: string,
): Promise<{
  runId: string;
  outputText: string | null;
  outputPath: string | null;
  formDefinitionId: string;
  model: string | null;
} | null> {
  const guided = await listGuideEnabledFormsForCase(caseId);
  const guidedIds = guided.map((f) => f.id);
  if (guidedIds.length === 0) return null;

  const runs = await listCompletedRunsForForms(caseId, guidedIds);
  for (const run of runs) {
    if (run.output_text || run.output_path) {
      return {
        runId: run.id,
        outputText: run.output_text,
        outputPath: run.output_path,
        formDefinitionId: run.form_definition_id,
        model: run.model,
      };
    }
  }
  return null;
}
