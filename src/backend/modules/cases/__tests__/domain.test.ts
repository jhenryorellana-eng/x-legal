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
  resolveNextPhase,
  resolveNextMilestone,
  resolveFirstMilestone,
  buildPartiesSnapshot,
  selectContractAdditionalParties,
  findCardinalityViolation,
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
// selectContractAdditionalParties
// ---------------------------------------------------------------------------

describe("selectContractAdditionalParties", () => {
  const parties = [
    { role: "minor", name: "Hijo 1" },
    { role: "minor", name: "Hijo 2" },
    { role: "minor", name: "Hijo 3" },
    { role: "spouse", name: "Cónyuge" },
  ];

  it("keeps only parties whose role is included in the contract", () => {
    // minor included, spouse excluded → the 3 children remain, no spouse.
    const kept = selectContractAdditionalParties(parties, new Set(["minor"]));
    expect(kept.map((p) => p.name)).toEqual(["Hijo 1", "Hijo 2", "Hijo 3"]);
  });

  it("keeps multiple included roles and preserves order", () => {
    const kept = selectContractAdditionalParties(parties, new Set(["minor", "spouse"]));
    expect(kept).toHaveLength(4);
  });

  it("returns empty when no role is included", () => {
    expect(selectContractAdditionalParties(parties, new Set())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findCardinalityViolation
// ---------------------------------------------------------------------------

describe("findCardinalityViolation", () => {
  it("returns null when every single-role appears at most once", () => {
    expect(
      findCardinalityViolation(["petitioner", "spouse", "minor", "minor"], new Set(["spouse"])),
    ).toBeNull();
  });

  it("flags a single-role that appears twice", () => {
    expect(
      findCardinalityViolation(["spouse", "spouse"], new Set(["spouse"])),
    ).toBe("spouse");
  });

  it("ignores cardinality of multiple-roles (minors can repeat)", () => {
    // 'minor' is NOT in the single set → repeating it is allowed.
    expect(
      findCardinalityViolation(["minor", "minor", "minor"], new Set(["spouse"])),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveNextPhase
// ---------------------------------------------------------------------------

describe("resolveNextPhase", () => {
  const phases = [
    { id: "p0", position: 0 },
    { id: "p1", position: 1 },
    { id: "p2", position: 2 },
  ];

  it("returns the next phase by position", () => {
    expect(resolveNextPhase(phases, "p0")).toEqual({ id: "p1", position: 1 });
    expect(resolveNextPhase(phases, "p1")).toEqual({ id: "p2", position: 2 });
  });

  it("returns null at the last phase", () => {
    expect(resolveNextPhase(phases, "p2")).toBeNull();
  });

  it("returns null when the current phase is null or unknown", () => {
    expect(resolveNextPhase(phases, null)).toBeNull();
    expect(resolveNextPhase(phases, "nope")).toBeNull();
  });

  it("is order-independent (sorts by position)", () => {
    const shuffled = [
      { id: "p2", position: 2 },
      { id: "p0", position: 0 },
      { id: "p1", position: 1 },
    ];
    expect(resolveNextPhase(shuffled, "p0")).toEqual({ id: "p1", position: 1 });
  });
});

// ---------------------------------------------------------------------------
// resolveNextMilestone / resolveFirstMilestone (global order across phases)
// ---------------------------------------------------------------------------

describe("resolveNextMilestone / resolveFirstMilestone", () => {
  // Two phases: phase 0 has m0a, m0b; phase 1 has m1a. Global order:
  // m0a → m0b → m1a (crosses the phase boundary between m0b and m1a).
  const milestones = [
    { id: "m0a", phasePosition: 0, position: 0 },
    { id: "m0b", phasePosition: 0, position: 1 },
    { id: "m1a", phasePosition: 1, position: 0 },
  ];

  it("first milestone is the earliest in global order", () => {
    expect(resolveFirstMilestone(milestones)).toEqual({ id: "m0a", phasePosition: 0, position: 0 });
    expect(resolveFirstMilestone([])).toBeNull();
  });

  it("advances within a phase, then crosses the phase boundary", () => {
    expect(resolveNextMilestone(milestones, "m0a")).toEqual({ id: "m0b", phasePosition: 0, position: 1 });
    // m0b is the last of phase 0 → next is the first of phase 1.
    expect(resolveNextMilestone(milestones, "m0b")).toEqual({ id: "m1a", phasePosition: 1, position: 0 });
  });

  it("returns null at the last milestone", () => {
    expect(resolveNextMilestone(milestones, "m1a")).toBeNull();
  });

  it("returns null when the current milestone is null or unknown", () => {
    expect(resolveNextMilestone(milestones, null)).toBeNull();
    expect(resolveNextMilestone(milestones, "nope")).toBeNull();
  });

  it("is order-independent (sorts by phase then position)", () => {
    const shuffled = [
      { id: "m1a", phasePosition: 1, position: 0 },
      { id: "m0b", phasePosition: 0, position: 1 },
      { id: "m0a", phasePosition: 0, position: 0 },
    ];
    expect(resolveNextMilestone(shuffled, "m0a")).toEqual({ id: "m0b", phasePosition: 0, position: 1 });
    expect(resolveFirstMilestone(shuffled)).toEqual({ id: "m0a", phasePosition: 0, position: 0 });
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

  // Regression: a documents-only phase (no forms/appointments required) must
  // reflect ONLY the document completion — empty categories must NOT inflate the
  // score. Previously forms+appointments (each "100% because nothing required")
  // contributed a fixed 30%+20%=50% floor, so a brand-new case showed 50%.
  it("does not inflate when only documents are required (0 of 4 → 0%)", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 4,
        approvedDocuments: 0,
        totalForms: 0,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(0);
  });

  it("documents-only phase scales with approvals (2 of 4 → 50%, 4 of 4 → 100%)", () => {
    expect(
      computePhaseProgress({
        totalDocuments: 4,
        approvedDocuments: 2,
        totalForms: 0,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(50);
    expect(
      computePhaseProgress({
        totalDocuments: 4,
        approvedDocuments: 4,
        totalForms: 0,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(100);
  });

  it("renormalizes weights to required categories (docs + forms only, appts none)", () => {
    // docs 100% (weight 50) + forms 0% (weight 30), appts none → 50/80 = 63
    expect(
      computePhaseProgress({
        totalDocuments: 2,
        approvedDocuments: 2,
        totalForms: 2,
        submittedForms: 0,
        totalAppointments: 0,
        completedAppointments: 0,
      }),
    ).toBe(63);
  });
});
