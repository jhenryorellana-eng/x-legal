/**
 * Evaluations module — repository (data access layer).
 *
 * ALL reads and writes go through createServiceClient() (bypasses RLS).
 * The service layer is the single writer; authorization happens there first.
 *
 * Concurrency notes:
 * - Attempt counters use optimistic CAS updates (`... WHERE attempts_used = X`):
 *   PostgREST cannot compare two columns in a filter, so the service loops on
 *   the compare-and-swap instead (see consumeAttempt in service.ts).
 * - Run rows are the idempotency barrier: UNIQUE (evaluation_id, job_id).
 *
 * @module evaluations/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export type EvaluationRow = Tables<"case_evaluations">;
export type EvaluationRunRow = Tables<"case_evaluation_runs">;

/** Evaluation + the case columns the service layer needs (single round-trip). */
export type EvaluationWithCase = EvaluationRow & {
  case: {
    id: string;
    org_id: string;
    service_id: string;
    status: string;
    primary_client_id: string;
    case_number: string;
  };
};

interface CaseJoinRaw {
  cases: EvaluationWithCase["case"];
}

const CASE_JOIN = "*, cases!inner(id, org_id, service_id, status, primary_client_id, case_number)";

function mapWithCase(data: (EvaluationRow & CaseJoinRaw) | null): EvaluationWithCase | null {
  if (!data) return null;
  const { cases, ...row } = data;
  return { ...(row as EvaluationRow), case: cases };
}

// ---------------------------------------------------------------------------
// Evaluations
// ---------------------------------------------------------------------------

export async function findEvaluationByCase(
  caseId: string,
  toolKey: string,
): Promise<EvaluationRow | null> {
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .select("*")
    .eq("case_id", caseId)
    .eq("tool_key", toolKey)
    .maybeSingle();
  if (error) throw new Error(`evaluations.repo.findEvaluationByCase: ${error.message}`);
  return data ?? null;
}

export async function findEvaluationByToken(
  accessToken: string,
): Promise<EvaluationWithCase | null> {
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .select(CASE_JOIN)
    .eq("access_token", accessToken)
    .maybeSingle();
  if (error) throw new Error(`evaluations.repo.findEvaluationByToken: ${error.message}`);
  return mapWithCase(data as (EvaluationRow & CaseJoinRaw) | null);
}

export async function findEvaluationById(id: string): Promise<EvaluationRow | null> {
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`evaluations.repo.findEvaluationById: ${error.message}`);
  return data ?? null;
}

/**
 * Inserts the session row. On a UNIQUE (case_id, tool_key) race the caller
 * catches code 23505 and re-reads (lazy getOrCreate).
 */
export async function insertEvaluation(
  input: TablesInsert<"case_evaluations">,
): Promise<{ row: EvaluationRow | null; conflict: boolean }> {
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .insert(input)
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { row: null, conflict: true };
    throw new Error(`evaluations.repo.insertEvaluation: ${error.message}`);
  }
  return { row: data, conflict: false };
}

export async function updateEvaluation(
  id: string,
  patch: TablesUpdate<"case_evaluations">,
): Promise<void> {
  const { error } = await createServiceClient()
    .from("case_evaluations")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(`evaluations.repo.updateEvaluation: ${error.message}`);
}

/**
 * Optimistic CAS on the attempts counter: increments (delta=+1) or refunds
 * (delta=-1) ONLY if attempts_used still equals `expectedUsed`.
 * Returns true when the swap was applied (exactly one row matched).
 */
export async function casAttemptsUsed(
  id: string,
  expectedUsed: number,
  delta: 1 | -1,
): Promise<boolean> {
  const next = Math.max(0, expectedUsed + delta);
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .update({ attempts_used: next })
    .eq("id", id)
    .eq("attempts_used", expectedUsed)
    .select("id");
  if (error) throw new Error(`evaluations.repo.casAttemptsUsed: ${error.message}`);
  return (data ?? []).length === 1;
}

/**
 * Optimistic CAS that sets attempts_used to an ABSOLUTE target (used by the
 * webhook handlers to converge the counter onto the run-derived truth —
 * crash-safe: a webhook_events retry re-runs the sync and lands on the same
 * value). Returns true when the swap was applied.
 */
export async function setAttemptsUsed(
  id: string,
  expectedUsed: number,
  target: number,
): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .update({ attempts_used: Math.max(0, target) })
    .eq("id", id)
    .eq("attempts_used", expectedUsed)
    .select("id");
  if (error) throw new Error(`evaluations.repo.setAttemptsUsed: ${error.message}`);
  return (data ?? []).length === 1;
}

// ---------------------------------------------------------------------------
// Runs (idempotency barrier per jobId)
// ---------------------------------------------------------------------------

export async function findRunByJobId(
  evaluationId: string,
  jobId: string,
): Promise<EvaluationRunRow | null> {
  const { data, error } = await createServiceClient()
    .from("case_evaluation_runs")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) throw new Error(`evaluations.repo.findRunByJobId: ${error.message}`);
  return data ?? null;
}

/** Insert a run row; conflict=true on the UNIQUE (evaluation_id, job_id) race. */
export async function insertRun(
  input: TablesInsert<"case_evaluation_runs">,
): Promise<{ row: EvaluationRunRow | null; conflict: boolean }> {
  const { data, error } = await createServiceClient()
    .from("case_evaluation_runs")
    .insert(input)
    .select()
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return { row: null, conflict: true };
    throw new Error(`evaluations.repo.insertRun: ${error.message}`);
  }
  return { row: data, conflict: false };
}

/**
 * State-transition update with CAS on the CURRENT status. Guarantees
 * exactly-once semantics for consumed→failed (refund) and consumed→completed.
 * Returns true when the transition was applied.
 */
export async function transitionRun(
  runId: string,
  fromStatus: string,
  patch: TablesUpdate<"case_evaluation_runs">,
): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from("case_evaluation_runs")
    .update(patch)
    .eq("id", runId)
    .eq("status", fromStatus)
    .select("id");
  if (error) throw new Error(`evaluations.repo.transitionRun: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function listRunsForEvaluation(
  evaluationId: string,
): Promise<EvaluationRunRow[]> {
  const { data, error } = await createServiceClient()
    .from("case_evaluation_runs")
    .select("*")
    .eq("evaluation_id", evaluationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`evaluations.repo.listRunsForEvaluation: ${error.message}`);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Case / client lookups
// ---------------------------------------------------------------------------

export interface CaseBasic {
  id: string;
  org_id: string;
  service_id: string;
  status: string;
  primary_client_id: string;
  case_number: string;
}

export async function findCaseBasic(caseId: string): Promise<CaseBasic | null> {
  const { data, error } = await createServiceClient()
    .from("cases")
    .select("id, org_id, service_id, status, primary_client_id, case_number")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw new Error(`evaluations.repo.findCaseBasic: ${error.message}`);
  return data ?? null;
}

export interface ClientInfo {
  name: string | null;
  email: string | null;
  country: string | null;
}

/** Minimum client data Juez needs (contract v1 §3.1) — nothing else leaves. */
export async function findClientInfoForCase(userId: string): Promise<ClientInfo> {
  const supabase = createServiceClient();
  const [{ data: profile }, { data: user }] = await Promise.all([
    supabase
      .from("client_profiles")
      .select("first_name, last_name, country_of_origin")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("users").select("email").eq("id", userId).maybeSingle(),
  ]);

  const name = profile
    ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim() || null
    : null;
  return {
    name,
    email: user?.email ?? null,
    country: profile?.country_of_origin ?? null,
  };
}

/** Sessions stuck in_progress (reconciliation polling candidates). */
export async function listStaleInProgress(
  olderThanMinutes: number,
): Promise<EvaluationWithCase[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data, error } = await createServiceClient()
    .from("case_evaluations")
    .select(CASE_JOIN)
    .eq("status", "in_progress")
    .lt("updated_at", cutoff)
    .limit(20);
  if (error) throw new Error(`evaluations.repo.listStaleInProgress: ${error.message}`);
  return ((data ?? []) as (EvaluationRow & CaseJoinRaw)[])
    .map((d) => mapWithCase(d))
    .filter((d): d is EvaluationWithCase => d !== null);
}
