/**
 * Ola C — per-cita schedule domain helpers.
 *
 * effectiveAppointmentCount: schedule rows win over the uniform policy count.
 * scheduleEntryForSequence: returns the row for a sequence (→ its own duration),
 * or null (caller falls back to the policy).
 */

import { describe, it, expect } from "vitest";
import {
  effectiveAppointmentCount,
  scheduleEntryForSequence,
  type PhasePolicy,
  type AppointmentScheduleEntry,
} from "../domain";

const POLICY: PhasePolicy = { appointmentCount: 1, durationMinutes: 30, kind: "video" };

const SCHEDULE: AppointmentScheduleEntry[] = [
  { sequenceNumber: 1, durationMinutes: 60, kind: "video", weekOffset: 1 },
  { sequenceNumber: 2, durationMinutes: 45, kind: "phone", weekOffset: 2 },
];

describe("effectiveAppointmentCount", () => {
  it("uses the schedule row count when a schedule exists", () => {
    expect(effectiveAppointmentCount(POLICY, SCHEDULE)).toBe(2);
  });

  it("falls back to the policy count when no schedule exists", () => {
    expect(effectiveAppointmentCount({ ...POLICY, appointmentCount: 3 }, [])).toBe(3);
  });
});

describe("scheduleEntryForSequence", () => {
  it("returns the matching entry (its own duration + kind)", () => {
    const e = scheduleEntryForSequence(SCHEDULE, 2);
    expect(e).toEqual({ sequenceNumber: 2, durationMinutes: 45, kind: "phone", weekOffset: 2 });
  });

  it("returns null for a sequence beyond the schedule (→ policy fallback)", () => {
    expect(scheduleEntryForSequence(SCHEDULE, 3)).toBeNull();
  });

  it("returns null when there is no schedule", () => {
    expect(scheduleEntryForSequence([], 1)).toBeNull();
  });
});
