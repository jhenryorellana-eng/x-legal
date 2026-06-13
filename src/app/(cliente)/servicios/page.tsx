/**
 * Servicios — `/servicios` · nivel CUENTA (pestaña "Servicios") — DOC-51 §6.
 *
 * Server component. Reads the public catalog (catalog module: only is_active AND
 * is_public, ordered by position) and the client's cases (to mark "Ya lo tienes").
 * Hands a serializable list to the client `ServicesScreen` (live search).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getPublicCatalog } from "@/backend/modules/catalog";
import { getCasesForClient } from "@/backend/modules/cases";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  ServicesScreen,
  type ServiceCard,
} from "@/frontend/features/cliente/servicios/services-screen";

export default async function ServiciosPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.servicios");

  const services = (await getPublicCatalog(actor.orgId)) as Array<{
    id: string;
    slug: string;
    label_i18n: unknown;
    description_i18n: unknown;
    icon: string;
    color: string;
  }>;

  // Which services the client already has a case for (RLS-scoped list).
  const casesPage = await getCasesForClient(actor, { limit: 50 });
  const ownedServiceIds = new Set(casesPage.items.map((c) => c.service_id));

  const toI18n = (v: unknown) =>
    v && typeof v === "object"
      ? (v as { es?: string; en?: string })
      : { es: "", en: "" };

  const cards: ServiceCard[] = services.map((s) => ({
    slug: s.slug,
    name: pickLocale({ es: toI18n(s.label_i18n).es ?? "", en: toI18n(s.label_i18n).en ?? "" }, locale),
    description: pickLocale(
      { es: toI18n(s.description_i18n).es ?? "", en: toI18n(s.description_i18n).en ?? "" },
      locale,
    ),
    icon: coerceIcon(s.icon, "shield"),
    color: s.color || "var(--accent)",
    owned: ownedServiceIds.has(s.id),
  }));

  return (
    <ServicesScreen
      services={cards}
      labels={{
        title: t("title"),
        subtitle: t("subtitle"),
        searchPlaceholder: t("searchPlaceholder"),
        owned: t("owned"),
        emptyTitle: t("empty"),
      }}
    />
  );
}
