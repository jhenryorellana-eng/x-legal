/**
 * Pure domain tests for the case ownership stage (eje propio) — DOC-41 / feature
 * "Responsable / Etapa + Traspaso gated". No mocks: these are deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  nextStage,
  STAGE_ORDER,
  STAGE_MODULE,
  computeStageChecklist,
  canTransferStage,
  type StageChecklistSignals,
} from "../domain";

// Fully-satisfied sales signals (everything done / nothing required).
const READY: StageChecklistSignals = {
  initialPaymentConfirmed: true,
  citasTotal: 3,
  citasCompleted: 3,
  docsTotal: 4,
  docsApproved: 4,
  formsTotal: 2,
  formsDone: 2,
  docsToTranslate: 4,
  translationsCompleted: 4,
  expedienteStatus: null,
};

describe("cases/domain: stage order", () => {
  it("advances sales → legal → operations → done, terminal at done", () => {
    expect(nextStage("sales")).toBe("legal");
    expect(nextStage("legal")).toBe("operations");
    expect(nextStage("operations")).toBe("done");
    expect(nextStage("done")).toBeNull();
    expect(STAGE_ORDER).toEqual(["sales", "legal", "operations", "done"]);
  });

  it("maps each non-terminal stage to a permission module", () => {
    expect(STAGE_MODULE.sales).toBe("leads");
    expect(STAGE_MODULE.legal).toBe("expedientes");
    expect(STAGE_MODULE.operations).toBe("printing");
  });
});

describe("cases/domain: computeStageChecklist (sales)", () => {
  it("is all-done when payment is confirmed and every gating signal is satisfied", () => {
    const c = computeStageChecklist("sales", READY);
    expect(c.allDone).toBe(true);
    expect(c.items.map((i) => i.key)).toEqual(["payment", "citas", "docs", "forms", "translation"]);
  });

  it("blocks the handoff until the initial payment is confirmed (case still payment_pending)", () => {
    const c = computeStageChecklist("sales", { ...READY, initialPaymentConfirmed: false });
    expect(c.allDone).toBe(false);
    expect(c.items.find((i) => i.key === "payment")?.done).toBe(false);
  });

  it("blocks an empty case: nothing instantiated is NOT 'ready' even when paid", () => {
    const c = computeStageChecklist("sales", {
      ...READY,
      citasTotal: 0, citasCompleted: 0,
      docsTotal: 0, docsApproved: 0,
      formsTotal: 0, formsDone: 0,
      docsToTranslate: 0, translationsCompleted: 0,
    });
    // payment is confirmed, but there is no applicable substantive work to verify.
    expect(c.allDone).toBe(false);
  });

  it("a zero-total category is satisfied as long as some other task applies", () => {
    // citas/forms/translation n/a, but docs (4/4) is real work and done → ready.
    const c = computeStageChecklist("sales", {
      ...READY,
      citasTotal: 0, citasCompleted: 0,
      formsTotal: 0, formsDone: 0,
      docsToTranslate: 0, translationsCompleted: 0,
    });
    expect(c.allDone).toBe(true);
  });

  it("blocks when documents are not fully approved", () => {
    const c = computeStageChecklist("sales", { ...READY, docsApproved: 3 });
    expect(c.allDone).toBe(false);
    expect(c.items.find((i) => i.key === "docs")?.done).toBe(false);
  });

  it("blocks when a translation is missing", () => {
    const c = computeStageChecklist("sales", { ...READY, translationsCompleted: 1 });
    expect(c.allDone).toBe(false);
    expect(c.items.find((i) => i.key === "translation")?.done).toBe(false);
  });

  it("blocks when the appointment route is incomplete", () => {
    const c = computeStageChecklist("sales", { ...READY, citasCompleted: 2 });
    expect(c.items.find((i) => i.key === "citas")?.done).toBe(false);
  });
});

describe("cases/domain: computeStageChecklist (legal/operations — real expediente gating)", () => {
  it("legal: no expediente → both items pending, not ready", () => {
    const c = computeStageChecklist("legal", { ...READY, expedienteStatus: null });
    expect(c.items.map((i) => i.key)).toEqual(["expediente_compiled", "expediente_sent"]);
    expect(c.items.every((i) => !i.done)).toBe(true);
    expect(c.allDone).toBe(false);
  });

  it("legal: compiled but not sent → compiled done, sent pending, not ready", () => {
    const c = computeStageChecklist("legal", { ...READY, expedienteStatus: "compiled" });
    expect(c.items.find((i) => i.key === "expediente_compiled")?.done).toBe(true);
    expect(c.items.find((i) => i.key === "expediente_sent")?.done).toBe(false);
    expect(c.allDone).toBe(false);
  });

  it("legal: sent_to_finance → both done, ready to hand off", () => {
    const c = computeStageChecklist("legal", { ...READY, expedienteStatus: "sent_to_finance" });
    expect(c.items.every((i) => i.done)).toBe(true);
    expect(c.allDone).toBe(true);
  });

  it("operations: ready only when the expediente is printed", () => {
    expect(computeStageChecklist("operations", { ...READY, expedienteStatus: "sent_to_finance" }).allDone).toBe(false);
    expect(computeStageChecklist("operations", { ...READY, expedienteStatus: "printed" }).allDone).toBe(true);
  });
});

describe("cases/domain: canTransferStage", () => {
  const ready = computeStageChecklist("sales", READY);
  const notReady = computeStageChecklist("sales", { ...READY, docsApproved: 0 });

  it("allows the owner to transfer when the checklist is complete", () => {
    expect(canTransferStage("sales", ready, { isOwner: true, isAdmin: false })).toBeNull();
  });

  it("forbids a non-owner non-admin", () => {
    expect(canTransferStage("sales", ready, { isOwner: false, isAdmin: false })).toBe("STAGE_FORBIDDEN");
  });

  it("blocks the owner when tasks are incomplete", () => {
    expect(canTransferStage("sales", notReady, { isOwner: true, isAdmin: false })).toBe("STAGE_NOT_READY");
  });

  it("lets an admin force an incomplete transfer", () => {
    expect(canTransferStage("sales", notReady, { isOwner: false, isAdmin: true, force: true })).toBeNull();
  });

  it("never transfers from a terminal stage", () => {
    const done = computeStageChecklist("done", READY);
    expect(canTransferStage("done", done, { isOwner: true, isAdmin: true, force: true })).toBe("STAGE_TERMINAL");
  });
});
