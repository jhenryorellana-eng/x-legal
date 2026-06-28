/**
 * Retention module — repository (service client; bypasses RLS, authz in service).
 *
 * @module retention/repository
 */

import { createServiceClient } from "@/backend/platform/supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/shared/database.types";

export type PromotionRow = Tables<"promotions">;
export type PromotionRedemptionRow = Tables<"promotion_redemptions">;
export type ReferralCodeRow = Tables<"referral_codes">;
export type ReferralRow = Tables<"referrals">;
export type ReviewRow = Tables<"reviews">;

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export async function insertPromotion(row: TablesInsert<"promotions">): Promise<PromotionRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("promotions").insert(row).select().single();
  if (error || !data) throw new Error(`retention.repository: insertPromotion — ${error?.message}`);
  return data;
}

export async function listPromotionsByOrg(orgId: string): Promise<PromotionRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("promotions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`retention.repository: listPromotionsByOrg — ${error.message}`);
  return data ?? [];
}

export async function findPromotionByCode(orgId: string, code: string): Promise<PromotionRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("promotions")
    .select("*")
    .eq("org_id", orgId)
    .eq("code", code)
    .maybeSingle();
  return data ?? null;
}

export async function findPromotionById(id: string): Promise<PromotionRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("promotions").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function updatePromotionRow(id: string, patch: TablesUpdate<"promotions">): Promise<PromotionRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("promotions").update(patch).eq("id", id).select().single();
  if (error || !data) throw new Error(`retention.repository: updatePromotionRow — ${error?.message}`);
  return data;
}

export async function deletePromotionRow(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("promotions").delete().eq("id", id);
  if (error) throw new Error(`retention.repository: deletePromotionRow — ${error.message}`);
}

/**
 * Atomically claims a coupon use under a row lock: increments used_count only if
 * the promo is active, within its validity window, and below max_uses. Returns
 * true on success, false if the coupon is exhausted/inactive (RPC claim_promotion_use,
 * migration 0043). Authoritative max_uses enforcement (closes the redeem TOCTOU).
 */
export async function claimPromotionUse(promoId: string): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("claim_promotion_use", { p_promo_id: promoId });
  if (error) throw new Error(`retention.repository: claimPromotionUse — ${error.message}`);
  return data === true;
}

/** Records a redemption row (the counter is bumped atomically by claimPromotionUse). */
export async function insertRedemption(row: TablesInsert<"promotion_redemptions">): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.from("promotion_redemptions").insert(row);
  if (error) throw new Error(`retention.repository: insertRedemption — ${error.message}`);
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export async function getReferralCode(orgId: string, userId: string): Promise<ReferralCodeRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("referral_codes")
    .select("*")
    .eq("org_id", orgId)
    .eq("referrer_user_id", userId)
    .maybeSingle();
  return data ?? null;
}

export async function insertReferralCode(row: TablesInsert<"referral_codes">): Promise<ReferralCodeRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("referral_codes").insert(row).select().single();
  if (error || !data) throw new Error(`retention.repository: insertReferralCode — ${error?.message}`);
  return data;
}

export async function findReferralCodeByCode(orgId: string, code: string): Promise<ReferralCodeRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("referral_codes")
    .select("*")
    .eq("org_id", orgId)
    .eq("code", code)
    .maybeSingle();
  return data ?? null;
}

export interface ReferralWithReferrer {
  referral: ReferralRow;
  referrerName: string | null;
  code: string;
}

/** Resolves "First Last" per user from client_profiles (no FK embed assumed). */
async function fetchClientNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (ids.length === 0) return map;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("client_profiles")
    .select("user_id, first_name, last_name")
    .in("user_id", ids);
  for (const r of (data ?? []) as Array<{ user_id: string; first_name: string; last_name: string }>) {
    map.set(r.user_id, `${r.first_name} ${r.last_name}`.trim());
  }
  return map;
}

/** Referral events for an org with the referrer's display name + code (newest first). */
export async function listReferralsByOrg(orgId: string): Promise<ReferralWithReferrer[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("referrals")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`retention.repository: listReferralsByOrg — ${error.message}`);
  const rows = data ?? [];
  const codeIds = [...new Set(rows.map((r) => r.referral_code_id))];
  const codeMap = new Map<string, { code: string; referrer_user_id: string }>();
  if (codeIds.length > 0) {
    const { data: codes } = await supabase
      .from("referral_codes")
      .select("id, code, referrer_user_id")
      .in("id", codeIds);
    for (const c of (codes ?? []) as Array<{ id: string; code: string; referrer_user_id: string }>) {
      codeMap.set(c.id, { code: c.code, referrer_user_id: c.referrer_user_id });
    }
  }
  const names = await fetchClientNames([...codeMap.values()].map((c) => c.referrer_user_id));
  return rows.map((r) => {
    const c = codeMap.get(r.referral_code_id);
    return {
      referral: r,
      code: c?.code ?? "",
      referrerName: c ? (names.get(c.referrer_user_id) ?? null) : null,
    };
  });
}

export async function insertReferral(row: TablesInsert<"referrals">): Promise<ReferralRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("referrals").insert(row).select().single();
  if (error || !data) throw new Error(`retention.repository: insertReferral — ${error?.message}`);
  return data;
}

export async function findReferralById(id: string): Promise<ReferralRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("referrals").select("*").eq("id", id).maybeSingle();
  return data ?? null;
}

export async function updateReferralRow(id: string, patch: TablesUpdate<"referrals">): Promise<ReferralRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("referrals").update(patch).eq("id", id).select().single();
  if (error || !data) throw new Error(`retention.repository: updateReferralRow — ${error?.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export async function insertReview(row: TablesInsert<"reviews">): Promise<ReviewRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("reviews").insert(row).select().single();
  if (error || !data) throw new Error(`retention.repository: insertReview — ${error?.message}`);
  return data;
}

export async function findReviewByCase(userId: string, caseId: string): Promise<ReviewRow | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("reviews")
    .select("*")
    .eq("user_id", userId)
    .eq("case_id", caseId)
    .maybeSingle();
  return data ?? null;
}

export async function updateReviewRow(id: string, patch: TablesUpdate<"reviews">): Promise<ReviewRow> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("reviews").update(patch).eq("id", id).select().single();
  if (error || !data) throw new Error(`retention.repository: updateReviewRow — ${error?.message}`);
  return data;
}

export interface ReviewWithClient {
  review: ReviewRow;
  clientName: string | null;
}

export async function listReviewsByOrg(orgId: string): Promise<ReviewWithClient[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`retention.repository: listReviewsByOrg — ${error.message}`);
  const rows = data ?? [];
  const names = await fetchClientNames(rows.map((r) => r.user_id));
  return rows.map((r) => ({ review: r, clientName: names.get(r.user_id) ?? null }));
}
