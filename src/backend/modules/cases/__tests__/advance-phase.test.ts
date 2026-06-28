/**
 * Cases / advanceCasePhase (TDD).
 *
 * The phase boundary is the "close this phase & restart the cycle" operation
 * (Andrium/admin, after the phase's expediente is printed). Decisions under test:
 *  - only admin + finance may advance (sales/paralegal/client denied)
 *  - gated on the current phase's latest expediente being `printed`
 *    (admin may `force`); otherwise CASE_PHASE_NOT_PRINTED
 *  - advancing resets the case to the `sales` stage + a sales owner (Vanessa),
 *    moves the kanban card (case.owner_changed) and notifies sales
 *  - the last phase completes the case (status=completed, stage=done) and emits
 *    case.completed for retention hooks
 *  - rejects advancing past the last phase / an earlier explicit target
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockListServicePhases,
  mockUpdateCase,
  mockInsertPhaseHistory,
  mockInsertStageHistory,
  mockListStaffWithModuleEdit,
  mockWriteAudit,
  mockAppendCaseTimeline,
  mockEmitAndWait,
  mockGetCaseExpedientes,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockListServicePhases: vi.fn(),
  mockUpdateCase: vi.fn().mockResolvedValue(undefined),
  mockInsertPhaseHistory: vi.fn().mockResolvedValue(undefined),
  mockInsertStageHistory: vi.fn().mockResolvedValue(undefined),
  mockListStaffWithModuleEdit: vi.fn(),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
  mockAppendCaseTimeline: vi.fn().mockResolvedValue(undefined),
  mockEmitAndWait: vi.fn().mockResolvedValue(undefined),
  mockGetCaseExpedientes: vi.fn(),
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
  appEvents: { emit: vi.fn(), emitAndWait: mockEmitAndWait, on: vi.fn() },
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

// Printed gate reads the latest expediente (dynamic import in the service).
vi.mock("@/backend/modules/expediente", () => ({
  getCaseExpedientes: mockGetCaseExpedientes,
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    listServicePhases: mockListServicePhases,
    updateCase: mockUpdateCase,
    insertPhaseHistory: mockInsertPhaseHistory,
    insertStageHistory: mockInsertStageHistory,
    listStaffWithModuleEdit: mockListStaffWithModuleEdit,
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
const VANESSA = "22222222-2222-4222-8222-000000000002";
const VANESSA_2 = "22222222-2222-4222-8222-000000000003";

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

function caseAt(phaseId: string | null, over: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    org_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    case_number: "T-001",
    status: "ready_for_delivery",
    service_id: SERVICE_ID,
    service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
    primary_client_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
    current_phase_id: phaseId,
    current_stage: "operations",
    current_owner_id: "ffffffff-ffff-4fff-8fff-000000000004",
    assigned_paralegal_id: null,
    assigned_sales_id: null,
    opened_at: null,
    completed_at: null,
    internal_note: null,
    rebooking_blocked_until: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
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
  // Default: the current phase's expediente is printed → gate passes.
  mockGetCaseExpedientes.mockResolvedValue([{ status: "printed", attempt_no: 1 }]);
  // Default: a single eligible sales owner (Vanessa) → auto-assigned.
  mockListStaffWithModuleEdit.mockResolvedValue([
    { userId: VANESSA, displayName: "Vanessa", role: "sales" },
  ]);
});

// ---------------------------------------------------------------------------
// advanceCasePhase
// ---------------------------------------------------------------------------

describe("advanceCasePhase", () => {
  it("admin advances: bumps phase, resets to sales+Vanessa, status active", async () => {
    const res = await advanceCasePhase(actor("admin"), { caseId: CASE_ID });

    expect(mockUpdateCase).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({
        current_phase_id: PHASE_1,
        current_stage: "sales",
        current_owner_id: VANESSA,
        assigned_sales_id: VANESSA,
        status: "active",
      }),
    );
    expect(mockInsertPhaseHistory).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, phaseId: PHASE_1 }),
    );
    expect(mockInsertStageHistory).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, toStage: "sales", toOwnerId: VANESSA }),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "phase.advanced", visibleToClient: true }),
    );
    // kanban card moves to the new sales owner
    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ type: "case.owner_changed" }),
    );
    // sales (Vanessa) gets notified via the case.phase_advanced event → consumer
    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ type: "case.phase_advanced" }),
    );
    expect(res).toMatchObject({ phaseId: PHASE_1, phaseIndex: 2, phaseCount: 2, completed: false, stage: "sales" });
  });

  it("finance (Andrium) may advance", async () => {
    await expect(advanceCasePhase(actor("finance"), { caseId: CASE_ID })).resolves.toMatchObject({
      phaseId: PHASE_1,
      stage: "sales",
    });
    expect(mockUpdateCase).toHaveBeenCalled();
  });

  it("paralegal is denied (only admin + finance cross the phase boundary)", async () => {
    await expect(
      advanceCasePhase(actor("paralegal"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("sales is denied", async () => {
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

  it("rejects when the current phase's expediente is not printed", async () => {
    mockGetCaseExpedientes.mockResolvedValue([{ status: "sent_to_finance", attempt_no: 1 }]);
    await expect(
      advanceCasePhase(actor("finance"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "CASE_PHASE_NOT_PRINTED" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("admin may force-advance even when not printed", async () => {
    mockGetCaseExpedientes.mockResolvedValue([{ status: "draft", attempt_no: 1 }]);
    await expect(
      advanceCasePhase(actor("admin"), { caseId: CASE_ID, force: true }),
    ).resolves.toMatchObject({ phaseId: PHASE_1 });
  });

  it("rejects when the case is not at the operations stage (guards double-advance)", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(PHASE_0, { current_stage: "sales" }));
    await expect(
      advanceCasePhase(actor("finance"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "STAGE_NOT_READY" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("last phase completes the case (status=completed, stage=done) and emits case.completed", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(PHASE_1));
    const res = await advanceCasePhase(actor("admin"), { caseId: CASE_ID });

    expect(mockUpdateCase).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ current_stage: "done", current_owner_id: null, status: "completed" }),
    );
    expect(mockEmitAndWait).toHaveBeenCalledWith(
      expect.objectContaining({ type: "case.completed" }),
    );
    expect(res).toMatchObject({ completed: true, stage: "done" });
  });

  it("requires owner selection when several sales owners are eligible", async () => {
    mockListStaffWithModuleEdit.mockResolvedValue([
      { userId: VANESSA, displayName: "Vanessa", role: "sales" },
      { userId: VANESSA_2, displayName: "Otra", role: "sales" },
    ]);
    await expect(
      advanceCasePhase(actor("admin"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "STAGE_OWNER_REQUIRED" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("honours an explicit sales owner pick", async () => {
    mockListStaffWithModuleEdit.mockResolvedValue([
      { userId: VANESSA, displayName: "Vanessa", role: "sales" },
      { userId: VANESSA_2, displayName: "Otra", role: "sales" },
    ]);
    await advanceCasePhase(actor("admin"), { caseId: CASE_ID, toOwnerId: VANESSA_2 });
    expect(mockUpdateCase).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ current_owner_id: VANESSA_2 }),
    );
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
