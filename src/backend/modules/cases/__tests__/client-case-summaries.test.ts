/**
 * listCaseSummariesForClient (RF-VAN-019) — case summaries for one client,
 * powering the non-blocking "{Nombre} ya tiene un caso de {Servicio}" notice
 * in the "Nuevo caso" modal. Verifies authz, org scoping and row → DTO mapping.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCaseSummariesByClient = vi.hoisted(() => vi.fn());
const mockCan = vi.hoisted(() => vi.fn());

vi.mock("../repository.js", () => ({
  getCaseSummariesByClient: mockGetCaseSummariesByClient,
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) { super(reason); }
  },
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

import { listCaseSummariesForClient } from "../service";
import type { Actor } from "@/backend/platform/authz";

const STAFF: Actor = {
  userId: "11111111-1111-4111-8111-111111111001",
  orgId: "22222222-2222-4222-8222-222222222002",
  role: "sales",
  kind: "staff",
  permissions: new Map(),
};

const CLIENT_ID = "33333333-3333-4333-8333-333333333003";

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockGetCaseSummariesByClient.mockResolvedValue([]);
});

describe("listCaseSummariesForClient", () => {
  it("requires cases:view", async () => {
    const { AuthzError } = await import("@/backend/platform/authz");
    mockCan.mockImplementation(() => {
      throw new AuthzError("forbidden_module");
    });
    await expect(listCaseSummariesForClient(STAFF, CLIENT_ID)).rejects.toThrow();
    expect(mockGetCaseSummariesByClient).not.toHaveBeenCalled();
  });

  it("rejects a malformed client id before hitting the repository", async () => {
    await expect(listCaseSummariesForClient(STAFF, "not-a-uuid")).rejects.toThrow();
    expect(mockGetCaseSummariesByClient).not.toHaveBeenCalled();
  });

  it("scopes to the actor's org and maps rows to the DTO", async () => {
    mockGetCaseSummariesByClient.mockResolvedValue([
      {
        id: "case-1",
        case_number: "ULP-2026-0001",
        service_id: "svc-1",
        status: "active",
        service_label_i18n: { es: "Asilo político", en: "Political asylum" },
      },
    ]);

    const res = await listCaseSummariesForClient(STAFF, CLIENT_ID);

    expect(mockGetCaseSummariesByClient).toHaveBeenCalledWith(STAFF.orgId, CLIENT_ID);
    expect(res).toEqual([
      {
        caseId: "case-1",
        caseNumber: "ULP-2026-0001",
        serviceId: "svc-1",
        serviceLabelI18n: { es: "Asilo político", en: "Political asylum" },
        status: "active",
      },
    ]);
  });

  it("returns [] when the client has no cases", async () => {
    expect(await listCaseSummariesForClient(STAFF, CLIENT_ID)).toEqual([]);
  });
});
