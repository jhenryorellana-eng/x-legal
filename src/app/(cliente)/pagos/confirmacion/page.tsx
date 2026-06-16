/**
 * Stripe payment confirmation — `/pagos/confirmacion`
 *
 * Landing page after Stripe redirects back with `?session_id=…`.
 * Shows a "Confirmando tu pago…" state and polls the payment status
 * via API-BIL-03 until confirmed, then redirects to `/pagos`.
 *
 * DOC-51 §8: "La confirmación SOLO llega por webhook WH-01 (nunca confianza
 * en el cliente)." — We poll but rely on the webhook to finalize server-side.
 *
 * TODO BIL-CONF-1: Replace the client poll with a Realtime subscription to
 * `installments` table (status change to 'paid') once Supabase Realtime is
 * wired for the client surface (DOC-20 §7).
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { ConfirmacionView } from "@/frontend/features/cliente/pagos/confirmacion-view";
import { getTranslations } from "next-intl/server";

export default async function PagosConfirmacionPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const t = await getTranslations("cliente.pagos");

  return (
    <ConfirmacionView
      redirectTo="/pagos"
      labels={{
        title: t("confirmingTitle"),
        body: t("confirmingBody"),
      }}
    />
  );
}
