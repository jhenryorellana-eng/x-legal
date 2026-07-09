"use client";

/**
 * Pre-Mortem validation guide card — shared by the ai_letter and pdf_automation
 * editor modes. The admin uploads (or pastes) the filling guide (rubric, e.g.
 * Guia-Llenado-I-589.md) and toggles the Pre-Mortem for this form. The whole guide
 * is stored (form_fill_guides) and later injected as the validator's rubric.
 *
 * File upload uses the sanctioned <input type=file> + file.text() pattern (no
 * navigator.* — RNF-036 safe): the markdown is small, so it's saved inline.
 */

import * as React from "react";
import { GradientBtn } from "@/frontend/components/brand";
import { Switch, toast } from "@/frontend/components/desktop";
import type { FormEditorActions } from "./types";

export function PreMortemGuideCard({
  formId,
  initial,
  onSave,
}: {
  formId: string;
  initial: { enabled: boolean; guideText: string | null };
  onSave: FormEditorActions["savePreMortemGuide"];
}) {
  const [enabled, setEnabled] = React.useState(initial.enabled);
  const [text, setText] = React.useState(initial.guideText ?? "");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/\.md$/i.test(file.name) && file.type !== "text/markdown") {
      toast.error("Solo se aceptan archivos .md");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const content = await file.text();
    setText(content);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleSave() {
    setSaving(true);
    const r = await onSave({ form_definition_id: formId, enabled, guide_markdown: text });
    setSaving(false);
    if (r.success) toast.success("Guía de validación guardada");
    else toast.error("No se pudo guardar la guía");
  }

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 16, background: "var(--card, #fff)" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Pre-Mortem (validación de calidad)" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Pre-Mortem (validación de calidad)</span>
      </label>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-3)" }}>
        Sube o pega la guía de llenado (rúbrica). La IA la usa —junto al contexto del caso y ejemplos oficiales— para
        validar la generación/automatización antes de presentarla.
      </p>

      {enabled && (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input ref={inputRef} type="file" accept=".md,text/markdown" hidden onChange={onPickFile} />
            <GradientBtn size="sm" full={false} icon="upload" onClick={() => inputRef.current?.click()}>
              Subir .md
            </GradientBtn>
            <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 700 }}>{words} palabras</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="# Guía de llenado del formulario…"
            rows={12}
            aria-label="Guía de llenado (markdown)"
            style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg, #fff)", fontSize: 13, fontFamily: "var(--font-mono, monospace)", lineHeight: 1.5, color: "var(--ink)", resize: "vertical" }}
          />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <GradientBtn size="md" full={false} icon="check" disabled={saving} onClick={handleSave}>
          {saving ? "Guardando…" : "Guardar guía"}
        </GradientBtn>
      </div>
    </div>
  );
}
