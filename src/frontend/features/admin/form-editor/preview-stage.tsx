"use client";

import * as React from "react";
import { GradientBtn, GhostBtn, Icon } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import type { QuestionGroupVM, QuestionVM, FormEditorActions } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * PreviewStage — stage 3 (DOC-53 §5.1.3).
 *
 * A 390px mobile frame that renders a FAITHFUL preview of the client wizard from
 * the current groups/questions (the REAL client wizard engine ships in Ola 3 —
 * see TODO below to swap this for the shared component). Toggle ES|EN; prefilled
 * fields show an origin chip; "Generar PDF de prueba" calls generateTestPdf and
 * renders the filled PDF, listing required gaps without blocking.
 *
 * TODO(Ola-3): replace ClientWizardPreview with the shared client wizard engine
 * (the same component the client app uses) once it exists — DOC-53 §5.1.3 wants
 * "render real, no captura". The structure (groups → steps, questions → fields)
 * is identical, so the swap is a drop-in.
 */

const ORIGIN_LABEL: Record<string, string> = {
  document_extraction: "extracción de doc.",
  generation_output: "otra generación",
  profile: "perfil",
};

export interface PreviewStageProps {
  groups: QuestionGroupVM[];
  versionId: string;
  lang: "es" | "en";
  onLangChange: (l: "es" | "en") => void;
  strings: FormEditorStrings;
  actions: FormEditorActions;
}

export function PreviewStage({ groups, versionId, lang, onLangChange, strings, actions }: PreviewStageProps) {
  const [step, setStep] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [gaps, setGaps] = React.useState<Array<{ question_id: string; pdf_field_name: string }>>([]);

  const visibleGroups = groups.filter((g) => g.questions.some((q) => q.source === "client_answer"));
  const current = visibleGroups[step];

  async function generateTest() {
    setBusy(true);
    // Build filler sample answers (all client questions get a placeholder).
    const sample: Record<string, unknown> = {};
    for (const g of groups) for (const q of g.questions) {
      if (q.source !== "client_answer") continue;
      sample[q.id] = q.field_type === "checkbox" ? true : q.field_type === "number" ? 1 : "Ejemplo";
    }
    const r = await actions.generateTestPdf({ version_id: versionId, sample_answers: sample });
    setBusy(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    const bytes = Uint8Array.from(atob(r.data!.pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    setPdfUrl(URL.createObjectURL(blob));
    setGaps(r.data!.gaps);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start" }}>
      {/* Mobile frame */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip)" }}>
          {(["es", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => onLangChange(l)} aria-pressed={lang === l} style={{ height: 30, padding: "0 16px", borderRadius: 9, border: "none", cursor: "pointer", background: lang === l ? "var(--accent-soft)" : "transparent", color: lang === l ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 12.5 }}>
              {l === "es" ? strings.previewToggleEs : strings.previewToggleEn}
            </button>
          ))}
        </div>
        <div
          data-theme-scope
          style={{ width: 390, height: 720, borderRadius: 36, border: "10px solid var(--navy)", background: "var(--bg)", overflow: "hidden", boxShadow: "0 24px 60px rgba(7,17,33,.28)", position: "relative" }}
        >
          <div style={{ height: "100%", overflow: "auto", padding: "24px 20px" }}>
            {!current && <p style={{ color: "var(--ink-3)", fontSize: 14, textAlign: "center", marginTop: 40 }}>—</p>}
            {current && (
              <ClientWizardPreview
                group={current}
                lang={lang}
                stepIndex={step}
                stepCount={visibleGroups.length}
                strings={strings}
              />
            )}
          </div>
        </div>
        {visibleGroups.length > 1 && (
          <div style={{ display: "flex", gap: 10 }}>
            <GhostBtn size="md" full={false} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>←</GhostBtn>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)", alignSelf: "center" }}>{step + 1} / {visibleGroups.length}</span>
            <GhostBtn size="md" full={false} onClick={() => setStep((s) => Math.min(visibleGroups.length - 1, s + 1))} disabled={step >= visibleGroups.length - 1}>→</GhostBtn>
          </div>
        )}
      </div>

      {/* Test PDF panel */}
      <div>
        <GradientBtn size="md" full={false} onClick={generateTest} disabled={busy}>
          {busy ? strings.testRunning : strings.generateTestPdf}
        </GradientBtn>
        {gaps.length > 0 && (
          <div style={{ marginTop: 14, background: "var(--gold-soft)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 700, color: "var(--gold-deep)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="info" size={14} /> {strings.testGaps}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--ink-2)" }}>
              {gaps.map((g) => <li key={g.question_id}>{g.pdf_field_name}</li>)}
            </ul>
          </div>
        )}
        {pdfUrl && (
          <iframe title="PDF de prueba" src={pdfUrl} style={{ marginTop: 14, width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 14, background: "#fff" }} />
        )}
      </div>
    </div>
  );
}

function ClientWizardPreview({ group, lang, stepIndex, stepCount, strings }: { group: QuestionGroupVM; lang: "es" | "en"; stepIndex: number; stepCount: number; strings: FormEditorStrings }) {
  const pick = (v: { es?: string; en?: string }) => (lang === "es" ? v.es : v.en) || v.es || v.en || "";
  const clientQuestions = group.questions.filter((q) => q.source === "client_answer");
  const prefilled = group.questions.filter((q) => q.source !== "client_answer");

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 18 }}>
        {Array.from({ length: stepCount }).map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i <= stepIndex ? "var(--accent)" : "var(--chip)" }} />
        ))}
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "0 0 16px", fontFamily: "var(--font-title)" }}>{pick(group.title_i18n)}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {clientQuestions.map((q) => <FieldPreview key={q.id} q={q} lang={lang} pick={pick} />)}
        {prefilled.map((q) => (
          <div key={q.id} style={{ borderRadius: 14, border: "1px dashed var(--accent)", background: "var(--accent-soft)", padding: "10px 12px" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="sparkle" size={12} /> {strings.prefillFrom.replace("{origin}", ORIGIN_LABEL[q.source] ?? q.source)}
            </span>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-2)" }}>{pick(q.question_i18n)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldPreview({ q, pick }: { q: QuestionVM; lang: "es" | "en"; pick: (v: { es?: string; en?: string }) => string }) {
  const label = pick(q.question_i18n);
  const help = pick(q.help_i18n);
  return (
    <div>
      <label style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: help ? 2 : 7 }}>
        {label} {q.is_required && <span style={{ color: "var(--red)" }}>*</span>}
      </label>
      {help && <p style={{ margin: "0 0 7px", fontSize: 12, color: "var(--ink-3)" }}>{help}</p>}
      {q.field_type === "textarea" ? (
        <textarea disabled style={previewInput} />
      ) : q.field_type === "checkbox" ? (
        <input type="checkbox" disabled style={{ width: 22, height: 22 }} />
      ) : q.field_type === "select" ? (
        <select disabled style={previewInput}>
          {(q.options ?? []).map((o) => <option key={o.value}>{pick(o.label_i18n)}</option>)}
        </select>
      ) : (
        <input disabled type={q.field_type === "date" ? "date" : q.field_type === "number" ? "number" : "text"} style={previewInput} />
      )}
    </div>
  );
}

const previewInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  minHeight: 46,
  borderRadius: 14,
  border: "1.5px solid var(--line)",
  background: "var(--card, #fff)",
  padding: "0 14px",
  fontSize: 15,
  color: "var(--ink)",
};
