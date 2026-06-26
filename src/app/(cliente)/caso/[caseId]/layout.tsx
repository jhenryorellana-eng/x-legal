/**
 * Case shell layout — /caso/[caseId]/… (DOC-51 §0.1, NIVEL CASO).
 *
 * Server-side guard + case-level chrome (CaseNav variant "caso" + "Tu equipo"
 * launcher). Each screen renders its own header (the prototype uses a per-screen
 * back-link such as "← Mis casos" / "← Más"), so the shell does NOT render a
 * persistent case-number chip.
 *
 * GUARD — defense in depth. The middleware gates /caso/* to authenticated clients;
 * here we additionally enforce per-case membership via `getCaseWorkspace`, which
 * runs `requireCaseAccess` + RLS (`is_case_member`). A non-member or unknown case
 * → notFound() (anti-enumeration: same as "not yours"). NO_CHROME screens
 * (disclaimer / subir / exito) opt out of the bottom nav individually (see below).
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseWorkspace } from "@/backend/modules/cases";
import { getTermsStatusForCase } from "@/backend/modules/contracts";
import { CaseChrome } from "./case-chrome";

export default async function CaseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();

  if (!actor || actor.kind !== "client") {
    redirect("/welcome");
  }

  // Membership enforcement (RLS is_case_member). Unknown/foreign case → 404.
  let ws;
  try {
    ws = await getCaseWorkspace(actor, caseId);
  } catch {
    notFound();
  }

  // Onboarding gate: a client may sign in before activating, but the case
  // workspace stays locked until the downpayment is confirmed (cases.opened_at is
  // set → status leaves payment_pending). Send them to /home, where the onboarding
  // step card guides them to sign the contract and then pay the first installment.
  if (ws.status === "payment_pending") {
    redirect("/home");
  }

  // T&C gate (DOC-51 §12): the case is locked until the client accepts the org's
  // active terms (signed disclaimer on first entry). Exempt the disclaimer route
  // itself (the gate target) to avoid a redirect loop. The pathname is forwarded
  // by middleware as `x-pathname`. Degrade open if the terms read fails.
  const pathname = (await headers()).get("x-pathname") ?? "";
  let mustAcceptTerms = false;
  if (!pathname.endsWith("/disclaimer")) {
    try {
      const terms = await getTermsStatusForCase(actor, caseId);
      mustAcceptTerms = !!terms.terms && !terms.alreadyAccepted;
    } catch {
      // Never hard-block the case on a terms read error (gate stays open).
    }
  }
  // redirect() throws NEXT_REDIRECT — keep it OUTSIDE the try/catch above.
  if (mustAcceptTerms) redirect(`/caso/${caseId}/disclaimer`);

  const tNav = await getTranslations("cliente.nav");
  const tTeam = await getTranslations("cliente.team");

  const navLabels = {
    inicio: tNav("inicio"),
    citas: tNav("citas"),
    documentos: tNav("documentos"),
    formularios: tNav("formularios"),
    mas: tNav("mas"),
    navCase: tNav("ariaCase"),
    navAccount: tNav("ariaAccount"),
  };

  return (
    <div style={{ minHeight: "100dvh", position: "relative" }}>
      {children}

      <CaseChrome
        caseId={caseId}
        navLabels={navLabels}
        teamLabel={tTeam("launcher")}
      />
    </div>
  );
}
