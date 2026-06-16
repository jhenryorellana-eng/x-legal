"use client";

/**
 * Andrium — Kanban de cobranza (`/finanzas`) · DOC-55 §1 (RF-AND-001..006).
 *
 * Molde: src/frontend/features/legal/kanban/diana-kanban-view.tsx
 *
 * Columnas semilla (DOC-47 §2.2, board_kind='collections'):
 *   1 Por cobrar inicial (accent) · 2 Cuotas por vencer (gold)
 *   3 Vencidas (red) · 4 Por imprimir (navy) · 5 Hecho (green, is_terminal_won)
 *
 * Tarjeta de cobranza (DOC-55 §1.3, PROMPT-AND-01):
 *   - Fila superior: case_number (13px/800) + Chip del servicio
 *   - Nombre del cliente (14px/700)
 *   - Línea de cobro según origen de tarjeta:
 *       "Cuota inicial: {monto}" (Por cobrar inicial)
 *       "{monto} vencido · {n} días de atraso" (Vencidas — días en rojo)
 *       "Expediente listo · intento {n} · {p} págs." (Por imprimir)
 *       Chip "Impreso" verde (Hecho)
 *   - Nota fijada editable inline (RF-AND-003)
 *   - Footer: antigüedad relativa + dot del color de columna
 *   - Acciones rápidas (hover): Cobrar · Enviar recordatorio · Ver caso
 *
 * Drag & drop HTML5 optimista → moveKanbanCardAction → revert + toast ante error.
 * Gestión de columnas (Nueva/Editar/Eliminar con migración) idéntica al molde Diana.
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

/** Tipo de tarjeta de cobranza según su columna de origen. */
export type CollectionCardKind =
  | "initial"      // Por cobrar inicial — Cuota inicial: ${monto}
  | "overdue"      // Vencidas — ${monto} vencido · {n} días de atraso
  | "print"        // Por imprimir — Expediente listo · intento {n} · {p} págs.
  | "done"         // Hecho — Chip "Impreso"
  | "generic";     // Cuotas por vencer o columna personalizada

/** One column of the collections board. */
export interface CollectionColumnVM {
  id: string;
  boardId: string;
  title: string;
  color: string;
  isTerminalWon: boolean;
  position: number;
}

/** One kanban card (one collection item). */
export interface CollectionCardVM {
  id: string;
  columnId: string;
  caseId: string;
  caseNumber: string;
  clientName: string;
  serviceLabel: string;
  serviceColor: string;
  // Card kind drives the collection line shown
  cardKind: CollectionCardKind;
  // Monto in cents (cents → "$ 1,250.00" formatted server-side or passed raw)
  // <<NEED-BACKEND>> getCollectionMetrics / billing reads per card not yet exposed:
  // The billing module does not yet export a per-card collection line DTO.
  // The page passes a pre-formatted string; backend must enrich this in a future
  // read (e.g. listCollectionCards(actor) → CollectionCardDto with amount_cents
  // + days_late + attempt_no + page_count from installments / expedientes).
  collectionLine: string; // Pre-formatted by RSC page
  // For "overdue" kind: days late rendered in red
  daysLate: number;
  // For "print" kind: attempt number
  attemptNo: number;
  // Chip status label for "initial" kind
  statusChip: string | null;
  pinnedNote: string | null;
  /** fmtRelative(card.updated_at) — time in column */
  ageLabel: string;
  /** timeTier computed server-side */
  ageTier: "time-ok" | "time-warn" | "time-hot";
  /** F6-Ola3 (P-55-1): installment to remind about, if any (else the button is hidden). */
  reminderInstallmentId?: string | null;
}

// ---------------------------------------------------------------------------
// KPI strip VM (DOC-55 §0.5, API-BIL-17)
// ---------------------------------------------------------------------------

export interface CollectionKpiVM {
  /** Pre-formatted string, e.g. "$24,380.00" */
  collectedMonth: string;
  /** Trend: "+12%" or "–3%" — signed string */
  collectedTrend: string;
  collectedTrendUp: boolean;
  /** "87%" */
  onTimePct: string;
  onTimeTrend: string;
  onTimeTrendUp: boolean;
  /** Morosidad: "9 cuotas · $2,150.00 · 6 casos" — pre-formatted */
  overdueLabel: string;
  /** Count for badge */
  overdueCount: number;
  /** Count of expedientes awaiting print */
  printCount: number;
}

// ---------------------------------------------------------------------------
// String bag (i18n wired in the RSC page)
// ---------------------------------------------------------------------------

export interface CobranzaKanbanStrings {
  title: string;
  manageColumns: string;
  newColumn: string;
  emptyCol: string;
  moveError: string;
  noteError: string;
  orderError: string;
  deleteError: string;
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
  delModalBodyCards: string; // raw template with {n}
  delMigrateLabel: string;
  delConfirm: string;
  delCancel: string;
  delLastColumn: string;
  delSeedWarning: string;
  // card actions
  actionCollect: string;
  actionRemind: string;
  actionView: string;
  // card inline note
  notePlaceholder: string;
  // card chips
  chipPending: string;
  chipDone: string;
  // empty board
  emptyTitle: string;
  emptyBody: string;
  // KPI labels
  kpiCollectedMonth: string;
  kpiOnTime: string;
  kpiOverdue: string;
  kpiPrint: string;
  // Toast delete col
  toastColDeleted: string; // raw template with {column}
  // Error / loading
  loadError: string;
  retry: string;
  // F6-Ola3 (P-55-1) reminder feedback — optional (Spanish fallback in the view)
  remindOk?: string;
  remindError?: string;
  remindTooSoon?: string;
}

// ---------------------------------------------------------------------------
// Action types (same shape as DianaKanbanActions)
// ---------------------------------------------------------------------------

export interface CobranzaKanbanActions {
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

  /** F6-Ola3 (P-55-1) — send a manual reminder for an installment. */
  remindInstallment?: (
    installmentId: string,
  ) => Promise<{ ok: boolean; error?: { code: string } }>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CobranzaKanbanViewProps {
  boardId: string;
  columns: CollectionColumnVM[];
  cards: CollectionCardVM[];
  kpi: CollectionKpiVM | null;
  strings: CobranzaKanbanStrings;
  actions: CobranzaKanbanActions;
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

export function CobranzaKanbanView({
  boardId,
  columns: initialColumns,
  cards: initialCards,
  kpi,
  strings,
  actions,
}: CobranzaKanbanViewProps) {
  const toast = useToast();

  // F6-Ola3 (P-55-1): manual reminder dispatch from a collection card.
  const [remindingId, setRemindingId] = React.useState<string | null>(null);
  async function handleRemind(card: CollectionCardVM) {
    if (!card.reminderInstallmentId || !actions.remindInstallment) return;
    setRemindingId(card.id);
    const res = await actions.remindInstallment(card.reminderInstallmentId);
    setRemindingId(null);
    if (res.ok) {
      toast.success(strings.remindOk ?? "Recordatorio enviado");
    } else if (res.error?.code === "REMINDER_TOO_SOON") {
      toast.error(strings.remindTooSoon ?? "Ya enviaste un recordatorio hace poco");
    } else {
      toast.error(strings.remindError ?? "No se pudo enviar el recordatorio");
    }
  }

  // Board state
  const [columns, setColumns] = React.useState<CollectionColumnVM[]>(initialColumns);
  const [cards, setCards] = React.useState<CollectionCardVM[]>(initialCards);

  // Drag & drop
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);

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

  const handleDrop = async (col: CollectionColumnVM) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;

    const card = cards.find((c) => c.id === id);
    if (!card || card.columnId === col.id) return;

    // Optimistic update
    const prev = cards;
    setCards((cs) => cs.map((c) => c.id === id ? { ...c, columnId: col.id } : c));

    const res = await actions.moveCard({ cardId: id, toColumnId: col.id, toPosition: 0 });
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
  // Column modal helpers
  // -------------------------------------------------------------------------

  function openCreate() {
    setColLabel("");
    setColColor("accent");
    setColLabelError("");
    setColModal({ kind: "create" });
  }

  function openEdit(col: CollectionColumnVM) {
    setColLabel(col.title);
    setColColor(col.color);
    setColLabelError("");
    setColModal({ kind: "edit", columnId: col.id, label: col.title, color: col.color });
  }

  function openDelete(col: CollectionColumnVM) {
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
        toast.error(strings.deleteError);
      } else {
        const newCol: CollectionColumnVM = {
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
        toast.error(strings.deleteError);
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
    const { columnId, cardCount, label } = colModal;

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
      const targetLabel = columns.find((c) => c.id === migrateTarget)?.title ?? "";
      toast.success(strings.toastColDeleted.replace("{column}", targetLabel || label));
    }
    setColBusy(false);
    setColModal({ kind: "closed" });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const sortedColumns = [...columns].sort((a, b) => a.position - b.position);

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── View header ── */}
      <div className="v-head" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="v-title">{strings.title}</h1>
        </div>
        <button
          type="button"
          className="vbtn vbtn-ghost vbtn-sm"
          onClick={openCreate}
        >
          <MSym name="view_column" size={18} />
          {strings.manageColumns}
        </button>
      </div>

      {/* ── KPI Strip (DOC-55 §0.5) ── */}
      {kpi && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 12,
            marginBottom: 20,
          }}
        >
          {/* KPI 1: Recaudado del mes — variante hot */}
          <div
            className="kpi-card kpi-hot"
            style={{
              background: "linear-gradient(120deg, var(--accent) 0%, var(--brand-navy, #1B2B5E) 100%)",
              borderRadius: 16,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              boxShadow: "0 0 24px color-mix(in srgb, var(--accent) 30%, transparent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.15)",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                }}
              >
                <MSym name="payments" size={22} color="#fff" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.8)" }}>
                {strings.kpiCollectedMonth}
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>
              {kpi.collectedMonth}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: kpi.collectedTrendUp ? "#86efac" : "#fca5a5",
              }}
            >
              {kpi.collectedTrendUp ? "↑" : "↓"} {kpi.collectedTrend}
            </div>
          </div>

          {/* KPI 2: % al día */}
          <div
            className="kpi-card"
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 16,
              padding: "18px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  background: "var(--blue-soft, color-mix(in srgb, var(--accent) 12%, transparent))",
                  display: "grid",
                  placeItems: "center",
                  flex: "none",
                }}
              >
                <MSym name="check_circle" size={22} color="var(--accent)" />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                {strings.kpiOnTime}
              </span>
            </div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "var(--ink)", lineHeight: 1.1 }}>
              {kpi.onTimePct}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: kpi.onTimeTrendUp ? "var(--green)" : "var(--red)",
              }}
            >
              {kpi.onTimeTrendUp ? "↑" : "↓"} {kpi.onTimeTrend}
            </div>
          </div>

          {/* KPI 3: Morosidad — clicable → /finanzas/pagos?tab=morosidad */}
          <Link
            href="/finanzas/pagos?tab=morosidad"
            style={{ textDecoration: "none" }}
          >
            <div
              className="kpi-card"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 16,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
                transition: "box-shadow .2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "var(--red-soft, color-mix(in srgb, var(--red) 12%, transparent))",
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  <MSym name="warning" size={22} color="var(--red)" />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                  {strings.kpiOverdue}
                </span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "var(--red)", lineHeight: 1.1 }}>
                {kpi.overdueLabel}
              </div>
            </div>
          </Link>

          {/* KPI 4: Por imprimir — clicable → /finanzas/impresion */}
          <Link
            href="/finanzas/impresion"
            style={{ textDecoration: "none" }}
          >
            <div
              className="kpi-card"
              style={{
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 16,
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                cursor: "pointer",
                transition: "box-shadow .2s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: "color-mix(in srgb, var(--brand-navy, #1B2B5E) 12%, transparent)",
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  <MSym name="print" size={22} color="var(--brand-navy, #1B2B5E)" />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
                  {strings.kpiPrint}
                </span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: "var(--ink)", lineHeight: 1.1 }}>
                {kpi.printCount}
              </div>
            </div>
          </Link>
        </div>
      )}

      {/* ── Empty state (board created, no cards yet) ── */}
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
          <div style={{ fontSize: 13, textAlign: "center", maxWidth: 380 }}>{strings.emptyBody}</div>
        </div>
      )}

      {/* ── Board horizontal scroll ── */}
      <div className="kanban">
        {sortedColumns.map((col) => {
          const colCards = cards.filter((c) => c.columnId === col.id);
          const otherCols = columns.filter((c) => c.id !== col.id);

          return (
            <div className="kcol" key={col.id}>
              {/* Column header */}
              <div className="kcol-head">
                <span className="kcol-dot" style={{ background: tokenToVar(col.color) }} />
                <span className="kcol-title">{col.title}</span>
                {col.isTerminalWon && (
                  <MSym name="check_circle" size={14} color="var(--green)" style={{ flex: "none" }} />
                )}
                <span className="kcol-count">{colCards.length}</span>
                <div style={{ position: "relative" }}>
                  <ColumnMenu
                    col={col}
                    isLast={columns.length <= 1}
                    otherCols={otherCols}
                    onEdit={() => openEdit(col)}
                    onDelete={() => openDelete(col)}
                    delLastLabel={strings.delLastColumn}
                  />
                </div>
              </div>

              {/* Drop zone */}
              <div
                className={`kcol-body${overCol === col.id ? " dragover" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverCol(col.id); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setOverCol(null); }}
                onDrop={() => handleDrop(col)}
              >
                {colCards.length === 0 && (
                  <div className="kcol-empty">{strings.emptyCol}</div>
                )}

                {colCards.map((card) => (
                  <CollectionCard
                    key={card.id}
                    card={card}
                    colColor={tokenToVar(col.color)}
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
                    onRemind={() => handleRemind(card)}
                    reminding={remindingId === card.id}
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
          <label htmlFor="col-label-cobranza">{strings.colNameLabel}</label>
          <input
            id="col-label-cobranza"
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
                <label htmlFor="migrate-target-cobranza">{strings.delMigrateLabel}</label>
                <select
                  id="migrate-target-cobranza"
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
// CollectionCard sub-component
// ---------------------------------------------------------------------------

function CollectionCard({
  card,
  colColor,
  isDragging,
  editingNoteId,
  noteValue,
  strings,
  onDragStart,
  onDragEnd,
  onStartEditNote,
  onNoteChange,
  onNoteBlur,
  onRemind,
  reminding,
}: {
  card: CollectionCardVM;
  colColor: string;
  isDragging: boolean;
  editingNoteId: string | null;
  noteValue: string;
  strings: CobranzaKanbanStrings;
  onDragStart: () => void;
  onDragEnd: () => void;
  onStartEditNote: () => void;
  onNoteChange: (v: string) => void;
  onNoteBlur: () => void;
  onRemind: () => void;
  reminding: boolean;
}) {
  const isEditingNote = editingNoteId === card.id;

  return (
    <div
      className={`kcard${isDragging ? " dragging" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Row 1: case number + service chip */}
      <div className="kcard-top">
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-2)", flex: "none" }}>
          {card.caseNumber}
        </span>
        {card.serviceLabel && (
          <span
            className="kchip"
            style={{
              background: card.serviceColor
                ? `color-mix(in srgb, ${card.serviceColor} 14%, var(--panel))`
                : "var(--chip)",
              color: card.serviceColor || "var(--ink-2)",
              marginLeft: "auto",
              fontSize: 11,
              maxWidth: 110,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {card.serviceLabel}
          </span>
        )}
      </div>

      {/* Row 2: client name — links to case billing */}
      <Link
        href={`/finanzas/pagos/caso/${card.caseId}`}
        className="kcard-name"
        style={{ display: "block", marginBottom: 6, textDecoration: "none", fontSize: 14, fontWeight: 700 }}
        aria-label={`Ver caso ${card.caseNumber}`}
        onClick={(e) => e.stopPropagation()}
      >
        {card.clientName}
      </Link>

      {/* Row 3: collection line (varies by card kind) */}
      <CollectionLine card={card} strings={strings} />

      {/* Row 4: pinned note (inline editable) */}
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

      {/* Row 5: quick actions (shown on hover via CSS group) */}
      <div className="kcard-actions" style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <Link
          href={`/finanzas/pagos/caso/${card.caseId}`}
          className="vbtn vbtn-primary vbtn-xs"
          style={{ fontSize: 11, padding: "3px 8px", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {strings.actionCollect}
        </Link>
        {card.reminderInstallmentId && (
          <button
            type="button"
            className="vbtn vbtn-ghost vbtn-xs"
            style={{ fontSize: 11, padding: "3px 8px", opacity: reminding ? 0.5 : 1 }}
            title={strings.actionRemind}
            disabled={reminding}
            onClick={(e) => {
              e.stopPropagation();
              onRemind();
            }}
          >
            <MSym name="send" size={12} />
            {strings.actionRemind}
          </button>
        )}
        <Link
          href={`/finanzas/pagos/caso/${card.caseId}`}
          className="vbtn vbtn-ghost vbtn-xs"
          style={{ fontSize: 11, padding: "3px 8px", textDecoration: "none" }}
          onClick={(e) => e.stopPropagation()}
        >
          {strings.actionView}
        </Link>
      </div>

      {/* Row 6: footer (time-badge + column dot) */}
      <div className="kcard-foot">
        <span
          className={`time-badge ${card.ageTier}`}
          title="Tiempo en esta columna"
        >
          {card.ageLabel}
        </span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: colColor,
            flex: "none",
            marginLeft: "auto",
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionLine — drives the contextual billing line per card kind
// ---------------------------------------------------------------------------

function CollectionLine({
  card,
  strings,
}: {
  card: CollectionCardVM;
  strings: CobranzaKanbanStrings;
}) {
  if (card.cardKind === "initial") {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>
          {card.collectionLine}
        </div>
        {card.statusChip && (
          <Chip tone="gold" style={{ fontSize: 11, height: 22 }}>
            {card.statusChip}
          </Chip>
        )}
      </div>
    );
  }

  if (card.cardKind === "overdue") {
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
          {/* Amount part */}
          {card.collectionLine.split("·")[0]?.trim()}
          {" · "}
          {/* Days late in red, blinking */}
          <span
            style={{ color: "var(--red)", fontWeight: 700, animation: "vblink 1.4s ease-in-out infinite" }}
          >
            {card.daysLate} {card.collectionLine.split("·")[1]?.trim() ?? ""}
          </span>
        </div>
      </div>
    );
  }

  if (card.cardKind === "print") {
    return (
      <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
        {card.collectionLine}
      </div>
    );
  }

  if (card.cardKind === "done") {
    return (
      <div style={{ marginBottom: 8 }}>
        <Chip tone="green" style={{ fontSize: 11, height: 22 }}>
          {strings.chipDone}
        </Chip>
      </div>
    );
  }

  // generic — just render the line if present
  if (card.collectionLine) {
    return (
      <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
        {card.collectionLine}
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// ColumnMenu (⋯ button with popover options)
// ---------------------------------------------------------------------------

function ColumnMenu({
  col,
  isLast,
  onEdit,
  onDelete,
  otherCols: _otherCols,
  delLastLabel,
}: {
  col: CollectionColumnVM;
  isLast: boolean;
  otherCols: CollectionColumnVM[];
  onEdit: () => void;
  onDelete: () => void;
  delLastLabel: string;
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
        aria-label={`Opciones columna ${col.title}`}
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
              color: "var(--ink)",
              cursor: "pointer",
              textAlign: "left",
            }}
            onClick={() => { setOpen(false); onEdit(); }}
          >
            <MSym name="edit" size={16} />
            Editar
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
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}
