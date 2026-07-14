/**
 * searchBookableCases (API-SCH-13) — staff "Nueva cita" client picker. Verifies
 * query matching (name / case number / phone), name resolution (preferred → legal
 * → case number), i18n label resolution and the result limit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActiveCasesEnriched = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getActiveCasesEnriched: mockGetActiveCasesEnriched,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
  systemActor: { userId: "system", orgId: "org-system", role: "admin", kind: "staff" },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({})),
  createServerClient: vi.fn(() => ({})),
}));

vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

import { searchBookableCases } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const row = (over: Record<string, unknown> = {}) => ({
  caseId: "c1",
  caseNumber: "U26-000001",
  serviceId: "s1",
  primaryClientId: "u1",
  firstName: "Carlos",
  lastName: "Mendoza",
  preferredName: null,
  phone: "+13055550001",
  timezone: "America/New_York",
  serviceLabelI18n: { es: "Asilo político", en: "Political asylum" },
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("searchBookableCases", () => {
  it("matches by client name (case-insensitive) and resolves the es label", async () => {
    mockGetActiveCasesEnriched.mockResolvedValue([row(), row({ caseId: "c2", caseNumber: "U26-000002", firstName: "María", lastName: "González", phone: "+13055550002" })]);

    const res = await searchBookableCases(STAFF, "carlos");
    expect(res).toEqual([
      { caseId: "c1", name: "Carlos Mendoza", phone: "+13055550001", clientTz: "America/New_York", serviceLabel: "Asilo político" },
    ]);
  });

  it("matches by case number and by phone", async () => {
    mockGetActiveCasesEnriched.mockResolvedValue([row()]);
    expect((await searchBookableCases(STAFF, "0001")).length).toBe(1);
    expect((await searchBookableCases(STAFF, "550001")).length).toBe(1);
  });

  it("prefers preferred_name, falls back to legal name then case number", async () => {
    mockGetActiveCasesEnriched.mockResolvedValue([
      row({ caseId: "a", preferredName: "Charlie" }),
      row({ caseId: "b", firstName: null, lastName: null, preferredName: null, caseNumber: "NUM-7" }),
    ]);
    const res = await searchBookableCases(STAFF, "");
    expect(res[0].name).toBe("Charlie");
    expect(res[1].name).toBe("NUM-7");
  });

  it("returns all active when the query is empty, capped by limit", async () => {
    mockGetActiveCasesEnriched.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => row({ caseId: `c${i}`, caseNumber: `N-${i}` })),
    );
    const res = await searchBookableCases(STAFF, "", "es", 5);
    expect(res).toHaveLength(5);
  });

  it("returns [] when nothing matches", async () => {
    mockGetActiveCasesEnriched.mockResolvedValue([row()]);
    expect(await searchBookableCases(STAFF, "zzz-nomatch")).toEqual([]);
  });
});
