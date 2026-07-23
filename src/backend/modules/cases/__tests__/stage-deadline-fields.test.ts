/**
 * Cases module — stageDeadlineFields (kanban countdown snapshot).
 *
 * The single point that computes cases.stage_entered_at + stage_due_at at each
 * stage entry (activation / transferCase / expediente→operations / phase-restart).
 * Covers: SLA lookup by stage, day math, 'done' short-circuit, and fail-open on a
 * catalog-lookup error (must NOT block the case transition). The 4 integration
 * call sites are exercised end-to-end via the live-verified backfill; this locks
 * the helper's contract so a future regression (wrong stage key, broken dynamic
 * import, wrong anchor) fails a test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetStageSlaDays,
  mockGetDeadlinePolicy,
  mockGetOfficeTimezone,
  mockListOrgNonWorkingDays,
} = vi.hoisted(() => ({
  mockGetStageSlaDays: vi.fn(),
  mockGetDeadlinePolicy: vi.fn(),
  mockGetOfficeTimezone: vi.fn(),
  mockListOrgNonWorkingDays: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — service.ts pulls these in at load (mirror andrium-consumers)
// ---------------------------------------------------------------------------

vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  requireCaseAccess: vi.fn().mockResolvedValue(undefined),
  requireActor: vi.fn(),
  getActor: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
    }
  },
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServerClient: vi.fn().mockResolvedValue({}),
  createServiceClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), on: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

// The dynamic import() targets inside stageDeadlineFields.
vi.mock("@/backend/modules/catalog", () => ({
  getStageSlaDays: mockGetStageSlaDays,
  getDeadlinePolicy: mockGetDeadlinePolicy,
}));

vi.mock("@/backend/modules/scheduling", () => ({
  getOfficeTimezone: mockGetOfficeTimezone,
  listOrgNonWorkingDays: mockListOrgNonWorkingDays,
}));

// Import AFTER mocks
import { stageDeadlineFields } from "../service";

const ENTERED = "2026-06-30T17:43:16.000Z";

describe("cases: stageDeadlineFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStageSlaDays.mockResolvedValue({ sales: 7, legal: null, operations: 3 });
    mockGetDeadlinePolicy.mockResolvedValue(null); // no deadline policy → fixed path
  });

  it("snapshots stage_due_at = entered + SLA days (sales = 7)", async () => {
    const r = await stageDeadlineFields("svc", "sales", ENTERED);
    expect(r).toEqual({
      stage_entered_at: ENTERED,
      stage_due_at: "2026-07-07T17:43:16.000Z",
    });
  });

  it("uses the per-stage SLA (operations = 3)", async () => {
    const r = await stageDeadlineFields("svc", "operations", ENTERED);
    expect(r.stage_due_at).toBe("2026-07-03T17:43:16.000Z");
  });

  it("no due date when the stage has no SLA configured (legal = null)", async () => {
    const r = await stageDeadlineFields("svc", "legal", ENTERED);
    expect(r).toEqual({ stage_entered_at: ENTERED, stage_due_at: null });
  });

  it("terminal stage 'done' → no countdown, and no catalog lookup", async () => {
    const r = await stageDeadlineFields("svc", "done", ENTERED);
    expect(r).toEqual({ stage_entered_at: ENTERED, stage_due_at: null });
    expect(mockGetStageSlaDays).not.toHaveBeenCalled();
  });

  it("fails open: an SLA-lookup error does not block the transition (due = null)", async () => {
    mockGetStageSlaDays.mockRejectedValue(new Error("catalog down"));
    const r = await stageDeadlineFields("svc", "sales", ENTERED);
    expect(r).toEqual({ stage_entered_at: ENTERED, stage_due_at: null });
  });
});

describe("cases: stageDeadlineFields — deadline-anchored stage (Feature B, Diana)", () => {
  // Legal handoff on Wed 2026-07-22 (11:00 EDT). Legal SLA días = 4 (the MAX cap);
  // the policy anchors the 'legal' stage with a 1-business-day mail buffer.
  const LEGAL_ENTERED = "2026-07-22T15:00:00.000Z";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStageSlaDays.mockResolvedValue({ sales: 2, legal: 4, operations: 3 });
    mockGetDeadlinePolicy.mockResolvedValue({
      isEnabled: true,
      anchoredStage: "legal",
      mailBufferBusinessDays: 1,
    });
    mockGetOfficeTimezone.mockResolvedValue("America/New_York");
    mockListOrgNonWorkingDays.mockResolvedValue([]);
  });

  it("cap wins when the deadline is far: due = entered + 4 business days (end of day, office TZ)", async () => {
    // deadline 2026-08-21 (Fri) → shipBy = Thu 08-20; cap = Tue 07-28 → min = 07-28.
    const r = await stageDeadlineFields("svc", "legal", LEGAL_ENTERED, {
      orgId: "org1",
      intakeDeadlineDate: "2026-08-21",
    });
    expect(r.stage_due_at).toBe("2026-07-29T03:59:59.999Z"); // end of 07-28 EDT
  });

  it("buffer wins when the deadline is close: due = deadline − 1 business day", async () => {
    // deadline 2026-07-27 (Mon) → shipBy = Fri 07-24; cap = Tue 07-28 → min = 07-24.
    const r = await stageDeadlineFields("svc", "legal", LEGAL_ENTERED, {
      orgId: "org1",
      intakeDeadlineDate: "2026-07-27",
    });
    expect(r.stage_due_at).toBe("2026-07-25T03:59:59.999Z"); // end of 07-24 EDT
  });

  it("excludes org non-working days from the business-day math", async () => {
    mockListOrgNonWorkingDays.mockResolvedValue(["2026-07-23"]); // Thu closed
    // cap = addBusinessDays(07-22, 4, {Thu23}) → Fri24,Mon27,Tue28,Wed29 = 07-29.
    const r = await stageDeadlineFields("svc", "legal", LEGAL_ENTERED, {
      orgId: "org1",
      intakeDeadlineDate: "2026-08-21",
    });
    expect(r.stage_due_at).toBe("2026-07-30T03:59:59.999Z"); // end of 07-29 EDT
  });

  it("non-anchored stage uses the fixed path even with a deadline present", async () => {
    const r = await stageDeadlineFields("svc", "sales", LEGAL_ENTERED, {
      orgId: "org1",
      intakeDeadlineDate: "2026-07-27",
    });
    // fixed: entered + 2 calendar days (sales SLA)
    expect(r.stage_due_at).toBe("2026-07-24T15:00:00.000Z");
    expect(mockGetOfficeTimezone).not.toHaveBeenCalled();
  });

  it("no intake deadline on the case → fixed path (entered + cap días, calendar)", async () => {
    const r = await stageDeadlineFields("svc", "legal", LEGAL_ENTERED, { orgId: "org1" });
    expect(r.stage_due_at).toBe("2026-07-26T15:00:00.000Z"); // entered + 4 calendar
    expect(mockGetOfficeTimezone).not.toHaveBeenCalled();
  });

  it("fails open: a scheduling error falls back to the fixed SLA (does not block)", async () => {
    mockGetOfficeTimezone.mockRejectedValue(new Error("scheduling down"));
    const r = await stageDeadlineFields("svc", "legal", LEGAL_ENTERED, {
      orgId: "org1",
      intakeDeadlineDate: "2026-07-27",
    });
    expect(r.stage_due_at).toBe("2026-07-26T15:00:00.000Z"); // fixed: entered + 4 calendar
  });
});
