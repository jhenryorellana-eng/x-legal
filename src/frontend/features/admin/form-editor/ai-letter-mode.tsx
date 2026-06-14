"use client";

import * as React from "react";
import { GradientBtn, Icon, Chip } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { FieldLabel, SelectInput, TextInput } from "../shared/chrome";
import { GENERATION_MODELS, DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";
import type { FormEditorVM, FormEditorActions, GenerationConfigVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * AiLetterMode — the ai_letter configuration editor (DOC-53 §5.2).
 *
 * Two columns: config (system prompt + inputs + dataset + MODEL + output) |
 * test (case picker + precheck + "Probar generación" → progress → output +
 * tokens + cost + frozen config). Model selector is a CLOSED list (Henry's
 * decision: default claude-sonnet-4-6). Tests don't count in business metrics.
 */

const TOKEN_MARKS = [1024, 16000, 32000, 48000, 64000];

export interface AiLetterModeProps {
  vm: FormEditorVM;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  datasetsHref: string;
}

export function AiLetterMode({ vm, strings, actions, datasetsHref }: AiLetterModeProps) {
  const initial: GenerationConfigVM = vm.generationConfig ?? {
    system_prompt: "",
    input_document_slugs: [],
    input_form_slugs: [],
    dataset_id: null,
    model: DEFAULT_GENERATION_MODEL,
    max_output_tokens: 32000,
    output_format: "pdf",
    output_language: "en",
  };
  const [cfg, setCfg] = React.useState<GenerationConfigVM>(initial);
  const [saving, setSaving] = React.useState(false);

  // Test column state
  const [caseQuery, setCaseQuery] = React.useState("");
  const [caseId, setCaseId] = React.useState("");
  const [testing, setTesting] = React.useState(false);
  const [runId, setRunId] = React.useState<string | null>(null);

  const promptTokens = Math.ceil(cfg.system_prompt.length / 4); // rough proxy
  const selectedDataset = vm.datasets.find((d) => d.id === cfg.dataset_id);
  const datasetExceeds = !!selectedDataset && selectedDataset.tokens > 100000;

  async function save() {
    setSaving(true);
    const r = await actions.saveGenerationConfig({
      form_definition_id: vm.form.id,
      system_prompt: cfg.system_prompt,
      input_document_slugs: cfg.input_document_slugs,
      input_form_slugs: cfg.input_form_slugs,
      dataset_id: cfg.dataset_id,
      model: cfg.model,
      max_output_tokens: cfg.max_output_tokens,
      output_format: cfg.output_format,
      output_language: cfg.output_language,
    });
    setSaving(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    toast.success(strings.configSaved);
  }

  async function runTest() {
    if (!caseId) return toast.error(strings.searchCase);
    setTesting(true);
    setRunId(null);
    const r = await actions.testGeneration({ form_definition_id: vm.form.id, case_id: caseId });
    setTesting(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    setRunId(r.data!.run_id);
    toast.success("Prueba iniciada");
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
      {/* LEFT — config */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* System prompt */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <FieldLabel>{strings.systemPrompt}</FieldLabel>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{strings.promptTokens.replace("{n}", promptTokens.toLocaleString("es-US"))}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 10 }}>
            <textarea
              value={cfg.system_prompt}
              onChange={(e) => setCfg({ ...cfg, system_prompt: e.target.value })}
              aria-label={strings.systemPrompt}
              style={{ minHeight: 220, borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 12, fontFamily: "ui-monospace, 'JetBrains Mono', monospace", fontSize: 13, color: "var(--ink)", resize: "vertical", lineHeight: 1.5 }}
            />
            <div style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10 }}>
              <p style={{ margin: "0 0 8px", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", color: "var(--ink-3)" }}>{strings.variables}</p>
              {["{{client.name}}", "{{case.number}}", "{{service.label}}", "{{documents}}"].map((v) => (
                <button key={v} type="button" onClick={() => setCfg({ ...cfg, system_prompt: cfg.system_prompt + " " + v })} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", color: "var(--accent)", fontSize: 11.5, fontFamily: "ui-monospace, monospace", padding: "3px 0", cursor: "pointer" }}>{v}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Inputs */}
        <MultiSelect label={strings.inputDocs} options={vm.sources.documents.map((d) => d.slug)} selected={cfg.input_document_slugs} onChange={(s) => setCfg({ ...cfg, input_document_slugs: s })} />
        <MultiSelect label={strings.inputForms} options={vm.sources.forms} selected={cfg.input_form_slugs} onChange={(s) => setCfg({ ...cfg, input_form_slugs: s })} />

        {/* Dataset */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <FieldLabel>{strings.dataset}</FieldLabel>
            <a href={datasetsHref} style={{ fontSize: 11.5, color: "var(--accent)", fontWeight: 700 }}>{strings.manageDatasets}</a>
          </div>
          <SelectInput value={cfg.dataset_id ?? ""} aria-label={strings.dataset} onChange={(e) => setCfg({ ...cfg, dataset_id: e.target.value || null })}>
            <option value="">{strings.none}</option>
            {vm.datasets.filter((d) => d.active).map((d) => (
              <option key={d.id} value={d.id}>{d.name} · {compact(d.tokens)} tokens</option>
            ))}
          </SelectInput>
          {datasetExceeds && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--gold-deep)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="info" size={13} /> {strings.datasetExceeds}
            </p>
          )}
        </div>

        {/* Model (closed list) + output */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <FieldLabel>{strings.model}</FieldLabel>
            <SelectInput value={cfg.model} aria-label={strings.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })}>
              {GENERATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>{strings.outputFormat}</FieldLabel>
            <SelectInput value={cfg.output_format} aria-label={strings.outputFormat} onChange={(e) => setCfg({ ...cfg, output_format: e.target.value as GenerationConfigVM["output_format"] })}>
              <option value="pdf">PDF</option>
              <option value="docx">DOCX</option>
              <option value="md">Markdown</option>
            </SelectInput>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <FieldLabel>{strings.maxTokens}</FieldLabel>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>{cfg.max_output_tokens.toLocaleString("es-US")}</span>
          </div>
          <input type="range" min={1024} max={64000} step={512} value={cfg.max_output_tokens} onChange={(e) => setCfg({ ...cfg, max_output_tokens: Number(e.target.value) })} aria-label={strings.maxTokens} style={{ width: "100%", accentColor: "var(--accent)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--ink-3)" }}>
            {TOKEN_MARKS.map((m) => <span key={m}>{compact(m)}</span>)}
          </div>
        </div>

        <div>
          <FieldLabel>{strings.outputLanguage}</FieldLabel>
          <div role="radiogroup" aria-label={strings.outputLanguage} style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip)" }}>
            {(["es", "en", "both"] as const).map((l) => {
              const on = cfg.output_language === l;
              return (
                <button key={l} type="button" role="radio" aria-checked={on} onClick={() => setCfg({ ...cfg, output_language: l })} style={{ height: 34, padding: "0 16px", borderRadius: 9, border: "none", cursor: "pointer", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 12.5 }}>
                  {l === "es" ? strings.langEs : l === "en" ? strings.langEn : strings.langBoth}
                </button>
              );
            })}
          </div>
        </div>

        <p style={{ fontSize: 12, color: "var(--ink-3)", background: "var(--panel-2, var(--card-alt))", borderRadius: 10, padding: "10px 12px", margin: 0 }}>{strings.configFrozenNote}</p>

        <GradientBtn onClick={save} disabled={saving || !cfg.system_prompt.trim()}>{strings.saveConfig}</GradientBtn>
      </div>

      {/* RIGHT — test */}
      <div style={{ position: "sticky", top: 12, display: "flex", flexDirection: "column", gap: 14, borderRadius: 18, border: "1px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", margin: 0 }}>{strings.testWithCase}</h3>
          <Chip tone="blue">{strings.testsDontCount}</Chip>
        </div>

        <div>
          <FieldLabel>{strings.searchCase}</FieldLabel>
          <TextInput value={caseQuery} onChange={(e) => setCaseQuery(e.target.value)} placeholder={strings.searchCase} aria-label={strings.searchCase} />
          {/* The case picker is explicit: the admin types a case id (a real picker
              hits the cases search endpoint — wired by the host page). */}
          <TextInput value={caseId} onChange={(e) => setCaseId(e.target.value)} placeholder="case_id (UUID)" aria-label="case id" style={{ marginTop: 8 }} />
        </div>

        <div>
          <FieldLabel>{strings.precheck}</FieldLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[...cfg.input_document_slugs, ...cfg.input_form_slugs].length === 0 && (
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>—</span>
            )}
            {[...cfg.input_document_slugs, ...cfg.input_form_slugs].map((s) => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
                <Icon name="check" size={13} color="var(--green)" /> {s}
              </span>
            ))}
          </div>
        </div>

        <GradientBtn onClick={runTest} disabled={testing || !caseId}>{testing ? strings.testRunning : strings.testGenerate}</GradientBtn>

        {testing && (
          <div role="progressbar" aria-label={strings.testRunning} style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: "40%", borderRadius: 999, background: "linear-gradient(90deg, var(--gold), var(--gold-deep))", animation: "shimmer 1.4s ease-in-out infinite" }} />
          </div>
        )}

        {runId && !testing && (
          <div style={{ borderRadius: 14, border: "1px solid var(--line)", background: "var(--card,#fff)", padding: 14 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{strings.testResult}</p>
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-2)" }}>run: <code>{runId}</code></p>
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
              {/* Tokens/cost arrive via Realtime (EV-28/29) — the run detail panel
                  (API-AI-03) hydrates them. TODO(F4-W2): subscribe and render
                  tokens in/out + cost + frozen config here. */}
              {strings.tokensInOut} · {strings.cost} — vía Realtime
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (s: string[]) => void }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      {options.length === 0 ? (
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>—</span>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
                style={{ height: 30, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-soft)" : "var(--card,#fff)", color: on ? "var(--accent)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
              >
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function compact(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
