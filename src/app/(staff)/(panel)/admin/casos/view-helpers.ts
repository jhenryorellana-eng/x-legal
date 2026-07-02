/**
 * Pure presentation helpers for the admin casos list/detail (DOC-53 §2.2).
 * Server-safe (no client imports).
 */

import type { StatusKind } from "@/frontend/components/brand/status-pill";
import { resolveI18n, type Locale } from "@/shared/i18n";
import type { CaseRutaResult } from "@/backend/modules/scheduling";
import type { AccountStatementDto } from "@/backend/modules/billing";
import type { CaseRutaVM, InstallmentVM, PreMortemAssessmentVM } from "@/frontend/features/shared-case";
import type { PreMortemAssessment } from "@/backend/modules/ai-engine";
import { DENIAL_REASONS, isDenialReasonCode } from "@/shared/constants/denial-reasons";

/**
 * Maps the billing account statement into the shared-case InstallmentVM list
 * (Pagos tab). Payments ride along so the tab can surface a pending Zelle
 * proof ("Comprobante por verificar" → verify panel). Single mapper shared by
 * the admin / ventas / legal case pages.
 */
export function mapStatementInstallments(
  statement: AccountStatementDto | null,
): InstallmentVM[] {
  return (statement?.installments ?? []).map((i) => ({
    id: i.id,
    number: i.number,
    amountCents: i.amountCents,
    status: i.status,
    isDownpayment: i.isDownpayment,
    dueDate: i.dueDate,
    payments: i.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amountCents: p.amountCents,
      createdAt: p.createdAt,
    })),
  }));
}

/** Maps a cases.status to its StatusPill kind (DOC-53 §2.2). "amber" → Chip. */
export function mapStatusToPill(status: string): { kind: StatusKind | "amber" } {
  switch (status) {
    case "payment_pending":
      return { kind: "pendiente" };
    case "active":
      return { kind: "aprobado" };
    case "in_validation":
      return { kind: "revision" };
    case "ready_for_delivery":
      return { kind: "pendiente" };
    case "delivered":
      return { kind: "hecho" };
    case "completed":
      return { kind: "hecho" };
    case "cancelled":
      return { kind: "corregir" };
    case "on_hold":
      return { kind: "amber" };
    default:
      return { kind: "pendiente" };
  }
}

/**
 * Maps the scheduling getCaseRuta result into the locale-resolved CaseRutaVM the
 * "Ruta de citas" tab renders. Keeps both locales on each objective (textI18n) so
 * the "Añadir cita" modal can pre-fill unmet objectives in es/en.
 */
export function buildRutaVM(ruta: CaseRutaResult | null, locale: Locale): CaseRutaVM | null {
  if (!ruta) return null;
  return {
    phaseLabel: ruta.phaseLabelI18n ? resolveI18n(ruta.phaseLabelI18n, locale) || null : null,
    total: ruta.total,
    currentSequence: ruta.currentSequence,
    citas: ruta.citas.map((c) => ({
      number: c.number,
      sequenceNumber: c.sequenceNumber,
      label: c.labelI18n ? resolveI18n(c.labelI18n, locale) || null : null,
      kind: c.kind,
      status: c.status,
      origin: c.origin,
      objectives: c.objectives.map((o) => ({
        id: o.id,
        text: resolveI18n(o.text, locale),
        textI18n: { es: resolveI18n(o.text, "es"), en: resolveI18n(o.text, "en") },
        achieved: o.achieved,
      })),
      appointment: c.appointment,
    })),
  };
}

/**
 * Maps ai-engine Pre-Mortem assessments into the locale-resolved VM the
 * "Pre-Mortem" tab renders. Resolves each denial-reason code to its label via
 * the taxonomy (DENIAL_REASONS) for the active locale.
 */
export function buildPreMortemVM(
  assessments: PreMortemAssessment[],
  locale: Locale,
): PreMortemAssessmentVM[] {
  return assessments.map((a) => ({
    id: a.id,
    overallRisk: a.overallRisk,
    summary: a.summary,
    reasons: a.reasons.map((r) => ({
      code: r.code,
      label: isDenialReasonCode(r.code) ? DENIAL_REASONS[r.code].label[locale] : r.code,
      probability: r.probability,
      rationale: r.rationale,
      correction: r.correction,
    })),
    model: a.model,
    costUsd: a.costUsd,
    createdAt: a.createdAt,
  }));
}

/** Coarse relative time ("hace 4 meses" / "4 months ago"). */
export function relTime(iso: string, locale: "es" | "en"): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffDays = Math.floor((Date.now() - then) / 86_400_000);
  const en = locale === "en";
  if (diffDays <= 0) return en ? "today" : "hoy";
  if (diffDays === 1) return en ? "yesterday" : "ayer";
  if (diffDays < 30) return en ? `${diffDays} days ago` : `hace ${diffDays} días`;
  const months = Math.floor(diffDays / 30);
  if (months < 12)
    return en
      ? `${months} month${months > 1 ? "s" : ""} ago`
      : `hace ${months} ${months > 1 ? "meses" : "mes"}`;
  const years = Math.floor(months / 12);
  return en ? `${years} year${years > 1 ? "s" : ""} ago` : `hace ${years} año${years > 1 ? "s" : ""}`;
}
