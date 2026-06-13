/**
 * Detalle de servicio — `/servicios/[slug]` · nivel CUENTA — DOC-51 §7.
 *
 * Server component. Reads the service detail (catalog module): name + short
 * description + `long_description_i18n` ("¿Qué es?") + `benefits_i18n`. Prices are
 * NEVER shown (RF-CLI-069 CA2). The "Me interesa" CTA is feature-flagged with
 * `NEXT_PUBLIC_FEATURE_INTERES` (nota H-7 / PS-3 — lead action arrives in F3).
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getServiceDetailBySlug } from "@/backend/modules/catalog";
import { pickLocale, coerceIcon, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { ServiceDetailScreen } from "@/frontend/features/cliente/servicios/service-detail-screen";

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.servicioDetalle");

  interface ServiceDetailRow {
    label_i18n: unknown;
    description_i18n: unknown;
    long_description_i18n: unknown;
    benefits_i18n: unknown;
    icon: string;
    color: string;
    is_public?: boolean;
    is_active?: boolean;
  }
  let service: ServiceDetailRow | null = null;
  try {
    service = (await getServiceDetailBySlug(actor.orgId, slug)) as unknown as ServiceDetailRow;
  } catch {
    service = null;
  }
  // Only public+active services are reachable from the catalog.
  if (!service || service.is_public === false || service.is_active === false) {
    notFound();
  }

  const toI18n = (v: unknown) =>
    v && typeof v === "object"
      ? { es: (v as { es?: string }).es ?? "", en: (v as { en?: string }).en ?? "" }
      : null;

  const name = pickLocale(toI18n(service.label_i18n), locale);
  const shortDescription = pickLocale(toI18n(service.description_i18n), locale);
  // "¿Qué es?": real long description, falling back to the normative prototype copy.
  const longDescription =
    pickLocale(toI18n(service.long_description_i18n), locale) || t("whatIsFallback");

  // Benefits: real list when present, else the prototype's three normative rows.
  const benefitsRaw = service.benefits_i18n;
  let benefits: string[] = [];
  if (Array.isArray(benefitsRaw)) {
    benefits = (benefitsRaw as unknown[])
      .map((b) => pickLocale(toI18n(b), locale))
      .filter(Boolean);
  }
  if (benefits.length === 0) {
    benefits = [t("benefit1"), t("benefit2"), t("benefit3")];
  }

  const interestEnabled = process.env.NEXT_PUBLIC_FEATURE_INTERES === "true";

  return (
    <ServiceDetailScreen
      name={name}
      shortDescription={shortDescription ? `${shortDescription}.` : ""}
      longDescription={longDescription}
      benefits={benefits}
      icon={coerceIcon(service.icon, "shield")}
      color={service.color || "var(--accent)"}
      interestEnabled={interestEnabled}
      labels={{
        eyebrow: t("eyebrow"),
        whatIs: t("whatIs"),
        howWeHelp: t("howWeHelp"),
        costsNote: t("costsNote"),
        interested: t("interested"),
        interestedSoon: t("interestedSoon"),
        askByMessage: t("askByMessage"),
      }}
    />
  );
}
