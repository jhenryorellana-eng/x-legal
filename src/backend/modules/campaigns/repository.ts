/**
 * Campaigns module — repository (service client; bypasses RLS).
 *
 * @module campaigns/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";
import type { AudienceSpec, CampaignStatus } from "./domain";

export type CampaignRow = Tables<"broadcast_campaigns">;
export type RecipientRow = Tables<"campaign_recipients">;

// ---------------------------------------------------------------------------
// Campaign CRUD
// ---------------------------------------------------------------------------

export async function insertCampaign(row: TablesInsert<"broadcast_campaigns">): Promise<CampaignRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("broadcast_campaigns").insert(row).select().single();
  if (error || !data) throw new Error(`campaigns.repository: insertCampaign — ${error?.message}`);
  return data;
}

export async function updateCampaign(
  id: string,
  patch: TablesUpdate<"broadcast_campaigns">,
): Promise<CampaignRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error || !data) throw new Error(`campaigns.repository: updateCampaign — ${error?.message}`);
  return data;
}

export async function findCampaignById(id: string): Promise<CampaignRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("broadcast_campaigns").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`, "utf8").toString("base64");
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64").toString("utf8").split("|");
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export async function listCampaigns(
  orgId: string,
  opts: { status?: CampaignStatus; cursor?: string; limit?: number },
): Promise<{ items: CampaignRow[]; nextCursor: string | null }> {
  const supabase = createServiceClient();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);

  let query = supabase.from("broadcast_campaigns").select("*").eq("org_id", orgId);
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor);
    if (c) {
      query = query.or(`created_at.lt.${c.createdAt},and(created_at.eq.${c.createdAt},id.lt.${c.id})`);
    }
  }
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  const { data, error } = await query;
  if (error) throw new Error(`campaigns.repository: listCampaigns — ${error.message}`);

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Audience resolution
// ---------------------------------------------------------------------------

export interface AudienceCandidate {
  userId: string;
  email: string | null;
  locale: string | null;
  marketingOptIn: boolean;
  emailBouncedAt: string | null;
}

interface UserCandidateRow {
  id: string;
  email: string | null;
  locale: string | null;
  email_bounced_at: string | null;
  client_profiles:
    | { marketing_opt_in: boolean }
    | Array<{ marketing_opt_in: boolean }>
    | null;
}

function toCandidate(u: UserCandidateRow): AudienceCandidate {
  const cpRaw = u.client_profiles;
  const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw;
  return {
    userId: u.id,
    email: u.email,
    locale: u.locale,
    marketingOptIn: cp?.marketing_opt_in ?? true,
    emailBouncedAt: u.email_bounced_at,
  };
}

async function fetchClientCandidates(orgId: string, userIds?: string[]): Promise<AudienceCandidate[]> {
  if (userIds && userIds.length === 0) return [];
  const supabase = createServiceClient();
  let q = supabase
    .from("users")
    .select("id, email, locale, email_bounced_at, client_profiles(marketing_opt_in)")
    .eq("org_id", orgId)
    .eq("kind", "client")
    .eq("is_active", true);
  if (userIds) q = q.in("id", userIds);
  const { data, error } = await q;
  if (error) throw new Error(`campaigns.repository: fetchClientCandidates — ${error.message}`);
  return ((data ?? []) as unknown as UserCandidateRow[]).map(toCandidate);
}

/**
 * Resolves an audience spec to client candidates (with suppression flags).
 * org_id is always enforced (cross-org safety; service client bypasses RLS).
 */
export async function resolveAudience(
  orgId: string,
  audience: AudienceSpec,
): Promise<AudienceCandidate[]> {
  if (audience.kind === "all_clients") {
    return fetchClientCandidates(orgId);
  }
  if (audience.kind === "custom") {
    return fetchClientCandidates(orgId, audience.userIds);
  }
  // by_service → clients who are the primary client of a case with that service
  if (audience.serviceIds.length === 0) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("cases")
    .select("primary_client_id")
    .eq("org_id", orgId)
    .in("service_id", audience.serviceIds);
  if (error) throw new Error(`campaigns.repository: resolveAudience(by_service) — ${error.message}`);
  const ids = [...new Set((data ?? []).map((c) => c.primary_client_id).filter(Boolean))] as string[];
  return fetchClientCandidates(orgId, ids);
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export async function upsertRecipients(rows: TablesInsert<"campaign_recipients">[]): Promise<void> {
  if (rows.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campaign_recipients")
    .upsert(rows, { onConflict: "campaign_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(`campaigns.repository: upsertRecipients — ${error.message}`);
}

/**
 * Promotes already-materialized 'pending' recipients to 'suppressed' for users
 * who became ineligible AFTER materialization (e.g. opted out between scheduling
 * and the scheduled fire). Only touches 'pending' rows — never demotes 'sent' (STRONG-4).
 */
export async function suppressPendingRecipients(campaignId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campaign_recipients")
    .update({ status: "suppressed" })
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .in("user_id", userIds);
  if (error) throw new Error(`campaigns.repository: suppressPendingRecipients — ${error.message}`);
}

/**
 * Atomically transitions a campaign scheduled → sending. Returns true only if
 * THIS call won the transition (UPDATE ... WHERE status='scheduled'). A second
 * concurrent worker (slow QStash ACK) gets false and must not re-process (MED-2).
 */
export async function claimScheduledForSending(campaignId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("broadcast_campaigns")
    .update({ status: "sending" })
    .eq("id", campaignId)
    .eq("status", "scheduled")
    .select("id");
  if (error) throw new Error(`campaigns.repository: claimScheduledForSending — ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function listPendingRecipients(campaignId: string, limit: number): Promise<RecipientRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`campaigns.repository: listPendingRecipients — ${error.message}`);
  return data ?? [];
}

export interface SendRecipient {
  id: string;
  userId: string;
  email: string;
  locale: string;
}

/** Pending recipients joined with the user's locale, for the send job. */
export async function listPendingRecipientsForSend(
  campaignId: string,
  limit: number,
): Promise<SendRecipient[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("campaign_recipients")
    .select("id, user_id, email, users!inner(locale)")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`campaigns.repository: listPendingRecipientsForSend — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    email: string;
    users: { locale: string } | Array<{ locale: string }> | null;
  }>;
  return rows.map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users;
    return { id: r.id, userId: r.user_id, email: r.email, locale: u?.locale ?? "es" };
  });
}

/** Resolves a user_id by email (for transactional bounces without a recipient row). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function countPendingRecipients(campaignId: string): Promise<number> {
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "pending");
  if (error) throw new Error(`campaigns.repository: countPendingRecipients — ${error.message}`);
  return count ?? 0;
}

export async function markRecipientsSent(ids: string[], sentAt: string): Promise<void> {
  if (ids.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campaign_recipients")
    .update({ status: "sent", sent_at: sentAt })
    .in("id", ids);
  if (error) throw new Error(`campaigns.repository: markRecipientsSent — ${error.message}`);
}

export async function markRecipientsFailed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campaign_recipients")
    .update({ status: "failed" })
    .in("id", ids);
  if (error) throw new Error(`campaigns.repository: markRecipientsFailed — ${error.message}`);
}

export interface CampaignMetrics {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  suppressed: number;
  bounced: number;
  complained: number;
}

export async function campaignMetrics(campaignId: string): Promise<CampaignMetrics> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("campaign_recipients")
    .select("status")
    .eq("campaign_id", campaignId);
  if (error) throw new Error(`campaigns.repository: campaignMetrics — ${error.message}`);

  const m: CampaignMetrics = { total: 0, pending: 0, sent: 0, failed: 0, suppressed: 0, bounced: 0, complained: 0 };
  for (const r of (data ?? []) as Array<{ status: string }>) {
    m.total += 1;
    if (r.status in m) (m as unknown as Record<string, number>)[r.status] += 1;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Webhook helpers (Resend → suppression)
// ---------------------------------------------------------------------------

/** Finds the most recent recipient row for an email (any campaign). */
export async function findRecipientByEmail(email: string): Promise<RecipientRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("campaign_recipients")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function setRecipientStatus(id: string, status: string, eventAt: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("campaign_recipients")
    .update({ status, last_event_at: eventAt })
    .eq("id", id);
  if (error) throw new Error(`campaigns.repository: setRecipientStatus — ${error.message}`);
}

/** Marks a hard bounce on the user (disables future email). */
export async function markUserBounced(userId: string, at: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("users").update({ email_bounced_at: at }).eq("id", userId);
  if (error) throw new Error(`campaigns.repository: markUserBounced — ${error.message}`);
}

/** Opts a client out of marketing (complaint or unsubscribe). */
export async function optOutClientMarketing(userId: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("client_profiles")
    .update({ marketing_opt_in: false })
    .eq("user_id", userId);
  if (error) throw new Error(`campaigns.repository: optOutClientMarketing — ${error.message}`);
}

/** Resolves the org_id of a campaign (for the cross-org guard). */
export async function findCampaignOrgId(campaignId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("broadcast_campaigns")
    .select("org_id")
    .eq("id", campaignId)
    .maybeSingle();
  return data?.org_id ?? null;
}

export interface OrgClient {
  userId: string;
  name: string;
  email: string | null;
}

/** Lists the org's active clients (for the custom-audience picker). */
export async function listOrgClients(orgId: string, limit = 500): Promise<OrgClient[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, client_profiles(first_name, last_name)")
    .eq("org_id", orgId)
    .eq("kind", "client")
    .eq("is_active", true)
    .limit(limit);
  if (error) throw new Error(`campaigns.repository: listOrgClients — ${error.message}`);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    email: string | null;
    client_profiles: { first_name: string; last_name: string } | Array<{ first_name: string; last_name: string }> | null;
  }>;
  return rows.map((u) => {
    const cpRaw = u.client_profiles;
    const cp = Array.isArray(cpRaw) ? cpRaw[0] : cpRaw;
    const name = cp ? `${cp.first_name} ${cp.last_name}`.trim() : u.email ?? u.id;
    return { userId: u.id, name, email: u.email };
  });
}

/** Resolves a user's org by email (for the Resend webhook idempotency barrier). */
export async function findUserOrgByEmail(email: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("users")
    .select("org_id")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}
