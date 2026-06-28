/**
 * Retention module — pure domain (promotions, referrals, reviews).
 *
 * Lifecycle "después" / fidelización (DOC-13 §F retención). NO I/O — deterministic
 * helpers for discounts, referral codes, and NPS. Tested with zero mocks.
 *
 * @module retention/domain
 */

// ---------------------------------------------------------------------------
// Promotions
// ---------------------------------------------------------------------------

export type PromotionKind = "percent" | "amount";

export interface PromotionView {
  id: string;
  code: string;
  description: string | null;
  kind: PromotionKind;
  value: number; // percent: 1..100 ; amount: cents
  currency: string;
  validFrom: string | null;
  validUntil: string | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  serviceScope: string[] | null; // null = all services
}

export type PromotionBlockReason =
  | "inactive"
  | "not_started"
  | "expired"
  | "exhausted"
  | "service_excluded"
  | null;

/** Returns why a promotion cannot be redeemed now (null = redeemable). Pure. */
export function promotionBlockReason(
  p: Pick<PromotionView, "isActive" | "validFrom" | "validUntil" | "maxUses" | "usedCount" | "serviceScope">,
  nowIso: string,
  serviceId?: string | null,
): PromotionBlockReason {
  if (!p.isActive) return "inactive";
  if (p.validFrom && nowIso < p.validFrom) return "not_started";
  if (p.validUntil && nowIso > p.validUntil) return "expired";
  if (p.maxUses != null && p.usedCount >= p.maxUses) return "exhausted";
  if (p.serviceScope && p.serviceScope.length > 0 && serviceId && !p.serviceScope.includes(serviceId)) {
    return "service_excluded";
  }
  return null;
}

/** Discount in cents for a base amount. percent → proportional; amount → capped at the base. Pure. */
export function computeDiscountCents(
  kind: PromotionKind,
  value: number,
  baseAmountCents: number,
): number {
  if (baseAmountCents <= 0) return 0;
  if (kind === "percent") {
    const pct = Math.max(0, Math.min(100, value));
    return Math.round((baseAmountCents * pct) / 100);
  }
  return Math.min(Math.max(0, value), baseAmountCents);
}

/** Normalises a coupon code: uppercase, trimmed, alnum + dashes only. */
export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

// ---------------------------------------------------------------------------
// Referrals
// ---------------------------------------------------------------------------

export type ReferralStatus = "pending" | "converted" | "rewarded" | "void";

/**
 * Deterministic short referral code from a user id (no I/O, no randomness —
 * stable per user, collision-safe enough for a single org via the unique index).
 * 8 chars from a base32-ish alphabet (no ambiguous 0/O/1/I/L).
 */
export function referralCodeFor(userId: string): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash + userId.charCodeAt(i)) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + (i + 1) * 2654435761;
    hash = hash >>> 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

export interface ReviewStats {
  count: number;
  avgRating: number; // 0 when no ratings
  nps: number; // -100..100, 0 when no scores
}

/** Net Promoter Score from 0..10 scores: %promoters(9-10) − %detractors(0-6). Pure. */
export function computeNps(scores: number[]): number {
  if (scores.length === 0) return 0;
  let promoters = 0;
  let detractors = 0;
  for (const s of scores) {
    if (s >= 9) promoters++;
    else if (s <= 6) detractors++;
  }
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

export function averageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
}
