/**
 * Diana — "Por revisar" review queue · /legal/por-revisar (DOC-54 §1.6).
 *
 * Server Component: lists every owned case that has documents waiting for review
 * (case_documents.status='uploaded'), grouped by case with a deep link to the
 * case workspace (Documentos tab). This is the destination of the kanban banner
 * CTA and the sidebar "Por revisar" entry.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listCasesByOwner, getCaseBoardAlerts } from "@/backend/modules/cases";
import type { AdminCaseListItem, CaseBoardAlert } from "@/backend/modules/cases";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { MSym } from "@/frontend/features/vanessa/shared/msym";

export const dynamic = "force-dynamic";

export default async function LegalPorRevisarPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.legal.porRevisar");

  let cases: AdminCaseListItem[] = [];
  let alertsMap: Record<string, CaseBoardAlert> = {};
  let loadError = false;
  try {
    cases = await listCasesByOwner(actor);
    alertsMap = await getCaseBoardAlerts(actor, cases.map((c) => c.id));
  } catch (err) {
    // Message only — app layer can't import the platform logger (boundaries).
    console.error("[/legal/por-revisar] load failed:", err instanceof Error ? err.message : String(err));
    loadError = true;
  }

  const queue = cases
    .map((c) => ({ c, count: alertsMap[c.id]?.needsReview ?? 0 }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalDocs = queue.reduce((s, x) => s + x.count, 0);

  if (loadError) {
    return (
      <div style={{ padding: "54px 32px", maxWidth: 480 }}>
        <p style={{ color: "var(--red)", fontWeight: 700 }}>{t("loadError")}</p>
      </div>
    );
  }

  return (
    <div className="fade-up">
      <div className="v-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="v-title">{t("title")}</h1>
          <div className="v-sub">{t("sub", { n: totalDocs, m: queue.length })}</div>
        </div>
      </div>

      {queue.length === 0 ? (
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--ink-3)" }}
        >
          <MSym name="task_alt" size={52} color="var(--green)" />
          <div style={{ fontSize: 14, textAlign: "center", maxWidth: 360 }}>{t("empty")}</div>
        </div>
      ) : (
        <div className="vcard vcard-pad">
          {queue.map(({ c, count }) => {
            const serviceLabel = resolveI18n(c.serviceLabelI18n, locale as "es" | "en");
            return (
              <Link
                key={c.id}
                href={`/legal/caso/${c.id}`}
                className="attend-row"
                style={{ textDecoration: "none", color: "inherit", alignItems: "center" }}
              >
                <div className="src-ico" style={{ background: "var(--blue-soft)", color: "var(--accent)" }}>
                  <MSym name="fact_check" size={19} />
                </div>
                <div className="attend-main">
                  <div className="attend-name">{c.clientName ?? "—"}</div>
                  <div className="attend-meta">
                    <span>{c.caseNumber}</span>
                    {serviceLabel && <><span aria-hidden>·</span><span>{serviceLabel}</span></>}
                  </div>
                </div>
                <span
                  className="kchip"
                  style={{ background: "var(--blue-soft)", color: "var(--accent)", height: 24 }}
                >
                  {t("docsCount", { n: count })}
                </span>
                <span className="vbtn vbtn-ghost vbtn-sm" style={{ pointerEvents: "none" }}>
                  {t("openCase")}
                  <MSym name="arrow_forward" size={16} />
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
