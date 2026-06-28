/**
 * Retention module — service (use cases, authz). Lifecycle "después" / fidelización.
 *
 * Promotions (RF-AND retención), referrals, reviews/NPS. Each operation gates on
 * its own module key (`promotions` | `referrals` | `reviews`); admin bypasses.
 *
 * @module retention/service
 */

import { z } from "zod";
import { can } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { writeAudit } from "@/backend/modules/audit";
import type { Json } from "@/shared/database.types";
import {
  promotionBlockReason,
  computeDiscountCents,
  normalizePromoCode,
  referralCodeFor,
  computeNps,
  averageRating,
  type PromotionView,
  type ReferralStatus,
  type ReviewStats,
} from "./domain";
import {
  insertPromotion,
  listPromotionsByOrg,
  findPromotionByCode,
  findPromotionById,
  updatePromotionRow,
  deletePromotionRow,
  insertRedemption,
  getReferralCode,
  insertReferralCode,
  findReferralCodeByCode,
  listReferralsByOrg,
  insertReferral,
  findReferralById,
  updateReferralRow,
  claimPromotionUse,
  insertReview,
  findReviewByCase,
  updateReviewRow,
  listReviewsByOrg,
  type PromotionRow,
} from "./repository";

export class RetentionError extends Error {
  constructor(
    public readonly code:
      | "PROMO_NOT_FOUND"
      | "PROMO_CODE_TAKEN"
      | "PROMO_NOT_REDEEMABLE"
      | "REFERRAL_CODE_NOT_FOUND"
      | "REVIEW_NOT_FOUND"
      | "REVIEW_ALREADY_SUBMITTED"
      | "INVALID_INPUT",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "RetentionError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

function toPromotionView(r: PromotionRow): PromotionView {
  const scope = (r.service_scope as { service_ids?: string[] } | null)?.service_ids ?? null;
  return {
    id: r.id,
    code: r.code,
    description: r.description,
    kind: r.kind as "percent" | "amount",
    value: r.value,
    currency: r.currency,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    maxUses: r.max_uses,
    usedCount: r.used_count,
    isActive: r.is_active,
    serviceScope: scope,
  };
}

const CreatePromotionSchema = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(280).nullable().optional(),
  kind: z.enum(["percent", "amount"]),
  value: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  validFrom: z.string().datetime().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  maxUses: z.number().int().positive().nullable().optional(),
});
export type CreatePromotionInput = z.infer<typeof CreatePromotionSchema>;

export async function createPromotion(actor: Actor, input: CreatePromotionInput): Promise<PromotionView> {
  can(actor, "promotions", "edit");
  const p = CreatePromotionSchema.parse(input);
  if (p.kind === "percent" && p.value > 100) throw new RetentionError("INVALID_INPUT", { reason: "percent>100" });
  const code = normalizePromoCode(p.code);
  if (code.length < 2) throw new RetentionError("INVALID_INPUT", { reason: "code" });
  if (await findPromotionByCode(actor.orgId, code)) throw new RetentionError("PROMO_CODE_TAKEN");

  const row = await insertPromotion({
    org_id: actor.orgId,
    code,
    description: p.description ?? null,
    kind: p.kind,
    value: p.value,
    currency: p.currency ?? "usd",
    service_scope: p.serviceIds && p.serviceIds.length > 0 ? ({ service_ids: p.serviceIds } as Json) : null,
    valid_from: p.validFrom ?? null,
    valid_until: p.validUntil ?? null,
    max_uses: p.maxUses ?? null,
    is_active: true,
    created_by: actor.userId,
  });
  await writeAudit(actor, "promotions.created", "promotions", row.id, { after: { code } });
  return toPromotionView(row);
}

export async function listPromotions(actor: Actor): Promise<PromotionView[]> {
  can(actor, "promotions", "view");
  const rows = await listPromotionsByOrg(actor.orgId);
  return rows.map(toPromotionView);
}

export async function setPromotionActive(actor: Actor, id: string, isActive: boolean): Promise<PromotionView> {
  can(actor, "promotions", "edit");
  const row = await findPromotionById(id);
  if (!row || row.org_id !== actor.orgId) throw new RetentionError("PROMO_NOT_FOUND");
  const updated = await updatePromotionRow(id, { is_active: isActive });
  await writeAudit(actor, "promotions.toggled", "promotions", id, { after: { isActive } });
  return toPromotionView(updated);
}

export async function deletePromotion(actor: Actor, id: string): Promise<void> {
  can(actor, "promotions", "edit");
  const row = await findPromotionById(id);
  if (!row || row.org_id !== actor.orgId) throw new RetentionError("PROMO_NOT_FOUND");
  await deletePromotionRow(id);
  await writeAudit(actor, "promotions.deleted", "promotions", id, { before: { code: row.code } });
}

const RedeemPromotionSchema = z.object({
  code: z.string().min(2).max(40),
  baseAmountCents: z.number().int().nonnegative(),
  caseId: z.string().uuid().nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
});
export type RedeemPromotionInput = z.infer<typeof RedeemPromotionSchema>;

/** Validates a coupon and records the redemption, returning the discount applied (cents). */
export async function redeemPromotion(
  actor: Actor,
  input: RedeemPromotionInput,
): Promise<{ discountCents: number; finalCents: number; promotionId: string }> {
  can(actor, "promotions", "edit");
  const p = RedeemPromotionSchema.parse(input);
  const row = await findPromotionByCode(actor.orgId, normalizePromoCode(p.code));
  if (!row) throw new RetentionError("PROMO_NOT_FOUND");
  const view = toPromotionView(row);
  const reason = promotionBlockReason(view, nowIso(), p.serviceId ?? undefined);
  if (reason) throw new RetentionError("PROMO_NOT_REDEEMABLE", { reason });

  // Atomically claim a use (re-checks active + max_uses + validity window under a
  // row lock) — closes the TOCTOU between the block-reason check above and the
  // counter bump. If the coupon was exhausted/expired meanwhile, the claim fails.
  const claimed = await claimPromotionUse(row.id);
  if (!claimed) throw new RetentionError("PROMO_NOT_REDEEMABLE", { reason: "exhausted" });

  const discountCents = computeDiscountCents(view.kind, view.value, p.baseAmountCents);
  await insertRedemption({
    promotion_id: row.id,
    org_id: actor.orgId,
    case_id: p.caseId ?? null,
    user_id: p.userId ?? null,
    amount_cents: discountCents,
    redeemed_by: actor.userId,
  });
  await writeAudit(actor, "promotions.redeemed", "promotions", row.id, { after: { discountCents, caseId: p.caseId } });
  return { discountCents, finalCents: Math.max(0, p.baseAmountCents - discountCents), promotionId: row.id };
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

/** Returns the user's stable referral code, minting it on first request. */
export async function ensureReferralCode(actor: Actor, userId: string): Promise<string> {
  can(actor, "referrals", "view");
  const existing = await getReferralCode(actor.orgId, userId);
  if (existing) return existing.code;
  const code = referralCodeFor(userId);
  const row = await insertReferralCode({ org_id: actor.orgId, referrer_user_id: userId, code, is_active: true });
  return row.code;
}

export interface ReferralListItem {
  id: string;
  code: string;
  referrerName: string | null;
  status: ReferralStatus;
  referredLeadId: string | null;
  referredUserId: string | null;
  convertedAt: string | null;
  rewardedAt: string | null;
  createdAt: string;
}

export interface ReferralListResult {
  items: ReferralListItem[];
  stats: { total: number; converted: number; rewarded: number };
}

export async function listReferrals(actor: Actor): Promise<ReferralListResult> {
  can(actor, "referrals", "view");
  const rows = await listReferralsByOrg(actor.orgId);
  const items: ReferralListItem[] = rows.map((r) => ({
    id: r.referral.id,
    code: r.code,
    referrerName: r.referrerName,
    status: r.referral.status as ReferralStatus,
    referredLeadId: r.referral.referred_lead_id,
    referredUserId: r.referral.referred_user_id,
    convertedAt: r.referral.converted_at,
    rewardedAt: r.referral.rewarded_at,
    createdAt: r.referral.created_at,
  }));
  return {
    items,
    stats: {
      total: items.length,
      converted: items.filter((i) => i.status === "converted" || i.status === "rewarded").length,
      rewarded: items.filter((i) => i.status === "rewarded").length,
    },
  };
}

/** Records a referral event when a lead/user arrives via a code (system or staff). */
export async function recordReferral(
  actor: Actor,
  input: { code: string; referredLeadId?: string | null; referredUserId?: string | null },
): Promise<void> {
  can(actor, "referrals", "edit");
  const codeRow = await findReferralCodeByCode(actor.orgId, input.code.trim().toUpperCase());
  if (!codeRow) throw new RetentionError("REFERRAL_CODE_NOT_FOUND");
  await insertReferral({
    org_id: actor.orgId,
    referral_code_id: codeRow.id,
    referred_lead_id: input.referredLeadId ?? null,
    referred_user_id: input.referredUserId ?? null,
    status: "pending",
  });
}

export async function markReferralRewarded(actor: Actor, referralId: string): Promise<void> {
  can(actor, "referrals", "edit");
  const row = await findReferralById(referralId);
  if (!row || row.org_id !== actor.orgId) throw new RetentionError("REFERRAL_CODE_NOT_FOUND");
  await updateReferralRow(referralId, { status: "rewarded", rewarded_at: nowIso() });
  await writeAudit(actor, "referrals.rewarded", "referrals", referralId, {});
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** Opens a review request for a completed case (idempotent per case+user). */
export async function requestReview(
  actor: Actor,
  input: { userId: string; caseId: string },
): Promise<void> {
  can(actor, "reviews", "edit");
  const existing = await findReviewByCase(input.userId, input.caseId);
  if (existing) return; // already requested or submitted
  await insertReview({
    org_id: actor.orgId,
    user_id: input.userId,
    case_id: input.caseId,
    requested_at: nowIso(),
  });
}

/** System-triggered review request (e.g. on case.completed) — no actor session. */
export async function requestReviewSystem(orgId: string, userId: string, caseId: string): Promise<void> {
  const existing = await findReviewByCase(userId, caseId);
  if (existing) return;
  await insertReview({
    org_id: orgId,
    user_id: userId,
    case_id: caseId,
    requested_at: nowIso(),
  });
}

const SubmitReviewSchema = z.object({
  caseId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  nps: z.number().int().min(0).max(10).nullable().optional(),
  body: z.string().max(2000).nullable().optional(),
  isPublic: z.boolean().optional(),
});
export type SubmitReviewInput = z.infer<typeof SubmitReviewSchema>;

/** Client submits their review for a case (the author IS the actor — clients only). */
export async function submitReview(actor: Actor, input: SubmitReviewInput): Promise<void> {
  // Reviews are authored by clients about their own case; the row is scoped to the
  // actor's user_id + org_id, so a staff caller would mis-attribute the review.
  if (actor.kind !== "client") throw new RetentionError("INVALID_INPUT", { reason: "client_only" });
  const p = SubmitReviewSchema.parse(input);
  const existing = await findReviewByCase(actor.userId, p.caseId);
  if (existing?.submitted_at) throw new RetentionError("REVIEW_ALREADY_SUBMITTED");
  if (existing) {
    await updateReviewRow(existing.id, {
      rating: p.rating,
      nps: p.nps ?? null,
      body: p.body ?? null,
      is_public: p.isPublic ?? false,
      submitted_at: nowIso(),
    });
    return;
  }
  await insertReview({
    org_id: actor.orgId,
    user_id: actor.userId,
    case_id: p.caseId,
    rating: p.rating,
    nps: p.nps ?? null,
    body: p.body ?? null,
    is_public: p.isPublic ?? false,
    submitted_at: nowIso(),
  });
}

export interface ReviewListItem {
  id: string;
  clientName: string | null;
  rating: number | null;
  nps: number | null;
  body: string | null;
  isPublic: boolean;
  requestedAt: string | null;
  submittedAt: string | null;
}

export interface ReviewListResult {
  items: ReviewListItem[];
  stats: ReviewStats;
}

export async function listReviews(actor: Actor): Promise<ReviewListResult> {
  can(actor, "reviews", "view");
  const rows = await listReviewsByOrg(actor.orgId);
  const items: ReviewListItem[] = rows.map((r) => ({
    id: r.review.id,
    clientName: r.clientName,
    rating: r.review.rating,
    nps: r.review.nps,
    body: r.review.body,
    isPublic: r.review.is_public,
    requestedAt: r.review.requested_at,
    submittedAt: r.review.submitted_at,
  }));
  const ratings = items.map((i) => i.rating).filter((n): n is number => n != null);
  const npsScores = items.map((i) => i.nps).filter((n): n is number => n != null);
  return {
    items,
    stats: {
      count: items.filter((i) => i.submittedAt).length,
      avgRating: averageRating(ratings),
      nps: computeNps(npsScores),
    },
  };
}
