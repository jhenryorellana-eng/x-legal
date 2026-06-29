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
import { getActor, getCurrentUserLocation } from "@/backend/modules/identity";
import { getBoard, listLeads, listLeadCategories } from "@/backend/modules/kanban";
import { LeadsClient } from "./client";
import { buildNewCaseModalData } from "../_lib/new-case-services";
import { fmtRelative, type Locale } from "@/frontend/lib/datetime";
import { sourceMeta } from "@/frontend/features/vanessa/shared/source-meta";
import { categoryColorHex } from "@/frontend/features/vanessa/leads/category-colors";
import type { LeadColumnVM, LeadCardVM, SourceOption } from "@/frontend/features/vanessa";
import { buildNuevaCitaStrings } from "../_lib/nueva-cita-strings";
import {
  moveKanbanCardAction,
  createLeadAction,
  createLeadCategoryAction,
  updateLeadCategoryAction,
  deleteLeadCategoryAction,
  reorderLeadCategoriesAction,
  listLeadCategoriesAction,
  searchCasesAction,
  getCaseBookingContextAction,
  searchProspectsAction,
  getProspectSlotsAction,
  createProspectInlineAction,
  bookAppointmentAction,
  createProspectApptAction,
} from "../actions";
import { createCaseAction } from "../../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function VentasLeadsPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.leads");
  const tnl = await getTranslations("staff.ventas.newLead");
  const tmc = await getTranslations("staff.ventas.manageCats");

  const board = await getBoard(actor, { kind: "leads" }).catch(() => null);
  const leadsPage = await listLeads(actor, {}).catch(() => null);
  const leadsById = new Map((leadsPage?.items ?? []).map((l) => [l.id, l]));

  // Real lead categories (their UUIDs are what `createLead` stores — the modal
  // must NOT use hardcoded slug ids, or `leads.category_id` fails the uuid cast).
  const categoryRows = await listLeadCategories(actor).catch(() => []);
  const categoriesById = new Map(categoryRows.map((c) => [c.id, c]));
  const categories = categoryRows.map((c) => ({ id: c.id, label: c.label, color: c.color }));

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
    const cat = lead?.category_id ? categoriesById.get(lead.category_id) : null;
    return {
      id: card.id,
      leadId: card.ref_id,
      columnId: card.column_id,
      name: lead?.full_name ?? null,
      phone: lead?.phone_e164 ?? "",
      source: lead?.source ?? "web",
      sourceLabel: sm.labelKey,
      serviceLabel: "Visa Juvenil",
      categoryId: lead?.category_id ?? null,
      categoryLabel: cat?.label ?? null,
      categoryColor: cat ? categoryColorHex(cat.color) : null,
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
    manageCategories: t("manageCategories"),
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
    agendar: t("agendar"),
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
    catNamePh: tnl("catNamePh"),
    catSave: tnl("catSave"),
    note: tnl("note"),
    notePh: tnl("notePh"),
    cancel: tnl("cancel"),
    create: tnl("create"),
    created: tnl("created", { col: "{col}" }),
    entryColumn: columns[0]?.title ?? tnl("entryColumn"),
    invalidPhone: tnl("invalidPhone"),
  };

  const manageCatsStrings = {
    title: tmc("title"),
    sub: tmc("sub"),
    empty: tmc("empty"),
    namePh: tmc("namePh"),
    add: tmc("add"),
    save: tmc("save"),
    cancel: tmc("cancel"),
    close: tmc("close"),
    delete: tmc("delete"),
    deleteConfirm: tmc("deleteConfirm", { label: "{label}" }),
    deactivatedToast: tmc("deactivatedToast"),
    deletedToast: tmc("deletedToast"),
    hide: tmc("hide"),
    show: tmc("show"),
    moveUp: tmc("moveUp"),
    moveDown: tmc("moveDown"),
    errorGeneric: tmc("errorGeneric"),
  };

  // Strings for the "Nueva cita" modal launched from a lead card "Agendar cita".
  const staffTz = (await getCurrentUserLocation(actor)).timezone;
  const nuevaCitaStrings = await buildNuevaCitaStrings(staffTz, locale);

  // Catalog services for the modals (Nuevo lead + Nuevo caso) — one read, shared
  // with /ventas/clientes via the _lib helper so the two pages never drift.
  const { services, newCaseServices, casosStrings } = await buildNewCaseModalData(actor.orgId, locale);

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
      manageCatsStrings={manageCatsStrings}
      nuevaCitaStrings={nuevaCitaStrings}
      staffTz={staffTz}
      locale={locale === "en" ? "en" : "es"}
      sources={sources}
      services={services}
      categories={categories}
      newCaseServices={newCaseServices}
      casosStrings={casosStrings}
      signingBaseUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
      moveAction={moveKanbanCardAction}
      createLeadAction={createLeadAction}
      createCategoryAction={createLeadCategoryAction}
      categoryActions={{
        list: listLeadCategoriesAction,
        update: updateLeadCategoryAction,
        remove: deleteLeadCategoryAction,
        reorder: reorderLeadCategoriesAction,
      }}
      citaActions={{
        searchCases: searchCasesAction,
        getCaseContext: getCaseBookingContextAction,
        searchProspects: searchProspectsAction,
        getProspectSlots: getProspectSlotsAction,
        createProspectInline: createProspectInlineAction,
        bookAppointment: bookAppointmentAction,
        createProspectAppointment: createProspectApptAction,
      }}
      createCaseAction={createCaseAction}
    />
  );
}
