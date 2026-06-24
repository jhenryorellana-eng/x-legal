"use client";

import * as React from "react";
import { Modal } from "@/frontend/components/desktop";
import { GradientBtn, GhostBtn, Icon, Chip } from "@/frontend/components/brand";
import { FieldLabel } from "../shared/chrome";

/**
 * ExtractionSchemaModal — defines WHICH fields Gemini extracts from a document
 * (required_document_types.extraction_schema), per PROMPT-ADM-04 §Paso 4.
 *
 * Two panels: a live-validated JSON editor (source of truth) on the left, and a
 * read-only derived field view (name · type · required · description) on the
 * right. "Proponer con IA" seeds the editor from the document label using the
 * existing proposeExtractionSchema (Sonnet). The admin then maps each field to a
 * form question in the Forms editor (origin = document_extraction), so the AI
 * never guesses where a value goes — the admin decides placement explicitly.
 *
 * Validation is delegated to the catalog domain rules via `validateAction`
 * (single source of truth — the same check runs again on save server-side).
 */

export interface SchemaField {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

type ActionRes<T> = { success: boolean; data?: T; error?: { code: string; message: string } };

export interface ExtractionSchemaModalProps {
  value: Record<string, unknown> | null;
  servicePhaseId: string;
  documentLabel: string;
  documentHelp?: string;
  t: Record<string, string>;
  proposeAction: (input: {
    service_phase_id: string;
    label: string;
    help?: string;
  }) => Promise<ActionRes<object>>;
  validateAction: (schema: unknown) => Promise<ActionRes<{ valid: boolean; reason?: string }>>;
  onClose: () => void;
  onSave: (schema: Record<string, unknown> | null) => void;
}

/** Reads the field list from a stored extraction_schema (full JSON Schema or a
 *  bare property map). Exported so the wizard can show a "· N" field count. */
export function parseSchemaFields(schema: unknown): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const obj = schema as Record<string, unknown>;
  const props = (
    obj.properties && typeof obj.properties === "object" ? obj.properties : obj
  ) as Record<string, unknown>;
  const required = Array.isArray(obj.required) ? (obj.required as string[]) : [];
  const fields: SchemaField[] = [];
  for (const [key, val] of Object.entries(props)) {
    if (key === "type" || key === "required" || key === "properties") continue;
    if (!val || typeof val !== "object") continue;
    const v = val as { type?: string; description?: string };
    fields.push({
      name: key,
      type: typeof v.type === "string" ? v.type : "string",
      description: typeof v.description === "string" ? v.description : "",
      required: required.includes(key),
    });
  }
  return fields;
}

export function schemaFieldCount(schema: Record<string, unknown> | null | undefined): number {
  return parseSchemaFields(schema).length;
}

export function ExtractionSchemaModal({
  value,
  servicePhaseId,
  documentLabel,
  documentHelp,
  t,
  proposeAction,
  validateAction,
  onClose,
  onSave,
}: ExtractionSchemaModalProps) {
  const [text, setText] = React.useState(() =>
    value ? JSON.stringify(value, null, 2) : "",
  );
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [validation, setValidation] = React.useState<{ valid: boolean; reason?: string } | null>(
    null,
  );
  const [proposing, setProposing] = React.useState(false);
  const [proposeError, setProposeError] = React.useState<string | null>(null);

  // Parsed schema (null when the text is empty or invalid JSON).
  const parsed = React.useMemo<Record<string, unknown> | null>(() => {
    if (!text.trim()) return null;
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null;
    }
  }, [text]);

  const fields = React.useMemo(() => parseSchemaFields(parsed), [parsed]);

  // Live validation: syntax (local) + Gemini-subset rules (server, debounced).
  React.useEffect(() => {
    if (!text.trim()) {
      setParseError(null);
      setValidation(null);
      return;
    }
    let schema: unknown;
    try {
      schema = JSON.parse(text);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : t.docSchemaInvalidJson);
      setValidation(null);
      return;
    }
    setParseError(null);
    let cancelled = false;
    const handle = setTimeout(async () => {
      const r = await validateAction(schema);
      if (cancelled) return;
      setValidation(r.success && r.data ? r.data : { valid: false, reason: r.error?.message });
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [text, validateAction, t.docSchemaInvalidJson]);

  async function propose() {
    setProposing(true);
    setProposeError(null);
    const r = await proposeAction({
      service_phase_id: servicePhaseId,
      label: documentLabel || "documento",
      help: documentHelp,
    });
    setProposing(false);
    if (r.success && r.data) {
      setText(JSON.stringify(r.data, null, 2));
    } else {
      setProposeError(r.error?.message ?? t.docSchemaProposeError);
    }
  }

  const isEmpty = !text.trim();
  // Save is allowed when empty (clears the schema) or when it parses + validates.
  const canSave = isEmpty || (parsed !== null && !parseError && validation?.valid !== false);

  function save() {
    if (isEmpty) {
      onSave(null);
      return;
    }
    if (parsed) onSave(parsed);
  }

  const errorMsg = parseError ?? (validation && !validation.valid ? validation.reason : null);

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t.docSchemaModalTitle}
      description={t.docSchemaModalNote}
      width={760}
      footer={
        <>
          <GhostBtn size="md" full={false} onClick={onClose}>
            {t.docSchemaCancel}
          </GhostBtn>
          <GradientBtn onClick={save} disabled={!canSave}>
            {t.docSchemaSave}
          </GradientBtn>
        </>
      }
    >
      <div style={{ marginBottom: 12 }}>
        <GhostBtn size="md" full={false} icon="sparkle" onClick={propose} disabled={proposing}>
          {proposing ? t.docSchemaProposing : t.docSchemaPropose}
        </GhostBtn>
        {proposeError && (
          <span style={{ marginLeft: 10, fontSize: 12.5, color: "var(--red)", fontWeight: 600 }}>
            {proposeError}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Left — JSON editor */}
        <div>
          <FieldLabel>{t.docSchemaEditorLabel}</FieldLabel>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder='{ "type": "object", "properties": { "first_name": { "type": "string" } }, "required": ["first_name"] }'
            style={{
              width: "100%",
              minHeight: 280,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 12.5,
              lineHeight: 1.5,
              padding: "12px 14px",
              borderRadius: 12,
              border: `1.5px solid ${errorMsg ? "var(--red)" : "var(--line)"}`,
              background: "var(--card)",
              color: "var(--ink)",
              resize: "vertical",
              outline: "none",
            }}
          />
          {errorMsg ? (
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--red)", fontWeight: 600 }}>
              {errorMsg}
            </p>
          ) : (
            !isEmpty &&
            validation?.valid && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--green)", fontWeight: 600 }}>
                {t.docSchemaValid}
              </p>
            )
          )}
        </div>

        {/* Right — derived field view */}
        <div>
          <FieldLabel>{t.docSchemaFieldsLabel}</FieldLabel>
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 12,
              minHeight: 280,
              maxHeight: 320,
              overflow: "auto",
              background: "var(--card)",
            }}
          >
            {fields.length === 0 ? (
              <p style={{ padding: 16, color: "var(--ink-3)", fontSize: 13, margin: 0 }}>
                {t.docSchemaEmpty}
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.name} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                        <code style={{ fontWeight: 700, color: "var(--ink)" }}>{f.name}</code>
                        {f.required && (
                          <Chip tone="gold" dot>
                            {t.docSchemaRequired}
                          </Chip>
                        )}
                        {f.description && (
                          <div style={{ color: "var(--ink-3)", marginTop: 2 }}>{f.description}</div>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          textAlign: "right",
                          verticalAlign: "top",
                          color: "var(--ink-2)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {f.type}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p style={{ margin: "8px 0 0", display: "flex", gap: 6, alignItems: "flex-start", fontSize: 11.5, color: "var(--ink-3)", fontWeight: 500 }}>
            <Icon name="info" size={14} color="var(--ink-3)" />
            {t.docSchemaMapHint}
          </p>
        </div>
      </div>
    </Modal>
  );
}
