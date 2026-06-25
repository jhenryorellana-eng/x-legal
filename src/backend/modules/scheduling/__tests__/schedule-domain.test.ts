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
  mergeCaseSchedule,
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

describe("mergeCaseSchedule", () => {
  const service: AppointmentScheduleEntry[] = [
    { sequenceNumber: 1, durationMinutes: 30, kind: "video", weekOffset: 1, labelI18n: null, objectives: [], position: 0, origin: "service" },
    { sequenceNumber: 2, durationMinutes: 30, kind: "video", weekOffset: 2, labelI18n: null, objectives: [], position: 1, origin: "service" },
  ];

  it("appends a per-case extra after the cita it follows (intermediate ordering)", () => {
    const extra: AppointmentScheduleEntry[] = [
      { sequenceNumber: 3, durationMinutes: 30, kind: "video", weekOffset: 1, labelI18n: null, objectives: [], position: 1, origin: "case", id: "x1" },
    ];
    const merged = mergeCaseSchedule(service, extra);
    // weekOffset 1 group: service#1 (pos 0) then extra#3 (pos 1), then service#2 (week 2).
    expect(merged.map((e) => e.sequenceNumber)).toEqual([1, 3, 2]);
    expect(merged.map((e) => e.origin)).toEqual(["service", "case", "service"]);
  });

  it("orders by weekOffset, then position, then sequenceNumber", () => {
    const a: AppointmentScheduleEntry[] = [
      { sequenceNumber: 2, durationMinutes: 30, kind: "video", weekOffset: 2, labelI18n: null, objectives: [] },
      { sequenceNumber: 1, durationMinutes: 30, kind: "video", weekOffset: 1, labelI18n: null, objectives: [] },
    ];
    const merged = mergeCaseSchedule(a, []);
    expect(merged.map((e) => e.sequenceNumber)).toEqual([1, 2]);
  });

  it("defaults missing origin to 'service' and marks case entries 'case'", () => {
    const svc: AppointmentScheduleEntry[] = [
      { sequenceNumber: 1, durationMinutes: 30, kind: "video", weekOffset: 1, labelI18n: null, objectives: [] },
    ];
    const merged = mergeCaseSchedule(svc, []);
    expect(merged[0].origin).toBe("service");
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
