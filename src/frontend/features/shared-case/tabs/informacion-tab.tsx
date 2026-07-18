"use client";

/**
 * Información / Formularios tab (DOC-52 §5.7 / DOC-53 §3.4.3 / DOC-54 §2.4) — the
 * case forms for the current phase with their real status (`.formcard` design).
 *
 * Each form exposes up to three staff actions (Henry 2026-07-07 consolidation —
 * the standalone `/formularios` page was removed; everything lives here):
 *  - "Ver": opens the questions + answers in read-only (the client's view).
 *  - "Generar"/"Regenerar": autofills the official PDF (pdf_automation) or launches
 *    the AI letter (ai_letter). Gated exactly like the old CaseFormsManager.
 *  - "Revisión": Diana's side-by-side screen (official PDF | answers/documents +
 *    Aprobar) at `{base}/revisar/{formId}`.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/frontend/components/brand/card";
import { Chip } from "@/frontend/components/brand/chip";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { EmptyState } from "@/frontend/components/desktop/empty-state";
import { toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";
import type { CaseWorkspaceVM, CaseDetailActions, FormVM } from "../types";
import type { CasosStrings } from "../strings";
import { pdfErrorMessage, approveErrorMessage } from "../pdf-error";
import { SectionLabel } from "../ui";

function formMeta(status: string | null, t: CasosStrings["detail"]): { pct: number; tone: "green" | "blue" | "amber"; label: string } {
  switch (status) {
    case "approved":
      return { pct: 100, tone: "green", label: t.formStatusApproved };
    case "submitted":
      return { pct: 100, tone: "blue", label: t.formStatusSubmitted };
    case "draft":
      return { pct: 50, tone: "amber", label: t.formStatusDraft };
    default:
      return { pct: 0, tone: "blue", label: t.formStatusPending };
  }
}

export function InformacionTab({
  vm,
  actions,
  strings,
  onNavigateToGeneration,
  onOpenPreMortem,
  preMortemEnabled,
}: {
  vm: CaseWorkspaceVM;
  actions: CaseDetailActions;
  strings: CasosStrings;
  /** Switches the workspace to the Cartas/Generaciones tab (staff "Generar"). */
  onNavigateToGeneration?: () => void;
  /** Opens the Pre-Mortem tab focused on this automation (deep-link). */
  onOpenPreMortem?: (key: string) => void;
  preMortemEnabled?: boolean;
}) {
  const t = strings.detail;
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);

  // The Información tab is shared across the admin / legal / ventas workspaces;
  // route forms to the matching case-detail base so the screens stay in-workspace.
  const caseId = vm.header.caseId;
  const base =
    vm.role === "paralegal"
      ? `/legal/caso/${caseId}`
      : vm.isAdmin
        ? `/admin/casos/${caseId}`
        : `/ventas/clientes/${caseId}`;

  function query(f: FormVM): string {
    const q = new URLSearchParams();
    if (f.partyId) q.set("party", f.partyId);
    if (f.partyName) q.set("name", f.partyName);
    const qs = q.toString();
    return qs ? `?${qs}` : "";
  }
  // For an ai_letter with a companion questionnaire, fillFormDefinitionId is the
  // questionnaire (the questions the client answers to give the AI context).
  const viewHref = (f: FormVM) => `${base}/formulario/${f.fillFormDefinitionId}${query(f)}`;
  const reviewHref = (f: FormVM) => `${base}/revisar/${f.fillFormDefinitionId}${query(f)}`;

  async function generatePdf(f: FormVM) {
    if (!actions.generateFilledPdf || !f.responseId) return;
    setBusy(rowKey(f));
    try {
      const r = await actions.generateFilledPdf({ responseId: f.responseId });
      if (r.ok && r.downloadUrl) {
        toast.success(t.toastPdfGenerated);
        getBridge().share.openExternal(r.downloadUrl);
      } else {
        toast.error(pdfErrorMessage(r.error, t));
      }
    } catch {
      toast.error(pdfErrorMessage(undefined, t));
    } finally {
      setBusy(null); // a transport throw must never leave the button dead
    }
  }

  // RF-VAN-043 — "Marcar como Verificado": the asesora confirms every required
  // field is complete (the server enforces it; FORM_INCOMPLETE lists what's
  // missing). She never generates documents — that stays with legal.
  async function verifyForm(f: FormVM) {
    if (!actions.approveForm || !f.responseId) return;
    setBusy(rowKey(f));
    try {
      const r = await actions.approveForm({ responseId: f.responseId });
      if (r.ok) {
        toast.success(t.toastVerifyDone);
        router.refresh();
      } else {
        toast.error(approveErrorMessage(r.error, t));
      }
    } catch {
      toast.error(approveErrorMessage(undefined, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <SectionLabel icon="form">{t.formsTitle}</SectionLabel>
      <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--ink-2)" }}>{t.formsSub}</p>

      {vm.forms.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState title={t.formsEmpty} mood="calma" lexSize={104} />
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          {vm.forms.map((f: FormVM) => {
            const m = formMeta(f.status, t);
            const isLetter = f.kind === "ai_letter";
            const isBusy = busy === rowKey(f);
            // Same gates the standalone CaseFormsManager used (DOC-53 §3.4.3):
            // a client-filled PDF must be approved first; staff-filled can generate once submitted.
            const canGeneratePdf =
              !isLetter &&
              !!actions.generateFilledPdf &&
              !!f.responseId &&
              (f.status === "approved" || (f.status === "submitted" && f.filledBy !== "client"));
            const canGenerateLetter = isLetter && !!onNavigateToGeneration;
            const canReview = f.kind === "pdf_automation";
            const canPreMortem =
              !isLetter &&
              !!preMortemEnabled &&
              !!onOpenPreMortem &&
              !!f.responseId &&
              (f.hasPdf || f.status === "submitted" || f.status === "approved");
            return (
              <div key={rowKey(f)} className="formcard">
                <ProgressRing pct={m.pct} size={46} stroke={6} aria-label={f.label} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{f.label}</p>
                  {f.partyName && (
                    <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--ink-3)", fontWeight: 700 }}>{f.partyName}</p>
                  )}
                </div>
                <Chip tone={m.tone} dot>
                  {m.label}
                </Chip>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {/* Ver — the client's form. Read-only by default; editable (fill/correct
                      + submit on the client's behalf) when the actor has formEdit. */}
                  <GhostBtn size="md" full={false} icon="doc" onClick={() => router.push(viewHref(f))}>
                    {t.viewForm}
                  </GhostBtn>

                  {/* Verificar (RF-VAN-043) — submitted → approved, gated on
                      completeness server-side. Visible to any staff surface that
                      injects approveForm (Vanessa's main action). */}
                  {actions.approveForm && f.responseId && f.status === "submitted" && (
                    <GradientBtn size="md" full={false} icon="check" disabled={isBusy} onClick={() => verifyForm(f)}>
                      {isBusy ? t.verifying : t.verifyForm}
                    </GradientBtn>
                  )}

                  {/* Generar / Regenerar — official PDF (pdf_automation) or AI letter. */}
                  {canGeneratePdf && (
                    <GhostBtn size="md" full={false} icon="sparkle" disabled={isBusy} onClick={() => generatePdf(f)}>
                      {isBusy ? t.generatingForm : f.hasPdf ? t.regeneratePdf : t.generatePdf}
                    </GhostBtn>
                  )}
                  {canGenerateLetter && (
                    <GradientBtn size="md" full={false} icon="sparkle" onClick={onNavigateToGeneration}>
                      {t.generateLetter}
                    </GradientBtn>
                  )}

                  {/* Pre-Mortem — validate this autofilled form's quality. */}
                  {canPreMortem && (
                    <GhostBtn size="md" full={false} icon="shield" onClick={() => onOpenPreMortem!(`pdf_automation:${f.id}:${f.partyId ?? ""}`)}>
                      {t.preMortem.title}
                    </GhostBtn>
                  )}

                  {/* Revisión — Diana's side-by-side (official PDF | answers/docs + Aprobar). */}
                  {canReview && (
                    <GradientBtn size="md" full={false} icon="chevR" onClick={() => router.push(reviewHref(f))}>
                      {t.openReview}
                    </GradientBtn>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/** Stable per-row key (a form can appear once per party). */
function rowKey(f: FormVM): string {
  return `${f.id}-${f.partyId ?? ""}`;
}
