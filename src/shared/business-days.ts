/**
 * Business-day arithmetic over civil dates (yyyy-MM-dd), holiday-aware.
 *
 * Pure and timezone-agnostic: every function operates on `yyyy-MM-dd` civil-date
 * strings and takes the set of non-working "holiday" dates as an INJECTED
 * argument (a Set of yyyy-MM-dd) — it never touches the DB or a clock. The caller
 * resolves civil dates + holidays in the office timezone (see the scheduling
 * module's `listOrgNonWorkingDays`) and passes them in.
 *
 * A "non-working day" is a Saturday, a Sunday, or a date present in `holidays`.
 * Weekends are always excluded regardless of the holiday set.
 *
 * Lives in `src/shared` so the wizard calculator (frontend), the case SLA engine
 * (backend) and their unit tests import ONE implementation, matching the
 * UTC-anchored civil-date carrier convention already used by `period.ts`.
 *
 * Used by:
 *  - Feature A (Calificación): `businessDaysUntil(today, deadline)` powers the
 *    "faltan N días hábiles → no aceptar" acceptance guard.
 *  - Feature B (SLA dinámico de Diana): `addBusinessDays` (the max-days cap) and
 *    `subtractBusinessDays` (the −1 mail buffer) bound the deadline-anchored due
 *    date of the legal stage.
 */

const DAY_MS = 86_400_000;

/** UTC-anchored carrier for a civil date — neutral arithmetic, DST-safe (mirrors period.ts). */
function civil(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Read back yyyy-MM-dd from a UTC-anchored carrier. */
function ymdOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Step a civil date by `n` calendar days. */
function shiftYmd(ymd: string, n: number): string {
  return ymdOf(new Date(civil(ymd).getTime() + n * DAY_MS));
}

/** A cheap yyyy-MM-dd shape guard so malformed input fails loudly, not silently. */
function assertYmd(ymd: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error(`business-days: expected a yyyy-MM-dd civil date, got "${ymd}"`);
  }
}

export type Holidays = ReadonlySet<string>;

/** Saturday/Sunday (UTC-anchored carrier) or a date in the holiday set. */
export function isNonWorkingDay(ymd: string, holidays: Holidays = new Set()): boolean {
  assertYmd(ymd);
  const dow = civil(ymd).getUTCDay(); // 0=Sun … 6=Sat
  return dow === 0 || dow === 6 || holidays.has(ymd);
}

/** Convenience negation for readability at call sites. */
export function isBusinessDay(ymd: string, holidays: Holidays = new Set()): boolean {
  return !isNonWorkingDay(ymd, holidays);
}

/**
 * Number of business days in the half-open interval `(from, to]`.
 *
 * Semantics (Henry, 2026-07-22): `from` (today) is EXCLUDED — it is already under
 * way — and `to` (the deadline day) is INCLUDED when it is a business day. So it
 * answers "how many business days of runway remain until the deadline". Returns 0
 * when `to <= from` (deadline today or already passed). This is what the
 * Calificación guard compares against `min_business_days_to_accept` (default 3):
 * *"solo aceptamos con 3 días hábiles de anticipación a que venza"*.
 */
export function businessDaysUntil(fromYmd: string, toYmd: string, holidays: Holidays = new Set()): number {
  assertYmd(fromYmd);
  assertYmd(toYmd);
  if (toYmd <= fromYmd) return 0;
  let count = 0;
  let cursor = shiftYmd(fromYmd, 1); // start the day AFTER today
  while (cursor <= toYmd) {
    if (isBusinessDay(cursor, holidays)) count += 1;
    cursor = shiftYmd(cursor, 1);
  }
  return count;
}

/**
 * The civil date that is `n` business days AFTER `from`, skipping weekends/holidays.
 * `n = 0` returns `from` unchanged. Used for Diana's max-days cap (entered + tope).
 */
export function addBusinessDays(fromYmd: string, n: number, holidays: Holidays = new Set()): string {
  assertYmd(fromYmd);
  if (n <= 0) return fromYmd;
  let cursor = fromYmd;
  let remaining = n;
  while (remaining > 0) {
    cursor = shiftYmd(cursor, 1);
    if (isBusinessDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

/**
 * The civil date that is `n` business days BEFORE `from`, skipping weekends/holidays.
 * `n = 0` returns `from` unchanged. Used for the −1 business-day mail buffer of the
 * legal stage (the expediente must be shipped before the deadline).
 */
export function subtractBusinessDays(fromYmd: string, n: number, holidays: Holidays = new Set()): string {
  assertYmd(fromYmd);
  if (n <= 0) return fromYmd;
  let cursor = fromYmd;
  let remaining = n;
  while (remaining > 0) {
    cursor = shiftYmd(cursor, -1);
    if (isBusinessDay(cursor, holidays)) remaining -= 1;
  }
  return cursor;
}

/** Add `n` CALENDAR days to a civil date (the 30-day legal deadline is calendar, not business). */
export function addCalendarDays(fromYmd: string, n: number): string {
  assertYmd(fromYmd);
  return shiftYmd(fromYmd, n);
}
