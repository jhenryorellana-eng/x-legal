/**
 * convertRuleWallTime — recurring availability rule shown/edited in a staff's
 * own timezone vs the canonical office timezone (DOC-23 §6.5).
 *
 * Office = America/New_York (ET, has DST). Staff = America/Bogota (COT, no DST).
 *  - Winter (Jan): ET = UTC-5 = COT → same wall time.
 *  - Summer (Jul): ET = UTC-4, COT = UTC-5 → ET wall time is 1h AHEAD of COT,
 *    so an ET 09:00 window shows as 08:00 in Bogotá.
 */

import { describe, it, expect } from "vitest";
import { convertRuleWallTime } from "../domain";

const ET = "America/New_York";
const CO = "America/Bogota";

// Reference dates (UTC) inside each season.
const WINTER = new Date("2026-01-14T12:00:00Z"); // mid-January
const SUMMER = new Date("2026-07-15T12:00:00Z"); // mid-July (ET in DST)

describe("convertRuleWallTime", () => {
  it("is identity when from === to", () => {
    expect(convertRuleWallTime({ weekday: 2, hhmm: "09:00" }, ET, ET, SUMMER)).toEqual({
      weekday: 2,
      hhmm: "09:00",
    });
  });

  it("winter: ET 09:00 → Bogotá 09:00 (same offset)", () => {
    const r = convertRuleWallTime({ weekday: 2, hhmm: "09:00" }, ET, CO, WINTER);
    expect(r).toEqual({ weekday: 2, hhmm: "09:00" });
  });

  it("summer: ET 09:00 → Bogotá 08:00 (ET is 1h ahead in DST)", () => {
    const r = convertRuleWallTime({ weekday: 2, hhmm: "09:00" }, ET, CO, SUMMER);
    expect(r).toEqual({ weekday: 2, hhmm: "08:00" });
  });

  it("round-trips: ET → CO → ET returns the original (summer)", () => {
    const toCo = convertRuleWallTime({ weekday: 4, hhmm: "14:30" }, ET, CO, SUMMER);
    const back = convertRuleWallTime(toCo, CO, ET, SUMMER);
    expect(back).toEqual({ weekday: 4, hhmm: "14:30" });
  });

  it("editing in Bogotá 14:00 persists as ET 15:00 (summer)", () => {
    // Vanessa (CO) sets 14:00 on Wednesday; stored in office ET = 15:00.
    const stored = convertRuleWallTime({ weekday: 3, hhmm: "14:00" }, CO, ET, SUMMER);
    expect(stored).toEqual({ weekday: 3, hhmm: "15:00" });
  });
});
