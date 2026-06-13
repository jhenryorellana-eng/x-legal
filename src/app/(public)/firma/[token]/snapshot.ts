/**
 * Contract snapshot shapes (DOC-30 §5: contracts.plan_snapshot / parties_snapshot).
 *
 * `createContract` stores arbitrary jsonb for plan_snapshot + parties_snapshot.
 * These shapes are the contract between the admin "Nuevo caso" writer and the
 * public signing reader. They are intentionally lenient (everything optional)
 * so a malformed snapshot degrades gracefully instead of 500-ing the page.
 */

export interface PlanSnapshotInstallment {
  number: number;
  amountCents: number;
  dueDate?: string | null;
  isDownpayment?: boolean;
}

export interface PlanSnapshot {
  serviceLabel?: { es?: string; en?: string } | string;
  planKind?: "self" | "with_lawyer";
  totalCents?: number;
  downpaymentCents?: number;
  installmentCount?: number;
  installments?: PlanSnapshotInstallment[];
  currency?: string;
}

export interface PartySnapshot {
  name: string;
  role?: { es?: string; en?: string } | string;
}

export interface PartiesSnapshot {
  parties?: PartySnapshot[];
}

/** Reads a possibly-i18n value with a locale fallback. */
export function readI18nLoose(
  value: { es?: string; en?: string } | string | undefined,
  locale: "es" | "en",
): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value[locale] ?? value.es ?? value.en ?? "";
}

export function asPlanSnapshot(raw: Record<string, unknown>): PlanSnapshot {
  return (raw ?? {}) as PlanSnapshot;
}

export function asPartiesSnapshot(raw: Record<string, unknown>): PartiesSnapshot {
  return (raw ?? {}) as PartiesSnapshot;
}
