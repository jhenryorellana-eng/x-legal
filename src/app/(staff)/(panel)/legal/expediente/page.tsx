/**
 * Diana — Expedientes index · /legal/expediente.
 *
 * Server Component: lists every owned case that has an expediente, with its
 * latest attempt status and a deep link to the assembler. Fixes the sidebar
 * "Expedientes" link (previously a 404 — only /legal/expediente/[caseId] existed)
 * and gives Diana one place to resume assembly work.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listCasesByOwner } from "@/backend/modules/cases";
import type { AdminCaseListItem } from "@/backend/modules/cases";
import { getCaseExpedientes } from "@/backend/modules/expediente";
import type { ExpedienteRow } from "@/backend/modules/expediente";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { MSym } from "@/frontend/features/vanessa/shared/msym";

export const dynamic = "force-dynamic";

/** Statuses where the assembler is still editable (CTA = "continuar"). */
const EDITABLE = new Set(["draft", "compile_failed"]);

// Maps every expediente status to its i18n key. If a new status is added to the
// expediente domain, add it here too — an unmapped status falls back to "Borrador".
const STATUS_KEY: Record<string, string> = {
  draft: "statusDraft",
  compiling: "statusCompiling",
  compile_failed: "statusCompileFailed",
  compiled: "statusCompiled",
  sent_to_lawyer: "statusSentToLawyer",
  corrections_needed: "statusCorrectionsNeeded",
  approved: "statusApproved",
  sent_to_finance: "statusSentToFinance",
  printed: "statusPrinted",
};

const STATUS_TONE: Record<string, string> = {
  draft: "var(--ink-2)",
  compiling: "var(--accent)",
  compile_failed: "var(--red)",
  compiled: "var(--green)",
  sent_to_lawyer: "var(--accent)",
  corrections_needed: "var(--red)",
  approved: "var(--green)",
  sent_to_finance: "var(--ink-2)",
  printed: "var(--ink-2)",
};

export default async function LegalExpedienteIndexPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.legal.expedienteIndex");
  // Status labels are looked up by a dynamic key (exp.status) — next-intl types
  // `t` against the literal key set, so use a string-keyed view for those.
  const tStatus = t as unknown as (key: string) => string;

  let rows: Array<{ c: AdminCaseListItem; exp: ExpedienteRow }> = [];
  let loadError = false;
  try {
    const cases = await listCasesByOwner(actor);
    const latestPerCase = await Promise.all(
      cases.map(async (c) => {
        const exps = await getCaseExpedientes(actor, c.id).catch(() => [] as ExpedienteRow[]);
        const latest = [...exps].sort((a, b) => b.attempt_no - a.attempt_no)[0];
        return latest ? { c, exp: latest } : null;
      }),
    );
    rows = latestPerCase.filter((x): x is { c: AdminCaseListItem; exp: ExpedienteRow } => x !== null);
    // In-progress first (editable / corrections), then the rest.
    rows.sort((a, b) => rank(a.exp.status) - rank(b.exp.status));
  } catch (err) {
    // Message only — app layer can't import the platform logger (boundaries).
    console.error("[/legal/expediente] load failed:", err instanceof Error ? err.message : String(err));
    loadError = true;
  }

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
          <div className="v-sub">{t("sub", { n: rows.length })}</div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 0", color: "var(--ink-3)" }}>
          <MSym name="library_books" size={52} color="var(--ink-3)" />
          <div style={{ fontSize: 14, textAlign: "center", maxWidth: 360 }}>{t("empty")}</div>
        </div>
      ) : (
        <div className="vcard vcard-pad">
          {rows.map(({ c, exp }) => {
            const serviceLabel = resolveI18n(c.serviceLabelI18n, locale as "es" | "en");
            const editable = EDITABLE.has(exp.status);
            const tone = STATUS_TONE[exp.status] ?? "var(--ink-2)";
            return (
              <Link
                key={c.id}
                href={`/legal/expediente/${c.id}`}
                className="attend-row"
                style={{ textDecoration: "none", color: "inherit", alignItems: "center" }}
              >
                <div className="src-ico" style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}>
                  <MSym name="library_books" size={19} />
                </div>
                <div className="attend-main">
                  <div className="attend-name">{c.clientName ?? "—"}</div>
                  <div className="attend-meta">
                    <span>{c.caseNumber}</span>
                    {serviceLabel && <><span aria-hidden>·</span><span>{serviceLabel}</span></>}
                    <span aria-hidden>·</span><span>{t("attempt", { n: exp.attempt_no })}</span>
                  </div>
                </div>
                <span className="kchip" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone, height: 24 }}>
                  {tStatus(STATUS_KEY[exp.status] ?? "statusDraft")}
                </span>
                <span className="vbtn vbtn-ghost vbtn-sm" style={{ pointerEvents: "none" }}>
                  {editable ? t("continueCta") : t("viewCta")}
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

/** Sort rank: editable/corrections first, terminal last. */
function rank(status: string): number {
  if (status === "draft" || status === "compile_failed") return 0;
  if (status === "corrections_needed") return 1;
  if (status === "compiling" || status === "compiled" || status === "sent_to_lawyer" || status === "approved") return 2;
  return 3; // sent_to_finance, printed
}
