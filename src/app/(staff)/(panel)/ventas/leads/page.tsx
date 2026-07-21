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
import { resolveDepartmentOwner } from "@/backend/modules/cases";
import { getNotesSummaryForLeads } from "@/backend/modules/notes";
import { buildNotesStrings } from "@/frontend/features/shared-case/notes";
import { LeadsClient } from "./client";
import { buildNewCaseModalData } from "../_lib/new-case-services";
import { fmtRelative, type Locale } from "@/frontend/lib/datetime";
import { sourceMeta } from "@/frontend/features/vanessa/shared/source-meta";
import { categoryColorHex } from "@/frontend/features/vanessa/leads/category-colors";
import type { LeadColumnVM, LeadCardVM, SourceOption } from "@/frontend/features/vanessa";
import { buildNuevaCitaStrings } from "../_lib/nueva-cita-strings";
import {
  moveKanbanCardAction,
  createKanbanColumnAction,
  updateKanbanColumnAction,
  reorderKanbanColumnsAction,
  deleteKanbanColumnAction,
  contactLeadAction,
  createLeadAction,
  updateLeadAction,
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
  addLeadNoteAction,
  listLeadNotesAction,
  deleteNoteAction,
} from "../actions";
import {
  createCaseAction,
  searchClientsForCaseAction,
  getClientCasesForNewCaseAction,
  checkClientPhoneAction,
} from "../../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function VentasLeadsPage() {
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.ventas.leads");
  const tnl = await getTranslations("staff.ventas.newLead");
  const tmc = await getTranslations("staff.ventas.manageCats");

  // Admin oversight: view/operate Vanessa's (sales) leads board, not the admin's
  // own empty one. Leads are org-scoped so only the board owner needs resolving.
  const dept = await resolveDepartmentOwner(actor, "sales");
  const board = await getBoard(actor, { kind: "leads", ownerStaffId: dept?.userId }).catch(() => null);
  const leadsPage = await listLeads(actor, {}).catch(() => null);
  const leadsById = new Map((leadsPage?.items ?? []).map((l) => [l.id, l]));

  // Catalog services for the modals (Nuevo lead + Nuevo caso) AND for resolving
  // each lead card's service label — one read, shared with /ventas/clientes via
  // the _lib helper so the two pages never drift.
  const { services, newCaseServices, casosStrings } = await buildNewCaseModalData(actor.orgId, locale);
  const servicesById = new Map(services.map((s) => [s.id, s.label]));

  // Real lead categories (their UUIDs are what `createLead` stores — the modal
  // must NOT use hardcoded slug ids, or `leads.category_id` fails the uuid cast).
  const categoryRows = await listLeadCategories(actor).catch(() => []);
  const categoriesById = new Map(categoryRows.map((c) => [c.id, c]));
  const categories = categoryRows.map((c) => ({ id: c.id, label: c.label, color: c.color }));

  const boardId = board?.board.id ?? "";

  const columns: LeadColumnVM[] = (board?.columns ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      boardId,
      title: c.label,
      color: c.color,
      isTerminalWon: c.is_terminal_won,
      isTerminalLost: c.is_terminal_lost,
      position: c.position,
    }));

  // A lead converted to a case (won_case_id set) leaves the leads board — it
  // now lives in /ventas/casos. Also drop cards whose lead row is missing.
  const visibleLeadCards = (board?.cards ?? []).filter((card) => {
    const lead = leadsById.get(card.ref_id);
    return lead != null && lead.won_case_id == null;
  });
  let notesSummary = new Map<string, { count: number; latestBody: string | null; latestAt: string | null }>();
  try {
    notesSummary = await getNotesSummaryForLeads(actor, visibleLeadCards.map((c) => c.ref_id));
  } catch (err) {
    console.error("[/ventas/leads] getNotesSummaryForLeads failed:", err);
  }

  const cards: LeadCardVM[] = visibleLeadCards
    .map((card) => {
      const lead = leadsById.get(card.ref_id)!;
      const sm = sourceMeta(lead.source ?? "web");
      const uncontacted = lead.contacted_at == null;
      const cat = lead.category_id ? categoriesById.get(lead.category_id) : null;
      return {
        id: card.id,
        leadId: card.ref_id,
        columnId: card.column_id,
        name: lead.full_name ?? null,
        phone: lead.phone_e164 ?? "",
        source: lead.source ?? "web",
        sourceLabel: sm.labelKey,
        serviceId: lead.interested_service_id ?? null,
        serviceLabel: lead.interested_service_id
          ? (servicesById.get(lead.interested_service_id) ?? "—")
          : "—",
        categoryId: lead.category_id ?? null,
        categoryLabel: cat?.label ?? null,
        categoryColor: cat ? categoryColorHex(cat.color) : null,
        note: lead.note ?? null,
        uncontacted,
        ageLabel: lead.created_at ? fmtRelative(lead.created_at, locale) : "",
        lostReason: lead.lost_reason ?? null,
        notesCount: notesSummary.get(card.ref_id)?.count ?? 0,
        latestNote: notesSummary.get(card.ref_id)?.latestBody ?? null,
      };
    });

  const strings = {
    title: t("title"),
    sub: t("sub"),
    board: t("board"),
    list: t("list"),
    filters: t("filters"),
    manageCategories: t("manageCategories"),
    newLead: t("newLead"),
    addLead: t("addLead"),
    editLead: t("editLead"),
    emptyCol: t("emptyCol"),
    lexTipHtml: t.markup("lexTipHtml", { b: (c) => `<b>${c}</b>`, n: String(cards.filter((c) => c.uncontacted).length) }),
    lexOk: t("lexOk"),
    call: t("call"),
    whatsapp: t("whatsapp"),
    agendar: t("agendar"),
    createCaseTooltip: t("createCaseTooltip"),
    notesLabel: t("notesLabel"),
    addNoteLabel: t("addNoteLabel"),
    lostTitle: t("lostTitle"),
    lostBody: t("lostBody"),
    lostReasonLabel: t("lostReasonLabel"),
    lostReasonPlaceholder: t("lostReasonPlaceholder"),
    confirm: t("confirm"),
    cancel: t("cancel"),
    lexEnabled: true,
    badgeRedmove: t("moveError"),
  };

  // Column-management strings (shared-kanban). Raw templates ({n}/{title}) are
  // interpolated client-side via String.replace, so read them with t.raw.
  const columnStrings = {
    newColumn: t("newColumn"),
    orderError: t("orderError"),
    createError: t("createError"),
    editError: t("editError"),
    deleteError: t("deleteError"),
    colModalCreateTitle: t("colModalCreateTitle"),
    colModalEditTitle: t("colModalEditTitle"),
    colNameLabel: t("colNameLabel"),
    colNamePh: t("colNamePh"),
    colNameRequired: t("colNameRequired"),
    colColorLabel: t("colColorLabel"),
    colSave: t("colSave"),
    colCancel: t("colCancel"),
    delModalTitle: t("delModalTitle"),
    delModalBodyEmpty: t("delModalBodyEmpty"),
    delModalBodyCards: t.raw("delModalBodyCards"),
    delMigrateLabel: t("delMigrateLabel"),
    delConfirm: t("delConfirm"),
    delCancel: t("delCancel"),
    delLastColumn: t("delLastColumn"),
    colMenuEdit: t("colMenuEdit"),
    colMenuDelete: t("colMenuDelete"),
    colMenuMoveLeft: t("colMenuMoveLeft"),
    colMenuMoveRight: t("colMenuMoveRight"),
    colMenuAria: t.raw("colMenuAria"),
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
    editTitle: tnl("editTitle"),
    editSub: tnl("editSub"),
    save: tnl("save"),
    saved: tnl("saved"),
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
      viewingAs={dept?.displayName ?? null}
      notesStrings={buildNotesStrings(locale === "en" ? "en" : "es")}
      noteActions={{
        addNote: addLeadNoteAction,
        listNotes: listLeadNotesAction,
        deleteNote: deleteNoteAction,
      }}
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
      boardId={boardId}
      moveAction={moveKanbanCardAction}
      contactAction={contactLeadAction}
      columnActions={{
        createColumn: createKanbanColumnAction,
        updateColumn: updateKanbanColumnAction,
        reorderColumns: reorderKanbanColumnsAction,
        deleteColumn: deleteKanbanColumnAction,
      }}
      columnStrings={columnStrings}
      createLeadAction={createLeadAction}
      updateLeadAction={updateLeadAction}
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
      searchClientsAction={searchClientsForCaseAction}
      getClientCasesAction={getClientCasesForNewCaseAction}
      checkClientPhoneAction={checkClientPhoneAction}
    />
  );
}
