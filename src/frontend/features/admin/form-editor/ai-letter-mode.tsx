"use client";

import * as React from "react";
import { GradientBtn, Icon, Chip } from "@/frontend/components/brand";
import { Switch, toast } from "@/frontend/components/desktop";
import { FieldLabel, SelectInput, TextInput } from "../shared/chrome";
import { GENERATION_MODELS, DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";
import type { FormEditorVM, FormEditorActions, GenerationConfigVM, GenerationSectionVM, AssemblyBlockType } from "./types";
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
    web_search_enabled: false,
    web_search_max_uses: 5,
    research_instructions: null,
    research_model: null,
    sections: [],
    rules_enabled: true,
    rules_text: null,
    assembly: null,
  };
  const [cfg, setCfg] = React.useState<GenerationConfigVM>(initial);
  const asm = cfg.assembly ?? { cover: false, toc: false, chronology: false, closing: null };
  const updateAssembly = (patch: Partial<NonNullable<GenerationConfigVM["assembly"]>>) =>
    setCfg({ ...cfg, assembly: { ...asm, ...patch } });
  const [saving, setSaving] = React.useState(false);

  // ── Assembly: ordered blocks (document structure) ──────────────────────────
  const BLOCK_META: { type: AssemblyBlockType; label: string }[] = [
    { type: "cover", label: "Carátula (portada)" },
    { type: "toc", label: "Índice (tabla de contenidos)" },
    { type: "body", label: "Cuerpo (secciones)" },
    { type: "chronology", label: "Tabla cronológica" },
    { type: "conclusions", label: "Conclusiones (última sección, aparte)" },
    { type: "annexes", label: "Anexos (exhibits)" },
    { type: "closing", label: "Declaración bajo perjurio" },
  ];
  // Effective ordered blocks: explicit list if set, else derived from legacy flags.
  const effBlocks: { type: AssemblyBlockType; enabled: boolean }[] = asm.blocks?.length
    ? asm.blocks
    : BLOCK_META.map((b) => ({
        type: b.type,
        enabled:
          b.type === "body" ? true
          : b.type === "cover" ? !!asm.cover
          : b.type === "toc" ? !!asm.toc
          : b.type === "chronology" ? !!asm.chronology
          : b.type === "annexes" ? !!asm.annexes
          : b.type === "closing" ? !!(asm.closing && asm.closing.trim())
          : false, // conclusions: off by default in legacy configs
      }));
  const setBlocks = (blocks: { type: AssemblyBlockType; enabled: boolean }[]) => {
    const on = (t: AssemblyBlockType) => blocks.some((b) => b.type === t && b.enabled);
    // keep the legacy booleans in sync so any reader still sees consistent flags
    updateAssembly({ blocks, cover: on("cover"), toc: on("toc"), chronology: on("chronology"), annexes: on("annexes") });
  };
  const moveBlock = (i: number, dir: -1 | 1) => {
    const next = [...effBlocks];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };
  const toggleBlock = (i: number) => setBlocks(effBlocks.map((b, k) => (k === i ? { ...b, enabled: !b.enabled } : b)));
  const arrowBtn = (disabled: boolean): React.CSSProperties => ({
    border: "1px solid var(--line)", background: "transparent", borderRadius: 7, width: 26, height: 26,
    cursor: disabled ? "default" : "pointer", color: disabled ? "var(--ink-3)" : "var(--ink)", opacity: disabled ? 0.4 : 1, fontSize: 11,
  });

  // ── Assembly: editable cover (title + rows with {{token}} values) ──────────
  const DEFAULT_COVER_ROWS = [
    { label: "Country of nationality", value: "{{nationality}}" },
    { label: "Court / jurisdiction", value: "{{court}}" },
    { label: "A-Number of principal applicant", value: "{{a_number}}" },
    { label: "Derivative applicant(s) included", value: "{{derivatives}}" },
    { label: "Date of entry into the United States", value: "{{entry_date}}" },
    { label: "Principal theory", value: "{{principal_theory}}" },
  ];
  const coverPage = asm.cover_page ?? {};
  const coverRows = coverPage.rows?.length ? coverPage.rows : DEFAULT_COVER_ROWS;
  const updateCover = (patch: Partial<NonNullable<NonNullable<GenerationConfigVM["assembly"]>["cover_page"]>>) =>
    updateAssembly({ cover_page: { ...coverPage, ...patch } });
  const updateCoverRow = (i: number, patch: Partial<{ label: string; value: string }>) =>
    updateCover({ rows: coverRows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const addCoverRow = () => updateCover({ rows: [...coverRows, { label: "", value: "" }] });
  const removeCoverRow = (i: number) => updateCover({ rows: coverRows.filter((_, k) => k !== i) });

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
      web_search_enabled: cfg.web_search_enabled,
      web_search_max_uses: cfg.web_search_max_uses,
      research_instructions: cfg.research_instructions,
      research_model: cfg.research_model,
      sections: cfg.sections,
      rules_enabled: cfg.rules_enabled,
      rules_text: cfg.rules_text,
      assembly: cfg.assembly,
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

  // Sections editor (generic long-form config — generalizes v1's 17 sections)
  function addSection() {
    const next: GenerationSectionVM = { key: `s${cfg.sections.length + 1}`, heading: "", min_words: 0, max_tokens: 4000, guidance: "", type: "analysis" };
    setCfg({ ...cfg, sections: [...cfg.sections, next] });
  }
  function updateSection(idx: number, patch: Partial<GenerationSectionVM>) {
    setCfg({ ...cfg, sections: cfg.sections.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }
  function removeSection(idx: number) {
    setCfg({ ...cfg, sections: cfg.sections.filter((_, i) => i !== idx) });
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

        {/* --- v1-grade engine: research + rules + sections (generic) --- */}
        <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>Generación avanzada</h3>

          {/* Web search */}
          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <Switch checked={cfg.web_search_enabled} onCheckedChange={(c) => setCfg({ ...cfg, web_search_enabled: c })} aria-label="Búsqueda en internet" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Búsqueda en internet (jurisprudencia / condiciones de país)</span>
            </label>
            {cfg.web_search_enabled && (
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 10 }}>
                  <div>
                    <FieldLabel>Máx. búsquedas</FieldLabel>
                    <TextInput type="number" value={String(cfg.web_search_max_uses)} aria-label="Máximo de búsquedas" onChange={(e) => setCfg({ ...cfg, web_search_max_uses: Math.max(1, Math.min(10, Number(e.target.value) || 5)) })} />
                  </div>
                  <div>
                    <FieldLabel>Modelo de investigación (jurisprudencia)</FieldLabel>
                    <SelectInput value={cfg.research_model ?? ""} aria-label="Modelo de investigación" onChange={(e) => setCfg({ ...cfg, research_model: e.target.value || null })}>
                      <option value="">{strings.none ?? "—"} (usa el modelo de redacción)</option>
                      {GENERATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </SelectInput>
                  </div>
                </div>
                <div>
                  <FieldLabel>Instrucciones de investigación</FieldLabel>
                  <textarea value={cfg.research_instructions ?? ""} aria-label="Instrucciones de investigación" placeholder="Ej. Busca precedentes federales favorables por nacionalidad y tipo de persecución (CourtListener, Justia)." onChange={(e) => setCfg({ ...cfg, research_instructions: e.target.value || null })} style={{ width: "100%", minHeight: 70, borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 13, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }} />
                </div>
              </div>
            )}
          </div>

          {/* Anti-invention rules */}
          <div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <Switch checked={cfg.rules_enabled} onCheckedChange={(c) => setCfg({ ...cfg, rules_enabled: c })} aria-label="Reglas anti-invención" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>Reglas anti-invención (no inventar hechos, citas verificadas)</span>
            </label>
            {cfg.rules_enabled && (
              <textarea value={cfg.rules_text ?? ""} aria-label="Reglas personalizadas" placeholder="(Por defecto se aplican R1–R7). Escribe aquí para personalizarlas." onChange={(e) => setCfg({ ...cfg, rules_text: e.target.value || null })} style={{ width: "100%", minHeight: 60, marginTop: 10, borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 12.5, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }} />
            )}
          </div>

          {/* Sections */}
          <div>
            <FieldLabel>Secciones (documento largo)</FieldLabel>
            <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "0 0 10px" }}>Vacío = una sola generación. Con secciones, la IA genera y ensambla cada una en orden (piso de palabras + pase de expansión).</p>
            {cfg.sections.map((s, i) => (
              <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 10, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)" }}>{i + 1}</span>
                  <TextInput value={s.heading} placeholder="Título de la sección" aria-label={`Título sección ${i + 1}`} onChange={(e) => updateSection(i, { heading: e.target.value })} />
                  <button type="button" onClick={() => removeSection(i)} aria-label={`Eliminar sección ${i + 1}`} style={{ border: "none", background: "none", color: "var(--red)", cursor: "pointer", display: "inline-flex" }}><Icon name="x" size={16} /></button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
                  <div><FieldLabel>Mín. palabras</FieldLabel><TextInput type="number" value={String(s.min_words)} aria-label={`Mín palabras sección ${i + 1}`} onChange={(e) => updateSection(i, { min_words: Math.max(0, Number(e.target.value) || 0) })} /></div>
                  <div><FieldLabel>Máx. tokens</FieldLabel><TextInput type="number" value={String(s.max_tokens)} aria-label={`Máx tokens sección ${i + 1}`} onChange={(e) => updateSection(i, { max_tokens: Math.max(256, Math.min(16000, Number(e.target.value) || 4000)) })} /></div>
                  <div><FieldLabel>Tipo</FieldLabel><SelectInput value={s.type} aria-label={`Tipo sección ${i + 1}`} onChange={(e) => updateSection(i, { type: e.target.value as GenerationSectionVM["type"] })}><option value="doctrinal">Doctrinal</option><option value="narrative">Narrativa</option><option value="analysis">Análisis</option></SelectInput></div>
                  <div><FieldLabel>Modelo</FieldLabel><SelectInput value={s.model ?? ""} aria-label={`Modelo sección ${i + 1}`} onChange={(e) => updateSection(i, { model: e.target.value || null })}><option value="">Por defecto</option>{GENERATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}</SelectInput></div>
                </div>
                <textarea value={s.guidance} placeholder="Guía: qué debe cubrir esta sección" aria-label={`Guía sección ${i + 1}`} onChange={(e) => updateSection(i, { guidance: e.target.value })} style={{ width: "100%", minHeight: 56, borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 12.5, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }} />
              </div>
            ))}
            <button type="button" onClick={addSection} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Agregar sección</button>
          </div>

          {/* Ensamblado del documento — estructura configurable por bloques */}
          <div>
            <FieldLabel>Ensamblado del documento</FieldLabel>
            <p style={{ fontSize: 11.5, color: "var(--ink-3)", margin: "0 0 10px" }}>Estructura del documento final. Activa/desactiva cada bloque y reordénalos con ▲▼ (cada uno empieza en su página cuando corresponde). El “Cuerpo” son las secciones de arriba; “Conclusiones” rinde la última sección por separado, para que la tabla cronológica quede antes de ella.</p>

            {/* Lista de bloques (orden + on/off) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              {effBlocks.map((b, i) => {
                const meta = BLOCK_META.find((m) => m.type === b.type);
                return (
                  <div key={b.type} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", opacity: b.enabled ? 1 : 0.5 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)", width: 16, textAlign: "center" }}>{i + 1}</span>
                    <Switch checked={b.enabled} onCheckedChange={() => toggleBlock(i)} aria-label={`Activar ${meta?.label ?? b.type}`} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--ink)" }}>{meta?.label ?? b.type}</span>
                    <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label={`Subir ${meta?.label ?? b.type}`} style={arrowBtn(i === 0)}>▲</button>
                    <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === effBlocks.length - 1} aria-label={`Bajar ${meta?.label ?? b.type}`} style={arrowBtn(i === effBlocks.length - 1)}>▼</button>
                  </div>
                );
              })}
            </div>

            {/* Carátula editable (título + filas con variables) */}
            <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, marginBottom: 14, display: "grid", gap: 10 }}>
              <FieldLabel>Carátula (primera página)</FieldLabel>
              <div>
                <FieldLabel>Título del documento</FieldLabel>
                <TextInput value={coverPage.title ?? ""} placeholder="LEGAL MEMORANDUM AND APPLICANT DECLARATION IN SUPPORT OF ASYLUM" aria-label="Título de la carátula" onChange={(e) => updateCover({ title: e.target.value || undefined })} />
              </div>
              <div>
                <FieldLabel>Filas (etiqueta · valor)</FieldLabel>
                {coverRows.map((r, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                    <TextInput value={r.label} placeholder="País de nacionalidad" aria-label={`Etiqueta fila ${i + 1}`} onChange={(e) => updateCoverRow(i, { label: e.target.value })} />
                    <TextInput value={r.value} placeholder="{{nationality}}" aria-label={`Valor fila ${i + 1}`} onChange={(e) => updateCoverRow(i, { value: e.target.value })} />
                    <button type="button" onClick={() => removeCoverRow(i)} aria-label={`Eliminar fila ${i + 1}`} style={{ border: "none", background: "none", color: "var(--red)", cursor: "pointer", display: "inline-flex" }}><Icon name="x" size={16} /></button>
                  </div>
                ))}
                <button type="button" onClick={addCoverRow} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Agregar fila</button>
                <p style={{ fontSize: 11, color: "var(--ink-3)", margin: "8px 0 0" }}>Variables: <code>{"{{nationality}}"}</code>, <code>{"{{court}}"}</code>, <code>{"{{a_number}}"}</code>, <code>{"{{derivatives}}"}</code>, <code>{"{{entry_date}}"}</code>, <code>{"{{principal_theory}}"}</code>, <code>{"{{applicant_name}}"}</code> y cualquier campo extraído de los documentos de entrada. Sin marca del despacho ni número interno de caso.</p>
              </div>
            </div>

            {/* Cierre (declaración bajo perjurio) */}
            <div>
              <FieldLabel>Declaración bajo perjurio / firma</FieldLabel>
              <textarea value={asm.closing ?? ""} aria-label="Cierre del documento" placeholder="Ej. I declare under penalty of perjury under the laws of the United States that the foregoing is true and correct…" onChange={(e) => updateAssembly({ closing: e.target.value || null })} style={{ width: "100%", minHeight: 60, borderRadius: 12, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 12.5, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }} />
            </div>
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
