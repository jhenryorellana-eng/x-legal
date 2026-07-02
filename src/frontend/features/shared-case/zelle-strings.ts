/**
 * Builders that adapt the staff.casos.detail i18n namespace to the string
 * contracts of the billing-shared Zelle components (verify panel + register
 * modal). Shared by the Pagos and Resumen tabs.
 */

import type {
  ZelleVerifyStrings,
  ZelleRegisterStrings,
} from "@/frontend/features/billing-shared";
import type { CasosStrings } from "./strings";

export function buildZelleVerifyStrings(t: CasosStrings["detail"]): ZelleVerifyStrings {
  return {
    title: t.zelleVerifyTitle,
    zelleLabel: t.zellePayLabel,
    amountLabel: t.zelleAmountLabel,
    methodLabel: t.zelleMethodLabel,
    statusLabel: t.zelleStatusLabel,
    uploadedLabel: t.zelleUploadedLabel,
    guidance: t.zelleGuidance,
    proofLoading: t.zelleProofLoading,
    proofLoadError: t.zelleProofLoadError,
    noProof: t.zelleNoProof,
    proofAlt: t.zelleProofAlt,
    approveBtn: t.zelleApproveBtn,
    approving: t.zelleApproving,
    rejectBtn: t.zelleRejectBtn,
    rejecting: t.zelleRejecting,
    backBtn: t.zelleBackBtn,
    rejectReasonLabel: t.zelleRejectReasonLabel,
    rejectReasonPlaceholder: t.zelleRejectReasonPlaceholder,
    rejectReasonHint: t.zelleRejectReasonHint,
    reasonRequiredToast: t.zelleReasonRequired,
  };
}

export function buildZelleRegisterStrings(t: CasosStrings["detail"]): ZelleRegisterStrings {
  return {
    title: t.zelleRegisterTitle,
    installmentAmountLabel: t.zelleInstallmentAmount,
    noPartialWarning: t.zelleNoPartialWarning,
    proofLabel: t.zelleProofFieldLabel,
    proofRequiredHint: t.zelleProofRequiredHint,
    chooseFileBtn: t.zelleChooseFile,
    uploadFailedToast: t.zelleUploadFailed,
    notesLabel: t.zelleNotesLabel,
    notesPlaceholder: t.zelleNotesPlaceholder,
    confirmBtn: t.zelleConfirmBtn,
    registering: t.registering,
    cancelBtn: t.zelleCancelBtn,
  };
}
