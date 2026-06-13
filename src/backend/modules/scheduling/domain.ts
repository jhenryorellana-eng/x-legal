/**
 * Scheduling module — pure domain logic (no I/O).
 *
 * All functions here are deterministic given their inputs.
 * The service layer orchestrates I/O and calls into these functions.
 *
 * Key reference: DOC-23 §6.4 (materializeSlots — BINDING),
 *                DOC-43 §2 (state machine, policy, penalties).
 *
 * @module scheduling/domain
 */

import {
  toZonedTime,
  fromZonedTime,
  formatInTimeZone,
} from "date-fns-tz";
import { addDays } from "date-fns";

// ---------------------------------------------------------------------------
// Appointment state machine — DOC-43 §2.1
// ---------------------------------------------------------------------------

export type AppointmentStatus =
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show"
  | "rescheduled";

export type AppointmentActorKind = "client" | "staff";

const APPT_TRANSITIONS: Record<
  AppointmentStatus,
  Partial<Record<AppointmentStatus, AppointmentActorKind[]>>
> = {
  scheduled: {
    completed: ["staff"],
    cancelled: ["client", "staff"],
    no_show: ["staff"],
    rescheduled: ["client", "staff"],
  },
  completed: {},
  cancelled: {},
  no_show: {},
  rescheduled: {},
};

/**
 * Returns true when the transition (from → to) is allowed for the given actor.
 * All non-`scheduled` states are terminal; they accept no further transitions.
 */
export function canTransitionAppointment(
  from: AppointmentStatus,
  to: AppointmentStatus,
  by: AppointmentActorKind,
): boolean {
  return APPT_TRANSITIONS[from]?.[to]?.includes(by) ?? false;
}

// ---------------------------------------------------------------------------
// Temporal window helpers — DOC-43 §2.1 (pure UTC arithmetic)
// ---------------------------------------------------------------------------

/**
 * True when `nowUtc` is within the cancellation window before `startsAtUtc`.
 * i.e. now >= startsAt - windowHours*h  →  late cancellation penalty applies.
 */
export function isLateCancellation(
  nowUtc: Date,
  startsAtUtc: Date,
  windowHours: number,
): boolean {
  return nowUtc.getTime() >= startsAtUtc.getTime() - windowHours * 3_600_000;
}

/**
 * True when the client is still within the reschedule window (outside the
 * cancellation window). Clients can only reschedule if !isLateCancellation.
 */
export function canClientReschedule(
  nowUtc: Date,
  startsAtUtc: Date,
  windowHours: number,
): boolean {
  return !isLateCancellation(nowUtc, startsAtUtc, windowHours);
}

/**
 * True when the appointment start time has passed (or is right now).
 */
export function hasStarted(nowUtc: Date, startsAtUtc: Date): boolean {
  return nowUtc.getTime() >= startsAtUtc.getTime();
}

// ---------------------------------------------------------------------------
// Policy & quota — DOC-43 §2.2
// ---------------------------------------------------------------------------

export interface PhasePolicy {
  appointmentCount: number;
  durationMinutes: number;
  kind: "video" | "phone" | "presencial";
}

export interface CaseOverride {
  appointmentCount: number | null;
  durationMinutes: number | null;
}

/**
 * Resolves the effective appointment policy for a case/phase.
 * Precedence: case_override > phase_appointment_policies > hardcoded defaults.
 * The modalidad (kind) is NOT overrideable per case (DOC-30: case_overrides has no kind col).
 */
export function effectivePolicy(
  policy: PhasePolicy | null,
  override: CaseOverride | null,
): PhasePolicy {
  const base: PhasePolicy = policy ?? {
    appointmentCount: 1,
    durationMinutes: 30,
    kind: "video",
  };
  return {
    appointmentCount: override?.appointmentCount ?? base.appointmentCount,
    durationMinutes: override?.durationMinutes ?? base.durationMinutes,
    kind: base.kind,
  };
}

/**
 * How many appointments the client can still book in this phase.
 * consumed = statuses in ('scheduled','completed') — cancelled/rescheduled/no_show do NOT count.
 */
export function remainingAppointments(
  policy: PhasePolicy,
  consumedCount: number,
): number {
  return Math.max(policy.appointmentCount - consumedCount, 0);
}

/**
 * Returns the next sequence_number to assign ("Cita N de M").
 * Reagendamiento does NOT increment — the new appointment inherits the original's sequence.
 * existingSeqs is the list of sequence_numbers for non-cancelled appointments in the phase.
 */
export function nextSequenceNumber(
  existingSeqs: Array<number | null>,
): number {
  const max = existingSeqs.reduce<number>(
    (m, s) => (s != null && s > m ? s : m),
    0,
  );
  return max + 1;
}

// ---------------------------------------------------------------------------
// Rebooking penalty — DOC-43 §2.4
// ---------------------------------------------------------------------------

/**
 * Computes the new `rebooking_blocked_until` timestamp after a late cancel/no-show.
 * Rule: NEVER shortens an existing active block.
 */
export function computeRebookingBlockedUntil(
  nowUtc: Date,
  penaltyDays: number,
  current: Date | null,
): Date {
  const candidate = new Date(
    nowUtc.getTime() + penaltyDays * 86_400_000,
  );
  return current && current > candidate ? current : candidate;
}

/**
 * True when the rebooking block is still active for the client.
 */
export function isRebookingBlocked(
  nowUtc: Date,
  blockedUntil: Date | null,
): boolean {
  return blockedUntil != null && blockedUntil > nowUtc;
}

// ---------------------------------------------------------------------------
// Availability rule validation — DOC-43 §2.5
// ---------------------------------------------------------------------------

export interface AvailabilityRuleInput {
  weekday: number; // 0=Sunday … 6=Saturday (DOC-23 §6.4)
  startLocal: string; // 'HH:mm'
  endLocal: string; // 'HH:mm'; if <= startLocal → crosses midnight (DOC-23 §7.3)
}

export interface DomainIssue {
  code: string;
  detail?: unknown;
}

/** Converts 'HH:mm' to minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * True when the rule's end_local is before or equal to start_local,
 * meaning the availability window crosses midnight.
 * Convention: weekday = day of START. (DOC-23 §7.3)
 */
export function ruleSpansMidnight(r: AvailabilityRuleInput): boolean {
  return r.endLocal <= r.startLocal;
}

/**
 * Returns [startMinuteOfWeek, endMinuteOfWeek] for overlap detection.
 * A week = 7*1440 minutes. end wraps into the next weekday for midnight-crossers.
 * Comparison must be done modulo 7*1440 for Sunday→Monday wrap.
 */
export function ruleToMinuteRange(
  r: AvailabilityRuleInput,
): [number, number] {
  const start = r.weekday * 1440 + toMinutes(r.startLocal);
  const end = ruleSpansMidnight(r)
    ? (r.weekday + 1) * 1440 + toMinutes(r.endLocal)
    : r.weekday * 1440 + toMinutes(r.endLocal);
  return [start, end];
}

const WEEK_MINUTES = 7 * 1440;

/** True when ranges [a0,a1) and [b0,b1) overlap, modulo weekMinutes. */
function rangesOverlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): boolean {
  // Normalize to [0, WEEK_MINUTES) modulo so Sunday-crossers work correctly.
  const norm = (n: number) => ((n % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  const na0 = norm(a0);
  const na1 = norm(a1);
  const nb0 = norm(b0);
  const nb1 = norm(b1);

  // Handle cases where a range wraps around midnight of Sunday
  if (na0 < na1 && nb0 < nb1) return na0 < nb1 && na1 > nb0;
  if (na0 >= na1 && nb0 < nb1) return nb0 < na1 || nb1 > na0;
  if (na0 < na1 && nb0 >= nb1) return na0 < nb1 || na1 > nb0;
  // Both wrap
  return true;
}

/**
 * Validates a set of availability rules for a single staff member.
 * Returns an array of DomainIssue; empty means valid.
 *
 * Checks:
 *  1. Each rule: duration > 0 and < 24h (RF-VAN-032 A2, DOC-23 §7.3).
 *  2. No overlaps between any two rules (RF-VAN-032 A1).
 */
export function validateRuleSet(
  rules: AvailabilityRuleInput[],
): DomainIssue[] {
  const issues: DomainIssue[] = [];

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]!;
    const startMin = toMinutes(r.startLocal);
    const endMin = toMinutes(r.endLocal);
    const durationMin = ruleSpansMidnight(r)
      ? 1440 - startMin + endMin
      : endMin - startMin;

    if (durationMin <= 0 || durationMin >= 1440) {
      issues.push({
        code: "RULE_DURATION_INVALID",
        detail: { index: i, startLocal: r.startLocal, endLocal: r.endLocal },
      });
    }
  }

  // Only check overlaps if all durations are valid
  if (issues.length > 0) return issues;

  for (let i = 0; i < rules.length; i++) {
    const [a0, a1] = ruleToMinuteRange(rules[i]!);
    for (let j = i + 1; j < rules.length; j++) {
      const [b0, b1] = ruleToMinuteRange(rules[j]!);
      if (rangesOverlap(a0, a1, b0, b1)) {
        issues.push({
          code: "RULE_OVERLAP",
          detail: { indexA: i, indexB: j },
        });
      }
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Slot types
// ---------------------------------------------------------------------------

export interface Slot {
  startUtc: Date;
  endUtc: Date;
}

export interface AvailabilityRule {
  weekday: number;
  startLocal: string; // 'HH:mm'
  endLocal: string; // 'HH:mm'
  timezone: string; // IANA snapshot from availability_rules.timezone
  isActive: boolean;
}

export interface SchedulingSettings {
  minNoticeHours: number; // min_notice_hours
  maxAdvanceDays: number; // max_advance_days
  bufferMinutes: number; // buffer_minutes
  cancellationWindowHours: number; // cancellation_window_hours
  rebookingPenaltyDays: number; // rebooking_penalty_days
}

export interface MaterializeSlotsInput {
  rules: AvailabilityRule[];
  settings: SchedulingSettings;
  exceptions: Array<{ startsAt: Date; endsAt: Date }>;
  booked: Array<{ startsAt: Date; endsAt: Date }>;
  windowFromUtc: Date;
  windowToUtc: Date;
  durationMin: number;
  nowUtc: Date;
}

// ---------------------------------------------------------------------------
// materializeSlots — BINDING implementation of DOC-23 §6.4
// ---------------------------------------------------------------------------

/**
 * Materializes available appointment slots.
 *
 * This is the canonical implementation of DOC-23 §6.4 algorithm.
 * It is intentionally faithful to the pseudocode in the spec.
 *
 * Key behaviors:
 * - Iterates over CIVIL DAYS in the STAFF's timezone (not UTC, not client TZ).
 * - Converts start/end local times to UTC by concrete date, absorbing DST.
 * - Discards slots where the local→UTC round-trip fails (spring-forward gap).
 * - Ambiguous times (fall-back) use the FIRST occurrence (earlier UTC).
 * - Filters: exceptions overlap, booked+buffer overlap, min_notice, max_advance.
 * - Returns slots as UTC instants. The UI converts to each viewer's TZ.
 *
 * @api-id DOC-23 §6.4
 */
export function materializeSlots(input: MaterializeSlotsInput): Slot[] {
  const {
    rules,
    settings,
    exceptions,
    booked,
    windowFromUtc,
    windowToUtc,
    durationMin,
    nowUtc,
  } = input;

  // Step: clip the window by min_notice and max_advance (UTC arithmetic)
  const effectiveFrom = new Date(
    Math.max(
      windowFromUtc.getTime(),
      nowUtc.getTime() + settings.minNoticeHours * 3_600_000,
    ),
  );
  const effectiveTo = new Date(
    Math.min(
      windowToUtc.getTime(),
      nowUtc.getTime() + settings.maxAdvanceDays * 86_400_000,
    ),
  );

  if (effectiveFrom >= effectiveTo) return [];

  const slots: Slot[] = [];
  const durationMs = durationMin * 60_000;
  const bufferMs = settings.bufferMinutes * 60_000;

  for (const rule of rules) {
    if (!rule.isActive) continue;

    // Iterate over civil days in the RULE's timezone that overlap the window.
    // We go from the local date corresponding to effectiveFrom − 1 day to
    // local date corresponding to effectiveTo + 1 day (guard for DST shifts).
    const tz = rule.timezone;

    // First civil date in the rule's TZ that could produce slots inside the window.
    // We subtract 1 day of margin to handle DST and midnight-crossing rules.
    const localStart = toZonedTime(effectiveFrom, tz);
    const localEnd = toZonedTime(effectiveTo, tz);

    // Build the start of iteration: midnight of localStart day, minus 1 for safety
    const iterStartDate = new Date(localStart);
    iterStartDate.setHours(0, 0, 0, 0);
    const iterStart = addDays(iterStartDate, -1);

    // Build the end of iteration: midnight of localEnd day, plus 2 for safety
    const iterEndDate = new Date(localEnd);
    iterEndDate.setHours(0, 0, 0, 0);
    const iterEnd = addDays(iterEndDate, 2);

    // Walk civil days
    let current = new Date(iterStart);
    while (current < iterEnd) {
      // Check weekday in the rule's TZ
      const localDay = toZonedTime(current, tz);
      const weekday = localDay.getDay(); // 0=Sun...6=Sat

      if (weekday !== rule.weekday) {
        current = addDays(current, 1);
        continue;
      }

      // Build localDate string: 'YYYY-MM-DD' in the rule's TZ
      const localDateStr = formatInTimeZone(current, tz, "yyyy-MM-dd");

      // Step 2: compute start and end local datetimes → UTC (absorbs DST)
      const startLocalStr = `${localDateStr}T${rule.startLocal}:00`;
      let startUtc: Date;
      try {
        startUtc = fromZonedTime(startLocalStr, tz);
      } catch {
        current = addDays(current, 1);
        continue;
      }

      // Midnight-crossing: endLocal <= startLocal means end is on the next day
      const nextDateStr = formatInTimeZone(addDays(current, 1), tz, "yyyy-MM-dd");
      const spansMidnight = rule.endLocal <= rule.startLocal;
      const endLocalDateStr = spansMidnight ? nextDateStr : localDateStr;
      const endLocalStr = `${endLocalDateStr}T${rule.endLocal}:00`;
      let endUtc: Date;
      try {
        endUtc = fromZonedTime(endLocalStr, tz);
      } catch {
        current = addDays(current, 1);
        continue;
      }

      // Step 3: DST guard — spring-forward check (hour local inexistente)
      // If the local→UTC→local round-trip doesn't reproduce start_local,
      // the local time doesn't exist (gap). For start we find the next valid moment.
      const roundTrippedStart = formatInTimeZone(startUtc, tz, "HH:mm");
      if (roundTrippedStart !== rule.startLocal) {
        // The start_local falls in a DST gap (spring forward).
        // Advance startUtc to the next valid local moment past the gap.
        // M-8: This recovery assumes DST gaps are exactly 1h — which is valid
        // for all US/LatAm timezones this product targets (IANA zones where the
        // spring-forward offset change is always 60 minutes). If ever extended
        // to half-hour DST regions (e.g. Lord Howe Island) this must be revisited.
        const candidate = new Date(startUtc.getTime() + 3_600_000);
        const candidateLocal = formatInTimeZone(candidate, tz, "HH:mm");
        if (candidateLocal > rule.startLocal && candidate < endUtc) {
          startUtc = candidate;
        } else {
          // The entire window is in the gap or the window collapses — skip this day
          current = addDays(current, 1);
          continue;
        }
      }

      // Ambiguous times (fall-back): fromZonedTime by default returns the first
      // occurrence (earlier UTC) — which is the intended policy (DOC-23 §6.4).

      // Ensure the range has positive duration
      if (startUtc >= endUtc) {
        current = addDays(current, 1);
        continue;
      }

      // Step 4: slice into slots and filter
      let cursor = new Date(startUtc.getTime());
      while (cursor.getTime() + durationMs <= endUtc.getTime()) {
        const slotStart = cursor;
        const slotEnd = new Date(cursor.getTime() + durationMs);

        // Filter: slot must be within the effective window
        if (
          slotStart.getTime() >= effectiveFrom.getTime() &&
          slotEnd.getTime() <= effectiveTo.getTime()
        ) {
          // Filter: no overlap with exceptions (UTC blocks)
          const blockedByException = exceptions.some(
            (ex) =>
              slotStart.getTime() < ex.endsAt.getTime() &&
              slotEnd.getTime() > ex.startsAt.getTime(),
          );

          if (!blockedByException) {
            // Filter: expand slot with buffer and check against booked appointments
            const expandedStart = new Date(slotStart.getTime() - bufferMs);
            const expandedEnd = new Date(slotEnd.getTime() + bufferMs);
            const blockedByBooked = booked.some(
              (b) =>
                expandedStart.getTime() < b.endsAt.getTime() &&
                expandedEnd.getTime() > b.startsAt.getTime(),
            );

            if (!blockedByBooked) {
              slots.push({ startUtc: slotStart, endUtc: slotEnd });
            }
          }
        }

        // Advance by slot duration + buffer
        cursor = new Date(cursor.getTime() + durationMs + bufferMs);
      }

      current = addDays(current, 1);
    }
  }

  // Deduplicate (same start+end from overlapping rule coverage) and sort
  const seen = new Set<string>();
  const unique: Slot[] = [];
  for (const s of slots) {
    const key = `${s.startUtc.getTime()}:${s.endUtc.getTime()}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(s);
    }
  }
  unique.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  return unique;
}

/**
 * Validates that a requested slot is a member of the materialized set.
 * Used at booking time to guard against race conditions (DOC-43 §2.3).
 */
export function isSlotInSet(slot: Slot, slots: Slot[]): boolean {
  return slots.some(
    (s) =>
      s.startUtc.getTime() === slot.startUtc.getTime() &&
      s.endUtc.getTime() === slot.endUtc.getTime(),
  );
}
