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
  resolveObjectiveTemplates,
  resolveObjectivesOutcome,
  type PhasePolicy,
  type AppointmentScheduleEntry,
} from "../domain";

const POLICY: PhasePolicy = { appointmentCount: 1, durationMinutes: 30, kind: "video" };

const SCHEDULE: AppointmentScheduleEntry[] = [
  { sequenceNumber: 1, durationMinutes: 60, kind: "video", weekOffset: 1, labelI18n: null, objectives: [] },
  { sequenceNumber: 2, durationMinutes: 45, kind: "phone", weekOffset: 2, labelI18n: null, objectives: [] },
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
    expect(e).toEqual({ sequenceNumber: 2, durationMinutes: 45, kind: "phone", weekOffset: 2, labelI18n: null, objectives: [] });
  });

  it("returns null for a sequence beyond the schedule (→ policy fallback)", () => {
    expect(scheduleEntryForSequence(SCHEDULE, 3)).toBeNull();
  });

  it("returns null when there is no schedule", () => {
    expect(scheduleEntryForSequence([], 1)).toBeNull();
  });
});

describe("resolveObjectiveTemplates", () => {
  it("parses a well-formed objectives_i18n array", () => {
    const raw = [
      { id: "a", text: { es: "Dar la bienvenida", en: "Welcome" } },
      { id: "b", text: { es: "Explicar el proceso" } },
    ];
    expect(resolveObjectiveTemplates(raw)).toEqual([
      { id: "a", text: { es: "Dar la bienvenida", en: "Welcome" } },
      { id: "b", text: { es: "Explicar el proceso" } },
    ]);
  });

  it("skips malformed entries and tolerates null/non-array", () => {
    expect(resolveObjectiveTemplates(null)).toEqual([]);
    expect(resolveObjectiveTemplates("nope")).toEqual([]);
    expect(
      resolveObjectiveTemplates([
        { id: "ok", text: { es: "x" } },
        { id: 1, text: { es: "bad id" } },
        { text: { es: "no id" } },
        { id: "noText" },
      ]),
    ).toEqual([{ id: "ok", text: { es: "x" } }]);
  });
});

describe("resolveObjectivesOutcome", () => {
  it("parses a well-formed outcome array", () => {
    const raw = [
      { id: "a", text: "Welcome", achieved: true },
      { id: "b", text: "Process", achieved: false },
    ];
    expect(resolveObjectivesOutcome(raw)).toEqual(raw);
  });

  it("skips entries missing fields or with wrong types", () => {
    expect(resolveObjectivesOutcome(null)).toEqual([]);
    expect(
      resolveObjectivesOutcome([
        { id: "a", text: "ok", achieved: true },
        { id: "b", text: "missing achieved" },
        { id: "c", text: 5, achieved: true },
      ]),
    ).toEqual([{ id: "a", text: "ok", achieved: true }]);
  });
});
