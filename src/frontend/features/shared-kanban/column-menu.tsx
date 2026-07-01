"use client";

/**
 * ColumnMenu — the per-column ⋯ popover (edit / delete / move left-right).
 *
 * WCAG 2.1.1: the move-left/right items are the keyboard/pointer-accessible
 * alternative to dragging the column header. Shared by every kanban board.
 */

import * as React from "react";
import { MSym } from "@/frontend/features/vanessa/shared/msym";
import type { KanbanColumnVM, KanbanColumnStrings } from "./types";

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

export interface ColumnMenuProps {
  col: KanbanColumnVM;
  isLast: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  onEdit: () => void;
  onDelete: () => void;
  strings: KanbanColumnStrings;
}

export function ColumnMenu({
  col,
  isLast,
  canMoveLeft,
  canMoveRight,
  onMoveLeft,
  onMoveRight,
  onEdit,
  onDelete,
  strings,
}: ColumnMenuProps) {
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
        aria-label={strings.colMenuAria.replace("{title}", col.title)}
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
            {strings.colMenuMoveLeft}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canMoveRight}
            style={menuItemStyle(!canMoveRight)}
            onClick={() => { if (canMoveRight) { setOpen(false); onMoveRight(); } }}
          >
            <MSym name="chevron_right" size={16} />
            {strings.colMenuMoveRight}
          </button>
          <button
            type="button"
            role="menuitem"
            style={menuItemStyle(false)}
            onClick={() => { setOpen(false); onEdit(); }}
          >
            <MSym name="edit" size={16} />
            {strings.colMenuEdit}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isLast}
            title={isLast ? strings.delLastColumn : undefined}
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
            {strings.colMenuDelete}
          </button>
        </div>
      )}
    </div>
  );
}
