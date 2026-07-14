/**
 * Mis clientes — case list · /ventas/clientes (DOC-52 §5.1).
 *
 * Server Component: guards the actor, reads the cases assigned to the advisor
 * (cases index), composes the list rows, and renders the client list. Clicking a
 * row navigates to the shared-case workspace (/ventas/clientes/[caseId]). The
 * dev preview renders a populated list for Playwright.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { listCasesAdmin } from "@/backend/modules/cases";
import { resolveI18n, type Locale } from "@/shared/i18n";
import { fmtRelative } from "@/frontend/lib/datetime";
import type { CaseRowVM } from "@/frontend/features/vanessa";
import { ClientesClient } from "./client";
import { buildNewCaseModalData } from "../_lib/new-case-services";
import {
  createCaseAction,
  searchClientsForCaseAction,
  getClientCasesForNewCaseAction,
} from "../../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function VentasClientesPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.clientes");

  // Global clients list: every case of the org (no owner filter). A generous
  // page covers the current business; a server-side search is the scale path.
  const page = await listCasesAdmin(actor, { limit: 200 }).catch(() => ({ items: [], nextCursor: null }));

  const rows: CaseRowVM[] = page.items.map((c) => {
    const signed = c.status !== "payment_pending" && c.status !== "draft";
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      clientName: c.clientName ?? "—",
      phone: c.clientPhone,
      serviceLabel: c.serviceLabelI18n ? resolveI18n(c.serviceLabelI18n, locale) : "—",
      members: [],
      jurisdiction: "—",
      updatedLabel: c.openedAt ? fmtRelative(c.openedAt, locale) : "",
      contractState: signed ? "firmado" : "borrador",
      seqIndex: c.phaseIndex,
      seqTotal: c.phaseCount,
      docsApproved: 0,
      docsTotal: 0,
      formsPct: 0,
      ready: false,
      sameClient: false,
    };
  });

  const ready = rows.find((r) => r.ready) ?? null;

  // Data for the "Nuevo caso" modal (DOC-52 §2.7: "Mis clientes" launches the
  // same modal as the Leads board, with no preset) — shared via the _lib helper.
  const { newCaseServices, casosStrings } = await buildNewCaseModalData(actor.orgId, locale);

  const strings = {
    title: t("title"),
    sub: t("sub"),
    byCase: t("byCase"),
    byClient: t("byClient"),
    newCase: t("newCase"),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>`, name: ready?.clientName ?? "—" }),
    openTo: t("openTo", { name: "{name}" }),
    pendingSign: t("pendingSign"),
    readyDiana: t("readyDiana"),
    sameClient: t("sameClient"),
    sendContract: t("sendContract"),
    docs: t("docs", { x: "{x}", y: "{y}" }),
    forms: t("forms", { f: "{f}" }),
    empty: t("empty"),
    caseCount: t("caseCount", { n: "{n}" }),
    caseCountOne: t("caseCountOne", { n: "{n}" }),
    searchPlaceholder: t("searchPlaceholder"),
    searchEmpty: t("searchEmpty"),
    lexEnabled: true,
  };

  return (
    <ClientesClient
      cases={rows}
      strings={strings}
      readyClientName={ready?.clientName ?? null}
      readyCaseId={ready?.id ?? null}
      newCaseServices={newCaseServices}
      casosStrings={casosStrings}
      createCaseAction={createCaseAction}
      searchClientsAction={searchClientsForCaseAction}
      getClientCasesAction={getClientCasesForNewCaseAction}
    />
  );
}
