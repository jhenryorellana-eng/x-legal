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
  ImproveAnswerFn,
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
  /**
   * Who is looking at the wizard. Drives what a locked (submitted/approved) form
   * shows: the client sees the "¡Listo! Lo recibimos" confirmation; staff sees the
   * answers in read-only (never the client confirmation). A staff viewer also
   * treats a `filled_by='client'` form as read-only regardless of status
   * (RF-DIA-023 — staff never edits a client form; if info is missing they ask by
   * message). Default "client" keeps the client surface untouched.
   */
  audience?: "client" | "staff";
  /**
   * Staff-only: make the review answers EDITABLE (the "Revisión" split-screen, when
   * the actor has the `formEdit` permission). Default false → the staff view is
   * read-only ("Ver"). Ignored for the client. When true, the flat staff view
   * enables its fields and autosaves through the injected `saveDraft` (the staff
   * update action) using the same durable autosave engine as the client.
   */
  editable?: boolean;
  /**
   * Staff fill-on-behalf: when the staff opens a still-editable client form (draft/
   * rejected) with edit rights, render the SAME stepped wizard the client uses so
   * staff can fill AND submit on the client's behalf (RF-ADM-010 / RF-VAN-043),
   * instead of the flat read-only/correction surface. Only the fill route sets this;
   * the "Revisión" split-screen leaves it false so its behavior is unchanged.
   */
  allowStaffSubmit?: boolean;
  /** Show Lex "atento" + listening chip at the top (Mi Historia). */
  withLex?: boolean;
  lexChip?: string;
  /** Per-party name shown under the title (e.g. "Datos del menor — Mateo"). */
  partyName?: string | null;
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  /** Server-side translator fallback (Gemini) for the answer-translation flow. */
  translateAnswers?: TranslateAnswersFn;
  /** "Mejorar con IA" server action. Only questions with `aiImproveEnabled` show
   *  the button; absent = feature off for the whole surface (admin preview). */
  improveAnswer?: ImproveAnswerFn;
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
  blocked: "saveBlocked",
};

/** The chip text — "blocked" gets a code-specific message (e.g. submitted elsewhere). */
function saveLabel(
  saveState: SaveState,
  blockedCode: string | null,
  labels: WizardLabels,
): string | null {
  if (saveState === "blocked" && blockedCode === "FORM_NOT_SUBMITTABLE") {
    return labels.saveBlockedSubmitted;
  }
  const key = SAVE_LABEL[saveState];
  return key ? labels[key] : null;
}

export function FormWizard({
  caseId,
  partyId,
  form,
  locale,
  labels,
  audience = "client",
  editable = false,
  allowStaffSubmit = false,
  withLex = false,
  lexChip,
  partyName,
  saveDraft,
  submitForm,
  translateAnswers,
  improveAnswer,
  onSubmitted,
  onExit,
}: FormWizardProps) {
  const groups = form.groups;
  // Staff fill-on-behalf: an editable client form that is NOT yet locked
  // (draft/rejected) → render the full stepped client wizard so staff can fill AND
  // submit for the client (RF-ADM-010 / RF-VAN-043). Only the fill route opts in via
  // `allowStaffSubmit`; the "Revisión" split-screen never does, so it is unaffected.
  const staffFillOnBehalf =
    audience === "staff" &&
    allowStaffSubmit &&
    editable &&
    form.filledBy === "client" &&
    !isReadOnly(form.status);
  // Staff review surface: a form the staff opens that is already submitted/approved,
  // or that the client fills. It's rendered FLAT (all groups) — read-only ("Ver") or
  // editable correction ("Revisión" / "Ver" with formEdit). Excludes the fill-on-behalf
  // case above. The client never lands here.
  const staffReview =
    audience === "staff" &&
    (isReadOnly(form.status) || form.filledBy === "client") &&
    !staffFillOnBehalf;
  // Client read-only confirmation ("¡Listo! Lo recibimos") — client audience only.
  const clientLocked = audience === "client" && isReadOnly(form.status);
  // Autosave is active for the stepped wizard (client / staff-fillable draft) and for
  // the editable staff review; never for a read-only view.
  const autosaveEnabled = staffReview ? editable : !clientLocked;

  // Initial answers (saved wins, prefill seeds, else empty) + prefilled set.
  const initial = React.useMemo(() => buildInitialAnswers(groups), [groups]);
  const [answers, setAnswers] = React.useState<Record<string, unknown>>(initial.answers);
  const [prefilledIds, setPrefilledIds] = React.useState<Set<string>>(initial.prefilledIds);

  // Resume at the first incomplete group (DOC-50 §6.3 — "primer paso incompleto").
  const [step, setStep] = React.useState<number>(() => {
    if (staffReview || clientLocked) return 0;
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
    enabled: autosaveEnabled && !done,
    // Offline-reload rehydration: merge unsynced edits recovered from IndexedDB
    // over the server answers so the user sees exactly what they last typed.
    onHydrate: (recovered) => {
      setAnswers((prev) => ({ ...prev, ...recovered }));
      setPrefilledIds((prev) => {
        const next = new Set(prev);
        for (const k of Object.keys(recovered)) next.delete(k);
        return next;
      });
    },
  });

  const total = groups.length;
  const current = groups[step];
  const isLastStep = step === total - 1;
  const pct = total > 0 ? ((step + 1) / total) * 100 : 0;

  // Reset scroll to top on step change (prototype parity).
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [step]);

  // "Mejorar con IA": per-question closure over the injected server action.
  // undefined (no config / no action) = the field renders no button.
  const makeImprove = (q: { id: string; aiImproveEnabled?: boolean }) =>
    improveAnswer && q.aiImproveEnabled
      ? (text: string) =>
          improveAnswer({
            caseId,
            formDefinitionId: form.formDefinitionId,
            partyId,
            questionId: q.id,
            text,
          })
      : undefined;

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

  // --- staff review — the ANSWERS, never the client confirmation -------------
  // A staff opening a submitted/approved (or any client-filled) form sees every
  // answer flattened. Read-only by default ("Ver"); when `editable` (the "Revisión"
  // split-screen with formEdit) the fields are enabled and autosave through the
  // injected staff action. No submit/next. The "¡Listo!" screen below is client-only.
  if (staffReview) {
    const isClientForm = form.filledBy === "client";
    const pillLabel = form.status === "approved" ? labels.approvedPill : labels.submittedPill;
    const saveText = editable ? saveLabel(autosave.saveState, autosave.blockedCode, labels) : null;
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
            {pillLabel}
          </span>
        </div>

        {partyName && (
          <div style={{ fontSize: 13.5, color: "var(--ink-3)", fontWeight: 700, marginBottom: 12 }}>{partyName}</div>
        )}

        {isClientForm && (
          <div
            role="note"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              marginBottom: 18,
              background: "var(--blue-soft)",
              color: "var(--accent)",
              borderRadius: 12,
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            <Icon name="info" size={16} color="var(--accent)" />
            <span>{editable ? labels.reviewClientEditBanner : labels.reviewClientBanner}</span>
          </div>
        )}

        {/* Autosave indicator (edit mode) — the client's durable engine reused. */}
        {editable && (
          <div style={{ minHeight: 20, display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
            {saveText && (
              <span
                className="anim-fade-in"
                role={autosave.saveState === "blocked" ? "alert" : undefined}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12.5,
                  fontWeight: 700,
                  color:
                    autosave.saveState === "saved"
                      ? "var(--green)"
                      : autosave.saveState === "blocked"
                        ? "var(--gold-deep)"
                        : "var(--ink-3)",
                }}
              >
                {autosave.saveState === "saved" && <Icon name="check" size={13} color="var(--green)" stroke={3} />}
                {autosave.saveState === "queued" && <Icon name="clock" size={13} color="var(--ink-3)" />}
                {autosave.saveState === "blocked" && <Icon name="info" size={13} color="var(--gold-deep)" />}
                {saveText}
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {groups.map((g) => {
            const groupTitle = pickI18n(g.titleI18n, locale);
            const visible = g.questions.filter(
              (q) => deriveFieldState(q.condition, q.isRequired, answers).visible,
            );
            if (visible.length === 0) return null;
            return (
              <div key={g.id}>
                {groupTitle && (
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
                    {groupTitle}
                  </div>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
                  {visible.map((q) => {
                    const showHeading = q.fieldType !== "checkbox";
                    return (
                      <div key={q.id}>
                        {showHeading && (
                          <h2
                            style={{
                              fontFamily: "var(--font-title)",
                              fontWeight: 800,
                              fontSize: 17,
                              lineHeight: 1.3,
                              color: "var(--navy)",
                              margin: "0 0 8px",
                            }}
                          >
                            {pickI18n(q.questionI18n, locale)}
                          </h2>
                        )}
                        <WizardField
                          question={q}
                          value={answers[q.id]}
                          error={null}
                          showPrefill={false}
                          locale={locale}
                          labels={labels}
                          onChange={editable ? (v) => setAnswer(q.id, v) : () => {}}
                          onBlur={editable ? () => autosave.flush() : () => {}}
                          onImprove={editable ? makeImprove(q) : undefined}
                          showDictation={false}
                          disabled={!editable}
                          hidePrefillChip
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --- read-only client confirmation (submitted / approved) -----------------
  if (clientLocked) {
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

      {/* Persistent offline banner (discreet) — DOC-50 §6.3 / spec: "cola local + indicador". */}
      {!autosave.online && (
        <div
          role="status"
          className="anim-fade-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            marginBottom: 10,
            background: "var(--gold-soft)",
            color: "var(--ink-2)",
            borderRadius: 12,
            fontSize: 12.5,
            fontWeight: 600,
            lineHeight: 1.35,
          }}
        >
          <Icon name="info" size={14} color="var(--gold-deep)" />
          <span>{labels.offlineBanner}</span>
        </div>
      )}

      {/* Staff fill-on-behalf banner — this is the client's form being completed BY
          staff (RF-ADM-010 / RF-VAN-043). Same durable autosave as the client. */}
      {audience === "staff" && (
        <div
          role="note"
          className="anim-fade-in"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            marginBottom: 12,
            background: "var(--blue-soft)",
            color: "var(--accent)",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          <Icon name="info" size={16} color="var(--accent)" />
          <span>{labels.reviewClientEditBanner}</span>
        </div>
      )}

      {/* Correction banner — the staff returned this form for correction. Amber,
          never red (RF-TRX-022). Shown on the first step where the client lands. */}
      {form.status === "rejected" && step === 0 && (
        <div
          role="alert"
          className="anim-fade-in"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "12px 14px",
            marginBottom: 12,
            background: "var(--gold-soft)",
            border: "1px solid var(--gold)",
            borderRadius: 12,
            lineHeight: 1.4,
          }}
        >
          <Icon name="info" size={16} color="var(--gold-deep)" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--ink)" }}>{labels.rejectionTitle}</div>
            {pickI18n(form.rejectionReasonI18n ?? null, locale) && (
              <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 3 }}>
                {pickI18n(form.rejectionReasonI18n ?? null, locale)}
              </div>
            )}
            {form.correctionDueAt && (
              <div style={{ fontSize: 12.5, color: "var(--gold-deep)", fontWeight: 700, marginTop: 4 }}>
                {labels.rejectionDueLabel.replace(
                  "{date}",
                  new Date(form.correctionDueAt).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }),
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Autosave indicator */}
      <div style={{ minHeight: 20, display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {saveLabel(autosave.saveState, autosave.blockedCode, labels) && (
          <span
            className="anim-fade-in"
            role={autosave.saveState === "blocked" ? "alert" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 700,
              color:
                autosave.saveState === "saved"
                  ? "var(--green)"
                  : autosave.saveState === "blocked"
                    ? "var(--gold-deep)"
                    : "var(--ink-3)",
            }}
          >
            {autosave.saveState === "saved" && <Icon name="check" size={13} color="var(--green)" stroke={3} />}
            {autosave.saveState === "queued" && <Icon name="clock" size={13} color="var(--ink-3)" />}
            {autosave.saveState === "blocked" && <Icon name="info" size={13} color="var(--gold-deep)" />}
            {saveLabel(autosave.saveState, autosave.blockedCode, labels)}
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
                onImprove={cond.disabled ? undefined : makeImprove(q)}
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
