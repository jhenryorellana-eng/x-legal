/**
 * Dev-only Vanessa preview harness — /ventas-preview/[view].
 *
 * The sales panel is auth-gated (staff session). To capture Playwright evidence
 * of the 8 Vanessa views WITHOUT a live session, this route renders each view
 * with mock data + no-op actions. It 404s in production and requires the
 * ENABLE_VENTAS_PREVIEW opt-in (dev only). Mirrors the F1/F2 preview harnesses.
 *
 * Valid views: mi-dia · leads · citas · disponibilidad · clientes · metricas ·
 * configuracion.
 */

import { notFound } from "next/navigation";
import { MaterialSymbolsFont } from "@/frontend/features/vanessa";
import { VentasPreviewClient } from "../preview-client";

const VIEWS = [
  "mi-dia",
  "leads",
  "citas",
  "disponibilidad",
  "clientes",
  "metricas",
  "configuracion",
] as const;

type ViewName = (typeof VIEWS)[number];

export default async function VentasPreviewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_VENTAS_PREVIEW !== "true"
  ) {
    notFound();
  }
  const { view } = await params;
  if (!VIEWS.includes(view as ViewName)) notFound();
  return (
    <>
      <MaterialSymbolsFont />
      <VentasPreviewClient view={view as ViewName} />
    </>
  );
}
