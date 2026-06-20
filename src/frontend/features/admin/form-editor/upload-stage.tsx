"use client";

import * as React from "react";
import { Icon, GradientBtn, GhostBtn, Lex } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import type { FormEditorVM, FormEditorActions, VersionVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * UploadStage — stage 1 of the pdf_automation pipeline (DOC-53 §5.1.1).
 *
 * Dropzone → signed upload to catalog-assets → createAutomationVersion (which
 * chains AcroForm detection) → detection summary card with type/page histogram
 * and a "Re-detect" button. 0 fields → empty Lex state.
 */

const TYPE_LABELS: Record<string, string> = {
  text: "Texto",
  checkbox: "Checkbox",
  radio: "Radio",
  dropdown: "Desplegable",
  signature: "Firma",
  unknown: "Otro",
};

export interface UploadStageProps {
  vm: FormEditorVM;
  openVersion: VersionVM | null;
  hasVersions: boolean;
  readOnly: boolean;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  onUploaded: () => void;
}

export function UploadStage({ vm, openVersion, hasVersions, readOnly, strings, actions, onUploaded }: UploadStageProps) {
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [sourceLang, setSourceLang] = React.useState<"en" | "es">("en");
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.type !== "application/pdf") return toast.error("Solo PDF");
    setBusy(true);
    try {
      const urlRes = await actions.createUploadUrl({ form_definition_id: vm.form.id, filename: file.name });
      if (!urlRes.success) throw new Error(urlRes.error?.code);
      const { signedUrl, path } = urlRes.data!;
      const put = await fetch(signedUrl, { method: "PUT", body: file, headers: { "content-type": "application/pdf" } });
      if (!put.ok) throw new Error("upload failed");
      const ver = await actions.createVersion({ form_definition_id: vm.form.id, uploaded_pdf_path: path, source_language: sourceLang });
      if (!ver.success) throw new Error(ver.error?.code);
      toast.success(strings.reading);
      onUploaded();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function redetect() {
    if (!openVersion) return;
    setBusy(true);
    const r = await actions.redetect(openVersion.id);
    setBusy(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    onUploaded();
  }

  // Detection summary (after a version exists with fields).
  const fields = openVersion?.detected_fields ?? [];
  const byType = fields.reduce<Record<string, number>>((acc, f) => { acc[f.field_type] = (acc[f.field_type] ?? 0) + 1; return acc; }, {});
  const byPage = fields.reduce<Record<number, number>>((acc, f) => { acc[f.page] = (acc[f.page] ?? 0) + 1; return acc; }, {});
  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);

  if (openVersion && fields.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <Lex mood="atento" size={120} />
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 14 }}>{strings.noFieldsTitle}</h3>
        <p style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 6 }}>{strings.noFieldsSub}</p>
        {!readOnly && <div style={{ marginTop: 18 }}><GhostBtn size="md" full={false} onClick={redetect} disabled={busy}>{strings.redetect}</GhostBtn></div>}
      </div>
    );
  }

  if (openVersion && fields.length > 0) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 40, fontWeight: 900, color: "var(--navy)", lineHeight: 1, fontFamily: "var(--font-title)" }}>{fields.length}</span>
          <span style={{ fontSize: 14, color: "var(--ink-2)" }}>{strings.fieldsDetected} · {pages.length} págs.</span>
          {!readOnly && <div style={{ marginLeft: "auto" }}><GhostBtn size="md" full={false} onClick={redetect} disabled={busy}>{strings.redetect}</GhostBtn></div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <SummaryCard title={strings.byType}>
            {Object.entries(byType).map(([type, count]) => (
              <Bar key={type} label={TYPE_LABELS[type] ?? type} count={count} total={fields.length} />
            ))}
          </SummaryCard>
          <SummaryCard title={strings.byPage}>
            {pages.map((p) => (
              <Bar key={p} label={`${strings.pageLabel} ${p}`} count={byPage[p]} total={fields.length} />
            ))}
          </SummaryCard>
        </div>
      </div>
    );
  }

  // No version yet — the dropzone hero.
  return (
    <div>
      {hasVersions && !readOnly && (
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginBottom: 12, background: "var(--blue-soft)", borderRadius: 12, padding: "10px 14px" }}>{strings.newVersionNote}</p>
      )}
      {!readOnly && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink-3)", margin: "0 0 6px" }}>{strings.sourceLanguage}</p>
          <div role="radiogroup" aria-label={strings.sourceLanguage} style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip)" }}>
            {(["en", "es"] as const).map((l) => {
              const on = sourceLang === l;
              return (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSourceLang(l)}
                  style={{ height: 34, padding: "0 16px", borderRadius: 9, border: "none", cursor: "pointer", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 12.5 }}
                >
                  {l === "es" ? strings.langEs : strings.langEn}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "6px 0 0", maxWidth: 460, lineHeight: 1.4 }}>{strings.sourceLanguageHint}</p>
        </div>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
        style={{
          border: `2px dashed ${dragOver ? "var(--accent)" : "var(--line-2, var(--line))"}`,
          borderRadius: 20,
          background: dragOver ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
          padding: "48px 24px",
          textAlign: "center",
          transition: "background .15s, border-color .15s",
        }}
      >
        <div style={{ color: "var(--accent)", display: "inline-flex", marginBottom: 14 }}><Icon name="upload" size={44} /></div>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", margin: 0 }}>{strings.dropzoneTitle}</h3>
        <p style={{ fontSize: 14, color: "var(--ink-2)", margin: "6px 0 18px" }}>{strings.dropzoneSub}</p>
        {!readOnly && (
          <>
            <GradientBtn onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? strings.reading : strings.dropzoneCta}
            </GradientBtn>
            <input ref={inputRef} type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} aria-label={strings.dropzoneCta} />
          </>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--line)", background: "var(--card,#fff)", padding: 16 }}>
      <h4 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", margin: "0 0 12px" }}>{title}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Bar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
        <span style={{ color: "var(--ink-2)" }}>{label}</span>
        <span style={{ color: "var(--ink)", fontWeight: 700 }}>{count}</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: "var(--chip)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--accent), var(--brand-navy))", borderRadius: 99 }} />
      </div>
    </div>
  );
}
