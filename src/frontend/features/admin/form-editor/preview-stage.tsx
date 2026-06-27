"use client";

import * as React from "react";
import { GradientBtn, Icon } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { FormWizard } from "@/frontend/features/form-wizard";
import type { WizardLabels } from "@/frontend/features/form-wizard";
import type { QuestionGroupVM, FormEditorActions } from "./types";
import type { FormEditorStrings } from "./strings";
import { buildPreviewForm } from "./wizard-bridge";

/**
 * PreviewStage — stage 3 (DOC-53 §5.1.3).
 *
 * A 390px mobile frame that renders the FAITHFUL client wizard from the current
 * groups/questions using the SHARED FormWizard engine (the same motor the client
 * app uses — SOT-3, DOC-50 §6). Toggle ES|EN; prefilled fields show the "Ya lo
 * tenemos" chip; "Generar PDF de prueba" calls generateTestPdf and renders the
 * filled PDF, listing required gaps without blocking.
 *
 * The preview injects no-op autosave/submit actions: the editor preview never
 * persists (status stays null → never read-only; submit is a visual no-op).
 */

export interface PreviewStageProps {
  groups: QuestionGroupVM[];
  versionId: string;
  lang: "es" | "en";
  onLangChange: (l: "es" | "en") => void;
  formLabel: { es: string; en: string };
  strings: FormEditorStrings;
  actions: FormEditorActions;
}

/** Static WizardLabels for the editor preview (Spanish-leaning, EN parity). */
function previewLabels(lang: "es" | "en"): WizardLabels {
  const t = (es: string, en: string) => (lang === "es" ? es : en);
  return {
    stepCounter: t("Paso {n} de {total}", "Step {n} of {total}"),
    back: t("Atrás", "Back"),
    saving: t("Guardando…", "Saving…"),
    saved: t("Guardado", "Saved"),
    queued: t("Guardado en este dispositivo · pendiente de envío", "Saved on this device · pending sync"),
    saveError: t("Reintentando…", "Retrying…"),
    saveBlocked: t("No pudimos guardar. Recarga la página para continuar.", "We couldn't save. Please reload to continue."),
    saveBlockedSubmitted: t("Este formulario ya fue enviado. Recarga para ver la versión final.", "This form was already submitted. Reload to see the final version."),
    offlineBanner: t("Sin conexión. Tus respuestas se guardan en este dispositivo y se enviarán al reconectar.", "You're offline. Your answers are saved on this device and will sync when you reconnect."),
    prefillChip: t("Ya lo tenemos", "We already have it"),
    prefillFromDocument: t("lo tomamos de tu documento", "from your document"),
    prefillFromProfile: t("lo tomamos de tu perfil", "from your profile"),
    prefillFromGeneration: t("lo tomamos de tu solicitud", "from your application"),
    prefillEdited: t("Lo cambiaste tú", "You changed it"),
    prefillAiBadge: t("IA", "AI"),
    selectPlaceholder: t("Elige una opción", "Choose an option"),
    textareaPlaceholder: t("Escribe aquí, o toca el micrófono para hablar…", "Type here, or tap the mic…"),
    checkboxYes: t("Sí", "Yes"),
    errRequired: t("Esto nos hace falta para continuar.", "We need this to continue."),
    errRegex: t("Revisa el formato, por favor.", "Please check the format."),
    errMin: t("Es un poco corto.", "That's a bit short."),
    errMax: t("Es demasiado largo.", "That's too long."),
    next: t("Siguiente", "Next"),
    finish: t("Terminar", "Finish"),
    submitting: t("Enviando…", "Sending…"),
    submitErrorTitle: t("No pudimos enviarlo", "We couldn't send it"),
    submitErrorBody: t("Vuelve a intentarlo.", "Please try again."),
    privacyNote: t("Tu información está protegida y es confidencial", "Your information is protected and confidential"),
    dictateIdle: t("Tocar para hablar", "Tap to speak"),
    dictateActive: t("Escuchando… toca para parar", "Listening… tap to stop"),
    dictateUnsupported: t("El dictado no está disponible aquí.", "Dictation isn't available here."),
    submittedPill: t("Enviado", "Submitted"),
    submittedTitle: t("¡Listo! Lo recibimos", "Done! We got it"),
    submittedBody: t("Tu equipo lo está revisando.", "Your team is reviewing it."),
  };
}

export function PreviewStage({ groups, versionId, lang, onLangChange, formLabel, strings, actions }: PreviewStageProps) {
  const [busy, setBusy] = React.useState(false);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [gaps, setGaps] = React.useState<Array<{ question_id: string; pdf_field_name: string }>>([]);

  // Map the editor groups onto the shared wizard engine (SOT-3 — one motor).
  // Remounting on group/lang changes keeps the preview in sync with edits.
  const previewForm = React.useMemo(
    () => buildPreviewForm(groups, versionId, formLabel),
    [groups, versionId, formLabel],
  );
  const wizardLabels = React.useMemo(() => previewLabels(lang), [lang]);
  const previewKey = `${versionId}:${lang}:${groups.length}`;

  async function generateTest() {
    setBusy(true);
    // Build filler sample answers (all client questions get a placeholder).
    const sample: Record<string, unknown> = {};
    for (const g of groups) for (const q of g.questions) {
      if (q.source !== "client_answer") continue;
      sample[q.id] = q.field_type === "checkbox" ? true : q.field_type === "number" ? 1 : "Ejemplo";
    }
    const r = await actions.generateTestPdf({ version_id: versionId, sample_answers: sample });
    setBusy(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    const bytes = Uint8Array.from(atob(r.data!.pdfBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    setPdfUrl(URL.createObjectURL(blob));
    setGaps(r.data!.gaps);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 24, alignItems: "start" }}>
      {/* Mobile frame */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <div style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 12, background: "var(--chip)" }}>
          {(["es", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => onLangChange(l)} aria-pressed={lang === l} style={{ height: 30, padding: "0 16px", borderRadius: 9, border: "none", cursor: "pointer", background: lang === l ? "var(--accent-soft)" : "transparent", color: lang === l ? "var(--accent)" : "var(--ink-2)", fontWeight: 800, fontSize: 12.5 }}>
              {l === "es" ? strings.previewToggleEs : strings.previewToggleEn}
            </button>
          ))}
        </div>
        <div
          data-theme-scope
          style={{ width: 390, height: 720, borderRadius: 36, border: "10px solid var(--navy)", background: "var(--bg)", overflow: "hidden", boxShadow: "0 24px 60px rgba(7,17,33,.28)", position: "relative" }}
        >
          <div style={{ height: "100%", overflow: "auto" }}>
            {previewForm.groups.length === 0 ? (
              <p style={{ color: "var(--ink-3)", fontSize: 14, textAlign: "center", marginTop: 40 }}>—</p>
            ) : (
              <FormWizard
                key={previewKey}
                caseId="preview"
                partyId={null}
                form={previewForm}
                locale={lang}
                labels={wizardLabels}
                saveDraft={async () => ({ ok: true })}
                submitForm={async () => ({ ok: true })}
              />
            )}
          </div>
        </div>
      </div>

      {/* Test PDF panel */}
      <div>
        <GradientBtn size="md" full={false} onClick={generateTest} disabled={busy}>
          {busy ? strings.testRunning : strings.generateTestPdf}
        </GradientBtn>
        {gaps.length > 0 && (
          <div style={{ marginTop: 14, background: "var(--gold-soft)", borderRadius: 12, padding: "12px 14px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 12.5, fontWeight: 700, color: "var(--gold-deep)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="info" size={14} /> {strings.testGaps}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "var(--ink-2)" }}>
              {gaps.map((g) => <li key={g.question_id}>{g.pdf_field_name}</li>)}
            </ul>
          </div>
        )}
        {pdfUrl && (
          <iframe title="PDF de prueba" src={pdfUrl} style={{ marginTop: 14, width: "100%", height: 560, border: "1px solid var(--line)", borderRadius: 14, background: "#fff" }} />
        )}
      </div>
    </div>
  );
}
