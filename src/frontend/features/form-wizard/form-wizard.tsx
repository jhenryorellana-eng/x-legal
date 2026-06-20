"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand/icon";
import { ProgressBar } from "@/frontend/components/brand/progress-bar";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { Lex } from "@/frontend/components/brand/lex";
import { Confetti, playChime } from "@/frontend/components/mobile/confetti";
import { WizardField } from "./fields";
import { useAutosave } from "./use-autosave";
import { validateGroup, firstInvalidGroupIndex } from "./build-question-schema";
import { pickI18n, buildInitialAnswers, isReadOnly } from "./resolve";
import { translateClientAnswers } from "./answer-translation";
import { deriveFieldState } from "@/shared/form-logic/conditions";
import { resolveI18n } from "@/shared/i18n";
import type {
  WizardForm,
  WizardLabels,
  Locale,
  SaveDraftFn,
  SubmitFormFn,
  TranslateAnswersFn,
  FieldErrorCode,
  SaveState,
} from "./types";

/**
 * FormWizard — the shared data-driven motor (DOC-50 §6, Propuesta SOT-3).
 *
 * Renders the published form version group-by-group. Each group = one step
 * ("Paso n de N" + gold ProgressBar). Drives: Zod-generated live validation
 * (UX courtesy), autosave (debounce + IndexedDB queue), prefill chips, step
 * navigation with a soft block, and final submit → Confetti → success.
 *
 * Surface-agnostic: cliente passes the step layout; the staff preview can pass
 * `dense` to flatten all groups. The server validation is always the source of
 * truth — this engine never assumes a local pass equals acceptance.
 */

export interface FormWizardProps {
  caseId: string;
  partyId: string | null;
  /** The resolved form (DTO from getFormForClient, passed as a prop). */
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  /** Show Lex "atento" + listening chip at the top (Mi Historia). */
  withLex?: boolean;
  lexChip?: string;
  /** Per-party name shown under the title (e.g. "Datos del menor — Mateo"). */
  partyName?: string | null;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  /** Server-side translator fallback (Gemini) for the answer-translation flow. */
  translateAnswers?: TranslateAnswersFn;
  /** Called after a successful submit (cliente navigates to /exito). */
  onSubmitted?: () => void;
  /** Back affordance from step 0 (cliente → Camino / list). */
  onExit?: () => void;
}

const SAVE_LABEL: Record<SaveState, keyof WizardLabels | null> = {
  idle: null,
  saving: "saving",
  saved: "saved",
  queued: "queued",
  error: "saveError",
};

export function FormWizard({
  caseId,
  partyId,
  form,
  locale,
  labels,
  withLex = false,
  lexChip,
  partyName,
  saveDraft,
  submitForm,
  translateAnswers,
  onSubmitted,
  onExit,
}: FormWizardProps) {
  const groups = form.groups;
  const readOnly = isReadOnly(form.status);

  // Initial answers (saved wins, prefill seeds, else empty) + prefilled set.
  const initial = React.useMemo(() => buildInitialAnswers(groups), [groups]);
  const [answers, setAnswers] = React.useState<Record<string, unknown>>(initial.answers);
  const [prefilledIds, setPrefilledIds] = React.useState<Set<string>>(initial.prefilledIds);

  // Resume at the first incomplete group (DOC-50 §6.3 — "primer paso incompleto").
  const [step, setStep] = React.useState<number>(() => {
    if (readOnly) return 0;
    const idx = firstInvalidGroupIndex(groups, initial.answers);
    return idx === -1 ? 0 : idx;
  });

  const [errors, setErrors] = React.useState<Record<string, FieldErrorCode>>({});
  const [showErrors, setShowErrors] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  const autosave = useAutosave({
    caseId,
    formDefinitionId: form.formDefinitionId,
    partyId,
    saveDraft,
    enabled: !readOnly && !done,
  });

  const total = groups.length;
  const current = groups[step];
  const isLastStep = step === total - 1;
  const pct = total > 0 ? ((step + 1) / total) * 100 : 0;

  // Reset scroll to top on step change (prototype parity).
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  const setAnswer = (questionId: string, value: unknown) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    // Editing a prefilled field flips it to client_answer (chip → "Lo cambiaste tú").
    if (prefilledIds.has(questionId)) {
      setPrefilledIds((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
    }
    // Clear the inline error for this field as the user fixes it.
    if (errors[questionId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
    autosave.scheduleSave({ [questionId]: value });
  };

  const validateCurrent = (): boolean => {
    if (!current) return true;
    const res = validateGroup(current.questions, answers);
    setErrors(res.errors);
    setShowErrors(true);
    return res.ok;
  };

  const goNext = () => {
    autosave.flush();
    if (!validateCurrent()) return; // soft block — server is the real gate
    setShowErrors(false);
    setErrors({});
    if (!isLastStep) {
      setStep((s) => Math.min(s + 1, total - 1));
    } else {
      void doSubmit();
    }
  };

  const goBack = () => {
    autosave.flush();
    setShowErrors(false);
    setErrors({});
    if (step === 0) {
      onExit?.();
    } else {
      setStep((s) => Math.max(0, s - 1));
    }
  };

  const doSubmit = async () => {
    // Validate ALL groups; jump to the first offending one (DOC-50 §6.5).
    const badIdx = firstInvalidGroupIndex(groups, answers);
    if (badIdx !== -1) {
      setStep(badIdx);
      const res = validateGroup(groups[badIdx].questions, answers);
      setErrors(res.errors);
      setShowErrors(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(false);
    autosave.flush();
    try {
      // Best-effort: translate textual answers to the PDF's source language when
      // the client filled the form in a different language (Chrome Translator API,
      // Gemini fallback). Never blocks submit — the server fills any gap at PDF time.
      let answersTranslated: Record<string, string> | undefined;
      let translationStatus: "none" | "partial" | "pending_server" | "done" | undefined;
      if (form.kind === "pdf_automation" && form.sourceLanguage !== locale) {
        // Default to pending_server: even if the on-device translation throws
        // entirely, the server then translates on-demand at PDF time — the filled
        // PDF is always in the form's language, never silently wrong.
        translationStatus = "pending_server";
        try {
          const tr = await translateClientAnswers({
            groups,
            answers,
            from: locale,
            to: form.sourceLanguage,
            serverFallback: translateAnswers,
          });
          answersTranslated = Object.keys(tr.translated).length > 0 ? tr.translated : undefined;
          translationStatus = tr.status; // 'none' (no textual answers) | partial | pending_server | done
        } catch {
          /* keep pending_server → the server fills the gap on-demand */
        }
      }
      const res = await submitForm({
        caseId,
        formDefinitionId: form.formDefinitionId,
        partyId,
        answersTranslated,
        translationStatus,
      });
      if (res.ok) {
        setDone(true);
        playChime();
        // Give the confetti a beat before navigating away.
        setTimeout(() => onSubmitted?.(), 2400);
      } else {
        setSubmitError(true);
      }
    } catch {
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  };

  // --- read-only (submitted / approved) -------------------------------------
  if (readOnly) {
    return (
      <div style={{ minHeight: "100dvh", padding: "26px 20px var(--screen-pb)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <button
            type="button"
            onClick={onExit}
            aria-label={labels.back}
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              borderRadius: 999,
              border: "1px solid var(--line)",
              background: "var(--card)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(11,27,51,0.06)",
            }}
          >
            <Icon name="arrowL" size={20} color="var(--ink)" />
          </button>
          <h1 style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 21, color: "var(--navy)", margin: 0, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {pickI18n(form.labelI18n, locale)}
          </h1>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 28,
              padding: "0 12px",
              background: "var(--green-soft)",
              color: "var(--green)",
              borderRadius: 999,
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              fontSize: 12.5,
              whiteSpace: "nowrap",
            }}
          >
            <Icon name="check" size={13} color="var(--green)" stroke={3} />
            {labels.submittedPill}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14, marginTop: 28 }}>
          <Lex size={92} mood="calma" />
          <h2 style={{ fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 20, color: "var(--navy)", margin: 0 }}>
            {labels.submittedTitle}
          </h2>
          <p style={{ fontSize: 15.5, color: "var(--ink-2)", maxWidth: 300, lineHeight: 1.5, margin: 0 }}>
            {labels.submittedBody}
          </p>
        </div>
      </div>
    );
  }

  // --- success / celebration -------------------------------------------------
  if (done) {
    return (
      <div
        style={{
          position: "relative",
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 28px",
          gap: 18,
        }}
      >
        <Confetti run />
        <Lex size={130} mood="celebra" />
        <h1
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 27,
            color: "var(--navy)",
            margin: 0,
          }}
        >
          {labels.submittedTitle}
        </h1>
        <p style={{ fontSize: 16, color: "var(--ink-2)", maxWidth: 300, lineHeight: 1.5, margin: 0 }}>
          {labels.submittedBody}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      data-scroll
      style={{
        minHeight: "100dvh",
        overflowY: "auto",
        padding: "26px 20px calc(132px + var(--safe-bottom))",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Zona 1 — compact header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <button
          type="button"
          onClick={goBack}
          aria-label={labels.back}
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--card)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 4px 12px rgba(11,27,51,0.06)",
          }}
        >
          <Icon name="arrowL" size={20} color="var(--ink)" />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <h1
              style={{
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 20,
                color: "var(--navy)",
                margin: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {pickI18n(form.labelI18n, locale)}
            </h1>
            <span
              style={{
                fontFamily: "var(--font-title)",
                fontWeight: 800,
                fontSize: 13,
                color: "var(--gold-deep)",
                whiteSpace: "nowrap",
              }}
            >
              {labels.stepCounter
                .replace("{n}", String(step + 1))
                .replace("{total}", String(total))}
            </span>
          </div>
          {partyName && (
            <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>{partyName}</div>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <ProgressBar pct={pct} height={8} aria-label={labels.stepCounter.replace("{n}", String(step + 1)).replace("{total}", String(total))} />
      </div>

      {/* Autosave indicator */}
      <div style={{ minHeight: 20, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {SAVE_LABEL[autosave.saveState] && (
          <span
            className="anim-fade-in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 700,
              color: autosave.saveState === "saved" ? "var(--green)" : "var(--ink-3)",
            }}
          >
            {autosave.saveState === "saved" && <Icon name="check" size={13} color="var(--green)" stroke={3} />}
            {autosave.saveState === "queued" && <Icon name="clock" size={13} color="var(--ink-3)" />}
            {labels[SAVE_LABEL[autosave.saveState]!]}
          </span>
        )}
      </div>

      {/* Zona 2 — Lex listening (Mi Historia) */}
      {withLex && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
          <Lex size={56} mood="atento" />
          {lexChip && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 32,
                padding: "0 14px",
                background: "var(--blue-soft)",
                color: "var(--accent)",
                borderRadius: 999,
                fontFamily: "var(--font-title)",
                fontWeight: 700,
                fontSize: 13.5,
              }}
            >
              {lexChip}
            </span>
          )}
        </div>
      )}

      {/* Group title (if present) as the step subtitle */}
      {current && pickI18n(current.titleI18n, locale) && (
        <div
          style={{
            fontFamily: "var(--font-title)",
            fontWeight: 800,
            fontSize: 13,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--ink-3)",
            marginBottom: 14,
          }}
        >
          {pickI18n(current.titleI18n, locale)}
        </div>
      )}

      {/* Zona 3 — questions of this group */}
      <div style={{ display: "flex", flexDirection: "column", gap: 26, flex: 1 }}>
        {current?.questions.map((q) => {
          // Conditional/dynamic visibility — hide (show), disable (lock), or flip
          // required, depending on another answer. The server re-evaluates the
          // same logic at submit/PDF time, so it stays the source of truth.
          const cond = deriveFieldState(q.condition, q.isRequired, answers);
          if (!cond.visible) return null;
          const isTextarea = q.fieldType === "textarea";
          // checkbox renders the label inside the control, so suppress the heading.
          const showHeading = q.fieldType !== "checkbox";
          const lockMessage = cond.disabled ? resolveI18n(cond.lockMessage, locale) || null : null;
          return (
            <div key={q.id}>
              {showHeading && (
                <>
                  <h2
                    style={{
                      fontFamily: "var(--font-title)",
                      fontWeight: 800,
                      fontSize: 21,
                      lineHeight: 1.25,
                      color: "var(--navy)",
                      margin: "0 0 6px",
                    }}
                  >
                    {pickI18n(q.questionI18n, locale)}
                    {cond.required && <span style={{ color: "var(--accent)" }}> *</span>}
                  </h2>
                  {pickI18n(q.helpI18n, locale) && (
                    <p style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.45, margin: "0 0 12px" }}>
                      {pickI18n(q.helpI18n, locale)}
                    </p>
                  )}
                </>
              )}
              <WizardField
                question={q}
                value={answers[q.id]}
                error={showErrors ? errors[q.id] ?? null : null}
                showPrefill={prefilledIds.has(q.id)}
                locale={locale}
                labels={labels}
                onChange={(v) => setAnswer(q.id, v)}
                onBlur={() => autosave.flush()}
                showDictation={isTextarea}
                disabled={cond.disabled}
                lockMessage={lockMessage}
              />
            </div>
          );
        })}
      </div>

      {/* Submit error (amable, never red toast) */}
      {submitError && (
        <div
          role="alert"
          className="anim-fade-in-up"
          style={{
            marginTop: 18,
            padding: "14px 16px",
            background: "var(--gold-soft)",
            borderRadius: 14,
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <Icon name="info" size={18} color="var(--gold-deep)" />
          <div>
            <div style={{ fontWeight: 800, fontSize: 14.5, color: "var(--gold-deep)", fontFamily: "var(--font-title)" }}>
              {labels.submitErrorTitle}
            </div>
            <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginTop: 2 }}>{labels.submitErrorBody}</div>
          </div>
        </div>
      )}

      {/* Footer privacy note */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22, marginBottom: 18 }}>
        <Icon name="shield" size={16} color="var(--green)" />
        <span style={{ fontSize: 12.5, color: "var(--ink-3)", fontWeight: 600 }}>{labels.privacyNote}</span>
      </div>

      {/* Zona 5 — navigation */}
      <div style={{ display: "flex", gap: 12 }}>
        <GhostBtn icon="arrowL" size="md" full={false} onClick={goBack} style={{ flex: "0 0 auto", minWidth: 120 }}>
          {labels.back}
        </GhostBtn>
        <GradientBtn
          icon={isLastStep ? "check" : "chevR"}
          size="md"
          full
          disabled={submitting}
          onClick={goNext}
          style={{ flex: 1 }}
        >
          {submitting ? labels.submitting : isLastStep ? labels.finish : labels.next}
        </GradientBtn>
      </div>
    </div>
  );
}
