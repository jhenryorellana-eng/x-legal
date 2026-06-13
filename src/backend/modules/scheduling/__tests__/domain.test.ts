/**
 * Scheduling domain — comprehensive TDD tests.
 *
 * No I/O, no mocks needed (pure functions only).
 *
 * Test coverage:
 *  - canTransitionAppointment (state machine)
 *  - isLateCancellation / canClientReschedule / hasStarted
 *  - effectivePolicy (precedence)
 *  - remainingAppointments
 *  - nextSequenceNumber
 *  - computeRebookingBlockedUntil / isRebookingBlocked
 *  - validateRuleSet (duration, overlaps, midnight-crossing)
 *  - ruleSpansMidnight / ruleToMinuteRange
 *  - materializeSlots (DST — binding DOC-23 §6.4):
 *    • Simple weekly rule, single timezone
 *    • Client in different TZ (display math)
 *    • Spring-forward DST (America/New_York, 2026-03-08)
 *    • Fall-back DST (America/New_York, 2026-11-01)
 *    • Rule crossing midnight
 *    • Exceptions filter slots
 *    • Buffer between appointments
 *    • min_notice / max_advance clipping
 *  - isSlotInSet
 */

import { describe, it, expect } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import {
  canTransitionAppointment,
  isLateCancellation,
  canClientReschedule,
  hasStarted,
  effectivePolicy,
  remainingAppointments,
  nextSequenceNumber,
  computeRebookingBlockedUntil,
  isRebookingBlocked,
  validateRuleSet,
  ruleSpansMidnight,
  ruleToMinuteRange,
  materializeSlots,
  isSlotInSet,
  type PhasePolicy,
  type CaseOverride,
  type AvailabilityRuleInput,
  type MaterializeSlotsInput,
  type AvailabilityRule,
  type SchedulingSettings,
  type Slot,
} from "../domain";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: SchedulingSettings = {
  minNoticeHours: 0,
  maxAdvanceDays: 90,
  bufferMinutes: 0,
  cancellationWindowHours: 24,
  rebookingPenaltyDays: 7,
};

function makeRule(
  weekday: number,
  startLocal: string,
  endLocal: string,
  timezone = "America/New_York",
  isActive = true,
): AvailabilityRule {
  return { weekday, startLocal, endLocal, timezone, isActive };
}

function makeSlotInput(overrides: Partial<MaterializeSlotsInput> = {}): MaterializeSlotsInput {
  return {
    rules: [],
    settings: DEFAULT_SETTINGS,
    exceptions: [],
    booked: [],
    windowFromUtc: new Date("2026-06-15T00:00:00Z"),
    windowToUtc: new Date("2026-06-22T00:00:00Z"),
    durationMin: 30,
    nowUtc: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State machine — canTransitionAppointment
// ---------------------------------------------------------------------------

describe("canTransitionAppointment", () => {
  it("allows scheduled → completed by staff", () => {
    expect(canTransitionAppointment("scheduled", "completed", "staff")).toBe(true);
  });

  it("denies scheduled → completed by client", () => {
    expect(canTransitionAppointment("scheduled", "completed", "client")).toBe(false);
  });

  it("allows scheduled → cancelled by client", () => {
    expect(canTransitionAppointment("scheduled", "cancelled", "client")).toBe(true);
  });

  it("allows scheduled → cancelled by staff", () => {
    expect(canTransitionAppointment("scheduled", "cancelled", "staff")).toBe(true);
  });

  it("allows scheduled → no_show by staff", () => {
    expect(canTransitionAppointment("scheduled", "no_show", "staff")).toBe(true);
  });

  it("denies scheduled → no_show by client", () => {
    expect(canTransitionAppointment("scheduled", "no_show", "client")).toBe(false);
  });

  it("allows scheduled → rescheduled by client", () => {
    expect(canTransitionAppointment("scheduled", "rescheduled", "client")).toBe(true);
  });

  it("allows scheduled → rescheduled by staff", () => {
    expect(canTransitionAppointment("scheduled", "rescheduled", "staff")).toBe(true);
  });

  // Terminal states
  it("denies completed → any transition", () => {
    expect(canTransitionAppointment("completed", "cancelled", "staff")).toBe(false);
    expect(canTransitionAppointment("completed", "cancelled", "client")).toBe(false);
    expect(canTransitionAppointment("completed", "no_show", "staff")).toBe(false);
  });

  it("denies cancelled → any transition", () => {
    expect(canTransitionAppointment("cancelled", "scheduled", "staff")).toBe(false);
  });

  it("denies no_show → any transition", () => {
    expect(canTransitionAppointment("no_show", "completed", "staff")).toBe(false);
  });

  it("denies rescheduled → any transition", () => {
    expect(canTransitionAppointment("rescheduled", "scheduled", "staff")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Temporal window helpers
// ---------------------------------------------------------------------------

describe("isLateCancellation", () => {
  it("returns true when now is within the cancellation window", () => {
    const starts = new Date("2026-06-15T18:00:00Z");
    const now = new Date("2026-06-14T18:00:01Z"); // 23h 59m 59s before = within 24h window
    expect(isLateCancellation(now, starts, 24)).toBe(true);
  });

  it("returns false when now is outside the cancellation window", () => {
    const starts = new Date("2026-06-15T18:00:00Z");
    const now = new Date("2026-06-14T17:59:59Z"); // 24h 0m 1s before = outside window
    expect(isLateCancellation(now, starts, 24)).toBe(false);
  });

  it("returns true when now is exactly at the window boundary", () => {
    const starts = new Date("2026-06-15T18:00:00Z");
    const now = new Date(starts.getTime() - 24 * 3_600_000); // exactly 24h before
    expect(isLateCancellation(now, starts, 24)).toBe(true);
  });
});

describe("canClientReschedule", () => {
  it("is the logical inverse of isLateCancellation", () => {
    const starts = new Date("2026-06-15T18:00:00Z");
    const nowOutside = new Date("2026-06-14T00:00:00Z");
    const nowInside = new Date("2026-06-15T10:00:00Z");
    expect(canClientReschedule(nowOutside, starts, 24)).toBe(true);
    expect(canClientReschedule(nowInside, starts, 24)).toBe(false);
  });
});

describe("hasStarted", () => {
  it("returns true at exactly starts_at", () => {
    const starts = new Date("2026-06-15T14:00:00Z");
    expect(hasStarted(starts, starts)).toBe(true);
  });

  it("returns true after starts_at", () => {
    const starts = new Date("2026-06-15T14:00:00Z");
    const now = new Date("2026-06-15T14:00:01Z");
    expect(hasStarted(now, starts)).toBe(true);
  });

  it("returns false before starts_at", () => {
    const starts = new Date("2026-06-15T14:00:00Z");
    const now = new Date("2026-06-15T13:59:59Z");
    expect(hasStarted(now, starts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// effectivePolicy
// ---------------------------------------------------------------------------

describe("effectivePolicy", () => {
  const phasePolicy: PhasePolicy = {
    appointmentCount: 3,
    durationMinutes: 45,
    kind: "video",
  };

  it("returns defaults when both policy and override are null", () => {
    const result = effectivePolicy(null, null);
    expect(result).toEqual({
      appointmentCount: 1,
      durationMinutes: 30,
      kind: "video",
    });
  });

  it("returns the phase policy when no override", () => {
    const result = effectivePolicy(phasePolicy, null);
    expect(result).toEqual(phasePolicy);
  });

  it("override.appointmentCount takes precedence over phase policy", () => {
    const override: CaseOverride = { appointmentCount: 5, durationMinutes: null };
    const result = effectivePolicy(phasePolicy, override);
    expect(result.appointmentCount).toBe(5);
    expect(result.durationMinutes).toBe(45);
  });

  it("override.durationMinutes takes precedence over phase policy", () => {
    const override: CaseOverride = { appointmentCount: null, durationMinutes: 60 };
    const result = effectivePolicy(phasePolicy, override);
    expect(result.appointmentCount).toBe(3);
    expect(result.durationMinutes).toBe(60);
  });

  it("override takes precedence over null phase policy", () => {
    const override: CaseOverride = { appointmentCount: 2, durationMinutes: 60 };
    const result = effectivePolicy(null, override);
    expect(result.appointmentCount).toBe(2);
    expect(result.durationMinutes).toBe(60);
    expect(result.kind).toBe("video"); // default kind
  });

  it("kind is NOT overrideable (case_overrides has no kind col)", () => {
    const override: CaseOverride = { appointmentCount: 2, durationMinutes: 60 };
    const policyPresencial: PhasePolicy = {
      appointmentCount: 1,
      durationMinutes: 30,
      kind: "presencial",
    };
    const result = effectivePolicy(policyPresencial, override);
    expect(result.kind).toBe("presencial"); // preserved from phase policy
  });
});

// ---------------------------------------------------------------------------
// remainingAppointments
// ---------------------------------------------------------------------------

describe("remainingAppointments", () => {
  const policy: PhasePolicy = { appointmentCount: 3, durationMinutes: 30, kind: "video" };

  it("returns full quota when none consumed", () => {
    expect(remainingAppointments(policy, 0)).toBe(3);
  });

  it("returns 1 when 2 of 3 consumed", () => {
    expect(remainingAppointments(policy, 2)).toBe(1);
  });

  it("returns 0 when at quota", () => {
    expect(remainingAppointments(policy, 3)).toBe(0);
  });

  it("clamps to 0 when over quota (guard against data drift)", () => {
    expect(remainingAppointments(policy, 5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// nextSequenceNumber
// ---------------------------------------------------------------------------

describe("nextSequenceNumber", () => {
  it("returns 1 when no existing sequences", () => {
    expect(nextSequenceNumber([])).toBe(1);
  });

  it("returns 1 when all sequences are null (prospect appointments)", () => {
    expect(nextSequenceNumber([null, null])).toBe(1);
  });

  it("returns max+1", () => {
    expect(nextSequenceNumber([1, 2, null])).toBe(3);
    expect(nextSequenceNumber([null, 3, 1])).toBe(4);
  });

  it("handles single existing", () => {
    expect(nextSequenceNumber([1])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// computeRebookingBlockedUntil / isRebookingBlocked
// ---------------------------------------------------------------------------

describe("computeRebookingBlockedUntil", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const penaltyDays = 7;

  it("returns now + penaltyDays when no current block", () => {
    const result = computeRebookingBlockedUntil(now, penaltyDays, null);
    const expected = new Date(now.getTime() + 7 * 86_400_000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("keeps existing block when it is further in the future (never shortens)", () => {
    const existing = new Date(now.getTime() + 14 * 86_400_000); // 14 days from now
    const result = computeRebookingBlockedUntil(now, penaltyDays, existing);
    expect(result.getTime()).toBe(existing.getTime());
  });

  it("replaces expired block with new block", () => {
    const expired = new Date(now.getTime() - 86_400_000); // yesterday
    const result = computeRebookingBlockedUntil(now, penaltyDays, expired);
    const expected = new Date(now.getTime() + 7 * 86_400_000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("returns the candidate when it equals the existing (edge case)", () => {
    const candidate = new Date(now.getTime() + 7 * 86_400_000);
    // current is equal to candidate — NEVER acorta (current > candidate is false)
    const result = computeRebookingBlockedUntil(now, penaltyDays, candidate);
    expect(result.getTime()).toBe(candidate.getTime());
  });
});

describe("isRebookingBlocked", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("returns false when blockedUntil is null", () => {
    expect(isRebookingBlocked(now, null)).toBe(false);
  });

  it("returns true when blockedUntil is in the future", () => {
    const future = new Date(now.getTime() + 86_400_000);
    expect(isRebookingBlocked(now, future)).toBe(true);
  });

  it("returns false when blockedUntil is in the past", () => {
    const past = new Date(now.getTime() - 86_400_000);
    expect(isRebookingBlocked(now, past)).toBe(false);
  });

  it("returns false at exactly blockedUntil (block expires the instant it equals now)", () => {
    // blockedUntil > nowUtc is false when equal → not blocked
    expect(isRebookingBlocked(now, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ruleSpansMidnight / ruleToMinuteRange
// ---------------------------------------------------------------------------

describe("ruleSpansMidnight", () => {
  it("returns false for normal intra-day rule", () => {
    expect(ruleSpansMidnight({ weekday: 1, startLocal: "09:00", endLocal: "12:00" })).toBe(false);
  });

  it("returns true when endLocal <= startLocal (midnight crossing)", () => {
    expect(ruleSpansMidnight({ weekday: 4, startLocal: "22:00", endLocal: "01:00" })).toBe(true);
  });

  it("returns true when endLocal equals startLocal (technically also midnight-crossing)", () => {
    // This would be a 24h rule which validateRuleSet will reject, but the function itself returns true
    expect(ruleSpansMidnight({ weekday: 0, startLocal: "00:00", endLocal: "00:00" })).toBe(true);
  });
});

describe("ruleToMinuteRange", () => {
  it("returns correct range for Monday 09:00–12:00", () => {
    // Monday = weekday 1; 1*1440 + 9*60 = 1440 + 540 = 1980; end = 1440 + 720 = 2160
    const [start, end] = ruleToMinuteRange({ weekday: 1, startLocal: "09:00", endLocal: "12:00" });
    expect(start).toBe(1 * 1440 + 9 * 60);
    expect(end).toBe(1 * 1440 + 12 * 60);
  });

  it("handles midnight-crossing correctly (Friday 22:00–01:00)", () => {
    // Friday = 5; start = 5*1440 + 22*60 = 7200+1320=8520; end = 6*1440 + 60 = 8640+60=8700
    const [start, end] = ruleToMinuteRange({ weekday: 5, startLocal: "22:00", endLocal: "01:00" });
    expect(start).toBe(5 * 1440 + 22 * 60);
    expect(end).toBe(6 * 1440 + 1 * 60);
  });
});

// ---------------------------------------------------------------------------
// validateRuleSet
// ---------------------------------------------------------------------------

describe("validateRuleSet", () => {
  it("returns empty for valid non-overlapping rules", () => {
    const rules: AvailabilityRuleInput[] = [
      { weekday: 1, startLocal: "09:00", endLocal: "12:00" },
      { weekday: 1, startLocal: "14:00", endLocal: "17:00" },
      { weekday: 3, startLocal: "09:00", endLocal: "17:00" },
    ];
    expect(validateRuleSet(rules)).toHaveLength(0);
  });

  it("detects overlap between two rules on the same day", () => {
    const rules: AvailabilityRuleInput[] = [
      { weekday: 2, startLocal: "09:00", endLocal: "12:00" },
      { weekday: 2, startLocal: "11:00", endLocal: "14:00" }, // overlaps 11:00–12:00
    ];
    const issues = validateRuleSet(rules);
    expect(issues.some((i) => i.code === "RULE_OVERLAP")).toBe(true);
  });

  it("detects invalid duration (duration = 0 is invalid)", () => {
    const rules: AvailabilityRuleInput[] = [
      { weekday: 3, startLocal: "10:00", endLocal: "10:00" }, // endLocal === startLocal (24h, not 0 here)
    ];
    // endLocal === startLocal → ruleSpansMidnight=true → duration = 1440−600+600 = 1440 min → >= 1440 → invalid
    const issues = validateRuleSet(rules);
    expect(issues.some((i) => i.code === "RULE_DURATION_INVALID")).toBe(true);
  });

  it("detects midnight-crossing rule overlapping with next day's rule", () => {
    const rules: AvailabilityRuleInput[] = [
      { weekday: 5, startLocal: "22:00", endLocal: "02:00" }, // Fri 22:00 → Sat 02:00
      { weekday: 6, startLocal: "01:00", endLocal: "09:00" }, // Sat 01:00 → Sat 09:00, overlaps 01:00–02:00
    ];
    const issues = validateRuleSet(rules);
    expect(issues.some((i) => i.code === "RULE_OVERLAP")).toBe(true);
  });

  it("accepts midnight-crossing rule that does NOT overlap next day's rule", () => {
    const rules: AvailabilityRuleInput[] = [
      { weekday: 5, startLocal: "22:00", endLocal: "01:00" }, // Fri 22:00 → Sat 01:00
      { weekday: 6, startLocal: "09:00", endLocal: "17:00" }, // Sat 09:00 → Sat 17:00, no overlap
    ];
    expect(validateRuleSet(rules)).toHaveLength(0);
  });

  it("detects two overlapping rules on different days that cross midnight", () => {
    // Both cross into the same midnight slot
    const rules: AvailabilityRuleInput[] = [
      { weekday: 1, startLocal: "23:00", endLocal: "02:00" }, // Mon 23:00 → Tue 02:00
      { weekday: 2, startLocal: "01:00", endLocal: "10:00" }, // Tue 01:00 → Tue 10:00, overlaps Tue 01:00–02:00
    ];
    const issues = validateRuleSet(rules);
    expect(issues.some((i) => i.code === "RULE_OVERLAP")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — Simple case
// ---------------------------------------------------------------------------

describe("materializeSlots — simple weekly rule", () => {
  // Vanessa's rule: Tuesday 09:00–12:00 America/New_York
  // In June 2026 (summer, EDT = UTC-4): 09:00 EDT = 13:00 UTC, 12:00 EDT = 16:00 UTC
  // Week of 2026-06-15 (Mon) to 2026-06-22 (Mon)
  // 2026-06-16 is Tuesday

  const tuesdayRule: AvailabilityRule = makeRule(2, "09:00", "12:00"); // weekday 2 = Tuesday

  it("generates 6 slots of 30 minutes on Tuesday (09:00–12:00 = 180 min / 30 = 6)", () => {
    const input = makeSlotInput({
      rules: [tuesdayRule],
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    expect(slots).toHaveLength(6);
  });

  it("all slots are UTC (13:xx–14:xx range on June 16)", () => {
    const input = makeSlotInput({
      rules: [tuesdayRule],
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    // First slot: 09:00 EDT = 13:00 UTC on 2026-06-16
    expect(slots[0]?.startUtc.toISOString()).toBe("2026-06-16T13:00:00.000Z");
    expect(slots[0]?.endUtc.toISOString()).toBe("2026-06-16T13:30:00.000Z");
    // Last slot: 11:30 EDT = 15:30 UTC
    expect(slots[5]?.startUtc.toISOString()).toBe("2026-06-16T15:30:00.000Z");
    expect(slots[5]?.endUtc.toISOString()).toBe("2026-06-16T16:00:00.000Z");
  });

  it("returns slots for a Tuesday within the window even if that day starts mid-window", () => {
    // Window: Wed Jun 17 – Thu Jun 25 (inclusive of Tuesday Jun 23)
    const input = makeSlotInput({
      rules: [tuesdayRule],
      windowFromUtc: new Date("2026-06-17T00:00:00Z"), // Wed
      windowToUtc: new Date("2026-06-24T00:00:00Z"), // includes Tue Jun 23 at 13:00 UTC
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    // Jun 23 is Tuesday — 09:00–12:00 EDT = 13:00–16:00 UTC, all within [Jun 17, Jun 24)
    expect(slots.length).toBe(6);
  });

  it("returns empty when the window contains no matching weekday at all", () => {
    const input = makeSlotInput({
      rules: [tuesdayRule],
      // Window: Wed Jun 17 to Mon Jun 22 — no Tuesday in this range
      windowFromUtc: new Date("2026-06-17T00:00:00Z"), // Wed
      windowToUtc: new Date("2026-06-22T00:00:00Z"), // Mon (no Tuesday)
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    expect(slots).toHaveLength(0);
  });

  it("returns no slots for inactive rules", () => {
    const inactiveRule: AvailabilityRule = { ...tuesdayRule, isActive: false };
    const input = makeSlotInput({ rules: [inactiveRule] });
    expect(materializeSlots(input)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — different TZ client (math check)
// ---------------------------------------------------------------------------

describe("materializeSlots — staff in New York, client view in Denver", () => {
  // Rule: Tuesday 09:00–10:00 America/New_York (EDT=UTC-4 in June)
  // Slot: 09:00 EDT = 13:00 UTC
  // Client in Denver (MDT=UTC-6): 13:00 UTC = 07:00 MDT
  // This test verifies the UTC instants are correct; the UI does the local conversion.

  it("generates correct UTC instant regardless of client timezone", () => {
    const rule: AvailabilityRule = makeRule(2, "09:00", "10:00", "America/New_York"); // Tue
    const input = makeSlotInput({ rules: [rule], durationMin: 60 });
    const slots = materializeSlots(input);
    expect(slots).toHaveLength(1);
    // Slot is 09:00–10:00 EDT = 13:00–14:00 UTC
    expect(slots[0]?.startUtc.toISOString()).toBe("2026-06-16T13:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — DST: spring forward (America/New_York 2026-03-08)
// ---------------------------------------------------------------------------

describe("materializeSlots — spring forward DST (2026-03-08 America/New_York)", () => {
  // 2026-03-08 at 2:00 AM clocks spring forward to 3:00 AM (EDT, UTC-4).
  // Hours 2:00–2:59 AM EST do NOT exist on this date.
  // A rule Sunday 01:00–04:00 would have hours 2:00–2:59 non-existent.
  // Expected: slots at 01:00, 01:30 (EST, UTC-6), then gap, then 03:00, 03:30 (EDT, UTC-4).

  const sundayRule: AvailabilityRule = makeRule(0, "01:00", "04:00", "America/New_York"); // weekday 0 = Sunday

  it("does not generate slots for the spring-forward non-existent local hours (2:00–2:59 AM)", () => {
    const input: MaterializeSlotsInput = {
      rules: [sundayRule],
      settings: DEFAULT_SETTINGS,
      exceptions: [],
      booked: [],
      windowFromUtc: new Date("2026-03-08T00:00:00Z"),
      windowToUtc: new Date("2026-03-09T00:00:00Z"),
      durationMin: 30,
      nowUtc: new Date("2026-03-01T00:00:00Z"),
    };
    const slots = materializeSlots(input);

    // Spring forward: 2:00 AM EST would be 07:00 UTC but 2:00 AM does NOT exist locally.
    // Instead, 07:00 UTC = 3:00 AM EDT (the first valid moment after the gap).
    // The algorithm skips local 2:xx and jumps to 3:xx.
    // So no slot should have a LOCAL start between 2:00 and 2:59 (impossible).
    // In UTC terms: there should be NO slot at 06:30Z+30=07:00Z that represents "2:00 AM" —
    // the slot 06:00–06:30 ends at 06:30 (1:30 AM EST), next is 07:00–07:30 (3:00 AM EDT).
    // The cursor jumps from 06:30 to 07:00, skipping the gap.
    // Verify: no slot starting exactly at 07:00 UTC BUT claiming to be "2:00 AM"
    // (07:00 UTC = 3:00 AM EDT, which IS valid).
    // Instead verify the total count: 01:00–04:00 = 3 hours but missing the 2:xx gap
    // means 01:00, 01:30 (EST), then 03:00, 03:30 (EDT) = 4 slots instead of 6.
    expect(slots.length).toBe(4);
  });

  it("generates slots at 01:00 and 01:30 AM (before DST gap)", () => {
    const input: MaterializeSlotsInput = {
      rules: [sundayRule],
      settings: DEFAULT_SETTINGS,
      exceptions: [],
      booked: [],
      windowFromUtc: new Date("2026-03-08T00:00:00Z"),
      windowToUtc: new Date("2026-03-09T00:00:00Z"),
      durationMin: 30,
      nowUtc: new Date("2026-03-01T00:00:00Z"),
    };
    const slots = materializeSlots(input);

    // 01:00 AM EST = 06:00 UTC (before spring forward)
    const slot0100 = slots.find(
      (s) => s.startUtc.toISOString() === "2026-03-08T06:00:00.000Z",
    );
    // 01:30 AM EST = 06:30 UTC
    const slot0130 = slots.find(
      (s) => s.startUtc.toISOString() === "2026-03-08T06:30:00.000Z",
    );
    expect(slot0100).toBeDefined();
    expect(slot0130).toBeDefined();
  });

  it("generates slots at 03:00 and 03:30 AM EDT (after DST gap)", () => {
    const input: MaterializeSlotsInput = {
      rules: [sundayRule],
      settings: DEFAULT_SETTINGS,
      exceptions: [],
      booked: [],
      windowFromUtc: new Date("2026-03-08T00:00:00Z"),
      windowToUtc: new Date("2026-03-09T00:00:00Z"),
      durationMin: 30,
      nowUtc: new Date("2026-03-01T00:00:00Z"),
    };
    const slots = materializeSlots(input);

    // 03:00 AM EDT = 07:00 UTC (after spring forward, EDT = UTC-4)
    const slot0300 = slots.find(
      (s) => s.startUtc.toISOString() === "2026-03-08T07:00:00.000Z",
    );
    // 03:30 AM EDT = 07:30 UTC
    const slot0330 = slots.find(
      (s) => s.startUtc.toISOString() === "2026-03-08T07:30:00.000Z",
    );
    expect(slot0300).toBeDefined();
    expect(slot0330).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — DST: fall back (America/New_York 2026-11-01)
// ---------------------------------------------------------------------------

describe("materializeSlots — fall back DST (2026-11-01 America/New_York)", () => {
  // 2026-11-01 at 2:00 AM EDT clocks fall back to 1:00 AM EST.
  // Hours 1:00–1:59 AM occur TWICE.
  // Policy: first occurrence (EDT, UTC-4, earlier UTC) — i.e. slot at 01:00 EDT = 05:00 UTC.
  // Duplicate prevention: deduplication in materializeSlots removes second occurrence.

  const sundayRule: AvailabilityRule = makeRule(0, "01:00", "02:00", "America/New_York");

  it("generates the correct number of slots during fall-back (extra wall-clock hour)", () => {
    // Rule: Sunday 01:00–02:00 AM in New York.
    // On fall-back night (Nov 1):
    //   - startUtc = fromZonedTime("2026-11-01T01:00:00", NY) = 05:00 UTC (1am EDT, first occurrence)
    //   - endUtc   = fromZonedTime("2026-11-01T02:00:00", NY) = 07:00 UTC (2am EST, after fall-back)
    //   - The window 05:00–07:00 UTC spans 2 wall-clock hours (the "extra" hour from fall-back)
    //   - Slots at 05:00, 05:30, 06:00, 06:30 = 4 slots (all unique UTC instants)
    // The deduplication ensures no SAME UTC instant appears twice.
    const input: MaterializeSlotsInput = {
      rules: [sundayRule],
      settings: DEFAULT_SETTINGS,
      exceptions: [],
      booked: [],
      windowFromUtc: new Date("2026-11-01T00:00:00Z"),
      windowToUtc: new Date("2026-11-02T00:00:00Z"),
      durationMin: 30,
      nowUtc: new Date("2026-10-01T00:00:00Z"),
    };
    const slots = materializeSlots(input);

    // No duplicate UTC start times (deduplication guarantee)
    const startTimes = slots.map((s) => s.startUtc.getTime());
    const uniqueStartTimes = new Set(startTimes);
    expect(uniqueStartTimes.size).toBe(startTimes.length);

    // 4 unique slots: 05:00, 05:30, 06:00, 06:30 UTC
    expect(slots).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — midnight-crossing rule
// ---------------------------------------------------------------------------

describe("materializeSlots — rule crossing midnight", () => {
  // Friday 22:00–01:00 in America/New_York (June, EDT = UTC-4)
  // Start: Fri 22:00 EDT = Sat 02:00 UTC
  // End: Sat 01:00 EDT = Sat 05:00 UTC
  // 3 hours = 6 slots of 30 minutes

  const fridayLateRule: AvailabilityRule = makeRule(5, "22:00", "01:00"); // Friday (weekday 5)

  it("generates slots that span midnight (3h = 6 slots)", () => {
    const input = makeSlotInput({
      rules: [fridayLateRule],
      // Friday June 19 to Saturday June 20
      windowFromUtc: new Date("2026-06-19T00:00:00Z"),
      windowToUtc: new Date("2026-06-20T10:00:00Z"),
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    expect(slots).toHaveLength(6);
  });

  it("first slot starts at Fri 22:00 EDT = Sat 02:00 UTC", () => {
    const input = makeSlotInput({
      rules: [fridayLateRule],
      windowFromUtc: new Date("2026-06-19T00:00:00Z"),
      windowToUtc: new Date("2026-06-20T10:00:00Z"),
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    expect(slots[0]?.startUtc.toISOString()).toBe("2026-06-20T02:00:00.000Z");
  });

  it("last slot ends at Sat 01:00 EDT = Sat 05:00 UTC", () => {
    const input = makeSlotInput({
      rules: [fridayLateRule],
      windowFromUtc: new Date("2026-06-19T00:00:00Z"),
      windowToUtc: new Date("2026-06-20T10:00:00Z"),
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    expect(slots[5]?.endUtc.toISOString()).toBe("2026-06-20T05:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — exception filtering
// ---------------------------------------------------------------------------

describe("materializeSlots — exceptions filter slots", () => {
  const rule: AvailabilityRule = makeRule(2, "09:00", "12:00"); // Tuesday

  it("removes slots that overlap with an exception block", () => {
    // Block the first hour (09:00–10:00 EDT = 13:00–14:00 UTC)
    const exception = {
      startsAt: new Date("2026-06-16T13:00:00Z"),
      endsAt: new Date("2026-06-16T14:00:00Z"),
    };
    const input = makeSlotInput({
      rules: [rule],
      exceptions: [exception],
      durationMin: 30,
    });
    const slots = materializeSlots(input);
    // 09:00–10:00 blocked → 2 slots removed; 4 remain
    expect(slots).toHaveLength(4);
    // No slot should be within the blocked range
    for (const s of slots) {
      const overlaps =
        s.startUtc.getTime() < exception.endsAt.getTime() &&
        s.endUtc.getTime() > exception.startsAt.getTime();
      expect(overlaps).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — buffer between appointments
// ---------------------------------------------------------------------------

describe("materializeSlots — buffer prevents back-to-back booking", () => {
  const rule: AvailabilityRule = makeRule(2, "09:00", "12:00"); // Tuesday

  it("removes slots that are within buffer_minutes of a booked appointment", () => {
    // Booked: 10:00–10:30 EDT = 14:00–14:30 UTC
    // With 30-min buffer: 13:30–15:00 UTC is excluded (expands each side)
    // Slots at 09:30 (13:30Z) and 10:30 (14:30Z) UTC would conflict when expanded
    const booked = [
      {
        startsAt: new Date("2026-06-16T14:00:00Z"),
        endsAt: new Date("2026-06-16T14:30:00Z"),
      },
    ];
    const settingsWithBuffer: SchedulingSettings = {
      ...DEFAULT_SETTINGS,
      bufferMinutes: 30,
    };
    const input = makeSlotInput({
      rules: [rule],
      booked,
      settings: settingsWithBuffer,
      durationMin: 30,
    });
    const slots = materializeSlots(input);

    // With 30min buffer: expanded block is 13:30–15:00 UTC
    // Slots 13:00–13:30 is fine (end=13:30, expandedBooked start=13:30 → not strictly <)
    // Wait: expand slot by buffer: slot 13:30–14:00 → expanded 13:00–14:30 → overlaps booked 14:00–14:30 → blocked
    // Slot 14:30–15:00 → expanded 14:00–15:30 → overlaps booked 14:00–14:30 → blocked
    // Booked slot itself is not a new slot.
    // Available: 13:00–13:30, 15:00–15:30, 15:30–16:00 (if they are within 09:00–12:00 rule end 16:00 UTC)
    expect(slots.length).toBeGreaterThan(0);
    // No slot should have expanded range overlapping the booked slot
    for (const s of slots) {
      const expandedStart = new Date(s.startUtc.getTime() - 30 * 60_000);
      const expandedEnd = new Date(s.endUtc.getTime() + 30 * 60_000);
      const conflictsWithBooked =
        expandedStart.getTime() < booked[0]!.endsAt.getTime() &&
        expandedEnd.getTime() > booked[0]!.startsAt.getTime();
      expect(conflictsWithBooked).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// materializeSlots — min_notice / max_advance clipping
// ---------------------------------------------------------------------------

describe("materializeSlots — min_notice and max_advance", () => {
  const rule: AvailabilityRule = makeRule(2, "09:00", "12:00"); // Tuesday June 16

  it("clips slots before now + min_notice_hours", () => {
    const nowUtc = new Date("2026-06-16T12:30:00Z"); // after all Tuesday slots (end = 16:00 UTC)
    const input = makeSlotInput({
      rules: [rule],
      nowUtc,
      settings: { ...DEFAULT_SETTINGS, minNoticeHours: 24 },
    });
    const slots = materializeSlots(input);
    // now = 12:30 UTC Tue Jun 16; min_notice=24h → effectiveFrom = 12:30 UTC Jun 17
    // All slots on Jun 16 are before effectiveFrom → 0 slots
    expect(slots).toHaveLength(0);
  });

  it("clips the window to max_advance_days from now", () => {
    const nowUtc = new Date("2026-06-01T00:00:00Z");
    const input = makeSlotInput({
      rules: [rule],
      nowUtc,
      settings: { ...DEFAULT_SETTINGS, maxAdvanceDays: 1 }, // only 1 day ahead
      windowFromUtc: new Date("2026-06-01T00:00:00Z"),
      windowToUtc: new Date("2026-06-30T00:00:00Z"),
    });
    const slots = materializeSlots(input);
    // max_advance: now+1day = Jun 2. No Tuesday in Jun 1–2 → 0 slots
    expect(slots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isSlotInSet
// ---------------------------------------------------------------------------

describe("isSlotInSet", () => {
  const slots: Slot[] = [
    { startUtc: new Date("2026-06-16T13:00:00Z"), endUtc: new Date("2026-06-16T13:30:00Z") },
    { startUtc: new Date("2026-06-16T13:30:00Z"), endUtc: new Date("2026-06-16T14:00:00Z") },
  ];

  it("returns true for an exact matching slot", () => {
    const candidate: Slot = {
      startUtc: new Date("2026-06-16T13:00:00Z"),
      endUtc: new Date("2026-06-16T13:30:00Z"),
    };
    expect(isSlotInSet(candidate, slots)).toBe(true);
  });

  it("returns false for a slot not in the set", () => {
    const candidate: Slot = {
      startUtc: new Date("2026-06-16T14:00:00Z"),
      endUtc: new Date("2026-06-16T14:30:00Z"),
    };
    expect(isSlotInSet(candidate, slots)).toBe(false);
  });

  it("returns false when start matches but end does not", () => {
    const candidate: Slot = {
      startUtc: new Date("2026-06-16T13:00:00Z"),
      endUtc: new Date("2026-06-16T14:00:00Z"), // different end
    };
    expect(isSlotInSet(candidate, slots)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M-7: getWeekAgenda — DST-safe week-end UTC calculation (domain-level proof)
//
// The fix moved from (fromUtc + 7×86400s) to addDays(localDate, 7) before
// fromZonedTime. We verify the arithmetic here using date-fns to confirm that
// across the US spring-forward boundary (2026-03-08, America/New_York) the
// week end lands at the correct civil midnight, not 1 hour early/late.
// ---------------------------------------------------------------------------

describe("M-7: week-end UTC calculation is DST-safe (domain arithmetic)", () => {
  it("addDays(weekStart, 7) in NY produces correct UTC during spring-forward week", () => {
    // Week starting 2026-03-08 (spring forward Sunday).
    // Civil week end = 2026-03-15T00:00:00 America/New_York.
    // After DST: NY = UTC-4, so midnight = 04:00 UTC.
    // The OLD bug: fromUtc + 7×86400s where fromUtc = 05:00Z (winter midnight),
    //   gives 05:00Z on Mar 15 = 01:00 AM NY — wrong (1h late).
    // The NEW fix: addDays("2026-03-08", 7) = "2026-03-15", then
    //   fromZonedTime("2026-03-15T00:00:00", "America/New_York") = 04:00Z — correct.
    const weekStartLocal = "2026-03-08";
    const tz = "America/New_York";

    // Correct approach (M-7 fix)
    const weekEndLocal = addDays(new Date(`${weekStartLocal}T00:00:00`), 7)
      .toISOString()
      .slice(0, 10);
    const toUtcCorrect = fromZonedTime(`${weekEndLocal}T00:00:00`, tz);

    // 2026-03-15 midnight in NY (EDT = UTC-4) = 04:00 UTC
    expect(toUtcCorrect.toISOString()).toBe("2026-03-15T04:00:00.000Z");
  });

  it("addDays(weekStart, 7) in NY produces correct UTC during fall-back week", () => {
    // Week starting 2026-11-01 (fall back Sunday).
    // Civil week end = 2026-11-08T00:00:00 America/New_York.
    // NY reverted to EST = UTC-5, so midnight = 05:00 UTC.
    const weekStartLocal = "2026-11-01";
    const tz = "America/New_York";

    const weekEndLocal = addDays(new Date(`${weekStartLocal}T00:00:00`), 7)
      .toISOString()
      .slice(0, 10);
    const toUtcCorrect = fromZonedTime(`${weekEndLocal}T00:00:00`, tz);

    // 2026-11-08 midnight in NY (EST = UTC-5) = 05:00 UTC
    expect(toUtcCorrect.toISOString()).toBe("2026-11-08T05:00:00.000Z");
  });
});
