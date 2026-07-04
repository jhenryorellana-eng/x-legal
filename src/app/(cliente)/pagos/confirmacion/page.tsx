/**
 * Stripe payment confirmation — `/pagos/confirmacion`
 *
 * Landing page after Stripe redirects back with `?session_id=…`.
 *
 * L2 of the card-confirmation stack (DOC-71 §3.5): instead of blindly waiting
 * for the webhook, this page asks the SERVER to reconcile the session against
 * Stripe (`reconcileCheckoutSession` → `stripe.checkout.sessions.retrieve`). The
 * server independently verifies `payment_status === 'paid'` (DOC-51 §8 — never
 * trusts the client) and settles the payment immediately. The view polls the
 * action until it reports `settled`, then routes to `/pagos`.
 *
 * Result: card confirmation is immediate for the user even when the webhook is
 * delayed/retrying/unconfigured — confirmation no longer hinges on one callback.
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { getActor, requireActor } from "@/backend/modules/identity";
import {
  reconcileCheckoutSession,
  reconcileSetupSession,
  BillingError,
} from "@/backend/modules/billing";
import { ConfirmacionView } from "@/frontend/features/cliente/pagos/confirmacion-view";
import { getTranslations } from "next-intl/server";

/** Server-side reconcile of a Stripe Checkout Session (authoritative). */
async function reconcileSessionAction(
  sessionId: string,
): Promise<
  | { ok: true; settled: boolean; installmentStatus: string }
  | { ok: false; error: string }
> {
  "use server";
  try {
    const actor = await requireActor();
    const r = await reconcileCheckoutSession(actor, sessionId);
    return { ok: true, settled: r.settled, installmentStatus: r.installmentStatus };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof BillingError ? err.code : "RECONCILE_FAILED",
    };
  }
}

/**
 * Server-side reconcile of a mode=setup session (autopay enrollment, DOC-71
 * §2.4). Adapted to the same result shape so ConfirmacionView is reused as-is:
 * `settled` = the card was saved and autopay is now enabled on the plan.
 */
async function reconcileSetupSessionAction(
  sessionId: string,
): Promise<
  | { ok: true; settled: boolean; installmentStatus: string }
  | { ok: false; error: string }
> {
  "use server";
  try {
    const actor = await requireActor();
    const r = await reconcileSetupSession(actor, sessionId);
    return { ok: true, settled: r.enrolled, installmentStatus: "" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof BillingError ? err.code : "RECONCILE_FAILED",
    };
  }
}

export default async function PagosConfirmacionPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; setup_session_id?: string }>;
}) {
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const params = await searchParams;
  const setupSessionId = params?.setup_session_id ?? null;
  const sessionId = params?.session_id ?? null;
  const t = await getTranslations("cliente.pagos");

  // Autopay enrollment return (mode=setup) — no money involved.
  if (setupSessionId) {
    return (
      <ConfirmacionView
        sessionId={setupSessionId}
        redirectTo="/pagos"
        onReconcile={reconcileSetupSessionAction}
        labels={{
          title: t("setupConfirmingTitle"),
          body: t("setupConfirmingBody"),
          confirmedTitle: t("setupConfirmedTitle"),
          confirmedBody: t("setupConfirmedBody"),
        }}
      />
    );
  }

  return (
    <ConfirmacionView
      sessionId={sessionId}
      redirectTo="/pagos"
      onReconcile={reconcileSessionAction}
      labels={{
        title: t("confirmingTitle"),
        body: t("confirmingBody"),
        confirmedTitle: t("confirmedTitle"),
        confirmedBody: t("confirmedBody"),
      }}
    />
  );
}
