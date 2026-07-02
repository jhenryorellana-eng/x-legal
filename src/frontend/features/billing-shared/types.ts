/**
 * billing-shared — Zelle proof verification/registration UI shared between the
 * Andrium finance surface (/finanzas/pagos/caso/[caseId]) and the shared-case
 * Pagos tab (admin / ventas / finance case workspace).
 *
 * Components are result-shape agnostic: callbacks return plain data (or null)
 * and the parent adapts its own action result shape + handles toasts/refresh.
 *
 * Boundaries: frontend feature — MUST NOT import from @/backend.
 */

export interface ZelleProofView {
  url: string;
  kind: "image" | "pdf";
}

/** Minimal payment info the verify panel needs (parent maps its own VM). */
export interface ZelleVerifyPayment {
  id: string;
  amountCents: number;
  /** ISO timestamp of when the proof was submitted. */
  createdAt: string;
  /** Pre-localized status label (e.g. "En curso" / "In progress"). */
  statusLabel: string;
}

/** Minimal installment info the register modal needs. */
export interface ZelleRegisterInstallment {
  id: string;
  amountCents: number;
}

// ---------------------------------------------------------------------------
// Strings (i18n via props: Andrium passes the ES defaults, shared-case passes
// next-intl messages so the tab renders in the staff member's locale)
// ---------------------------------------------------------------------------

export interface ZelleVerifyStrings {
  title: string;
  /** Subtitle prefix — rendered as `${zelleLabel} · $300.00`. */
  zelleLabel: string;
  amountLabel: string;
  methodLabel: string;
  statusLabel: string;
  uploadedLabel: string;
  guidance: string;
  proofLoading: string;
  proofLoadError: string;
  noProof: string;
  proofAlt: string;
  approveBtn: string;
  approving: string;
  rejectBtn: string;
  rejecting: string;
  backBtn: string;
  rejectReasonLabel: string;
  rejectReasonPlaceholder: string;
  rejectReasonHint: string;
  reasonRequiredToast: string;
}

export interface ZelleRegisterStrings {
  title: string;
  installmentAmountLabel: string;
  noPartialWarning: string;
  proofLabel: string;
  proofRequiredHint: string;
  chooseFileBtn: string;
  uploadFailedToast: string;
  notesLabel: string;
  notesPlaceholder: string;
  confirmBtn: string;
  registering: string;
  cancelBtn: string;
}

export const ZELLE_VERIFY_STRINGS_ES: ZelleVerifyStrings = {
  title: "Verificar comprobante",
  zelleLabel: "Pago Zelle",
  amountLabel: "Monto",
  methodLabel: "Método",
  statusLabel: "Estado",
  uploadedLabel: "Subido",
  guidance: "Verifica que el monto y la referencia del comprobante coincidan con los datos de la cuota.",
  proofLoading: "Cargando comprobante…",
  proofLoadError: "No se pudo cargar el comprobante",
  noProof: "Sin comprobante",
  proofAlt: "Comprobante de pago Zelle",
  approveBtn: "Aprobar pago",
  approving: "Aprobando…",
  rejectBtn: "Rechazar",
  rejecting: "Rechazando…",
  backBtn: "Atrás",
  rejectReasonLabel: "Motivo del rechazo (el cliente lo verá) *",
  rejectReasonPlaceholder: "Escribe el motivo para que el cliente corrija y vuelva a subir…",
  rejectReasonHint: "El cliente recibirá este motivo para corregir y volver a subir su comprobante.",
  reasonRequiredToast: "El motivo es obligatorio",
};

export const ZELLE_REGISTER_STRINGS_ES: ZelleRegisterStrings = {
  title: "Registrar Zelle",
  installmentAmountLabel: "Monto de la cuota",
  noPartialWarning: "Sin pagos parciales en V2. Si el monto difiere, no se podrá registrar.",
  proofLabel: "Comprobante de pago *",
  proofRequiredHint: "El comprobante es obligatorio (imagen o PDF).",
  chooseFileBtn: "Elegir archivo",
  uploadFailedToast: "No se pudo subir el comprobante. Intenta de nuevo.",
  notesLabel: "Notas (opcional)",
  notesPlaceholder: "Referencia, nombre del remitente…",
  confirmBtn: "Confirmar pago",
  registering: "Registrando…",
  cancelBtn: "Cancelar",
};

// ---------------------------------------------------------------------------
// Shared money formatter (matches the Andrium view)
// ---------------------------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

export const usd = (cents: number): string => USD.format(cents / 100);
