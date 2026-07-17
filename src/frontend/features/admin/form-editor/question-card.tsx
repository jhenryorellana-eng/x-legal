"use client";

import * as React from "react";
import { Icon, Chip } from "@/frontend/components/brand";
import { Switch } from "@/frontend/components/desktop";
import { I18nField } from "../shared/i18n-field";
import { FieldLabel, SelectInput, TextInput } from "../shared/chrome";
import { GENERATION_MODELS } from "@/shared/constants/ai-models";
import type {
  QuestionVM,
  FieldType,
  QuestionSource,
  DetectedFieldVM,
  SourceDocumentVM,
} from "./types";
import type { FormEditorStrings } from "./strings";
import type { ConditionAction, ConditionOp } from "@/shared/form-logic/conditions";

const PII_FIELDS = new Set(["pii.ssn", "pii.a_number", "pii.passport"]);

const FIELD_TYPES: { id: FieldType; key: string }[] = [
  { id: "text", key: "ftText" },
  { id: "number", key: "ftNumber" },
  { id: "date", key: "ftDate" },
  { id: "checkbox", key: "ftCheckbox" },
  { id: "select", key: "ftSelect" },
  { id: "multiselect", key: "ftMultiselect" },
  { id: "textarea", key: "ftTextarea" },
];

const ORIGINS: { id: QuestionSource; key: string; icon: Parameters<typeof Icon>[0]["name"] }[] = [
  { id: "client_answer", key: "originClient", icon: "user" },
  { id: "ai_field", key: "originAiField", icon: "bolt" },
  { id: "document_extraction", key: "originDoc", icon: "doc" },
  { id: "generation_output", key: "originGen", icon: "sparkle" },
  { id: "profile", key: "originProfile", icon: "shield" },
];

export interface QuestionCardProps {
  question: QuestionVM;
  expanded: boolean;
  selected: boolean;
  duplicateMapping: boolean;
  detectedFields: DetectedFieldVM[];
  /** Questionnaire mode: hide the AcroForm PDF-field mapping. */
  noPdf?: boolean;
  sources: { documents: SourceDocumentVM[]; forms: string[]; profileFields: string[] };
  groups: { id: string; label: string }[];
  /** Other questions in the form (id + label) that a condition may depend on. */
  siblingQuestions: { id: string; label: string }[];
  strings: FormEditorStrings;
  readOnly: boolean;
  /** "Mejorar con IA" stays editable on draft AND published versions (own save
   *  path) — only archived versions lock it. Independent of `readOnly`. */
  aiImproveEditable: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<QuestionVM>) => void;
  /** Persist ai_improve via its dedicated action (never part of onChange). */
  onAiImproveChange: (aiImprove: { instruction: string } | null) => void;
  onDelete: () => void;
  onMoveToGroup: (groupId: string) => void;
  onFocusField: (name: string | null) => void;
}

export function QuestionCard({
  question,
  expanded,
  selected,
  duplicateMapping,
  detectedFields,
  noPdf = false,
  sources,
  groups,
  siblingQuestions,
  strings,
  readOnly,
  aiImproveEditable,
  onToggle,
  onChange,
  onAiImproveChange,
  onDelete,
  onMoveToGroup,
  onFocusField,
}: QuestionCardProps) {
  const q = question;
  const title = q.question_i18n.es || q.question_i18n.en || "Pregunta sin redactar";
  const originMeta = ORIGINS.find((o) => o.id === q.source)!;

  return (
    <div
      style={{
        borderRadius: 14,
        border: `1.5px solid ${selected ? "var(--accent)" : "var(--line)"}`,
        background: "var(--card, #fff)",
        marginBottom: 8,
        boxShadow: selected ? "0 0 0 4px var(--accent-soft)" : "none",
        transition: "box-shadow .15s, border-color .15s",
      }}
    >
      {/* Compact row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          cursor: "pointer",
        }}
      >
        <span aria-hidden style={{ color: "var(--ink-3)", display: "inline-flex" }}>
          <Icon name="route" size={16} />
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        {q.proposed && (
          <Chip tone="amber">
            <Icon name="sparkle" size={12} /> {strings.proposed}
          </Chip>
        )}
        {q.source !== "client_answer" && (
          <span aria-hidden style={{ color: "var(--accent)", display: "inline-flex" }}>
            <Icon name={originMeta.icon} size={14} />
          </span>
        )}
        <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 9px", borderRadius: 999, background: "var(--chip)", color: "var(--ink-2)", fontSize: 11.5, fontWeight: 800, whiteSpace: "nowrap" }}>
          {tType(q.field_type, strings)}
        </span>
        <span aria-hidden style={{ color: "var(--ink-3)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform .15s", display: "inline-flex" }}>
          <Icon name="chevR" size={16} />
        </span>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid var(--line)" }}>
          <div style={{ marginTop: 12 }}>
            <I18nField
              label={strings.questionWording}
              value={q.question_i18n}
              onChange={(v) => onChange({ question_i18n: v, proposed: false })}
            />
          </div>
          <I18nField
            label={strings.questionHelp}
            value={q.help_i18n}
            onChange={(v) => onChange({ help_i18n: v })}
            multiline
            flagMissingEn={false}
          />

          {/* Type + required */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "end" }}>
            <div>
              <FieldLabel>{strings.fieldType}</FieldLabel>
              <SelectInput
                value={q.field_type}
                disabled={readOnly}
                onChange={(e) => onChange({ field_type: e.target.value as FieldType })}
                aria-label={strings.fieldType}
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft.id} value={ft.id}>
                    {strings[ft.key]}
                  </option>
                ))}
              </SelectInput>
            </div>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, paddingBottom: 9 }}>
              <Switch
                checked={q.is_required}
                onCheckedChange={(c) => onChange({ is_required: c })}
                disabled={readOnly}
                aria-label={strings.required}
              />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{strings.required}</span>
            </label>
          </div>

          {/* Empty-field policy + verbatim (PDF forms only — questionnaires don't render a PDF) */}
          {!noPdf && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 14, alignItems: "end" }}>
                <div>
                  <FieldLabel>{strings.emptyPolicy}</FieldLabel>
                  <SelectInput
                    value={q.empty_policy ?? "inherit"}
                    disabled={readOnly}
                    onChange={(e) => onChange({ empty_policy: e.target.value as QuestionVM["empty_policy"] })}
                    aria-label={strings.emptyPolicy}
                  >
                    <option value="inherit">{strings.emptyPolicyInherit}</option>
                    <option value="na">{strings.emptyPolicyNa}</option>
                    <option value="blank">{strings.emptyPolicyBlank}</option>
                    <option value="custom">{strings.emptyPolicyCustom}</option>
                  </SelectInput>
                </div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, paddingBottom: 9 }}>
                  <Switch
                    checked={q.no_translate ?? false}
                    onCheckedChange={(c) => onChange({ no_translate: c })}
                    disabled={readOnly}
                    aria-label={strings.noTranslate}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{strings.noTranslate}</span>
                </label>
              </div>
              {q.empty_policy === "custom" && (
                <div>
                  <FieldLabel>{strings.emptyPlaceholder}</FieldLabel>
                  <TextInput
                    value={q.empty_placeholder ?? ""}
                    disabled={readOnly}
                    placeholder="N/A"
                    onChange={(e) => onChange({ empty_placeholder: e.target.value || null })}
                    aria-label={strings.emptyPlaceholder}
                  />
                </div>
              )}
              <p style={{ margin: "-4px 0 0", fontSize: 11.5, color: "var(--ink-3)" }}>{strings.emptyPolicyHint}</p>
            </>
          )}

          {/* Options editor (select + multiselect map a group of checkboxes) */}
          {(q.field_type === "select" || q.field_type === "multiselect") && (
            <OptionsEditor question={q} strings={strings} readOnly={readOnly} onChange={onChange} />
          )}

          {/* PDF mapping (hidden in questionnaire mode — no AcroForm) */}
          {!noPdf && (
            <div>
              <FieldLabel>{strings.pdfMapping}</FieldLabel>
              <SelectInput
                value={q.pdf_field_name ?? ""}
                disabled={readOnly}
                onChange={(e) => {
                  const v = e.target.value || null;
                  onChange({ pdf_field_name: v });
                  onFocusField(v);
                }}
                aria-label={strings.pdfMapping}
                style={duplicateMapping ? { borderColor: "var(--gold-deep)" } : undefined}
              >
                <option value="">{strings.noPdfField}</option>
                {detectedFields.map((f) => (
                  <option key={f.pdf_field_name} value={f.pdf_field_name}>
                    {f.pdf_field_name} · {strings.pageLabel} {f.page} · {f.field_type}
                  </option>
                ))}
              </SelectInput>
              {duplicateMapping && (
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--gold-deep)" }}>{strings.dupFieldWarn}</p>
              )}
              {!readOnly && (
                <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-3)" }}>{strings.pdfMappingHint}</p>
              )}
            </div>
          )}

          {/* Origin segmented selector */}
          <div>
            <FieldLabel>{strings.origin}</FieldLabel>
            <div role="radiogroup" aria-label={strings.origin} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
              {ORIGINS.map((o) => {
                const on = q.source === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly}
                    onClick={() => onChange({ source: o.id, source_ref: defaultRef(o.id) })}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 5,
                      padding: "10px 6px",
                      borderRadius: 12,
                      border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`,
                      background: on ? "var(--accent-soft)" : "var(--panel-2, var(--card-alt))",
                      color: on ? "var(--accent)" : "var(--ink-2)",
                      cursor: readOnly ? "default" : "pointer",
                      fontSize: 11.5,
                      fontWeight: 800,
                      textAlign: "center",
                    }}
                  >
                    <Icon name={o.icon} size={16} />
                    {strings[o.key]}
                  </button>
                );
              })}
            </div>

            {/* Origin-specific pickers */}
            {q.source === "client_answer" && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{strings.originClientNote}</p>
            )}
            {q.source !== "client_answer" && (
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.4 }}>{strings.originNotShown}</p>
            )}

            {q.source === "document_extraction" && (
              <DocExtractionPicker q={q} sources={sources} strings={strings} readOnly={readOnly} onChange={onChange} />
            )}
            {q.source === "generation_output" && (
              <GenOutputPicker q={q} sources={sources} strings={strings} readOnly={readOnly} onChange={onChange} />
            )}
            {q.source === "profile" && (
              <ProfilePicker q={q} sources={sources} strings={strings} readOnly={readOnly} onChange={onChange} />
            )}
            {q.source === "ai_field" && (
              <AiFieldPicker q={q} sources={sources} strings={strings} readOnly={readOnly} onChange={onChange} />
            )}
          </div>

          {/* "Mejorar con IA" (text/textarea only) — own save path, editable on published */}
          {(q.field_type === "text" || q.field_type === "textarea") && (
            <AiImproveEditor q={q} strings={strings} editable={aiImproveEditable} onSave={onAiImproveChange} />
          )}

          {/* Validation (advanced) */}
          <ValidationPopover q={q} strings={strings} readOnly={readOnly} onChange={onChange} />

          {/* Conditional / dynamic visibility */}
          <ConditionEditor q={q} siblings={siblingQuestions} strings={strings} readOnly={readOnly} onChange={onChange} />

          {/* Footer actions */}
          {!readOnly && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-2)" }}>
                {strings.moveToGroup}
                <SelectInput
                  value=""
                  onChange={(e) => e.target.value && onMoveToGroup(e.target.value)}
                  aria-label={strings.moveToGroup}
                  style={{ height: 34, width: "auto", minWidth: 160 }}
                >
                  <option value="">—</option>
                  {groups.filter((g) => g.id !== q.group_id).map((g) => (
                    <option key={g.id} value={g.id}>{g.label}</option>
                  ))}
                </SelectInput>
              </label>
              <button
                type="button"
                onClick={onDelete}
                style={{ border: "none", background: "none", color: "var(--red)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <Icon name="x" size={14} /> {strings.deleteQuestion}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function tType(ft: FieldType, s: FormEditorStrings): string {
  return s[{ text: "ftText", number: "ftNumber", date: "ftDate", checkbox: "ftCheckbox", select: "ftSelect", multiselect: "ftMultiselect", textarea: "ftTextarea" }[ft]];
}

function defaultRef(source: QuestionSource): Record<string, unknown> | null {
  switch (source) {
    case "document_extraction":
      return { document_slug: "", json_path: "" };
    case "generation_output":
      return { form_slug: "", output_path: "" };
    case "profile":
      return { profile_field: "" };
    case "ai_field":
      return { connected: { kind: "document", slug: "" }, instruction: "" };
    default:
      return null;
  }
}

function OptionsEditor({
  question,
  strings,
  readOnly,
  onChange,
}: {
  question: QuestionVM;
  strings: FormEditorStrings;
  readOnly: boolean;
  onChange: (patch: Partial<QuestionVM>) => void;
}) {
  const opts = question.options ?? [];
  const update = (next: typeof opts) => onChange({ options: next });
  return (
    <div>
      <FieldLabel>{strings.options}</FieldLabel>
      {opts.length === 0 && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--gold-deep)" }}>{strings.optionsRequired}</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {opts.map((o, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr auto", gap: 6, alignItems: "center" }}>
            <TextInput value={o.value} placeholder="value" disabled={readOnly} onChange={(e) => { const n = [...opts]; n[i] = { ...o, value: e.target.value }; update(n); }} style={{ height: 36 }} aria-label={`option value ${i + 1}`} />
            <TextInput value={o.label_i18n.es ?? ""} placeholder="ES" disabled={readOnly} onChange={(e) => { const n = [...opts]; n[i] = { ...o, label_i18n: { ...o.label_i18n, es: e.target.value } }; update(n); }} style={{ height: 36 }} aria-label={`option ES ${i + 1}`} />
            <TextInput value={o.label_i18n.en ?? ""} placeholder="EN" disabled={readOnly} onChange={(e) => { const n = [...opts]; n[i] = { ...o, label_i18n: { ...o.label_i18n, en: e.target.value } }; update(n); }} style={{ height: 36 }} aria-label={`option EN ${i + 1}`} />
            <button type="button" disabled={readOnly} onClick={() => update(opts.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "var(--ink-3)", cursor: "pointer", display: "inline-flex" }} aria-label="remove option"><Icon name="x" size={15} /></button>
          </div>
        ))}
      </div>
      {!readOnly && (
        <button type="button" onClick={() => update([...opts, { value: "", label_i18n: { es: "", en: "" } }])} style={{ marginTop: 8, border: "none", background: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{strings.addOption}</button>
      )}
    </div>
  );
}

function DocExtractionPicker({ q, sources, strings, readOnly, onChange }: PickerProps) {
  const ref = (q.source_ref ?? {}) as { document_slug?: string; json_path?: string };
  const doc = sources.documents.find((d) => d.slug === ref.document_slug);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
      <div>
        <FieldLabel>{strings.pickDocument}</FieldLabel>
        <SelectInput value={ref.document_slug ?? ""} disabled={readOnly} aria-label={strings.pickDocument} onChange={(e) => onChange({ source_ref: { ...ref, document_slug: e.target.value, json_path: "" } })}>
          <option value="">—</option>
          {sources.documents.map((d) => <option key={d.slug} value={d.slug}>{d.slug}</option>)}
        </SelectInput>
      </div>
      <div>
        <FieldLabel>{strings.pickPath}</FieldLabel>
        <SelectInput value={ref.json_path ?? ""} disabled={readOnly || !doc} aria-label={strings.pickPath} onChange={(e) => onChange({ source_ref: { ...ref, json_path: e.target.value } })}>
          <option value="">—</option>
          {(doc?.paths ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </SelectInput>
      </div>
    </div>
  );
}

function GenOutputPicker({ q, sources, strings, readOnly, onChange }: PickerProps) {
  const ref = (q.source_ref ?? {}) as { form_slug?: string; output_path?: string };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
      <div>
        <FieldLabel>{strings.pickForm}</FieldLabel>
        <SelectInput value={ref.form_slug ?? ""} disabled={readOnly} aria-label={strings.pickForm} onChange={(e) => onChange({ source_ref: { ...ref, form_slug: e.target.value } })}>
          <option value="">—</option>
          {sources.forms.map((f) => <option key={f} value={f}>{f}</option>)}
        </SelectInput>
      </div>
      <div>
        <FieldLabel>{strings.pickPath}</FieldLabel>
        <TextInput value={ref.output_path ?? ""} disabled={readOnly} placeholder="output.field" aria-label={strings.pickPath} onChange={(e) => onChange({ source_ref: { ...ref, output_path: e.target.value } })} />
      </div>
    </div>
  );
}

function ProfilePicker({ q, sources, strings, readOnly, onChange }: PickerProps) {
  const ref = (q.source_ref ?? {}) as { profile_field?: string };
  const isPii = PII_FIELDS.has(ref.profile_field ?? "");
  return (
    <div style={{ marginTop: 10 }}>
      <FieldLabel>{strings.pickProfileField}</FieldLabel>
      <SelectInput value={ref.profile_field ?? ""} disabled={readOnly} aria-label={strings.pickProfileField} onChange={(e) => onChange({ source_ref: { profile_field: e.target.value } })}>
        <option value="">—</option>
        {sources.profileFields.map((f) => (
          <option key={f} value={f}>{PII_FIELDS.has(f) ? `🔒 ${f}` : f}</option>
        ))}
      </SelectInput>
      {isPii && (
        <p style={{ margin: "8px 0 0", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
          <Icon name="shield" size={13} /> {strings.piiLocked}
        </p>
      )}
    </div>
  );
}

/**
 * AiFieldPicker — configure a field that AI fills at resolution time, connected to
 * a client DOCUMENT (Gemini interprets it) or an ai_letter GENERATION (Anthropic
 * synthesizes from it), guided by a per-field instruction + optional model override.
 */
function AiFieldPicker({ q, sources, strings, readOnly, onChange }: PickerProps) {
  const ref = (q.source_ref ?? {}) as {
    connected?: { kind?: string; slug?: string; context_slugs?: string[] };
    instruction?: string;
    model?: string | null;
  };
  const kind: "document" | "ai_letter" = ref.connected?.kind === "ai_letter" ? "ai_letter" : "document";
  const slug = ref.connected?.slug ?? "";
  const contextSlugs = kind === "document" ? (ref.connected?.context_slugs ?? []) : [];
  const options = kind === "document" ? sources.documents.map((d) => d.slug) : sources.forms;
  const setKind = (k: "document" | "ai_letter") => onChange({ source_ref: { ...ref, connected: { kind: k, slug: "" } } });
  const setSlug = (s: string) => {
    // Keep the context set when the primary changes; the new primary can't be its own context.
    const nextCtx = contextSlugs.filter((x) => x !== s);
    onChange({ source_ref: { ...ref, connected: { kind, slug: s, ...(nextCtx.length ? { context_slugs: nextCtx } : {}) } } });
  };
  const toggleContext = (s: string) => {
    const next = contextSlugs.includes(s) ? contextSlugs.filter((x) => x !== s) : [...contextSlugs, s];
    onChange({ source_ref: { ...ref, connected: { kind, slug, ...(next.length ? { context_slugs: next } : {}) } } });
  };
  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <div role="radiogroup" aria-label={strings.aiFieldConnect} style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 10, background: "var(--chip)", width: "fit-content" }}>
        {([["document", strings.aiFieldKindDocument], ["ai_letter", strings.aiFieldKindLetter]] as const).map(([k, label]) => {
          const on = kind === k;
          return (
            <button key={k} type="button" role="radio" aria-checked={on} disabled={readOnly} onClick={() => setKind(k)}
              style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "none", cursor: readOnly ? "default" : "pointer", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: 700, fontSize: 12 }}>
              {label}
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: kind === "ai_letter" ? "1fr 1fr" : "1fr", gap: 8 }}>
        <div>
          <FieldLabel>{kind === "document" ? strings.aiFieldPickDocument : strings.aiFieldPickLetter}</FieldLabel>
          <SelectInput value={slug} disabled={readOnly} aria-label={strings.aiFieldPickConnected} onChange={(e) => setSlug(e.target.value)}>
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </SelectInput>
        </div>
        {kind === "ai_letter" && (
          <div>
            <FieldLabel>{strings.aiFieldModel}</FieldLabel>
            <SelectInput value={ref.model ?? ""} disabled={readOnly} aria-label={strings.aiFieldModel} onChange={(e) => onChange({ source_ref: { ...ref, model: e.target.value || null } })}>
              <option value="">{strings.aiFieldModelAuto}</option>
              {GENERATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </SelectInput>
          </div>
        )}
      </div>
      {kind === "document" && sources.documents.length > 1 && (
        <div>
          <FieldLabel>{strings.aiFieldContextDocs}</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {sources.documents.filter((d) => d.slug !== slug).map((d) => {
              const on = contextSlugs.includes(d.slug);
              const full = !on && contextSlugs.length >= 5;
              return (
                <button
                  key={d.slug}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={readOnly || full}
                  onClick={() => toggleContext(d.slug)}
                  style={{ height: 28, padding: "0 10px", borderRadius: 999, border: `1.5px solid ${on ? "var(--accent)" : "var(--line)"}`, cursor: readOnly || full ? "default" : "pointer", background: on ? "var(--accent-soft)" : "transparent", color: on ? "var(--accent)" : "var(--ink-2)", fontWeight: 600, fontSize: 12, opacity: full ? 0.5 : 1 }}
                >
                  {d.slug}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-2)" }}>{strings.aiFieldContextDocsHint}</p>
        </div>
      )}
      <div>
        <FieldLabel>{strings.aiFieldInstruction}</FieldLabel>
        <textarea
          value={ref.instruction ?? ""}
          disabled={readOnly}
          aria-label={strings.aiFieldInstruction}
          placeholder={strings.aiFieldInstructionHint}
          onChange={(e) => onChange({ source_ref: { ...ref, instruction: e.target.value } })}
          style={{ width: "100%", minHeight: 64, borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 12.5, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }}
        />
      </div>
    </div>
  );
}

interface PickerProps {
  q: QuestionVM;
  sources: { documents: SourceDocumentVM[]; forms: string[]; profileFields: string[] };
  strings: FormEditorStrings;
  readOnly: boolean;
  onChange: (patch: Partial<QuestionVM>) => void;
}

/**
 * "Mejorar con IA" per-question config. Persists through its OWN action
 * (updateQuestionAiImprove) so a published version stays editable here while
 * the rest of the card is read-only. Toggle OFF saves null immediately; the
 * instruction saves on blur (a toggled-on field with an empty instruction is
 * not persisted — the button never shows without an instruction).
 */
function AiImproveEditor({
  q,
  strings,
  editable,
  onSave,
}: {
  q: QuestionVM;
  strings: FormEditorStrings;
  editable: boolean;
  onSave: (aiImprove: { instruction: string } | null) => void;
}) {
  const saved = q.ai_improve?.instruction ?? "";
  const [enabled, setEnabled] = React.useState(!!saved.trim());
  const [text, setText] = React.useState(saved);

  // Re-sync when the card re-renders for another question / an external update.
  React.useEffect(() => {
    const s = q.ai_improve?.instruction ?? "";
    setEnabled(!!s.trim());
    setText(s);
  }, [q.id, q.ai_improve]);

  const toggle = (c: boolean) => {
    setEnabled(c);
    if (!c) {
      if (saved.trim()) onSave(null);
    } else if (text.trim()) {
      onSave({ instruction: text.trim() });
    }
  };

  const commit = () => {
    if (!enabled) return;
    const t = text.trim();
    if (t && t !== saved) onSave({ instruction: t });
  };

  return (
    <div style={{ borderRadius: 12, border: "1.5px solid var(--line)", padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>
          <Icon name="sparkle" size={15} color="var(--accent)" /> {strings.aiImproveSection}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={!editable}
          aria-label={strings.aiImproveEnable}
        />
      </div>
      {enabled && (
        <div>
          <FieldLabel>{strings.aiImproveInstruction}</FieldLabel>
          <textarea
            value={text}
            disabled={!editable}
            aria-label={strings.aiImproveInstruction}
            placeholder={strings.aiImproveInstructionHint}
            maxLength={4000}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            style={{ width: "100%", minHeight: 84, borderRadius: 10, border: "1.5px solid var(--line)", background: "var(--panel-2, var(--card-alt))", padding: 10, fontSize: 12.5, color: "var(--ink)", resize: "vertical", boxSizing: "border-box" }}
          />
          <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
            {strings.aiImprovePublishedNote}
          </p>
        </div>
      )}
    </div>
  );
}

function ValidationPopover({ q, strings, readOnly, onChange }: { q: QuestionVM; strings: FormEditorStrings; readOnly: boolean; onChange: (patch: Partial<QuestionVM>) => void }) {
  const [open, setOpen] = React.useState(false);
  const v = (q.validation ?? {}) as { regex?: string; min?: number; max?: number; minSelected?: number };
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ border: "none", background: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <Icon name="gear" size={14} /> {strings.validation}
      </button>
      {open && (
        <>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <TextInput value={v.regex ?? ""} placeholder="regex" disabled={readOnly} aria-label="regex" onChange={(e) => onChange({ validation: { ...v, regex: e.target.value } })} style={{ height: 36 }} />
            <TextInput type="number" value={v.min ?? ""} placeholder="min" disabled={readOnly} aria-label="min" onChange={(e) => onChange({ validation: { ...v, min: e.target.value === "" ? undefined : Number(e.target.value) } })} style={{ height: 36 }} />
            <TextInput type="number" value={v.max ?? ""} placeholder="max" disabled={readOnly} aria-label="max" onChange={(e) => onChange({ validation: { ...v, max: e.target.value === "" ? undefined : Number(e.target.value) } })} style={{ height: 36 }} />
          </div>
          {q.field_type === "multiselect" && (
            <div style={{ marginTop: 8 }}>
              <FieldLabel>{strings.minSelected}</FieldLabel>
              <TextInput
                type="number"
                value={v.minSelected ?? ""}
                placeholder="1"
                disabled={readOnly}
                aria-label={strings.minSelected}
                onChange={(e) => onChange({ validation: { ...v, minSelected: e.target.value === "" ? undefined : Number(e.target.value) } })}
                style={{ height: 36, maxWidth: 140 }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const COND_ACTIONS: { id: "none" | ConditionAction; key: string }[] = [
  { id: "none", key: "condNone" },
  { id: "show", key: "condShow" },
  { id: "lock", key: "condLock" },
  { id: "require", key: "condRequire" },
];

const COND_OPS: { id: ConditionOp; key: string }[] = [
  { id: "equals", key: "condOpEquals" },
  { id: "not_equals", key: "condOpNotEquals" },
  { id: "includes", key: "condOpIncludes" },
  { id: "answered", key: "condOpAnswered" },
  { id: "gte", key: "condOpGte" },
  { id: "lte", key: "condOpLte" },
];

function condValueToText(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v == null) return "";
  return String(v);
}

/**
 * Conditional/dynamic visibility editor. Lets the admin make a question
 * show / lock / require itself depending on another question's answer — the
 * Sí/No → explanation pattern, or continuation fields (e.g. the 5th child).
 */
function ConditionEditor({
  q,
  siblings,
  strings,
  readOnly,
  onChange,
}: {
  q: QuestionVM;
  siblings: { id: string; label: string }[];
  strings: FormEditorStrings;
  readOnly: boolean;
  onChange: (patch: Partial<QuestionVM>) => void;
}) {
  const c = q.condition ?? null;
  const action: "none" | ConditionAction = c?.action ?? "none";
  const noSiblings = siblings.length === 0;

  const setAction = (a: "none" | ConditionAction) => {
    if (a === "none") return onChange({ condition: null });
    const when = c?.when ?? { question: siblings[0]?.id ?? "", op: "equals" as ConditionOp, value: "" };
    onChange({ condition: { when, action: a, lock_message_i18n: c?.lock_message_i18n ?? null } });
  };
  const patchWhen = (patch: Partial<NonNullable<QuestionVM["condition"]>["when"]>) => {
    if (!c) return;
    onChange({ condition: { ...c, when: { ...c.when, ...patch } } });
  };

  return (
    <div>
      <FieldLabel>{strings.condition}</FieldLabel>
      <SelectInput
        value={action}
        disabled={readOnly || noSiblings}
        onChange={(e) => setAction(e.target.value as "none" | ConditionAction)}
        aria-label={strings.condition}
      >
        {COND_ACTIONS.map((a) => (
          <option key={a.id} value={a.id}>{strings[a.key]}</option>
        ))}
      </SelectInput>

      {c && !noSiblings && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div>
              <FieldLabel>{strings.condWhenQuestion}</FieldLabel>
              <SelectInput value={c.when.question} disabled={readOnly} aria-label={strings.condWhenQuestion} onChange={(e) => patchWhen({ question: e.target.value })}>
                {siblings.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>{strings.condOp}</FieldLabel>
              <SelectInput value={c.when.op} disabled={readOnly} aria-label={strings.condOp} onChange={(e) => patchWhen({ op: e.target.value as ConditionOp })}>
                {COND_OPS.map((o) => (
                  <option key={o.id} value={o.id}>{strings[o.key]}</option>
                ))}
              </SelectInput>
            </div>
          </div>
          {c.when.op !== "answered" && (
            <div>
              <FieldLabel>{strings.condValue}</FieldLabel>
              <TextInput value={condValueToText(c.when.value)} disabled={readOnly} aria-label={strings.condValue} onChange={(e) => patchWhen({ value: e.target.value })} style={{ height: 36 }} />
            </div>
          )}
          {action === "lock" && (
            <I18nField
              label={strings.condLockMessage}
              value={{ es: c.lock_message_i18n?.es ?? "", en: c.lock_message_i18n?.en ?? "" }}
              onChange={(val) => onChange({ condition: { ...c, lock_message_i18n: val } })}
              multiline
              flagMissingEn={false}
            />
          )}
        </div>
      )}
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-3)", lineHeight: 1.4 }}>{strings.condHint}</p>
    </div>
  );
}
