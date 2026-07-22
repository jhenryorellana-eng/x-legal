/**
 * TDD: settingsForActorKind — min_notice is a CLIENT-only constraint.
 *
 * "Antelación mínima para reservar" (min_notice_hours, configured in
 * /ventas/disponibilidad) stops CLIENTS from self-booking too close to now.
 * Staff manage the agenda, so it must NOT apply to them — they may book inside
 * that window (mirrors Calendly's "minimum notice", which binds invitees, not
 * the host). This locks that rule: staff → min_notice zeroed; client → intact.
 */

import { describe, it, expect } from "vitest";
import { settingsForActorKind, type SchedulingSettings } from "../domain";

const BASE: SchedulingSettings = {
  minNoticeHours: 24,
  maxAdvanceDays: 30,
  bufferMinutes: 0,
  cancellationWindowHours: 24,
  rebookingPenaltyDays: 7,
  prospectDurationMinutes: 60,
  videoLink: null,
  remindersEnabled: true,
};

describe("settingsForActorKind", () => {
  it("zeroes min_notice for staff (they may book inside the client window)", () => {
    const out = settingsForActorKind(BASE, "staff");
    expect(out.minNoticeHours).toBe(0);
  });

  it("preserves min_notice for clients (the constraint still binds them)", () => {
    const out = settingsForActorKind(BASE, "client");
    expect(out.minNoticeHours).toBe(24);
  });

  it("leaves every other setting untouched for staff (only min_notice changes)", () => {
    const out = settingsForActorKind(BASE, "staff");
    expect(out).toEqual({ ...BASE, minNoticeHours: 0 });
  });

  it("does not mutate the input settings object", () => {
    const input = { ...BASE };
    settingsForActorKind(input, "staff");
    expect(input.minNoticeHours).toBe(24);
  });

  it("returns the same values for clients (no mutation, no change)", () => {
    const out = settingsForActorKind(BASE, "client");
    expect(out).toEqual(BASE);
  });
});
