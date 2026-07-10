/**
 * Cases / requirement visibility (TDD).
 *
 * setRequirementVisibility — staff hides/restores an OPTIONAL document per case
 * (case_requirement_overrides.is_hidden). Decisions under test:
 *  - only admin + sales may toggle (paralegal/finance denied)
 *  - only optional requirements can be hidden (required → REQUIREMENT_NOT_OPTIONAL)
 *  - per-instance hide (party-scoped) inserts an override with that party_id
 *  - restore deletes the visibility-only override
 *
 * getDocumentsMatrix — the resolvePartyName fix resolves the applicant
 * (user_id party) name so per-party docs show "… de <name>" for the applicant,
 * and hidden requirements appear for staff but never for the client.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCan,
  mockRequireCaseAccess,
  mockFindCaseById,
  mockGetCaseParties,
  mockGetRequirementOverrides,
  mockFindRequirementOverride,
  mockInsertRequirementOverride,
  mockUpdateRequirementOverride,
  mockDeleteRequirementOverride,
  mockListCaseDocuments,
  mockListServicePhases,
  mockFindClientDisplayName,
  mockFindPersonRecord,
  mockGetCaseRequirements,
  mockFindFormDefinitionById,
  mockFindFormResponse,
  mockGetPublishedAutomationVersion,
} = vi.hoisted(() => ({
  mockCan: vi.fn(),
  mockRequireCaseAccess: vi.fn().mockResolvedValue(undefined),
  mockFindCaseById: vi.fn(),
  mockGetCaseParties: vi.fn().mockResolvedValue([]),
  mockGetRequirementOverrides: vi.fn().mockResolvedValue([]),
  mockFindRequirementOverride: vi.fn().mockResolvedValue(null),
  mockInsertRequirementOverride: vi.fn().mockResolvedValue({ id: "ov-new" }),
  mockUpdateRequirementOverride: vi.fn().mockResolvedValue(undefined),
  mockDeleteRequirementOverride: vi.fn().mockResolvedValue(undefined),
  mockListCaseDocuments: vi.fn().mockResolvedValue([]),
  mockListServicePhases: vi.fn().mockResolvedValue([]),
  mockFindClientDisplayName: vi.fn().mockResolvedValue(null),
  mockFindPersonRecord: vi.fn().mockResolvedValue(null),
  mockGetCaseRequirements: vi.fn(),
  mockFindFormDefinitionById: vi.fn(),
  mockFindFormResponse: vi.fn().mockResolvedValue(null),
  mockGetPublishedAutomationVersion: vi.fn().mockResolvedValue(null),
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
  writeAudit: vi.fn().mockResolvedValue(undefined),
  appendCaseTimeline: vi.fn().mockResolvedValue(undefined),
}));

// catalog is dynamically imported inside the SUT — vitest intercepts it.
vi.mock("@/backend/modules/catalog", () => ({
  getCaseRequirements: mockGetCaseRequirements,
  getPublishedAutomationVersion: mockGetPublishedAutomationVersion,
  listQuestionGroups: vi.fn().mockResolvedValue([]),
  listQuestions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../repository")>();
  return {
    ...original,
    findCaseById: mockFindCaseById,
    getCaseParties: mockGetCaseParties,
    getRequirementOverrides: mockGetRequirementOverrides,
    findRequirementOverride: mockFindRequirementOverride,
    insertRequirementOverride: mockInsertRequirementOverride,
    updateRequirementOverride: mockUpdateRequirementOverride,
    deleteRequirementOverride: mockDeleteRequirementOverride,
    listCaseDocuments: mockListCaseDocuments,
    listServicePhases: mockListServicePhases,
    findClientDisplayName: mockFindClientDisplayName,
    findPersonRecord: mockFindPersonRecord,
    findFormDefinitionById: mockFindFormDefinitionById,
    findFormResponse: mockFindFormResponse,
  };
});

import { setRequirementVisibility, getDocumentsMatrix, getDocumentsGateStatus, getFormForClient, saveFormDraft, CaseError } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "cccccccc-cccc-4ccc-8ccc-000000000001";
const PHASE_ID = "11111111-1111-4111-8111-000000000001";
const DOC_ID = "22222222-2222-4222-8222-000000000001";
const PARTY_ANNA = "33333333-3333-4333-8333-000000000002";
const FORM_ID = "44444444-4444-4444-8444-000000000001";

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

const ACTIVE_CASE = {
  id: CASE_ID,
  org_id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  case_number: "T-001",
  status: "active",
  service_id: "dddddddd-dddd-4ddd-8ddd-000000000001",
  service_plan_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
  primary_client_id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000099",
  current_phase_id: PHASE_ID,
  assigned_paralegal_id: null,
  assigned_sales_id: null,
  opened_at: null,
  completed_at: null,
  internal_note: null,
  rebooking_blocked_until: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function expandedDoc(over: Record<string, unknown> = {}) {
  return {
    key: `${DOC_ID}:${PARTY_ANNA}`,
    required_document_type_id: DOC_ID,
    party_id: PARTY_ANNA,
    label_i18n: { es: "Pasaporte", en: "Passport" },
    help_i18n: null,
    category_i18n: null,
    is_required: false,
    is_hidden: false,
    ai_extract: false,
    extraction_schema: null,
    position: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(undefined);
  mockRequireCaseAccess.mockResolvedValue(undefined);
  mockFindCaseById.mockResolvedValue(ACTIVE_CASE);
  mockGetCaseParties.mockResolvedValue([
    { id: PARTY_ANNA, party_role: "minor", person_record_id: "p-anna", user_id: null, position: 1 },
  ]);
  mockGetRequirementOverrides.mockResolvedValue([]);
  mockFindRequirementOverride.mockResolvedValue(null);
  mockListCaseDocuments.mockResolvedValue([]);
  mockListServicePhases.mockResolvedValue([
    { id: PHASE_ID, service_id: ACTIVE_CASE.service_id, slug: "fase-1", label_i18n: { es: "Fase 1", en: "Phase 1" }, position: 0 },
  ]);
  mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc()] });
  // Default form for the gate tests: an active, client-fillable, gated form with
  // NO existing response. Combined with the default requirements (1 visible doc)
  // + no uploaded docs above, the case is INCOMPLETE unless a test overrides it.
  mockFindFormDefinitionById.mockResolvedValue({
    id: FORM_ID, slug: "form-x", kind: "pdf_automation", filled_by: "client",
    is_per_party: false, party_roles: null, is_active: true,
    label_i18n: { es: "F", en: "F" }, requires_documents_complete: true,
  });
  mockFindFormResponse.mockResolvedValue(null);
  mockGetPublishedAutomationVersion.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// setRequirementVisibility
// ---------------------------------------------------------------------------

describe("setRequirementVisibility", () => {
  it("admin hides an optional per-party requirement (insert is_hidden=true, party-scoped)", async () => {
    await setRequirementVisibility(actor("admin"), {
      caseId: CASE_ID,
      requirementId: DOC_ID,
      partyId: PARTY_ANNA,
      hidden: true,
    });

    expect(mockInsertRequirementOverride).toHaveBeenCalledTimes(1);
    const row = mockInsertRequirementOverride.mock.calls[0][0];
    expect(row).toMatchObject({
      case_id: CASE_ID,
      required_document_type_id: DOC_ID,
      party_id: PARTY_ANNA,
      is_hidden: true,
    });
  });

  it("sales may also hide (admin + sales)", async () => {
    await expect(
      setRequirementVisibility(actor("sales"), {
        caseId: CASE_ID,
        requirementId: DOC_ID,
        partyId: PARTY_ANNA,
        hidden: true,
      }),
    ).resolves.toBeUndefined();
    expect(mockInsertRequirementOverride).toHaveBeenCalled();
  });

  it("paralegal is denied (AuthzError, not admin/sales)", async () => {
    await expect(
      setRequirementVisibility(actor("paralegal"), {
        caseId: CASE_ID,
        requirementId: DOC_ID,
        partyId: PARTY_ANNA,
        hidden: true,
      }),
    ).rejects.toMatchObject({ reason: "forbidden_module" });
    expect(mockInsertRequirementOverride).not.toHaveBeenCalled();
  });

  it("rejects hiding a REQUIRED requirement", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc({ is_required: true })] });
    await expect(
      setRequirementVisibility(actor("admin"), {
        caseId: CASE_ID,
        requirementId: DOC_ID,
        partyId: PARTY_ANNA,
        hidden: true,
      }),
    ).rejects.toBeInstanceOf(CaseError);
    expect(mockInsertRequirementOverride).not.toHaveBeenCalled();
  });

  it("restore (hidden=false) deletes a visibility-only override", async () => {
    mockFindRequirementOverride.mockResolvedValue({
      id: "ov-1",
      case_id: CASE_ID,
      required_document_type_id: DOC_ID,
      party_id: PARTY_ANNA,
      is_hidden: true,
      is_required: null,
      custom_label_i18n: null,
    });
    await setRequirementVisibility(actor("admin"), {
      caseId: CASE_ID,
      requirementId: DOC_ID,
      partyId: PARTY_ANNA,
      hidden: false,
    });
    expect(mockDeleteRequirementOverride).toHaveBeenCalledWith(CASE_ID, "ov-1");
  });

  it("throws when the requirement does not exist in this case", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [] });
    await expect(
      setRequirementVisibility(actor("admin"), {
        caseId: CASE_ID,
        requirementId: DOC_ID,
        partyId: PARTY_ANNA,
        hidden: true,
      }),
    ).rejects.toMatchObject({ code: "DOC_REQUIREMENT_NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// getDocumentsMatrix — resolvePartyName (applicant) + hidden visibility
// ---------------------------------------------------------------------------

describe("getDocumentsMatrix party name + hidden", () => {
  it("resolves the applicant (user_id party) name for per-party docs", async () => {
    const APPLICANT = "44444444-4444-4444-8444-000000000001";
    mockGetCaseParties.mockResolvedValue([
      { id: APPLICANT, party_role: "petitioner", person_record_id: null, user_id: "user-maria", position: 0 },
    ]);
    mockFindClientDisplayName.mockResolvedValue("María");
    mockGetCaseRequirements.mockResolvedValue({
      documents: [expandedDoc({ key: `${DOC_ID}:${APPLICANT}`, party_id: APPLICANT })],
    });

    const res = await getDocumentsMatrix(actor("admin"), CASE_ID, { includeHidden: true });
    expect(res.items).toHaveLength(1);
    expect(res.items[0].partyName).toBe("María");
  });

  it("staff sees hidden requirements flagged; client never does", async () => {
    mockGetRequirementOverrides.mockResolvedValue([
      { id: "ov-1", required_document_type_id: DOC_ID, party_id: PARTY_ANNA, is_hidden: true, is_required: null, custom_label_i18n: null },
    ]);
    // The catalog resolver honors include_hidden — emulate both audiences.
    mockGetCaseRequirements.mockImplementation(async (input: { include_hidden?: boolean }) =>
      input.include_hidden
        ? { documents: [expandedDoc({ is_hidden: true })] }
        : { documents: [] },
    );

    const staff = await getDocumentsMatrix(actor("admin"), CASE_ID, { includeHidden: true });
    expect(staff.items).toHaveLength(1);
    expect(staff.items[0].isHidden).toBe(true);

    const client = await getDocumentsMatrix(CLIENT_ACTOR, CASE_ID, { includeHidden: true });
    // Defense in depth: client never receives hidden items even if the flag leaks.
    expect(client.items).toHaveLength(0);
  });

  it("counts BOTH required and optional requirements toward the total", async () => {
    // 1 required + 2 optional, none hidden → total must be 3 (not 1).
    mockGetCaseRequirements.mockResolvedValue({
      documents: [
        expandedDoc({ key: "req:case", required_document_type_id: "req-doc", party_id: null, is_required: true }),
        expandedDoc({ key: "opt1:case", required_document_type_id: "opt-doc-1", party_id: null, is_required: false }),
        expandedDoc({ key: "opt2:case", required_document_type_id: "opt-doc-2", party_id: null, is_required: false }),
      ],
    });

    const res = await getDocumentsMatrix(actor("admin"), CASE_ID, { includeHidden: true });
    expect(res.items).toHaveLength(3);
    expect(res.total).toBe(3); // was 1 (required-only) before the fix
    expect(res.done).toBe(0);
  });

  it("excludes optional requirements the staff hid for this case from the total", async () => {
    // 1 required + 1 optional-hidden → total counts only the non-hidden (1).
    mockGetCaseRequirements.mockResolvedValue({
      documents: [
        expandedDoc({ key: "req:case", required_document_type_id: "req-doc", party_id: null, is_required: true }),
        expandedDoc({ key: "opt:case", required_document_type_id: "opt-doc", party_id: null, is_required: false, is_hidden: true }),
      ],
    });

    const res = await getDocumentsMatrix(actor("admin"), CASE_ID, { includeHidden: true });
    expect(res.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getDocumentsGateStatus (Ola 2 — "documents 100% → forms" gate)
// ---------------------------------------------------------------------------

/** A minimal case_documents row buildDocumentsMatrix can group + score. */
function uploadedDoc(over: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    required_document_type_id: DOC_ID,
    party_id: PARTY_ANNA,
    status: "approved",
    display_name: "Pasaporte",
    original_filename: "pasaporte.pdf",
    mime_type: "application/pdf",
    created_at: new Date().toISOString(),
    rejection_reason_i18n: null,
    correction_due_at: null,
    translation_not_required: true,
    ...over,
  };
}

describe("getDocumentsGateStatus", () => {
  it("is INCOMPLETE when a visible document is not uploaded", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc()] });
    mockListCaseDocuments.mockResolvedValue([]); // nothing uploaded → pendiente

    const gate = await getDocumentsGateStatus(CLIENT_ACTOR, CASE_ID);
    expect(gate).toMatchObject({ complete: false, done: 0, total: 1 });
  });

  it("is COMPLETE once every visible document is uploaded (uploaded counts, not only approved)", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc()] });
    // 'uploaded' (pending staff review) already satisfies the client-facing gate.
    mockListCaseDocuments.mockResolvedValue([uploadedDoc({ status: "uploaded" })]);

    const gate = await getDocumentsGateStatus(CLIENT_ACTOR, CASE_ID);
    expect(gate).toMatchObject({ complete: true, done: 1, total: 1 });
  });

  it("is OPEN when the case requests no documents (nothing to block)", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [] });
    mockListCaseDocuments.mockResolvedValue([]);

    const gate = await getDocumentsGateStatus(CLIENT_ACTOR, CASE_ID);
    expect(gate).toMatchObject({ complete: true, total: 0 });
  });

  it("does NOT count a staff-hidden optional requirement (denominator shrinks to 0 → open)", async () => {
    mockGetCaseRequirements.mockResolvedValue({
      documents: [expandedDoc({ is_required: false, is_hidden: true })],
    });
    mockListCaseDocuments.mockResolvedValue([]);

    const gate = await getDocumentsGateStatus(CLIENT_ACTOR, CASE_ID);
    expect(gate).toMatchObject({ complete: true, total: 0 });
  });

  it("a rejected document still counts as pending → gate stays incomplete", async () => {
    mockGetCaseRequirements.mockResolvedValue({ documents: [expandedDoc()] });
    mockListCaseDocuments.mockResolvedValue([uploadedDoc({ status: "rejected" })]);

    const gate = await getDocumentsGateStatus(CLIENT_ACTOR, CASE_ID);
    expect(gate.complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFormForClient / saveFormDraft — gate ENFORCEMENT + existing-response exemption
// (the two blockers: gate must bite on read AND write, but never hide already-
// started/finished work). Default state (beforeEach) = incomplete docs, gated
// client form, no existing response.
// ---------------------------------------------------------------------------

describe("documents gate enforcement (getFormForClient / saveFormDraft)", () => {
  it("READ: throws FORMS_LOCKED for a not-yet-started gated form while docs incomplete", async () => {
    await expect(
      getFormForClient(CLIENT_ACTOR, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null }),
    ).rejects.toThrow("FORMS_LOCKED_DOCS_INCOMPLETE");
  });

  it("READ: does NOT gate a form the client already started/submitted (existing response is exempt)", async () => {
    // Karelis scenario: an approved I-589 must stay viewable even with incomplete docs.
    mockFindFormResponse.mockResolvedValue({ id: "resp-1", status: "approved", automation_version_id: null, answers: {} });
    await expect(
      getFormForClient(CLIENT_ACTOR, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null }),
    ).resolves.toBeTruthy();
  });

  it("READ: does NOT gate once documents are complete", async () => {
    mockListCaseDocuments.mockResolvedValue([uploadedDoc({ status: "approved" })]);
    await expect(
      getFormForClient(CLIENT_ACTOR, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null }),
    ).resolves.toBeTruthy();
  });

  it("READ: does NOT gate an EXEMPT form (requires_documents_complete=false)", async () => {
    mockFindFormDefinitionById.mockResolvedValue({
      id: FORM_ID, slug: "intake", kind: "pdf_automation", filled_by: "client",
      is_per_party: false, party_roles: null, is_active: true,
      label_i18n: { es: "F", en: "F" }, requires_documents_complete: false,
    });
    await expect(
      getFormForClient(CLIENT_ACTOR, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null }),
    ).resolves.toBeTruthy();
  });

  it("READ: never gates STAFF (only clients are gated)", async () => {
    await expect(
      getFormForClient(actor("admin"), { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null }),
    ).resolves.toBeTruthy();
  });

  it("WRITE: blocks the first saveDraft that would CREATE a response on a locked form", async () => {
    await expect(
      saveFormDraft(CLIENT_ACTOR, { caseId: CASE_ID, formDefinitionId: FORM_ID, partyId: null, patch: { q1: "x" } }),
    ).rejects.toThrow("FORMS_LOCKED_DOCS_INCOMPLETE");
  });
});
