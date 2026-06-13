/**
 * Métricas — sales performance · /ventas/metricas (DOC-52 §6).
 *
 * Server Component: guards the actor, resolves the period from searchParams and
 * renders the metrics view. F3 note: the §6.2 aggregate formulas are computed in
 * the module index reads; while those reads land, the page renders the structure
 * with the values available (em-dash where a read is pending). The dev preview
 * shows the fully-populated view for Playwright.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { MetricasView, LexPrefsProvider } from "@/frontend/features/vanessa";
import { MetricasClient } from "./client";

export const dynamic = "force-dynamic";

export default async function VentasMetricasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const sp = await searchParams;
  const period = (sp.period === "month" || sp.period === "custom" ? sp.period : "week") as
    | "week"
    | "month"
    | "custom";
  const t = await getTranslations("staff.ventas.metricas");

  const strings = {
    title: t("title"),
    sub: t("sub"),
    thisWeek: t("thisWeek"),
    month: t("month"),
    custom: t("custom"),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>`, conv: "—" }),
    funnelTitle: t("funnelTitle"),
    activityTitle: t("activityTitle"),
    clientsTitle: t("clientsTitle"),
    sourcesTitle: t("sourcesTitle"),
    lexEnabled: true,
  };

  // Empty-but-valid structure until the aggregate reads are wired (DOC-50 §5 —
  // never a false zero where a number is unknown; funnel rendered at 0%).
  const empty = { kpis: [], funnel: [], weekBars: [], donuts: [], sources: [], secondary: [] };

  return (
    <LexPrefsProvider>
      <MetricasClient period={period}>
        <MetricasView
          kpis={empty.kpis}
          funnel={empty.funnel}
          weekBars={empty.weekBars}
          donuts={empty.donuts}
          sources={empty.sources}
          secondary={empty.secondary}
          period={period}
          strings={strings}
          onPeriodChange={() => {}}
        />
      </MetricasClient>
    </LexPrefsProvider>
  );
}
