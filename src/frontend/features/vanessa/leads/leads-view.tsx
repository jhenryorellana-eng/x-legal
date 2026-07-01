"use client";

/**
 * Leads — kanban board (DOC-52 §2, RF-VAN-010..019).
 *
 * Columns (seed DOC-47 §2.2) with HTML5-native drag & drop → moveCard
 * (optimistic UI, revert on error). KanbanCard replicates §2.2 (amber
 * uncontacted rail, source icon, name, service, category chip, time-badge,
 * mini-actions). Board/List toggle + filters. Won → Lex "create case" offer;
 * Lost → mandatory reason modal. Modals (Nuevo lead / Nuevo caso) are injected.
 *
 * Column management (create/rename/recolor/reorder/delete-with-migration,
 * RF-VAN-010) is the shared `shared-kanban` module (useKanbanColumns +
 * ColumnMenu + ColumnModals) — same implementation as the legal/cases board.
 * The terminal columns keep their behavior via the is_terminal_won/lost flags
 * (renaming them does not change it): won → "create case" offer, lost → reason.
 *
 * Realtime board:{id} is optional in F3 (degrades to refresh) — DOC-25 §1.6.
 */

import * as React from "react";
import { getBridge } from "@/frontend/platform-bridge";
import { MSym } from "../shared/msym";
import { Chip, sourceMeta } from "../shared/ui";
import { LexBubble } from "../shared/lex";
import { useToast } from "../shared/toast-bridge";
import { Modal } from "@/frontend/components/desktop";
import {
  useKanbanColumns,
  ColumnMenu,
  ColumnModals,
  tokenToVar,
  type KanbanColumnVM,
  type KanbanColumnActions,
  type KanbanColumnStrings,
} from "@/frontend/features/shared-kanban";

export interface LeadCardVM {
  id: string;
  leadId: string;
  columnId: string;
  name: string | null;
  phone: string;
  source: string;
  sourceLabel: string;
  serviceId: string | null;
  serviceLabel: string;
  categoryId: string | null;
  categoryLabel: string | null;
  categoryColor: string | null;
  note: string | null;
  uncontacted: boolean;
  ageLabel: string;
  lostReason: string | null;
}

/** One column of the leads board. Uses the shared kanban column VM. */
export type LeadColumnVM = KanbanColumnVM;

export interface LeadsStrings {
  title: string;
  sub: string;
  board: string;
  list: string;
  filters: string;
  manageCategories: string;
  newLead: string;
  addLead: string;
  editLead: string;
  emptyCol: string;
  lexTipHtml: string;
  lexOk: string;
  call: string;
  whatsapp: string;
  agendar: string;
  createCaseTooltip: string;
  lostTitle: string;
  lostBody: string;
  lostReasonLabel: string;
  lostReasonPlaceholder: string;
  confirm: string;
  cancel: string;
  lexEnabled: boolean;
  badgeRedmove: string;
}

export interface LeadsActions {
  moveCard: (input: {
    cardId: string;
    toColumnId: string;
    toPosition: number;
    lostReason?: string;
  }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface LeadsViewProps {
  boardId: string;
  columns: LeadColumnVM[];
  cards: LeadCardVM[];
  strings: LeadsStrings;
  columnStrings: KanbanColumnStrings;
  actions: LeadsActions;
  columnActions: KanbanColumnActions;
  onNewLead: (columnId?: string) => void;
  onNewCase: (preset: { name: string | null; phone: string; leadId?: string }) => void;
  onScheduleLead: (lead: { leadId: string; name: string | null; phone: string; source: string }) => void;
  onEditLead: (card: LeadCardVM) => void;
  onOpenFilters: () => void;
  onManageCategories: () => void;
}

export function LeadsView({
  boardId,
  columns,
  cards: initialCards,
  strings,
  columnStrings,
  actions,
  columnActions,
  onNewLead,
  onNewCase,
  onScheduleLead,
  onEditLead,
  onOpenFilters,
  onManageCategories,
}: LeadsViewProps) {
  const toast = useToast();
  const [cards, setCards] = React.useState(initialCards);
  // Re-sync local board state when the server re-renders (e.g. router.refresh()
  // after creating a lead or converting one to a case) so the board updates
  // without a full page reload.
  React.useEffect(() => { setCards(initialCards); }, [initialCards]);

  // Column management (create/edit/reorder/delete-with-migration) — shared.
  const cols = useKanbanColumns({
    boardId,
    initialColumns: columns,
    actions: columnActions,
    strings: columnStrings,
    toast,
    countCardsIn: (columnId) => cards.filter((c) => c.columnId === columnId).length,
    onColumnDeleted: (columnId, migrateToColumnId) => {
      if (!migrateToColumnId) return;
      setCards((cs) => cs.map((c) => (c.columnId === columnId ? { ...c, columnId: migrateToColumnId } : c)));
    },
  });

  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);
  const [lostFor, setLostFor] = React.useState<{ card: LeadCardVM; toColumnId: string } | null>(null);
  const [lostReason, setLostReason] = React.useState("");

  const drop = async (col: LeadColumnVM) => {
    const id = dragId;
    setDragId(null);
    setOverCol(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.columnId === col.id) return;

    if (col.isTerminalLost) {
      setLostFor({ card, toColumnId: col.id });
      setLostReason("");
      return;
    }

    // optimistic move; first move out of entry column clears uncontacted
    const prev = cards;
    setCards((cs) =>
      cs.map((c) =>
        c.id === id
          ? { ...c, columnId: col.id, uncontacted: false }
          : c,
      ),
    );
    const res = await actions.moveCard({
      cardId: id,
      toColumnId: col.id,
      toPosition: 0,
    });
    if (!res.ok) {
      setCards(prev); // revert
      toast.error(strings.badgeRedmove);
      return;
    }
    // Terminal-won: open the "create case" contract modal directly, prefilled
    // with the lead's name + phone (RF-VAN-015). Closing it without creating a
    // case just leaves the lead in this column.
    if (col.isTerminalWon) {
      onNewCase({ name: card.name, phone: card.phone, leadId: card.leadId });
    }
  };

  const confirmLost = async () => {
    if (!lostFor || !lostReason.trim()) return;
    const { card, toColumnId } = lostFor;
    const prev = cards;
    setCards((cs) =>
      cs.map((c) =>
        c.id === card.id
          ? { ...c, columnId: toColumnId, uncontacted: false, lostReason }
          : c,
      ),
    );
    setLostFor(null);
    const res = await actions.moveCard({
      cardId: card.id,
      toColumnId,
      toPosition: 0,
      lostReason,
    });
    if (!res.ok) {
      setCards(prev);
      toast.error(strings.badgeRedmove);
    }
  };

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div className="v-head" style={{ marginBottom: 14 }}>
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="seg">
            <button className="on" type="button">{strings.board}</button>
            <button type="button" onClick={() => toast.info(strings.list)}>{strings.list}</button>
          </div>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={onOpenFilters}>
            <MSym name="filter_list" size={18} />
            {strings.filters}
          </button>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={cols.openCreate}>
            <MSym name="add" size={18} />
            {columnStrings.newColumn}
          </button>
          <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={onManageCategories}>
            <MSym name="label" size={18} />
            {strings.manageCategories}
          </button>
          <button type="button" className="vbtn vbtn-primary vbtn-sm" onClick={() => onNewLead()}>
            <MSym name="add" size={18} />
            {strings.newLead}
          </button>
        </div>
      </div>

      <LexBubble dismissKey="leads-tip" orb={30} enabled={strings.lexEnabled} html={strings.lexTipHtml}
        actions={[{ label: strings.lexOk, icon: "check", ghost: true, onClick: () => {} }]} />

      <div className="kanban">
        {cols.columns.map((col, colIdx) => {
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
              {/* Column header — drag to reorder (RF-VAN-010) */}
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
                  isLast={cols.columns.length <= 1}
                  canMoveLeft={colIdx > 0}
                  canMoveRight={colIdx < cols.columns.length - 1}
                  onMoveLeft={() => cols.moveColumn(col, "left")}
                  onMoveRight={() => cols.moveColumn(col, "right")}
                  onEdit={() => cols.openEdit(col)}
                  onDelete={() => cols.openDelete(col)}
                  strings={columnStrings}
                />
              </div>
              <div
                className={`kcol-body${overCol === col.id ? " dragover" : ""}`}
                onDragOver={(e) => {
                  if (cols.colDragId) return;
                  e.preventDefault();
                  setOverCol(col.id);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget === e.target) setOverCol(null);
                }}
                onDrop={() => { if (!cols.colDragId) drop(col); }}
              >
                {colCards.length === 0 && <div className="kcol-empty">{strings.emptyCol}</div>}
                {colCards.map((c) => {
                  const sm = sourceMeta(c.source);
                  return (
                    <div
                      key={c.id}
                      className={`kcard${dragId === c.id ? " dragging" : ""}`}
                      draggable
                      onDragStart={() => setDragId(c.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverCol(null);
                      }}
                      // Click the card (anywhere but the mini-action buttons,
                      // which stopPropagation) to edit the lead (RF-VAN-012).
                      onClick={() => onEditLead(c)}
                      onKeyDown={(e) => { if (e.key === "Enter") onEditLead(c); }}
                      tabIndex={0}
                      aria-label={`${strings.editLead}: ${c.name ?? c.phone}`}
                      style={{ cursor: "pointer" }}
                    >
                      {c.uncontacted && <span className="kcard-uncontacted" title="Sin contactar" />}
                      <div className="kcard-top">
                        <div className={`src-ico kcard-src ${sm.cls}`} title={c.sourceLabel}>
                          <MSym name={sm.icon} size={14} />
                        </div>
                        <span className="kcard-name">{c.name ?? c.phone}</span>
                      </div>
                      <div className="kcard-svc">
                        <MSym name="star" size={15} />
                        {c.serviceLabel}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 9, flexWrap: "wrap" }}>
                        {c.categoryLabel && c.categoryColor && (
                          <span
                            className="kchip"
                            style={{
                              background: `color-mix(in srgb, ${c.categoryColor} 16%, transparent)`,
                              color: c.categoryColor,
                            }}
                          >
                            <span className="kchip-dot" style={{ background: c.categoryColor }} />
                            {c.categoryLabel}
                          </span>
                        )}
                        {c.lostReason && (
                          <Chip tone="red" style={{ height: 22, fontSize: 11 }}>
                            {c.lostReason}
                          </Chip>
                        )}
                      </div>
                      <div className="kcard-foot">
                        <button type="button" className="kmini" title={strings.call} aria-label={`${strings.call} ${c.name ?? c.phone}`}
                          onClick={(e) => { e.stopPropagation(); getBridge().share.openExternal(`tel:${c.phone}`); }}>
                          <MSym name="call" size={15} />
                        </button>
                        <button type="button" className="kmini" title={strings.whatsapp} aria-label={`${strings.whatsapp} ${c.name ?? c.phone}`}
                          onClick={(e) => { e.stopPropagation(); getBridge().share.openExternal(`https://wa.me/${c.phone.replace(/[^\d]/g, "")}`); }}>
                          <MSym name="chat" size={15} />
                        </button>
                        <button type="button" className="kmini" title={strings.agendar} aria-label={`${strings.agendar} ${c.name ?? c.phone}`}
                          onClick={(e) => { e.stopPropagation(); onScheduleLead({ leadId: c.leadId, name: c.name, phone: c.phone, source: c.source }); }}>
                          <MSym name="event" size={15} />
                        </button>
                        <button type="button" className="kmini" title={strings.createCaseTooltip} aria-label={strings.createCaseTooltip}
                          onClick={(e) => { e.stopPropagation(); onNewCase({ name: c.name, phone: c.phone, leadId: c.leadId }); }}>
                          <MSym name="create_new_folder" size={15} />
                        </button>
                        <span className="kcard-age">{c.ageLabel}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <button type="button" className="kadd" onClick={() => onNewLead(col.id)}>
                <MSym name="add" size={17} />
                {strings.addLead}
              </button>
            </div>
          );
        })}
      </div>

      {/* Lost reason modal (RF-VAN-015 step 4) */}
      <Modal
        open={lostFor !== null}
        onOpenChange={(o) => !o && setLostFor(null)}
        title={strings.lostTitle}
        description={strings.lostBody}
        tone="var(--red)"
        width={440}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={() => setLostFor(null)}>
              {strings.cancel}
            </button>
            <button type="button" className="vbtn vbtn-amber vbtn-sm" disabled={!lostReason.trim()} onClick={confirmLost}>
              <MSym name="send" size={18} />
              {strings.confirm}
            </button>
          </>
        }
      >
        <div className="vfield" style={{ marginBottom: 0 }}>
          <label htmlFor="lost-reason">{strings.lostReasonLabel}</label>
          <textarea
            id="lost-reason"
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            placeholder={strings.lostReasonPlaceholder}
            rows={3}
          />
        </div>
      </Modal>

      {/* Column create/edit + delete modals (shared) */}
      <ColumnModals cols={cols} strings={columnStrings} />
    </div>
  );
}
