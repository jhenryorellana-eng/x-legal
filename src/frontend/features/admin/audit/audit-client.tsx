"use client";

import * as React from "react";
import { toast } from "@/frontend/components/desktop";
import { AuditView, type AuditEntryVM } from "./audit-view";

/* Raw row from the audit module (DB shape). */
export interface AuditRow {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  ip: unknown;
  diff: unknown;
}

export interface AuditFilters {
  actorUserId?: string | null;
  entityType?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
  cursor?: string;
}

export interface AuditClientProps {
  initialRows: AuditRow[];
  initialNextCursor: string | null;
  actors: { id: string; name: string; avatar: string | null }[];
  entityTypes: string[];
  messages: Record<string, string>;
  actions: {
    loadPage: (filters: AuditFilters) => Promise<{
      ok: boolean;
      items?: AuditRow[];
      nextCursor?: string | null;
      error?: { code: string; message: string };
    }>;
    exportCsv: (filters: AuditFilters) => Promise<{
      ok: boolean;
      csv?: string;
      error?: { code: string; message: string };
    }>;
  };
}

/**
 * Client orchestrator for the audit view (DOC-53 §8): keeps the filter +
 * pagination state, humanizes action codes and actor names, triggers CSV export
 * as a Blob download. The presentational table/diff live in AuditView.
 */
export function AuditClient({
  initialRows,
  initialNextCursor,
  actors,
  entityTypes,
  messages,
  actions,
}: AuditClientProps) {
  const [rows, setRows] = React.useState<AuditRow[]>(initialRows);
  const [nextCursor, setNextCursor] = React.useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [uiFilters, setUiFilters] = React.useState({
    actor: "",
    entityType: "",
    action: "",
    from: "",
    to: "",
  });

  const actorMap = React.useMemo(() => {
    const m = new Map<string, { name: string; avatar: string | null }>();
    for (const a of actors) m.set(a.id, { name: a.name, avatar: a.avatar });
    return m;
  }, [actors]);

  const toApiFilters = React.useCallback(
    (cursor?: string): AuditFilters => ({
      actorUserId: uiFilters.actor || undefined,
      entityType: uiFilters.entityType || undefined,
      action: uiFilters.action || undefined,
      fromDate: uiFilters.from ? new Date(uiFilters.from).toISOString() : undefined,
      toDate: uiFilters.to ? new Date(uiFilters.to + "T23:59:59").toISOString() : undefined,
      cursor,
    }),
    [uiFilters],
  );

  // Re-query whenever the user-facing filters change.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await actions.loadPage(toApiFilters());
      if (cancelled) return;
      if (r.ok) {
        setRows(r.items ?? []);
        setNextCursor(r.nextCursor ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uiFilters]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    const r = await actions.loadPage(toApiFilters(nextCursor));
    setLoadingMore(false);
    if (r.ok) {
      setRows((prev) => [...prev, ...(r.items ?? [])]);
      setNextCursor(r.nextCursor ?? null);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  async function exportCsv() {
    const r = await actions.exportCsv(toApiFilters());
    if (r.ok && r.csv != null) {
      const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      toast.error(r.error?.message ?? "Error");
    }
  }

  const entries: AuditEntryVM[] = rows.map((row) => {
    const actor = row.actor_user_id ? actorMap.get(row.actor_user_id) : null;
    return {
      id: row.id,
      createdAt: row.created_at,
      actorUserId: row.actor_user_id,
      actorName: actor?.name ?? null,
      actorAvatar: actor?.avatar ?? null,
      action: row.action,
      actionLabel: humanizeAction(row.action),
      entityType: row.entity_type,
      entityId: row.entity_id,
      ip: row.ip != null ? String(row.ip) : null,
      diff: row.diff,
    };
  });

  return (
    <AuditView
      entries={entries}
      hasMore={nextCursor !== null}
      actors={actors.map((a) => ({ id: a.id, name: a.name }))}
      entityTypes={entityTypes}
      filters={uiFilters}
      messages={messages}
      loadingMore={loadingMore}
      actions={{
        loadMore,
        setFilter: (next) => setUiFilters((prev) => ({ ...prev, ...next })),
        exportCsv,
      }}
    />
  );
}

/** Maps a dotted action code to a short human label (best-effort, ES). */
function humanizeAction(action: string): string {
  const MAP: Record<string, string> = {
    "catalog.service.created": "Servicio creado",
    "catalog.service.updated": "Servicio actualizado",
    "catalog.service.activated": "Servicio activado",
    "catalog.service.deactivated": "Servicio desactivado",
    "catalog.service.archived": "Servicio archivado",
    "catalog.service.restored": "Servicio restaurado",
    "catalog.plan.updated": "Plan actualizado",
    "catalog.phase.created": "Fase creada",
    "catalog.phase.updated": "Fase actualizada",
    "catalog.form_version.published": "Versión publicada",
    "org.settings.updated": "Configuración actualizada",
    "org.terms_version.created": "T&C creados",
    "org.terms_version.published": "T&C publicados",
    "org.cover_template.updated": "Carátula actualizada",
    invite: "Empleado invitado",
    update_permissions: "Permisos actualizados",
    deactivate: "Empleado desactivado",
    reactivate: "Empleado reactivado",
  };
  return MAP[action] ?? action.split(".").pop()?.replace(/_/g, " ") ?? action;
}
