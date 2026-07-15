"use client";

/**
 * Diana — Kanban de casos (`/legal`) · DOC-54 §1 (RF-DIA-001..006, RF-DIA-011).
 *
 * Molde: src/frontend/features/vanessa/leads/leads-view.tsx
 *
 * Columnas semilla (DOC-47 §2.2):
 *   1 Por iniciar (accent) · 2 En progreso (navy) · 3 Esperando cliente (gold)
 *   4 En validación (purple) · 5 Listo (green, is_terminal_won)
 *
 * Tarjeta de caso (DOC-54 §1.3 PROMPT-DIA-01):
 *   - Fila superior: icono del servicio + U26-… + chip "Con abogado"
 *   - Nombre del cliente (bold)
 *   - Línea servicio · fase
 *   - Chips de alerta: por revisar / correcciones del abogado / generación
 *     fallida / RFE vencida
 *   - Nota fijada (inline editable)
 *   - Footer: TimeBadge (antigüedad en columna) + dot estado del caso
 *
 * Drag & drop HTML5 optimista → moveKanbanCardAction → revert + toast ante error.
 * Gestión de columnas (crear/editar/reordenar/eliminar con migración) vive en el
 * módulo compartido `shared-kanban` (useKanbanColumns + ColumnMenu + ColumnModals).
 * Banner "Por revisar" si hay docs pendientes (contador básico).
 *
 * Boundaries rule: este archivo NO importa de @/backend/modules/*.
 * Los VM types se definen aquí; el RSC page los compila y los pasa como props.
 */

import * as React from "react";
import Link from "next/link";
import { MSym } from "@/frontend/features/vanessa/shared/msym";
import { Chip } from "@/frontend/features/vanessa/shared/ui";
import { useToast } from "@/frontend/features/vanessa/shared/toast-bridge";
import { Icon, ICON_NAMES, type IconName } from "@/frontend/components/brand";
import {
  useKanbanColumns,
  ColumnMenu,
  ColumnModals,
  tokenToVar,
  StageCountdownBadge,
  type KanbanColumnVM,
  type KanbanColumnActions,
  type KanbanColumnStrings,
} from "@/frontend/features/shared-kanban";
import { NotesModal, type NoteView, type NoteVisibility, type NotesStrings } from "@/frontend/features/shared-case/notes";
import { LexBoardBubble, type LexBubbleVM } from "@/frontend/features/lex";

// Service icons are configured by the admin from the brand `Icon` set
// (catalog wizard ICON_CHOICES), NOT Material Symbols — render them with the
// same component so the card matches the admin's service editor. Unknown names
// fall back to a neutral document glyph.
const BRAND_ICON_SET = new Set<string>(ICON_NAMES);
function serviceIconName(raw: string | undefined | null): IconName {
  return raw && BRAND_ICON_SET.has(raw) ? (raw as IconName) : "doc";
}

// ---------------------------------------------------------------------------
// VM types (built by the RSC page; no backend imports here)
// ---------------------------------------------------------------------------

/** One column of the board. Uses the shared kanban column VM. */
export type CaseColumnVM = KanbanColumnVM;

/** Alert flags hydrated from backend reads (DOC-54 §1.3). */
export interface CaseAlerts {
  /** count of case_documents.status='uploaded' */
  docsToReview: number;
  /** expedientes.status='corrections_needed' */
  lawyerCorrections: boolean;
  /** ai_generation_runs.status='failed' */
  generationFailed: boolean;
  /** doc rejected with correction_due_at in the past */
  rfeOverdue: boolean;
  /** rfe in progress but not yet overdue — amber left rail */
  rfeInProgress: boolean;
}

/** One kanban card (one assigned case). */
export interface CaseCardVM {
  id: string;
  columnId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  serviceLabel: string;
  serviceIcon: string;
  serviceColor: string;
  phaseLabel: string;
  withLawyer: boolean;
  /** cases.status raw value for the dot */
  caseStatus: string;
  /** on_hold or cancelled → opacity .6 */
  isInactive: boolean;
  alerts: CaseAlerts;
  /** notes visible to the actor for this case (badge count). */
  notesCount: number;
  /** most recent note body (one-line preview), or null. */
  latestNote: string | null;
  /**
   * Deadline (ISO) of the responsible member's current stage — source of the
   * countdown badge (cases.stage_due_at). Null = no countdown (payment_pending /
   * done / stage with no SLA configured).
   */
  stageDueAt: string | null;
}

// ---------------------------------------------------------------------------
// String bag (i18n wired in the RSC page)
// ---------------------------------------------------------------------------

export interface DianaKanbanStrings extends KanbanColumnStrings {
  title: string;
  sub: string;
  emptyCol: string;
  moveError: string;
  // banner
  bannerSingle: string;
  bannerPlural: string;
  bannerCta: string;
  // alerts
  alertDocsToReview: string;
  alertLawyerCorrections: string;
  alertGenerationFailed: string;
  alertRfeOverdue: string;
  // case status dots labels (accessibility)
  statusActive: string;
  statusInValidation: string;
  statusPaymentPending: string;
  statusReady: string;
  statusDelivered: string;
  statusOnHold: string;
  statusCancelled: string;
  withLawyer: string;
  withoutLawyer: string;
  onHoldChip: string;
  cancelledChip: string;
  // empty state
  emptyTitle: string;
  emptyBody: string;
  // note button (per card)
  notesLabel: string;
  addNoteLabel: string;
  rfeInProgress: string;
  timeInColumn: string;
  /** Label of the per-card "open case" button. */
  openCase: string;
  // accessibility (template with {caseNumber})
  openCaseAria: string;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export interface DianaKanbanActions extends KanbanColumnActions {
  moveCard: (input: {
    cardId: string;
    toColumnId: string;
    toPosition: number;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  addNote: (input: {
    caseId: string;
    body: string;
    visibility: NoteVisibility;
  }) => Promise<{ ok: boolean; note?: NoteView; error?: { code: string } }>;

  listNotes: (input: {
    caseId: string;
  }) => Promise<{ ok: boolean; notes?: NoteView[]; error?: { code: string } }>;

  deleteNote: (input: {
    noteId: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DianaKanbanViewProps {
  boardId: string;
  columns: CaseColumnVM[];
  cards: CaseCardVM[];
  /** Total docs-to-review count across all cases (for the banner). */
  totalDocsToReview: number;
  /**
   * Destination of the banner "open queue" CTA (the legal review queue). When
   * omitted (sales / finance boards, which don't review documents) the banner
   * renders without a CTA instead of a dead button.
   */
  reviewQueueHref?: string;
  /** Base path for the per-board "open case" link (legal → "/legal/caso", sales
   *  → "/ventas/clientes"). Href = `${caseBasePath}/${caseId}`. A plain string
   *  (not a function) so it stays serializable across the server→client boundary.
   *  Defaults to the legal workspace. */
  caseBasePath?: string;
  /** When an admin is viewing an employee's board, their name (for the banner). */
  viewingAs?: string | null;
  /** Deterministic Lex insight (P-52-07). Only the legal home board passes it;
   *  the sales/finance reuses of this view leave it null → no bubble. */
  lex?: LexBubbleVM | null;
  strings: DianaKanbanStrings;
  /** Strings for the notes modal (shared with the case tab). */
  notesStrings: NotesStrings;
  locale: "es" | "en";
  actions: DianaKanbanActions;
}

// ---------------------------------------------------------------------------
// Case status → dot color
// ---------------------------------------------------------------------------

function statusDotColor(status: string): string {
  switch (status) {
    case "active": return "var(--accent)";
    case "in_validation": return "#7C3AED";
    case "payment_pending": return "var(--brand-gold, #FFC629)";
    case "ready_for_delivery": return "var(--green)";
    case "delivered":
    case "completed": return "var(--green)";
    case "on_hold":
    case "cancelled": return "var(--ink-3)";
    default: return "var(--ink-3)";
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DianaKanbanView({
  boardId,
  columns: initialColumns,
  cards: initialCards,
  totalDocsToReview,
  reviewQueueHref,
  caseBasePath = "/legal/caso",
  viewingAs,
  lex = null,
  strings,
  notesStrings,
  locale,
  actions,
}: DianaKanbanViewProps) {
  const toast = useToast();
  const buildCaseHref = (id: string) => `${caseBasePath}/${id}`;

  // Card state (columns are owned by the shared hook)
  const [cards, setCards] = React.useState<CaseCardVM[]>(initialCards);
  // Re-sync when the server re-renders (router.refresh after a handoff / case
  // create) so cards appear/disappear without a manual page reload.
  React.useEffect(() => { setCards(initialCards); }, [initialCards]);

  // Column management (create/edit/reorder/delete-with-migration) — shared.
  const cols = useKanbanColumns({
    boardId,
    initialColumns,
    actions,
    strings,
    toast,
    countCardsIn: (columnId) => cards.filter((c) => c.columnId === columnId).length,
    onColumnDeleted: (columnId, migrateToColumnId) => {
      if (!migrateToColumnId) return;
      setCards((cs) => cs.map((c) => (c.columnId === columnId ? { ...c, columnId: migrateToColumnId } : c)));
    },
  });

  // Card drag & drop
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);

  // Notes modal (per card)
  const [notesCard, setNotesCard] = React.useState<CaseCardVM | null>(null);

  // -------------------------------------------------------------------------
  // Card drag & drop handlers
  // -------------------------------------------------------------------------

  const handleDrop = async (col: CaseColumnVM) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;

    const card = cards.find((c) => c.id === id);
    if (!card || card.columnId === col.id) return;

    // Drop at the end of the destination column (positions are 1-indexed; the
    // backend re-packs gaps). Counting the cards already there gives the slot.
    const toPosition = cards.filter((c) => c.columnId === col.id).length + 1;

    // Optimistic update
    const prev = cards;
    setCards((cs) => cs.map((c) => c.id === id ? { ...c, columnId: col.id } : c));

    const res = await actions.moveCard({ cardId: id, toColumnId: col.id, toPosition });
    if (!res.ok) {
      setCards(prev);
      toast.error(strings.moveError);
    }
  };

  // -------------------------------------------------------------------------
  // Notes modal — keep the card badge (count + latest preview) in sync
  // -------------------------------------------------------------------------

  const patchCardNotes = (caseId: string, fn: (c: CaseCardVM) => CaseCardVM) =>
    setCards((cs) => cs.map((c) => (c.caseId === caseId ? fn(c) : c)));

  const handleAddNote = async (caseId: string, body: string, visibility: NoteVisibility): Promise<NoteView | null> => {
    const res = await actions.addNote({ caseId, body, visibility });
    if (res.ok && res.note) {
      patchCardNotes(caseId, (c) => ({ ...c, notesCount: c.notesCount + 1, latestNote: res.note!.body }));
      return res.note;
    }
    return null;
  };

  const handleDeleteNote = async (caseId: string, noteId: string): Promise<boolean> => {
    const res = await actions.deleteNote({ noteId });
    if (res.ok) {
      patchCardNotes(caseId, (c) => ({ ...c, notesCount: Math.max(0, c.notesCount - 1) }));
    }
    return res.ok;
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const sortedColumns = cols.columns;
  const alertCount = cards.filter((c) => c.alerts.docsToReview > 0 || c.alerts.lawyerCorrections || c.alerts.generationFailed || c.alerts.rfeOverdue).length;

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* ── View header ── */}
      <div className="v-head" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">
            {strings.sub.replace("{alerts}", String(alertCount))}
          </div>
        </div>
        <button
          type="button"
          className="vbtn vbtn-ghost vbtn-sm"
          onClick={cols.openCreate}
        >
          <MSym name="add" size={18} />
          {strings.newColumn}
        </button>
      </div>

      {/* ── Lex proactive insight (deterministic — P-52-07) ── */}
      <LexBoardBubble vm={lex} />

      {/* ── "Viewing as" banner (admin sees an employee's board) ── */}
      {viewingAs && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 14,
            padding: "9px 14px",
            borderRadius: 12,
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 28%, transparent)",
            color: "var(--accent)",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <MSym name="visibility" size={17} />
          {locale === "en"
            ? `Viewing ${viewingAs}'s board`
            : `Viendo el tablero de ${viewingAs}`}
        </div>
      )}

      {/* ── Banner "Por revisar" (DOC-54 §1.6) ── */}
      {totalDocsToReview > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--blue-soft)",
            border: "1px solid var(--line)",
            borderRadius: 14,
            padding: "10px 16px",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: "var(--accent)",
              display: "grid",
              placeItems: "center",
              flex: "none",
            }}
          >
            <MSym name="fact_check" size={18} color="#fff" />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", flex: 1 }}>
            {(totalDocsToReview === 1 ? strings.bannerSingle : strings.bannerPlural).replace(
              "{n}",
              String(totalDocsToReview),
            )}
          </span>
          {/* Review queue (DOC-54 §1.6) — the global "por revisar" page lists every
              uploaded document across the owner's cases. Only the legal board
              passes a target; other boards show the banner without a CTA. */}
          {reviewQueueHref && (
            <Link href={reviewQueueHref} className="vbtn vbtn-ghost vbtn-sm">
              {strings.bannerCta}
            </Link>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {cards.length === 0 && sortedColumns.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 12,
            padding: "60px 0",
            color: "var(--ink-3)",
          }}
        >
          <MSym name="view_kanban" size={52} color="var(--ink-3)" />
          <div style={{ fontWeight: 800, fontSize: 16 }}>{strings.emptyTitle}</div>
          <div style={{ fontSize: 13, textAlign: "center", maxWidth: 340 }}>{strings.emptyBody}</div>
        </div>
      )}

      {/* ── Board ── */}
      <div className="kanban">
        {sortedColumns.map((col, colIdx) => {
          const colCards = cards.filter((c) => c.columnId === col.id);

          return (
            <div
              className="kcol"
              key={col.id}
              style={
                cols.colOverId === col.id && cols.colDragId && cols.colDragId !== col.id
                  ? { outline: "2px dashed var(--accent)", outlineOffset: 2, borderRadius: 12 }
                  : undefined
              }
            >
              {/* Column header — drag to reorder columns (RF-DIA-004) */}
              <div
                className={`kcol-head${cols.colDragId === col.id ? " dragging" : ""}`}
                draggable
                onDragStart={(e) => { cols.setColDragId(col.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { cols.setColDragId(null); cols.setColOverId(null); }}
                onDragOver={(e) => { if (cols.colDragId) { e.preventDefault(); cols.setColOverId(col.id); } }}
                onDrop={() => { if (cols.colDragId) cols.handleColReorder(col); }}
                style={{ cursor: "grab" }}
              >
                <span className="kcol-dot" style={{ background: tokenToVar(col.color) }} />
                <span className="kcol-title">{col.title}</span>
                <span className="kcol-count">{colCards.length}</span>
                <ColumnMenu
                  col={col}
                  isLast={sortedColumns.length <= 1}
                  canMoveLeft={colIdx > 0}
                  canMoveRight={colIdx < sortedColumns.length - 1}
                  onMoveLeft={() => cols.moveColumn(col, "left")}
                  onMoveRight={() => cols.moveColumn(col, "right")}
                  onEdit={() => cols.openEdit(col)}
                  onDelete={() => cols.openDelete(col)}
                  strings={strings}
                />
              </div>

              {/* Drop zone (card drops only — guarded against column drags) */}
              <div
                className={`kcol-body${overCol === col.id ? " dragover" : ""}`}
                onDragOver={(e) => { if (!cols.colDragId) { e.preventDefault(); setOverCol(col.id); } }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
                onDrop={() => { if (!cols.colDragId) handleDrop(col); }}
              >
                {colCards.length === 0 && (
                  <div className="kcol-empty">{strings.emptyCol}</div>
                )}

                {colCards.map((card) => (
                  <CaseCard
                    key={card.id}
                    card={card}
                    caseHref={buildCaseHref(card.caseId)}
                    isDragging={dragId === card.id}
                    strings={strings}
                    locale={locale}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onOpenNotes={() => setNotesCard(card)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Column create/edit + delete modals (shared) ── */}
      <ColumnModals cols={cols} strings={strings} />

      {/* ── Notes modal (per card) ── */}
      {notesCard && (
        <NotesModal
          open={!!notesCard}
          onOpenChange={(o) => !o && setNotesCard(null)}
          title={notesCard.clientName}
          subtitle={notesCard.caseNumber}
          strings={notesStrings}
          locale={locale}
          onLoad={async () => {
            const res = await actions.listNotes({ caseId: notesCard.caseId });
            return res.ok && res.notes ? res.notes : [];
          }}
          onAdd={(body, visibility) => handleAddNote(notesCard.caseId, body, visibility)}
          onRemove={(noteId) => handleDeleteNote(notesCard.caseId, noteId)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CaseCard sub-component
// ---------------------------------------------------------------------------

function CaseCard({
  card,
  caseHref,
  isDragging,
  strings,
  locale,
  onDragStart,
  onDragEnd,
  onOpenNotes,
}: {
  card: CaseCardVM;
  caseHref: string;
  isDragging: boolean;
  strings: DianaKanbanStrings;
  locale: "es" | "en";
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpenNotes: () => void;
}) {

  const statusColor = statusDotColor(card.caseStatus);
  const railColor =
    card.alerts.rfeInProgress && !card.alerts.rfeOverdue ? "#f59e0b" : statusColor;
  const initial = card.clientName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div
      className={`kcard${isDragging ? " dragging" : ""}${card.isInactive ? " kcard-inactive" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{ paddingLeft: 15, ...(card.isInactive ? { opacity: 0.6 } : null) }}
    >
      {/* Left status rail — amber while an RFE is in progress */}
      <span
        aria-hidden="true"
        title={card.alerts.rfeInProgress ? strings.rfeInProgress : undefined}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 3,
          height: "100%",
          borderRadius: "13px 0 0 13px",
          background: railColor,
        }}
      />

      {/* Eyebrow: case number */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "0.02em",
            color: "var(--ink-3)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {card.caseNumber}
        </span>
      </div>

      {/* Client identity — the card's anchor (monogram tinted by the service colour) */}
      <Link
        href={caseHref}
        style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", marginBottom: 10 }}
        aria-label={strings.openCaseAria.replace("{caseNumber}", card.caseNumber)}
        onClick={(e) => e.stopPropagation()}
      >
        <span
          aria-hidden="true"
          style={{
            width: 38,
            height: 38,
            borderRadius: 999,
            flex: "none",
            display: "grid",
            placeItems: "center",
            fontFamily: "var(--font-title)",
            fontWeight: 900,
            fontSize: 16,
            background: card.serviceColor
              ? `color-mix(in srgb, ${card.serviceColor} 15%, var(--panel))`
              : "var(--chip)",
            color: card.serviceColor || "var(--ink-2)",
            boxShadow: card.serviceColor
              ? `inset 0 0 0 1px color-mix(in srgb, ${card.serviceColor} 28%, transparent)`
              : "none",
          }}
        >
          {initial}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="kcard-name" style={{ display: "block", fontSize: 15, lineHeight: 1.25 }}>
            {card.clientName}
          </span>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              marginTop: 2,
              fontSize: 11.5,
              fontWeight: 700,
              color: "var(--ink-2)",
              minWidth: 0,
            }}
          >
            <Icon name={serviceIconName(card.serviceIcon)} size={13} color={card.serviceColor || "var(--ink-3)"} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {card.serviceLabel}
              {card.phaseLabel && (
                <span style={{ color: "var(--ink-3)", fontWeight: 600 }}> · {card.phaseLabel}</span>
              )}
            </span>
          </span>
        </span>
      </Link>

      {/* Row 4: alert chips */}
      <AlertChips card={card} strings={strings} />

      {/* Inactive chips */}
      {card.caseStatus === "on_hold" && (
        <Chip tone="neutral" style={{ height: 22, fontSize: 11, marginBottom: 8 }}>
          {strings.onHoldChip}
        </Chip>
      )}
      {card.caseStatus === "cancelled" && (
        <Chip tone="neutral" style={{ height: 22, fontSize: 11, marginBottom: 8 }}>
          {strings.cancelledChip}
        </Chip>
      )}

      {/* Row 5: notes button (count + latest preview) → opens the notes modal */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpenNotes(); }}
        title={card.notesCount > 0 ? strings.notesLabel : strings.addNoteLabel}
        style={{
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 5,
          color: card.notesCount > 0 ? "var(--ink-2)" : "var(--ink-3)",
          fontSize: 12,
        }}
      >
        <MSym name="edit" size={13} style={{ flex: "none" }} />
        {card.notesCount > 0 ? (
          <>
            <span
              style={{
                flex: "none",
                minWidth: 16,
                height: 16,
                padding: "0 4px",
                borderRadius: 999,
                background: "var(--accent)",
                color: "#fff",
                fontSize: 10,
                fontWeight: 800,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {card.notesCount}
            </span>
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: "italic" }}>
              {card.latestNote ?? strings.notesLabel}
            </span>
          </>
        ) : (
          <span style={{ fontStyle: "italic" }}>{strings.addNoteLabel}</span>
        )}
      </button>

      {/* Footer: stage countdown + plan-type pill (con/sin abogado), above the CTA */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingTop: 9,
          marginTop: 2,
          borderTop: "1px solid var(--line)",
        }}
      >
        <StageCountdownBadge dueAt={card.stageDueAt} locale={locale} />
        <span
          aria-label={card.withLawyer ? strings.withLawyer : strings.withoutLawyer}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 22,
            padding: "0 9px 0 7px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 800,
            color: card.withLawyer ? "var(--gold-deep, #b5740b)" : "var(--ink-3)",
            background: card.withLawyer
              ? "color-mix(in srgb, var(--brand-gold, #FFC629) 16%, transparent)"
              : "color-mix(in srgb, var(--ink-3) 12%, transparent)",
          }}
        >
          <MSym name={card.withLawyer ? "balance" : "person"} size={13} />
          {card.withLawyer ? strings.withLawyer : strings.withoutLawyer}
        </span>
      </div>

      {/* Open-case CTA */}
      <Link
        href={caseHref}
        className="vbtn vbtn-ghost vbtn-sm"
        style={{ marginTop: 10, width: "100%", justifyContent: "center", textDecoration: "none" }}
        aria-label={strings.openCaseAria.replace("{caseNumber}", card.caseNumber)}
        onClick={(e) => e.stopPropagation()}
      >
        {strings.openCase}
        <MSym name="arrow_forward" size={15} />
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AlertChips sub-component (DOC-54 §1.3 row 4)
// ---------------------------------------------------------------------------

function AlertChips({ card, strings }: { card: CaseCardVM; strings: DianaKanbanStrings }) {
  const chips: React.ReactNode[] = [];

  if (card.alerts.docsToReview > 0) {
    chips.push(
      <span
        key="docs"
        className="kchip"
        style={{ background: "var(--blue-soft)", color: "var(--accent)", marginRight: 4, marginBottom: 4 }}
      >
        <MSym name="fact_check" size={13} />
        {strings.alertDocsToReview.replace("{n}", String(card.alerts.docsToReview))}
      </span>,
    );
  }

  if (card.alerts.lawyerCorrections) {
    chips.push(
      <span
        key="lawyer"
        className="kchip"
        style={{ background: "var(--red-soft)", color: "var(--red)", marginRight: 4, marginBottom: 4 }}
      >
        <MSym name="balance" size={13} />
        {strings.alertLawyerCorrections}
      </span>,
    );
  }

  if (card.alerts.generationFailed) {
    chips.push(
      <span
        key="genfail"
        className="kchip"
        style={{ background: "var(--red-soft)", color: "var(--red)", marginRight: 4, marginBottom: 4 }}
      >
        <MSym name="error_outline" size={13} />
        {strings.alertGenerationFailed}
      </span>,
    );
  }

  if (card.alerts.rfeOverdue) {
    chips.push(
      <span
        key="rfe"
        className="kchip"
        style={{ background: "var(--red-soft)", color: "var(--red)", marginRight: 4, marginBottom: 4, animation: "vblink 1.4s ease-in-out infinite" }}
      >
        <MSym name="schedule" size={13} />
        {strings.alertRfeOverdue}
      </span>,
    );
  }

  if (chips.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 8 }}>
      {chips}
    </div>
  );
}
