/**
 * Regression: availability_rules.start_local / end_local are Postgres `time`
 * columns that serialize as "HH:MM:SS". materializeSlots builds
 * `${date}T${startLocal}:00`, so a non-normalized "09:00:00" yields the invalid
 * "…T09:00:00:00" → RangeError "Invalid time value", which 404'd the client
 * /agendar tab. getActiveRules must normalize the time columns to "HH:MM".
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/backend/platform/supabase", () => {
  const result = {
    data: [
      { weekday: 1, start_local: "09:00:00", end_local: "12:00:00", timezone: "America/New_York", is_active: true },
      { weekday: 1, start_local: "14:00:00", end_local: "17:00:00", timezone: "America/New_York", is_active: true },
    ],
    error: null,
  };
  const chain: Record<string, unknown> = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    // Thenable: awaiting the query chain resolves with the rows.
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return { createServiceClient: () => chain, createServerClient: () => chain };
});

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getActiveRules } from "../repository";

describe("getActiveRules — time normalization (regression)", () => {
  it("trims HH:MM:SS time columns to HH:MM", async () => {
    const rules = await getActiveRules("org-1");
    expect(rules).toHaveLength(2);
    expect(rules[0].startLocal).toBe("09:00");
    expect(rules[0].endLocal).toBe("12:00");
    expect(rules[1].startLocal).toBe("14:00");
    expect(rules[1].endLocal).toBe("17:00");
    // No seconds → `${date}T${startLocal}:00` is a valid ISO-like local string.
    expect(rules[0].startLocal).not.toMatch(/:\d{2}:\d{2}$/);
  });
});
