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

/** Actor types allowed to trigger installment transitions (DOC-44 §2.2). */
export type InstallmentTransitionActor = "system" | "cron" | "finance" | "admin";

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
    paid:       ["finance", "admin"],
    waived:     ["finance", "admin"],
  },
  overdue: {
    processing: ["system"],
    paid:       ["finance", "admin"],
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
}

/**
 * Builds an array of installment drafts for a payment plan.
 *
 * DOC-44 §2.1 invariants:
 *   I1. Σ amountCents === totalCents (exact)
 *   I2. downpaymentCents > 0 AND downpaymentCents <= totalCents
 *   I3. numbers 1..N contiguous
 *   I4. dueDate non-decreasing with number
 *   I5. last installment absorbs rounding difference
 *   I6. exactly one is_downpayment=true (number=1)
 *
 * @throws Error on invariant violation (programming error, not user error)
 */
export function buildInstallments(input: BuildInstallmentsInput): InstallmentDraft[] {
  const { totalCents, downpaymentCents, installmentCount, startDate } = input;

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

  // First installment: the downpayment
  plans.push({
    number: 1,
    amountCents: downpaymentCents,
    dueDate: startDate,
    isDownpayment: true,
  });

  if (installmentCount === 1) {
    // Edge case: single installment covers everything.
    // Caller is responsible for setting downpaymentCents === totalCents.
    return plans;
  }

  const remainder = totalCents - downpaymentCents;
  const remainingCount = installmentCount - 1;
  const baseAmount = Math.floor(remainder / remainingCount);

  for (let i = 0; i < remainingCount; i++) {
    const number = i + 2; // installment numbers start at 1; #1 is downpayment
    const isLast = i === remainingCount - 1;
    // Last installment absorbs rounding (I6)
    const alreadyAllocated = baseAmount * i;
    const amountCents = isLast
      ? remainder - alreadyAllocated
      : baseAmount;

    const dueDate = addMonthsClamped(startDate, i + 1);

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
 *   - Cuota 1 (downpayment): dueDate = anchor
 *   - Cuota k (k=2..N): dueDate = addMonthsClamped(anchor, k-1)
 *
 * Returns a new array; does NOT mutate the input.
 */
export function reanchorDueDates(
  installments: InstallmentDraft[],
  anchorLocalDate: string, // YYYY-MM-DD
): InstallmentDraft[] {
  return installments.map((inst) => ({
    ...inst,
    dueDate: inst.isDownpayment
      ? anchorLocalDate
      : addMonthsClamped(anchorLocalDate, inst.number - 1),
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
