"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { UploadStage } from "./upload-stage";
import { StructureEditor } from "./structure-editor";
import { PreviewStage } from "./preview-stage";
import { PublishStage } from "./publish-stage";
import { PreMortemGuideCard } from "./pre-mortem-guide-card";
import type { FormEditorVM, FormEditorActions, QuestionGroupVM, VersionVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * PdfMode — the pdf_automation editor (DOC-53 §5.1).
 *
 * 4-stage progress bar (Subir PDF → Estructurar → Previsualizar → Publicar) +
 * version chips + immutability banner. Holds the live groups/questions state and
 * the PDF object URL; delegates each stage to its component.
 */

const STAGES = [
  { id: "upload", key: "stageUpload" },
  { id: "structure", key: "stageStructure" },
  { id: "preview", key: "stagePreview" },
  { id: "publish", key: "stagePublish" },
] as const;
type StageId = (typeof STAGES)[number]["id"];

export interface PdfModeProps {
  vm: FormEditorVM;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  /** Active version selected by the version chips. */
  activeVersionId: string | null;
  onSelectVersion: (id: string) => void;
}

export function PdfMode({ vm, strings, actions, activeVersionId, onSelectVersion }: PdfModeProps) {
  const open = vm.openVersion;
  const readOnly = !!open && open.version.status !== "draft";
  const hasFields = (open?.version.detected_fields.length ?? 0) > 0;

  const [stage, setStage] = React.useState<StageId>(() => (open && hasFields ? "structure" : "upload"));
  const [groups, setGroups] = React.useState<QuestionGroupVM[]>(open?.groups ?? []);
  const [lang, setLang] = React.useState<"es" | "en">("es");
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [duplicating, setDuplicating] = React.useState(false);

  async function handleDuplicate() {
    if (!open) return;
    setDuplicating(true);
    const r = await actions.duplicateVersion(open.version.id);
    if (r.success && r.data) {
      // Jump to the fresh editable draft (copies questions; published stays intact).
      window.location.href = `${window.location.pathname}?v=${r.data.id}`;
    } else {
      setDuplicating(false);
      toast.error(r.error?.code ?? "Error");
    }
  }

  // Fetch the signed PDF URL for the viewer when the open version changes.
  React.useEffect(() => {
    let cancelled = false;
    if (!open) {
      setPdfUrl(null);
      return;
    }
    (async () => {
      const r = await actions.getPdfUrl(open.version.id);
      if (!cancelled && r.success && r.data) setPdfUrl(r.data);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open?.version.id]);

  // Keep local groups in sync if the open version changes (chip switch).
  React.useEffect(() => {
    setGroups(open?.groups ?? []);
  }, [open?.version.id, open?.groups]);

  return (
    <div>
      {/* Version chips */}
      <VersionChips versions={vm.versions} activeId={activeVersionId} onSelect={onSelectVersion} strings={strings} />

      {/* Immutability banner + "make editable" action */}
      {readOnly && (
        <div style={{ marginTop: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 10, background: "var(--gold-soft)", border: "1px solid var(--gold-deep)", borderRadius: 12, padding: "10px 14px" }}>
          <Icon name="lock" size={15} />
          <span style={{ flex: 1, fontSize: 13, color: "var(--gold-deep)", fontWeight: 600 }}>{strings.immutableBanner}</span>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicating}
            style={{ flexShrink: 0, height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: "var(--gold-deep)", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: duplicating ? "default" : "pointer", opacity: duplicating ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="copy" size={13} color="#fff" /> {duplicating ? strings.saving : strings.editableCopy}
          </button>
        </div>
      )}

      {/* 4-stage bar */}
      <div style={{ display: "flex", gap: 8, margin: "18px 0 22px", flexWrap: "wrap" }}>
        {STAGES.map((s, i) => {
          const on = stage === s.id;
          const reachable = i === 0 || !!open;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && setStage(s.id)}
              aria-current={on ? "step" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                padding: "0 16px",
                borderRadius: 12,
                border: `1.5px solid ${on ? "transparent" : "var(--line)"}`,
                background: on ? "linear-gradient(120deg, var(--accent), var(--brand-navy))" : "var(--card,#fff)",
                color: on ? "#fff" : reachable ? "var(--ink)" : "var(--ink-3)",
                fontWeight: 800,
                fontSize: 13.5,
                cursor: reachable ? "pointer" : "not-allowed",
                opacity: reachable ? 1 : 0.55,
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: 99, background: on ? "rgba(255,255,255,.22)" : "var(--chip)", color: on ? "#fff" : "var(--ink-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{i + 1}</span>
              {strings[s.key]}
            </button>
          );
        })}
      </div>

      {/* Stage body */}
      {stage === "upload" && (
        <UploadStage
          vm={vm}
          openVersion={open?.version ?? null}
          hasVersions={vm.versions.length > 0}
          readOnly={readOnly}
          strings={strings}
          actions={actions}
          onUploaded={() => window.location.reload()}
        />
      )}

      {stage === "structure" && open && (
        <StructureEditor
          vm={vm}
          groups={groups}
          setGroups={setGroups}
          pdfUrl={pdfUrl}
          versionId={open.version.id}
          readOnly={readOnly}
          lang={lang}
          strings={strings}
          actions={actions}
        />
      )}

      {stage === "preview" && open && (
        <PreviewStage
          groups={groups}
          versionId={open.version.id}
          lang={lang}
          onLangChange={setLang}
          formLabel={{ es: vm.form.label.es ?? "", en: vm.form.label.en ?? "" }}
          strings={strings}
          actions={actions}
        />
      )}

      {stage === "publish" && open && (
        <PublishStage
          versionId={open.version.id}
          versionNumber={open.version.version}
          strings={strings}
          actions={actions}
        />
      )}

      {/* Validación (Pre-Mortem) — guide + enablement, independent of the stages. */}
      <div style={{ marginTop: 26 }}>
        <h3 style={{ margin: "0 0 10px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
          Validación (Pre-Mortem)
        </h3>
        <PreMortemGuideCard formId={vm.form.id} initial={vm.preMortemGuide} onSave={actions.savePreMortemGuide} />
      </div>
    </div>
  );
}

export function VersionChips({ versions, activeId, onSelect, strings }: { versions: VersionVM[]; activeId: string | null; onSelect: (id: string) => void; strings: FormEditorStrings }) {
  const statusLabel = (s: VersionVM["status"]) =>
    s === "draft" ? strings.versionDraft : s === "published" ? strings.versionPublished : strings.versionArchived;
  const statusColor = (s: VersionVM["status"]) =>
    s === "draft" ? { bg: "var(--blue-soft)", fg: "var(--accent)" } : s === "published" ? { bg: "var(--green-soft)", fg: "var(--green)" } : { bg: "var(--chip)", fg: "var(--ink-3)" };

  if (versions.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {versions.map((v) => {
        const on = v.id === activeId;
        const c = statusColor(v.status);
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            aria-pressed={on}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 32,
              padding: "0 12px",
              borderRadius: 999,
              border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
              background: on ? "var(--accent-soft)" : "var(--card,#fff)",
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 12.5,
              color: "var(--ink)",
            }}
          >
            v{v.version}
            <span style={{ fontSize: 11, fontWeight: 700, color: c.fg, background: c.bg, borderRadius: 99, padding: "1px 7px" }}>{statusLabel(v.status)}</span>
          </button>
        );
      })}
    </div>
  );
}
