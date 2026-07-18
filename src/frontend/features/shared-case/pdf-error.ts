/**
 * Shared mapper: form-response action error → human message. One source of
 * truth for the "Actualizar PDF" / "Generar PDF" / "Verificar" failure toasts —
 * the review screen used to show the APPROVE error copy for a PDF failure,
 * hiding the real cause (missing required fields) from Diana.
 *
 * Structural strings contract (subset of CasosStrings.detail — the review
 * screen's own strings bundle satisfies it too). Client-safe: no i18n JSON
 * imports here (a local interp keeps the bundle clean).
 */

export interface FormActionError {
  code: string;
  details?: Record<string, unknown>;
}

export interface PdfErrorStrings {
  toastPdfError: string;
  toastPdfBlockedApproval: string;
  /** "Faltan {count} campos obligatorios: {fields}" */
  pdfErrRequiredMissing: string;
  pdfErrVersionMismatch: string;
  pdfErrValidation: string;
}

export interface VerifyErrorStrings {
  /** "Faltan {count} respuestas obligatorias: {fields}" */
  toastVerifyIncomplete: string;
  toastVerifyError: string;
}

function interpVars(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

/** First N missing-field labels, comma-joined ("Item 5 date, Signature…"). */
function missingFieldsPreview(
  details: Record<string, unknown> | undefined,
  max = 3,
): { count: number; fields: string } {
  const raw = details?.["missing"];
  const list = Array.isArray(raw) ? raw : [];
  const labels = list
    .map((m) => {
      if (typeof m === "string") return m;
      const label = (m as { label?: unknown } | null)?.label;
      return typeof label === "string" ? label : null;
    })
    .filter((x): x is string => !!x);
  const count =
    typeof details?.["count"] === "number" ? (details["count"] as number) : labels.length || list.length;
  const shown = labels.slice(0, max).join(", ");
  return { count, fields: shown + (labels.length > max ? "…" : "") };
}

/** Message for a failed PDF generate/update. */
export function pdfErrorMessage(err: FormActionError | undefined, t: PdfErrorStrings): string {
  switch (err?.code) {
    case "FORM_PDF_REQUIRED_MISSING": {
      const { count, fields } = missingFieldsPreview(err.details);
      return interpVars(t.pdfErrRequiredMissing, { count: String(count || "?"), fields: fields || "—" });
    }
    case "FORM_PDF_BLOCKED":
      return err.details?.["reason"] === "requires_approval" ? t.toastPdfBlockedApproval : t.toastPdfError;
    case "FORM_VERSION_MISMATCH":
      return t.pdfErrVersionMismatch;
    case "FORM_VALIDATION_FAILED":
      return t.pdfErrValidation;
    default:
      return t.toastPdfError;
  }
}

/** Message for a failed verify/approve (FORM_INCOMPLETE carries the missing list). */
export function approveErrorMessage(err: FormActionError | undefined, t: VerifyErrorStrings): string {
  if (err?.code === "FORM_INCOMPLETE") {
    const { count, fields } = missingFieldsPreview(err.details);
    return interpVars(t.toastVerifyIncomplete, { count: String(count || "?"), fields: fields || "—" });
  }
  return t.toastVerifyError;
}
