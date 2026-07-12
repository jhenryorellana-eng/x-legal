/**
 * Kanban de casos — /legal (DOC-54 §1, RF-DIA-001..006).
 *
 * Server Component:
 *   1. Guards actor (staff + cases:view).
 *   2. listCasesByOwner(actor) → only the cases Diana is responsible for.
 *   3. backfillCasesBoard(actor, caseIds) → idempotently ensure a card exists
 *      for every assigned case (covers cases assigned before the onCaseAssigned
 *      listener ran). Safe on every load.
 *   4. getBoard(actor, { kind: 'cases' }) → lazy-init con columnas semilla.
 *   5. getCaseBoardAlerts(actor, caseIds) → batch alert aggregation per case
 *      (docs to review, lawyer corrections, generation failed, RFE overdue).
 *   6. Injects server actions and passes serialisable VM to the client component.
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getBoard, backfillCasesBoard } from "@/backend/modules/kanban";
import {
  listCasesByOwner,
  getCaseBoardAlerts,
  resolveDepartmentOwner,
} from "@/backend/modules/cases";
import type { AdminCaseListItem, CaseBoardAlert } from "@/backend/modules/cases";
import { getNotesSummaryForCases } from "@/backend/modules/notes";
import { resolveI18n } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";
import { resolveServiceColor } from "@/frontend/lib/service-color";
import type {
  CaseCardVM,
  CaseColumnVM,
  DianaKanbanStrings,
} from "@/frontend/features/legal/kanban/diana-kanban-view";
import { DianaKanbanView } from "@/frontend/features/legal/kanban/diana-kanban-view";
import { buildNotesStrings } from "@/frontend/features/shared-case/notes";
import {
  moveKanbanCardAction,
  createKanbanColumnAction,
  updateKanbanColumnAction,
  reorderKanbanColumnsAction,
  deleteKanbanColumnAction,
} from "./actions";
import {
  addCaseNoteAction,
  listCaseNotesAction,
  deleteNoteAction,
} from "../admin/casos/actions";

export const dynamic = "force-dynamic";

export default async function LegalPage() {
  // ── Auth gate ────────────────────────────────────────────────────────────
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.legal.kanban");

  // ── Board + hydration data ───────────────────────────────────────────────
  // 1. listCasesByOwner → only the cases Diana is responsible for (GAP-1).
  // 2. backfillCasesBoard → ensure a card exists for every assigned case
  //    (idempotent; covers cases assigned before the onCaseAssigned listener).
  // 3. getBoard → seeded board + cards.
  // 4. getCaseBoardAlerts → batch alert aggregation per case (GAP-3).
  let board: Awaited<ReturnType<typeof getBoard>> | null = null;
  let boardError = false;
  let myCases: AdminCaseListItem[] = [];
  let alertsMap: Record<string, CaseBoardAlert> = {};
  let notesSummary = new Map<string, { count: number; latestBody: string | null; latestAt: string | null }>();

  // Admin oversight: view/operate the paralegal's (Diana) board, not the admin's
  // own empty one. Non-admins → null → their own board.
  const dept = await resolveDepartmentOwner(actor, "legal");
  const ownerId = dept?.userId ?? actor.userId;

  try {
    myCases = await listCasesByOwner(actor, ownerId);
    const caseIds = myCases.map((c) => c.id);

    // Backfill is best-effort: a failure must never blank the whole board.
    try {
      await backfillCasesBoard(actor, caseIds, ownerId);
    } catch (err) {
      // Best-effort: log to server stdout (the platform logger isn't importable
      // from the app layer per eslint-boundaries).
      console.error("[/legal] backfillCasesBoard failed:", err);
    }

    board = await getBoard(actor, { kind: "cases", ownerStaffId: dept?.userId });

    // Alerts are an enrichment: degrade to no-alerts on failure.
    try {
      alertsMap = await getCaseBoardAlerts(actor, caseIds);
    } catch (err) {
      console.error("[/legal] getCaseBoardAlerts failed:", err);
    }

    try {
      notesSummary = await getNotesSummaryForCases(actor, caseIds);
    } catch (err) {
      console.error("[/legal] getNotesSummaryForCases failed:", err);
    }
  } catch (err) {
    // listCasesForParalegal / getBoard are essential → friendly error state.
    console.error("[/legal] board load failed:", err);
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
      isTerminalLost: c.is_terminal_lost,
      position: c.position,
    }));

  // ── Hydration data: map cases by id to enrich cards ──────────────────────
  const caseMap = new Map<string, AdminCaseListItem>(
    myCases.map((c) => [c.id, c]),
  );

  // ── Cards VM ─────────────────────────────────────────────────────────────
  const cardVMs: CaseCardVM[] = (board?.cards ?? [])
    // Only render cards for cases this person currently owns — a case sent on to
    // another stage/owner leaves the board (orphan cards would show "—").
    .filter((card) => card.ref_type === "case" && caseMap.has(card.ref_id))
    .map((card) => {
      const caseItem = caseMap.get(card.ref_id);
      const serviceLabel = resolveI18n(caseItem?.serviceLabelI18n, locale as "es" | "en");
      const phaseLabel = resolveI18n(caseItem?.phaseLabelI18n, locale as "es" | "en");
      const caseStatus = caseItem?.status ?? "active";
      const isInactive = caseStatus === "on_hold" || caseStatus === "cancelled";
      const withLawyer = caseItem?.planKind === "with_lawyer";

      return {
        id: card.id,
        columnId: card.column_id,
        caseId: card.ref_id,
        caseNumber: caseItem?.caseNumber ?? card.ref_id.slice(0, 8).toUpperCase(),
        clientName: caseItem?.clientName ?? "—",
        serviceLabel: serviceLabel || "—",
        // Service icon/color come from the catalog (services.icon/color) via the
        // enriched AdminCaseListItem; fall back to a neutral folder if unset.
        serviceIcon: caseItem?.serviceIcon || "folder",
        serviceColor: resolveServiceColor(caseItem?.serviceColor ?? null) ?? "var(--ink-2)",
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
        notesCount: notesSummary.get(card.ref_id)?.count ?? 0,
        latestNote: notesSummary.get(card.ref_id)?.latestBody ?? null,
        stageDueAt: caseItem?.stageDueAt ?? null,
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
    orderError: t("orderError"),
    deleteError: t("deleteError"),
    createError: t("createError"),
    editError: t("editError"),
    // Raw templates: the client interpolates {n} per render via String.replace.
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
    withoutLawyer: t("withoutLawyer"),
    onHoldChip: t("onHoldChip"),
    cancelledChip: t("cancelledChip"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    notesLabel: t("notesLabel"),
    addNoteLabel: t("addNoteLabel"),
    rfeInProgress: t("rfeInProgress"),
    timeInColumn: t("timeInColumn"),
    colMenuEdit: t("colMenuEdit"),
    colMenuDelete: t("colMenuDelete"),
    colMenuMoveLeft: t("colMenuMoveLeft"),
    colMenuMoveRight: t("colMenuMoveRight"),
    // Raw templates: client interpolates {title}/{caseNumber} per render.
    colMenuAria: t.raw("colMenuAria"),
    openCaseAria: t.raw("openCaseAria"),
    openCase: t("openCase"),
  };

  // ── Error state (non-500) ────────────────────────────────────────────────
  if (boardError) {
    return (
      <div style={{ padding: "54px 32px", maxWidth: 480 }}>
        <p style={{ color: "var(--red)", fontWeight: 700 }}>{t("loadError")}</p>
        <a href="/legal" style={{ color: "var(--accent)", fontWeight: 700 }}>{t("retry")}</a>
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
      reviewQueueHref="/legal/por-revisar"
      viewingAs={dept?.displayName ?? null}
      strings={strings}
      notesStrings={buildNotesStrings(locale === "en" ? "en" : "es")}
      locale={locale === "en" ? "en" : "es"}
      actions={{
        moveCard: moveKanbanCardAction,
        addNote: addCaseNoteAction,
        listNotes: listCaseNotesAction,
        deleteNote: deleteNoteAction,
        createColumn: createKanbanColumnAction,
        updateColumn: updateKanbanColumnAction,
        reorderColumns: reorderKanbanColumnsAction,
        deleteColumn: deleteKanbanColumnAction,
      }}
    />
  );
}
