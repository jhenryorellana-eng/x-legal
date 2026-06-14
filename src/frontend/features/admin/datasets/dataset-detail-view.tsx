"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DataTable, SidePanel, EmptyState, toast, type Column } from "@/frontend/components/desktop";
import { GradientBtn, Icon, Chip } from "@/frontend/components/brand";
import { ViewHead, FieldLabel, TextInput, SelectInput, PillTabs } from "../shared/chrome";

/**
 * DatasetDetailView — /admin/datasets/[datasetId] (DOC-53 §6.2).
 *
 * Header (name + source/status/items·tokens chips) + internal tabs Ítems · Usos.
 * Ítems: filters + table (title · jurisdiction · outcome · tags · tokens · added
 * by) + "Nuevo ítem" SidePanel with exclusive Paste/Upload content tabs (blocked
 * when both empty). Usos: generation configs referencing the dataset.
 */

export interface DatasetItemVM {
  id: string;
  title: string;
  jurisdiction: string | null;
  outcome: string | null;
  tags: string[];
  token_count: number | null;
}

export interface DatasetUsageVM {
  formId: string;
  formSlug: string;
  serviceId: string;
  phaseId: string;
}

export interface DatasetHeaderVM {
  id: string;
  name: string;
  source_kind: string;
  is_active: boolean;
  item_count: number;
  total_tokens: number;
}

type Res<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

export interface DatasetDetailActions {
  createItem: (input: {
    dataset_id: string;
    title: string;
    content?: string | null;
    file_path?: string | null;
    jurisdiction?: string | null;
    outcome?: string | null;
    tags?: string[];
  }) => Promise<Res<{ id: string; token_count: number | null }>>;
  deleteItem: (itemId: string) => Promise<Res<unknown>>;
  createUploadUrl: (input: { dataset_id: string; filename: string }) => Promise<Res<{ signedUrl: string; path: string }>>;
}

const SOURCE_LABEL: Record<string, string> = { eoir: "EOIR", uscis: "USCIS", public_court: "Corte pública", manual: "Manual" };

export function DatasetDetailView({
  header,
  items,
  usage,
  initialTab,
  catalogBasePath,
  actions,
}: {
  header: DatasetHeaderVM;
  items: DatasetItemVM[];
  usage: DatasetUsageVM[];
  initialTab: "items" | "usos";
  catalogBasePath: string;
  actions: DatasetDetailActions;
}) {
  const router = useRouter();
  const [tab, setTab] = React.useState<"items" | "usos">(initialTab);
  const [list, setList] = React.useState(items);
  const [creating, setCreating] = React.useState(false);

  // Filters (RF-ADM-039)
  const [jurisdiction, setJurisdiction] = React.useState("");
  const [outcome, setOutcome] = React.useState("");

  const jurisdictions = React.useMemo(() => [...new Set(items.map((i) => i.jurisdiction).filter(Boolean))] as string[], [items]);
  const filtered = list.filter((i) => (!jurisdiction || i.jurisdiction === jurisdiction) && (!outcome || i.outcome === outcome));

  const columns: Column<DatasetItemVM>[] = [
    { id: "title", header: "Título", cell: (i) => <span style={{ fontWeight: 700, color: "var(--ink)" }}>{i.title}</span> },
    { id: "jurisdiction", header: "Jurisdicción", cell: (i) => i.jurisdiction ?? "—" },
    {
      id: "outcome",
      header: "Resultado",
      cell: (i) => i.outcome === "granted" ? <Chip tone="green">Concedido</Chip> : i.outcome === "denied" ? <Chip tone="red">Denegado</Chip> : <span style={{ color: "var(--ink-3)" }}>—</span>,
    },
    { id: "tags", header: "Tags", cell: (i) => <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>{i.tags.slice(0, 3).map((t) => <Chip key={t} tone="blue">{t}</Chip>)}</span> },
    {
      id: "tokens",
      header: "Tokens",
      cell: (i) =>
        i.token_count === null ? (
          <span title="Sin conteo: archivo no parseable; excluido de la inyección hasta corregirlo" style={{ color: "var(--gold-deep)", cursor: "help" }}>—</span>
        ) : (
          compact(i.token_count)
        ),
    },
    {
      id: "actions",
      header: "",
      cell: (i) => (
        <button type="button" onClick={(e) => { e.stopPropagation(); deleteItem(i); }} aria-label={`Eliminar ${i.title}`} style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", display: "inline-flex" }}>
          <Icon name="x" size={16} />
        </button>
      ),
    },
  ];

  async function deleteItem(item: DatasetItemVM) {
    if (!window.confirm(`¿Eliminar "${item.title}"? Las corridas pasadas conservan su copia.`)) return;
    const r = await actions.deleteItem(item.id);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    setList((l) => l.filter((x) => x.id !== item.id));
    toast.success("Ítem eliminado");
  }

  return (
    <div style={{ padding: 28 }}>
      <ViewHead title={header.name}>
        {tab === "items" && <GradientBtn size="md" onClick={() => setCreating(true)}>Nuevo ítem</GradientBtn>}
      </ViewHead>

      {/* Header chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        <Chip tone="gold">{SOURCE_LABEL[header.source_kind] ?? header.source_kind}</Chip>
        <Chip tone={header.is_active ? "green" : "blue"}>{header.is_active ? "Activo" : "Inactivo"}</Chip>
        <span style={{ display: "inline-flex", alignItems: "center", height: 24, padding: "0 10px", borderRadius: 999, background: "var(--chip)", color: "var(--ink-2)", fontSize: 12, fontWeight: 700 }}>
          {header.item_count} ítems · {compact(header.total_tokens)} tokens totales
        </span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <PillTabs tabs={[{ id: "items" as const, label: "Ítems" }, { id: "usos" as const, label: "Usos" }]} active={tab} onChange={setTab} />
      </div>

      {tab === "items" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            <SelectInput value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} aria-label="Jurisdicción" style={{ width: "auto", minWidth: 180 }}>
              <option value="">Todas las jurisdicciones</option>
              {jurisdictions.map((j) => <option key={j} value={j}>{j}</option>)}
            </SelectInput>
            <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip)" }}>
              {[{ id: "", label: "Todos" }, { id: "granted", label: "Concedido" }, { id: "denied", label: "Denegado" }].map((o) => (
                <button key={o.id} type="button" onClick={() => setOutcome(o.id)} aria-pressed={outcome === o.id} style={{ height: 34, padding: "0 14px", borderRadius: 9, border: "none", cursor: "pointer", background: outcome === o.id ? "var(--accent-soft)" : "transparent", color: outcome === o.id ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 12.5 }}>{o.label}</button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState mood="calma" title="Sin ítems aún." subtitle="Agrega casos públicos o material anonimizado." action={{ label: "Nuevo ítem", onClick: () => setCreating(true) }} />
          ) : (
            <DataTable columns={columns} rows={filtered} rowKey={(i) => i.id} />
          )}
        </>
      )}

      {tab === "usos" && (
        <div>
          {usage.length === 0 ? (
            <EmptyState mood="calma" title="Ninguna generación usa este dataset todavía." subtitle="Asígnalo desde la configuración de una generación IA." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {usage.map((u) => (
                <button
                  key={u.formId}
                  type="button"
                  onClick={() => router.push(`${catalogBasePath}/${u.serviceId}/formularios/${u.formId}`)}
                  style={{ display: "flex", alignItems: "center", gap: 12, textAlign: "left", borderRadius: 14, border: "1px solid var(--line)", background: "var(--card,#fff)", padding: "14px 16px", cursor: "pointer" }}
                >
                  <Icon name="sparkle" size={18} color="var(--gold-deep)" />
                  <span style={{ flex: 1, fontSize: 13.5, color: "var(--ink)", fontWeight: 700 }}>{u.formSlug || u.formId}</span>
                  <Icon name="chevR" size={16} color="var(--ink-3)" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {creating && (
        <NewItemPanel
          datasetId={header.id}
          actions={actions}
          onClose={() => setCreating(false)}
          onCreated={(item) => setList((l) => [item, ...l])}
        />
      )}
    </div>
  );
}

function NewItemPanel({
  datasetId,
  actions,
  onClose,
  onCreated,
}: {
  datasetId: string;
  actions: DatasetDetailActions;
  onClose: () => void;
  onCreated: (item: DatasetItemVM) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [jurisdiction, setJurisdiction] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const [tagsInput, setTagsInput] = React.useState("");
  const [contentTab, setContentTab] = React.useState<"paste" | "upload">("paste");
  const [content, setContent] = React.useState("");
  const [filePath, setFilePath] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
  const bothEmpty = !content.trim() && !filePath;
  const canSave = title.trim() && !bothEmpty;

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const urlRes = await actions.createUploadUrl({ dataset_id: datasetId, filename: file.name });
      if (!urlRes.success) throw new Error(urlRes.error?.code);
      const put = await fetch(urlRes.data!.signedUrl, { method: "PUT", body: file });
      if (!put.ok) throw new Error("upload failed");
      setFilePath(urlRes.data!.path);
      toast.success("Archivo subido");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    const r = await actions.createItem({
      dataset_id: datasetId,
      title,
      content: contentTab === "paste" ? content || null : null,
      file_path: contentTab === "upload" ? filePath : null,
      jurisdiction: jurisdiction || null,
      outcome: outcome || null,
      tags,
    });
    setBusy(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    onCreated({ id: r.data!.id, title, jurisdiction: jurisdiction || null, outcome: outcome || null, tags, token_count: r.data!.token_count });
    if (r.data!.token_count !== null) toast.success(`Este ítem ocupa ~${compact(r.data!.token_count)} tokens de contexto.`);
    else toast.success("Ítem guardado");
    onClose();
  }

  return (
    <SidePanel
      open
      onOpenChange={onClose}
      title="Nuevo ítem"
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} style={ghostBtn}>Cancelar</button>
          <GradientBtn size="md" disabled={!canSave || busy} onClick={save}>Guardar</GradientBtn>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <FieldLabel>Título</FieldLabel>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <FieldLabel>Jurisdicción</FieldLabel>
            <TextInput value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} aria-label="Jurisdicción" />
          </div>
          <div>
            <FieldLabel>Resultado</FieldLabel>
            <SelectInput value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Resultado">
              <option value="">—</option>
              <option value="granted">Concedido</option>
              <option value="denied">Denegado</option>
            </SelectInput>
          </div>
        </div>
        <div>
          <FieldLabel>Tags (separados por coma)</FieldLabel>
          <TextInput value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="persecución, pandillas, credibilidad" aria-label="Tags" />
        </div>

        <div>
          <FieldLabel>Contenido</FieldLabel>
          <div style={{ marginBottom: 10 }}>
            <PillTabs tabs={[{ id: "paste" as const, label: "Pegar texto" }, { id: "upload" as const, label: "Subir archivo" }]} active={contentTab} onChange={setContentTab} />
          </div>
          {contentTab === "paste" ? (
            <>
              <textarea value={content} onChange={(e) => setContent(e.target.value)} aria-label="Contenido" style={{ width: "100%", minHeight: 160, borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 12, fontSize: 13, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }} />
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--ink-3)", textAlign: "right" }}>{content.length} caracteres</p>
            </>
          ) : (
            <div onClick={() => inputRef.current?.click()} style={{ border: "2px dashed var(--line)", borderRadius: 14, padding: "28px 16px", textAlign: "center", cursor: "pointer", background: "var(--panel-2, var(--card-alt))" }}>
              <Icon name="upload" size={28} color="var(--accent)" />
              <p style={{ margin: "8px 0 0", fontSize: 13, color: filePath ? "var(--green)" : "var(--ink-2)" }}>{filePath ? "Archivo subido ✓" : "Haz clic para subir un archivo"}</p>
              <input ref={inputRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} aria-label="Subir archivo" />
            </div>
          )}
          {bothEmpty && <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--gold-deep)" }}>Pega texto o sube un archivo.</p>}
        </div>
      </div>
    </SidePanel>
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
