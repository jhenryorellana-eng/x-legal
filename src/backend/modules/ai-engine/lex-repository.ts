/**
 * ai-engine module — Lex case chat: repository (data access layer).
 *
 * ai-engine is the ONLY writer of case_knowledge_chunks (reindex jobs) and
 * case_lex_messages assistant rows (lex-answer job); the staff UI writes its own
 * user messages through this same module (sendLexMessage). RLS on these tables
 * already scopes threads to their owner, but all access here uses the service
 * client — authorization happens in lex-service (requireCaseAccess + ownership).
 *
 * Client choice: createServiceClient everywhere (jobs run actor-less; the
 * user-facing paths are gated in the service layer — same precedent as
 * repository.ts for runs/costs).
 *
 * NOTE: never destructure client methods off the client (supabase-js binds
 * them) — always call `client.from(...)` / `client.rpc(...)` inline.
 *
 * @module ai-engine/lex-repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import { isLexModel, type LexModel, type LexSourceKind } from "./lex-domain";

// ---------------------------------------------------------------------------
// Row type aliases
// ---------------------------------------------------------------------------

export type LexThreadRow = Tables<"case_lex_threads">;
export type LexMessageRow = Tables<"case_lex_messages">;
export type LexChunkRow = Tables<"case_knowledge_chunks">;

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** The staff member's thread on a case, if it exists (one per case+employee). */
export async function findThread(
  caseId: string,
  staffUserId: string,
): Promise<LexThreadRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_threads")
    .select("*")
    .eq("case_id", caseId)
    .eq("staff_user_id", staffUserId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex findThread failed");
    return null;
  }
  return data;
}

export async function getThreadById(threadId: string): Promise<LexThreadRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, threadId }, "ai-engine: lex getThreadById failed");
    return null;
  }
  return data;
}

/**
 * Returns the (case, employee) thread, creating it on first use. Conflict-safe:
 * the unique (case_id, staff_user_id) constraint turns a concurrent first-send
 * into a 23505 — re-read and return the winner (same precedent as
 * createQuestionnaireInstance).
 */
export async function getOrCreateThread(
  caseId: string,
  staffUserId: string,
): Promise<LexThreadRow> {
  const existing = await findThread(caseId, staffUserId);
  if (existing) return existing;

  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_threads")
    .insert({ case_id: caseId, staff_user_id: staffUserId })
    .select()
    .single();
  if (error || !data) {
    if ((error as { code?: string } | null)?.code === "23505") {
      const winner = await findThread(caseId, staffUserId);
      if (winner) return winner;
    }
    throw new Error(`ai-engine: lex getOrCreateThread failed — ${error?.message}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Thread history, oldest first, capped (the UI renders ascending). */
export async function listMessages(threadId: string, limit = 200): Promise<LexMessageRow[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    logger.error({ err: error, threadId }, "ai-engine: lex listMessages failed");
    return [];
  }
  return data ?? [];
}

export async function getMessageById(messageId: string): Promise<LexMessageRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_messages")
    .select("*")
    .eq("id", messageId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, messageId }, "ai-engine: lex getMessageById failed");
    return null;
  }
  return data;
}

/** The in-flight assistant placeholder, if any (one per thread by construction). */
export async function findRunningMessage(threadId: string): Promise<LexMessageRow | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("role", "assistant")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, threadId }, "ai-engine: lex findRunningMessage failed");
    return null;
  }
  return data;
}

export async function insertMessage(
  row: TablesInsert<"case_lex_messages">,
): Promise<LexMessageRow> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_lex_messages")
    .insert(row)
    .select()
    .single();
  if (error || !data) {
    throw new Error(`ai-engine: lex insertMessage failed — ${error?.message}`);
  }
  return data;
}

/** Terminal/patch write on an assistant message (content, sources, cost, status). */
export async function updateAssistantMessage(
  id: string,
  patch: TablesUpdate<"case_lex_messages">,
): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("case_lex_messages")
    .update(patch)
    .eq("id", id);
  if (error) {
    logger.error({ err: error, id }, "ai-engine: lex updateAssistantMessage failed");
    throw new Error(`ai-engine: lex updateAssistantMessage failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Case profile source data
// ---------------------------------------------------------------------------

export interface LexCaseProfileData {
  caseId: string;
  orgId: string;
  caseNumber: string;
  status: string;
  currentStage: string;
  serviceName: string;
  planName: string | null;
  currentPhase: string | null;
  parties: Array<{ role: string; name: string }>;
}

/** PostgREST may return a to-one embed as an object or a single-element array. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

function i18nLabel(value: unknown): string | null {
  const label = value as { es?: string; en?: string } | null;
  return label?.es ?? label?.en ?? null;
}

/**
 * Factual case data for the `case_profile` chunk + the Lex prompt header:
 * case + service/plan/current-phase labels + party names. Party names resolve
 * from client_profiles (registered users) or person_records (relatives) — two
 * light queries joined in JS (avoids fragile nested embeds through users).
 */
export async function getCaseForProfile(caseId: string): Promise<LexCaseProfileData | null> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("cases")
    .select(
      "id, org_id, case_number, status, current_stage, services(label_i18n), service_plans(kind), service_phases!cases_current_phase_id_fkey(label_i18n)",
    )
    .eq("id", caseId)
    .maybeSingle();
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex getCaseForProfile failed");
    return null;
  }
  if (!data) return null;

  const row = data as unknown as {
    id: string;
    org_id: string;
    case_number: string;
    status: string;
    current_stage: string;
    services: { label_i18n: unknown } | Array<{ label_i18n: unknown }> | null;
    service_plans: { kind: string } | Array<{ kind: string }> | null;
    service_phases: { label_i18n: unknown } | Array<{ label_i18n: unknown }> | null;
  };

  // Parties: base rows first, then hydrate names from the two name sources.
  const { data: partyRows } = await client
    .from("case_parties")
    .select("party_role, position, user_id, person_record_id")
    .eq("case_id", caseId)
    .order("position", { ascending: true });
  const partiesRaw = (partyRows ?? []) as Array<{
    party_role: string;
    position: number;
    user_id: string | null;
    person_record_id: string | null;
  }>;

  const userIds = partiesRaw.map((p) => p.user_id).filter((v): v is string => !!v);
  const personIds = partiesRaw.map((p) => p.person_record_id).filter((v): v is string => !!v);

  const nameByUserId = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from("client_profiles")
      .select("user_id, first_name, last_name, preferred_name")
      .in("user_id", userIds);
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      first_name: string;
      last_name: string;
      preferred_name: string | null;
    }>) {
      const full = `${p.first_name} ${p.last_name}`.trim();
      nameByUserId.set(p.user_id, p.preferred_name?.trim() || full);
    }
  }

  const nameByPersonId = new Map<string, string>();
  if (personIds.length > 0) {
    const { data: persons } = await client
      .from("person_records")
      .select("id, first_name, last_name")
      .in("id", personIds);
    for (const p of (persons ?? []) as Array<{ id: string; first_name: string; last_name: string }>) {
      nameByPersonId.set(p.id, `${p.first_name} ${p.last_name}`.trim());
    }
  }

  const parties = partiesRaw
    .map((p) => ({
      role: p.party_role,
      name:
        (p.user_id ? nameByUserId.get(p.user_id) : null) ??
        (p.person_record_id ? nameByPersonId.get(p.person_record_id) : null) ??
        "",
    }))
    .filter((p) => p.name);

  return {
    caseId: row.id,
    orgId: row.org_id,
    caseNumber: row.case_number,
    status: row.status,
    currentStage: row.current_stage,
    serviceName: i18nLabel(one(row.services)?.label_i18n) ?? "",
    planName: one(row.service_plans)?.kind ?? null,
    currentPhase: i18nLabel(one(row.service_phases)?.label_i18n),
    parties,
  };
}

/** Light org lookup for job envelopes (webhook idempotency barrier). */
export async function findCaseOrgId(caseId: string): Promise<string | null> {
  const client = createServiceClient();
  const { data } = await client.from("cases").select("org_id").eq("id", caseId).maybeSingle();
  return (data as { org_id?: string } | null)?.org_id ?? null;
}

// ---------------------------------------------------------------------------
// Indexable sources (reindex input)
// ---------------------------------------------------------------------------

export interface LexIndexableDocument {
  documentId: string;
  /** Human label for citations (requirement label → display/original filename). */
  label: string;
  rawText: string;
}

/**
 * Documents that feed the case knowledge index: active uploads (uploaded or
 * approved — rejected/replaced are excluded) whose 1:1 extraction completed
 * with non-empty raw_text.
 */
export async function listIndexableDocuments(caseId: string): Promise<LexIndexableDocument[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_documents")
    .select(
      "id, original_filename, display_name, required_document_types(label_i18n), document_extractions(raw_text, status)",
    )
    .eq("case_id", caseId)
    .in("status", ["uploaded", "approved"]);
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex listIndexableDocuments failed");
    return [];
  }

  const out: LexIndexableDocument[] = [];
  for (const d of (data ?? []) as unknown as Array<{
    id: string;
    original_filename: string;
    display_name: string | null;
    required_document_types: { label_i18n: unknown } | Array<{ label_i18n: unknown }> | null;
    document_extractions:
      | { raw_text: string | null; status: string }
      | Array<{ raw_text: string | null; status: string }>
      | null;
  }>) {
    const extraction = one(d.document_extractions);
    const rawText = extraction?.status === "completed" ? (extraction.raw_text ?? "").trim() : "";
    if (!rawText) continue;
    const label =
      i18nLabel(one(d.required_document_types)?.label_i18n) ??
      d.display_name?.trim() ??
      d.original_filename;
    out.push({ documentId: d.id, label: label || d.original_filename, rawText });
  }
  return out;
}

export interface LexIndexableFormResponse {
  responseId: string;
  /** Form label (citation label). */
  formLabel: string;
  answers: Record<string, unknown>;
  /** question id → human label (es preferred), for buildAnswersDocument. */
  questionLabels: Record<string, string>;
}

/**
 * Form responses that feed the index: submitted/approved, with their answers
 * and the question labels resolved from form_questions (via the response's
 * automation version, falling back to the published version of the form).
 */
export async function listIndexableFormResponses(caseId: string): Promise<LexIndexableFormResponse[]> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_form_responses")
    .select("id, answers, automation_version_id, form_definitions!inner(id, slug, label_i18n)")
    .eq("case_id", caseId)
    .in("status", ["submitted", "approved"]);
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex listIndexableFormResponses failed");
    return [];
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    answers: unknown;
    automation_version_id: string | null;
    form_definitions: { id: string; slug: string; label_i18n: unknown } | null;
  }>;

  const out: LexIndexableFormResponse[] = [];
  for (const r of rows) {
    const answers = (r.answers ?? {}) as Record<string, unknown>;
    if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) continue;

    // Resolve the question set: the version the client answered, else the
    // currently published one (same fallback as listPublishedQuestionTexts).
    let versionId = r.automation_version_id;
    if (!versionId && r.form_definitions?.id) {
      const { data: ver } = await client
        .from("form_automation_versions")
        .select("id")
        .eq("form_definition_id", r.form_definitions.id)
        .eq("status", "published")
        .maybeSingle();
      versionId = (ver as { id?: string } | null)?.id ?? null;
    }

    const questionLabels: Record<string, string> = {};
    if (versionId) {
      const { data: questions } = await client
        .from("form_questions")
        .select("id, question_i18n, form_question_groups!inner(automation_version_id)")
        .eq("form_question_groups.automation_version_id", versionId);
      for (const q of (questions ?? []) as Array<{ id: string; question_i18n: unknown }>) {
        const label = i18nLabel(q.question_i18n);
        if (label) questionLabels[q.id] = label;
      }
    }

    const formLabel =
      i18nLabel(r.form_definitions?.label_i18n) ?? r.form_definitions?.slug ?? "Formulario";
    out.push({ responseId: r.id, formLabel, answers, questionLabels });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Knowledge chunks
// ---------------------------------------------------------------------------

/** Existing chunks of a case (identity + hash — the reindex diff input). */
export async function listExistingChunks(
  caseId: string,
): Promise<Array<Pick<LexChunkRow, "id" | "source_kind" | "source_id" | "chunk_index" | "content_hash">>> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_knowledge_chunks")
    .select("id, source_kind, source_id, chunk_index, content_hash")
    .eq("case_id", caseId);
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex listExistingChunks failed");
    return [];
  }
  return data ?? [];
}

/** Upserts one chunk keyed by the unique (source_kind, source_id, chunk_index). */
export async function upsertChunk(row: TablesInsert<"case_knowledge_chunks">): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("case_knowledge_chunks")
    .upsert(
      { ...row, updated_at: new Date().toISOString() },
      { onConflict: "source_kind,source_id,chunk_index" },
    );
  if (error) {
    logger.error({ err: error, sourceKind: row.source_kind }, "ai-engine: lex upsertChunk failed");
    throw new Error(`ai-engine: lex upsertChunk failed — ${error.message}`);
  }
}

/**
 * Deletes chunks whose (source_kind, source_id) is NOT in keepKeys — the orphan
 * sweep: documents deleted/replaced/rejected and form responses returned to
 * draft drop out of the indexable set, so their chunks must go.
 */
export async function deleteChunksNotIn(
  caseId: string,
  keepKeys: Array<{ source_kind: LexSourceKind; source_id: string }>,
): Promise<number> {
  const existing = await listExistingChunks(caseId);
  const keep = new Set(keepKeys.map((k) => `${k.source_kind}:${k.source_id}`));
  const staleIds = existing
    .filter((c) => !keep.has(`${c.source_kind}:${c.source_id}`))
    .map((c) => c.id);
  if (staleIds.length === 0) return 0;

  const client = createServiceClient();
  const { error } = await client
    .from("case_knowledge_chunks")
    .delete()
    .in("id", staleIds);
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex deleteChunksNotIn failed");
    throw new Error(`ai-engine: lex deleteChunksNotIn failed — ${error.message}`);
  }
  return staleIds.length;
}

/**
 * Deletes the tail chunks of a source whose new chunking is shorter than the
 * stored one (same source, fewer chunks — deleteChunksNotIn works at source
 * level and would keep the stale tail).
 */
export async function deleteSourceChunksFrom(
  caseId: string,
  sourceKind: LexSourceKind,
  sourceId: string,
  fromIndex: number,
): Promise<number> {
  const client = createServiceClient();
  const { error, data } = await client
    .from("case_knowledge_chunks")
    .delete()
    .eq("case_id", caseId)
    .eq("source_kind", sourceKind)
    .eq("source_id", sourceId)
    .gte("chunk_index", fromIndex)
    .select("id");
  if (error) {
    logger.error({ err: error, caseId, sourceKind }, "ai-engine: lex deleteSourceChunksFrom failed");
    throw new Error(`ai-engine: lex deleteSourceChunksFrom failed — ${error.message}`);
  }
  return data?.length ?? 0;
}

/** Direct purge of a document's chunks (document.deleted consumer fast path). */
export async function deleteDocumentChunks(documentId: string): Promise<void> {
  const client = createServiceClient();
  const { error } = await client
    .from("case_knowledge_chunks")
    .delete()
    .eq("source_kind", "document_extraction")
    .eq("source_id", documentId);
  if (error) {
    logger.error({ err: error, documentId }, "ai-engine: lex deleteDocumentChunks failed");
  }
}

// ---------------------------------------------------------------------------
// Retrieval (match_case_knowledge RPC — case-scoped by signature)
// ---------------------------------------------------------------------------

export interface LexMatchedChunk {
  id: string;
  sourceKind: string;
  sourceId: string;
  sourceLabel: string;
  content: string;
  similarity: number;
}

/**
 * Semantic retrieval over the case's own chunks. Degrades to [] on error —
 * Lex answers "no tengo contexto" rather than failing the whole chat.
 */
export async function matchCaseKnowledge(
  caseId: string,
  queryEmbeddingLiteral: string,
  matchCount = 12,
): Promise<LexMatchedChunk[]> {
  const client = createServiceClient();
  const { data, error } = await client.rpc("match_case_knowledge", {
    query_embedding: queryEmbeddingLiteral,
    p_case_id: caseId,
    match_count: matchCount,
  });
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex matchCaseKnowledge failed — degrading to no context");
    return [];
  }
  return (data ?? []).map((r) => ({
    id: r.id,
    sourceKind: r.source_kind,
    sourceId: r.source_id,
    sourceLabel: r.source_label,
    content: r.content,
    similarity: r.similarity,
  }));
}

// ---------------------------------------------------------------------------
// Org / staff settings
// ---------------------------------------------------------------------------

/**
 * The org's configured Lex model (orgs.settings.ai_lex_model), validated
 * against LEX_MODELS. Returns null when unset or invalid (caller falls back
 * to env AI_LEX_MODEL, then DEFAULT_LEX_MODEL).
 */
export async function getOrgLexModel(orgId: string): Promise<LexModel | null> {
  const client = createServiceClient();
  const { data } = await client.from("orgs").select("settings").eq("id", orgId).maybeSingle();
  const value = (data?.settings as { ai_lex_model?: unknown } | null | undefined)?.ai_lex_model;
  return isLexModel(value) ? value : null;
}

/** Staff UI locale for the Lex answer language (users.locale; default es). */
export async function getUserLocale(userId: string): Promise<"es" | "en"> {
  const client = createServiceClient();
  const { data } = await client.from("users").select("locale").eq("id", userId).maybeSingle();
  return (data as { locale?: string } | null)?.locale === "en" ? "en" : "es";
}

/**
 * True when the case has active documents flagged ai_extract whose extraction
 * is not completed yet (the reindex job re-enqueues itself with a delay until
 * they land — extraction data is the main index input).
 */
export async function hasPendingExtractions(caseId: string): Promise<boolean> {
  const client = createServiceClient();
  const { data, error } = await client
    .from("case_documents")
    .select("id, required_document_types!inner(ai_extract), document_extractions(status)")
    .eq("case_id", caseId)
    .in("status", ["uploaded", "approved"])
    .eq("required_document_types.ai_extract", true);
  if (error) {
    logger.error({ err: error, caseId }, "ai-engine: lex hasPendingExtractions failed");
    return false;
  }
  return ((data ?? []) as unknown as Array<{
    document_extractions: { status: string } | Array<{ status: string }> | null;
  }>).some((d) => one(d.document_extractions)?.status !== "completed");
}
