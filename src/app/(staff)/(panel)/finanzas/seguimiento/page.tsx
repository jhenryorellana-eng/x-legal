/**
 * Seguimiento / fidelización — `/finanzas/seguimiento` (Andrium / admin).
 *
 * RSC: guards (staff + retention:view), loads promotions/referrals/reviews via the
 * retention module-pub, maps to VMs, renders the client view with bound actions.
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { listPromotions, listReferrals, listReviews } from "@/backend/modules/retention";
import type { Locale } from "@/shared/i18n";
import {
  SeguimientoView,
  type SeguimientoVM,
} from "@/frontend/features/andrium/seguimiento/seguimiento-view";
import {
  createPromotionAction,
  setPromotionActiveAction,
  deletePromotionAction,
  markReferralRewardedAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SeguimientoPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try {
    can(actor, "retention", "view");
  } catch {
    redirect("/admin");
  }

  const locale = (await getLocale()) as Locale;
  const loc: "es" | "en" = locale === "es" ? "es" : "en";

  const [promotions, referrals, reviews] = await Promise.all([
    listPromotions(actor).catch(() => []),
    listReferrals(actor).catch(() => ({ items: [], stats: { total: 0, converted: 0, rewarded: 0 } })),
    listReviews(actor).catch(() => ({ items: [], stats: { count: 0, avgRating: 0, nps: 0 } })),
  ]);

  const vm: SeguimientoVM = {
    promotions: promotions.map((p) => ({
      id: p.id,
      code: p.code,
      description: p.description,
      kind: p.kind,
      value: p.value,
      currency: p.currency,
      validUntil: p.validUntil,
      maxUses: p.maxUses,
      usedCount: p.usedCount,
      isActive: p.isActive,
    })),
    referrals: {
      items: referrals.items.map((r) => ({
        id: r.id,
        code: r.code,
        referrerName: r.referrerName,
        status: r.status,
        convertedAt: r.convertedAt,
        rewardedAt: r.rewardedAt,
        createdAt: r.createdAt,
      })),
      stats: referrals.stats,
    },
    reviews: {
      items: reviews.items.map((r) => ({
        id: r.id,
        clientName: r.clientName,
        rating: r.rating,
        nps: r.nps,
        body: r.body,
        submittedAt: r.submittedAt,
        requestedAt: r.requestedAt,
      })),
      stats: reviews.stats,
    },
    locale: loc,
  };

  return (
    <SeguimientoView
      vm={vm}
      actions={{
        createPromotion: createPromotionAction,
        setPromotionActive: setPromotionActiveAction,
        deletePromotion: deletePromotionAction,
        markReferralRewarded: markReferralRewardedAction,
      }}
    />
  );
}
