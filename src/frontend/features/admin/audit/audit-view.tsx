"use client";

import * as React from "react";
import {
  DataTable,
  EmptyState,
  SidePanel,
  type Column,
} from "@/frontend/components/desktop";
import { Avatar, Chip, GhostBtn, Icon } from "@/frontend/components/brand";
import { ViewHead, inputStyle } from "../shared/chrome";

/* ───────────────────────── Types ───────────────────────── */

export interface AuditEntryVM {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  actorAvatar: string | null;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string | null;
  ip: string | null;
  diff: unknown;
}

export interface AuditViewProps {
  entries: AuditEntryVM[];
  hasMore: boolean;
  /** Distinct actors/entity types for the filter selects. */
  actors: { id: string; name: string }[];
  entityTypes: string[];
  filters: { actor: string; entityType: string; action: string; from: string; to: string };
  messages: Record<string, string>;
  actions: {
    loadMore: () => void;
    setFilter: (next: Partial<AuditViewProps["filters"]>) => void;
    exportCsv: () => void;
  };
  loadingMore?: boolean;
}

/* ───────────────────────── View ───────────────────────── */

export function AuditView({
  entries,
  hasMore,
  actors,
  entityTypes,
  filters,
  messages: t,
  actions,
  loadingMore,
}: AuditViewProps) {
  const [detail, setDetail] = React.useState<AuditEntryVM | null>(null);

  const fmtWhen = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("es-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const columns: Column<AuditEntryVM>[] = [
    {
      id: "when",
      header: t.colWhen,
      width: 190,
      cell: (e) => <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{fmtWhen(e.createdAt)}</span>,
    },
    {
      id: "who",
      header: t.colWho,
      cell: (e) =>
        e.actorUserId === null ? (
          <Chip tone="blue" dot>
            {t.systemActor}
          </Chip>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar name={e.actorName ?? "?"} variant="staff" src={e.actorAvatar ?? undefined} size={26} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>
              {e.actorName ?? e.actorUserId?.slice(0, 8)}
            </span>
          </div>
        ),
    },
    {
      id: "action",
      header: t.colAction,
      cell: (e) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <code style={monoChip}>{e.action}</code>
          <span style={{ fontSize: 13, color: "var(--ink-2)" }}>{e.actionLabel}</span>
        </div>
      ),
    },
    {
      id: "entity",
      header: t.colEntity,
      cell: (e) => (
        <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
          {e.entityType}
          {e.entityId ? ` · ${e.entityId.slice(0, 8)}` : ""}
        </span>
      ),
    },
    {
      id: "ip",
      header: t.colIp,
      width: 130,
      cell: (e) => <code style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "ui-monospace, monospace" }}>{e.ip ?? "—"}</code>,
    },
    {
      id: "chev",
      header: "",
      width: 40,
      align: "right",
      cell: () => <Icon name="chevR" size={16} color="var(--ink-3)" />,
    },
  ];

  const isFiltered = !!(filters.actor || filters.entityType || filters.action || filters.from || filters.to);

  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1320 }}>
      <ViewHead title={t.title} sub={t.sub}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            borderRadius: 999,
            background: "var(--chip)",
            color: "var(--ink-3)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          <Icon name="lock" size={13} color="var(--ink-3)" />
          {t.readOnly}
        </span>
      </ViewHead>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16, alignItems: "center" }}>
        <select
          value={filters.actor}
          onChange={(e) => actions.setFilter({ actor: e.target.value })}
          style={filterSelect}
        >
          <option value="">{t.filterActor}</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={filters.entityType}
          onChange={(e) => actions.setFilter({ entityType: e.target.value })}
          style={filterSelect}
        >
          <option value="">{t.filterEntity}</option>
          {entityTypes.map((et) => (
            <option key={et} value={et}>
              {et}
            </option>
          ))}
        </select>
        <input
          value={filters.action}
          onChange={(e) => actions.setFilter({ action: e.target.value })}
          placeholder={t.filterAction}
          style={{ ...inputStyle, width: "auto", minWidth: 200 }}
        />
        <input
          type="date"
          value={filters.from}
          onChange={(e) => actions.setFilter({ from: e.target.value })}
          aria-label={t.filterFrom}
          style={{ ...inputStyle, width: "auto" }}
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => actions.setFilter({ to: e.target.value })}
          aria-label={t.filterTo}
          style={{ ...inputStyle, width: "auto" }}
        />
        <div style={{ marginLeft: "auto" }}>
          <GhostBtn size="md" full={false} icon="copy" onClick={actions.exportCsv}>
            {t.exportCsv}
          </GhostBtn>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={entries}
        rowKey={(e) => e.id}
        onRowClick={(e) => setDetail(e)}
        hasMore={hasMore}
        onLoadMore={actions.loadMore}
        loadMoreLabel={t.loadMore}
        loadingMore={loadingMore}
        empty={
          <EmptyState
            mood="calma"
            title={isFiltered ? t.emptyFiltered : t.emptyTitle}
            subtitle={isFiltered ? undefined : t.emptySub}
          />
        }
      />

      {detail && (
        <AuditDetailPanel entry={detail} open={!!detail} onClose={() => setDetail(null)} t={t} fmtWhen={fmtWhen} />
      )}
    </div>
  );
}

/* ───────────────────────── Detail + diff viewer ───────────────────────── */

function AuditDetailPanel({
  entry,
  open,
  onClose,
  t,
  fmtWhen,
}: {
  entry: AuditEntryVM;
  open: boolean;
  onClose: () => void;
  t: Record<string, string>;
  fmtWhen: (iso: string) => string;
}) {
  const [showRaw, setShowRaw] = React.useState(false);
  const diff = entry.diff as { before?: unknown; after?: unknown } | null;
  const rows = diffRows(diff);

  return (
    <SidePanel open={open} onOpenChange={(o) => !o && onClose()} title={t.detailTitle} subtitle={entry.action}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Metadata */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Meta label={t.colWho} value={entry.actorName ?? t.systemActor} />
          <Meta label={t.colAction} value={entry.actionLabel} mono={entry.action} />
          <Meta label={t.colEntity} value={`${entry.entityType}${entry.entityId ? " · " + entry.entityId : ""}`} />
          <Meta label={t.colWhen} value={fmtWhen(entry.createdAt)} />
          {entry.ip && <Meta label={t.colIp} value={entry.ip} />}
        </div>

        {/* Diff */}
        {rows.length === 0 ? (
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              background: "var(--chip)",
              fontSize: 13,
              color: "var(--ink-2)",
            }}
          >
            {t.noDiff}
          </div>
        ) : (
          <div style={{ border: "1px solid var(--line)", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={diffHead}>{t.diffField}</th>
                  <th style={diffHead}>{t.diffBefore}</th>
                  <th style={diffHead}>{t.diffAfter}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td style={{ ...diffCell, fontWeight: 700, color: "var(--ink)" }}>{r.field}</td>
                    <td style={{ ...diffCell, background: "var(--red-soft)" }}>
                      <span style={{ textDecoration: r.before ? "line-through" : "none", color: "var(--red)" }}>
                        {r.before || "—"}
                      </span>
                    </td>
                    <td style={{ ...diffCell, background: "var(--green-soft)", color: "var(--green)" }}>
                      {r.after || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)", display: "flex", gap: 6, alignItems: "center" }}>
          <Icon name="lock" size={12} color="var(--ink-3)" />
          {t.encryptedNote}
        </p>

        {/* Raw JSON */}
        <div>
          <button
            onClick={() => setShowRaw((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 13,
              color: "var(--accent)",
            }}
          >
            <Icon name="chevD" size={14} color="var(--accent)" />
            {t.viewRawJson}
          </button>
          {showRaw && (
            <pre
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 10,
                background: "var(--panel-2, var(--card-alt))",
                border: "1px solid var(--line)",
                fontSize: 11.5,
                lineHeight: 1.5,
                overflow: "auto",
                maxHeight: 280,
                color: "var(--ink-2)",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {JSON.stringify(entry.diff ?? {}, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </SidePanel>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
      <span style={{ color: "var(--ink-3)", fontWeight: 700 }}>{label}</span>
      <span style={{ color: "var(--ink)", textAlign: "right" }}>
        {mono && <code style={{ ...monoChip, marginRight: 6 }}>{mono}</code>}
        {value}
      </span>
    </div>
  );
}

/** Flattens a {before, after} diff into field rows, expanding *_i18n by locale. */
function diffRows(diff: { before?: unknown; after?: unknown } | null): { field: string; before: string; after: string }[] {
  if (!diff || (diff.before === undefined && diff.after === undefined)) return [];
  const before = (diff.before ?? {}) as Record<string, unknown>;
  const after = (diff.after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows: { field: string; before: string; after: string }[] = [];

  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (isI18n(b) || isI18n(a)) {
      const bi = (b ?? {}) as Record<string, string>;
      const ai = (a ?? {}) as Record<string, string>;
      for (const loc of ["es", "en"]) {
        const bv = bi[loc] ?? "";
        const av = ai[loc] ?? "";
        if (bv !== av) rows.push({ field: `${k} · ${loc.toUpperCase()}`, before: bv, after: av });
      }
      continue;
    }
    const bv = stringify(b);
    const av = stringify(a);
    if (bv !== av) rows.push({ field: k, before: bv, after: av });
  }
  return rows;
}

function isI18n(v: unknown): boolean {
  return typeof v === "object" && v !== null && !Array.isArray(v) && ("es" in v || "en" in v);
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/* ───────────────────────── styles ───────────────────────── */

const monoChip: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "ui-monospace, monospace",
  background: "var(--chip)",
  color: "var(--ink-2)",
  padding: "2px 7px",
  borderRadius: 7,
};

const filterSelect: React.CSSProperties = {
  ...inputStyle,
  width: "auto",
  cursor: "pointer",
  minWidth: 150,
};

const diffHead: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 11px",
  background: "var(--panel-2, var(--card-alt))",
  fontFamily: "var(--font-title)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--ink-3)",
  borderBottom: "1px solid var(--line)",
};

const diffCell: React.CSSProperties = {
  padding: "8px 11px",
  fontSize: 12.5,
  verticalAlign: "top",
  borderBottom: "1px solid var(--line-2, var(--line))",
  wordBreak: "break-word",
};
