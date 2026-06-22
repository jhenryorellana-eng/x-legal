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
import { pickLocale, coerceIcon, coerceColor, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  ServicesScreen,
  type ServiceCard,
} from "@/frontend/features/cliente/servicios/services-screen";

interface CatalogPlan {
  price_cents: number | null;
  currency: string | null;
  is_active: boolean | null;
}

function formatPrice(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** Lowest active plan price → the ecommerce "from" price. */
function fromPriceLabel(plans: CatalogPlan[] | undefined): string | null {
  const priced = (plans ?? []).filter(
    (p) => p.is_active !== false && typeof p.price_cents === "number" && p.price_cents > 0,
  );
  if (priced.length === 0) return null;
  const min = priced.reduce((a, b) => (a.price_cents! <= b.price_cents! ? a : b));
  return formatPrice(min.price_cents!, min.currency ?? "USD");
}

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
    service_plans?: CatalogPlan[];
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
    color: coerceColor(s.color),
    owned: ownedServiceIds.has(s.id),
    priceLabel: fromPriceLabel(s.service_plans),
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
        priceFrom: t("priceFrom"),
      }}
    />
  );
}
