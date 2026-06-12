"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { Skeleton } from "./skeleton";

/**
 * DataTable — generic staff table (DOC-01 §5.3, DOC-53 §0.6).
 *
 * Sticky header (12px/800 uppercase ink-3), hover rows (`--hover`), `--line-2`
 * borders, 13–14px cells. Sorting is client-controlled per column via
 * `sortable` (the caller decides what "sorted" means — server query or local).
 * Pagination is ALWAYS cursor-based ("Cargar más"); never offset (DOC-48 §1.4).
 *
 * Generic over the row type `T`; columns render their own cell from the row.
 */

export type SortDir = "asc" | "desc";

export interface Column<T> {
  /** Stable id, also used as the sort key reported to `onSortChange`. */
  id: string;
  header: React.ReactNode;
  /** Cell renderer. */
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Fixed column width (px) or any CSS width. */
  width?: number | string;
  align?: "left" | "right" | "center";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Current sort state (controlled). */
  sort?: { id: string; dir: SortDir };
  onSortChange?: (sort: { id: string; dir: SortDir }) => void;
  /** Cursor pagination — show "Cargar más" when there is a next page. */
  hasMore?: boolean;
  onLoadMore?: () => void;
  loadMoreLabel?: string;
  /** Loading state for the INITIAL load (renders skeleton rows). */
  loading?: boolean;
  loadingMore?: boolean;
  skeletonRows?: number;
  /** Empty slot (e.g. EmptyState) when there are no rows and not loading. */
  empty?: React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sort,
  onSortChange,
  hasMore = false,
  onLoadMore,
  loadMoreLabel = "Cargar más",
  loading = false,
  loadingMore = false,
  skeletonRows = 8,
  empty,
}: DataTableProps<T>) {
  function toggleSort(col: Column<T>) {
    if (!col.sortable || !onSortChange) return;
    const nextDir: SortDir =
      sort?.id === col.id && sort.dir === "asc" ? "desc" : "asc";
    onSortChange({ id: col.id, dir: nextDir });
  }

  const showEmpty = !loading && rows.length === 0;

  return (
    <div
      style={{
        background: "var(--panel, var(--card))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        overflow: "hidden",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: "var(--font-body)",
          }}
        >
          <thead>
            <tr>
              {columns.map((col) => {
                const active = sort?.id === col.id;
                return (
                  <th
                    key={col.id}
                    aria-sort={
                      active
                        ? sort?.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : col.sortable
                          ? "none"
                          : undefined
                    }
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      textAlign: col.align ?? "left",
                      width: col.width,
                      background: "var(--panel-2, var(--card-alt))",
                      borderBottom: "1px solid var(--line)",
                      padding: "11px 16px",
                      fontFamily: "var(--font-title)",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.04em",
                      textTransform: "uppercase",
                      color: "var(--ink-3)",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          background: "none",
                          border: "none",
                          padding: 0,
                          cursor: "pointer",
                          font: "inherit",
                          letterSpacing: "inherit",
                          textTransform: "inherit",
                          color: active ? "var(--accent)" : "var(--ink-3)",
                        }}
                      >
                        {col.header}
                        <Icon
                          name="chevD"
                          size={13}
                          color="currentColor"
                          stroke={2.6}
                          className={
                            active && sort?.dir === "asc"
                              ? "dt-sort-asc"
                              : undefined
                          }
                        />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {loading
              ? Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        style={{
                          padding: "13px 16px",
                          borderBottom: "1px solid var(--line-2, var(--line))",
                        }}
                      >
                        <Skeleton height={14} width={col.id === columns[0].id ? "70%" : "50%"} />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    onClick={
                      onRowClick ? () => onRowClick(row) : undefined
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    className="dt-row"
                    style={{
                      cursor: onRowClick ? "pointer" : "default",
                      transition: "background-color 0.14s var(--ease)",
                    }}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        style={{
                          textAlign: col.align ?? "left",
                          padding: "13px 16px",
                          borderBottom: "1px solid var(--line-2, var(--line))",
                          fontSize: 14,
                          color: "var(--ink)",
                          verticalAlign: "middle",
                        }}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {showEmpty && empty && <div style={{ padding: 4 }}>{empty}</div>}

      {hasMore && !loading && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "14px 16px",
            borderTop: "1px solid var(--line-2, var(--line))",
          }}
        >
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 40,
              padding: "0 20px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--panel-2, var(--card-alt))",
              color: "var(--accent)",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 14,
              cursor: loadingMore ? "default" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? "…" : loadMoreLabel}
          </button>
        </div>
      )}
    </div>
  );
}
