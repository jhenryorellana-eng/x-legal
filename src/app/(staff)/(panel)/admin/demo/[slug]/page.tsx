/**
 * Demo experience — /admin/demo/[slug] (admin-only).
 *
 * Server Component: guards the admin, resolves the real service label/icon/color
 * (fallback to the fixture), signs the demo-asset PDF URLs and mounts the
 * client-side walkthrough. Past this point the flow needs NO network: the
 * client pre-loads the PDFs as blobs on mount, and every interaction stays
 * pure UI (a slot without a PDF keeps the HTML simulation).
 */

import { redirect, notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import { getDemoAssetUrls } from "@/backend/modules/demo-assets";
import { staffHomePath } from "@/shared/staff-routes";
import { getDemoTool } from "@/shared/constants/demo-tools";
import type { IconName } from "@/frontend/components/brand";
import { DemoExperience } from "@/frontend/features/admin/demo/demo-experience";
import { DemoToolExperience } from "@/frontend/features/admin/demo/demo-tool-experience";
import { getScenario } from "@/frontend/features/admin/demo/scenarios";

export const dynamic = "force-dynamic";

export default async function DemoServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");
  if (actor.role && actor.role !== "admin") redirect(staffHomePath(actor.role));

  const { slug } = await params;
  const scenario = getScenario(slug);
  if (!scenario) {
    // Not a scenario — an external embedded tool? (returns before the catalog
    // and asset reads below: a tool page costs zero backend calls).
    const tool = getDemoTool(slug);
    if (!tool) notFound();
    const t = await getTranslations("staff.demo");
    return (
      <DemoToolExperience
        label={tool.label}
        url={tool.url}
        icon={tool.icon as IconName}
        colorKey={tool.colorKey}
        messages={{ eyebrow: t("title"), openExternal: t("toolOpenExternal") }}
      />
    );
  }

  const [locale, services, assetUrls] = await Promise.all([
    getLocale() as Promise<"es" | "en">,
    listServicesAdmin(actor).catch(() => []),
    // The live must never break: any failure just means simulation fallback.
    getDemoAssetUrls(actor, slug).catch(() => null),
  ]);
  const match = services.find((sv) => sv.slug === slug);
  const li = (match?.label_i18n ?? {}) as Record<string, string>;

  const service = {
    label: match ? li[locale] ?? li.es ?? scenario.service.label : scenario.service.label,
    icon: ((match?.icon as IconName) ?? scenario.service.icon) as IconName,
    colorKey: match?.color ?? scenario.service.color,
  };

  return <DemoExperience scenario={scenario} service={service} assetUrls={assetUrls} />;
}
