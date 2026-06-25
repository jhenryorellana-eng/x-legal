/**
 * Cases / advanceCaseMilestone (TDD).
 *
 * Milestone-level progression (hitos as the first-class unit). Decisions under test:
 *  - only admin + paralegal may advance (sales/finance/client denied)
 *  - advances to the next milestone in global order; records milestone history
 *  - crossing a phase boundary moves current_phase_id + writes phase history
 *  - rejects advancing past the last milestone (CASE_ALREADY_LAST_MILESTONE)
 *  - rejects when the service has no milestones (CASE_NO_MILESTONES)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockListServicePhases,
  mockListServiceMilestones,
  mockUpdateCase,
  mockInsertPhaseHistory,
  mockInsertMilestoneHistory,
  mockWriteAudit,
  mockAppendCaseTimeline,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockListServicePhases: vi.fn(),
  mockListServiceMilestones: vi.fn(),
  mockUpdateCase: vi.fn().mockResolvedValue(undefined),
  mockInsertPhaseHistory: vi.fn().mockResolvedValue(undefined),
  mockInsertMilestoneHistory: vi.fn().mockResolvedValue(undefined),
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
    listServiceMilestones: mockListServiceMilestones,
    updateCase: mockUpdateCase,
    insertPhaseHistory: mockInsertPhaseHistory,
    insertMilestoneHistory: mockInsertMilestoneHistory,
  };
});

import { advanceCaseMilestone, CaseError } from "../service";

// ---------------------------------------------------------------------------
// Fixtures: 2 phases. Phase 0 has m0a, m0b; phase 1 has m1a.
// ---------------------------------------------------------------------------

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PHASE_0 = "11111111-1111-4111-8111-000000000000";
const PHASE_1 = "11111111-1111-4111-8111-000000000001";
const M0A = "22222222-2222-4222-8222-00000000000a";
const M0B = "22222222-2222-4222-8222-00000000000b";
const M1A = "22222222-2222-4222-8222-00000000001a";
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

function caseAt(milestoneId: string | null, phaseId: string | null = PHASE_0) {
  return {
    id: CASE_ID,
    org_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    case_number: "T-001",
    status: "active",
    service_id: SERVICE_ID,
    service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
    primary_client_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
    current_phase_id: phaseId,
    current_milestone_id: milestoneId,
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

const MILESTONES = [
  { id: M0A, service_phase_id: PHASE_0, slug: "m0a", label_i18n: { es: "Recopilar", en: "Gather" }, description_i18n: null, glossary_i18n: null, icon: "doc", position: 0, week_offset: 1, phase_position: 0 },
  { id: M0B, service_phase_id: PHASE_0, slug: "m0b", label_i18n: { es: "Declaración", en: "Affidavit" }, description_i18n: null, glossary_i18n: null, icon: "edit", position: 1, week_offset: 3, phase_position: 0 },
  { id: M1A, service_phase_id: PHASE_1, slug: "m1a", label_i18n: { es: "I-589 enviada", en: "I-589 filed" }, description_i18n: null, glossary_i18n: null, icon: "send", position: 0, week_offset: 5, phase_position: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue(caseAt(M0A));
  mockListServicePhases.mockResolvedValue(PHASES);
  mockListServiceMilestones.mockResolvedValue(MILESTONES);
});

describe("advanceCaseMilestone", () => {
  it("admin advances within a phase (no phase change)", async () => {
    const res = await advanceCaseMilestone(actor("admin"), { caseId: CASE_ID });
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, { current_milestone_id: M0B });
    expect(mockInsertMilestoneHistory).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, milestoneId: M0B }),
    );
    expect(mockInsertPhaseHistory).not.toHaveBeenCalled();
    expect(res).toMatchObject({ milestoneId: M0B, phaseChanged: false });
  });

  it("crossing the last milestone of a phase moves the phase too", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(M0B, PHASE_0));
    const res = await advanceCaseMilestone(actor("admin"), { caseId: CASE_ID });
    expect(mockUpdateCase).toHaveBeenCalledWith(CASE_ID, {
      current_milestone_id: M1A,
      current_phase_id: PHASE_1,
    });
    expect(mockInsertMilestoneHistory).toHaveBeenCalledWith(
      expect.objectContaining({ milestoneId: M1A }),
    );
    expect(mockInsertPhaseHistory).toHaveBeenCalledWith(
      expect.objectContaining({ phaseId: PHASE_1 }),
    );
    expect(mockAppendCaseTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "milestone.advanced", visibleToClient: true }),
    );
    expect(res).toMatchObject({ milestoneId: M1A, phaseChanged: true });
  });

  it("paralegal may advance; sales and clients may not", async () => {
    await expect(advanceCaseMilestone(actor("paralegal"), { caseId: CASE_ID })).resolves.toMatchObject({
      milestoneId: M0B,
    });
    await expect(advanceCaseMilestone(actor("sales"), { caseId: CASE_ID })).rejects.toMatchObject({
      reason: "forbidden_module",
    });
    await expect(advanceCaseMilestone(CLIENT_ACTOR, { caseId: CASE_ID })).rejects.toMatchObject({
      reason: "forbidden_module",
    });
  });

  it("rejects advancing past the last milestone", async () => {
    mockFindCaseById.mockResolvedValue(caseAt(M1A, PHASE_1));
    await expect(
      advanceCaseMilestone(actor("admin"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "CASE_ALREADY_LAST_MILESTONE" });
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("rejects when the service has no milestones", async () => {
    mockListServiceMilestones.mockResolvedValue([]);
    await expect(
      advanceCaseMilestone(actor("admin"), { caseId: CASE_ID }),
    ).rejects.toMatchObject({ code: "CASE_NO_MILESTONES" });
  });

  it("rejects an explicit target that is not strictly ahead", async () => {
    await expect(
      advanceCaseMilestone(actor("admin"), { caseId: CASE_ID, toMilestoneId: M0A }),
    ).rejects.toBeInstanceOf(CaseError);
    expect(mockUpdateCase).not.toHaveBeenCalled();
  });

  it("jumps to an explicit later milestone", async () => {
    const res = await advanceCaseMilestone(actor("admin"), { caseId: CASE_ID, toMilestoneId: M1A });
    expect(res).toMatchObject({ milestoneId: M1A, phaseChanged: true });
  });
});
