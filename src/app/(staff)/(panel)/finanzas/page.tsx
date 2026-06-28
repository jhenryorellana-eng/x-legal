/**
 * Kanban de cobranza — /finanzas (DOC-55 §1, RF-AND-001..006, RF-AND-044).
 *
 * Server Component:
 *   1. Guards actor (staff + collections:view).
 *   2. getBoard(actor, { kind: 'collections' }) → lazy-init con 5 columnas semilla.
 *   3. listCasesAdmin(actor) → hydrates each card with case data.
 *   4. getCollectionMetrics → KPI strip (collected month + real month-over-month
 *      trend, on-time %, overdue). API-BIL-17.
 *   5. Per-card collection line is hydrated from the billing/expediente reads
 *      (listOverdueForCollections, listDueCalendar, listPrintQueue), keyed by case.
 *   6. Injects server actions and passes serialisable VM to the client component.
 *
 * Permissions: collections (view to load, edit to move/manage); KPIs: metrics|billing view.
 * RFs covered: RF-AND-001, 002, 003, 004, 005, 006 (+044 via KPI strip).
 */

import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor, can } from "@/backend/modules/identity";
import { getBoard } from "@/backend/modules/kanban";
import { listCasesAdmin } from "@/backend/modules/cases";
import type { AdminCaseListItem } from "@/backend/modules/cases";
import {
  getCollectionMetrics,
  listDueCalendar,
  listOverdueForCollections,
} from "@/backend/modules/billing";
import { listPrintQueue } from "@/backend/modules/expediente";
import { resolveI18n } from "@/shared/i18n";
import type { Locale } from "@/shared/i18n";
import { fmtRelative } from "@/frontend/lib/datetime";
import type {
  CollectionCardVM,
  CollectionColumnVM,
  CollectionKpiVM,
  CobranzaKanbanStrings,
} from "@/frontend/features/andrium/cobranza/cobranza-kanban-view";
import { CobranzaKanbanView } from "@/frontend/features/andrium/cobranza/cobranza-kanban-view";
import {
  moveKanbanCardAction,
  updateKanbanCardNoteAction,
  createKanbanColumnAction,
  updateKanbanColumnAction,
  reorderKanbanColumnsAction,
  deleteKanbanColumnAction,
  remindInstallmentAction,
} from "./actions";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Seed column label matching — resolves card kind from column label (DOC-47 §3.8)
// Case/accent-insensitive match against canonical seed labels.
// ---------------------------------------------------------------------------

type SeedLabelKey = "initial" | "overdue" | "print" | "done" | "upcoming";

const SEED_LABELS: Record<SeedLabelKey, string[]> = {
  initial: ["por cobrar inicial"],
  upcoming: ["cuotas por vencer"],
  overdue: ["vencidas"],
  print: ["por imprimir"],
  done: ["hecho"],
};

function resolveCardKind(
  columnLabel: string,
): CollectionCardVM["cardKind"] {
  const lower = columnLabel.toLowerCase().trim();
  for (const [kind, variants] of Object.entries(SEED_LABELS)) {
    if (variants.some((v) => lower === v)) {
      if (kind === "initial") return "initial";
      if (kind === "overdue") return "overdue";
      if (kind === "print") return "print";
      if (kind === "done") return "done";
    }
  }
  return "generic";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function FinanzasPage() {
  // ── Auth gate ────────────────────────────────────────────────────────────
  const actor = await getActor();
  if (!actor || actor.kind !== "staff") redirect("/login");

  // Check collections:view permission
  try {
    can(actor, "collections", "view");
  } catch {
    // Fallback: check billing:view (finanzas panel gate)
    try {
      can(actor, "billing", "view");
    } catch {
      redirect("/admin");
    }
  }

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("staff.finanzas.cobranza");

  // ── Board + hydration data ───────────────────────────────────────────────
  let board: Awaited<ReturnType<typeof getBoard>> | null = null;
  let boardError = false;
  let allCases: AdminCaseListItem[] = [];
  let metrics: Awaited<ReturnType<typeof getCollectionMetrics>> | null = null;

  // Per-case hydration maps (reuse the billing/expediente collection reads).
  const overdueByCase = new Map<string, { amountCents: number; daysLate: number; installmentId: string }>();
  const downpaymentByCase = new Map<string, { amountCents: number; installmentId: string }>();
  const printByCase = new Map<string, { attemptNo: number; pageCount: number | null }>();

  const nowDate = new Date();
  const todayStr = nowDate.toISOString().split("T")[0];
  const monthStr = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;

  try {
    board = await getBoard(actor, { kind: "collections" });

    // Hydration reads (best-effort; each degrades independently).
    const from = new Date(nowDate.getFullYear() - 1, nowDate.getMonth(), nowDate.getDate())
      .toISOString().split("T")[0];
    const to = new Date(nowDate.getFullYear() + 1, nowDate.getMonth(), nowDate.getDate())
      .toISOString().split("T")[0];

    const [casesRes, metricsRes, overdueRes, calendarRes, printRes] = await Promise.allSettled([
      listCasesAdmin(actor, { limit: 500 }),
      getCollectionMetrics(actor, todayStr, monthStr),
      listOverdueForCollections(actor),
      listDueCalendar(actor, { from, to }),
      listPrintQueue(actor, {}),
    ]);

    if (casesRes.status === "fulfilled") allCases = casesRes.value.items ?? [];
    if (metricsRes.status === "fulfilled") metrics = metricsRes.value;
    if (overdueRes.status === "fulfilled") {
      for (const o of overdueRes.value) {
        const cur = overdueByCase.get(o.caseId);
        // Keep the most-overdue installment per case for the card line.
        if (!cur || o.daysLate > cur.daysLate) {
          overdueByCase.set(o.caseId, { amountCents: o.amountCents, daysLate: o.daysLate, installmentId: o.installmentId });
        }
      }
    }
    if (calendarRes.status === "fulfilled") {
      for (const i of calendarRes.value) {
        if (i.isDownpayment && (i.status === "pending" || i.status === "overdue" || i.status === "processing")) {
          downpaymentByCase.set(i.caseId, { amountCents: i.amountCents, installmentId: i.installmentId });
        }
      }
    }
    if (printRes.status === "fulfilled") {
      for (const p of printRes.value) {
        if (p.status === "sent_to_finance") {
          printByCase.set(p.caseId, { attemptNo: p.attemptNo, pageCount: p.pageCount });
        }
      }
    }
  } catch (err) {
    console.error("[/finanzas] board load failed:", err);
    boardError = true;
  }

  function usd(cents: number): string {
    return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  // ── Columns VM ───────────────────────────────────────────────────────────
  const columnVMs: CollectionColumnVM[] = (board?.columns ?? [])
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

  // Build column label map for card kind resolution
  const columnLabelMap = new Map<string, string>(
    (board?.columns ?? []).map((c) => [c.id, c.label]),
  );

  // ── Hydration: case map by id ─────────────────────────────────────────────
  const caseMap = new Map<string, AdminCaseListItem>(
    allCases.map((c) => [c.id, c]),
  );

  // ── Cards VM ─────────────────────────────────────────────────────────────
  const now = new Date();

  const cardVMs: CollectionCardVM[] = (board?.cards ?? [])
    .filter((card) => card.ref_type === "case")
    .map((card) => {
      const caseItem = caseMap.get(card.ref_id);
      const colLabel = columnLabelMap.get(card.column_id) ?? "";
      const cardKind = resolveCardKind(colLabel);

      const serviceLabel = resolveI18n(caseItem?.serviceLabelI18n, locale as "es" | "en");

      // Collection cards use the brand accent for the service chip (the cobranza
      // board is service-agnostic; per-service colour is intentionally not surfaced here).
      const serviceColor = "var(--accent)";

      // Age in column
      const ageFrom = card.updated_at ?? card.created_at ?? now.toISOString();
      const ageLabel = fmtRelative(ageFrom, locale as "es" | "en");
      const minutesInCol = (now.getTime() - new Date(ageFrom).getTime()) / 60_000;
      const ageTier: CollectionCardVM["ageTier"] =
        minutesInCol > 60 * 48 ? "time-hot" :
        minutesInCol > 60 * 24 ? "time-warn" :
        "time-ok";

      // ── Collection line per card kind (hydrated from the billing/expediente
      // collection reads, keyed by case) ─────────────────────────────────────
      let collectionLine = "";
      let daysLate = 0;
      let attemptNo = 1;
      let statusChip: string | null = null;
      let reminderInstallmentId: string | null = null;

      if (cardKind === "initial") {
        const dp = downpaymentByCase.get(card.ref_id);
        collectionLine = t.raw("lineInitial").replace("{monto}", dp != null ? usd(dp.amountCents) : "—");
        statusChip = t("chipPending");
        reminderInstallmentId = dp?.installmentId ?? null;
      } else if (cardKind === "overdue") {
        const ov = overdueByCase.get(card.ref_id);
        daysLate = ov?.daysLate ?? 0;
        collectionLine = t.raw("lineOverdue")
          .replace("{monto}", ov ? usd(ov.amountCents) : "—")
          .replace("{n}", String(daysLate));
        reminderInstallmentId = ov?.installmentId ?? null;
      } else if (cardKind === "print") {
        const pr = printByCase.get(card.ref_id);
        attemptNo = pr?.attemptNo ?? 1;
        collectionLine = t.raw("linePrint")
          .replace("{n}", String(attemptNo))
          .replace("{p}", pr?.pageCount != null ? String(pr.pageCount) : "—");
      } else {
        collectionLine = "";
      }

      return {
        id: card.id,
        columnId: card.column_id,
        caseId: card.ref_id,
        caseNumber: caseItem?.caseNumber ?? card.ref_id.slice(0, 8).toUpperCase(),
        clientName: caseItem?.clientName ?? "—",
        serviceLabel: serviceLabel || "—",
        serviceColor,
        cardKind,
        collectionLine,
        daysLate,
        attemptNo,
        statusChip,
        pinnedNote: card.pinned_note ?? null,
        ageLabel,
        ageTier,
        reminderInstallmentId,
      };
    });

  // Month-over-month delta for the collected KPI (no baseline → honest em-dash).
  function pctDelta(curr: number, prev: number): { label: string; up: boolean } {
    if (prev <= 0) return { label: "—", up: true };
    const d = Math.round(((curr - prev) / prev) * 100);
    return { label: `${d >= 0 ? "+" : ""}${d}%`, up: d >= 0 };
  }

  // ── KPI strip (API-BIL-17 getCollectionMetrics) ──────────────────────────
  const collectedTrend = metrics
    ? pctDelta(metrics.collectedMonthCents, metrics.collectedPrevMonthCents)
    : { label: "—", up: true };

  const kpi: CollectionKpiVM = metrics
    ? {
        collectedMonth: usd(metrics.collectedMonthCents),
        collectedTrend: collectedTrend.label,
        collectedTrendUp: collectedTrend.up,
        onTimePct: `${Math.round(metrics.onTimePct)}%`,
        // On-time % has no monthly snapshot to compare against — left as a neutral mark.
        onTimeTrend: "—",
        onTimeTrendUp: true,
        overdueLabel: usd(metrics.overdue.montoCents),
        overdueCount: metrics.overdue.cuotas,
        printCount: printByCase.size,
      }
    : {
        collectedMonth: "$—",
        collectedTrend: "—",
        collectedTrendUp: true,
        onTimePct: "—%",
        onTimeTrend: "—",
        onTimeTrendUp: true,
        overdueLabel: "—",
        overdueCount: cardVMs.filter((c) => c.cardKind === "overdue").length,
        printCount: cardVMs.filter((c) => c.cardKind === "print").length,
      };

  // ── i18n strings ─────────────────────────────────────────────────────────
  const strings: CobranzaKanbanStrings = {
    title: t("title"),
    manageColumns: t("manageColumns"),
    newColumn: t("newColumn"),
    emptyCol: t("emptyCol"),
    moveError: t("moveError"),
    noteError: t("noteError"),
    orderError: t("orderError"),
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
    delSeedWarning: t("delSeedWarning"),
    actionCollect: t("actionCollect"),
    actionRemind: t("actionRemind"),
    actionView: t("actionView"),
    notePlaceholder: t("notePlaceholder"),
    chipPending: t("chipPending"),
    chipDone: t("chipDone"),
    emptyTitle: t("emptyTitle"),
    emptyBody: t("emptyBody"),
    kpiCollectedMonth: t("kpiCollectedMonth"),
    kpiOnTime: t("kpiOnTime"),
    kpiOverdue: t("kpiOverdue"),
    kpiPrint: t("kpiPrint"),
    toastColDeleted: t.raw("toastColDeleted"),
    loadError: t("loadError"),
    retry: t("retry"),
  };

  // ── Error state (non-500) ────────────────────────────────────────────────
  if (boardError) {
    return (
      <div style={{ padding: "54px 32px", maxWidth: 480 }}>
        <p style={{ color: "var(--red)", fontWeight: 700 }}>{t("loadError")}</p>
        <a href="/finanzas" style={{ color: "var(--accent)", fontWeight: 700 }}>{t("retry")}</a>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <CobranzaKanbanView
      boardId={board?.board.id ?? ""}
      columns={columnVMs}
      cards={cardVMs}
      kpi={kpi}
      strings={strings}
      actions={{
        moveCard: moveKanbanCardAction,
        updateNote: updateKanbanCardNoteAction,
        createColumn: createKanbanColumnAction,
        updateColumn: updateKanbanColumnAction,
        reorderColumns: reorderKanbanColumnsAction,
        deleteColumn: deleteKanbanColumnAction,
        remindInstallment: remindInstallmentAction,
      }}
    />
  );
}
