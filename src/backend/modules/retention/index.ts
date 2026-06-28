/**
 * Retention module — public API (module-pub boundary).
 *
 * Lifecycle "después" / fidelización: promotions, referrals, reviews.
 * Other modules / the app import ONLY from here.
 *
 * @module retention
 */

export {
  // Promotions
  createPromotion,
  listPromotions,
  setPromotionActive,
  deletePromotion,
  redeemPromotion,
  // Referrals
  ensureReferralCode,
  listReferrals,
  recordReferral,
  markReferralRewarded,
  // Reviews
  requestReview,
  requestReviewSystem,
  submitReview,
  listReviews,
  RetentionError,
} from "./service";

export type {
  CreatePromotionInput,
  RedeemPromotionInput,
  ReferralListItem,
  ReferralListResult,
  SubmitReviewInput,
  ReviewListItem,
  ReviewListResult,
} from "./service";

export type {
  PromotionView,
  PromotionKind,
  ReferralStatus,
  ReviewStats,
} from "./domain";

export {
  promotionBlockReason,
  computeDiscountCents,
  referralCodeFor,
  computeNps,
  averageRating,
} from "./domain";
