/**
 * Campañas — /finanzas/campanas list (DOC-55 §4.1, RF-AND-034).
 *
 * Server Component: guards (staff + campaigns:view), lists campaigns, renders view.
 * Boundary: app → module-pub only. Uses console.error (logger not importable from app).
 */

import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { listCampaigns } from "@/backend/modules/campaigns";
import type { Locale } from "@/shared/i18n";
import {
  CampanasListView,
  type CampanasListVM,
  type CampaignSummaryVM,
} from "@/frontend/features/andrium/campanas/campanas-list-view";
import { createCampaignAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampanasPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  try {
    can(actor, "campaigns", "view");
  } catch {
    redirect("/admin");
  }

  const locale = (await getLocale()) as Locale;

  let items: CampaignSummaryVM[] = [];
  let nextCursor: string | null = null;
  try {
    const res = await listCampaigns(actor, { limit: 50 });
    items = res.items.map((c) => ({
      id: c.id,
      name: c.name,
      subject: c.subject,
      status: c.status,
      audienceKind: c.audienceKind,
      scheduledAt: c.scheduledAt,
      sentCount: c.sentCount,
      createdAt: c.createdAt,
    }));
    nextCursor = res.nextCursor;
  } catch (err) {
    console.error("[/finanzas/campanas] load failed:", err);
  }

  const vm: CampanasListVM = { items, nextCursor, locale: locale === "es" ? "es" : "en" };

  return <CampanasListView vm={vm} actions={{ create: createCampaignAction }} />;
}
