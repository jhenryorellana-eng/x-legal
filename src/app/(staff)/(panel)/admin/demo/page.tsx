/**
 * Demo index — /admin/demo (admin-only marketing demo).
 *
 * Server Component: guards the admin, reads the catalog ONLY to tint each card
 * with the real service icon/color/label (falls back to the scenario fixture if
 * the read fails or the slug has no catalog match — the live must never break).
 * One card per authored scenario; clicking opens the pure-UI walkthrough.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import {
  confirmDemoAssetUploadAction,
  deleteDemoAssetAction,
  listDemoAssetStatusAction,
  startDemoAssetUploadAction,
} from "@/backend/modules/demo-assets/actions";
import { staffHomePath } from "@/shared/staff-routes";
import { listDemoTools } from "@/shared/constants/demo-tools";
import type { IconName } from "@/frontend/components/brand";
import { DemoIndex, type DemoCardVM } from "@/frontend/features/admin/demo/demo-index";
import { listScenarios } from "@/frontend/features/admin/demo/scenarios";

export const dynamic = "force-dynamic";

export default async function DemoIndexPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  if (actor.role && actor.role !== "admin") redirect(staffHomePath(actor.role));

  const [locale, t, services] = await Promise.all([
    getLocale() as Promise<"es" | "en">,
    getTranslations("staff.demo"),
    listServicesAdmin(actor).catch(() => []),
  ]);

  const cards: DemoCardVM[] = listScenarios().map((s) => {
    const match = services.find((sv) => sv.slug === s.slug);
    const li = (match?.label_i18n ?? {}) as Record<string, string>;
    return {
      slug: s.slug,
      label: match ? li[locale] ?? li.es ?? s.service.label : s.service.label,
      icon: ((match?.icon as IconName) ?? s.service.icon) as IconName,
      colorKey: match?.color ?? s.service.color,
    };
  });

  // External embedded tools (shared registry) render as regular cards after
  // the scenarios, with their own CTA.
  const toolCards: DemoCardVM[] = listDemoTools().map((tool) => ({
    slug: tool.slug,
    label: tool.label,
    icon: tool.icon as IconName,
    colorKey: tool.colorKey,
    cta: t("toolCardCta"),
  }));

  return (
    <DemoIndex
      cards={[...cards, ...toolCards]}
      messages={{
        title: t("title"),
        subtitle: t("subtitle"),
        cardCta: t("cardCta"),
      }}
      assetActions={{
        listStatus: listDemoAssetStatusAction,
        startUpload: startDemoAssetUploadAction,
        confirmUpload: confirmDemoAssetUploadAction,
        deleteAsset: deleteDemoAssetAction,
      }}
    />
  );
}
