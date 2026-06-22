/**
 * Detalle de servicio — `/servicios/[slug]` · nivel CUENTA — DOC-51 §7.
 *
 * Server component. Reads the service detail (catalog module): name + short
 * description + `long_description_i18n` ("¿Qué es?") + its PLANS (self /
 * with-lawyer prices) + its PHASES (process stages, with the client explainer)
 * + the cronograma's estimated total weeks (duration). The submit CTA is a
 * pre-filled WhatsApp message to the sales line.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getServiceDetailBySlug, getServiceCronograma } from "@/backend/modules/catalog";
import { pickLocale, coerceIcon, coerceColor, type Locale } from "@/frontend/features/cliente/shared/i18n";
import {
  ServiceDetailScreen,
  type ServiceDetailPlanVM,
  type ServiceDetailPhaseVM,
} from "@/frontend/features/cliente/servicios/service-detail-screen";

/** Sales line for the "comunícate" CTA — pre-filled WhatsApp message.
 *  +1 (402) 824-8171 → digits only for the wa.me link. */
const SALES_WHATSAPP = "14028248171";

const PLAN_ORDER: Record<string, number> = { self: 0, with_lawyer: 1 };

function formatPrice(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

interface PlanRow {
  kind: "self" | "with_lawyer";
  price_cents: number | null;
  currency: string | null;
  is_active: boolean | null;
}
interface PhaseRow {
  label_i18n: unknown;
  description_i18n: unknown;
  client_explainer_i18n: unknown;
  position: number | null;
}
interface ServiceDetailRow {
  id: string;
  label_i18n: unknown;
  description_i18n: unknown;
  long_description_i18n: unknown;
  icon: string;
  color: string;
  is_public?: boolean;
  is_active?: boolean;
  service_plans?: PlanRow[];
  service_phases?: PhaseRow[];
}

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
  const longDescription =
    pickLocale(toI18n(service.long_description_i18n), locale) || t("whatIsFallback");

  // Plans → priced options (self first, then with-lawyer). With-lawyer is the
  // emphasized "upgrade" tile.
  const plans: ServiceDetailPlanVM[] = (service.service_plans ?? [])
    .filter((p) => p.is_active !== false && (p.kind === "self" || p.kind === "with_lawyer"))
    .sort((a, b) => (PLAN_ORDER[a.kind] ?? 9) - (PLAN_ORDER[b.kind] ?? 9))
    .map((p) => ({
      kind: p.kind,
      title: p.kind === "with_lawyer" ? t("planWithLawyer") : t("planSelf"),
      priceLabel: p.price_cents ? formatPrice(p.price_cents, p.currency ?? "USD") : null,
      note: p.kind === "with_lawyer" ? t("planWithLawyerNote") : t("planSelfNote"),
      emphasized: p.kind === "with_lawyer",
    }));

  // Phases → process stages (the client explainer is the "what it consists of").
  const phases: ServiceDetailPhaseVM[] = (service.service_phases ?? [])
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((ph) => ({
      label: pickLocale(toI18n(ph.label_i18n), locale),
      explainer:
        pickLocale(toI18n(ph.client_explainer_i18n), locale) ||
        pickLocale(toI18n(ph.description_i18n), locale) ||
        "",
    }))
    .filter((ph) => ph.label);

  // Estimated duration from the cronograma (degrades to "varies by case").
  let totalWeeks = 0;
  try {
    totalWeeks = (await getServiceCronograma(service.id)).totalWeeks;
  } catch {
    totalWeeks = 0;
  }
  const durationLabel = totalWeeks > 0 ? t("durationWeeks", { weeks: totalWeeks }) : t("durationVaries");

  // Pre-filled WhatsApp message to the sales line.
  const waMessage = t("whatsappMessage", { service: name });
  const whatsappUrl = `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(waMessage)}`;

  return (
    <ServiceDetailScreen
      name={name}
      shortDescription={shortDescription ? `${shortDescription}.` : ""}
      longDescription={longDescription}
      icon={coerceIcon(service.icon, "shield")}
      color={coerceColor(service.color)}
      plans={plans}
      phases={phases}
      durationLabel={durationLabel}
      whatsappUrl={whatsappUrl}
      labels={{
        eyebrow: t("eyebrow"),
        whatIs: t("whatIs"),
        pricingTitle: t("pricingTitle"),
        priceOneTime: t("priceOneTime"),
        priceSoon: t("priceSoon"),
        howTitle: t("howTitle"),
        howIntro: t("howIntro"),
        how: [t("how1"), t("how2"), t("how3")],
        stagesTitle: t("stagesTitle"),
        durationTitle: t("durationTitle"),
        whatsappCta: t("whatsappCta"),
        askByMessage: t("askByMessage"),
      }}
    />
  );
}
