"use client";

import * as React from "react";
import { Card, GradientBtn, GhostBtn, StatusPill, Chip, Lex, type StatusKind } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { getBridge } from "@/frontend/platform-bridge";

/**
 * CaseFormsManager — staff review of a case's form RESPONSES (RF-ADM-010 / DOC-53
 * §3.4.3). Lists every response with its status and lets staff Approve (submitted →
 * approved) and Generate the filled PDF (resolveBySource → fillAcroForm), surfacing
 * the signed download URL. Blocked-state errors (missing required / needs approval)
 * are shown as friendly toasts.
 */

export interface CaseFormItemVM {
  responseId: string;
  formDefinitionId: string;
  label: string;
  kind: string;
  filledBy: string;
  status: string;
  partyId: string | null;
  partyName: string | null;
  hasPdf: boolean;
  submittedAt: string | null;
}

export interface CaseFormsActions {
  approve: (input: { responseId: string }) => Promise<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> } }>;
  generatePdf: (input: { responseId: string }) => Promise<{ ok: boolean; downloadUrl?: string; error?: { code: string; details?: Record<string, unknown> } }>;
  /**
   * Launch an ai_letter generation (carta IA) from a form response. Optional —
   * only surfaces that authorize generation inject it; absence hides the button.
   */
  startGeneration?: (input: {
    caseId: string;
    formDefinitionId: string;
    partyId?: string | null;
  }) => Promise<{ ok: boolean; budgetWarning?: string | null; error?: { code: string } }>;
}

const STATUS_PILL: Record<string, { kind: StatusKind; label: string }> = {
  draft: { kind: "pendiente", label: "Borrador" },
  submitted: { kind: "revision", label: "Enviado · por revisar" },
  approved: { kind: "aprobado", label: "Aprobado" },
};

function missingPreview(details?: Record<string, unknown>): string {
  const raw = details?.missing;
  const labels = (Array.isArray(raw) ? raw : [])
    .map((m) => (typeof m === "string" ? m : ((m as { label?: unknown } | null)?.label as string | undefined)))
    .filter((x): x is string => !!x);
  return labels.slice(0, 3).join(", ") + (labels.length > 3 ? "…" : "");
}

function pdfErrorMessage(code: string, details?: Record<string, unknown>): string {
  if (code === "FORM_PDF_BLOCKED" && details?.reason === "requires_approval") return "Aprueba el formulario antes de generar el PDF.";
  if (code === "FORM_PDF_BLOCKED") return "El formulario aún no está listo para generar el PDF.";
  if (code === "FORM_PDF_REQUIRED_MISSING") return `Faltan campos obligatorios: ${missingPreview(details) || "revisa el formulario"}.`;
  if (code === "FORM_VALIDATION_FAILED") return "Faltan campos obligatorios por completar.";
  if (code === "FORM_VERSION_MISMATCH") return "La versión del formulario cambió; revisa las respuestas.";
  return "No se pudo generar el PDF. Inténtalo de nuevo.";
}

export function CaseFormsManager({
  items: initialItems,
  actions,
  caseId,
  reviewBasePath,
}: {
  items: CaseFormItemVM[];
  actions: CaseFormsActions;
  /** Required to launch ai_letter generations from this surface. */
  caseId?: string;
  /** When set (e.g. "/legal/caso/<id>/revisar"), shows a side-by-side "Revisar" link per form. */
  reviewBasePath?: string;
}) {
  const [items, setItems] = React.useState(initialItems);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pdfUrls, setPdfUrls] = React.useState<Record<string, string>>({});
  const [generated, setGenerated] = React.useState<Record<string, boolean>>({});

  async function generateLetter(it: CaseFormItemVM) {
    if (!actions.startGeneration || !caseId) return;
    setBusy(it.responseId);
    const r = await actions.startGeneration({
      caseId,
      formDefinitionId: it.formDefinitionId,
      partyId: it.partyId,
    });
    setBusy(null);
    if (r.ok) {
      setGenerated((m) => ({ ...m, [it.responseId]: true }));
      toast.success(
        r.budgetWarning === "over_100"
          ? "Carta en generación (presupuesto IA del mes superado)"
          : "Carta en generación — síguela en la pestaña Generaciones",
      );
    } else {
      const code = r.error?.code;
      toast.error(
        code === "AI_RUN_DUPLICATE"
          ? "Ya hay una generación en curso para esta carta."
          : code === "AI_CONFIG_NOT_FOUND"
            ? "Esta carta no tiene configuración de generación en el servicio."
            : "No se pudo iniciar la generación de la carta.",
      );
    }
  }

  async function approve(it: CaseFormItemVM) {
    setBusy(it.responseId);
    const r = await actions.approve({ responseId: it.responseId });
    setBusy(null);
    if (r.ok) {
      setItems((xs) => xs.map((x) => (x.responseId === it.responseId ? { ...x, status: "approved" } : x)));
      toast.success("Formulario aprobado");
    } else if (r.error?.code === "FORM_INCOMPLETE") {
      toast.error(`Faltan respuestas obligatorias: ${missingPreview(r.error.details) || "revisa el formulario"}.`);
    } else {
      toast.error(r.error?.code === "FORM_NOT_APPROVABLE" ? "Este formulario no puede aprobarse en su estado actual." : "No se pudo aprobar.");
    }
  }

  async function generate(it: CaseFormItemVM) {
    setBusy(it.responseId);
    const r = await actions.generatePdf({ responseId: it.responseId });
    setBusy(null);
    if (r.ok && r.downloadUrl) {
      setPdfUrls((m) => ({ ...m, [it.responseId]: r.downloadUrl! }));
      setItems((xs) => xs.map((x) => (x.responseId === it.responseId ? { ...x, hasPdf: true } : x)));
      toast.success("PDF generado");
      getBridge().share.openExternal(r.downloadUrl);
    } else {
      toast.error(pdfErrorMessage(r.error?.code ?? "UNEXPECTED", r.error?.details));
    }
  }

  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--ink-2)" }}>
        <Lex mood="calma" size={110} />
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginTop: 12 }}>Aún no hay formularios en este caso</h3>
        <p style={{ fontSize: 13.5, marginTop: 6 }}>Cuando el cliente complete y envíe un formulario, aparecerá aquí para revisión.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {items.map((it) => {
        const pill = STATUS_PILL[it.status] ?? { kind: "pendiente" as StatusKind, label: it.status };
        const isBusy = busy === it.responseId;
        const url = pdfUrls[it.responseId];
        const isLetter = it.kind === "ai_letter";
        const canGenerate = !isLetter && (it.status === "approved" || (it.status === "submitted" && it.filledBy !== "client"));
        const canGenerateLetter = isLetter && !!actions.startGeneration && !!caseId;
        return (
          <Card key={it.responseId}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", padding: 4 }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)" }}>{it.label}</span>
                  <Chip tone="blue">{it.kind === "pdf_automation" ? "PDF oficial" : "Carta IA"}</Chip>
                  {it.partyName && <Chip tone="blue">{it.partyName}</Chip>}
                </div>
                <div style={{ marginTop: 8 }}>
                  <StatusPill kind={pill.kind}>{pill.label}</StatusPill>
                </div>
                {it.status === "draft" && (
                  <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 8 }}>El cliente aún está completando este formulario.</p>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {reviewBasePath && it.kind !== "ai_letter" && (
                  <a
                    href={`${reviewBasePath}/${it.formDefinitionId}${
                      it.partyId
                        ? `?party=${it.partyId}${it.partyName ? `&name=${encodeURIComponent(it.partyName)}` : ""}`
                        : ""
                    }`}
                    style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", textDecoration: "none", border: "1px solid var(--line)", borderRadius: 999, padding: "6px 14px" }}
                  >
                    Revisar ⟷
                  </a>
                )}
                {it.status === "submitted" && (
                  <GradientBtn size="md" full={false} onClick={() => approve(it)} disabled={isBusy}>
                    {isBusy ? "Aprobando…" : "Aprobar"}
                  </GradientBtn>
                )}
                {canGenerate && (
                  <GhostBtn size="md" full={false} onClick={() => generate(it)} disabled={isBusy}>
                    {isBusy ? "Generando…" : it.hasPdf ? "Regenerar PDF" : "Generar PDF"}
                  </GhostBtn>
                )}
                {canGenerateLetter && (
                  <GhostBtn size="md" full={false} onClick={() => generateLetter(it)} disabled={isBusy}>
                    {isBusy ? "Iniciando…" : generated[it.responseId] ? "Regenerar carta" : "Generar carta"}
                  </GhostBtn>
                )}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", textDecoration: "none" }}>
                    Ver PDF ↗
                  </a>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
