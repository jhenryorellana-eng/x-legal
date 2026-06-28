/**
 * Timezone-aware period ranges for dashboard date filters (hoy/semana/mes/custom).
 *
 * Every boundary is a LOCAL calendar midnight in the org timezone (default
 * America/New_York) converted to a UTC instant via `fromZonedTime`. This keeps
 * the ranges DST-correct (local midnight is 04:00Z in EDT, 05:00Z in EST) and
 * independent of the host machine's timezone — the calendar arithmetic runs on
 * a UTC-anchored carrier and only the final boundary strings are zoned.
 *
 * Replaces the naïve rolling-7d `periodRange` in kanban/service.ts (no "today",
 * no timezone, off-by-DST). Lives in `src/shared` so backend, the page RSCs and
 * the client-side DateRangeFilter can all import it without crossing boundaries.
 */
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type Period = "today" | "week" | "month" | "custom";

export interface PeriodRange {
  /** Inclusive start (UTC instant). */
  from: Date;
  /** Exclusive end (UTC instant). */
  to: Date;
  /** Inclusive start of the immediately-preceding comparison window. */
  prevFrom: Date;
  /** Exclusive end of the preceding window (equals `from` for non-custom). */
  prevTo: Date;
}

export interface ResolveOptions {
  /** Inclusive ISO date (yyyy-MM-dd) for custom periods. */
  from?: string;
  /** Inclusive ISO date (yyyy-MM-dd) for custom periods. */
  to?: string;
  /** IANA timezone; defaults to the org timezone. */
  tz?: string;
  /** Reference instant ("now"); injectable for tests. */
  now?: Date;
}

export const DEFAULT_TZ = "America/New_York";

const DAY_MS = 86_400_000;

/** Build a UTC-anchored carrier for a local calendar date (neutral arithmetic). */
function civil(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Read back the yyyy-MM-dd from a UTC-anchored carrier. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(ymdStr: string, n: number): string {
  return ymd(new Date(civil(ymdStr).getTime() + n * DAY_MS));
}

function startOfWeekMonday(ymdStr: string): string {
  const d = civil(ymdStr);
  const back = (d.getUTCDay() + 6) % 7; // Mon=0, Sun=6
  return addDays(ymdStr, -back);
}

function startOfMonth(ymdStr: string): string {
  return `${ymdStr.slice(0, 7)}-01`;
}

function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = firstOfMonth.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return ymd(d);
}

/** Number of whole days between two local calendar dates. */
function dayDiff(fromYmd: string, toYmd: string): number {
  return Math.round((civil(toYmd).getTime() - civil(fromYmd).getTime()) / DAY_MS);
}

/**
 * Resolves a {from, to, prevFrom, prevTo} UTC range for the given period.
 *
 * `to` is exclusive (next-day/next-block midnight) so SQL uses `>= from AND < to`.
 */
export function resolvePeriodRange(period: Period, opts: ResolveOptions = {}): PeriodRange {
  const tz = opts.tz ?? DEFAULT_TZ;
  const now = opts.now ?? new Date();
  const today = formatInTimeZone(now, tz, "yyyy-MM-dd");

  let fromYmd: string;
  let toYmd: string;
  let prevFromYmd: string;
  let prevToYmd: string;

  switch (period) {
    case "today": {
      fromYmd = today;
      toYmd = addDays(today, 1);
      prevFromYmd = addDays(today, -1);
      prevToYmd = today;
      break;
    }
    case "week": {
      fromYmd = startOfWeekMonday(today);
      toYmd = addDays(fromYmd, 7);
      prevFromYmd = addDays(fromYmd, -7);
      prevToYmd = fromYmd;
      break;
    }
    case "month": {
      fromYmd = startOfMonth(today);
      toYmd = addMonths(fromYmd, 1);
      prevFromYmd = addMonths(fromYmd, -1);
      prevToYmd = fromYmd;
      break;
    }
    case "custom": {
      const start = opts.from ?? today;
      const endInclusive = opts.to ?? start;
      fromYmd = start;
      toYmd = addDays(endInclusive, 1); // make end inclusive
      const width = dayDiff(fromYmd, toYmd);
      prevToYmd = fromYmd;
      prevFromYmd = addDays(fromYmd, -width);
      break;
    }
  }

  const zoned = (d: string) => fromZonedTime(`${d}T00:00:00`, tz);
  return {
    from: zoned(fromYmd),
    to: zoned(toYmd),
    prevFrom: zoned(prevFromYmd),
    prevTo: zoned(prevToYmd),
  };
}
