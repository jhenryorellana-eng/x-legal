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
import { AccountChrome } from "./account-chrome";

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tNav = await getTranslations("cliente.nav");
  const tTeam = await getTranslations("cliente.team");

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
      style={{
        maxWidth: 430,
        margin: "0 auto",
        minHeight: "100dvh",
        position: "relative",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {children}
      <AccountChrome navLabels={navLabels} teamLabel={tTeam("launcher")} />
    </div>
  );
}
