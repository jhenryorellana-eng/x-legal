/**
 * Dev-only admin preview harness — /admin-preview/[view].
 *
 * The admin panel is auth-gated (a staff session with the claims hook). To
 * capture Playwright evidence of the F1 admin screens WITHOUT a live session,
 * this route renders each view with mock data + no-op actions. It 404s in
 * production (NODE_ENV === "production") so it never ships to users, and it is
 * marked public in the middleware only for the dev/preview path.
 *
 * Valid views: empleados · catalogo · nuevo-servicio · auditoria · configuracion.
 */

import { notFound } from "next/navigation";
import { PreviewClient } from "./preview-client";

const VIEWS = [
  "empleados",
  "catalogo",
  "nuevo-servicio",
  "auditoria",
  "configuracion",
  "casos",
  "caso-detalle",
  "firma",
];

export default async function AdminPreviewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  // Guard 1: never ship to production build.
  // Guard 2: must explicitly opt-in via ENABLE_ADMIN_PREVIEW=true (set in .env.local / dev compose only).
  // See .env.example for documentation.
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_ADMIN_PREVIEW !== "true"
  ) {
    notFound();
  }
  const { view } = await params;
  if (!VIEWS.includes(view)) notFound();
  return <PreviewClient view={view} />;
}
