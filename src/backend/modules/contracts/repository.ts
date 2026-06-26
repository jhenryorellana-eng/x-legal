/**
 * Contracts module — repository (data access layer).
 *
 * Public signing endpoints use createServiceClient (no RLS context from anonymous request).
 * Staff endpoints use createServerClient (RLS scopes reads to org).
 *
 * @module contracts/repository
 */

import {
  createServerClient,
  createServiceClient,
} from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

export type ContractRow = Tables<"contracts">;
export type ContractTermsAcceptanceRow = Tables<"contract_terms_acceptances">;

// ---------------------------------------------------------------------------
// Contract reads
// ---------------------------------------------------------------------------

/**
 * Finds a contract by ID using the server client (RLS scoped).
 */
export async function findContractById(
  contractId: string,
): Promise<ContractRow | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", contractId)
    .single();

  if (error || !data) return null;
  return data;
}

/**
 * Finds a contract by its signing token.
 *
 * Runs with SERVICE client (no session in signing flow).
 * Validates: token match AND status='sent' AND not expired.
 *
 * SECURITY: uniform 404 for any failure (anti-enumeration, DOC-22 §4).
 */
export async function findBySigningToken(
  token: string,
): Promise<ContractRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("signing_token", token)
    .eq("status", "sent")
    .gt("signing_expires_at", new Date().toISOString())
    .maybeSingle();

  return data ?? null;
}

/**
 * Finds a contract by case_id (OneToOne relationship).
 */
export async function findContractByCaseId(
  caseId: string,
): Promise<ContractRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("case_id", caseId)
    .maybeSingle();

  return data ?? null;
}

/**
 * Finds a contract by case_id using the SERVICE client (bypasses RLS).
 *
 * The `contracts` table has no SELECT policy for client (authenticated) users —
 * only staff org-scoped reads and the service-role signing flow. The client
 * dashboard still needs its own contract's onboarding state (status + token), so
 * the caller MUST authorize access first (requireCaseAccess) and this read trusts
 * that gate. Do NOT call without a prior membership/permission check.
 */
export async function findContractByCaseIdService(
  caseId: string,
): Promise<ContractRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contracts")
    .select("*")
    .eq("case_id", caseId)
    .maybeSingle();

  return data ?? null;
}

// ---------------------------------------------------------------------------
// Contract mutations
// ---------------------------------------------------------------------------

/**
 * Inserts a new contract row. Returns the created row.
 */
export async function insertContract(
  row: TablesInsert<"contracts">,
): Promise<ContractRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("contracts")
    .insert(row)
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `contracts.repository: insertContract failed — ${error?.message}`,
    );
  }
  return data;
}

/**
 * Updates a contract row. Used for status transitions and token rotation.
 */
export async function updateContract(
  contractId: string,
  fields: TablesUpdate<"contracts">,
): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("contracts")
    .update(fields)
    .eq("id", contractId);

  if (error) {
    throw new Error(
      `contracts.repository: updateContract failed — ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Terms versions
// ---------------------------------------------------------------------------

export interface TermsVersionRow {
  id: string;
  org_id: string;
  version: string;
  is_active: boolean;
  content_url: string | null;
  created_at: string;
}

/**
 * Finds the active terms version for an org.
 * Only one version can be active at a time (partial unique index).
 */
export async function getActiveTermsVersion(
  orgId: string,
): Promise<TermsVersionRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("terms_versions")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .maybeSingle();

  return (data as unknown as TermsVersionRow | null) ?? null;
}

// ---------------------------------------------------------------------------
// Contract terms acceptances
// ---------------------------------------------------------------------------

/**
 * Finds a terms acceptance for a specific case/user/version triple.
 */
export async function findAcceptance(
  caseId: string,
  userId: string,
  termsVersion: string,
): Promise<ContractTermsAcceptanceRow | null> {
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("contract_terms_acceptances")
    .select("*")
    .eq("case_id", caseId)
    .eq("user_id", userId)
    .eq("terms_version", termsVersion)
    .maybeSingle();

  return data ?? null;
}

/**
 * Returns the most recent terms acceptance for a case (any user), via the
 * SERVICE client — staff (admin) read it for the case detail. RLS on the table
 * is client-scoped, so the service client is required; the caller authorizes
 * via requireCaseAccess.
 */
export async function latestAcceptanceForCaseService(
  caseId: string,
): Promise<ContractTermsAcceptanceRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("contract_terms_acceptances")
    .select("*")
    .eq("case_id", caseId)
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Inserts a terms acceptance row.
 */
export async function insertAcceptance(row: {
  caseId: string;
  userId: string;
  termsVersion: string;
  signatureImagePath: string;
  ip: string | null;
  acceptedAt: string;
}): Promise<ContractTermsAcceptanceRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("contract_terms_acceptances")
    .insert({
      case_id: row.caseId,
      user_id: row.userId,
      terms_version: row.termsVersion,
      signature_image_path: row.signatureImagePath,
      ip: row.ip as unknown,
      accepted_at: row.acceptedAt,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(
      `contracts.repository: insertAcceptance failed — ${error?.message}`,
    );
  }
  return data;
}
