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

const { mockGetStageSlaDays } = vi.hoisted(() => ({
  mockGetStageSlaDays: vi.fn(),
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

// The dynamic import() target inside stageDeadlineFields.
vi.mock("@/backend/modules/catalog", () => ({
  getStageSlaDays: mockGetStageSlaDays,
}));

// Import AFTER mocks
import { stageDeadlineFields } from "../service";

const ENTERED = "2026-06-30T17:43:16.000Z";

describe("cases: stageDeadlineFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStageSlaDays.mockResolvedValue({ sales: 7, legal: null, operations: 3 });
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
