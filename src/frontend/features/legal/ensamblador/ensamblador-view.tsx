"use client";

/**
 * EnsambladorView — paralegal Diana's case-file assembly screen.
 *
 * Two-column layout:
 *   LEFT  — material library (cover generator + 4 material groups)
 *   RIGHT — ordered expediente items with inline editing, TOC toggle,
 *            up/down reorder, and remove.
 *
 * Mirrors the structure/style/error-handling of case-forms-manager.tsx.
 */

import * as React from "react";
import {
  Card,
  GradientBtn,
  GhostBtn,
  StatusPill,
  Chip,
  Lex,
  type StatusKind,
} from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";

// ---------------------------------------------------------------------------
// VM types (fed from the server component)
// ---------------------------------------------------------------------------

export interface MaterialItem {
  refId: string;
  title: string;
  createdAt: string;
}

export interface EnsambladorVM {
  expediente: {
    id: string;
    attemptNo: number;
    status: string;
    hasPdf: boolean;
  } | null;
  items: ItemVM[];
  material: {
    covers: MaterialItem[];
    generations: MaterialItem[];
    forms: MaterialItem[];
    documents: MaterialItem[];
  };
  coverTemplates: { id: string; name: string }[];
}

export interface ItemVM {
  id: string;
  itemType: string;
  title: string;
  position: number;
  includeInToc: boolean;
  pageCount: number | null;
}

// ---------------------------------------------------------------------------
// Actions shape (injected from server component)
// ---------------------------------------------------------------------------

export interface EnsambladorActions {
  createExpediente: (input: { caseId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  generateCover: (input: { caseId: string; templateId: string; data: Record<string, unknown> }) => Promise<{ ok: boolean; error?: { code: string } }>;
  addItem: (input: { expedienteId: string; itemType: "cover" | "ai_generation" | "automated_form" | "client_document" | "external_file"; refId?: string; title: string; includeInToc?: boolean }) => Promise<{ ok: boolean; error?: { code: string } }>;
  removeItem: (input: { itemId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  reorderItems: (input: { expedienteId: string; orderedItemIds: string[] }) => Promise<{ ok: boolean; error?: { code: string } }>;
  updateItem: (input: { itemId: string; title?: string; includeInToc?: boolean }) => Promise<{ ok: boolean; error?: { code: string } }>;
  compileExpediente: (input: { expedienteId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  getCompiledPdfUrl: (input: { expedienteId: string }) => Promise<{ ok: boolean; data?: string; error?: { code: string } }>;
  createCorrectionAttempt: (input: { expedienteId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface EnsambladorViewProps {
  caseId: string;
  vm: EnsambladorVM;
  actions: EnsambladorActions;
}

// ---------------------------------------------------------------------------
// Status → StatusPill mapping
// ---------------------------------------------------------------------------

const STATUS_PILL: Record<string, { kind: StatusKind; label: string }> = {
  draft:               { kind: "pendiente", label: "Borrador" },
  compiling:           { kind: "revision",  label: "Compilando…" },
  compiled:            { kind: "aprobado",  label: "Compilado" },
  compile_failed:      { kind: "corregir",  label: "Falló la compilación" },
  sent_to_lawyer:      { kind: "revision",  label: "En validación" },
  corrections_needed:  { kind: "corregir",  label: "Necesita correcciones" },
  approved:            { kind: "aprobado",  label: "Aprobado" },
  sent_to_finance:     { kind: "hecho",     label: "En impresión" },
  printed:             { kind: "hecho",     label: "Impreso" },
};

// ---------------------------------------------------------------------------
// Error code → friendly message
// ---------------------------------------------------------------------------

function errorMessage(code: string): string {
  switch (code) {
    case "EXPEDIENTE_COMPILE_FAILED":   return "No se pudo compilar el expediente.";
    case "EXPEDIENTE_NOT_EDITABLE":     return "El expediente ya no es editable.";
    case "EXPEDIENTE_DRAFT_EXISTS":     return "Ya existe un borrador.";
    default:                            return "Algo salió mal.";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

const EDITABLE_STATUSES = new Set(["draft", "corrections_needed"]);

// ---------------------------------------------------------------------------
// Sub-component: MaterialSection
// ---------------------------------------------------------------------------

interface MaterialSectionProps {
  title: string;
  items: MaterialItem[];
  emptyText: string;
  onAdd: (item: MaterialItem) => Promise<void>;
  busy: string | null;
  editable: boolean;
}

function MaterialSection({ title, items, emptyText, onAdd, busy, editable }: MaterialSectionProps) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 13, fontWeight: 800, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>
        {title}
      </p>
      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>{emptyText}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((it) => (
            <div
              key={it.refId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--card)",
                border: "1px solid var(--line)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {it.title}
                </p>
                <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: 0 }}>{formatDate(it.createdAt)}</p>
              </div>
              {editable && (
                <GhostBtn
                  size="md"
                  full={false}
                  disabled={busy === it.refId}
                  onClick={() => onAdd(it)}
                  style={{ fontSize: 13, height: 32, padding: "0 14px", flexShrink: 0 }}
                >
                  {busy === it.refId ? "…" : "Agregar →"}
                </GhostBtn>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: InlineEditTitle
// ---------------------------------------------------------------------------

interface InlineEditTitleProps {
  value: string;
  onSave: (next: string) => Promise<void>;
  disabled: boolean;
}

function InlineEditTitle({ value, onSave, disabled }: InlineEditTitleProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  async function handleBlur() {
    setEditing(false);
    if (draft.trim() && draft !== value) {
      await onSave(draft.trim());
    } else {
      setDraft(value);
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur(); } }}
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--ink)",
          background: "var(--card)",
          border: "1px solid var(--accent)",
          borderRadius: 4,
          padding: "2px 6px",
          outline: "none",
          width: "100%",
          fontFamily: "inherit",
        }}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (!disabled) setEditing(true); }}
      title={disabled ? undefined : "Clic para editar el título"}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: disabled ? "default" : "pointer",
        fontSize: 14,
        fontWeight: 700,
        color: "var(--ink)",
        textAlign: "left",
        width: "100%",
        fontFamily: "inherit",
      }}
    >
      {value}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EnsambladorView({ caseId, vm, actions }: EnsambladorViewProps) {
  // Per-action busy keys (null = idle)
  const [busyCreate, setBusyCreate] = React.useState(false);
  const [busyMaterial, setBusyMaterial] = React.useState<string | null>(null);
  const [busyCover, setBusyCover] = React.useState(false);
  const [busyItem, setBusyItem] = React.useState<string | null>(null);
  const [busyCompile, setBusyCompile] = React.useState(false);
  const [busyPdf, setBusyPdf] = React.useState(false);
  const [busyCorrection, setBusyCorrection] = React.useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string>(
    vm.coverTemplates[0]?.id ?? "",
  );

  // -------------------------------------------------------------------------
  // No expediente yet — empty state
  // -------------------------------------------------------------------------
  if (!vm.expediente) {
    return (
      <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--ink-2)" }}>
        <Lex mood="calma" size={110} />
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 12 }}>
          Este caso aun no tiene expediente
        </h3>
        <p style={{ fontSize: 13.5, marginTop: 6, marginBottom: 20 }}>
          Crea el primer borrador para comenzar a ensamblar el expediente.
        </p>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <GradientBtn
            size="md"
            full={false}
            disabled={busyCreate}
            onClick={async () => {
              setBusyCreate(true);
              const r = await actions.createExpediente({ caseId });
              setBusyCreate(false);
              if (r.ok) {
                window.location.reload();
              } else {
                toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
              }
            }}
          >
            {busyCreate ? "Creando…" : "Crear expediente"}
          </GradientBtn>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Expediente exists
  // -------------------------------------------------------------------------
  const { id: expedienteId, attemptNo, status, hasPdf } = vm.expediente;
  const pill = STATUS_PILL[status] ?? { kind: "pendiente" as StatusKind, label: status };
  const editable = EDITABLE_STATUSES.has(status);

  // ---- Compile action ----
  async function handleCompile() {
    setBusyCompile(true);
    const r = await actions.compileExpediente({ expedienteId });
    setBusyCompile(false);
    if (r.ok) {
      toast.success("Compilacion iniciada. Recargando…");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- View PDF action ----
  async function handleViewPdf() {
    setBusyPdf(true);
    const r = await actions.getCompiledPdfUrl({ expedienteId });
    setBusyPdf(false);
    if (r.ok && r.data) {
      window.open(r.data, "_blank", "noopener");
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Create correction ----
  async function handleCreateCorrection() {
    setBusyCorrection(true);
    const r = await actions.createCorrectionAttempt({ expedienteId });
    setBusyCorrection(false);
    if (r.ok) {
      toast.success("Nueva correccion creada.");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Generate cover ----
  async function handleGenerateCover() {
    if (!selectedTemplateId) {
      toast.error("Selecciona una plantilla de caratula.");
      return;
    }
    setBusyCover(true);
    const r = await actions.generateCover({ caseId, templateId: selectedTemplateId, data: {} });
    setBusyCover(false);
    if (r.ok) {
      toast.success("Caratula generada. Recargando…");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Add material item ----
  async function handleAddMaterial(
    itemType: "cover" | "ai_generation" | "automated_form" | "client_document",
    mat: MaterialItem,
  ) {
    setBusyMaterial(mat.refId);
    const r = await actions.addItem({
      expedienteId,
      itemType,
      refId: mat.refId,
      title: mat.title,
      includeInToc: true,
    });
    setBusyMaterial(null);
    if (r.ok) {
      toast.success("Item agregado.");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Remove item ----
  async function handleRemoveItem(itemId: string) {
    setBusyItem(itemId + ":remove");
    const r = await actions.removeItem({ itemId });
    setBusyItem(null);
    if (r.ok) {
      toast.success("Item eliminado.");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Reorder (move up / move down) ----
  async function handleMove(itemId: string, direction: "up" | "down") {
    const ids = vm.items.map((it) => it.id);
    const idx = ids.indexOf(itemId);
    if (idx < 0) return;
    const newIds = [...ids];
    if (direction === "up" && idx > 0) {
      [newIds[idx - 1], newIds[idx]] = [newIds[idx], newIds[idx - 1]];
    } else if (direction === "down" && idx < newIds.length - 1) {
      [newIds[idx], newIds[idx + 1]] = [newIds[idx + 1], newIds[idx]];
    } else {
      return;
    }
    setBusyItem(itemId + ":move");
    const r = await actions.reorderItems({ expedienteId, orderedItemIds: newIds });
    setBusyItem(null);
    if (r.ok) {
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Update title ----
  async function handleUpdateTitle(itemId: string, title: string) {
    const r = await actions.updateItem({ itemId, title });
    if (r.ok) {
      toast.success("Título actualizado.");
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  // ---- Toggle TOC ----
  async function handleToggleToc(item: ItemVM) {
    setBusyItem(item.id + ":toc");
    const r = await actions.updateItem({ itemId: item.id, includeInToc: !item.includeInToc });
    setBusyItem(null);
    if (r.ok) {
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED"));
    }
  }

  const canCompile = editable && vm.items.length > 0;

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Header row                                                           */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            padding: 4,
          }}
        >
          {/* Left: title + chips */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 16,
                  fontWeight: 900,
                  color: "var(--ink)",
                  fontFamily: "var(--font-title)",
                }}
              >
                Expediente
              </span>
              <Chip tone="blue">{"Intento " + String(attemptNo)}</Chip>
              <StatusPill kind={pill.kind}>{pill.label}</StatusPill>
            </div>
          </div>

          {/* Right: header actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {status === "corrections_needed" && (
              <GhostBtn
                size="md"
                full={false}
                disabled={busyCorrection}
                onClick={handleCreateCorrection}
              >
                {busyCorrection ? "Creando…" : "Crear corrección"}
              </GhostBtn>
            )}
            {hasPdf && (
              <GhostBtn
                size="md"
                full={false}
                disabled={busyPdf}
                onClick={handleViewPdf}
              >
                {busyPdf ? "Cargando…" : "Ver PDF ↗"}
              </GhostBtn>
            )}
            {canCompile && (
              <GradientBtn
                size="md"
                full={false}
                disabled={busyCompile}
                onClick={handleCompile}
              >
                {busyCompile ? "Compilando…" : "Compilar"}
              </GradientBtn>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Two-column grid                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 20,
          marginTop: 20,
          alignItems: "start",
        }}
      >
        {/* ---------------------------------------------------------------- */}
        {/* LEFT — Material disponible                                        */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <div style={{ padding: 4 }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
                marginBottom: 16,
              }}
            >
              Material disponible
            </p>

            {/* Cover generator */}
            <div style={{ marginBottom: 20 }}>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "var(--ink-2)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom: 8,
                }}
              >
                Generar caratula
              </p>
              {vm.coverTemplates.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
                  No hay plantillas de caratula. El administrador debe crearlas.
                </p>
              ) : (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    disabled={!editable || busyCover}
                    style={{
                      flex: 1,
                      minWidth: 120,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "var(--ink)",
                      background: "var(--card)",
                      border: "1px solid var(--line)",
                      borderRadius: 6,
                      padding: "6px 10px",
                      cursor: editable ? "pointer" : "default",
                      opacity: editable ? 1 : 0.5,
                      fontFamily: "inherit",
                    }}
                  >
                    {vm.coverTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <GhostBtn
                    size="md"
                    full={false}
                    disabled={!editable || busyCover}
                    onClick={handleGenerateCover}
                    style={{ fontSize: 13, height: 34, padding: "0 14px" }}
                  >
                    {busyCover ? "Generando…" : "Generar caratula"}
                  </GhostBtn>
                </div>
              )}
            </div>

            {/* Caratulas */}
            <MaterialSection
              title="Caratulas"
              items={vm.material.covers}
              emptyText="No hay caratulas generadas aun."
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("cover", it)}
            />

            {/* Cartas IA */}
            <MaterialSection
              title="Cartas IA"
              items={vm.material.generations}
              emptyText="No hay generaciones IA completadas."
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("ai_generation", it)}
            />

            {/* Formularios */}
            <MaterialSection
              title="Formularios"
              items={vm.material.forms}
              emptyText="No hay formularios con PDF generado."
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("automated_form", it)}
            />

            {/* Documentos del cliente */}
            <MaterialSection
              title="Documentos"
              items={vm.material.documents}
              emptyText="No hay documentos aprobados del cliente."
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("client_document", it)}
            />
          </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* RIGHT — Expediente (orden)                                        */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <div style={{ padding: 4 }}>
            <p
              style={{
                fontSize: 15,
                fontWeight: 900,
                color: "var(--ink)",
                fontFamily: "var(--font-title)",
                marginBottom: 16,
              }}
            >
              {"Expediente (orden)"}
            </p>

            {vm.items.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "32px 16px",
                  color: "var(--ink-3)",
                  border: "1.5px dashed var(--line)",
                  borderRadius: 10,
                }}
              >
                <p style={{ fontSize: 13.5 }}>
                  Agrega material de la izquierda para armar el expediente.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {vm.items.map((item, idx) => {
                  const isBusyThis = busyItem?.startsWith(item.id);
                  return (
                    <div
                      key={item.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 12px",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--card)",
                        opacity: isBusyThis ? 0.6 : 1,
                        transition: "opacity 0.15s",
                      }}
                    >
                      {/* Position badge */}
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 999,
                          background: "var(--blue-soft)",
                          color: "var(--accent)",
                          fontSize: 12,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontFamily: "var(--font-title)",
                        }}
                      >
                        {String(idx + 1)}
                      </span>

                      {/* Title (editable) */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineEditTitle
                          value={item.title}
                          disabled={!editable || !!isBusyThis}
                          onSave={(t) => handleUpdateTitle(item.id, t)}
                        />
                        {item.pageCount != null && (
                          <p style={{ fontSize: 11, color: "var(--ink-3)", margin: 0 }}>
                            {String(item.pageCount)} p.
                          </p>
                        )}
                      </div>

                      {/* TOC toggle */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis}
                        title={item.includeInToc ? "Quitar del TOC" : "Incluir en TOC"}
                        onClick={() => handleToggleToc(item)}
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: 6,
                          border: "1.5px solid var(--line)",
                          background: item.includeInToc ? "var(--accent)" : "var(--card)",
                          color: item.includeInToc ? "#fff" : "var(--ink-3)",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: editable ? "pointer" : "default",
                          opacity: editable ? 1 : 0.4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontFamily: "var(--font-title)",
                          transition: "background 0.15s",
                        }}
                      >
                        TOC
                      </button>

                      {/* Up / Down */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis || idx === 0}
                        title="Subir"
                        onClick={() => handleMove(item.id, "up")}
                        aria-label="Subir item"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          background: "var(--card)",
                          color: "var(--ink-2)",
                          fontSize: 14,
                          cursor: editable && idx > 0 ? "pointer" : "default",
                          opacity: editable && idx > 0 ? 1 : 0.3,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {"↑"}
                      </button>
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis || idx === vm.items.length - 1}
                        title="Bajar"
                        onClick={() => handleMove(item.id, "down")}
                        aria-label="Bajar item"
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          background: "var(--card)",
                          color: "var(--ink-2)",
                          fontSize: 14,
                          cursor: editable && idx < vm.items.length - 1 ? "pointer" : "default",
                          opacity: editable && idx < vm.items.length - 1 ? 1 : 0.3,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {"↓"}
                      </button>

                      {/* Remove */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis}
                        title="Eliminar item"
                        aria-label="Eliminar item"
                        onClick={() => handleRemoveItem(item.id)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 6,
                          border: "1px solid var(--line)",
                          background: "var(--card)",
                          color: "var(--red)",
                          fontSize: 15,
                          cursor: editable ? "pointer" : "default",
                          opacity: editable ? 1 : 0.3,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {"×"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
