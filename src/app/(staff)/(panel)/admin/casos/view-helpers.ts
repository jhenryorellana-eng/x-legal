/**
 * Pure presentation helpers for the admin casos list/detail (DOC-53 §2.2).
 * Server-safe (no client imports).
 */

import type { StatusKind } from "@/frontend/components/brand/status-pill";
import { resolveI18n, type Locale } from "@/shared/i18n";
import type { CaseRutaResult } from "@/backend/modules/scheduling";
import type { AccountStatementDto } from "@/backend/modules/billing";
import type {
  CaseRutaVM,
  InstallmentVM,
  PreMortemReportVM,
  PreMortemTargetVM,
  PreMortemSemaforo,
  PreMortemSeverity,
} from "@/frontend/features/shared-case";
import type { PreMortemAssessment, ValidableTarget } from "@/backend/modules/ai-engine";
import {
  FINDING_CATEGORIES_META,
  VERDICT_META,
  isFindingCategory,
  isVerdict,
} from "@/shared/constants/finding-categories";

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
 * Builds the Pre-Mortem tab selector entries from the backend's validable targets
 * (deduped to one per kind+form+party, newest artifact wins). The `key` doubles as
 * the deep-link id (`?tab=preMortem&target=<key>`).
 */
export function buildPreMortemTargets(
  targets: ValidableTarget[],
  locale: Locale,
): PreMortemTargetVM[] {
  const seen = new Set<string>();
  const out: PreMortemTargetVM[] = [];
  for (const t of targets) {
    const partyId = t.partyId ?? null;
    const key = `${t.kind}:${t.formDefinitionId}:${partyId ?? ""}`;
    if (seen.has(key)) continue; // input is newest-first → first wins
    seen.add(key);
    const label = resolveI18n(t.labelI18n as Parameters<typeof resolveI18n>[0], locale) || t.formDefinitionId;
    out.push({
      key,
      kind: t.kind,
      formDefinitionId: t.formDefinitionId,
      refId: t.runId ?? t.responseId ?? null,
      partyId,
      label,
      status: t.status ?? null,
    });
  }
  return out;
}

/**
 * Maps ai-engine Pre-Mortem assessments into the locale-resolved report VM. Each
 * report's `targetKey` is resolved via the artifact id (run/response) against the
 * current targets so the tab can show the history of the selected document; codes
 * (category, verdict) are localized.
 */
export function mapPreMortemReports(
  assessments: PreMortemAssessment[],
  targets: PreMortemTargetVM[],
  locale: Locale,
): PreMortemReportVM[] {
  const refToKey = new Map<string, string>();
  for (const t of targets) if (t.refId) refToKey.set(t.refId, t.key);

  return assessments.map((a) => {
    const refId = a.runId ?? a.responseId;
    const targetKey = (refId && refToKey.get(refId)) ?? `${a.targetKind}:${a.formDefinitionId}:`;
    return {
      id: a.id,
      targetKey,
      targetKind: a.targetKind,
      score: a.score,
      semaforo: a.semaforo as PreMortemSemaforo,
      approved: isVerdict(a.verdict) ? VERDICT_META[a.verdict].approved : false,
      verdictLabel: isVerdict(a.verdict) ? VERDICT_META[a.verdict].label[locale] : a.verdict,
      summary: a.summary,
      findings: a.findings.map((f) => ({
        severity: f.severity as PreMortemSeverity,
        category: isFindingCategory(f.category) ? FINDING_CATEGORIES_META[f.category].label[locale] : String(f.category),
        location: f.location,
        description: f.description,
        correction: f.correction,
      })),
      model: a.model,
      costUsd: a.costUsd,
      createdAt: a.createdAt,
    };
  });
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
