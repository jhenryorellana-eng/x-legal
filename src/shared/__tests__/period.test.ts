/**
 * resolvePeriodRange — timezone-aware date ranges for dashboard filters.
 *
 * All boundaries are computed as LOCAL calendar midnights in the org timezone
 * (default America/New_York) then converted to UTC instants. This makes the
 * ranges DST-correct (a local midnight is 04:00Z in EDT, 05:00Z in EST) and
 * host-timezone independent (the math never relies on the test machine's TZ).
 *
 * `prev` is the immediately-preceding calendar block (today→yesterday,
 * week→prior week, month→prior month) or, for custom, a contiguous window of
 * equal width — used for period-over-period deltas.
 */
import { describe, it, expect } from "vitest";
import { resolvePeriodRange } from "../period";

const iso = (d: Date) => d.toISOString();

describe("resolvePeriodRange (America/New_York)", () => {
  it("today: from local 00:00 to next local 00:00 (EDT)", () => {
    const r = resolvePeriodRange("today", { now: new Date("2026-06-27T15:00:00Z") });
    expect(iso(r.from)).toBe("2026-06-27T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-28T04:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-06-26T04:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-06-27T04:00:00.000Z");
  });

  it("today: a UTC instant after midnight UTC but before local midnight maps to the previous local day", () => {
    // 03:30Z on Jun 27 is 23:30 EDT on Jun 26 → "today" is Jun 26 local.
    const r = resolvePeriodRange("today", { now: new Date("2026-06-27T03:30:00Z") });
    expect(iso(r.from)).toBe("2026-06-26T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-27T04:00:00.000Z");
  });

  it("week: starts Monday, spans 7 local days", () => {
    // 2026-06-27 is a Saturday → week Monday is 2026-06-22.
    const r = resolvePeriodRange("week", { now: new Date("2026-06-27T15:00:00Z") });
    expect(iso(r.from)).toBe("2026-06-22T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-29T04:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-06-15T04:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-06-22T04:00:00.000Z");
  });

  it("month: from day 1 to day 1 of next month", () => {
    const r = resolvePeriodRange("month", { now: new Date("2026-06-27T15:00:00Z") });
    expect(iso(r.from)).toBe("2026-06-01T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-07-01T04:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-05-01T04:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-06-01T04:00:00.000Z");
  });

  it("month spanning DST: March starts in EST (05:00Z), ends in EDT (04:00Z)", () => {
    // DST 2026 begins Sun Mar 8. March 1 is EST (UTC-5); April 1 is EDT (UTC-4).
    const r = resolvePeriodRange("month", { now: new Date("2026-03-15T12:00:00Z") });
    expect(iso(r.from)).toBe("2026-03-01T05:00:00.000Z");
    expect(iso(r.to)).toBe("2026-04-01T04:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-02-01T05:00:00.000Z");
    expect(iso(r.prevTo)).toBe("2026-03-01T05:00:00.000Z");
  });

  it("custom: inclusive end date (to + 1 day) and equal-width contiguous prev window", () => {
    const r = resolvePeriodRange("custom", {
      from: "2026-06-10",
      to: "2026-06-12",
      now: new Date("2026-06-27T15:00:00Z"),
    });
    expect(iso(r.from)).toBe("2026-06-10T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-13T04:00:00.000Z"); // 12th inclusive
    expect(iso(r.prevTo)).toBe("2026-06-10T04:00:00.000Z");
    expect(iso(r.prevFrom)).toBe("2026-06-07T04:00:00.000Z"); // 3-day window before
  });

  it("custom without dates falls back to a single valid day (today)", () => {
    const r = resolvePeriodRange("custom", { now: new Date("2026-06-27T15:00:00Z") });
    expect(iso(r.from)).toBe("2026-06-27T04:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-28T04:00:00.000Z");
  });

  it("honors an explicit tz override", () => {
    // Los Angeles is UTC-7 in June (PDT) → local midnight is 07:00Z.
    const r = resolvePeriodRange("today", {
      tz: "America/Los_Angeles",
      now: new Date("2026-06-27T15:00:00Z"),
    });
    expect(iso(r.from)).toBe("2026-06-27T07:00:00.000Z");
    expect(iso(r.to)).toBe("2026-06-28T07:00:00.000Z");
  });
});
