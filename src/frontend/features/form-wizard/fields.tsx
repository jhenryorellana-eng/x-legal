"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { useDictation } from "./use-dictation";
import type {
  WizardQuestion,
  WizardLabels,
  Locale,
  FieldErrorCode,
} from "./types";
import { pickI18n } from "./resolve";

/**
 * Field renderers for the FormWizard — one per `field_type` (DOC-50 §6.1), with
 * the design-system tokens (DOC-01). Each field is controlled: it reports value
 * changes up to the wizard, which owns the answers map + autosave.
 *
 * Prefill ("Ya lo tenemos", DOC-50 §6.4): when `question.isPrefilled` and the
 * value still equals the backend prefill, a gold chip + sparkle + origin microcopy
 * appear. Editing flips it to client_answer (the chip fades to "Lo cambiaste tú").
 */

const ERR_MSG: Record<FieldErrorCode, keyof WizardLabels> = {
  required: "errRequired",
  regex: "errRegex",
  min: "errMin",
  max: "errMax",
  type: "errRegex",
};

export interface FieldProps {
  question: WizardQuestion;
  value: unknown;
  error: FieldErrorCode | null;
  /** True while the value still matches the backend prefill (not yet edited). */
  showPrefill: boolean;
  locale: Locale;
  labels: WizardLabels;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  /**
   * "Mejorar con IA": rewrites the current text server-side (per-question
   * instruction). Present only when the question has it enabled AND the surface
   * injected the action — absent = no button (admin preview, disabled fields).
   */
  onImprove?: (text: string) => Promise<{ ok: boolean; improvedText?: string; error?: { code: string } }>;
  /**
   * web_research "Buscar": runs an internet search for this field (buscador + IA).
   * Present only for a web_research question when the surface injected the action.
   */
  onResearch?: (query: string) => Promise<{
    ok: boolean;
    address?: string;
    sources?: Array<{ uri: string; title: string | null }>;
    error?: { code: string };
  }>;
}

function originLabel(source: string, labels: WizardLabels): string {
  if (source === "document_extraction") return labels.prefillFromDocument;
  if (source === "profile") return labels.prefillFromProfile;
  if (source === "generation_output") return labels.prefillFromGeneration;
  if (source === "ai_draft") return labels.prefillFromAiDraft;
  return labels.prefillFromProfile;
}

/** Shimmering chip while the background warm job computes an ai_field prefill
 *  (Ola perf): the wizard opened instantly and is polling for the value. */
function PrefillPendingChip({ labels }: { labels: WizardLabels }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span
        className="anim-soft-pop"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          height: 26,
          padding: "0 11px",
          background: "var(--blue-soft)",
          color: "var(--accent)",
          borderRadius: 999,
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: 999,
            border: "2px solid var(--accent)",
            borderTopColor: "transparent",
            animation: "spin 0.9s linear infinite",
          }}
        />
        {labels.prefillAiPending}
      </span>
    </div>
  );
}

/** The gold "Ya lo tenemos" chip + sparkle + origin microcopy (DOC-50 §6.4). */
function PrefillChip({
  question,
  edited,
  labels,
}: {
  question: WizardQuestion;
  edited: boolean;
  labels: WizardLabels;
}) {
  if (!question.isPrefilled) return null;
  const isAi =
    !edited && (question.source === "document_extraction" || question.source === "ai_draft");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
      {isAi && (
        <span
          className="anim-soft-pop"
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 26,
            padding: "0 9px",
            background: "var(--gold)",
            color: "var(--navy)",
            borderRadius: 999,
            fontFamily: "var(--font-title)",
            fontWeight: 900,
            fontSize: 11.5,
            letterSpacing: "0.04em",
          }}
          title={labels.prefillFromDocument}
        >
          {labels.prefillAiBadge}
        </span>
      )}
      <span
        className={edited ? undefined : "anim-soft-pop"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 26,
          padding: "0 11px",
          background: edited ? "var(--blue-soft)" : "var(--gold-soft)",
          color: edited ? "var(--accent)" : "var(--gold-deep)",
          borderRadius: 999,
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        {!edited && (
          <Icon name="sparkle" size={13} color="var(--gold-deep)" fill="var(--gold)" />
        )}
        {edited ? labels.prefillEdited : labels.prefillChip}
      </span>
      {!edited && (
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>
          {originLabel(question.source, labels)}
        </span>
      )}
    </div>
  );
}

function FieldError({ error, labels }: { error: FieldErrorCode | null; labels: WizardLabels }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="anim-fade-in-up"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginTop: 9,
        color: "var(--gold-deep)",
        fontSize: 13.5,
        fontWeight: 600,
        lineHeight: 1.35,
      }}
    >
      <Icon name="info" size={16} color="var(--gold-deep)" />
      {labels[ERR_MSG[error]]}
    </div>
  );
}

const cardBase: React.CSSProperties = {
  width: "100%",
  background: "var(--card)",
  border: "1.5px solid var(--line)",
  borderRadius: 18,
  fontFamily: "var(--font-title)",
  color: "var(--ink)",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
};

// --- "Mejorar con IA" (per-question AI rewrite) -------------------------------

type ImproveState = "idle" | "loading" | "undo" | "error";

/**
 * State machine for the improve button. Best-effort by design: a failure keeps
 * the client's text untouched; a response that arrives after the user kept
 * typing is discarded (stale). "undo" restores the pre-improve text and clears
 * itself as soon as the user edits again.
 */
function useImprove({
  value,
  onChange,
  onImprove,
}: {
  value: string;
  onChange: (v: string) => void;
  onImprove: NonNullable<FieldProps["onImprove"]>;
}): { state: ImproveState; improve: () => void; undo: () => void } {
  const [state, setState] = React.useState<ImproveState>("idle");
  const prevRef = React.useRef<string>("");
  const resultRef = React.useRef<string | null>(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Any manual edit dissolves the undo/error affordance.
  React.useEffect(() => {
    if (state === "undo" && value !== resultRef.current) setState("idle");
    if (state === "error" && value !== prevRef.current) setState("idle");
  }, [value, state]);

  const improve = React.useCallback(() => {
    const text = valueRef.current;
    if (!text.trim()) return;
    prevRef.current = text;
    setState("loading");
    onImprove(text)
      .then((r) => {
        // Stale: the user kept editing while the request was in flight.
        if (valueRef.current !== text) {
          setState("idle");
          return;
        }
        if (r.ok && typeof r.improvedText === "string" && r.improvedText.trim()) {
          resultRef.current = r.improvedText;
          onChange(r.improvedText);
          setState("undo");
        } else {
          setState("error");
        }
      })
      .catch(() => {
        setState(valueRef.current === text ? "error" : "idle");
      });
  }, [onChange, onImprove]);

  const undo = React.useCallback(() => {
    resultRef.current = null;
    onChange(prevRef.current);
    setState("idle");
  }, [onChange]);

  return { state, improve, undo };
}

/** The gold pill rendered INSIDE the text box (bottom/right corner). */
function ImprovePill({
  state,
  hasText,
  labels,
  onImprove,
  onUndo,
}: {
  state: ImproveState;
  hasText: boolean;
  labels: WizardLabels;
  onImprove: () => void;
  onUndo: () => void;
}) {
  const isUndo = state === "undo";
  const loading = state === "loading";
  const label = loading ? labels.improveLoading : isUndo ? labels.improveUndo : labels.improveIdle;
  const disabled = loading || (!isUndo && !hasText);
  return (
    <button
      type="button"
      onClick={isUndo ? onUndo : onImprove}
      disabled={disabled}
      aria-busy={loading || undefined}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 34,
        padding: "0 13px",
        borderRadius: 999,
        border: "none",
        cursor: disabled ? "default" : "pointer",
        background: isUndo ? "var(--card)" : "var(--gold)",
        color: isUndo ? "var(--ink-2)" : "var(--navy)",
        boxShadow: isUndo
          ? "inset 0 0 0 1.5px var(--line)"
          : "0 4px 14px color-mix(in srgb, var(--gold) 45%, transparent)",
        opacity: disabled && !loading ? 0.45 : 1,
        fontFamily: "var(--font-title)",
        fontSize: 12.5,
        fontWeight: 800,
        whiteSpace: "nowrap",
        transition: "background 0.2s ease, opacity 0.2s ease",
      }}
    >
      <Icon
        name={isUndo ? "arrowL" : "sparkle"}
        size={14}
        color={isUndo ? "var(--ink-2)" : "var(--navy)"}
      />
      {label}
    </button>
  );
}

/** Soft error note under the box when an improve attempt failed (never red). */
function ImproveErrorNote({ state, labels }: { state: ImproveState; labels: WizardLabels }) {
  if (state !== "error") return null;
  return (
    <div
      role="status"
      className="anim-fade-in-up"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginTop: 9,
        color: "var(--ink-2)",
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.35,
      }}
    >
      <Icon name="info" size={15} color="var(--ink-2)" />
      {labels.improveError}
    </div>
  );
}

function inputBorder(focused: boolean, hasError: boolean): React.CSSProperties {
  if (hasError) return { borderColor: "color-mix(in srgb, var(--gold-deep) 55%, transparent)" };
  if (focused)
    return {
      borderColor: "var(--accent)",
      boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 14%, transparent)",
    };
  return {};
}

// --- text -------------------------------------------------------------------

function TextField(props: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  const v = typeof props.value === "string" ? props.value : props.value == null ? "" : String(props.value);
  const noopImprove = React.useCallback(async () => ({ ok: false }), []);
  const improve = useImprove({
    value: v,
    onChange: props.onChange,
    onImprove: props.onImprove ?? noopImprove,
  });
  const withImprove = !!props.onImprove;
  const input = (
    <input
      type="text"
      value={v}
      onChange={(e) => props.onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        props.onBlur();
      }}
      placeholder={pickI18n(props.question.helpI18n, props.locale) || ""}
      style={{
        ...cardBase,
        height: 64,
        padding: withImprove ? "0 150px 0 18px" : "0 18px",
        fontSize: 17,
        fontWeight: 600,
        ...inputBorder(focused, !!props.error),
      }}
    />
  );
  if (!withImprove) return input;
  return (
    <div>
      <div style={{ position: "relative" }}>
        {input}
        <div style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
          <ImprovePill
            state={improve.state}
            hasText={!!v.trim()}
            labels={props.labels}
            onImprove={improve.improve}
            onUndo={improve.undo}
          />
        </div>
      </div>
      <ImproveErrorNote state={improve.state} labels={props.labels} />
    </div>
  );
}

// --- number -----------------------------------------------------------------

function NumberField(props: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  const v = props.value == null ? "" : String(props.value);
  return (
    <input
      type="text"
      inputMode="numeric"
      value={v}
      onChange={(e) => props.onChange(e.target.value.replace(/[^\d.,-]/g, ""))}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        // Normalise on blur under the US convention (the one parseMoneyNumber assumes):
        // '.' is the decimal, ',' is a thousands separator. Drop the thousands commas to
        // a canonical numeric form. NEVER rewrite a comma to a dot — "1,400.00" would
        // become the unparseable "1.400.00", which a computed money total reads as 0 and
        // silently drops the line item (a wrong-but-plausible fee-waiver total).
        const norm = v.replace(/,/g, "").trim();
        if (norm !== v) props.onChange(norm);
        props.onBlur();
      }}
      style={{
        ...cardBase,
        height: 64,
        padding: "0 18px",
        fontSize: 17,
        fontWeight: 600,
        letterSpacing: "0.01em",
        ...inputBorder(focused, !!props.error),
      }}
    />
  );
}

// --- date -------------------------------------------------------------------

function DateField(props: FieldProps) {
  const [focused, setFocused] = React.useState(false);
  // Persist the civil ISO date string (yyyy-mm-dd), no TZ conversion (DOC-50 §6.1).
  const v = typeof props.value === "string" ? props.value : "";
  return (
    <input
      type="date"
      value={v}
      lang={props.locale === "es" ? "es-US" : "en-US"}
      onChange={(e) => props.onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        props.onBlur();
      }}
      style={{
        ...cardBase,
        height: 64,
        padding: "0 18px",
        fontSize: 17,
        fontWeight: 600,
        colorScheme: "light dark",
        ...inputBorder(focused, !!props.error),
      }}
    />
  );
}

// --- checkbox ---------------------------------------------------------------

function CheckboxField(props: FieldProps) {
  const checked = props.value === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => {
        props.onChange(!checked);
        props.onBlur();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width: "100%",
        background: "var(--card)",
        border: `1.5px solid ${checked ? "color-mix(in srgb, var(--green) 45%, transparent)" : "var(--line)"}`,
        borderRadius: 18,
        padding: "16px 18px",
        cursor: "pointer",
        textAlign: "left",
        transition: "border-color 0.2s ease",
      }}
    >
      <span
        aria-hidden="true"
        className={checked ? "anim-check-pop" : undefined}
        style={{
          width: 28,
          height: 28,
          borderRadius: 9,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? "var(--green)" : "transparent",
          border: checked ? "none" : "2px solid var(--line)",
          transition: "background 0.18s ease",
        }}
      >
        {checked && <Icon name="check" size={18} color="#fff" stroke={3} />}
      </span>
      <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-title)" }}>
        {pickI18n(props.question.questionI18n, props.locale)}
      </span>
    </button>
  );
}

// --- select -----------------------------------------------------------------

function SelectField(props: FieldProps) {
  const opts = props.question.options ?? [];
  const selected = typeof props.value === "string" ? props.value : "";
  // ≤ 5 options → radio cards (Pagos pattern); more → native select sheet.
  if (opts.length > 0 && opts.length <= 5) {
    return (
      <div role="radiogroup" style={{ display: "grid", gap: 10 }}>
        {opts.map((o) => {
          const active = selected === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                props.onChange(o.value);
                props.onBlur();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                background: active ? "var(--blue-soft)" : "var(--card)",
                border: `2px solid ${active ? "var(--accent)" : "var(--line)"}`,
                borderRadius: 16,
                padding: "15px 16px",
                cursor: "pointer",
                textAlign: "left",
                transition: "border-color 0.18s ease, background 0.18s ease",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  flexShrink: 0,
                  border: `2px solid ${active ? "var(--accent)" : "var(--line)"}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {active && (
                  <span style={{ width: 11, height: 11, borderRadius: 999, background: "var(--accent)" }} />
                )}
              </span>
              <span style={{ fontSize: 15.5, fontWeight: 700, color: "var(--ink)", fontFamily: "var(--font-title)" }}>
                {pickI18n(o.labelI18n, props.locale)}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <select
      value={selected}
      onChange={(e) => {
        props.onChange(e.target.value);
        props.onBlur();
      }}
      style={{
        ...cardBase,
        height: 64,
        padding: "0 18px",
        fontSize: 17,
        fontWeight: 600,
        appearance: "none",
        backgroundImage: "none",
      }}
    >
      <option value="" disabled>
        {props.labels.selectPlaceholder}
      </option>
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {pickI18n(o.labelI18n, props.locale)}
        </option>
      ))}
    </select>
  );
}

// --- textarea (with dictation) ----------------------------------------------

function TextareaField(props: FieldProps & { showDictation?: boolean }) {
  const [focused, setFocused] = React.useState(false);
  const v = typeof props.value === "string" ? props.value : "";

  const dictation = useDictation({
    locale: props.locale,
    onAppend: (chunk) => {
      const sep = v && !v.endsWith(" ") && !v.endsWith("\n") ? " " : "";
      props.onChange(v + sep + chunk);
    },
  });

  const noopImprove = React.useCallback(async () => ({ ok: false }), []);
  const improve = useImprove({
    value: v,
    onChange: props.onChange,
    onImprove: props.onImprove ?? noopImprove,
  });
  const withImprove = !!props.onImprove;

  const recording = dictation.isListening;
  const showDictation = props.showDictation !== false;

  return (
    <div>
      <div style={{ position: "relative" }}>
        <textarea
          value={v}
          onChange={(e) => props.onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            props.onBlur();
          }}
          placeholder={props.labels.textareaPlaceholder}
          style={{
            ...cardBase,
            minHeight: withImprove ? 152 : 132,
            width: "100%",
            padding: withImprove ? "16px 18px 58px" : "16px 18px",
            fontSize: 16.5,
            fontWeight: 500,
            lineHeight: 1.55,
            resize: "vertical",
            fontFamily: "var(--font-title)",
            ...(recording
              ? {
                  borderColor: "var(--accent)",
                  boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent)",
                }
              : inputBorder(focused, !!props.error)),
          }}
        />
        {withImprove && (
          <div style={{ position: "absolute", right: 10, bottom: 14 }}>
            <ImprovePill
              state={improve.state}
              hasText={!!v.trim()}
              labels={props.labels}
              onImprove={improve.improve}
              onUndo={improve.undo}
            />
          </div>
        )}
      </div>
      {withImprove && <ImproveErrorNote state={improve.state} labels={props.labels} />}

      {showDictation && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 18, gap: 9 }}>
          <button
            type="button"
            onClick={dictation.isSupported ? dictation.toggle : undefined}
            aria-label={recording ? props.labels.dictateActive : props.labels.dictateIdle}
            aria-pressed={recording}
            disabled={!dictation.isSupported}
            style={{
              position: "relative",
              width: 84,
              height: 84,
              borderRadius: 999,
              border: "none",
              cursor: dictation.isSupported ? "pointer" : "default",
              background: recording ? "var(--red)" : "var(--accent)",
              opacity: dictation.isSupported ? 1 : 0.45,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: recording
                ? "0 10px 28px color-mix(in srgb, var(--red) 45%, transparent)"
                : "0 10px 26px color-mix(in srgb, var(--accent) 40%, transparent)",
              transition: "background 0.25s ease",
            }}
          >
            {recording && (
              <span
                aria-hidden="true"
                className="anim-ring-pulse"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: 999,
                  border: "3px solid color-mix(in srgb, var(--red) 60%, transparent)",
                }}
              />
            )}
            {recording ? (
              <span aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 3, height: 30 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 4,
                      height: 30,
                      borderRadius: 999,
                      background: "#fff",
                      transformOrigin: "center",
                      animation: `wave 0.5s ${i * 0.1}s ease-in-out infinite alternate`,
                    }}
                  />
                ))}
              </span>
            ) : (
              <Icon name="mic" size={32} color="#fff" stroke={2.2} />
            )}
          </button>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink-2)", fontFamily: "var(--font-title)" }}>
            {!dictation.isSupported
              ? props.labels.dictateUnsupported
              : recording
                ? props.labels.dictateActive
                : props.labels.dictateIdle}
          </span>
        </div>
      )}
    </div>
  );
}

// --- locked note ------------------------------------------------------------

/** Shown under a field locked by a condition (action='lock', condition unmet). */
function LockNote({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginTop: 9,
        color: "var(--ink-3)",
        fontSize: 13.5,
        fontWeight: 600,
        lineHeight: 1.35,
      }}
    >
      <Icon name="info" size={16} color="var(--ink-3)" />
      {message}
    </div>
  );
}

// --- web_research (buscador + IA) -------------------------------------------

type ResearchState = "idle" | "loading" | "error";

/**
 * web_research widget: a search box on top (staff types a query → "Buscar") and a
 * READ-ONLY result box below that only the AI search fills — with a "corregir a mano"
 * escape hatch for the legal-safety case where the search is wrong. The result box is
 * the field's answer (flows through onChange like any other field).
 */
function WebResearchField(
  props: FieldProps & { disabled?: boolean },
) {
  const { question, value, onChange, onBlur, onResearch, locale, labels, disabled } = props;
  const current = typeof value === "string" ? value : value == null ? "" : String(value);
  const [query, setQuery] = React.useState("");
  const [state, setState] = React.useState<ResearchState>("idle");
  const [sources, setSources] = React.useState<Array<{ uri: string; title: string | null }>>([]);
  const [manual, setManual] = React.useState(false);
  // Snapshot of the last AI-produced address, so "Volver al resultado de la IA" restores
  // the SEARCH result and never re-presents hand-typed text as the AI-verified value.
  const [lastAiAddress, setLastAiAddress] = React.useState<string | null>(null);

  const searchLabel = pickI18n(question.webResearch?.searchLabelI18n ?? null, locale) || labels.researchSearchLabel || "Buscar dirección";
  const resultLabel = pickI18n(question.webResearch?.resultLabelI18n ?? null, locale) || labels.researchResultLabel || "Resultado de la búsqueda";
  const busy = state === "loading";

  const run = React.useCallback(() => {
    const q = query.trim();
    if (!q || !onResearch || disabled) return;
    setState("loading");
    onResearch(q)
      .then((r) => {
        if (r.ok && typeof r.address === "string" && r.address.trim()) {
          setLastAiAddress(r.address);
          setManual(false); // a fresh search re-locks the box to the AI result
          onChange(r.address);
          setSources(r.sources ?? []);
          setState("idle");
          onBlur();
        } else {
          setState("error");
        }
      })
      .catch(() => setState("error"));
  }, [query, onResearch, disabled, onChange, onBlur]);

  // The escape-hatch toggle. Going back to the AI result RESTORES the snapshot (never
  // keeps the manual text as if it were the search result); if no search has run yet,
  // it simply re-locks whatever is there.
  const toggleManual = React.useCallback(() => {
    if (manual) {
      if (lastAiAddress != null && lastAiAddress !== current) {
        onChange(lastAiAddress);
        onBlur();
      }
      setManual(false);
    } else {
      setManual(true);
    }
  }, [manual, lastAiAddress, current, onChange, onBlur]);

  const boxStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 84,
    borderRadius: 12,
    border: "1.5px solid var(--line)",
    padding: "12px 14px",
    fontSize: 15,
    lineHeight: 1.4,
    color: "var(--ink)",
    boxSizing: "border-box",
    resize: "vertical",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Search box */}
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>
          {searchLabel}
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            value={query}
            disabled={disabled || busy}
            placeholder={labels.researchPlaceholder || "Pega aquí la dirección del tribunal…"}
            aria-label={searchLabel}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                run();
              }
            }}
            style={{ flex: "1 1 240px", height: 46, borderRadius: 12, border: "1.5px solid var(--line)", padding: "0 14px", fontSize: 15, color: "var(--ink)", boxSizing: "border-box" }}
          />
          <button
            type="button"
            onClick={run}
            disabled={disabled || busy || !query.trim()}
            aria-busy={busy || undefined}
            style={{
              display: "inline-flex", alignItems: "center", gap: 7, height: 46, padding: "0 18px", borderRadius: 12,
              border: "none", cursor: disabled || busy || !query.trim() ? "default" : "pointer",
              background: "var(--accent)", color: "#fff", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 14,
              opacity: disabled || busy || !query.trim() ? 0.5 : 1, whiteSpace: "nowrap",
            }}
          >
            <Icon name="search" size={16} color="#fff" />
            {busy ? labels.researchLoading || "Buscando…" : labels.researchButton || "Buscar"}
          </button>
        </div>
        {state === "error" && (
          <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "var(--gold-deep)", fontWeight: 600 }}>
            {labels.researchError || "No se pudo completar la búsqueda. Inténtalo de nuevo."}
          </p>
        )}
      </div>

      {/* Read-only result box (only the AI search fills it — unless corrected by hand) */}
      <div>
        <label style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>
          {resultLabel}
        </label>
        <textarea
          value={current}
          readOnly={!manual}
          disabled={disabled}
          aria-label={resultLabel}
          placeholder={labels.researchEmptyResult || "El resultado de la búsqueda aparecerá aquí."}
          onChange={manual ? (e) => onChange(e.target.value) : undefined}
          onBlur={manual ? onBlur : undefined}
          style={{ ...boxStyle, background: manual ? "var(--card)" : "var(--chip)", cursor: manual ? "text" : "default" }}
        />
        {sources.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>{labels.researchSources || "Fuentes"}:</span>
            {sources.map((s, i) => (
              <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 600, textDecoration: "underline", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.title || s.uri}
              </a>
            ))}
          </div>
        )}
        {!disabled && (
          <button
            type="button"
            onClick={toggleManual}
            style={{ marginTop: 8, border: "none", background: "none", color: "var(--ink-3)", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <Icon name={manual ? "check" : "edit"} size={13} color="var(--ink-3)" />
            {manual ? labels.researchLockResult || "Volver al resultado de la IA" : labels.researchManualEdit || "Corregir a mano"}
          </button>
        )}
      </div>
    </div>
  );
}

// --- dispatcher -------------------------------------------------------------

/** Renders a single question: prefill chip + the right control + inline error.
 *  When `disabled` (a condition with action='lock' that is not met), the control
 *  is wrapped in a native `<fieldset disabled>` so every descendant control is
 *  inert, and the optional `lockMessage` explains why. */
export function WizardField(
  props: FieldProps & { showDictation?: boolean; disabled?: boolean; lockMessage?: string | null; hidePrefillChip?: boolean; aiPending?: boolean },
) {
  const { question } = props;
  const edited = question.isPrefilled && !props.showPrefill;

  // web_research renders its own buscador + read-only result widget (no prefill chip,
  // no plain control). The result box IS the answer.
  if (question.source === "web_research") {
    return (
      <div>
        <fieldset
          disabled={props.disabled}
          aria-disabled={props.disabled || undefined}
          style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0, opacity: props.disabled ? 0.55 : 1 }}
        >
          <WebResearchField {...props} />
        </fieldset>
        {props.disabled && props.lockMessage ? <LockNote message={props.lockMessage} /> : null}
        <FieldError error={props.error} labels={props.labels} />
      </div>
    );
  }

  let control: React.ReactNode;
  switch (question.fieldType) {
    case "textarea":
      control = <TextareaField {...props} />;
      break;
    case "number":
      control = <NumberField {...props} />;
      break;
    case "date":
      control = <DateField {...props} />;
      break;
    case "checkbox":
      control = <CheckboxField {...props} />;
      break;
    case "select":
      control = <SelectField {...props} />;
      break;
    case "text":
    default:
      control = <TextField {...props} />;
  }

  return (
    <div>
      {!props.hidePrefillChip && (props.aiPending
        ? <PrefillPendingChip labels={props.labels} />
        : <PrefillChip question={question} edited={edited} labels={props.labels} />)}
      <fieldset
        disabled={props.disabled}
        aria-disabled={props.disabled || undefined}
        style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0, opacity: props.disabled ? 0.55 : 1 }}
      >
        {control}
      </fieldset>
      {props.disabled && props.lockMessage ? <LockNote message={props.lockMessage} /> : null}
      <FieldError error={props.error} labels={props.labels} />
    </div>
  );
}
