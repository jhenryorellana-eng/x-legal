/**
 * Cases / form visibility (TDD) — Ola apelación EOIR-26A.
 *
 * setFormVisibility — admin/sales hide or restore an OPTIONAL form per case
 * (case_form_overrides.is_hidden). Mirrors the requirement-visibility contract:
 *  - only admin + sales may toggle (paralegal/finance denied)
 *  - only optional forms can be hidden (required → FORM_NOT_OPTIONAL)
 *  - a form outside the case's service is rejected (FORM_NOT_FOUND, scope check)
 *  - hide inserts (or updates) is_hidden=true; restore deletes the override
 *  - the party_id is passed through for per-party forms
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockFindFormDefinitionById,
  mockFindFormOverride,
  mockInsertFormOverride,
  mockUpdateFormOverride,
  mockDeleteFormOverride,
  mockWriteAudit,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockFindFormDefinitionById: vi.fn(),
  mockFindFormOverride: vi.fn().mockResolvedValue(null),
  mockInsertFormOverride: vi.fn().mockResolvedValue({ id: "ov-new" }),
  mockUpdateFormOverride: vi.fn().mockResolvedValue(undefined),
  mockDeleteFormOverride: vi.fn().mockResolvedValue(undefined),
  mockWriteAudit: vi.fn().mockResolvedValue(undefined),
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
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    findFormDefinitionById: mockFindFormDefinitionById,
    findFormOverride: mockFindFormOverride,
    insertFormOverride: mockInsertFormOverride,
    updateFormOverride: mockUpdateFormOverride,
    deleteFormOverride: mockDeleteFormOverride,
  };
});

import { setFormVisibility, CaseError } from "../service";

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const FORM_ID = "44444444-4444-4444-8444-000000000001";
const SERVICE_ID = "5e5e5e5e-5e5e-5e5e-5e5e-5e5e5e5e5e5e";
const PARTY = "33333333-3333-4333-8333-000000000002";

function actor(role: "admin" | "sales" | "paralegal" | "finance") {
  return {
    userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    kind: "staff" as const,
    role,
    permissions: new Map(),
  };
}

function formDef(over: Record<string, unknown> = {}) {
  return {
    id: FORM_ID, slug: "eoir-26a", kind: "pdf_automation", filled_by: "client",
    is_per_party: false, is_required: false, party_roles: null, is_active: true,
    label_i18n: { es: "EOIR-26A", en: "EOIR-26A" }, requires_documents_complete: true,
    service_phase_id: "phase-1", service_id: SERVICE_ID, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue({ id: CASE_ID, service_id: SERVICE_ID });
  mockFindFormDefinitionById.mockResolvedValue(formDef());
  mockFindFormOverride.mockResolvedValue(null);
});

describe("setFormVisibility", () => {
  it("admin hides an optional form (insert is_hidden=true)", async () => {
    await setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true });
    expect(mockInsertFormOverride).toHaveBeenCalledTimes(1);
    expect(mockInsertFormOverride.mock.calls[0][0]).toMatchObject({
      case_id: CASE_ID, form_definition_id: FORM_ID, party_id: null, is_hidden: true,
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(), "case.form.hidden", "case_form_overrides", CASE_ID, expect.anything(),
    );
  });

  it("sales may hide it too", async () => {
    await setFormVisibility(actor("sales"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true });
    expect(mockInsertFormOverride).toHaveBeenCalledTimes(1);
  });

  it("passes party_id through for a per-party form", async () => {
    mockFindFormDefinitionById.mockResolvedValue(formDef({ is_per_party: true }));
    await setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: PARTY, hidden: true });
    expect(mockInsertFormOverride.mock.calls[0][0]).toMatchObject({ party_id: PARTY, is_hidden: true });
  });

  it("denies paralegal and finance", async () => {
    await expect(
      setFormVisibility(actor("paralegal"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true }),
    ).rejects.toThrow();
    await expect(
      setFormVisibility(actor("finance"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true }),
    ).rejects.toThrow();
    expect(mockInsertFormOverride).not.toHaveBeenCalled();
  });

  it("refuses to hide a REQUIRED form (FORM_NOT_OPTIONAL)", async () => {
    mockFindFormDefinitionById.mockResolvedValue(formDef({ is_required: true }));
    await expect(
      setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true }),
    ).rejects.toMatchObject({ code: "FORM_NOT_OPTIONAL" } satisfies Partial<CaseError>);
    expect(mockInsertFormOverride).not.toHaveBeenCalled();
  });

  it("rejects a form outside the case's service (FORM_NOT_FOUND scope check)", async () => {
    mockFindFormDefinitionById.mockResolvedValue(formDef({ service_id: "other-service" }));
    await expect(
      setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true }),
    ).rejects.toMatchObject({ code: "FORM_NOT_FOUND" });
  });

  it("updates an existing override instead of inserting a duplicate", async () => {
    mockFindFormOverride.mockResolvedValue({ id: "ov-1", is_hidden: false });
    await setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: true });
    expect(mockUpdateFormOverride).toHaveBeenCalledWith("ov-1", { is_hidden: true });
    expect(mockInsertFormOverride).not.toHaveBeenCalled();
  });

  it("restore deletes the override when it exists", async () => {
    mockFindFormOverride.mockResolvedValue({ id: "ov-1", is_hidden: true });
    await setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: false });
    expect(mockDeleteFormOverride).toHaveBeenCalledWith(CASE_ID, "ov-1");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.anything(), "case.form.shown", "case_form_overrides", CASE_ID, expect.anything(),
    );
  });

  it("restore is a no-op when there is no override (no phantom audit event)", async () => {
    mockFindFormOverride.mockResolvedValue(null);
    await setFormVisibility(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, hidden: false });
    expect(mockDeleteFormOverride).not.toHaveBeenCalled();
    expect(mockInsertFormOverride).not.toHaveBeenCalled();
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });
});
