/**
 * Kanban de casos personal — /finanzas/casos (Andrium / Operaciones).
 *
 * Mismo motor genérico que /legal: cada staff ve los casos de los que es
 * RESPONSABLE (current_owner_id = actor) en su propio board `cases`. La primera
 * columna ("Por iniciar") recibe los casos recién traspasados a esta persona.
 * (El board `collections` de cobranza de Andrium es un eje aparte, no se toca aquí.)
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getBoard, backfillCasesBoard } from "@/backend/modules/kanban";
import {
  listCasesByOwner,
  getCaseBoardAlerts,
} from "@/backend/modules/cases";
import type { AdminCaseListItem, CaseBoardAlert } from "@/backend/modules/cases";
import { resolveI18n } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";
import { fmtRelative } from "@/frontend/lib/datetime";
import { resolveServiceColor } from "@/frontend/lib/service-color";
import type {
  CaseCardVM,
  CaseColumnVM,
  DianaKanbanStrings,
} from "@/frontend/features/legal/kanban/diana-kanban-view";
import { DianaKanbanView } from "@/frontend/features/legal/kanban/diana-kanban-view";
import {
  moveKanbanCardAction,
  updateKanbanCardNoteAction,
  createKanbanColumnAction,
  updateKanbanColumnAction,
  reorderKanbanColumnsAction,
  deleteKanbanColumnAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function FinanzasCasosPage() {
  // ── Auth gate ────────────────────────────────────────────────────────────
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.legal.kanban");

  // ── Board + hydration data ───────────────────────────────────────────────
  let board: Awaited<ReturnType<typeof getBoard>> | null = null;
  let boardError = false;
  let myCases: AdminCaseListItem[] = [];
  let alertsMap: Record<string, CaseBoardAlert> = {};

  try {
    myCases = await listCasesByOwner(actor);
    const caseIds = myCases.map((c) => c.id);

    try {
      await backfillCasesBoard(actor, caseIds);
    } catch (err) {
      console.error("[/finanzas/casos] backfillCasesBoard failed:", err);
    }

    board = await getBoard(actor, { kind: "cases" });

    try {
      alertsMap = await getCaseBoardAlerts(actor, caseIds);
    } catch (err) {
      console.error("[/finanzas/casos] getCaseBoardAlerts failed:", err);
    }
  } catch (err) {
    console.error("[/finanzas/casos] board load failed:", err);
    boardError = true;
  }

  // ── Columns VM ───────────────────────────────────────────────────────────
  const columnVMs: CaseColumnVM[] = (board?.columns ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => ({
      id: c.id,
      boardId: board!.board.id,
      title: c.label,
      color: c.color,
      isTerminalWon: c.is_terminal_won,
      position: c.position,
    }));

  // ── Hydration data: map cases by id to enrich cards ──────────────────────
  const caseMap = new Map<string, AdminCaseListItem>(
    myCases.map((c) => [c.id, c]),
  );

  // ── Cards VM ─────────────────────────────────────────────────────────────
  const now = new Date();
  const cardVMs: CaseCardVM[] = (board?.cards ?? [])
    // Only cards for cases this person currently owns (no orphan "—" cards).
    .filter((card) => card.ref_type === "case" && caseMap.has(card.ref_id))
    .map((card) => {
      const caseItem = caseMap.get(card.ref_id);
      const serviceLabel = resolveI18n(caseItem?.serviceLabelI18n, locale as "es" | "en");
      const phaseLabel = resolveI18n(caseItem?.phaseLabelI18n, locale as "es" | "en");
      const caseStatus = caseItem?.status ?? "active";
      const isInactive = caseStatus === "on_hold" || caseStatus === "cancelled";
      const withLawyer = caseItem?.planKind === "with_lawyer";

      const ageFrom = card.updated_at ?? card.created_at ?? now.toISOString();
      const ageLabel = fmtRelative(ageFrom, locale as "es" | "en");
      const minutesInCol = (now.getTime() - new Date(ageFrom).getTime()) / 60_000;
      const ageTier: CaseCardVM["ageTier"] =
        minutesInCol > 60 * 48 ? "time-hot" :
        minutesInCol > 60 * 24 ? "time-warn" :
        "time-ok";

      return {
        id: card.id,
        columnId: card.column_id,
        caseId: card.ref_id,
        caseNumber: caseItem?.caseNumber ?? card.ref_id.slice(0, 8).toUpperCase(),
        clientName: caseItem?.clientName ?? "—",
        serviceLabel: serviceLabel || "—",
        serviceIcon: caseItem?.serviceIcon || "folder",
        serviceColor: resolveServiceColor(caseItem?.serviceColor) ?? "var(--ink-2)",
        phaseLabel: phaseLabel || "",
        withLawyer,
        caseStatus,
        isInactive,
        alerts: {
          docsToReview: alertsMap[card.ref_id]?.needsReview ?? 0,
          lawyerCorrections: alertsMap[card.ref_id]?.lawyerCorrections ?? false,
          generationFailed: alertsMap[card.ref_id]?.generationFailed ?? false,
          rfeOverdue: alertsMap[card.ref_id]?.rfeOverdue ?? false,
          rfeInProgress: alertsMap[card.ref_id]?.rfeInProgress ?? false,
        },
        pinnedNote: card.pinned_note ?? null,
        ageLabel,
        ageTier,
      };
    });

  // ── Total docs-to-review (banner) ────────────────────────────────────────
  const totalDocsToReview = Object.values(alertsMap).reduce(
    (sum, a) => sum + a.needsReview,
    0,
  );

  // ── i18n strings ─────────────────────────────────────────────────────────
  const alertCount = cardVMs.filter(
    (c) => c.alerts.docsToReview > 0 || c.alerts.lawyerCorrections || c.alerts.generationFailed || c.alerts.rfeOverdue,
  ).length;

  const strings: DianaKanbanStrings = {
    title: t("title"),
    sub: t("sub", { n: cardVMs.length, alerts: alertCount }),
    newColumn: t("newColumn"),
    emptyCol: t("emptyCol"),
    moveError: t("moveError"),
    noteError: t("noteError"),
    orderError: t("orderError"),
    deleteError: t("deleteError"),
    createError: t("createError"),
    editError: t("editError"),
    bannerSingle: t.raw("bannerSingle"),
    bannerPlural: t.raw("bannerPlural"),
    bannerCta: t("bannerCta"),
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
    alertDocsToReview: t.raw("alertDocsToReview"),
    alertLawyerCorrections: t("alertLawyerCorrections"),
    alertGenerationFailed: t("alertGenerationFailed"),
    alertRfeOverdue: t("alertRfeOverdue"),
    statusActive: t("statusActive"),
    statusInValidation: t("statusInValidation"),
    statusPaymentPending: t("statusPaymentPending"),
    statusReady: t("statusReady"),
    statusDelivered: t("statusDelivered"),
    statusOnHold: t("statusOnHold"),
    statusCancelled: t("statusCancelled"),
    withLawyer: t("withLawyer"),
    onHoldChip: t("onHoldChip"),
    cancelledChip: t("cancelledChip"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    notePlaceholder: t("notePlaceholder"),
    rfeInProgress: t("rfeInProgress"),
    timeInColumn: t("timeInColumn"),
    colMenuEdit: t("colMenuEdit"),
    colMenuDelete: t("colMenuDelete"),
    colMenuMoveLeft: t("colMenuMoveLeft"),
    colMenuMoveRight: t("colMenuMoveRight"),
    colMenuAria: t.raw("colMenuAria"),
    openCaseAria: t.raw("openCaseAria"),
    openCase: t("openCase"),
  };

  // ── Error state (non-500) ────────────────────────────────────────────────
  if (boardError) {
    return (
      <div style={{ padding: "54px 32px", maxWidth: 480 }}>
        <p style={{ color: "var(--red)", fontWeight: 700 }}>{t("loadError")}</p>
        <a href="/finanzas/casos" style={{ color: "var(--accent)", fontWeight: 700 }}>{t("retry")}</a>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <DianaKanbanView
      boardId={board?.board.id ?? ""}
      columns={columnVMs}
      cards={cardVMs}
      totalDocsToReview={totalDocsToReview}
      caseHref={(id) => `/ventas/clientes/${id}`}
      strings={strings}
      actions={{
        moveCard: moveKanbanCardAction,
        updateNote: updateKanbanCardNoteAction,
        createColumn: createKanbanColumnAction,
        updateColumn: updateKanbanColumnAction,
        reorderColumns: reorderKanbanColumnsAction,
        deleteColumn: deleteKanbanColumnAction,
      }}
    />
  );
}
