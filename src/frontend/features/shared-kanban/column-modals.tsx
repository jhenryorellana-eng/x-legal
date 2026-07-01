"use client";

/**
 * ColumnModals — the create/edit modal (name + color swatches) and the
 * delete-with-migration modal, driven by `useKanbanColumns` state. Rendered
 * once per board; shared across every kanban board.
 */

import * as React from "react";
import { Modal } from "@/frontend/components/desktop";
import { tokenToVar, COLOR_SWATCHES } from "./column-color";
import type { KanbanColumnStrings } from "./types";
import type { UseKanbanColumnsResult } from "./use-kanban-columns";

export interface ColumnModalsProps {
  cols: UseKanbanColumnsResult;
  strings: KanbanColumnStrings;
}

export function ColumnModals({ cols, strings }: ColumnModalsProps) {
  const { colModal } = cols;

  return (
    <>
      {/* ── Create / edit column ── */}
      <Modal
        open={colModal.kind === "create" || colModal.kind === "edit"}
        onOpenChange={(o) => !o && cols.closeModal()}
        title={colModal.kind === "edit" ? strings.colModalEditTitle : strings.colModalCreateTitle}
        width={400}
        footer={
          <>
            <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={cols.closeModal}>
              {strings.colCancel}
            </button>
            <button
              type="button"
              className="vbtn vbtn-primary vbtn-sm"
              disabled={cols.colBusy}
              onClick={cols.handleColSave}
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
            value={cols.colLabel}
            onChange={(e) => cols.setColLabel(e.target.value)}
            placeholder={strings.colNamePh}
          />
          {cols.colLabelError && (
            <span style={{ color: "var(--red)", fontSize: 12 }}>{cols.colLabelError}</span>
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
                aria-pressed={cols.colColor === swatch}
                onClick={() => cols.setColColor(swatch)}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: tokenToVar(swatch),
                  border: cols.colColor === swatch ? "3px solid var(--ink)" : "3px solid transparent",
                  cursor: "pointer",
                  outline: cols.colColor === swatch ? "2px solid var(--accent)" : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>
      </Modal>

      {/* ── Delete column ── */}
      {colModal.kind === "delete" && (
        <Modal
          open
          onOpenChange={(o) => !o && cols.closeModal()}
          title={`${strings.delModalTitle} "${colModal.label}"?`}
          tone="var(--red)"
          width={420}
          footer={
            <>
              <button type="button" className="vbtn vbtn-ghost vbtn-sm" onClick={cols.closeModal}>
                {strings.delCancel}
              </button>
              <button
                type="button"
                className="vbtn vbtn-amber vbtn-sm"
                disabled={cols.colBusy || (colModal.cardCount > 0 && !cols.migrateTarget)}
                onClick={cols.handleColDelete}
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
                  value={cols.migrateTarget}
                  onChange={(e) => cols.setMigrateTarget(e.target.value)}
                >
                  {cols.columns
                    .filter((c) => c.id !== colModal.columnId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                </select>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
