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
    throw new Error(`ai-engine: insertRun failed — ${error?.message}`);
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

  const genTotal = (genData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const extTotal = (extData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const transTotal = (transData ?? []).reduce((s, r) => s + (r.cost_usd ?? 0), 0);

  return {
    totalUsd: parseFloat((genTotal + extTotal + transTotal).toFixed(4)),
    bySource: {
      generations: parseFloat(genTotal.toFixed(4)),
      extractions: parseFloat(extTotal.toFixed(4)),
      translations: parseFloat(transTotal.toFixed(4)),
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
      "id, case_id, storage_path, mime_type, size_bytes, required_document_types(ai_extract, extraction_schema, slug)",
    )
    .eq("id", caseDocumentId)
    .maybeSingle();

  if (error || !data) return null;

  const rdt = Array.isArray(data.required_document_types)
    ? data.required_document_types[0]
    : data.required_document_types;

  return {
    id: data.id,
    caseId: data.case_id,
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
    .select("id, title, content, tags, outcome, token_count, created_at, jurisdiction")
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
      documents.push({
        slug: docRef.slug,
        extractionPayload: (data.payload as Record<string, unknown>) ?? {},
        rawText: data.raw_text ?? "",
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
      forms.push({
        slug: formRef.slug,
        answers: (data.answers as Record<string, unknown>) ?? {},
      });
    }
  }

  return { documents, forms };
}
