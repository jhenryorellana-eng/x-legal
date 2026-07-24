/**
 * Billing module — pure domain (state machines, buildInstallments).
 *
 * NO I/O. All functions are deterministic, testable with zero mocks.
 *
 * @module billing/domain
 */

// ---------------------------------------------------------------------------
// InstallmentStatus
// ---------------------------------------------------------------------------

export type InstallmentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "overdue"
  | "waived";

/**
 * Actor types allowed to trigger installment transitions (DOC-44 §2.2).
 * "reconciler" = the automatic Zelle reconciliation (bank-verified email →
 * atomic RPC). Deliberately separate from "system": widening "system" to
 * pending→paid would relax validation on every other system path.
 */
export type InstallmentTransitionActor =
  | "system"
  | "cron"
  | "finance"
  | "admin"
  | "reconciler";

/** States from which a payment (Stripe checkout or Zelle) can be initiated. */
export const PAYABLE_STATUSES: InstallmentStatus[] = ["pending", "overdue"];

// ---------------------------------------------------------------------------
// INSTALLMENT_TRANSITIONS (DOC-44 §2.2 — actor-aware matrix)
// ---------------------------------------------------------------------------

const INSTALLMENT_TRANSITIONS: Record<
  InstallmentStatus,
  Partial<Record<InstallmentStatus, InstallmentTransitionActor[]>>
> = {
  pending: {
    processing: ["system"],
    overdue:    ["cron"],
    paid:       ["finance", "admin", "reconciler"],
    waived:     ["finance", "admin"],
  },
  overdue: {
    processing: ["system"],
    paid:       ["finance", "admin", "reconciler"],
    waived:     ["finance", "admin"],
  },
  processing: {
    paid:    ["system", "finance"],
    pending: ["system"],
    overdue: ["system"],
  },
  paid: {
    pending: ["system"], // ONLY via charge.refunded (DOC-71 §3.2)
  },
  waived: {}, // terminal in V2.0
};

/**
 * Returns true if the transition from→to is allowed for the given actor.
 *
 * DOC-44 §2.2. New signature extends F2 canTransitionInstallment with actor.
 */
export function canTransitionInstallment(
  from: InstallmentStatus,
  to: InstallmentStatus,
  by: InstallmentTransitionActor = "system",
): boolean {
  return INSTALLMENT_TRANSITIONS[from]?.[to]?.includes(by) ?? false;
}

// ---------------------------------------------------------------------------
// PaymentFrequency — installment cadence (DOC-44 §2.1, extended 2026-07-03)
// ---------------------------------------------------------------------------

/** Cadence of the non-downpayment cuotas. Extensible to "biweekly" later. */
export type PaymentFrequency = "weekly" | "monthly";

/**
 * How weekly cuotas anchor to a weekday.
 *   - same-weekday: cuota k = anchor + 7k days (signs Thursday → Thursdays)
 *   - fixed-weekday: cuota k = k-th occurrence of `weekday` strictly after the
 *     anchor (0=Sunday .. 6=Saturday)
 */
export type WeeklyAnchorPolicy =
  | { kind: "same-weekday" }
  | { kind: "fixed-weekday"; weekday: number };

/** Business decision (Henry, 2026-07-03): weekly cuotas follow the signing weekday. */
export const DEFAULT_WEEKLY_ANCHOR: WeeklyAnchorPolicy = { kind: "same-weekday" };

/**
 * Due date of cuota k (k >= 1) for a plan anchored at `anchor` (YYYY-MM-DD).
 *
 * The single source of the schedule rule — buildInstallments and
 * reanchorDueDates both delegate here.
 */
export function installmentDueDate(
  anchor: string,
  k: number,
  frequency: PaymentFrequency,
  weeklyAnchor: WeeklyAnchorPolicy = DEFAULT_WEEKLY_ANCHOR,
): string {
  if (frequency === "monthly") {
    return addMonthsClamped(anchor, k);
  }
  if (weeklyAnchor.kind === "same-weekday") {
    return addDaysUTC(anchor, 7 * k);
  }
  // fixed-weekday: k-th occurrence of the weekday STRICTLY after the anchor
  // (anchor already on that weekday → first cuota lands a full week later).
  const anchorWeekday = new Date(`${anchor}T00:00:00Z`).getUTCDay();
  const daysToFirst = ((weeklyAnchor.weekday - anchorWeekday + 6) % 7) + 1;
  return addDaysUTC(anchor, daysToFirst + 7 * (k - 1));
}

/**
 * Adds `days` to an ISO date (YYYY-MM-DD) using pure UTC arithmetic
 * (no local-timezone/DST drift).
 */
export function addDaysUTC(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// buildInstallments — pure payment plan computation
// ---------------------------------------------------------------------------

/** A single installment draft (used in buildInstallments and reanchorDueDates). */
export interface InstallmentDraft {
  number: number;
  amountCents: number;
  dueDate: string; // ISO date YYYY-MM-DD
  isDownpayment: boolean;
}

// Keep the F2 alias for backward compatibility within the module.
export type InstallmentPlan = InstallmentDraft;

export interface BuildInstallmentsInput {
  /** Total amount in cents */
  totalCents: number;
  /** Downpayment amount in cents (first installment, MUST be > 0 per I2) */
  downpaymentCents: number;
  /** Total number of installments INCLUDING the downpayment */
  installmentCount: number;
  /** ISO date for the downpayment due date (anchor — usually the signing date) */
  startDate: string;
  /** Cadence of cuotas 1..N-1 (default "monthly" — pre-feature plans) */
  frequency?: PaymentFrequency;
  /** Weekly anchoring policy (default DEFAULT_WEEKLY_ANCHOR) */
  weeklyAnchor?: WeeklyAnchorPolicy;
}

/**
 * Builds an array of installment drafts for a payment plan.
 *
 * DOC-44 §2.1 invariants:
 *   I1. Σ amountCents === totalCents (exact)
 *   I2. downpaymentCents > 0 AND downpaymentCents <= totalCents
 *   I3. the downpayment is "Cuota inicial" (number=0); the monthly cuotas are
 *       numbered 1..(installmentCount-1) contiguous
 *   I4. dueDate non-decreasing with number
 *   I5. last installment absorbs rounding difference
 *   I6. exactly one is_downpayment=true (number=0)
 *
 * @throws Error on invariant violation (programming error, not user error)
 */
export function buildInstallments(input: BuildInstallmentsInput): InstallmentDraft[] {
  const {
    totalCents,
    downpaymentCents,
    installmentCount,
    startDate,
    frequency = "monthly",
    weeklyAnchor = DEFAULT_WEEKLY_ANCHOR,
  } = input;

  if (installmentCount < 1) {
    throw new Error("billing: installmentCount must be >= 1");
  }
  // I2: downpaymentCents must be > 0 (DOC-44 §2.1, SOT-2)
  if (downpaymentCents <= 0) {
    throw new Error("billing: downpaymentCents must be > 0 (I2)");
  }
  if (downpaymentCents > totalCents) {
    throw new Error("billing: downpaymentCents cannot exceed totalCents");
  }
  if (totalCents < 0) {
    throw new Error("billing: totalCents must be >= 0");
  }

  const plans: InstallmentDraft[] = [];

  // The downpayment is a SEPARATE "Cuota inicial" (number 0); the monthly cuotas
  // that follow are numbered 1, 2, … so the schedule reads inicial, 1, 2, …
  plans.push({
    number: 0,
    amountCents: downpaymentCents,
    dueDate: startDate,
    isDownpayment: true,
  });

  if (installmentCount === 1) {
    // Edge case: single installment covers everything (inicial === total).
    // Caller is responsible for setting downpaymentCents === totalCents.
    return plans;
  }

  const remainder = totalCents - downpaymentCents;
  const remainingCount = installmentCount - 1;
  const baseAmount = Math.floor(remainder / remainingCount);

  for (let i = 0; i < remainingCount; i++) {
    const number = i + 1; // monthly cuotas start at 1 (the inicial is number 0)
    const isLast = i === remainingCount - 1;
    // Last installment absorbs rounding (I6)
    const alreadyAllocated = baseAmount * i;
    const amountCents = isLast
      ? remainder - alreadyAllocated
      : baseAmount;

    const dueDate = installmentDueDate(startDate, i + 1, frequency, weeklyAnchor);

    plans.push({
      number,
      amountCents,
      dueDate,
      isDownpayment: false,
    });
  }

  return plans;
}

// ---------------------------------------------------------------------------
// reanchorDueDates — re-anchor installment dates to a new anchor (DOC-44 §2.1)
// ---------------------------------------------------------------------------

/**
 * Re-anchors installment due dates to a new local date anchor.
 *
 * DOC-44 §2.1 (SOT-3 rule):
 *   - Cuota inicial (downpayment, number 0): dueDate = anchor
 *   - Cuota k (k=1..N): dueDate = addMonthsClamped(anchor, k)
 *
 * Returns a new array; does NOT mutate the input.
 */
export function reanchorDueDates(
  installments: InstallmentDraft[],
  anchorLocalDate: string, // YYYY-MM-DD
  frequency: PaymentFrequency = "monthly",
  weeklyAnchor: WeeklyAnchorPolicy = DEFAULT_WEEKLY_ANCHOR,
): InstallmentDraft[] {
  return installments.map((inst) => ({
    ...inst,
    dueDate: inst.isDownpayment
      ? anchorLocalDate
      : installmentDueDate(anchorLocalDate, inst.number, frequency, weeklyAnchor),
  }));
}

// ---------------------------------------------------------------------------
// isOverdue / daysLate — pure morosidad helpers (DOC-44 §2.3)
// ---------------------------------------------------------------------------

/**
 * Returns true if the installment is past its due date and not yet paid/waived.
 * "today" is a YYYY-MM-DD local date in the org's timezone (caller's responsibility).
 */
export function isOverdue(
  inst: { status: string; due_date: string },
  today: string, // YYYY-MM-DD
): boolean {
  if (inst.status === "paid" || inst.status === "waived") return false;
  return inst.due_date < today;
}

/**
 * Returns number of calendar days past due. Returns 0 if not overdue.
 */
export function daysLate(
  inst: { due_date: string },
  today: string, // YYYY-MM-DD
): number {
  const due = new Date(inst.due_date);
  const now = new Date(today);
  const ms = now.getTime() - due.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Ledger (Contabilidad) — pure validation + month helpers (DOC-44 §3.11)
// ---------------------------------------------------------------------------

export type LedgerKind = "income" | "expense";

/**
 * Validates a manual ledger entry's amount + category.
 *
 * Returns the violating error code, or null if valid. Service maps the code to
 * a BillingError. Pure — no I/O.
 *   - amountCents must be a positive integer → LEDGER_AMOUNT_INVALID
 *   - category must be non-empty after trim → LEDGER_CATEGORY_REQUIRED
 */
export function validateLedgerEntry(input: {
  amountCents: number;
  category: string;
}): "LEDGER_AMOUNT_INVALID" | "LEDGER_CATEGORY_REQUIRED" | null {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return "LEDGER_AMOUNT_INVALID";
  }
  if (!input.category.trim()) {
    return "LEDGER_CATEGORY_REQUIRED";
  }
  return null;
}

/**
 * Returns the [start, end] ISO dates (inclusive) for a YYYY-MM month.
 * Example: monthRange("2026-06") → { start: "2026-06-01", end: "2026-06-30" }.
 */
export function monthRange(yearMonth: string): { start: string; end: string } {
  const [yStr, mStr] = yearMonth.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${yearMonth}-01`,
    end: `${yearMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Returns the previous YYYY-MM month. Example: "2026-01" → "2025-12". */
export function previousMonth(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  let year = parseInt(yStr, 10);
  let month = parseInt(mStr, 10) - 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// addMonthsClamped
// ---------------------------------------------------------------------------

/**
 * Adds `months` to an ISO date string (YYYY-MM-DD), clamping to the last
 * day of the resulting month if the original day exceeds it.
 *
 * Example: addMonthsClamped("2024-01-31", 1) → "2024-02-29" (2024 is leap)
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const targetMonth = month + months;
  const targetYear = year + Math.floor((targetMonth - 1) / 12);
  const normalizedMonth = ((targetMonth - 1) % 12) + 1;

  // Last day of the target month
  const lastDay = new Date(targetYear, normalizedMonth, 0).getDate();
  const clampedDay = Math.min(day, lastDay);

  const mm = String(normalizedMonth).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");
  return `${targetYear}-${mm}-${dd}`;
}
