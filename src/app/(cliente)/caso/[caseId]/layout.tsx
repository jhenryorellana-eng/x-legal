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

import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCaseWorkspace } from "@/backend/modules/cases";
import { getClientEvaluationSummary } from "@/backend/modules/evaluations";
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

  // T&C gate (DOC-51 §12) deliberately does NOT live here. Gating by redirect()
  // from this SHARED layout toward `/caso/{id}/disclaimer` — a route that
  // re-renders under this very layout — blanks the screen on soft navigation
  // (App Router aborts the throwing layout subtree, then commits an empty leaf;
  // a full reload masks it). The gate now lives where the redirect is reliable:
  //   • `home/page.tsx` resolves each card's href to /disclaimer or /camino, so
  //     the normal flow never redirects from a layout, and
  //   • `caso/[caseId]/page.tsx` (the bare-/caso/{id} entry) redirects from a
  //     LEAF page (defense in depth for deep links).
  // Do NOT reintroduce a terms redirect in this layout — it will bring the blank
  // back. Data is RLS-gated regardless (terms is a legal/flow gate, not access).

  // External evaluation tool (config-as-data, never by slug): when the case's
  // service has one, the whole case workspace drops to a minimal chrome (Inicio ·
  // Más only). Cheap read (never creates the session); fail-safe to normal mode.
  const evalSummary = await getClientEvaluationSummary(actor, caseId).catch(() => null);
  const minimalMode = evalSummary !== null;

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
        minimalMode={minimalMode}
      />
    </div>
  );
}
