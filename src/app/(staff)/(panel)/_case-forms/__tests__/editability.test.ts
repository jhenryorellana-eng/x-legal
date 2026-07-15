import { describe, it, expect, vi, beforeEach } from "vitest";

// The two injected server actions — mocked as identifiable references.
vi.mock("@/app/(staff)/(panel)/admin/casos/actions", () => ({
  saveFormDraftAction: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/(staff)/(panel)/admin/casos/form-actions", () => ({
  staffUpdateFormAnswersAction: vi.fn(async () => ({ ok: true })),
}));

const allowsMock = vi.fn();
vi.mock("@/backend/modules/identity", () => ({
  allows: (...args: unknown[]) => allowsMock(...args),
}));

import { resolveStaffFormEditability } from "../editability";
import { saveFormDraftAction } from "@/app/(staff)/(panel)/admin/casos/actions";
import { staffUpdateFormAnswersAction } from "@/app/(staff)/(panel)/admin/casos/form-actions";
import type { Actor } from "@/backend/modules/identity";

const actor = { userId: "u1", orgId: "o1", kind: "staff", role: "sales" } as unknown as Actor;

describe("resolveStaffFormEditability", () => {
  beforeEach(() => allowsMock.mockReset());

  it("staff-fillable draft (filled_by staff, still draft) → editable via the client draft action, no formEdit needed", () => {
    allowsMock.mockReturnValue(false);
    const r = resolveStaffFormEditability(actor, { status: "draft", filledBy: "staff" });
    expect(r.editable).toBe(true);
    expect(r.saveDraft).toBe(saveFormDraftAction);
  });

  it("filled_by 'both' with no response (null status) → editable draft path", () => {
    allowsMock.mockReturnValue(false);
    const r = resolveStaffFormEditability(actor, { status: null, filledBy: "both" });
    expect(r.editable).toBe(true);
    expect(r.saveDraft).toBe(saveFormDraftAction);
  });

  it("client-filled draft WITHOUT formEdit → read-only, correction action", () => {
    allowsMock.mockReturnValue(false);
    const r = resolveStaffFormEditability(actor, { status: "draft", filledBy: "client" });
    expect(r.editable).toBe(false);
    expect(r.saveDraft).toBe(staffUpdateFormAnswersAction);
  });

  it("client-filled draft WITH formEdit → editable via staffUpdateFormAnswers", () => {
    allowsMock.mockReturnValue(true);
    const r = resolveStaffFormEditability(actor, { status: "draft", filledBy: "client" });
    expect(r.editable).toBe(true);
    expect(r.saveDraft).toBe(staffUpdateFormAnswersAction);
  });

  it("submitted client form WITH formEdit → editable correction (staffUpdateFormAnswers, no status change)", () => {
    allowsMock.mockReturnValue(true);
    const r = resolveStaffFormEditability(actor, { status: "submitted", filledBy: "client" });
    expect(r.editable).toBe(true);
    expect(r.saveDraft).toBe(staffUpdateFormAnswersAction);
  });

  it("approved client form WITHOUT formEdit → read-only", () => {
    allowsMock.mockReturnValue(false);
    const r = resolveStaffFormEditability(actor, { status: "approved", filledBy: "client" });
    expect(r.editable).toBe(false);
    expect(r.saveDraft).toBe(staffUpdateFormAnswersAction);
  });
});
