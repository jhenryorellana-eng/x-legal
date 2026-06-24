/**
 * Cases / advanceCasePhase (TDD).
 *
 * Manual, staff-driven phase progression (hybrid progress model). Decisions
 * under test:
 *  - only admin + paralegal may advance (sales/finance/client denied)
 *  - advances to the next phase by position; records phase history + timeline
 *  - rejects advancing past the last phase (CASE_ALREADY_LAST_PHASE)
 *  - an explicit earlier/equal target is rejected (CASE_INVALID_TRANSITION)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockListServicePhases,
  mockUpdateCase,
  mockInsertPhaseHistory,
  mockWriteAudit,
  mockAppendCaseTimeline,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockListServicePhases: vi.fn(),
  mockUpdateCase: vi.fn().mockResolvedValue(undefined),
  mockInsertPhaseHistory: vi.fn().mockResolvedValue(undefined),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mockCan,
  requireCaseAccess: mockRequireCaseAccess,
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
  systemActor: { userId: "system", orgId: "org-1", kind: "staff", role: "admin", permissions: new Map() },
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn().mockResolvedValue(undefined), on: vi.fn() },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
  validateUploadedObject: vi.fn(),
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mockWriteAudit,
  appendCaseTimeline: mockAppendCaseTimeline,
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    listServicePhases: mockListServicePhases,
    updateCase: mockUpdateCase,
    insertPhaseHistory: mockInsertPhaseHistory,
  };
});

import { advanceCasePhase, CaseError } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PHASE_0 = "11111111-1111-4111-8111-000000000000";
const PHASE_1 = "11111111-1111-4111-8111-000000000001";
const SERVICE_ID = "dddddddd-dddd-4ddd-8ddd-000000000001";

function actor(role: "admin" | "sales" | "paralegal" | "finance") {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    kind: "staff" as const,
    role,
    permissions: new Map(),
  };
}

const CLIENT_ACTOR = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000009",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "client" as const,
  role: null,
  permissions: new Map(),
};

function caseAt(phaseId: string | null) {
  return {
    id: CASE_ID,
    org_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    case_number: "T-001",
    status: "active",
    service_id: SERVICE_ID,
    service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
    primary_client_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
    current_phase_id: phaseId,
    assigned_paralegal_id: null,
    assigned_sales_id: null,
    opened_at: null,
    completed_at: null,
    internal_note: null,
    rebooking_blocked_until: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const PHASES = [
  { id: PHASE_0, service_id: SERVICE_ID, slug: "fase-1", label_i18n: { es: "Sustentos", en: "Support" }, position: 0 },
  { id: PHASE_1, service_id: SERVICE_ID, slug: "fase-2", label_i18n: { es: "Reforzar", en: "Reinforce" }, position: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue(caseAt(PHASE_0));
  mockListServicePhases.mockResolvedValue(PHASES);
});

// ---------------------------------------------------------------------------
// advanceCasePhase
// ---------------------------------------------------------------------------

describe("advanceCasePhase", () => {
  it("admin advances to the next phase (updates phase + writes history + timeline)", async () => {
    const res = await advanceCasePhase(actor("admin"), { caseId: CASE_ID });

    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { current_phase_id: PHASE_1 });
    expect(mockInsertPhaseHistory).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, phaseId: PHASE_1 }),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "phase.advanced", visibleToClient: true }),
    );
    expect(res).toMatchObject({ phaseId: PHASE_1, phaseIndex: 2, phaseCount: 2 });
  });

  it("paralegal may also advance (admin + paralegal)", async () => {
    await expect(advanceCasePhase(actor("paralegal"), { caseId: CASE_ID })).resolves.toMatchObject({
      phaseId: PHASE_1,
    });
    expect(mockUpdateCase).toHaveBeenCalled();
  });

  it("sales is denied (AuthzError, not admin/paralegal)", async () => {
    await expect(
      advanceCasePhase(actor("sales"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("a client is denied", async () => {
    await expect(
      advanceCasePhase(CLIENT_ACTOR, { caseId: CASE_ID }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
  });

  it("rejects advancing past the last phase", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(PHASE_1));
    await expect(
      advanceCasePhase(actor("admin"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "CASE_ALREADY_LAST_PHASE" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("rejects an explicit target that is not strictly ahead", async () => {
    await expect(
      advanceCasePhase(actor("admin"), { caseId: CASE_ID, toPhaseId: PHASE_0 }),
    ).rejects.toBeInstanceOf(CaseError);
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("throws when the case has no current phase", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(null));
    await expect(
      advanceCasePhase(actor("admin"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "CASE_PHASE_INVALID" });
  });
});
