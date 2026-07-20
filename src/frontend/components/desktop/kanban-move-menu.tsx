"use client";

/**
 * KanbanMoveMenu — per-card "Mover a…" dropdown (DOC-01 §5.3 KanbanCard).
 *
 * The kanban boards move cards with HTML5 drag & drop, which is unusable on
 * touch devices and unreachable from the keyboard. This menu is the required
 * accessible alternative: every board card renders it, listing every column
 * except the current one; selecting a column calls `onMove(columnId)` with
 * the same mutation the drop path uses.
 *
 * The trigger is an icon button styled by the caller (`triggerClassName` —
 * boards pass the `.kmini` kanban mini-action class, which grows to a 44px
 * touch target on coarse pointers). Pointer/mouse/key events are stopped from
 * propagating so the menu never starts the card's HTML5 drag, fires the
 * card's click handler, or triggers the card's Enter-to-open shortcut. The
 * content is portaled by Radix but still bubbles through the React tree, so
 * its interactions are stopped too.
 *
 * Small and dumb: no data fetching, no board logic.
 */

import * as React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/frontend/components/ui/dropdown-menu";
import { MSym } from "@/frontend/features/vanessa/shared/msym";

export interface KanbanMoveMenuColumn {
  id: string;
  title: string;
}

export interface KanbanMoveMenuProps {
  /** All columns of the board (the current one is filtered out). */
  columns: KanbanMoveMenuColumn[];
  currentColumnId: string;
  onMove: (columnId: string) => void;
  locale: "es" | "en";
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

export function KanbanMoveMenu({
  columns,
  currentColumnId,
  onMove,
  locale,
  triggerClassName,
  triggerStyle,
}: KanbanMoveMenuProps) {
  const targets = columns.filter((c) => c.id !== currentColumnId);
  if (targets.length === 0) return null;
  const label = tt(locale, "Mover a…", "Move to…");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClassName}
          style={triggerStyle}
          aria-label={label}
          title={label}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MSym name="more_vert" size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {targets.map((col) => (
          <DropdownMenuItem key={col.id} onSelect={() => onMove(col.id)}>
            {col.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
