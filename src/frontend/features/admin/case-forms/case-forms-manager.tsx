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
  partyName: string | null;
  hasPdf: boolean;
  submittedAt: string | null;
}

export interface CaseFormsActions {
  approve: (input: { responseId: string }) => Promise<{ ok: boolean; error?: { code: string } }>;
  generatePdf: (input: { responseId: string }) => Promise<{ ok: boolean; downloadUrl?: string; error?: { code: string; details?: Record<string, unknown> } }>;
}

const STATUS_PILL: Record<string, { kind: StatusKind; label: string }> = {
  draft: { kind: "pendiente", label: "Borrador" },
  submitted: { kind: "revision", label: "Enviado · por revisar" },
  approved: { kind: "aprobado", label: "Aprobado" },
};

function pdfErrorMessage(code: string, details?: Record<string, unknown>): string {
  if (code === "FORM_PDF_BLOCKED" && details?.reason === "requires_approval") return "Aprueba el formulario antes de generar el PDF.";
  if (code === "FORM_PDF_BLOCKED") return "El formulario aún no está listo para generar el PDF.";
  if (code === "FORM_VALIDATION_FAILED") return "Faltan campos obligatorios por completar.";
  if (code === "FORM_VERSION_MISMATCH") return "La versión del formulario cambió; revisa las respuestas.";
  return "No se pudo generar el PDF. Inténtalo de nuevo.";
}

export function CaseFormsManager({
  items: initialItems,
  actions,
}: {
  items: CaseFormItemVM[];
  actions: CaseFormsActions;
}) {
  const [items, setItems] = React.useState(initialItems);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [pdfUrls, setPdfUrls] = React.useState<Record<string, string>>({});

  async function approve(it: CaseFormItemVM) {
    setBusy(it.responseId);
    const r = await actions.approve({ responseId: it.responseId });
    setBusy(null);
    if (r.ok) {
      setItems((xs) => xs.map((x) => (x.responseId === it.responseId ? { ...x, status: "approved" } : x)));
      toast.success("Formulario aprobado");
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
        const canGenerate = it.status === "approved" || (it.status === "submitted" && it.filledBy !== "client");
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
