/**
 * Demo experience — /admin/demo/[slug] (admin-only).
 *
 * Server Component: guards the admin, resolves the real service label/icon/color
 * (fallback to the fixture) and mounts the client-side walkthrough. All
 * interaction past this point is pure UI — no backend, no writes.
 */

import { redirect, notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listServicesAdmin } from "@/backend/modules/catalog";
import { staffHomePath } from "@/shared/staff-routes";
import type { IconName } from "@/frontend/components/brand";
import { DemoExperience } from "@/frontend/features/admin/demo/demo-experience";
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
  if (!scenario) notFound();

  const [locale, services] = await Promise.all([
    getLocale() as Promise<"es" | "en">,
    listServicesAdmin(actor).catch(() => []),
  ]);
  const match = services.find((sv) => sv.slug === slug);
  const li = (match?.label_i18n ?? {}) as Record<string, string>;

  const service = {
    label: match ? li[locale] ?? li.es ?? scenario.service.label : scenario.service.label,
    icon: ((match?.icon as IconName) ?? scenario.service.icon) as IconName,
    colorKey: match?.color ?? scenario.service.color,
  };

  return <DemoExperience scenario={scenario} service={service} />;
}
