"use client";

import * as React from "react";
import { Icon, GradientBtn } from "@/frontend/components/brand";
import { Switch, toast } from "@/frontend/components/desktop";
import { FieldLabel, SelectInput, TextInput } from "../shared/chrome";
import { GENERATION_MODELS, DEFAULT_GENERATION_MODEL } from "@/shared/constants/ai-models";
import { StructureEditor } from "./structure-editor";
import { PublishStage } from "./publish-stage";
import { VersionChips } from "./pdf-mode";
import type { FormEditorVM, FormEditorActions, QuestionGroupVM, QuestionnaireGenConfigVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * QuestionnaireMode — editor for the PDF-less `questionnaire` kind (Etapa B).
 *
 * A companion questionnaire of an ai_letter: its answers feed the generation. Same
 * question infra as pdf_automation (groups/questions, AI-field sources, conditions)
 * but with NO PDF — so just two stages: Estructurar (full-width StructureEditor,
 * noPdf) and Publicar. Immutable published versions get a "make editable" action.
 */

const STAGES = [
  { id: "structure", key: "stageStructure" },
  { id: "publish", key: "stagePublish" },
] as const;
type StageId = (typeof STAGES)[number]["id"];

export interface QuestionnaireModeProps {
  vm: FormEditorVM;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  activeVersionId: string | null;
  onSelectVersion: (id: string) => void;
}

export function QuestionnaireMode({ vm, strings, actions, activeVersionId, onSelectVersion }: QuestionnaireModeProps) {
  const open = vm.openVersion;
  const readOnly = !!open && open.version.status !== "draft";
  const [stage, setStage] = React.useState<StageId>("structure");
  const [groups, setGroups] = React.useState<QuestionGroupVM[]>(open?.groups ?? []);
  const [duplicating, setDuplicating] = React.useState(false);

  React.useEffect(() => {
    setGroups(open?.groups ?? []);
  }, [open?.version.id, open?.groups]);

  async function handleDuplicate() {
    if (!open) return;
    setDuplicating(true);
    const r = await actions.duplicateVersion(open.version.id);
    if (r.success && r.data) {
      window.location.href = `${window.location.pathname}?v=${r.data.id}`;
    } else {
      setDuplicating(false);
      toast.error(r.error?.code ?? "Error");
    }
  }

  return (
    <div>
      <VersionChips versions={vm.versions} activeId={activeVersionId} onSelect={onSelectVersion} strings={strings} />

      <QuestionnaireGenConfigPanel vm={vm} actions={actions} />

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

      {/* 2-stage bar */}
      <div style={{ display: "flex", gap: 8, margin: "18px 0 22px", flexWrap: "wrap" }}>
        {STAGES.map((s, i) => {
          const on = stage === s.id;
          const reachable = !!open;
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

      {stage === "structure" && open && (
        <StructureEditor
          vm={vm}
          groups={groups}
          setGroups={setGroups}
          pdfUrl={null}
          versionId={open.version.id}
          readOnly={readOnly}
          lang="es"
          strings={strings}
          actions={actions}
          noPdf
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
    </div>
  );
}

/**
 * QuestionnaireGenConfigPanel (Ola 3) — configures HOW this questionnaire's
 * questions are sourced: global (fixed), automatic (all AI per-case), or hybrid
 * (fixed base + AI follow-ups). In automatic/hybrid, admin picks the context
 * forms/documents the AI reads, the prerequisite forms, the generation prompt,
 * the model, and the triggers. Persists via updateQuestionnaireGenerationConfig.
 */
function QuestionnaireGenConfigPanel({ vm, actions }: { vm: FormEditorVM; actions: FormEditorActions }) {
  const initial: QuestionnaireGenConfigVM = vm.questionnaireGenConfig ?? {
    mode: "global", generation_prompt: null, input_document_slugs: [], input_form_slugs: [],
    prerequisite_form_slugs: [], prerequisite_document_slugs: [], target_question_count: 15,
    model: null, hybrid_layout: "append_group", auto_trigger: true, allow_client_trigger: false, on_new_evidence: "flag",
  };
  const [cfg, setCfg] = React.useState<QuestionnaireGenConfigVM>(initial);
  const [saving, setSaving] = React.useState(false);
  function set<K extends keyof QuestionnaireGenConfigVM>(k: K, v: QuestionnaireGenConfigVM[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  const formOptions = vm.sources.allFormSlugs.filter((s) => s !== vm.form.slug);
  const docOptions = vm.sources.documents.map((d) => d.slug);
  const isDynamic = cfg.mode !== "global";

  async function save() {
    setSaving(true);
    const r = await actions.saveQuestionnaireGenConfig({
      form_definition_id: vm.form.id,
      mode: cfg.mode,
      generation_prompt: cfg.generation_prompt || null,
      input_document_slugs: cfg.input_document_slugs,
      input_form_slugs: cfg.input_form_slugs,
      prerequisite_form_slugs: cfg.prerequisite_form_slugs,
      prerequisite_document_slugs: cfg.prerequisite_document_slugs,
      target_question_count: cfg.target_question_count,
      model: cfg.model,
      hybrid_layout: cfg.hybrid_layout,
      auto_trigger: cfg.auto_trigger,
      allow_client_trigger: cfg.allow_client_trigger,
      on_new_evidence: cfg.on_new_evidence,
    });
    setSaving(false);
    if (r.success) toast.success("Configuración guardada"); else toast.error(r.error?.message ?? "Error");
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 16, padding: 20, marginTop: 16, marginBottom: 8, background: "var(--card,#fff)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Icon name="sparkle" size={18} color="var(--gold-deep)" />
        <h2 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>Generación de preguntas por caso</h2>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
        Elige cómo se crean las preguntas que responde el cliente. En automático/híbrido, la IA lee el formulario y los documentos del caso y genera preguntas profundas y específicas.
      </p>

      <FieldLabel>Modo</FieldLabel>
      <div role="radiogroup" aria-label="Modo" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {([["global", "Global (fijas)"], ["automatic", "Automático (IA)"], ["hybrid", "Híbrido (base + IA)"]] as const).map(([val, lbl]) => {
          const on = cfg.mode === val;
          return (
            <button key={val} type="button" role="radio" aria-checked={on} onClick={() => set("mode", val)}
              style={{ height: 38, padding: "0 14px", borderRadius: 12, border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-soft)" : "var(--card,#fff)", color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
              {lbl}
            </button>
          );
        })}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>
        {cfg.mode === "global" ? "Las preguntas fijas del editor de abajo, iguales para todos los clientes."
          : cfg.mode === "automatic" ? "Todas las preguntas las genera la IA por caso desde los formularios y documentos."
          : "Las preguntas base de abajo SIEMPRE + follow-ups que la IA agrega por caso."}
      </p>

      {isDynamic && (
        <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
          <MultiSelect label="Formularios de contexto (los lee la IA)" options={formOptions} selected={cfg.input_form_slugs} onChange={(s) => set("input_form_slugs", s)} />
          <MultiSelect label="Documentos de contexto (los lee la IA)" options={docOptions} selected={cfg.input_document_slugs} onChange={(s) => set("input_document_slugs", s)} />
          <MultiSelect label="Formularios requeridos antes de generar (prerrequisito)" options={formOptions} selected={cfg.prerequisite_form_slugs} onChange={(s) => set("prerequisite_form_slugs", s)} />

          <div>
            <FieldLabel>Instrucciones para la IA (qué profundizar)</FieldLabel>
            <textarea value={cfg.generation_prompt ?? ""} onChange={(e) => set("generation_prompt", e.target.value)} rows={4}
              placeholder="Ej.: indaga en profundidad — abuso → dónde, cuándo, testigos, qué pasó después; conecta fechas con eventos públicos; no inventes."
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid var(--line)", fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "0 1 180px", minWidth: 140 }}>
              <FieldLabel>Nº de preguntas objetivo</FieldLabel>
              <TextInput type="number" value={String(cfg.target_question_count ?? "")} onChange={(e) => set("target_question_count", e.target.value ? Number(e.target.value) : null)} aria-label="Nº de preguntas objetivo" />
            </div>
            <div style={{ flex: "0 1 240px", minWidth: 180 }}>
              <FieldLabel>Modelo</FieldLabel>
              <SelectInput value={cfg.model ?? ""} aria-label="Modelo" onChange={(e) => set("model", e.target.value || null)}>
                <option value="">Por defecto ({DEFAULT_GENERATION_MODEL})</option>
                {GENERATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </SelectInput>
            </div>
            {cfg.mode === "hybrid" && (
              <div style={{ flex: "0 1 240px", minWidth: 180 }}>
                <FieldLabel>Orden (híbrido)</FieldLabel>
                <SelectInput value={cfg.hybrid_layout} aria-label="Orden híbrido" onChange={(e) => set("hybrid_layout", e.target.value as QuestionnaireGenConfigVM["hybrid_layout"])}>
                  <option value="append_group">Base primero, luego IA</option>
                  <option value="merge_by_topic">Intercaladas por tema</option>
                </SelectInput>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)", cursor: "pointer" }}>
              <Switch checked={cfg.auto_trigger} onCheckedChange={(v) => set("auto_trigger", v)} aria-label="Generar automáticamente" /> Generar automáticamente al cumplir requisitos
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)", cursor: "pointer" }}>
              <Switch checked={cfg.allow_client_trigger} onCheckedChange={(v) => set("allow_client_trigger", v)} aria-label="Permitir que el cliente lo pida" /> Permitir que el cliente lo pida
            </label>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <GradientBtn onClick={save} disabled={saving} aria-label="Guardar configuración">
          {saving ? "Guardando…" : "Guardar configuración"}
        </GradientBtn>
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
              <button key={o} type="button" aria-pressed={on} onClick={() => onChange(on ? selected.filter((x) => x !== o) : [...selected, o])}
                style={{ height: 30, padding: "0 12px", borderRadius: 999, border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, background: on ? "var(--accent-soft)" : "var(--card,#fff)", color: on ? "var(--accent)" : "var(--ink-2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
                {o}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
