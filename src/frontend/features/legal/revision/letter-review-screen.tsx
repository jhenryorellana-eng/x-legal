"use client";

/**
 * LetterReviewScreen — Diana's side-by-side review of an AI-generated LETTER
 * (Ola 2). Mirror of FormReviewScreen, but the left panel is the generated letter
 * PDF (ai_generation_runs.output_path) and "regenerate" is the async AI job, not a
 * synchronous mupdf fill.
 *
 * LEFT (fixed): the current run's generated letter PDF (blob URL for CSP).
 * RIGHT: the companion questionnaire's FormWizard — editable when the staff has the
 *   `formEdit` permission (reuses Ola 1 end-to-end: autosave via staffUpdateFormAnswers).
 * BOTTOM: "Regenerar carta" → startLetterGeneration → poll the run status until it
 *   completes (minutes) → swap the left PDF to the new version.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  FormWizard,
  type WizardForm,
  type WizardLabels,
  type Locale,
  type SaveDraftFn,
  type SubmitFormFn,
  type TranslateAnswersFn,
} from "@/frontend/features/form-wizard";
import { GradientBtn, GhostBtn } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";

export interface LetterReviewStrings {
  letterTitle: string;
  letterEmpty: string;
  loading: string;
  reviewHint: string;
  regenerateBtn: string;
  regenerating: string;
  regenError: string;
  viewLetter: string;
  back: string;
}

export interface LetterReviewActions {
  saveDraft: SaveDraftFn;
  submitForm: SubmitFormFn;
  translateAnswers?: TranslateAnswersFn;
  getGenerationOutputUrl: (input: { runId: string }) => Promise<{ ok: boolean; url?: string | null; error?: { code: string } }>;
  startLetterGeneration: (input: { caseId: string; formDefinitionId: string; partyId: string | null }) => Promise<{ ok: boolean; runId?: string; error?: { code: string } }>;
  getRunStatus: (input: { runId: string }) => Promise<{ ok: boolean; status?: string; outputAvailable?: boolean; error?: { code: string } }>;
}

/** Fetches a URL's bytes into a blob: object URL (CSP-safe for iframes). */
async function toBlobUrl(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

export function LetterReviewScreen({
  caseId,
  partyId,
  partyName,
  aiLetterFormDefinitionId,
  form,
  locale,
  labels,
  editable = false,
  initialRunId,
  strings,
  actions,
  backHref,
}: {
  caseId: string;
  partyId: string | null;
  partyName: string | null;
  /** The ai_letter form definition (the deliverable), for regenerate. */
  aiLetterFormDefinitionId: string;
  /** The companion questionnaire (what the wizard edits). */
  form: WizardForm;
  locale: Locale;
  labels: WizardLabels;
  editable?: boolean;
  /** The current run whose letter PDF is shown on the left (null = none yet). */
  initialRunId: string | null;
  strings: LetterReviewStrings;
  actions: LetterReviewActions;
  backHref: string;
}) {
  const router = useRouter();
  const [pdfRunId, setPdfRunId] = React.useState<string | null>(initialRunId);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [pdfRemoteUrl, setPdfRemoteUrl] = React.useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  const pollRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the left letter PDF for the current run.
  React.useEffect(() => {
    let alive = true;
    let obj: string | null = null;
    if (!pdfRunId) {
      setPdfUrl(null);
      setPdfRemoteUrl(null);
      return;
    }
    setPdfLoading(true);
    (async () => {
      const r = await actions.getGenerationOutputUrl({ runId: pdfRunId });
      if (!alive) return;
      if (r.ok && r.url) {
        setPdfRemoteUrl(r.url);
        obj = await toBlobUrl(r.url);
        if (alive) setPdfUrl(obj);
      } else {
        setPdfUrl(null);
        setPdfRemoteUrl(null);
      }
    })().finally(() => {
      if (alive) setPdfLoading(false);
    });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [pdfRunId, actions]);

  // Clean up any pending poll on unmount.
  React.useEffect(() => () => {
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  function pollUntilDone(runId: string) {
    // Poll every 4s — a memo can take minutes (research + sectioned drafting).
    const tick = async () => {
      const s = await actions.getRunStatus({ runId });
      if (s.ok && s.status === "completed" && s.outputAvailable) {
        setGenerating(false);
        setPdfRunId(runId); // swap the left PDF to the fresh version
        return;
      }
      if (s.ok && (s.status === "failed" || s.status === "cancelled")) {
        setGenerating(false);
        toast.error(strings.regenError);
        return;
      }
      pollRef.current = setTimeout(tick, 4000);
    };
    pollRef.current = setTimeout(tick, 4000);
  }

  async function handleRegenerate() {
    setGenerating(true);
    const r = await actions.startLetterGeneration({ caseId, formDefinitionId: aiLetterFormDefinitionId, partyId });
    if (!r.ok || !r.runId) {
      setGenerating(false);
      toast.error(strings.regenError);
      return;
    }
    pollUntilDone(r.runId);
  }

  const panel: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--line)",
    borderRadius: 14,
    background: "var(--card,#fff)",
    minHeight: 0,
  };
  const centered: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "var(--ink-3)",
    fontSize: 13,
    textAlign: "center",
    padding: 24,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => router.push(backHref)}
          style={{ border: "none", background: "transparent", color: "var(--ink-2)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
        >
          ← {strings.back}
        </button>
      </div>

      <div className="split-view" style={{ gap: 16, flex: 1, minHeight: 0 }}>
        {/* LEFT — generated letter PDF */}
        <div style={panel}>
          <div style={{ flexShrink: 0, padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{strings.letterTitle}</p>
            {pdfRemoteUrl && (
              <button
                type="button"
                onClick={() => getBridge().share.openExternal(pdfRemoteUrl)}
                style={{ border: "none", background: "transparent", fontSize: 12.5, fontWeight: 700, color: "var(--accent)", cursor: "pointer" }}
              >
                {strings.viewLetter} ↗
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, background: "var(--chip,#f1f5fb)" }}>
            {generating ? (
              <div style={centered}>{strings.regenerating}</div>
            ) : pdfLoading ? (
              <div style={centered}>{strings.loading}</div>
            ) : pdfUrl ? (
              <iframe title="carta-generada" src={pdfUrl} style={{ width: "100%", height: "100%", minHeight: 420, border: "none" }} />
            ) : (
              <div style={centered}>{strings.letterEmpty}</div>
            )}
          </div>
        </div>

        {/* RIGHT — companion questionnaire answers (editable with formEdit) */}
        <div style={panel}>
          <div style={{ flexShrink: 0, padding: "8px 14px", background: "var(--blue-soft)" }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: "var(--accent)" }}>{strings.reviewHint}</p>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
            <FormWizard
              caseId={caseId}
              partyId={partyId}
              partyName={partyName}
              form={form}
              locale={locale}
              labels={labels}
              audience="staff"
              editable={editable}
              saveDraft={actions.saveDraft}
              submitForm={actions.submitForm}
              translateAnswers={actions.translateAnswers}
              onExit={() => router.push(backHref)}
            />
          </div>
        </div>
      </div>

      {/* Pinned regenerate bar */}
      <div style={{ flexShrink: 0, marginTop: 12, padding: "12px 16px", borderTop: "1px solid var(--line)", background: "var(--card,#fff)", borderRadius: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <GradientBtn size="md" full={false} icon="sparkle" disabled={generating} onClick={handleRegenerate}>
          {generating ? strings.regenerating : strings.regenerateBtn}
        </GradientBtn>
        {pdfRemoteUrl && (
          <GhostBtn size="md" full={false} onClick={() => getBridge().share.openExternal(pdfRemoteUrl)}>
            {strings.viewLetter}
          </GhostBtn>
        )}
      </div>
    </div>
  );
}
