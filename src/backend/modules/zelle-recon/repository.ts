/**
 * Zelle reconciliation — repository (data access layer).
 *
 * The zelle_* tables ship with migration 0111 and are NOT in
 * src/shared/database.types.ts until `npm run db:types` runs after it is
 * applied. Until then this module carries hand-written row types and a
 * narrowly-typed client cast (on the CLIENT object, never detaching methods —
 * documented `this`-loss bug pattern). TODO(post-0111): switch to
 * Tables<"zelle_…"> and delete the local types.
 *
 * @module zelle-recon/repository
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import type { MatchCandidate, PayerAlias, DailyAutoStats, MatchSignals } from "./domain";

// ---------------------------------------------------------------------------
// Local row types for the 0111 tables (mirror of the migration DDL)
// ---------------------------------------------------------------------------

export type ZelleIngestStateRow = {
  org_id: string;
  mailbox: string;
  uidvalidity: number | null;
  last_uid: number;
  lease_until: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export type ZelleInboundEmailRow = {
  id: string;
  org_id: string;
  message_id: string;
  imap_uid: number;
  uidvalidity: number;
  received_at: string | null;
  from_address: string | null;
  subject: string | null;
  raw_eml_path: string;
  raw_hash: string;
  template_id: string | null;
  auth_ok: boolean;
  dkim: string | null;
  spf: string | null;
  dmarc: string | null;
  auth_reasons: unknown;
  parse_status: "pending" | "parsed" | "parse_failed" | "rejected_auth";
  parse_error: string | null;
  notification_id: string | null;
  created_at: string;
}

export type ZelleLifecycleStatus =
  | "received"
  | "matched"
  | "review"
  | "applying"
  | "applied"
  | "dismissed"
  | "error";

export type ZelleNotificationRow = {
  id: string;
  org_id: string;
  email_id: string;
  transaction_number: string;
  sender_name: string;
  normalized_sender: string;
  amount_cents: number;
  sent_on: string | null;
  memo: string | null;
  ref_code: string | null;
  ref_ambiguous: boolean;
  name_cross_checked: boolean;
  lifecycle_status: ZelleLifecycleStatus;
  review_reason: string | null;
  applied_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ZelleMatchRow = {
  id: string;
  org_id: string;
  notification_id: string;
  case_id: string;
  installment_id: string;
  client_user_id: string | null;
  score: number;
  signals: MatchSignals;
  tier: "A" | "B";
  status: "suggested" | "approved" | "rejected" | "unmatched";
  auto_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  review_reason: string | null;
  created_at: string;
}

export type ZellePayerIdentityRow = {
  id: string;
  org_id: string;
  normalized_name: string;
  client_user_id: string;
  relationship: "self" | "family" | "third_party";
  confirmations_count: number;
  first_seen_at: string;
  last_seen_at: string;
  confirmed_by: string | null;
  revoked_at: string | null;
}

/**
 * Loose-but-shaped client for the 0111 tables. Cast happens on the client
 * object so every call keeps its receiver.
 */
type ZelleSchema = {
  public: {
    Tables: {
      zelle_ingest_state: {
        Row: ZelleIngestStateRow;
        Insert: Partial<ZelleIngestStateRow> & { org_id: string };
        Update: Partial<ZelleIngestStateRow>;
        Relationships: [];
      };
      zelle_inbound_emails: {
        Row: ZelleInboundEmailRow;
        Insert: Partial<ZelleInboundEmailRow> &
          Pick<ZelleInboundEmailRow, "org_id" | "message_id" | "imap_uid" | "uidvalidity" | "raw_eml_path" | "raw_hash">;
        Update: Partial<ZelleInboundEmailRow>;
        Relationships: [];
      };
      zelle_payment_notifications: {
        Row: ZelleNotificationRow;
        Insert: Partial<ZelleNotificationRow> &
          Pick<ZelleNotificationRow, "org_id" | "email_id" | "transaction_number" | "sender_name" | "normalized_sender" | "amount_cents">;
        Update: Partial<ZelleNotificationRow>;
        Relationships: [];
      };
      zelle_payment_matches: {
        Row: ZelleMatchRow;
        Insert: Partial<ZelleMatchRow> &
          Pick<ZelleMatchRow, "org_id" | "notification_id" | "case_id" | "installment_id" | "tier">;
        Update: Partial<ZelleMatchRow>;
        Relationships: [];
      };
      zelle_payer_identities: {
        Row: ZellePayerIdentityRow;
        Insert: Partial<ZellePayerIdentityRow> &
          Pick<ZellePayerIdentityRow, "org_id" | "normalized_name" | "client_user_id">;
        Update: Partial<ZellePayerIdentityRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

function zdb(): SupabaseClient<ZelleSchema> {
  return createServiceClient() as unknown as SupabaseClient<ZelleSchema>;
}

// ---------------------------------------------------------------------------
// Org + ingest state
// ---------------------------------------------------------------------------

/** Single-tenant resolution (V1: the one org). */
export async function findReconOrgId(): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  return data?.id ?? null;
}

/** Active admin user ids of the org — anomaly/heartbeat alert recipients. */
export async function listAdminUserIds(orgId: string): Promise<string[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("staff_profiles")
    .select("user_id, role, users!inner(org_id, is_active)")
    .eq("role", "admin")
    .eq("users.org_id", orgId)
    .eq("users.is_active", true);
  return (data ?? []).map((r) => r.user_id);
}

export async function getIngestState(orgId: string): Promise<ZelleIngestStateRow | null> {
  const { data } = await zdb()
    .from("zelle_ingest_state")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  return data ?? null;
}

/**
 * Claims the sweep lease with a conditional UPDATE (lease_until < now()).
 * Returns false when another sweep holds it. Creates the state row on first
 * ever run.
 */
export async function claimIngestLease(orgId: string, leaseSeconds: number): Promise<boolean> {
  const db = zdb();
  // Ensure the row exists (first run) — ignore duplicate.
  await db
    .from("zelle_ingest_state")
    .upsert({ org_id: orgId }, { onConflict: "org_id", ignoreDuplicates: true });

  const nowIso = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const { data, error } = await db
    .from("zelle_ingest_state")
    .update({ lease_until: leaseUntil, last_run_at: nowIso })
    .eq("org_id", orgId)
    .lt("lease_until", nowIso)
    .select("org_id");

  if (error) {
    throw new Error(`zelle-recon.repository: claimIngestLease failed — ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

/** Releases the lease and persists cursor + heartbeat fields. */
export async function releaseIngestLease(
  orgId: string,
  outcome: {
    success: boolean;
    lastUid?: number;
    uidvalidity?: number;
    error?: string | null;
  },
): Promise<void> {
  const fields: Partial<ZelleIngestStateRow> = {
    lease_until: new Date(0).toISOString(),
    last_error: outcome.error ?? null,
  };
  if (outcome.success) fields.last_success_at = new Date().toISOString();
  if (outcome.lastUid !== undefined) fields.last_uid = outcome.lastUid;
  if (outcome.uidvalidity !== undefined) fields.uidvalidity = outcome.uidvalidity;

  const { error } = await zdb()
    .from("zelle_ingest_state")
    .update(fields)
    .eq("org_id", orgId);
  if (error) {
    // Lease expires on its own — log, never throw over bookkeeping.
    logger.error({ err: error, orgId }, "zelle-recon: releaseIngestLease failed");
  }
}

// ---------------------------------------------------------------------------
// Inbound emails (evidence)
// ---------------------------------------------------------------------------

export async function insertInboundEmail(
  row: ZelleSchema["public"]["Tables"]["zelle_inbound_emails"]["Insert"],
): Promise<{ inserted: boolean; row: ZelleInboundEmailRow | null }> {
  const db = zdb();
  const { data, error } = await db
    .from("zelle_inbound_emails")
    .upsert(row, { onConflict: "message_id", ignoreDuplicates: true })
    .select("*");

  if (error) {
    throw new Error(`zelle-recon.repository: insertInboundEmail failed — ${error.message}`);
  }
  if (data && data.length > 0) return { inserted: true, row: data[0] };

  return { inserted: false, row: null };
}

export async function updateInboundEmailParse(
  id: string,
  fields: Pick<Partial<ZelleInboundEmailRow>, "parse_status" | "parse_error" | "notification_id">,
): Promise<void> {
  const { error } = await zdb().from("zelle_inbound_emails").update(fields).eq("id", id);
  if (error) {
    throw new Error(`zelle-recon.repository: updateInboundEmailParse failed — ${error.message}`);
  }
}

export async function findInboundEmailById(id: string): Promise<ZelleInboundEmailRow | null> {
  const { data } = await zdb().from("zelle_inbound_emails").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export async function findNotificationByTransactionNumber(
  transactionNumber: string,
): Promise<ZelleNotificationRow | null> {
  const { data } = await zdb()
    .from("zelle_payment_notifications")
    .select("*")
    .eq("transaction_number", transactionNumber)
    .maybeSingle();
  return data ?? null;
}

export async function findNotificationById(id: string): Promise<ZelleNotificationRow | null> {
  const { data } = await zdb()
    .from("zelle_payment_notifications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

/** Insert guarded by the unique transaction_number (Chase resend safe). */
export async function insertNotification(
  row: ZelleSchema["public"]["Tables"]["zelle_payment_notifications"]["Insert"],
): Promise<{ inserted: boolean; row: ZelleNotificationRow }> {
  const db = zdb();
  const { data, error } = await db
    .from("zelle_payment_notifications")
    .upsert(row, { onConflict: "transaction_number", ignoreDuplicates: true })
    .select("*");

  if (error) {
    throw new Error(`zelle-recon.repository: insertNotification failed — ${error.message}`);
  }
  if (data && data.length > 0) return { inserted: true, row: data[0] };

  const existing = await findNotificationByTransactionNumber(row.transaction_number);
  if (!existing) {
    throw new Error("zelle-recon.repository: notification upsert lost a race and no row exists");
  }
  return { inserted: false, row: existing };
}

export async function updateNotificationLifecycle(
  id: string,
  fields: Pick<Partial<ZelleNotificationRow>, "lifecycle_status" | "review_reason" | "applied_payment_id">,
): Promise<void> {
  const { error } = await zdb()
    .from("zelle_payment_notifications")
    .update(fields)
    .eq("id", id);
  if (error) {
    throw new Error(`zelle-recon.repository: updateNotificationLifecycle failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------

export async function insertMatches(
  rows: Array<ZelleSchema["public"]["Tables"]["zelle_payment_matches"]["Insert"]>,
): Promise<ZelleMatchRow[]> {
  if (rows.length === 0) return [];
  const { data, error } = await zdb().from("zelle_payment_matches").insert(rows).select("*");
  if (error) {
    throw new Error(`zelle-recon.repository: insertMatches failed — ${error.message}`);
  }
  return data ?? [];
}

export async function findMatchById(id: string): Promise<ZelleMatchRow | null> {
  const { data } = await zdb()
    .from("zelle_payment_matches")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

export async function listMatchesForNotification(
  notificationId: string,
): Promise<ZelleMatchRow[]> {
  const { data } = await zdb()
    .from("zelle_payment_matches")
    .select("*")
    .eq("notification_id", notificationId)
    .order("score", { ascending: false });
  return data ?? [];
}

export async function updateMatch(
  id: string,
  fields: Partial<ZelleMatchRow>,
): Promise<void> {
  const { error } = await zdb().from("zelle_payment_matches").update(fields).eq("id", id);
  if (error) {
    throw new Error(`zelle-recon.repository: updateMatch failed — ${error.message}`);
  }
}

/** After a human decision, sibling suggestions of the notification are closed. */
export async function rejectOtherSuggestedMatches(
  notificationId: string,
  exceptMatchId: string | null,
): Promise<void> {
  let query = zdb()
    .from("zelle_payment_matches")
    .update({ status: "rejected" as const })
    .eq("notification_id", notificationId)
    .eq("status", "suggested");
  if (exceptMatchId) query = query.neq("id", exceptMatchId);
  const { error } = await query;
  if (error) {
    throw new Error(`zelle-recon.repository: rejectOtherSuggestedMatches failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Inbox reads (review + auto-applied trays)
// ---------------------------------------------------------------------------

export async function listReviewNotifications(
  orgId: string,
  limit = 100,
): Promise<ZelleNotificationRow[]> {
  const { data } = await zdb()
    .from("zelle_payment_notifications")
    .select("*")
    .eq("org_id", orgId)
    .eq("lifecycle_status", "review")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function listSuggestedMatchesForNotifications(
  notificationIds: string[],
): Promise<ZelleMatchRow[]> {
  if (notificationIds.length === 0) return [];
  const { data } = await zdb()
    .from("zelle_payment_matches")
    .select("*")
    .in("notification_id", notificationIds)
    .eq("status", "suggested")
    .order("score", { ascending: false });
  return data ?? [];
}

export interface AutoAppliedItem {
  match: ZelleMatchRow;
  notification: ZelleNotificationRow;
}

export async function listAutoAppliedMatches(
  orgId: string,
  sinceIso: string,
): Promise<AutoAppliedItem[]> {
  const { data, error } = await zdb()
    .from("zelle_payment_matches")
    .select("*, zelle_payment_notifications!inner(*)")
    .eq("org_id", orgId)
    .eq("auto_approved", true)
    .eq("status", "approved")
    .gte("approved_at", sinceIso)
    .order("approved_at", { ascending: false });
  if (error) {
    throw new Error(`zelle-recon.repository: listAutoAppliedMatches failed — ${error.message}`);
  }
  return (data ?? []).map((row) => {
    const { zelle_payment_notifications: notification, ...match } = row as unknown as ZelleMatchRow & {
      zelle_payment_notifications: ZelleNotificationRow;
    };
    return { match: match as ZelleMatchRow, notification };
  });
}

// ---------------------------------------------------------------------------
// Case/installment enrichment (core tables)
// ---------------------------------------------------------------------------

export interface CaseHeader {
  caseId: string;
  caseNumber: string;
  clientUserId: string | null;
  clientName: string;
}

export async function getCaseHeaders(caseIds: string[]): Promise<Map<string, CaseHeader>> {
  const result = new Map<string, CaseHeader>();
  if (caseIds.length === 0) return result;
  const supabase = createServiceClient();
  const { data: cases } = await supabase
    .from("cases")
    .select("id, case_number, primary_client_id")
    .in("id", [...new Set(caseIds)]);
  const clientIds = [...new Set((cases ?? []).map((c) => c.primary_client_id).filter((v): v is string => !!v))];
  const { data: profiles } = clientIds.length
    ? await supabase.from("client_profiles").select("user_id, first_name, last_name").in("user_id", clientIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()]),
  );
  for (const c of cases ?? []) {
    result.set(c.id, {
      caseId: c.id,
      caseNumber: c.case_number,
      clientUserId: c.primary_client_id,
      clientName: c.primary_client_id ? (nameById.get(c.primary_client_id) ?? "") : "",
    });
  }
  return result;
}

export interface InstallmentHeader {
  installmentId: string;
  number: number;
  isDownpayment: boolean;
  amountCents: number;
  dueDate: string;
  status: string;
}

export async function getInstallmentHeaders(
  installmentIds: string[],
): Promise<Map<string, InstallmentHeader>> {
  const result = new Map<string, InstallmentHeader>();
  if (installmentIds.length === 0) return result;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("installments")
    .select("id, number, is_downpayment, amount_cents, due_date, status")
    .in("id", [...new Set(installmentIds)]);
  for (const i of data ?? []) {
    result.set(i.id, {
      installmentId: i.id,
      number: i.number,
      isDownpayment: i.is_downpayment,
      amountCents: i.amount_cents,
      dueDate: i.due_date,
      status: i.status,
    });
  }
  return result;
}

/** Pending client-uploaded Zelle payment for an installment (link, don't dup). */
export async function findPendingZellePaymentId(installmentId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payments")
    .select("id")
    .eq("installment_id", installmentId)
    .eq("method", "zelle")
    .eq("status", "pending")
    .maybeSingle();
  return data?.id ?? null;
}

// ---------------------------------------------------------------------------
// Payer identities (alias book)
// ---------------------------------------------------------------------------

export async function listAliasesByName(
  orgId: string,
  normalizedName: string,
): Promise<PayerAlias[]> {
  const { data } = await zdb()
    .from("zelle_payer_identities")
    .select("*")
    .eq("org_id", orgId)
    .eq("normalized_name", normalizedName);

  return (data ?? []).map((r) => ({
    normalizedName: r.normalized_name,
    clientUserId: r.client_user_id,
    relationship: r.relationship,
    confirmationsCount: r.confirmations_count,
    revoked: r.revoked_at !== null,
  }));
}

/**
 * Learns (or reinforces) an alias after a HUMAN confirmation. Read-then-write
 * is fine here: confirmations come from the inbox UI at human pace.
 */
export async function upsertPayerIdentity(input: {
  orgId: string;
  normalizedName: string;
  clientUserId: string;
  relationship: "self" | "family" | "third_party";
  confirmedBy: string;
}): Promise<void> {
  const db = zdb();
  const { data: existing } = await db
    .from("zelle_payer_identities")
    .select("id, confirmations_count")
    .eq("org_id", input.orgId)
    .eq("normalized_name", input.normalizedName)
    .eq("client_user_id", input.clientUserId)
    .maybeSingle();

  if (existing) {
    const { error } = await db
      .from("zelle_payer_identities")
      .update({
        confirmations_count: existing.confirmations_count + 1,
        last_seen_at: new Date().toISOString(),
        relationship: input.relationship,
        revoked_at: null,
      })
      .eq("id", existing.id);
    if (error) {
      throw new Error(`zelle-recon.repository: upsertPayerIdentity update failed — ${error.message}`);
    }
    return;
  }

  const { error } = await db.from("zelle_payer_identities").insert({
    org_id: input.orgId,
    normalized_name: input.normalizedName,
    client_user_id: input.clientUserId,
    relationship: input.relationship,
    confirmed_by: input.confirmedBy,
  });
  if (error) {
    throw new Error(`zelle-recon.repository: upsertPayerIdentity insert failed — ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Daily auto-approval stats (circuit breakers)
// ---------------------------------------------------------------------------

export async function getDailyAutoStats(orgId: string): Promise<DailyAutoStats> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data, error } = await zdb()
    .from("zelle_payment_matches")
    .select("id, approved_at, zelle_payment_notifications!inner(amount_cents, normalized_sender)")
    .eq("org_id", orgId)
    .eq("auto_approved", true)
    .eq("status", "approved")
    .gte("approved_at", startOfDay.toISOString());

  if (error) {
    throw new Error(`zelle-recon.repository: getDailyAutoStats failed — ${error.message}`);
  }

  const stats: DailyAutoStats = { totalCents: 0, count: 0, byPayer: {} };
  for (const row of data ?? []) {
    const n = (row as unknown as {
      zelle_payment_notifications: { amount_cents: number; normalized_sender: string };
    }).zelle_payment_notifications;
    stats.totalCents += n.amount_cents;
    stats.count += 1;
    stats.byPayer[n.normalized_sender] = (stats.byPayer[n.normalized_sender] ?? 0) + 1;
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Case resolution + match candidates (core tables — typed client)
// ---------------------------------------------------------------------------

export async function findCaseIdByCaseNumber(
  orgId: string,
  caseNumber: string,
): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("cases")
    .select("id, status")
    .eq("org_id", orgId)
    .eq("case_number", caseNumber)
    .maybeSingle();
  if (!data || data.status === "cancelled") return null;
  return data.id;
}

/**
 * Loads every payable installment of the org with its case/client context —
 * the candidate universe for both tiers. Deliberately a handful of small
 * typed queries instead of one deep PostgREST embed: volumes are tiny
 * (open installments), and each step stays readable and typed.
 */
export async function listMatchCandidates(orgId: string): Promise<MatchCandidate[]> {
  const supabase = createServiceClient();

  // 1. Payable installments + plan → contract (case_id)
  const { data: installments, error } = await supabase
    .from("installments")
    .select(
      "id, number, is_downpayment, amount_cents, due_date, status, payment_plan_id, payment_plans!inner(id, contract_id, contracts!inner(id, case_id))",
    )
    .in("status", ["pending", "overdue"]);
  if (error) {
    throw new Error(`zelle-recon.repository: listMatchCandidates installments — ${error.message}`);
  }
  if (!installments || installments.length === 0) return [];

  type InstJoin = {
    id: string;
    number: number;
    is_downpayment: boolean;
    amount_cents: number;
    due_date: string;
    status: "pending" | "overdue";
    payment_plan_id: string;
    payment_plans: { id: string; contract_id: string; contracts: { id: string; case_id: string | null } };
  };
  const instRows = installments as unknown as InstJoin[];
  const caseIds = [...new Set(instRows.map((r) => r.payment_plans.contracts.case_id).filter((v): v is string => !!v))];
  if (caseIds.length === 0) return [];

  // 2. Cases of this org (skip cancelled)
  const { data: cases } = await supabase
    .from("cases")
    .select("id, case_number, primary_client_id, service_id, status, org_id")
    .in("id", caseIds)
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  const caseById = new Map((cases ?? []).map((c) => [c.id, c]));
  if (caseById.size === 0) return [];

  // 3. Service slugs
  const serviceIds = [...new Set((cases ?? []).map((c) => c.service_id).filter((v): v is string => !!v))];
  const { data: services } = serviceIds.length
    ? await supabase.from("services").select("id, slug").in("id", serviceIds)
    : { data: [] as Array<{ id: string; slug: string }> };
  const slugById = new Map((services ?? []).map((s) => [s.id, s.slug]));

  // 4. Client names
  const clientIds = [...new Set((cases ?? []).map((c) => c.primary_client_id).filter((v): v is string => !!v))];
  const { data: profiles } = clientIds.length
    ? await supabase.from("client_profiles").select("user_id, first_name, last_name").in("user_id", clientIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null }> };
  const nameById = new Map(
    (profiles ?? []).map((p) => [p.user_id, `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()]),
  );

  // 5. In-flight payments on those installments (stripe mutex + zelle proof link)
  const instIds = instRows.map((r) => r.id);
  const { data: pendingPayments } = await supabase
    .from("payments")
    .select("id, installment_id, method, status")
    .in("installment_id", instIds)
    .eq("status", "pending");
  const pendingByInst = new Map<string, { stripe: boolean; zelleId: string | null }>();
  for (const p of pendingPayments ?? []) {
    const cur = pendingByInst.get(p.installment_id) ?? { stripe: false, zelleId: null };
    if (p.method === "stripe") cur.stripe = true;
    if (p.method === "zelle") cur.zelleId = p.id;
    pendingByInst.set(p.installment_id, cur);
  }

  // 6. Remaining balance per plan (sum of its payable installments)
  const balanceByPlan = new Map<string, number>();
  for (const r of instRows) {
    balanceByPlan.set(
      r.payment_plan_id,
      (balanceByPlan.get(r.payment_plan_id) ?? 0) + r.amount_cents,
    );
  }

  const candidates: MatchCandidate[] = [];
  for (const r of instRows) {
    const caseId = r.payment_plans.contracts.case_id;
    if (!caseId) continue;
    const caseRow = caseById.get(caseId);
    if (!caseRow || !caseRow.primary_client_id) continue;
    const pending = pendingByInst.get(r.id) ?? { stripe: false, zelleId: null };
    candidates.push({
      caseId,
      caseNumber: caseRow.case_number,
      serviceSlug: caseRow.service_id ? (slugById.get(caseRow.service_id) ?? null) : null,
      installmentId: r.id,
      installmentNumber: r.number,
      isDownpayment: r.is_downpayment,
      amountCents: r.amount_cents,
      dueDate: r.due_date,
      status: r.status,
      clientUserId: caseRow.primary_client_id,
      clientFullName: nameById.get(caseRow.primary_client_id) ?? "",
      hasPendingStripe: pending.stripe,
      pendingZellePaymentId: pending.zelleId,
      caseBalanceCents: balanceByPlan.get(r.payment_plan_id) ?? r.amount_cents,
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Recon config (orgs.settings.zelle_reconciliation)
// ---------------------------------------------------------------------------

export async function readOrgSettingsRaw(orgId: string): Promise<Record<string, unknown>> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("orgs").select("settings").eq("id", orgId).maybeSingle();
  return (data?.settings as Record<string, unknown>) ?? {};
}

/** Merges ONLY the zelle_reconciliation key — never rewrites other settings. */
export async function writeReconSettings(
  orgId: string,
  reconSettings: Record<string, unknown>,
): Promise<void> {
  const supabase = createServiceClient();
  const current = await readOrgSettingsRaw(orgId);
  const merged = { ...current, zelle_reconciliation: reconSettings };
  const { error } = await supabase
    .from("orgs")
    .update({ settings: merged as import("@/shared/database.types").Json })
    .eq("id", orgId);
  if (error) {
    throw new Error(`zelle-recon.repository: writeReconSettings failed — ${error.message}`);
  }
}
