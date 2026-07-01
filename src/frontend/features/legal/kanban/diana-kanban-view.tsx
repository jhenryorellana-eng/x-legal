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
 *   - Fila superior: icono del servicio + ULP-… + chip "Con abogado"
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
  type KanbanColumnVM,
  type KanbanColumnActions,
  type KanbanColumnStrings,
} from "@/frontend/features/shared-kanban";

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
  pinnedNote: string | null;
  /** fmtRelative(card.updated_at) — time in column */
  ageLabel: string;
  /** timeTier computed server-side */
  ageTier: "time-ok" | "time-warn" | "time-hot";
}

// ---------------------------------------------------------------------------
// String bag (i18n wired in the RSC page)
// ---------------------------------------------------------------------------

export interface DianaKanbanStrings extends KanbanColumnStrings {
  title: string;
  sub: string;
  emptyCol: string;
  moveError: string;
  noteError: string;
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
  onHoldChip: string;
  cancelledChip: string;
  // empty state
  emptyTitle: string;
  emptyBody: string;
  // inline note placeholder + card chrome
  notePlaceholder: string;
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

  updateNote: (input: {
    cardId: string;
    note: string | null;
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
  strings: DianaKanbanStrings;
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
  strings,
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

  // Inline note editing
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null);
  const [noteValue, setNoteValue] = React.useState("");
  const [noteBusy, setNoteBusy] = React.useState(false);

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
  // Inline note save
  // -------------------------------------------------------------------------

  const saveNote = async (cardId: string) => {
    if (noteBusy) return;
    setNoteBusy(true);
    const note = noteValue.trim() || null;

    // Optimistic
    const prev = cards;
    setCards((cs) => cs.map((c) => c.id === cardId ? { ...c, pinnedNote: note } : c));
    setEditingNoteId(null);

    const res = await actions.updateNote({ cardId, note });
    if (!res.ok) {
      setCards(prev);
      toast.error(strings.noteError);
    }
    setNoteBusy(false);
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
                    editingNoteId={editingNoteId}
                    noteValue={noteValue}
                    strings={strings}
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onStartEditNote={() => {
                      setEditingNoteId(card.id);
                      setNoteValue(card.pinnedNote ?? "");
                    }}
                    onNoteChange={setNoteValue}
                    onNoteBlur={() => saveNote(card.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Column create/edit + delete modals (shared) ── */}
      <ColumnModals cols={cols} strings={strings} />
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
  editingNoteId,
  noteValue,
  strings,
  onDragStart,
  onDragEnd,
  onStartEditNote,
  onNoteChange,
  onNoteBlur,
}: {
  card: CaseCardVM;
  caseHref: string;
  isDragging: boolean;
  editingNoteId: string | null;
  noteValue: string;
  strings: DianaKanbanStrings;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStartEditNote: () => void;
  onNoteChange: (v: string) => void;
  onNoteBlur: () => void;
}) {
  const isEditingNote = editingNoteId === card.id;

  return (
    <div
      className={`kcard${isDragging ? " dragging" : ""}${card.isInactive ? " kcard-inactive" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={card.isInactive ? { opacity: 0.6 } : undefined}
    >
      {/* Left amber rail for RFE in progress */}
      {card.alerts.rfeInProgress && !card.alerts.rfeOverdue && (
        <span className="kcard-uncontacted" title={strings.rfeInProgress} />
      )}

      {/* Row 1: service icon + case number + with_lawyer chip */}
      <div className="kcard-top">
        <div
          className="kcard-src"
          style={{ background: card.serviceColor ? `color-mix(in srgb, ${card.serviceColor} 18%, var(--panel))` : "var(--chip)" }}
          title={card.serviceLabel}
          aria-hidden="true"
        >
          <Icon name={serviceIconName(card.serviceIcon)} size={15} color={card.serviceColor || "var(--ink-2)"} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", flex: "none" }}>
          {card.caseNumber}
        </span>
        {card.withLawyer && (
          <span
            className="kchip"
            style={{
              background: "color-mix(in srgb, var(--brand-gold, #FFC629) 16%, transparent)",
              color: "var(--gold-deep, #b5740b)",
              marginLeft: "auto",
            }}
          >
            {strings.withLawyer}
          </span>
        )}
      </div>

      {/* Row 2: client name */}
      <Link
        href={caseHref}
        className="kcard-name"
        style={{ display: "block", marginBottom: 6, textDecoration: "none" }}
        aria-label={strings.openCaseAria.replace("{caseNumber}", card.caseNumber)}
        onClick={(e) => e.stopPropagation()}
      >
        {card.clientName}
      </Link>

      {/* Row 3: service · phase */}
      <div className="kcard-svc">
        <Icon name={serviceIconName(card.serviceIcon)} size={14} color="var(--brand-gold)" />
        {card.serviceLabel}
        {card.phaseLabel && (
          <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>· {card.phaseLabel}</span>
        )}
      </div>

      {/* Open-case button (explicit affordance, every card) */}
      <Link
        href={caseHref}
        className="vbtn vbtn-ghost vbtn-sm"
        style={{ marginTop: 8, width: "100%", justifyContent: "center", textDecoration: "none" }}
        aria-label={strings.openCaseAria.replace("{caseNumber}", card.caseNumber)}
        onClick={(e) => e.stopPropagation()}
      >
        {strings.openCase}
        <MSym name="arrow_forward" size={15} />
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

      {/* Row 5: pinned note (inline editable) */}
      {isEditingNote ? (
        <textarea
          className="kcard-note-edit"
          rows={2}
          autoFocus
          value={noteValue}
          onChange={(e) => onNoteChange(e.target.value)}
          onBlur={onNoteBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onNoteBlur();
            }
            if (e.key === "Escape") onNoteBlur();
          }}
          style={{
            width: "100%",
            fontSize: 12,
            fontStyle: "italic",
            border: "1px solid var(--accent)",
            borderRadius: 8,
            padding: "4px 8px",
            background: "var(--panel-2, var(--panel))",
            resize: "none",
            marginBottom: 8,
            outline: "none",
          }}
        />
      ) : card.pinnedNote ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStartEditNote(); }}
          style={{
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "text",
            marginBottom: 8,
            display: "flex",
            alignItems: "flex-start",
            gap: 5,
            color: "var(--ink-2)",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          <MSym name="edit" size={13} style={{ marginTop: 1, flex: "none" }} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.pinnedNote}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStartEditNote(); }}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "text",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: "var(--ink-3)",
            fontSize: 12,
          }}
        >
          <MSym name="edit" size={13} />
          <span style={{ fontStyle: "italic" }}>{strings.notePlaceholder}</span>
        </button>
      )}

      {/* Row 6: footer (time-badge + status dot) */}
      <div className="kcard-foot">
        <span
          className={`time-badge ${card.ageTier}`}
          title={strings.timeInColumn}
        >
          {card.ageLabel}
        </span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusDotColor(card.caseStatus),
            flex: "none",
            marginLeft: "auto",
          }}
          aria-label={card.caseStatus}
        />
      </div>
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
