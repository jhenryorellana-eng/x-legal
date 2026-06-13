/**
 * Leads — kanban board · /ventas/leads (DOC-52 §2).
 *
 * Server Component: guards the actor, reads the board (columns + cards) and the
 * leads to hydrate each card, composes the normative strings, and injects the
 * move action. F3 note: card hydration joins cards.ref_id → leads; realtime
 * board:{id} is optional (degrades to refresh). The dev preview renders a fully
 * populated board for Playwright.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getBoard, listLeads } from "@/backend/modules/kanban";
import { listContractableServices } from "@/backend/modules/catalog";
import { resolveI18n } from "@/shared/i18n";
import { buildCasosStrings } from "@/frontend/features/shared-case";
import type { NewCaseService } from "@/frontend/features/admin/casos/new-case-modal";
import { LeadsClient } from "./client";
import { fmtRelative, type Locale } from "@/frontend/lib/datetime";
import { sourceMeta } from "@/frontend/features/vanessa/shared/source-meta";
import type { LeadColumnVM, LeadCardVM, SourceOption } from "@/frontend/features/vanessa";
import {
  moveKanbanCardAction,
  createLeadAction,
  createLeadCategoryAction,
} from "../actions";
import { createCaseAction } from "../../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function VentasLeadsPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.leads");
  const tnl = await getTranslations("staff.ventas.newLead");

  const board = await getBoard(actor, { kind: "leads" }).catch(() => null);
  const leadsPage = await listLeads(actor, {}).catch(() => null);
  const leadsById = new Map((leadsPage?.items ?? []).map((l) => [l.id, l]));

  const columns: LeadColumnVM[] = (board?.columns ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      title: c.label,
      color: c.color,
      isTerminalWon: c.is_terminal_won,
      isTerminalLost: c.is_terminal_lost,
    }));

  const cards: LeadCardVM[] = (board?.cards ?? []).map((card) => {
    const lead = leadsById.get(card.ref_id);
    const sm = sourceMeta(lead?.source ?? "web");
    const uncontacted = lead ? lead.contacted_at == null : false;
    return {
      id: card.id,
      columnId: card.column_id,
      name: lead?.full_name ?? null,
      phone: lead?.phone_e164 ?? "",
      source: lead?.source ?? "web",
      sourceLabel: sm.labelKey,
      serviceLabel: "Visa Juvenil",
      categoryId: lead?.category_id ?? null,
      categoryLabel: null,
      categoryColor: null,
      uncontacted,
      ageLabel: lead?.created_at ? fmtRelative(lead.created_at, locale) : "",
      lostReason: lead?.lost_reason ?? null,
    };
  });

  const strings = {
    title: t("title"),
    sub: t("sub"),
    board: t("board"),
    list: t("list"),
    filters: t("filters"),
    column: t("column"),
    newLead: t("newLead"),
    addLead: t("addLead"),
    emptyCol: t("emptyCol"),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>`, n: String(cards.filter((c) => c.uncontacted).length) }),
    lexOk: t("lexOk"),
    wonOfferHtml: t.markup("wonOfferHtml", { b: (c) => `<b>${c}</b>`, name: "{name}" }),
    createCase: t("createCase"),
    notNow: t("notNow"),
    call: t("call"),
    whatsapp: t("whatsapp"),
    createCaseTooltip: t("createCaseTooltip"),
    lostTitle: t("lostTitle"),
    lostBody: t("lostBody"),
    lostReasonLabel: t("lostReasonLabel"),
    lostReasonPlaceholder: t("lostReasonPlaceholder"),
    confirm: t("confirm"),
    cancel: t("cancel"),
    lexEnabled: true,
    badgeRedmove: t("moveError"),
  };

  const newLeadStrings = {
    title: tnl("title"),
    sub: tnl("sub"),
    phone: tnl("phone"),
    phonePh: tnl("phonePh"),
    dupWarn: tnl("dupWarn", { name: "{name}" }),
    view: tnl("view"),
    name: tnl("name"),
    namePh: tnl("namePh"),
    source: tnl("source"),
    service: tnl("service"),
    category: tnl("category"),
    createCat: tnl("createCat"),
    note: tnl("note"),
    notePh: tnl("notePh"),
    cancel: tnl("cancel"),
    create: tnl("create"),
    created: tnl("created", { col: "{col}" }),
    entryColumn: columns[0]?.title ?? tnl("entryColumn"),
    invalidPhone: tnl("invalidPhone"),
  };

  // Catalog services for the modals (Nuevo lead + Nuevo caso).
  const catalogServices = await listContractableServices(actor.orgId).catch(() => []);
  const services = catalogServices.map((s) => ({ id: s.id, label: resolveI18n(s.label_i18n, locale) }));
  const casosStrings = buildCasosStrings(locale === "en" ? "en" : "es");
  const newCaseServices: NewCaseService[] = catalogServices.map((s) => ({
    id: s.id,
    label: resolveI18n(s.label_i18n, locale),
    plans: [],
    encodedByKind: {},
  }));

  const sources: SourceOption[] = [
    { value: "tiktok", label: "TikTok" },
    { value: "web", label: t("title") === "Leads" ? "Web" : "Web" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "voz", label: locale === "en" ? "Voice agent" : "Agente de voz" },
    { value: "ref", label: locale === "en" ? "Referral" : "Referido" },
  ];

  return (
    <LeadsClient
      columns={columns}
      cards={cards}
      strings={strings}
      newLeadStrings={newLeadStrings}
      sources={sources}
      services={services}
      newCaseServices={newCaseServices}
      casosStrings={casosStrings}
      signingBaseUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      moveAction={moveKanbanCardAction}
      createLeadAction={createLeadAction}
      createCategoryAction={createLeadCategoryAction}
      createCaseAction={createCaseAction}
    />
  );
}
