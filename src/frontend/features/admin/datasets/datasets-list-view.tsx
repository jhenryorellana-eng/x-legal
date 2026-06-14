"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DataTable, Modal, Switch, EmptyState, toast, type Column } from "@/frontend/components/desktop";
import { GradientBtn, Icon, Chip } from "@/frontend/components/brand";
import { ViewHead, FieldLabel, TextInput, SelectInput } from "../shared/chrome";

/**
 * DatasetsListView — /admin/datasets (DOC-53 §6.1).
 *
 * PII banner + list (name · purpose · source chip · items · total tokens ·
 * used-by · status switch) + "Nuevo dataset" modal. Deactivate notice + delete
 * blocked when referenced (CATALOG_DATASET_IN_USE → offer deactivation).
 */

export interface DatasetRowVM {
  id: string;
  name: string;
  purpose: string | null;
  source_kind: string;
  item_count: number;
  total_tokens: number;
  used_by: number;
  is_active: boolean;
}

type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

export interface DatasetsListActions {
  create: (input: { name: string; purpose?: string; source_kind?: string }) => Promise<Res<{ id: string }>>;
  setActive: (id: string, isActive: boolean) => Promise<Res<unknown>>;
  remove: (id: string) => Promise<Res<unknown>>;
}

const SOURCE_LABEL: Record<string, { label: string; tone: "blue" | "gold" | "green" | "amber" }> = {
  eoir: { label: "EOIR", tone: "blue" },
  uscis: { label: "USCIS", tone: "green" },
  public_court: { label: "Corte pública", tone: "amber" },
  manual: { label: "Manual", tone: "gold" },
};

export function DatasetsListView({
  rows,
  detailBasePath,
  actions,
}: {
  rows: DatasetRowVM[];
  detailBasePath: string;
  actions: DatasetsListActions;
}) {
  const router = useRouter();
  const [list, setList] = React.useState(rows);
  const [creating, setCreating] = React.useState(false);

  async function toggleActive(row: DatasetRowVM, next: boolean) {
    setList((l) => l.map((r) => (r.id === row.id ? { ...r, is_active: next } : r)));
    const r = await actions.setActive(row.id, next);
    if (!r.success) {
      setList((l) => l.map((x) => (x.id === row.id ? { ...x, is_active: !next } : x)));
      return toast.error(r.error?.code ?? "Error");
    }
    if (!next) toast.success("Las generaciones que lo usan seguirán funcionando sin inyectarlo.");
  }

  const columns: Column<DatasetRowVM>[] = [
    { id: "name", header: "Nombre", cell: (r) => <span style={{ fontWeight: 700, color: "var(--ink)" }}>{r.name}</span> },
    { id: "purpose", header: "Propósito", cell: (r) => <span style={{ color: "var(--ink-2)" }}>{r.purpose ?? "—"}</span> },
    {
      id: "source_kind",
      header: "Fuente",
      cell: (r) => {
        const s = SOURCE_LABEL[r.source_kind] ?? { label: r.source_kind, tone: "gold" as const };
        return <Chip tone={s.tone}>{s.label}</Chip>;
      },
    },
    { id: "item_count", header: "Ítems", cell: (r) => String(r.item_count) },
    { id: "total_tokens", header: "Tokens totales", cell: (r) => compact(r.total_tokens) },
    {
      id: "used_by",
      header: "Usado por",
      cell: (r) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); router.push(`${detailBasePath}/${r.id}?tab=usos`); }}
          style={{ border: "none", background: "none", color: r.used_by > 0 ? "var(--accent)" : "var(--ink-3)", cursor: r.used_by > 0 ? "pointer" : "default", fontWeight: 700 }}
        >
          {r.used_by}
        </button>
      ),
    },
    {
      id: "is_active",
      header: "Estado",
      cell: (r) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Switch checked={r.is_active} onCheckedChange={(c) => toggleActive(r, c)} aria-label={`Estado de ${r.name}`} />
        </span>
      ),
    },
  ];

  return (
    <div style={{ padding: 28 }}>
      <ViewHead title="Datasets IA" sub="Material de referencia que tus generaciones usan como contexto.">
        <GradientBtn size="md" onClick={() => setCreating(true)}>Nuevo dataset</GradientBtn>
      </ViewHead>

      {/* PII banner (fixed, informative, non-blocking) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--gold-soft)", border: "1px solid var(--gold-deep)", borderRadius: 14, padding: "12px 16px", marginBottom: 18 }}>
        <Icon name="shield" size={17} />
        <span style={{ fontSize: 13, color: "var(--gold-deep)", fontWeight: 600 }}>
          Solo casos públicos o material anonimizado. Nunca subas PII de tus clientes a un dataset.
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState
          mood="calma"
          title="Sin datasets aún."
          subtitle="Crea uno y alimenta tus generaciones con casos ganadores."
          action={{ label: "Nuevo dataset", onClick: () => setCreating(true) }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={list}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`${detailBasePath}/${r.id}`)}
        />
      )}

      {creating && (
        <NewDatasetModal
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const r = await actions.create(input);
            if (!r.success) {
              toast.error(r.error?.code ?? "Error");
              return;
            }
            toast.success("Dataset creado");
            router.push(`${detailBasePath}/${r.data!.id}`);
          }}
        />
      )}
    </div>
  );
}

function NewDatasetModal({ onClose, onCreate }: { onClose: () => void; onCreate: (input: { name: string; purpose?: string; source_kind?: string }) => Promise<void> }) {
  const [name, setName] = React.useState("");
  const [purpose, setPurpose] = React.useState("");
  const [sourceKind, setSourceKind] = React.useState("manual");
  const [busy, setBusy] = React.useState(false);

  return (
    <Modal
      open
      onOpenChange={onClose}
      title="Nuevo dataset"
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>Cancelar</button>
          <GradientBtn size="md" disabled={!name.trim() || busy} onClick={async () => { setBusy(true); await onCreate({ name, purpose: purpose || undefined, source_kind: sourceKind }); setBusy(false); }}>Crear</GradientBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <FieldLabel>Nombre</FieldLabel>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Nombre" />
        </div>
        <div>
          <FieldLabel>Propósito</FieldLabel>
          <TextInput value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="p. ej. reforzar-asilo memorándum" aria-label="Propósito" />
        </div>
        <div>
          <FieldLabel>Tipo de fuente</FieldLabel>
          <SelectInput value={sourceKind} onChange={(e) => setSourceKind(e.target.value)} aria-label="Tipo de fuente">
            <option value="manual">Manual</option>
            <option value="eoir">EOIR</option>
            <option value="uscis">USCIS</option>
            <option value="public_court">Corte pública</option>
          </SelectInput>
        </div>
      </div>
    </Modal>
  );
}

const ghostBtn: React.CSSProperties = {
  height: 42,
  padding: "0 18px",
  borderRadius: 999,
  border: "1.5px solid var(--line)",
  background: "none",
  color: "var(--ink-2)",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
