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

// ---------------------------------------------------------------------------
// INSTALLMENT_TRANSITIONS
// ---------------------------------------------------------------------------

const INSTALLMENT_TRANSITIONS: Map<InstallmentStatus, InstallmentStatus[]> = new Map([
  ["pending",    ["processing", "paid", "waived", "overdue"]],
  ["processing", ["paid", "pending"]],   // can revert processing on failure
  ["overdue",    ["paid", "waived"]],
  // "paid" and "waived" are terminal
]);

/**
 * Returns null if the transition is valid, error string otherwise.
 */
export function canTransitionInstallment(
  from: InstallmentStatus,
  to: InstallmentStatus,
): null | "INSTALLMENT_INVALID_TRANSITION" {
  const allowed = INSTALLMENT_TRANSITIONS.get(from) ?? [];
  return allowed.includes(to) ? null : "INSTALLMENT_INVALID_TRANSITION";
}

// ---------------------------------------------------------------------------
// buildInstallments — pure payment plan computation
// ---------------------------------------------------------------------------

export interface InstallmentPlan {
  number: number;
  amountCents: number;
  dueDate: string;   // ISO date string YYYY-MM-DD
  isDownpayment: boolean;
}

export interface BuildInstallmentsInput {
  /** Total amount in cents */
  totalCents: number;
  /** Downpayment amount in cents (first installment) */
  downpaymentCents: number;
  /** Total number of installments INCLUDING the downpayment */
  installmentCount: number;
  /** ISO date for the downpayment due date (usually today or contract date) */
  startDate: string;
}

/**
 * Builds an array of installment objects for a payment plan.
 *
 * Rules (DOC-44 §3.1):
 *   I1. Sum of all installments === totalCents
 *   I2. installmentCount >= 1
 *   I3. downpaymentCents <= totalCents
 *   I4. When installmentCount === 1, entire amount is the downpayment
 *   I5. Remaining instalments share floor(remainder / (N-1)) each
 *   I6. The LAST installment absorbs any rounding difference
 *
 * @throws Error on invariant violation (programming error, not user error)
 */
export function buildInstallments(input: BuildInstallmentsInput): InstallmentPlan[] {
  const { totalCents, downpaymentCents, installmentCount, startDate } = input;

  if (installmentCount < 1) {
    throw new Error("billing: installmentCount must be >= 1");
  }
  if (downpaymentCents < 0) {
    throw new Error("billing: downpaymentCents must be >= 0");
  }
  if (downpaymentCents > totalCents) {
    throw new Error("billing: downpaymentCents cannot exceed totalCents");
  }
  if (totalCents < 0) {
    throw new Error("billing: totalCents must be >= 0");
  }

  const plans: InstallmentPlan[] = [];

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
