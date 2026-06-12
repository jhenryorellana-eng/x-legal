"use client";

import * as React from "react";

/**
 * I18nField — the canonical side-by-side ES | EN editor (DOC-53 §0.6).
 *
 * Two columns with a flag-label, the same input, and a character counter. When
 * the EN value is empty the field gets a `--gold-deep` border + a "Falta EN"
 * chip — guidable as draft, blocking only at publish (DOC-14 convention).
 *
 * Controlled: `value` is `{ es, en }`; `onChange` returns the next pair.
 */

export type I18nValue = { es?: string; en?: string };

export interface I18nFieldProps {
  label: string;
  value: I18nValue;
  onChange: (next: I18nValue) => void;
  /** Render as <textarea> instead of <input>. */
  multiline?: boolean;
  placeholderEs?: string;
  placeholderEn?: string;
  /** Show the "Falta EN" chip when EN is empty (default true). */
  flagMissingEn?: boolean;
  missingEnLabel?: string;
}

export function I18nField({
  label,
  value,
  onChange,
  multiline = false,
  placeholderEs,
  placeholderEn,
  flagMissingEn = true,
  missingEnLabel = "Falta EN",
}: I18nFieldProps) {
  const enMissing = flagMissingEn && !(value.en ?? "").trim();

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 7,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13,
            color: "var(--ink)",
          }}
        >
          {label}
        </span>
        {enMissing && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: "var(--gold-deep)",
              background: "var(--gold-soft)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            {missingEnLabel}
          </span>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        <Col
          lang="ES"
          value={value.es ?? ""}
          onChange={(v) => onChange({ ...value, es: v })}
          multiline={multiline}
          placeholder={placeholderEs}
        />
        <Col
          lang="EN"
          value={value.en ?? ""}
          onChange={(v) => onChange({ ...value, en: v })}
          multiline={multiline}
          placeholder={placeholderEn}
          warn={enMissing}
        />
      </div>
    </div>
  );
}

function Col({
  lang,
  value,
  onChange,
  multiline,
  placeholder,
  warn = false,
}: {
  lang: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  warn?: boolean;
}) {
  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    borderRadius: 12,
    border: `1.5px solid ${warn ? "var(--gold-deep)" : "var(--line)"}`,
    background: "var(--panel-2, var(--card-alt))",
    padding: "10px 12px",
    fontFamily: "var(--font-body)",
    fontSize: 14,
    color: "var(--ink)",
    outline: "none",
    resize: multiline ? "vertical" : undefined,
    minHeight: multiline ? 76 : undefined,
  };

  return (
    <label style={{ display: "block" }}>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          fontSize: 10.5,
          fontWeight: 800,
          letterSpacing: "0.06em",
          color: "var(--ink-3)",
          marginBottom: 4,
        }}
      >
        {lang}
      </span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={fieldStyle}
          aria-label={`${lang}`}
        />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={fieldStyle}
          aria-label={`${lang}`}
        />
      )}
    </label>
  );
}
