"use server";

/**
 * Seguimiento / fidelización — server actions (Andrium / admin surface).
 *
 * Thin wrappers over the retention module-pub (promotions, referrals, reviews).
 * Returns `{ ok, data?, error: { code } }`.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  createPromotion,
  setPromotionActive,
  deletePromotion,
  markReferralRewarded,
  requestReview,
  RetentionError,
  type CreatePromotionInput,
} from "@/backend/modules/retention";

export interface RetentionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

function fail(err: unknown): RetentionResult<never> {
  if (err instanceof RetentionError) return { ok: false, error: { code: err.code } };
  if (err instanceof Error && err.name === "AuthzError") return { ok: false, error: { code: "FORBIDDEN" } };
  return { ok: false, error: { code: "UNEXPECTED" } };
}

export async function createPromotionAction(input: CreatePromotionInput): Promise<RetentionResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const view = await createPromotion(actor, input);
    return { ok: true, data: { id: view.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function setPromotionActiveAction(id: string, isActive: boolean): Promise<RetentionResult> {
  try {
    const actor = await requireActor();
    await setPromotionActive(actor, id, isActive);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deletePromotionAction(id: string): Promise<RetentionResult> {
  try {
    const actor = await requireActor();
    await deletePromotion(actor, id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function markReferralRewardedAction(referralId: string): Promise<RetentionResult> {
  try {
    const actor = await requireActor();
    await markReferralRewarded(actor, referralId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function requestReviewAction(input: { userId: string; caseId: string }): Promise<RetentionResult> {
  try {
    const actor = await requireActor();
    await requestReview(actor, input);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
