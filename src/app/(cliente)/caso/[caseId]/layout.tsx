/**
 * Case shell layout — /caso/[caseId]/… (DOC-51 §0.1, NIVEL CASO).
 *
 * Server-side guard + case-level chrome (CaseNav variant "caso" + "Tu equipo"
 * launcher + a header showing the case number).
 *
 * GUARD — defense in depth (the middleware already gates /caso/* to authenticated
 * clients). Here we re-check `getActor()` is a `client`. The full membership
 * check (`case_members` → `is_case_member`) belongs to the `cases` module, which
 * is being built in parallel (F2-W2). Until its `requireCaseAccess`/workspace
 * read is exported, this layout MUST NOT block legitimate access; it performs the
 * client-kind check only and defers the per-case membership enforcement.
 *
 * TODO(F2-W2): replace the placeholder with the cases module access check, e.g.
 *   const ws = await getCaseWorkspace(actor, caseId); // RLS is_case_member
 *   if (!ws) notFound();
 * and source the real case number / service from `CaseWorkspaceDto`.
 */

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { Icon } from "@/frontend/components/brand/icon";
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

  // Client-kind guard (membership enforcement deferred to F2-W2 — see header).
  if (!actor || actor.kind !== "client") {
    redirect("/welcome");
  }

  const tNav = await getTranslations("cliente.nav");
  const tCase = await getTranslations("cliente.case");
  const tTeam = await getTranslations("cliente.team");

  // TODO(F2-W2): caseNumber + service come from CaseWorkspaceDto (cases module).
  // The prototype shows "#ULP-1234"; production uses ULP-YYYY-NNNN. We render a
  // neutral placeholder derived from the route until the read exists.
  const caseNumber = `ULP-${caseId.slice(0, 8).toUpperCase()}`;

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
      {/* Case header — number + back to "Mis casos" */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "52px 20px 14px",
          background: "var(--bg)",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            background: "var(--blue-soft)",
            color: "var(--accent)",
            borderRadius: 999,
            padding: "6px 13px",
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13.5,
          }}
        >
          <Icon name="briefcase" size={15} color="var(--accent)" />
          {tCase("caseLabel")} {caseNumber}
        </span>
      </header>

      {/* Page content — padded for the bottom nav (DOC-51 §0.6 padBottom 116) */}
      <div style={{ paddingBottom: 116 }}>{children}</div>

      <CaseChrome
        caseId={caseId}
        navLabels={navLabels}
        teamLabel={tTeam("launcher")}
      />
    </div>
  );
}
