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
import { useTranslations, useLocale } from "next-intl";
import { getBridge } from "@/frontend/platform-bridge";
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

// Shared translator type for module-level helpers (next-intl `t` signature).
type T = (key: string, values?: Record<string, string | number>) => string;

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
  /** Case parties — for per-party covers (subtitle = party name, e.g. each minor). */
  parties: { id: string; name: string; role: string }[];
  /** Auto-downloaded exhibits (anexos) for this case — Diana's status panel. */
  exhibits: ExhibitVM[];
}

export interface ExhibitVM {
  id: string;
  exhibitLabel: string | null;
  sourceKind: string;
  title: string | null;
  publisher: string | null;
  sourceUrl: string;
  status: string; // pending | fetching | ready | failed | manual
  pageCount: number | null;
  lastError: string | null;
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
  autoAssembleWithAi: (input: { caseId: string; replace?: boolean }) => Promise<{ ok: boolean; data?: { coversCreated: number; itemsCreated: number; unresolved: string[] }; error?: { code: string } }>;
  deleteCoverItem: (input: { itemId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  regenerateCover: (input: { itemId: string; title?: string; subtitle?: string; partyId?: string | null }) => Promise<{ ok: boolean; error?: { code: string } }>;
  markReady: (input: { expedienteId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  retryExhibit: (input: { exhibitId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  createExhibitUploadUrl: (input: { exhibitId: string }) => Promise<{ ok: boolean; data?: { signedUrl: string; path: string }; error?: { code: string } }>;
  confirmManualExhibit: (input: { exhibitId: string; path: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
}

export interface EnsambladorViewProps {
  caseId: string;
  vm: EnsambladorVM;
  actions: EnsambladorActions;
}

// ---------------------------------------------------------------------------
// Status → StatusPill mapping
// ---------------------------------------------------------------------------

const STATUS_PILL: Record<string, { kind: StatusKind; labelKey: string }> = {
  draft:               { kind: "pendiente", labelKey: "statusDraft" },
  compiling:           { kind: "revision",  labelKey: "statusCompiling" },
  compiled:            { kind: "aprobado",  labelKey: "statusCompiled" },
  ready:               { kind: "aprobado",  labelKey: "statusReady" },
  compile_failed:      { kind: "corregir",  labelKey: "statusCompileFailed" },
  sent_to_lawyer:      { kind: "revision",  labelKey: "statusSentToLawyer" },
  corrections_needed:  { kind: "corregir",  labelKey: "statusCorrectionsNeeded" },
  approved:            { kind: "aprobado",  labelKey: "statusApproved" },
  sent_to_finance:     { kind: "hecho",     labelKey: "statusSentToFinance" },
  printed:             { kind: "hecho",     labelKey: "statusPrinted" },
};

// Item-type chip styling (flow clarity) — labelKey resolves via i18n.
const ITEM_TYPE_STYLE: Record<string, { labelKey: string; color: string; bg: string }> = {
  cover:           { labelKey: "typeCover",       color: "var(--gold-deep)",     bg: "var(--gold-soft)" },
  ai_generation:   { labelKey: "typeLetter",      color: "var(--accent)",        bg: "var(--blue-soft)" },
  automated_form:  { labelKey: "typeForm",        color: "var(--navy, #002855)", bg: "var(--chip)" },
  client_document: { labelKey: "typeDocument",    color: "#1d7a4d",              bg: "#e6f5ec" },
  translation:     { labelKey: "typeTranslation", color: "#7a5c1d",              bg: "#f5efe0" },
  external_file:   { labelKey: "typeExternal",    color: "var(--ink-2)",         bg: "var(--chip)" },
  default:         { labelKey: "typeDocument",    color: "var(--ink-2)",         bg: "var(--chip)" },
};

// ---------------------------------------------------------------------------
// Error code → friendly message
// ---------------------------------------------------------------------------

function errorMessage(code: string, t: T): string {
  switch (code) {
    case "EXPEDIENTE_COMPILE_FAILED":   return t("errCompileFailed");
    case "EXPEDIENTE_NOT_EDITABLE":     return t("errNotEditable");
    case "EXPEDIENTE_DRAFT_EXISTS":     return t("errDraftExists");
    case "EXPEDIENTE_NOT_APPROVED":     return t("errNotApproved");
    case "EXPEDIENTE_ALREADY_SENT_TO_FINANCE": return t("errAlreadySent");
    case "EXPEDIENTE_NOT_EMPTY":        return t("errNotEmpty");
    default:                            return t("errUnexpected");
  }
}

/** Shared input/select style for the cover generator fields. */
function coverFieldStyle(editable: boolean): React.CSSProperties {
  return {
    width: "100%",
    fontSize: 13,
    fontWeight: 600,
    color: "var(--ink)",
    background: "var(--card)",
    border: "1px solid var(--line)",
    borderRadius: 6,
    padding: "6px 10px",
    cursor: editable ? "text" : "default",
    opacity: editable ? 1 : 0.5,
    fontFamily: "inherit",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-PE", {
      day: "2-digit",
      month: "short",
    });
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
  t: T;
  locale: string;
}

function MaterialSection({ title, items, emptyText, onAdd, busy, editable, t, locale }: MaterialSectionProps) {
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
                <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: 0 }}>{formatDate(it.createdAt, locale)}</p>
              </div>
              {editable && (
                <GhostBtn
                  size="md"
                  full={false}
                  disabled={busy === it.refId}
                  onClick={() => onAdd(it)}
                  style={{ fontSize: 13, height: 32, padding: "0 14px", flexShrink: 0 }}
                >
                  {busy === it.refId ? "…" : t("addBtn")}
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
  t: T;
}

function InlineEditTitle({ value, onSave, disabled, t }: InlineEditTitleProps) {
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
      title={disabled ? undefined : t("editTitleHint")}
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
// Sub-component: ExhibitsPanel (auto-downloaded anexos — Diana's status + recovery)
// ---------------------------------------------------------------------------

const EXHIBIT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: "En cola",     color: "var(--ink-2)",     bg: "var(--chip)" },
  fetching: { label: "Descargando", color: "var(--accent)",    bg: "var(--blue-soft)" },
  ready:    { label: "Listo",       color: "#1d7a4d",          bg: "#e6f5ec" },
  manual:   { label: "Manual",      color: "#7a5c1d",          bg: "#f5efe0" },
  failed:   { label: "Falló",       color: "var(--red, #c0341d)", bg: "#fdecea" },
};

function ExhibitsPanel({ exhibits, actions }: { exhibits: ExhibitVM[]; actions: EnsambladorActions }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const ready = exhibits.filter((e) => e.status === "ready" || e.status === "manual").length;

  async function retry(id: string) {
    setBusy(id);
    const r = await actions.retryExhibit({ exhibitId: id });
    setBusy(null);
    if (r.ok) { toast.success("Reintentando descarga…"); window.location.reload(); }
    else toast.error(r.error?.code ?? "Error");
  }

  async function upload(id: string, file: File) {
    setBusy(id);
    const u = await actions.createExhibitUploadUrl({ exhibitId: id });
    if (!u.ok || !u.data) { setBusy(null); return toast.error("No se pudo iniciar la subida"); }
    const put = await fetch(u.data.signedUrl, { method: "PUT", body: file, headers: { "content-type": "application/pdf" } });
    if (!put.ok) { setBusy(null); return toast.error("Falló la subida del archivo"); }
    const c = await actions.confirmManualExhibit({ exhibitId: id, path: u.data.path });
    setBusy(null);
    if (c.ok) { toast.success("Anexo subido a mano"); window.location.reload(); }
    else toast.error(c.error?.code ?? "Archivo inválido");
  }

  return (
    <Card>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Anexos automáticos</h3>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{ready}/{exhibits.length} listos</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 12px" }}>
        Fuentes citadas por la IA, descargadas y anexadas solas. Solo los que fallaron necesitan tu acción.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {exhibits.map((ex) => {
          const st = EXHIBIT_STATUS[ex.status] ?? EXHIBIT_STATUS.pending;
          const isFailed = ex.status === "failed";
          return (
            <div key={ex.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "var(--card)", border: `1px solid ${isFailed ? "#f3c6bf" : "var(--line)"}` }}>
              <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, padding: "3px 8px", borderRadius: 999, color: st.color, background: st.bg }}>{st.label}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ex.exhibitLabel ? `${ex.exhibitLabel} · ` : ""}{ex.publisher ?? ex.title ?? "Fuente"}
                </p>
                <a href={ex.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>
                  {ex.sourceUrl}
                </a>
                {isFailed && ex.lastError && (
                  <p style={{ fontSize: 11, color: "var(--red, #c0341d)", margin: "2px 0 0" }}>{ex.lastError.slice(0, 120)}</p>
                )}
              </div>
              {ex.pageCount != null && !isFailed && (
                <span style={{ flexShrink: 0, fontSize: 11, color: "var(--ink-3)" }}>{ex.pageCount} pág</span>
              )}
              {isFailed && (
                <div style={{ flexShrink: 0, display: "flex", gap: 6 }}>
                  <button type="button" disabled={busy === ex.id} onClick={() => retry(ex.id)} style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    {busy === ex.id ? "…" : "Reintentar"}
                  </button>
                  <label style={{ height: 28, padding: "0 10px", borderRadius: 7, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center" }}>
                    Subir PDF
                    <input type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(ex.id, f); }} />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EnsambladorView({ caseId, vm, actions }: EnsambladorViewProps) {
  const t = useTranslations("staff_ensamblador") as unknown as T;
  const locale = useLocale();
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
  const [coverTitle, setCoverTitle] = React.useState<string>("");
  const [coverPartyId, setCoverPartyId] = React.useState<string>("");
  const [busyAi, setBusyAi] = React.useState(false);
  const [busyFinance, setBusyFinance] = React.useState(false);
  const [editingCoverId, setEditingCoverId] = React.useState<string | null>(null);
  const [editCoverTitle, setEditCoverTitle] = React.useState<string>("");
  const [editCoverParty, setEditCoverParty] = React.useState<string>("");

  // -------------------------------------------------------------------------
  // No expediente yet — empty state
  // -------------------------------------------------------------------------
  if (!vm.expediente) {
    return (
      <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--ink-2)" }}>
        <Lex mood="calma" size={110} />
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 12 }}>
          {t("emptyTitle")}
        </h3>
        <p style={{ fontSize: 13.5, marginTop: 6, marginBottom: 8 }}>
          {t("emptyBody")}
        </p>
        <p style={{ fontSize: 12.5, marginTop: 0, marginBottom: 20, color: "var(--ink-3)", maxWidth: 460, marginInline: "auto" }}>
          {t("aiAssembleHint")}
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
          <GradientBtn size="md" full={false} disabled={busyAi} onClick={handleAutoAssemble}>
            {busyAi ? t("aiAssembling") : `✨ ${t("aiAssembleBtn")}`}
          </GradientBtn>
          <GhostBtn
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
                toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
              }
            }}
          >
            {busyCreate ? t("creatingBtn") : t("createBtnManual")}
          </GhostBtn>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Expediente exists
  // -------------------------------------------------------------------------
  const { id: expedienteId, attemptNo, status, hasPdf } = vm.expediente;
  const pill = STATUS_PILL[status] ?? { kind: "pendiente" as StatusKind, labelKey: "" };
  const pillLabel = pill.labelKey ? t(pill.labelKey) : status;
  const editable = EDITABLE_STATUSES.has(status);

  // ---- Compile action ----
  async function handleCompile() {
    setBusyCompile(true);
    const r = await actions.compileExpediente({ expedienteId });
    setBusyCompile(false);
    if (r.ok) {
      toast.success(t("compileStartedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- View PDF action ----
  async function handleViewPdf() {
    setBusyPdf(true);
    const r = await actions.getCompiledPdfUrl({ expedienteId });
    setBusyPdf(false);
    if (r.ok && r.data) {
      getBridge().share.openExternal(r.data);
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Create correction ----
  async function handleCreateCorrection() {
    setBusyCorrection(true);
    const r = await actions.createCorrectionAttempt({ expedienteId });
    setBusyCorrection(false);
    if (r.ok) {
      toast.success(t("correctionCreatedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Generate cover ----
  async function handleGenerateCover() {
    if (!selectedTemplateId) {
      toast.error(t("selectCoverTemplateToast"));
      return;
    }
    setBusyCover(true);
    const data: Record<string, unknown> = {};
    if (coverTitle.trim()) data.title = coverTitle.trim();
    if (coverPartyId) data.partyId = coverPartyId;
    const r = await actions.generateCover({ caseId, templateId: selectedTemplateId, data });
    setBusyCover(false);
    if (r.ok) {
      toast.success(t("coverGeneratedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Mark "Listo" (finalize; the Traspaso does the plan-aware handoff) ----
  async function handleMarkReady() {
    if (!window.confirm(t("readyConfirm"))) return;
    setBusyFinance(true);
    const r = await actions.markReady({ expedienteId });
    setBusyFinance(false);
    if (r.ok) {
      toast.success(t("readyToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Auto-assemble with AI ----
  async function handleAutoAssemble() {
    const hasItems = !!vm.expediente && vm.items.length > 0;
    if (hasItems && !window.confirm(t("aiReplaceConfirm"))) return;
    setBusyAi(true);
    const r = await actions.autoAssembleWithAi({ caseId, replace: hasItems });
    setBusyAi(false);
    if (r.ok) {
      const n = r.data?.coversCreated ?? 0;
      const unresolved = r.data?.unresolved.length ?? 0;
      toast.success(
        unresolved > 0
          ? t("aiAssembledWithUnresolvedToast", { n: String(n), u: String(unresolved) })
          : t("aiAssembledToast", { n: String(n) }),
      );
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Delete a cover item (removes the item + its render) ----
  async function handleDeleteCover(itemId: string) {
    if (!window.confirm(t("coverDeleteConfirm"))) return;
    setBusyItem(itemId + ":delcover");
    const r = await actions.deleteCoverItem({ itemId });
    setBusyItem(null);
    if (r.ok) {
      toast.success(t("coverDeletedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Regenerate (edit) a cover item with corrected title/party ----
  async function handleRegenerateCover(itemId: string, title: string, partyId: string) {
    setBusyItem(itemId + ":regen");
    const r = await actions.regenerateCover({
      itemId,
      title: title.trim() || undefined,
      partyId: partyId || null,
    });
    setBusyItem(null);
    if (r.ok) {
      setEditingCoverId(null);
      toast.success(t("coverUpdatedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
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
      toast.success(t("itemAddedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Remove item ----
  async function handleRemoveItem(itemId: string) {
    if (!window.confirm(t("itemRemoveConfirm"))) return;
    setBusyItem(itemId + ":remove");
    const r = await actions.removeItem({ itemId });
    setBusyItem(null);
    if (r.ok) {
      toast.success(t("itemRemovedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
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
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  // ---- Update title ----
  async function handleUpdateTitle(itemId: string, title: string) {
    const r = await actions.updateItem({ itemId, title });
    if (r.ok) {
      toast.success(t("titleUpdatedToast"));
      window.location.reload();
    } else {
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
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
      toast.error(errorMessage(r.error?.code ?? "UNEXPECTED", t));
    }
  }

  const canCompile = editable && vm.items.length > 0;

  return (
    <div>
      {vm.exhibits.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <ExhibitsPanel exhibits={vm.exhibits} actions={actions} />
        </div>
      )}
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
                {t("title")}
              </span>
              <Chip tone="blue">{t("attemptChip", { n: attemptNo })}</Chip>
              <StatusPill kind={pill.kind}>{pillLabel}</StatusPill>
            </div>
          </div>

          {/* Right: header actions */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {editable && (
              <GhostBtn size="md" full={false} disabled={busyAi} onClick={handleAutoAssemble}>
                {busyAi ? t("aiAssembling") : `✨ ${t("aiAssembleBtn")}`}
              </GhostBtn>
            )}
            {status === "corrections_needed" && (
              <GhostBtn
                size="md"
                full={false}
                disabled={busyCorrection}
                onClick={handleCreateCorrection}
              >
                {busyCorrection ? t("creatingBtn") : t("createCorrectionBtn")}
              </GhostBtn>
            )}
            {hasPdf && (
              <GhostBtn
                size="md"
                full={false}
                disabled={busyPdf}
                onClick={handleViewPdf}
              >
                {busyPdf ? t("loadingBtn") : t("viewPdfBtn")}
              </GhostBtn>
            )}
            {canCompile && (
              <GradientBtn
                size="md"
                full={false}
                disabled={busyCompile}
                onClick={handleCompile}
              >
                {busyCompile ? t("compilingBtn") : t("compileBtn")}
              </GradientBtn>
            )}
            {status === "compiled" && (
              <GradientBtn
                size="md"
                full={false}
                disabled={busyFinance}
                onClick={handleMarkReady}
              >
                {busyFinance ? t("readyBtnBusy") : t("readyBtn")}
              </GradientBtn>
            )}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Two-column grid                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="grid2"
        style={{
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
              {t("materialTitle")}
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
                {t("generateCoverTitle")}
              </p>
              {vm.coverTemplates.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--ink-3)", fontStyle: "italic" }}>
                  {t("noCoverTemplates")}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => setSelectedTemplateId(e.target.value)}
                    disabled={!editable || busyCover}
                    style={coverFieldStyle(editable)}
                  >
                    {vm.coverTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={coverTitle}
                    onChange={(e) => setCoverTitle(e.target.value)}
                    disabled={!editable || busyCover}
                    placeholder={t("coverTitlePlaceholder")}
                    style={coverFieldStyle(editable)}
                  />
                  {vm.parties.length > 0 && (
                    <select
                      value={coverPartyId}
                      onChange={(e) => setCoverPartyId(e.target.value)}
                      disabled={!editable || busyCover}
                      style={coverFieldStyle(editable)}
                    >
                      <option value="">{t("coverPartyNone")}</option>
                      {vm.parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <GhostBtn
                    size="md"
                    full={false}
                    disabled={!editable || busyCover}
                    onClick={handleGenerateCover}
                    style={{ fontSize: 13, height: 34, padding: "0 14px", alignSelf: "flex-start" }}
                  >
                    {busyCover ? t("generatingBtn") : t("generateCoverBtn")}
                  </GhostBtn>
                </div>
              )}
            </div>

            {/* Caratulas */}
            <MaterialSection
              title={t("coversTitle")}
              items={vm.material.covers}
              emptyText={t("coversEmpty")}
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("cover", it)}
              t={t}
              locale={locale}
            />

            {/* Cartas IA */}
            <MaterialSection
              title={t("aiLettersTitle")}
              items={vm.material.generations}
              emptyText={t("aiLettersEmpty")}
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("ai_generation", it)}
              t={t}
              locale={locale}
            />

            {/* Formularios */}
            <MaterialSection
              title={t("formsTitle")}
              items={vm.material.forms}
              emptyText={t("formsEmpty")}
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("automated_form", it)}
              t={t}
              locale={locale}
            />

            {/* Documentos del cliente */}
            <MaterialSection
              title={t("documentsTitle")}
              items={vm.material.documents}
              emptyText={t("documentsEmpty")}
              editable={editable}
              busy={busyMaterial}
              onAdd={(it) => handleAddMaterial("client_document", it)}
              t={t}
              locale={locale}
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
              {t("orderTitle")}
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
                  {t("orderEmpty")}
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {vm.items.map((item, idx) => {
                  const isBusyThis = busyItem?.startsWith(item.id);
                  const isCover = item.itemType === "cover";
                  const typeStyle = ITEM_TYPE_STYLE[item.itemType] ?? ITEM_TYPE_STYLE.default;
                  return (
                    <div key={item.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <div
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

                      {/* Item type chip */}
                      <span
                        title={t(typeStyle.labelKey)}
                        style={{
                          fontSize: 10.5,
                          fontWeight: 800,
                          color: typeStyle.color,
                          background: typeStyle.bg,
                          borderRadius: 6,
                          padding: "3px 7px",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t(typeStyle.labelKey)}
                      </span>

                      {/* Title (editable) */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <InlineEditTitle
                          value={item.title}
                          disabled={!editable || !!isBusyThis}
                          onSave={(next) => handleUpdateTitle(item.id, next)}
                          t={t}
                        />
                        {item.pageCount != null && (
                          <p style={{ fontSize: 11, color: "var(--ink-3)", margin: 0 }}>
                            {t("pageCount", { n: item.pageCount })}
                          </p>
                        )}
                      </div>

                      {/* TOC toggle */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis}
                        title={item.includeInToc ? t("tocRemove") : t("tocInclude")}
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
                        {t("tocToggle")}
                      </button>

                      {/* Up / Down */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis || idx === 0}
                        title={t("moveUp")}
                        onClick={() => handleMove(item.id, "up")}
                        aria-label={t("moveUpAria")}
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
                        title={t("moveDown")}
                        onClick={() => handleMove(item.id, "down")}
                        aria-label={t("moveDownAria")}
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

                      {/* Edit cover (cover items only) */}
                      {isCover && (
                        <button
                          type="button"
                          disabled={!editable || !!isBusyThis}
                          title={t("coverEdit")}
                          aria-label={t("coverEdit")}
                          onClick={() => {
                            setEditingCoverId(editingCoverId === item.id ? null : item.id);
                            setEditCoverTitle(item.title);
                            setEditCoverParty("");
                          }}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 6,
                            border: "1px solid var(--line)",
                            background: editingCoverId === item.id ? "var(--blue-soft)" : "var(--card)",
                            color: "var(--accent)",
                            fontSize: 13,
                            cursor: editable ? "pointer" : "default",
                            opacity: editable ? 1 : 0.3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          {"✎"}
                        </button>
                      )}

                      {/* Remove */}
                      <button
                        type="button"
                        disabled={!editable || !!isBusyThis}
                        title={t("removeItem")}
                        aria-label={t("removeItem")}
                        onClick={() => (isCover ? handleDeleteCover(item.id) : handleRemoveItem(item.id))}
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

                    {/* Inline cover editor */}
                    {isCover && editingCoverId === item.id && (
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          alignItems: "center",
                          padding: "10px 12px",
                          border: "1px solid var(--accent)",
                          borderRadius: 8,
                          background: "var(--blue-soft)",
                        }}
                      >
                        <input
                          type="text"
                          value={editCoverTitle}
                          onChange={(e) => setEditCoverTitle(e.target.value)}
                          placeholder={t("coverTitlePlaceholder")}
                          style={{ ...coverFieldStyle(true), flex: 1, minWidth: 160 }}
                        />
                        {vm.parties.length > 0 && (
                          <select
                            value={editCoverParty}
                            onChange={(e) => setEditCoverParty(e.target.value)}
                            style={{ ...coverFieldStyle(true), width: "auto", minWidth: 160 }}
                          >
                            <option value="">{t("coverPartyKeep")}</option>
                            {vm.parties.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        )}
                        <GhostBtn
                          size="md"
                          full={false}
                          disabled={!!isBusyThis}
                          onClick={() => handleRegenerateCover(item.id, editCoverTitle, editCoverParty)}
                          style={{ height: 34, padding: "0 14px", fontSize: 13 }}
                        >
                          {t("coverEditSave")}
                        </GhostBtn>
                        <button
                          type="button"
                          onClick={() => setEditingCoverId(null)}
                          style={{
                            border: "none",
                            background: "transparent",
                            color: "var(--ink-2)",
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {t("coverEditCancel")}
                        </button>
                      </div>
                    )}
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
