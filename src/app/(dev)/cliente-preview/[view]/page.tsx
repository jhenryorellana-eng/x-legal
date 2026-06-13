/**
 * Dev-only cliente preview harness — /cliente-preview/[view].
 *
 * The (cliente) screens are auth-gated (a client session). To capture Playwright
 * evidence WITHOUT a live session, this route renders each screen with mock props
 * + no-op actions inside the mobile frame. It 404s in production so it never
 * ships, and is marked public in the middleware only for /cliente-preview.
 *
 * Valid views: home · camino · documentos · disclaimer · proceso · agendar ·
 * cita · cita-completada · agendar-bloqueado · agendar-vacio.
 */

import { notFound } from "next/navigation";
import { ClientePreview } from "./preview-client";

const VIEWS = [
  "home",
  "camino",
  "documentos",
  "disclaimer",
  "proceso",
  "agendar",
  "cita",
  "cita-completada",
  "agendar-bloqueado",
  "agendar-vacio",
];

export default async function ClientePreviewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view } = await params;
  if (!VIEWS.includes(view)) notFound();
  return <ClientePreview view={view} />;
}
