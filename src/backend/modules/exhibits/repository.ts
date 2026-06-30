/**
 * Exhibits module — data access (Supabase service_role).
 *
 * Single writer of `case_exhibits` and `exhibit_domain_health`. Reads
 * `ai_generation_runs` / `ai_generation_configs` / `ai_dataset_items` / `cases`
 * (cross-module reads, consistent with how `expediente` reads source tables in its
 * own repository — boundaries restrict imports, not SQL).
 *
 * @module exhibits/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Database } from "@/shared/database.types";
import type { ExhibitStatus, FetchMethod } from "./domain";
import { CLAIMABLE_STATUSES } from "./domain";

export type CaseExhibitRow = Database["public"]["Tables"]["case_exhibits"]["Row"];

export interface RunForCapture {
  id: string;
  caseId: string;
  formDefinitionId: string;
  configSnapshot: Record<string, unknown>;
}

export interface AttachConfig {
  enabled: boolean;
  kinds: string[];
  curatedSources: Array<{ url?: string; title?: string; category?: string }>;
  datasetId: string | null;
}

/** Reads the run's frozen snapshot (research bundle lives in config_snapshot.research). */
export async function getRunForCapture(runId: string): Promise<RunForCapture | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("ai_generation_runs")
    .select("id, case_id, form_definition_id, config_snapshot")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error(`getRunForCapture: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    caseId: data.case_id,
    formDefinitionId: data.form_definition_id,
    configSnapshot: (data.config_snapshot ?? {}) as Record<string, unknown>,
  };
}

export async function getCaseOrgId(caseId: string): Promise<string | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("cases").select("org_id").eq("id", caseId).maybeSingle();
  if (error) throw new Error(`getCaseOrgId: ${error.message}`);
  return data?.org_id ?? null;
}

/** Reads the letter's attach-sources config (the admin "save links" knobs). */
export async function getAttachConfig(formDefinitionId: string): Promise<AttachConfig | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("ai_generation_configs")
    .select("attach_sources_enabled, attach_sources_kinds, curated_sources, dataset_id")
    .eq("form_definition_id", formDefinitionId)
    .maybeSingle();
  if (error) throw new Error(`getAttachConfig: ${error.message}`);
  if (!data) return null;
  const curated = Array.isArray(data.curated_sources)
    ? (data.curated_sources as Array<{ url?: string; title?: string; category?: string }>)
    : [];
  return {
    enabled: data.attach_sources_enabled ?? false,
    kinds: data.attach_sources_kinds ?? [],
    curatedSources: curated,
    datasetId: data.dataset_id ?? null,
  };
}

/** Dataset items that carry a usable source URL in their `meta` (for the 'dataset' source kind). */
export async function getDatasetUrlItems(
  datasetId: string,
): Promise<Array<{ title: string; url: string; publishedDate: string | null }>> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("ai_dataset_items")
    .select("title, meta")
    .eq("dataset_id", datasetId);
  if (error) throw new Error(`getDatasetUrlItems: ${error.message}`);
  const out: Array<{ title: string; url: string; publishedDate: string | null }> = [];
  for (const row of data ?? []) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const url = typeof meta.url === "string" ? meta.url : null;
    if (!url) continue;
    out.push({
      title: row.title,
      url,
      publishedDate: typeof meta.published_date === "string" ? meta.published_date : null,
    });
  }
  return out;
}

export interface NewExhibitInsert {
  caseId: string;
  runId: string;
  sourceKind: string;
  citeOrder: number;
  exhibitLabel: string | null;
  sourceUrl: string;
  canonicalUrl: string;
  urlHash: string;
  title: string | null;
  publisher: string | null;
  publishedDate: string | null;
  supports: string | null;
}

/** Inserts captured exhibits, ignoring duplicates (unique run_id,url_hash). Returns inserted count. */
export async function insertExhibits(rows: NewExhibitInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const db = createServiceClient();
  const payload = rows.map((r) => ({
    case_id: r.caseId,
    run_id: r.runId,
    source_kind: r.sourceKind,
    cite_order: r.citeOrder,
    exhibit_label: r.exhibitLabel,
    source_url: r.sourceUrl,
    canonical_url: r.canonicalUrl,
    url_hash: r.urlHash,
    title: r.title,
    publisher: r.publisher,
    published_date: r.publishedDate,
    supports: r.supports,
    status: "pending" as const,
  }));
  const { data, error } = await db
    .from("case_exhibits")
    .upsert(payload, { onConflict: "run_id,url_hash", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`insertExhibits: ${error.message}`);
  return data?.length ?? 0;
}

export async function listPendingByRun(runId: string): Promise<CaseExhibitRow[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("case_exhibits")
    .select("*")
    .eq("run_id", runId)
    .eq("status", "pending");
  if (error) throw new Error(`listPendingByRun: ${error.message}`);
  return data ?? [];
}

/** Count of exhibits for a run not yet in a terminal-for-assembly state. */
export async function countUnsettledByRun(runId: string): Promise<number> {
  const db = createServiceClient();
  const { count, error } = await db
    .from("case_exhibits")
    .select("id", { count: "exact", head: true })
    .eq("run_id", runId)
    .in("status", ["pending", "fetching"]);
  if (error) throw new Error(`countUnsettledByRun: ${error.message}`);
  return count ?? 0;
}

export async function getExhibitById(id: string): Promise<CaseExhibitRow | null> {
  const db = createServiceClient();
  const { data, error } = await db.from("case_exhibits").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`getExhibitById: ${error.message}`);
  return data ?? null;
}

/**
 * Idempotent claim: flips a (re)claimable exhibit to 'fetching' and bumps attempts.
 * Returns the row if claimed, or null if it was already terminal (another worker won).
 */
export async function claimExhibit(id: string): Promise<CaseExhibitRow | null> {
  const db = createServiceClient();
  const current = await getExhibitById(id);
  if (!current) return null;
  if (!CLAIMABLE_STATUSES.includes(current.status as ExhibitStatus)) return null;
  const { data, error } = await db
    .from("case_exhibits")
    .update({ status: "fetching", attempts: (current.attempts ?? 0) + 1 })
    .eq("id", id)
    .in("status", CLAIMABLE_STATUSES) // guard: only if still claimable (lost-update safe)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`claimExhibit: ${error.message}`);
  return data ?? null;
}

export interface MarkReadyPatch {
  pdfPath: string;
  contentSha256: string;
  pageCount: number;
  fetchMethod: FetchMethod;
  finalUrl: string;
}

export async function markReady(id: string, patch: MarkReadyPatch): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("case_exhibits")
    .update({
      status: "ready",
      pdf_path: patch.pdfPath,
      content_sha256: patch.contentSha256,
      page_count: patch.pageCount,
      fetch_method: patch.fetchMethod,
      final_url: patch.finalUrl,
      accessed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", id)
    .eq("status", "fetching"); // only the active fetch closes it
  if (error) throw new Error(`markReady: ${error.message}`);
}

export async function markFailed(id: string, lastError: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("case_exhibits")
    .update({ status: "failed", last_error: lastError.slice(0, 2000) })
    .eq("id", id)
    .not("status", "in", "(ready,manual)"); // never override a good/human copy
  if (error) throw new Error(`markFailed: ${error.message}`);
}

export async function listReadyByCase(caseId: string): Promise<CaseExhibitRow[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("case_exhibits")
    .select("*")
    .eq("case_id", caseId)
    .in("status", ["ready", "manual"])
    .order("cite_order", { ascending: true });
  if (error) throw new Error(`listReadyByCase: ${error.message}`);
  return data ?? [];
}

/** All exhibits for a case (any status) — for Diana's panel. */
export async function listAllByCase(caseId: string): Promise<CaseExhibitRow[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("case_exhibits")
    .select("*")
    .eq("case_id", caseId)
    .order("cite_order", { ascending: true });
  if (error) throw new Error(`listAllByCase: ${error.message}`);
  return data ?? [];
}

/** Marks an exhibit as a hand-uploaded copy (Diana's manual upload for a failed link). */
export async function setManual(id: string, patch: { pdfPath: string; pageCount: number }): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("case_exhibits")
    .update({
      status: "manual",
      pdf_path: patch.pdfPath,
      page_count: patch.pageCount,
      fetch_method: "manual",
      last_error: null,
      accessed_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`setManual: ${error.message}`);
}

export async function listByRun(runId: string): Promise<CaseExhibitRow[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("case_exhibits")
    .select("*")
    .eq("run_id", runId)
    .order("cite_order", { ascending: true });
  if (error) throw new Error(`listByRun: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Content-addressed cache reuse (same source cited across cases)
// ---------------------------------------------------------------------------

/** Another already-fetched exhibit with the SAME canonical URL (cross-case reuse). */
export async function findReusableByUrlHash(
  urlHash: string,
  excludeId: string,
): Promise<CaseExhibitRow | null> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("case_exhibits")
    .select("*")
    .eq("url_hash", urlHash)
    .eq("status", "ready")
    .not("pdf_path", "is", null)
    .neq("id", excludeId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`findReusableByUrlHash: ${error.message}`);
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Per-domain circuit breaker (exhibit_domain_health)
// ---------------------------------------------------------------------------

const DOMAIN_FAIL_THRESHOLD = 5;
const DOMAIN_COOLDOWN_MS = 10 * 60_000;

export async function isCircuitOpen(domain: string): Promise<boolean> {
  const db = createServiceClient();
  const { data } = await db
    .from("exhibit_domain_health")
    .select("open_until")
    .eq("domain", domain)
    .maybeSingle();
  return !!data?.open_until && new Date(data.open_until).getTime() > Date.now();
}

export async function recordDomainSuccess(domain: string): Promise<void> {
  const db = createServiceClient();
  await db
    .from("exhibit_domain_health")
    .upsert(
      { domain, consecutive_failures: 0, open_until: null, last_request_at: new Date().toISOString() },
      { onConflict: "domain" },
    );
}

export async function recordDomainFailure(domain: string): Promise<void> {
  // Read-modify-write (no atomic increment via supabase-js). Acceptable at these
  // volumes: the breaker is advisory, a lost increment only delays opening by one.
  const db = createServiceClient();
  const { data } = await db
    .from("exhibit_domain_health")
    .select("consecutive_failures")
    .eq("domain", domain)
    .maybeSingle();
  const failures = (data?.consecutive_failures ?? 0) + 1;
  const openUntil =
    failures >= DOMAIN_FAIL_THRESHOLD ? new Date(Date.now() + DOMAIN_COOLDOWN_MS).toISOString() : null;
  await db
    .from("exhibit_domain_health")
    .upsert(
      { domain, consecutive_failures: failures, open_until: openUntil, last_request_at: new Date().toISOString() },
      { onConflict: "domain" },
    );
}

/** Resets a failed/ready exhibit back to 'pending' so it can be re-queued (Diana retry). */
export async function resetToPending(id: string): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("case_exhibits")
    .update({ status: "pending", last_error: null })
    .eq("id", id);
  if (error) throw new Error(`resetToPending: ${error.message}`);
}
