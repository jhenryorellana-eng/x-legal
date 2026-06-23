/**
 * Cliente surface layout — mobile shell + account-level chrome.
 *
 * The (cliente) route group spans three contexts (DOC-51 §0.1):
 *   - ACCESO  (welcome/phone/otp/no-access) — NO chrome
 *   - CUENTA  (home/servicios/comunidad/avisos/pagos/config) — AccountNav + launcher
 *   - CASO    (/caso/[caseId]/…) — its own CaseNav (rendered by the case layout)
 *
 * Auth routing is handled by the middleware. The CUENTA chrome is rendered by
 * `AccountChrome` (client), which shows the nav ONLY on account routes by
 * matching the pathname — mirroring the prototype's `App` chrome table.
 */

import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getCasesForClient } from "@/backend/modules/cases";
import { AccountChrome } from "./account-chrome";
import { PushSwRegister } from "./push-sw-register";
import { PwaUpdateBanner } from "./pwa-update-banner";

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations("cliente.nav");
  const tTeam = await getTranslations("cliente.team");

  // Resolve the client's primary (most-recent) case so the account-level
  // "Tu equipo" launcher opens that case's team chat (overlay O1). On ACCESO
  // routes the actor is null (unauthenticated) → no launcher. RLS scopes the
  // list to the client's own cases.
  let primaryCaseId: string | null = null;
  const actor = await getActor();
  if (actor?.kind === "client") {
    try {
      const cases = await getCasesForClient(actor, { limit: 1 });
      primaryCaseId = cases.items[0]?.id ?? null;
    } catch {
      primaryCaseId = null;
    }
  }

  const navLabels = {
    servicios: tNav("servicios"),
    casos: tNav("casos"),
    comunidad: tNav("comunidad"),
    avisos: tNav("avisos"),
    pagos: tNav("pagos"),
    navAccount: tNav("ariaAccount"),
    navCase: tNav("ariaCase"),
  };

  return (
    <div
      className="surface-cliente"
      style={{
        maxWidth: 430,
        margin: "0 auto",
        // `/ var(--text-scale)` compensates the `.surface-cliente` zoom so the
        // shell spans exactly one viewport at every text size (no overflow at lg,
        // no gap at sm). See the note on `.surface-staff` in globals.css.
        minHeight: "calc(100dvh / var(--text-scale, 1))",
        position: "relative",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {children}
      <AccountChrome
        navLabels={navLabels}
        teamLabel={tTeam("launcher")}
        caseId={primaryCaseId}
      />
      <PushSwRegister />
      <PwaUpdateBanner />
    </div>
  );
}
