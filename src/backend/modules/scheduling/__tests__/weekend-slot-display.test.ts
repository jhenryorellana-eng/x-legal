/**
 * Regression: the "12:00 PM" weekend slot (reported bug).
 *
 * Production scenario — org weekend availability stored as 10:00–13:00 in
 * America/New_York (the office snapshot), prospect cita = 60 min. The staff
 * (Henry) views in America/Lima. The slot math is correct; the bug was that the
 * booking modal displayed the slots in the OFFICE zone (NY) instead of the
 * viewer's own zone (Lima), so the valid 12:00–13:00 NY slot rendered as
 * "12:00 PM" — which the staff read as past the 12:00 (Lima) closing time.
 *
 * This locks the end-to-end effect of the fix: the same UTC slots, formatted in
 * the viewer's zone, are 9:00 / 10:00 / 11:00 AM — never "12:00 PM".
 */

import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import {
  materializeSlots,
  type AvailabilityRule,
  type MaterializeSlotsInput,
  type SchedulingSettings,
} from "../domain";

const SETTINGS: SchedulingSettings = {
  minNoticeHours: 0,
  maxAdvanceDays: 365,
  bufferMinutes: 0,
  cancellationWindowHours: 24,
  rebookingPenaltyDays: 7,
  prospectDurationMinutes: 60,
  videoLink: null,
  remindersEnabled: true,
};

// Saturday rule exactly as stored in production: weekday 6, 10:00–13:00 ET.
const saturdayRule: AvailabilityRule = {
  weekday: 6,
  startLocal: "10:00",
  endLocal: "13:00",
  timezone: "America/New_York",
  isActive: true,
};

// Window covering Saturday 2026-06-27 (the day the user tested), 60-min cita.
const input: MaterializeSlotsInput = {
  rules: [saturdayRule],
  settings: SETTINGS,
  exceptions: [],
  booked: [],
  windowFromUtc: new Date("2026-06-27T00:00:00Z"),
  windowToUtc: new Date("2026-06-28T00:00:00Z"),
  durationMin: 60,
  nowUtc: new Date("2026-06-01T00:00:00Z"),
};

const fmt = (d: Date, tz: string) => formatInTimeZone(d, tz, "h:mm a");

describe("weekend 60-min slots — viewer-zone display (reported bug)", () => {
  const slots = materializeSlots(input);

  it("materialises exactly three 60-min slots inside 10:00–13:00 ET", () => {
    // 10:00, 11:00, 12:00 ET — the last (12:00–13:00 ET) is valid (ends AT close).
    expect(slots).toHaveLength(3);
    expect(slots.map((s) => s.startUtc.toISOString())).toEqual([
      "2026-06-27T14:00:00.000Z",
      "2026-06-27T15:00:00.000Z",
      "2026-06-27T16:00:00.000Z",
    ]);
  });

  it("renders as 9/10/11 AM in the viewer's zone (Lima) — never 12:00 PM", () => {
    const lima = slots.map((s) => fmt(s.startUtc, "America/Lima"));
    expect(lima).toEqual(["9:00 AM", "10:00 AM", "11:00 AM"]);
    expect(lima).not.toContain("12:00 PM");
  });

  it("would have shown 12:00 PM in the office zone (NY) — the old, confusing display", () => {
    const ny = slots.map((s) => fmt(s.startUtc, "America/New_York"));
    expect(ny).toEqual(["10:00 AM", "11:00 AM", "12:00 PM"]);
  });
});
