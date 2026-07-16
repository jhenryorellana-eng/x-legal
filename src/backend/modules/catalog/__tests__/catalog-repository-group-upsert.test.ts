/**
 * Catalog repository — upsertQuestionGroup partial-update merge.
 *
 * Regression: the group-rename menu sends only { id, automation_version_id,
 * title_i18n }. A raw upsert of that partial row aborts in Postgres because the
 * INSERT arm is evaluated before conflict resolution and `position` is NOT NULL,
 * so renames failed silently. The repo must merge the partial row over the
 * existing one before upserting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const upsert = vi.fn();
  const upsertSingle = vi.fn();

  const from = vi.fn((_table: string) => ({
    // select("*").eq("id", …).maybeSingle() — existing-row lookup
    select: vi.fn(() => ({
      eq: vi.fn(() => ({ maybeSingle })),
    })),
    // upsert(payload).select().single() — the write
    upsert: upsert.mockImplementation(() => ({
      select: vi.fn(() => ({ single: upsertSingle })),
    })),
  }));

  return { from, maybeSingle, upsert, upsertSingle };
});

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { upsertQuestionGroup } from "../repository";

const EXISTING = {
  id: "group-1",
  automation_version_id: "ver-1",
  title_i18n: { es: "Título viejo", en: "Old title" },
  position: 11,
  do_not_fill: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertQuestionGroup", () => {
  it("merges a partial rename over the existing row so NOT NULL columns survive", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: EXISTING, error: null });
    const renamed = { ...EXISTING, title_i18n: { es: "Nuevo", en: "New" } };
    mocks.upsertSingle.mockResolvedValue({ data: renamed, error: null });

    const result = await upsertQuestionGroup({
      id: "group-1",
      automation_version_id: "ver-1",
      title_i18n: { es: "Nuevo", en: "New" },
    } as unknown as Parameters<typeof upsertQuestionGroup>[0]);

    const payload = mocks.upsert.mock.calls[0][0];
    expect(payload.position).toBe(11); // carried over from the existing row
    expect(payload.do_not_fill).toBe(false);
    expect(payload.title_i18n).toEqual({ es: "Nuevo", en: "New" });
    expect(result).toEqual(renamed);
  });

  it("inserts new rows untouched when no id is provided", async () => {
    const inserted = { ...EXISTING, id: "group-2", position: 3 };
    mocks.upsertSingle.mockResolvedValue({ data: inserted, error: null });

    await upsertQuestionGroup({
      automation_version_id: "ver-1",
      title_i18n: { es: "Grupo", en: "Group" },
      position: 3,
    } as Parameters<typeof upsertQuestionGroup>[0]);

    // No lookup for new rows; the payload goes through as-is.
    expect(mocks.maybeSingle).not.toHaveBeenCalled();
    const payload = mocks.upsert.mock.calls[0][0];
    expect(payload.position).toBe(3);
  });

  it("keeps the provided row when the id does not exist yet (duplicate-as-draft style)", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const inserted = { ...EXISTING, id: "group-3", position: 0 };
    mocks.upsertSingle.mockResolvedValue({ data: inserted, error: null });

    await upsertQuestionGroup({
      id: "group-3",
      automation_version_id: "ver-1",
      title_i18n: { es: "Grupo", en: "Group" },
      position: 0,
    } as Parameters<typeof upsertQuestionGroup>[0]);

    const payload = mocks.upsert.mock.calls[0][0];
    expect(payload.id).toBe("group-3");
    expect(payload.position).toBe(0);
  });
});
