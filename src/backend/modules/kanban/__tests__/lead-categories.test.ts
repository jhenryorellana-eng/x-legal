/**
 * Lead category management (API-LEAD-07/09/10/11) — create / update / delete /
 * reorder. Covers validation (label, color), org-ownership anti-enumeration, and
 * the delete fallback (soft-delete when referenced, hard-delete when orphan).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindLeadCategory = vi.hoisted(() => vi.fn());
const mockInsertLeadCategory = vi.hoisted(() => vi.fn());
const mockUpdateLeadCategory = vi.hoisted(() => vi.fn());
const mockDeleteLeadCategory = vi.hoisted(() => vi.fn());
const mockCountLeadsByCategory = vi.hoisted(() => vi.fn());
const mockReorderLeadCategories = vi.hoisted(() => vi.fn());
const mockMaxCategoryPosition = vi.hoisted(() => vi.fn());

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: () => ({ from: vi.fn() }),
  createServerClient: () => ({}),
}));

vi.mock("../repository.js", () => ({
  findLeadCategory: mockFindLeadCategory,
  insertLeadCategory: mockInsertLeadCategory,
  updateLeadCategory: mockUpdateLeadCategory,
  deleteLeadCategory: mockDeleteLeadCategory,
  countLeadsByCategory: mockCountLeadsByCategory,
  reorderLeadCategories: mockReorderLeadCategories,
  maxCategoryPosition: mockMaxCategoryPosition,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

import {
  createLeadCategory,
  updateLeadCategory,
  deleteLeadCategory,
  reorderLeadCategories,
  KanbanError,
} from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const CAT_ID = "33333333-3333-4333-8333-333333333003";
const cat = (over: Record<string, unknown> = {}) => ({
  id: CAT_ID,
  org_id: STAFF.orgId,
  label: "Caliente",
  color: "red",
  position: 0,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("createLeadCategory", () => {
  it("rejects empty label", async () => {
    await expect(
      createLeadCategory(STAFF, { label: "   " }),
    ).rejects.toMatchObject({ code: "CATEGORY_LABEL_REQUIRED" });
  });

  it("rejects a color outside the design tokens", async () => {
    await expect(
      createLeadCategory(STAFF, { label: "VIP", color: "#5B8CFF" }),
    ).rejects.toMatchObject({ code: "CATEGORY_INVALID_COLOR" });
  });

  it("inserts a trimmed label with the given token color", async () => {
    mockMaxCategoryPosition.mockResolvedValue(2);
    mockInsertLeadCategory.mockResolvedValue(cat({ label: "VIP", color: "purple", position: 3 }));
    const res = await createLeadCategory(STAFF, { label: "  VIP  ", color: "purple" });
    expect(res.label).toBe("VIP");
    expect(mockInsertLeadCategory).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: STAFF.orgId, label: "VIP", color: "purple", position: 3 }),
    );
  });
});

describe("updateLeadCategory", () => {
  it("throws CATEGORY_NOT_FOUND for a category from another org", async () => {
    mockFindLeadCategory.mockResolvedValue(cat({ org_id: "other-org" }));
    await expect(
      updateLeadCategory(STAFF, { categoryId: CAT_ID, label: "X" }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
    expect(mockUpdateLeadCategory).not.toHaveBeenCalled();
  });

  it("rejects invalid color", async () => {
    mockFindLeadCategory.mockResolvedValue(cat());
    await expect(
      updateLeadCategory(STAFF, { categoryId: CAT_ID, color: "neon" }),
    ).rejects.toMatchObject({ code: "CATEGORY_INVALID_COLOR" });
  });

  it("applies the patch (rename + recolor + deactivate)", async () => {
    mockFindLeadCategory.mockResolvedValue(cat());
    mockUpdateLeadCategory.mockResolvedValue(cat({ label: "Tibio", color: "gold", is_active: false }));
    await updateLeadCategory(STAFF, { categoryId: CAT_ID, label: "Tibio", color: "gold", isActive: false });
    expect(mockUpdateLeadCategory).toHaveBeenCalledWith(
      CAT_ID,
      expect.objectContaining({ label: "Tibio", color: "gold", is_active: false }),
    );
  });

  it("rejects a whitespace-only label on update", async () => {
    mockFindLeadCategory.mockResolvedValue(cat());
    await expect(
      updateLeadCategory(STAFF, { categoryId: CAT_ID, label: "   " }),
    ).rejects.toMatchObject({ code: "CATEGORY_LABEL_REQUIRED" });
    expect(mockUpdateLeadCategory).not.toHaveBeenCalled();
  });
});

describe("deleteLeadCategory", () => {
  it("hard-deletes when no lead references it", async () => {
    mockFindLeadCategory.mockResolvedValue(cat());
    mockCountLeadsByCategory.mockResolvedValue(0);
    const res = await deleteLeadCategory(STAFF, CAT_ID);
    expect(res).toEqual({ softDeleted: false });
    expect(mockDeleteLeadCategory).toHaveBeenCalledWith(CAT_ID);
    expect(mockUpdateLeadCategory).not.toHaveBeenCalled();
  });

  it("soft-deletes (is_active=false) when leads still reference it", async () => {
    mockFindLeadCategory.mockResolvedValue(cat());
    mockCountLeadsByCategory.mockResolvedValue(4);
    mockUpdateLeadCategory.mockResolvedValue(cat({ is_active: false }));
    const res = await deleteLeadCategory(STAFF, CAT_ID);
    expect(res).toEqual({ softDeleted: true });
    expect(mockUpdateLeadCategory).toHaveBeenCalledWith(CAT_ID, { is_active: false });
    expect(mockDeleteLeadCategory).not.toHaveBeenCalled();
  });

  it("throws CATEGORY_NOT_FOUND for a foreign category", async () => {
    mockFindLeadCategory.mockResolvedValue(null);
    await expect(deleteLeadCategory(STAFF, CAT_ID)).rejects.toMatchObject({
      code: "CATEGORY_NOT_FOUND",
    });
  });
});

describe("reorderLeadCategories", () => {
  it("delegates the ordered ids to the repo scoped by org", async () => {
    mockReorderLeadCategories.mockResolvedValue(undefined);
    await reorderLeadCategories(STAFF, ["a", "b", "c"]);
    expect(mockReorderLeadCategories).toHaveBeenCalledWith(STAFF.orgId, ["a", "b", "c"]);
  });
});

it("KanbanError is the thrown type", async () => {
  mockFindLeadCategory.mockResolvedValue(null);
  const err = await deleteLeadCategory(STAFF, CAT_ID).catch((e) => e);
  expect(err).toBeInstanceOf(KanbanError);
});
