"use client";

import * as React from "react";
import { FieldLabel, TextInput } from "../shared/chrome";
import { Switch } from "@/frontend/components/desktop";
import type { MailingCoverAnswerRefVM, MailingCoverVM } from "./types";

/**
 * MailingCoverEditor — admin editor for the deterministic "Carátula de Envío"
 * (config-as-data via ai_generation_configs.mailing_cover). Turning it ON marks
 * the whole ai_letter as a no-LLM mailing cover: the fixed addresses, recipient
 * blocks, spacing and the two variable-value mappings all live here, so an admin
 * can change an address without a developer.
 */

const DEFAULT_MAILING_COVER: MailingCoverVM = {
  return_address: ["10951 N. Town Center Drive", "Highland, UT 84003"],
  sender_name: { form_slug: "", question: "" },
  envelopes: [
    { recipient_lines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"], address_from: null },
    {
      recipient_lines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"],
      address_from: { form_slug: "", question: "" },
    },
  ],
  spacing: { block_gap_pt: 120, line_height: 1.5, font_size_pt: 13, margin_pt: 96 },
};

const rowStyle: React.CSSProperties = { display: "flex", gap: 6, alignItems: "center", marginBottom: 6 };
const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border, #d4d4d8)",
  background: "transparent",
  borderRadius: 6,
  padding: "2px 8px",
  cursor: "pointer",
  fontSize: 13,
};
const hint: React.CSSProperties = { fontSize: 12, opacity: 0.7, margin: "2px 0 10px" };

/** Editor for a string[] rendered one line per input, with add/remove. */
function LinesEditor({
  lines,
  onChange,
  placeholder,
  ariaPrefix,
}: {
  lines: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  ariaPrefix: string;
}) {
  return (
    <div>
      {lines.map((l, i) => (
        <div key={i} style={rowStyle}>
          <TextInput
            value={l}
            placeholder={placeholder}
            aria-label={`${ariaPrefix} ${i + 1}`}
            onChange={(e) => onChange(lines.map((x, k) => (k === i ? e.target.value : x)))}
          />
          <button type="button" style={smallBtn} aria-label={`Quitar ${ariaPrefix} ${i + 1}`} onClick={() => onChange(lines.filter((_, k) => k !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" style={smallBtn} onClick={() => onChange([...lines, ""])}>
        + Añadir línea
      </button>
    </div>
  );
}

/** Editor for an answer reference (companion-questionnaire slug + question wording). */
function RefEditor({
  value,
  onChange,
  label,
  optional,
}: {
  value: MailingCoverAnswerRefVM | null;
  onChange: (next: MailingCoverAnswerRefVM | null) => void;
  label: string;
  optional?: boolean;
}) {
  const on = value !== null;
  const v = value ?? { form_slug: "", question: "" };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FieldLabel>{label}</FieldLabel>
        {optional && (
          <Switch
            checked={on}
            aria-label={`${label} — activar`}
            onCheckedChange={(c) => onChange(c ? { form_slug: "", question: "" } : null)}
          />
        )}
      </div>
      {(on || !optional) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 6 }}>
          <TextInput
            value={v.form_slug}
            placeholder="cuestionario (slug)"
            aria-label={`${label} — cuestionario`}
            onChange={(e) => onChange({ ...v, form_slug: e.target.value })}
          />
          <TextInput
            value={v.question}
            placeholder="pregunta (texto exacto)"
            aria-label={`${label} — pregunta`}
            onChange={(e) => onChange({ ...v, question: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

export function MailingCoverEditor({
  value,
  onChange,
}: {
  value: MailingCoverVM | null;
  onChange: (next: MailingCoverVM | null) => void;
}) {
  const enabled = value !== null;
  const v = value ?? DEFAULT_MAILING_COVER;
  const patch = (p: Partial<MailingCoverVM>) => onChange({ ...v, ...p });
  const sp = v.spacing ?? {};
  const patchSpacing = (p: Partial<NonNullable<MailingCoverVM["spacing"]>>) => patch({ spacing: { ...sp, ...p } });

  const patchEnvelope = (i: number, p: Partial<MailingCoverVM["envelopes"][number]>) =>
    patch({ envelopes: v.envelopes.map((e, k) => (k === i ? { ...e, ...p } : e)) });

  return (
    <section style={{ border: "1px solid var(--border, #e4e4e7)", borderRadius: 10, padding: 14, marginTop: 16 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <Switch checked={enabled} aria-label="Carátula de Envío" onCheckedChange={(c) => onChange(c ? DEFAULT_MAILING_COVER : null)} />
        <strong>Carátula de Envío (documento postal, sin IA)</strong>
      </label>
      <p style={hint}>
        Cuando está activa, este documento se genera de forma <b>determinista (sin IA)</b> — los campos de prompt,
        secciones y modelo se ignoran — y se coloca como <b>hoja 1 del expediente, antes del índice</b>.
      </p>

      {enabled && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <FieldLabel>Dirección de retorno (remitente — fija)</FieldLabel>
            <LinesEditor
              lines={v.return_address}
              onChange={(return_address) => patch({ return_address })}
              placeholder="p. ej. 10951 N. Town Center Drive"
              ariaPrefix="Línea de retorno"
            />
          </div>

          <RefEditor
            label="Nombre del remitente (viene del cuestionario)"
            value={v.sender_name}
            onChange={(sender_name) => patch({ sender_name })}
          />

          <div>
            <FieldLabel>Sobres (destinatarios)</FieldLabel>
            {v.envelopes.map((env, i) => (
              <div key={i} style={{ border: "1px dashed var(--border, #d4d4d8)", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Sobre {i + 1}</span>
                  <button
                    type="button"
                    style={smallBtn}
                    aria-label={`Quitar sobre ${i + 1}`}
                    onClick={() => patch({ envelopes: v.envelopes.filter((_, k) => k !== i) })}
                  >
                    Quitar sobre
                  </button>
                </div>
                <FieldLabel>Destinatario (líneas fijas)</FieldLabel>
                <LinesEditor
                  lines={env.recipient_lines}
                  onChange={(recipient_lines) => patchEnvelope(i, { recipient_lines })}
                  placeholder="p. ej. Board of Immigration Appeals"
                  ariaPrefix={`Destinatario sobre ${i + 1} línea`}
                />
                <RefEditor
                  label="Dirección variable (opcional — del buscador IA)"
                  value={env.address_from}
                  onChange={(address_from) => patchEnvelope(i, { address_from })}
                  optional
                />
              </div>
            ))}
            <button
              type="button"
              style={smallBtn}
              onClick={() => patch({ envelopes: [...v.envelopes, { recipient_lines: [""], address_from: null }] })}
            >
              + Añadir sobre
            </button>
          </div>

          <div>
            <FieldLabel>Espaciado (puntos)</FieldLabel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
              <TextInput
                type="number"
                value={String(sp.block_gap_pt ?? 120)}
                aria-label="Espacio entre sobres (pt)"
                onChange={(e) => patchSpacing({ block_gap_pt: Number(e.target.value) || 0 })}
              />
              <TextInput
                type="number"
                value={String(sp.margin_pt ?? 96)}
                aria-label="Margen (pt)"
                onChange={(e) => patchSpacing({ margin_pt: Number(e.target.value) || 0 })}
              />
              <TextInput
                type="number"
                value={String(sp.font_size_pt ?? 13)}
                aria-label="Tamaño de fuente (pt)"
                onChange={(e) => patchSpacing({ font_size_pt: Number(e.target.value) || 0 })}
              />
              <TextInput
                type="number"
                step="0.1"
                value={String(sp.line_height ?? 1.5)}
                aria-label="Interlineado"
                onChange={(e) => patchSpacing({ line_height: Number(e.target.value) || 1 })}
              />
            </div>
            <p style={hint}>Entre sobres · Margen · Fuente · Interlineado</p>
          </div>
        </div>
      )}
    </section>
  );
}
