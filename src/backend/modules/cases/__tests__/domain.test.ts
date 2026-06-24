/**
 * Cases domain — pure state machine tests (TDD).
 *
 * No I/O, no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  canTransitionCase,
  canTransitionDocument,
  canTransitionContract,
  computePhaseProgress,
  buildPartiesSnapshot,
  CASE_TRANSITIONS,
  type ContractStatus,
} from "../domain";

// ---------------------------------------------------------------------------
// buildPartiesSnapshot
// ---------------------------------------------------------------------------

describe("buildPartiesSnapshot", () => {
  it("places the principal applicant (petitioner) first", () => {
    const snap = buildPartiesSnapshot(
      { userId: "u1", name: "Carlos Mendoza" },
      [{ role: "spouse", userId: null, name: "Rosa Diaz" }],
    );
    expect(snap.parties[0]).toEqual({ role: "petitioner", userId: "u1", name: "Carlos Mendoza" });
    expect(snap.parties).toHaveLength(2);
  });

  it("preserves the order of additional parties", () => {
    const snap = buildPartiesSnapshot({ userId: "u1", name: "A" }, [
      { role: "spouse", userId: null, name: "B" },
      { role: "minor", userId: null, name: "C" },
      { role: "minor", userId: null, name: "D" },
    ]);
    expect(snap.parties.map((p) => p.name)).toEqual(["A", "B", "C", "D"]);
  });

  it("includes only the petitioner when there are no additional parties", () => {
    const snap = buildPartiesSnapshot({ userId: "u1", name: "Solo" }, []);
    expect(snap.parties).toEqual([{ role: "petitioner", userId: "u1", name: "Solo" }]);
  });

  it("tolerates a null principal name (no profile yet)", () => {
    const snap = buildPartiesSnapshot({ userId: "u1", name: null }, []);
    expect(snap.parties[0].name).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// canTransitionCase
// ---------------------------------------------------------------------------

describe("canTransitionCase", () => {
  it("allows payment_pending → active for admin", () => {
    expect(canTransitionCase("payment_pending", "active", "admin")).toBeNull();
  });

  it("denies payment_pending → active for paralegal", () => {
    expect(canTransitionCase("payment_pending", "active", "paralegal")).toBe(
      "CASE_FORBIDDEN_TRANSITION",
    );
  });

  it("allows active → in_validation for paralegal", () => {
    expect(canTransitionCase("active", "in_validation", "paralegal")).toBeNull();
  });

  it("denies active → in_validation for sales", () => {
    expect(canTransitionCase("active", "in_validation", "sales")).toBe(
      "CASE_FORBIDDEN_TRANSITION",
    );
  });

  it("allows in_validation → ready_for_delivery for paralegal", () => {
    expect(canTransitionCase("in_validation", "ready_for_delivery", "paralegal")).toBeNull();
  });

  it("allows ready_for_delivery → delivered for paralegal", () => {
    expect(canTransitionCase("ready_for_delivery", "delivered", "paralegal")).toBeNull();
  });

  it("allows delivered → completed for paralegal", () => {
    expect(canTransitionCase("delivered", "completed", "paralegal")).toBeNull();
  });

  it("denies completed → active (terminal state, no reverse)", () => {
    expect(canTransitionCase("completed", "active", "admin")).toBe(
      "CASE_INVALID_TRANSITION",
    );
  });

  it("denies cancelled → active (terminal state)", () => {
    expect(canTransitionCase("cancelled", "active", "admin")).toBe(
      "CASE_INVALID_TRANSITION",
    );
  });

  it("allows active → on_hold for sales", () => {
    expect(canTransitionCase("active", "on_hold", "sales")).toBeNull();
  });

  it("allows on_hold → active for paralegal", () => {
    expect(canTransitionCase("on_hold", "active", "paralegal")).toBeNull();
  });

  it("allows active → cancelled for sales", () => {
    expect(canTransitionCase("active", "cancelled", "sales")).toBeNull();
  });

  it("allows in_validation → cancelled for admin only", () => {
    expect(canTransitionCase("in_validation", "cancelled", "admin")).toBeNull();
    expect(canTransitionCase("in_validation", "cancelled", "sales")).toBe(
      "CASE_FORBIDDEN_TRANSITION",
    );
  });

  it("denies payment_pending → delivered (no such edge)", () => {
    expect(canTransitionCase("payment_pending", "delivered", "admin")).toBe(
      "CASE_INVALID_TRANSITION",
    );
  });

  it("admin bypasses role restriction but not edge existence", () => {
    // in_validation → cancelled is admin-only in the rules; admin can do it
    expect(canTransitionCase("in_validation", "cancelled", "admin")).toBeNull();
    // But a non-existent edge returns INVALID regardless of admin
    expect(canTransitionCase("completed", "delivered", "admin")).toBe(
      "CASE_INVALID_TRANSITION",
    );
  });

  it("covers all declared CASE_TRANSITIONS edges", () => {
    // Smoke-test: every declared transition must pass for admin
    for (const rule of CASE_TRANSITIONS) {
      const result = canTransitionCase(rule.from, rule.to, "admin");
      expect(result, `${rule.from} → ${rule.to}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// canTransitionDocument
// ---------------------------------------------------------------------------

describe("canTransitionDocument", () => {
  it("allows uploaded → approved", () => {
    expect(canTransitionDocument("uploaded", "approved")).toBeNull();
  });

  it("allows uploaded → rejected", () => {
    expect(canTransitionDocument("uploaded", "rejected")).toBeNull();
  });

  it("allows rejected → replaced", () => {
    expect(canTransitionDocument("rejected", "replaced")).toBeNull();
  });

  it("allows replaced → approved", () => {
    expect(canTransitionDocument("replaced", "approved")).toBeNull();
  });

  it("allows replaced → rejected", () => {
    expect(canTransitionDocument("replaced", "rejected")).toBeNull();
  });

  it("denies approved → rejected (terminal)", () => {
    expect(canTransitionDocument("approved", "rejected")).toBe("DOC_INVALID_TRANSITION");
  });

  it("denies approved → replaced (terminal)", () => {
    expect(canTransitionDocument("approved", "replaced")).toBe("DOC_INVALID_TRANSITION");
  });

  it("denies uploaded → replaced (must go through rejected first)", () => {
    expect(canTransitionDocument("uploaded", "replaced")).toBe("DOC_INVALID_TRANSITION");
  });

  it("denies rejected → approved directly (must go through replaced)", () => {
    expect(canTransitionDocument("rejected", "approved")).toBe("DOC_INVALID_TRANSITION");
  });
});

// ---------------------------------------------------------------------------
// canTransitionContract
// ---------------------------------------------------------------------------

describe("canTransitionContract", () => {
  it("allows draft → sent", () => {
    expect(canTransitionContract("draft", "sent")).toBeNull();
  });

  it("allows draft → cancelled", () => {
    expect(canTransitionContract("draft", "cancelled")).toBeNull();
  });

  it("allows sent → signed", () => {
    expect(canTransitionContract("sent", "signed")).toBeNull();
  });

  it("allows sent → cancelled", () => {
    expect(canTransitionContract("sent", "cancelled")).toBeNull();
  });

  it("denies signed → anything (terminal)", () => {
    const terminals: ContractStatus[] = ["draft", "sent", "cancelled"];
    for (const to of terminals) {
      expect(canTransitionContract("signed", to), `signed → ${to}`).toBe(
        "CONTRACT_INVALID_TRANSITION",
      );
    }
  });

  it("denies cancelled → anything (terminal)", () => {
    const targets: ContractStatus[] = ["draft", "sent", "signed"];
    for (const to of targets) {
      expect(canTransitionContract("cancelled", to), `cancelled → ${to}`).toBe(
        "CONTRACT_INVALID_TRANSITION",
      );
    }
  });

  it("denies draft → signed (must go through sent)", () => {
    expect(canTransitionContract("draft", "signed")).toBe("CONTRACT_INVALID_TRANSITION");
  });
});

// ---------------------------------------------------------------------------
// computePhaseProgress
// ---------------------------------------------------------------------------

describe("computePhaseProgress", () => {
  it("returns 100 when nothing is required", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 0,
        approvedDocuments: 0,
        totalForms: 0,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(100);
  });

  it("returns 0 when everything is required but nothing done", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 4,
        approvedDocuments: 0,
        totalForms: 2,
        submittedForms: 0,
        totalAppointments: 1,
        completedAppointments: 0,
      }),
    ).toBe(0);
  });

  it("returns 100 when everything is done", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 4,
        approvedDocuments: 4,
        totalForms: 2,
        submittedForms: 2,
        totalAppointments: 1,
        completedAppointments: 1,
      }),
    ).toBe(100);
  });

  it("weights documents at 50%, forms at 30%, appointments at 20%", () => {
    // docs 100%, forms 0%, appts 0% → 50
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 2,
        totalForms: 2,
        submittedForms: 0,
        totalAppointments: 1,
        completedAppointments: 0,
      }),
    ).toBe(50);

    // docs 0%, forms 100%, appts 0% → 30
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 0,
        totalForms: 2,
        submittedForms: 2,
        totalAppointments: 1,
        completedAppointments: 0,
      }),
    ).toBe(30);

    // docs 0%, forms 0%, appts 100% → 20
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 0,
        totalForms: 2,
        submittedForms: 0,
        totalAppointments: 1,
        completedAppointments: 1,
      }),
    ).toBe(20);
  });

  it("returns partial progress correctly", () => {
    // docs 50% (1/2), forms 100% (2/2), appts 100% (1/1)
    // 25 + 30 + 20 = 75
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 1,
        totalForms: 2,
        submittedForms: 2,
        totalAppointments: 1,
        completedAppointments: 1,
      }),
    ).toBe(75);
  });

  it("caps individual category at 100 (no over-completion)", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 5, // over-delivered
        totalForms: 0,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(100); // docs=100% (capped), forms=100% (none required), appts=100%
  });
});
