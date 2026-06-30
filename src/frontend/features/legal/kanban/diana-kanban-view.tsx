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
 * Gestión de columnas (Nueva/Editar/Eliminar con migración) idéntica al molde.
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
import { Modal } from "@/frontend/components/desktop";

// ---------------------------------------------------------------------------
// VM types (built by the RSC page; no backend imports here)
// ---------------------------------------------------------------------------

/** One column of the board. */
export interface CaseColumnVM {
  id: string;
  boardId: string;
  title: string;
  color: string;
  isTerminalWon: boolean;
  position: number;
}

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

export interface DianaKanbanStrings {
  title: string;
  sub: string;
  newColumn: string;
  emptyCol: string;
  moveError: string;
  noteError: string;
  orderError: string;
  deleteError: string;
  createError: string;
  editError: string;
  // banner
  bannerSingle: string;
  bannerPlural: string;
  bannerCta: string;
  // column modal
  colModalCreateTitle: string;
  colModalEditTitle: string;
  colNameLabel: string;
  colNamePh: string;
  colNameRequired: string;
  colColorLabel: string;
  colSave: string;
  colCancel: string;
  // delete column modal
  delModalTitle: string;
  delModalBodyEmpty: string;
  delModalBodyCards: string;
  delMigrateLabel: string;
  delConfirm: string;
  delCancel: string;
  delLastColumn: string;
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
  // column menu
  colMenuEdit: string;
  colMenuDelete: string;
  colMenuMoveLeft: string;
  colMenuMoveRight: string;
  /** Label of the per-card "open case" button. */
  openCase: string;
  // accessibility (templates with {title}/{caseNumber})
  colMenuAria: string;
  openCaseAria: string;
}

// ---------------------------------------------------------------------------
// Action types
// ---------------------------------------------------------------------------

export interface DianaKanbanActions {
  moveCard: (input: {
    cardId: string;
    toColumnId: string;
    toPosition: number;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  updateNote: (input: {
    cardId: string;
    note: string | null;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  createColumn: (input: {
    boardId: string;
    label: string;
    color: string;
  }) => Promise<{ ok: boolean; columnId?: string; error?: { code: string } }>;

  updateColumn: (input: {
    columnId: string;
    label?: string;
    color?: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  reorderColumns: (input: {
    boardId: string;
    orderedColumnIds: string[];
  }) => Promise<{ ok: boolean; error?: { code: string } }>;

  deleteColumn: (input: {
    columnId: string;
    migrateToColumnId?: string;
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
// Token color → CSS var mapping (DOC-47 §2.2)
// ---------------------------------------------------------------------------

const COLOR_TOKEN: Record<string, string> = {
  accent: "var(--accent)",
  navy: "var(--brand-navy, #1B2B5E)",
  gold: "var(--brand-gold, #FFC629)",
  purple: "#7C3AED",
  green: "var(--green)",
  red: "var(--red)",
};

function tokenToVar(token: string) {
  return COLOR_TOKEN[token] ?? token;
}

const COLOR_SWATCHES = ["accent", "navy", "gold", "green", "red", "purple"] as const;

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
// Column manager modal state
// ---------------------------------------------------------------------------

type ColModalMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; columnId: string; label: string; color: string }
  | { kind: "delete"; columnId: string; label: string; cardCount: number };

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

  // Board state
  const [columns, setColumns] = React.useState<CaseColumnVM[]>(initialColumns);
  const [cards, setCards] = React.useState<CaseCardVM[]>(initialCards);
  // Re-sync when the server re-renders (router.refresh after a handoff / case
  // create) so cards appear/disappear without a manual page reload.
  React.useEffect(() => { setCards(initialCards); }, [initialCards]);
  React.useEffect(() => { setColumns(initialColumns); }, [initialColumns]);

  // Card drag & drop
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);

  // Column drag & drop (reorder). Kept separate from card drag so the two never
  // interfere (a column drag must not trigger a card drop and vice-versa).
  const [colDragId, setColDragId] = React.useState<string | null>(null);
  const [colOverId, setColOverId] = React.useState<string | null>(null);

  // Column manager modal
  const [colModal, setColModal] = React.useState<ColModalMode>({ kind: "closed" });
  const [colLabel, setColLabel] = React.useState("");
  const [colColor, setColColor] = React.useState("accent");
  const [colLabelError, setColLabelError] = React.useState("");
  const [colBusy, setColBusy] = React.useState(false);

  // Delete column — migration target
  const [migrateTarget, setMigrateTarget] = React.useState("");

  // Inline note editing
  const [editingNoteId, setEditingNoteId] = React.useState<string | null>(null);
  const [noteValue, setNoteValue] = React.useState("");
  const [noteBusy, setNoteBusy] = React.useState(false);

  // -------------------------------------------------------------------------
  // Drag & drop handlers
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
  // Column reorder (drag the column header)
  // -------------------------------------------------------------------------

  const handleColReorder = async (targetCol: CaseColumnVM) => {
    const srcId = colDragId;
    setColDragId(null);
    setColOverId(null);
    if (!srcId || srcId === targetCol.id) return;

    const ordered = [...columns].sort((a, b) => a.position - b.position);
    const srcIdx = ordered.findIndex((c) => c.id === srcId);
    const tgtIdx = ordered.findIndex((c) => c.id === targetCol.id);
    if (srcIdx < 0 || tgtIdx < 0) return;

    const prev = columns;
    const next = [...ordered];
    const [moved] = next.splice(srcIdx, 1);
    next.splice(tgtIdx, 0, moved);
    const repositioned = next.map((c, i) => ({ ...c, position: i + 1 }));

    // Optimistic reorder; revert on error.
    setColumns(repositioned);
    const res = await actions.reorderColumns({
      boardId,
      orderedColumnIds: repositioned.map((c) => c.id),
    });
    if (!res.ok) {
      setColumns(prev);
      toast.error(strings.orderError);
    }
  };

  // Keyboard/pointer-accessible reorder (WCAG 2.1.1 alternative to the drag):
  // swap a column with its left/right neighbour from the column menu.
  const moveColumn = async (col: CaseColumnVM, dir: "left" | "right") => {
    const ordered = [...columns].sort((a, b) => a.position - b.position);
    const idx = ordered.findIndex((c) => c.id === col.id);
    const swapIdx = dir === "left" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;

    const prev = columns;
    const next = [...ordered];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const repositioned = next.map((c, i) => ({ ...c, position: i + 1 }));

    setColumns(repositioned);
    const res = await actions.reorderColumns({
      boardId,
      orderedColumnIds: repositioned.map((c) => c.id),
    });
    if (!res.ok) {
      setColumns(prev);
      toast.error(strings.orderError);
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
  // Column modal helpers
  // -------------------------------------------------------------------------

  function openCreate() {
    setColLabel("");
    setColColor("accent");
    setColLabelError("");
    setColModal({ kind: "create" });
  }

  function openEdit(col: CaseColumnVM) {
    setColLabel(col.title);
    setColColor(col.color);
    setColLabelError("");
    setColModal({ kind: "edit", columnId: col.id, label: col.title, color: col.color });
  }

  function openDelete(col: CaseColumnVM) {
    const colCards = cards.filter((c) => c.columnId === col.id);
    const otherCols = columns.filter((c) => c.id !== col.id);
    setMigrateTarget(otherCols[0]?.id ?? "");
    setColModal({ kind: "delete", columnId: col.id, label: col.title, cardCount: colCards.length });
  }

  async function handleColSave() {
    if (!colLabel.trim()) {
      setColLabelError(strings.colNameRequired);
      return;
    }
    setColLabelError("");
    setColBusy(true);

    if (colModal.kind === "create") {
      const res = await actions.createColumn({ boardId, label: colLabel.trim(), color: colColor });
      if (!res.ok) {
        toast.error(strings.createError);
      } else {
        // Add optimistic column at end
        const newCol: CaseColumnVM = {
          id: res.columnId ?? `tmp-${Date.now()}`,
          boardId,
          title: colLabel.trim(),
          color: colColor,
          isTerminalWon: false,
          position: (columns[columns.length - 1]?.position ?? 0) + 1,
        };
        setColumns((cols) => [...cols, newCol]);
      }
    } else if (colModal.kind === "edit") {
      const { columnId } = colModal;
      const res = await actions.updateColumn({ columnId, label: colLabel.trim(), color: colColor });
      if (!res.ok) {
        toast.error(strings.editError);
      } else {
        setColumns((cols) =>
          cols.map((c) => c.id === columnId ? { ...c, title: colLabel.trim(), color: colColor } : c),
        );
      }
    }

    setColBusy(false);
    setColModal({ kind: "closed" });
  }

  async function handleColDelete() {
    if (colModal.kind !== "delete") return;
    const { columnId, cardCount } = colModal;

    // Last column guard
    if (columns.length <= 1) {
      toast.error(strings.delLastColumn);
      return;
    }

    setColBusy(true);
    const res = await actions.deleteColumn({
      columnId,
      migrateToColumnId: cardCount > 0 ? migrateTarget : undefined,
    });

    if (!res.ok) {
      toast.error(strings.deleteError);
    } else {
      // Migrate cards optimistically
      if (cardCount > 0 && migrateTarget) {
        setCards((cs) => cs.map((c) => c.columnId === columnId ? { ...c, columnId: migrateTarget } : c));
      }
      setColumns((cols) => cols.filter((c) => c.id !== columnId));
    }
    setColBusy(false);
    setColModal({ kind: "closed" });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);
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
          onClick={openCreate}
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
      {cards.length === 0 && columns.length > 0 && (
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
          const otherCols = columns.filter((c) => c.id !== col.id);

          return (
            <div
              className="kcol"
              key={col.id}
              style={
                colOverId === col.id && colDragId && colDragId !== col.id
                  ? { outline: "2px dashed var(--accent)", outlineOffset: 2, borderRadius: 12 }
                  : undefined
              }
            >
              {/* Column header — drag to reorder columns (RF-DIA-004) */}
              <div
                className={`kcol-head${colDragId === col.id ? " dragging" : ""}`}
                draggable
                onDragStart={(e) => { setColDragId(col.id); e.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { setColDragId(null); setColOverId(null); }}
                onDragOver={(e) => { if (colDragId) { e.preventDefault(); setColOverId(col.id); } }}
                onDrop={() => { if (colDragId) handleColReorder(col); }}
                style={{ cursor: "grab" }}
              >
                <span className="kcol-dot" style={{ background: tokenToVar(col.color) }} />
                <span className="kcol-title">{col.title}</span>
                <span className="kcol-count">{colCards.length}</span>
                {/* Column menu */}
                <div style={{ position: "relative" }}>
                  <ColumnMenu
                    col={col}
                    isLast={columns.length <= 1}
                    otherCols={otherCols}
                    onEdit={() => openEdit(col)}
                    onDelete={() => openDelete(col)}
                    canMoveLeft={colIdx > 0}
                    canMoveRight={colIdx < sortedColumns.length - 1}
                    onMoveLeft={() => moveColumn(col, "left")}
                    onMoveRight={() => moveColumn(col, "right")}
                    moveLeftLabel={strings.colMenuMoveLeft}
                    moveRightLabel={strings.colMenuMoveRight}
                    delLastLabel={strings.delLastColumn}
                    editLabel={strings.colMenuEdit}
                    deleteLabel={strings.colMenuDelete}
                    ariaLabel={strings.colMenuAria}
                  />
                </div>
              </div>

              {/* Drop zone (card drops only — guarded against column drags) */}
              <div
                className={`kcol-body${overCol === col.id ? " dragover" : ""}`}
                onDragOver={(e) => { if (!colDragId) { e.preventDefault(); setOverCol(col.id); } }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
                onDrop={() => { if (!colDragId) handleDrop(col); }}
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

      {/* ── Column create/edit modal ── */}
      <Modal
        open={colModal.kind === "create" || colModal.kind === "edit"}
        onOpenChange={(o) => !o && setColModal({ kind: "closed" })}
        title={colModal.kind === "edit" ? strings.colModalEditTitle : strings.colModalCreateTitle}
        width={400}
        footer={
          <>
            <button
              type="button"
              className="vbtn vbtn-ghost vbtn-sm"
              onClick={() => setColModal({ kind: "closed" })}
            >
              {strings.colCancel}
            </button>
            <button
              type="button"
              className="vbtn vbtn-primary vbtn-sm"
              disabled={colBusy}
              onClick={handleColSave}
            >
              {strings.colSave}
            </button>
          </>
        }
      >
        <div className="vfield">
          <label htmlFor="col-label">{strings.colNameLabel}</label>
          <input
            id="col-label"
            value={colLabel}
            onChange={(e) => { setColLabel(e.target.value); setColLabelError(""); }}
            placeholder={strings.colNamePh}
          />
          {colLabelError && (
            <span style={{ color: "var(--red)", fontSize: 12 }}>{colLabelError}</span>
          )}
        </div>

        <div className="vfield" style={{ marginBottom: 0 }}>
          <label>{strings.colColorLabel}</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            {COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                title={swatch}
                aria-label={swatch}
                aria-pressed={colColor === swatch}
                onClick={() => setColColor(swatch)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: tokenToVar(swatch),
                  border: colColor === swatch ? "3px solid var(--ink)" : "3px solid transparent",
                  cursor: "pointer",
                  outline: colColor === swatch ? "2px solid var(--accent)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </Modal>

      {/* ── Delete column modal ── */}
      {colModal.kind === "delete" && (
        <Modal
          open
          onOpenChange={(o) => !o && setColModal({ kind: "closed" })}
          title={`${strings.delModalTitle} "${colModal.label}"?`}
          tone="var(--red)"
          width={420}
          footer={
            <>
              <button
                type="button"
                className="vbtn vbtn-ghost vbtn-sm"
                onClick={() => setColModal({ kind: "closed" })}
              >
                {strings.delCancel}
              </button>
              <button
                type="button"
                className="vbtn vbtn-amber vbtn-sm"
                disabled={colBusy || (colModal.cardCount > 0 && !migrateTarget)}
                onClick={handleColDelete}
              >
                {strings.delConfirm}
              </button>
            </>
          }
        >
          {colModal.cardCount === 0 ? (
            <p style={{ fontSize: 14, color: "var(--ink-2)" }}>{strings.delModalBodyEmpty}</p>
          ) : (
            <>
              <p style={{ fontSize: 14, color: "var(--ink-2)", marginBottom: 12 }}>
                {strings.delModalBodyCards.replace("{n}", String(colModal.cardCount))}
              </p>
              <div className="vfield" style={{ marginBottom: 0 }}>
                <label htmlFor="migrate-target">{strings.delMigrateLabel}</label>
                <select
                  id="migrate-target"
                  value={migrateTarget}
                  onChange={(e) => setMigrateTarget(e.target.value)}
                >
                  {columns
                    .filter((c) => c.id !== colModal.columnId)
                    .sort((a, b) => a.position - b.position)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                </select>
              </div>
            </>
          )}
        </Modal>
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
          <MSym name={card.serviceIcon || "folder"} size={14} color={card.serviceColor || "var(--ink-2)"} />
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
        <MSym name="folder" size={14} />
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

// ---------------------------------------------------------------------------
// ColumnMenu (⋯ button with popover options)
// ---------------------------------------------------------------------------

function menuItemStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 14px",
    background: "none",
    border: "none",
    fontSize: 13,
    fontWeight: 700,
    color: disabled ? "var(--ink-3)" : "var(--ink)",
    cursor: disabled ? "not-allowed" : "pointer",
    textAlign: "left",
  };
}

function ColumnMenu({
  col,
  isLast,
  onEdit,
  onDelete,
  otherCols: _otherCols,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  moveLeftLabel,
  moveRightLabel,
  delLastLabel,
  editLabel,
  deleteLabel,
  ariaLabel,
}: {
  col: CaseColumnVM;
  isLast: boolean;
  otherCols: CaseColumnVM[];
  onEdit: () => void;
  onDelete: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  moveLeftLabel: string;
  moveRightLabel: string;
  delLastLabel: string;
  editLabel: string;
  deleteLabel: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="kcol-menu"
        aria-label={ariaLabel.replace("{title}", col.title)}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MSym name="more_horiz" size={18} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            zIndex: 50,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            boxShadow: "var(--shadow-md)",
            minWidth: 160,
            padding: "6px 0",
          }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canMoveLeft}
            style={menuItemStyle(!canMoveLeft)}
            onClick={() => { if (canMoveLeft) { setOpen(false); onMoveLeft(); } }}
          >
            <MSym name="chevron_left" size={16} />
            {moveLeftLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canMoveRight}
            style={menuItemStyle(!canMoveRight)}
            onClick={() => { if (canMoveRight) { setOpen(false); onMoveRight(); } }}
          >
            <MSym name="chevron_right" size={16} />
            {moveRightLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            style={menuItemStyle(false)}
            onClick={() => { setOpen(false); onEdit(); }}
          >
            <MSym name="edit" size={16} />
            {editLabel}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isLast}
            title={isLast ? delLastLabel : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 14px",
              background: "none",
              border: "none",
              fontSize: 13,
              fontWeight: 700,
              color: isLast ? "var(--ink-3)" : "var(--red)",
              cursor: isLast ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
            onClick={() => { if (!isLast) { setOpen(false); onDelete(); } }}
          >
            <MSym name="delete" size={16} />
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  );
}
