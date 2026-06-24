/**
 * findDueReminders — org-level reminders master switch.
 *
 * When org_scheduling_settings.reminders_enabled = false, NO appointment of that
 * org is returned for reminding — toggling "Recordatorios automáticos" off in
 * Mi disponibilidad silences reminders immediately (existing + future citas).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const apptRows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));
const settingsRows = vi.hoisted(() => ({ value: [] as Record<string, unknown>[] }));

// Minimal chainable PostgREST-style builder that awaits to { data, error }.
function makeBuilder(resultRef: { value: unknown[] }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "lte", "in", "order", "maybeSingle"]) {
    builder[m] = () => builder;
  }
  (builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: resultRef.value, error: null });
  return builder;
}

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      makeBuilder(table === "appointments" ? apptRows : settingsRows),
  }),
  createServerClient: () => ({}),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { findDueReminders } from "../repository";

const WINDOW_START = new Date("2026-06-24T00:00:00Z");
const WINDOW_END = new Date("2026-06-25T00:00:00Z");

const DUE_APPT = {
  id: "appt-1",
  org_id: "org-1",
  case_id: "case-1",
  lead_id: null,
  staff_id: "staff-1",
  client_user_id: "client-1",
  starts_at: "2026-06-24T18:00:00Z",
  kind: "video",
};

describe("findDueReminders — org reminders master switch", () => {
  beforeEach(() => {
    apptRows.value = [DUE_APPT];
  });

  it("returns the due appointment when the org has reminders enabled", async () => {
    settingsRows.value = [{ org_id: "org-1", reminders_enabled: true }];
    const res = await findDueReminders("1d", WINDOW_START, WINDOW_END);
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe("appt-1");
  });

  it("excludes ALL appointments of an org that disabled reminders", async () => {
    settingsRows.value = [{ org_id: "org-1", reminders_enabled: false }];
    const res = await findDueReminders("1d", WINDOW_START, WINDOW_END);
    expect(res).toHaveLength(0);
  });

  it("treats a missing settings row as enabled (default true)", async () => {
    settingsRows.value = [];
    const res = await findDueReminders("1d", WINDOW_START, WINDOW_END);
    expect(res).toHaveLength(1);
  });
});
