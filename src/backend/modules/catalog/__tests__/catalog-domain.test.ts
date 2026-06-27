/**
 * Catalog domain — pure rules tests.
 *
 * No IO, no mocks required for these tests.
 * Tests cover §2.4, §2.5, §2.6, §2.7 rules exactly.
 */

import { describe, it, expect } from "vitest";
import {
  validateServicePublication,
  validateEntryServiceLink,
  validateVersionPublication,
  validateSourceRef,
  expandPerPartyRequirements,
  applyRequirementOverrides,
  validateExtractionSchema,
  nextVersionNumber,
  isServiceContractable,
} from "@/backend/modules/catalog/domain";
import type {
  Service,
  ServicePlan,
  ServicePhase,
  AutomationVersion,
  QuestionGroup,
  Question,
  RequiredDocumentType,
  ExpandedRequirement,
  RequirementOverrideInput,
  VersionCtx,
} from "@/backend/modules/catalog/domain";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeService(overrides: Partial<Service> = {}): Service {
  return {
    id: "svc-1",
    org_id: "org-1",
    slug: "asilo-politico",
    category: "migratorio",
    label_i18n: { es: "Asilo Político", en: "Political Asylum" },
    description_i18n: { es: "Descripción", en: "Description" },
    long_description_i18n: null,
    benefits_i18n: null,
    icon: "doc",
    color: "accent",
    is_active: false,
    archived_at: null,
    is_public: true,
    entry_parent_service_id: null,
    entry_phase_id: null,
    contract_object_i18n: null,
    contract_scope_i18n: null,
    contract_special_clause_i18n: null,
    position: 0,
    ...overrides,
  };
}

function makePlan(overrides: Partial<ServicePlan> = {}): ServicePlan {
  return {
    id: "plan-1",
    service_id: "svc-1",
    kind: "self",
    price_cents: 100000,
    currency: "USD",
    requires_lawyer_validation: false,
    default_installments: 1,
    default_downpayment_cents: null,
    is_active: true,
    ...overrides,
  };
}

function makePhase(overrides: Partial<ServicePhase> = {}): ServicePhase {
  return {
    id: "phase-1",
    service_id: "svc-1",
    slug: "fase-1",
    label_i18n: { es: "Fase 1", en: "Phase 1" },
    description_i18n: null,
    client_explainer_i18n: { es: "Explicación", en: "Explanation" },
    position: 0,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<AutomationVersion> = {}): AutomationVersion {
  return {
    id: "ver-1",
    form_definition_id: "form-1",
    version: 1,
    source_pdf_path: "forms/form-1/v1/i-589.pdf",
    source_language: "en",
    detected_fields: [
      { pdf_field_name: "Applicant.LastName", field_type: "text", page: 1, rect: [10, 10, 100, 20] },
      { pdf_field_name: "Applicant.FirstName", field_type: "text", page: 1, rect: [10, 30, 100, 20] },
    ],
    status: "draft",
    published_at: null,
    created_by: "user-1",
    ...overrides,
  };
}

function makeGroup(overrides: Partial<QuestionGroup> = {}): QuestionGroup {
  return {
    id: "grp-1",
    automation_version_id: "ver-1",
    title_i18n: { es: "Información personal", en: "Personal information" },
    position: 0,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    group_id: "grp-1",
    question_i18n: { es: "Apellido", en: "Last name" },
    help_i18n: null,
    field_type: "text",
    options: null,
    pdf_field_name: "Applicant.LastName",
    source: "client_answer",
    source_ref: null,
    is_required: true,
    position: 0,
    validation: null,
    condition: null,
    ...overrides,
  };
}

function makeRequiredDoc(overrides: Partial<RequiredDocumentType> = {}): RequiredDocumentType {
  return {
    id: "doc-1",
    service_phase_id: "phase-1",
    slug: "pasaporte",
    label_i18n: { es: "Pasaporte", en: "Passport" },
    help_i18n: null,
    category_i18n: null,
    is_required: true,
    is_per_party: false,
    party_roles: null,
    ai_extract: false,
    extraction_schema: null,
    accepted_format: "pdf",
    allow_multiple: false,
    position: 0,
    is_active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §2.4 — validateServicePublication
// ---------------------------------------------------------------------------

describe("validateServicePublication", () => {
  it("passes with valid service, active plan, and phase with explainer", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan()],
      phases: [makePhase()],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("blocks archived service", () => {
    const result = validateServicePublication({
      service: makeService({ archived_at: "2026-01-01T00:00:00Z" }),
      plans: [makePlan()],
      phases: [makePhase()],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_SERVICE_ARCHIVED")).toBe(true);
  });

  it("blocks service with no active plans", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan({ is_active: false })],
      phases: [makePhase()],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_NO_ACTIVE_PLAN")).toBe(true);
  });

  it("blocks with_lawyer plan that lacks requires_lawyer_validation (RF-ADM-023 E2)", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan({ kind: "with_lawyer", requires_lawyer_validation: false })],
      phases: [makePhase()],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_PLAN_INCONSISTENT")).toBe(true);
  });

  it("passes with_lawyer plan with requires_lawyer_validation=true", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan({ kind: "with_lawyer", requires_lawyer_validation: true })],
      phases: [makePhase()],
    });
    // no blocking issue from plan
    expect(result.issues.filter((i) => i.code === "CATALOG_PLAN_INCONSISTENT")).toHaveLength(0);
  });

  it("blocks service with no phases", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan()],
      phases: [],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_NO_PHASES")).toBe(true);
  });

  it("blocks public service missing description_i18n bilingual text (DOC-23 §3.2 gate)", () => {
    const result = validateServicePublication({
      service: makeService({ description_i18n: { es: "Solo español", en: "" } }),
      plans: [makePlan()],
      phases: [makePhase()],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_I18N_INCOMPLETE")).toBe(true);
  });

  it("does NOT block non-public service that is missing description_i18n", () => {
    const result = validateServicePublication({
      service: makeService({ is_public: false, description_i18n: null }),
      plans: [makePlan()],
      phases: [makePhase()],
    });
    // description_i18n is only required for public services
    expect(result.issues.filter((i) => i.code === "CATALOG_I18N_INCOMPLETE" && i.ref?.entity?.includes("description"))).toHaveLength(0);
  });

  it("emits WARNING (not blocking) for phase missing client_explainer_i18n", () => {
    const result = validateServicePublication({
      service: makeService(),
      plans: [makePlan()],
      phases: [makePhase({ client_explainer_i18n: null })],
    });
    const warning = result.issues.find((i) => i.code === "CATALOG_EXPLAINER_MISSING");
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    // ok is true because explainer is a warning
    expect(result.ok).toBe(true);
  });

  it("blocks missing label_i18n on both service and phase", () => {
    const result = validateServicePublication({
      service: makeService({ label_i18n: { es: "", en: "" } }),
      plans: [makePlan()],
      phases: [makePhase({ label_i18n: {} })],
    });
    expect(result.ok).toBe(false);
    const blocking = result.issues.filter(
      (i) => i.severity === "blocking" && i.code === "CATALOG_I18N_INCOMPLETE",
    );
    expect(blocking.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// §2.5 — validateEntryServiceLink
// ---------------------------------------------------------------------------

describe("validateEntryServiceLink", () => {
  it("passes for non-entry service (both null)", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-1", entry_parent_service_id: null, entry_phase_id: null },
      parent: null,
      parentPhaseIds: [],
    });
    expect(issues).toHaveLength(0);
  });

  it("blocks inconsistent entry (only parent set, phase null)", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-1", entry_parent_service_id: "parent-1", entry_phase_id: null },
      parent: makeService({ id: "parent-1" }),
      parentPhaseIds: ["phase-2"],
    });
    expect(issues.some((i) => i.code === "CATALOG_ENTRY_INCONSISTENT")).toBe(true);
  });

  it("blocks self-reference (RF-ADM-021 E2)", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-1", entry_parent_service_id: "svc-1", entry_phase_id: "phase-1" },
      parent: makeService({ id: "svc-1" }),
      parentPhaseIds: ["phase-1"],
    });
    expect(issues.some((i) => i.code === "CATALOG_ENTRY_CHAIN_FORBIDDEN")).toBe(true);
  });

  it("blocks chain (parent is also an entry service — RF-ADM-021 E2)", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-child", entry_parent_service_id: "svc-parent", entry_phase_id: "phase-p" },
      parent: makeService({ id: "svc-parent", entry_parent_service_id: "svc-grandparent" }),
      parentPhaseIds: ["phase-p"],
    });
    expect(issues.some((i) => i.code === "CATALOG_ENTRY_CHAIN_FORBIDDEN")).toBe(true);
  });

  it("blocks when entry_phase_id does not belong to parent (RF-ADM-021 E1)", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-1", entry_parent_service_id: "parent-1", entry_phase_id: "phase-X" },
      parent: makeService({ id: "parent-1" }),
      parentPhaseIds: ["phase-1", "phase-2"],
    });
    expect(issues.some((i) => i.code === "CATALOG_ENTRY_PHASE_MISMATCH")).toBe(true);
  });

  it("passes for valid entry service link", () => {
    const issues = validateEntryServiceLink({
      service: { id: "svc-2", entry_parent_service_id: "svc-1", entry_phase_id: "phase-2" },
      parent: makeService({ id: "svc-1", entry_parent_service_id: null }),
      parentPhaseIds: ["phase-1", "phase-2"],
    });
    expect(issues.filter((i) => i.severity === "blocking")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2.6 — validateVersionPublication
// ---------------------------------------------------------------------------

describe("validateVersionPublication", () => {
  const ctx: VersionCtx = {
    documentSlugsWithSchema: {},
    aiLetterSlugs: [],
    profileFields: ["first_name", "last_name"],
  };

  it("passes for a well-formed draft version", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [makeQuestion()],
      ctx,
    });
    expect(result.ok).toBe(true);
  });

  it("blocks non-draft version", () => {
    const result = validateVersionPublication({
      version: makeVersion({ status: "published" }),
      groups: [makeGroup()],
      questions: [makeQuestion()],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_VERSION_NOT_DRAFT")).toBe(true);
  });

  it("blocks version with no detected_fields", () => {
    const result = validateVersionPublication({
      version: makeVersion({ detected_fields: [] }),
      groups: [makeGroup()],
      questions: [makeQuestion()],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_NO_ACROFORM_FIELDS")).toBe(true);
  });

  it("blocks version with no groups/questions", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [],
      questions: [],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_VERSION_EMPTY")).toBe(true);
  });

  it("blocks question with pdf_field_name not in detected_fields", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [makeQuestion({ pdf_field_name: "NonExistent.Field" })],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_PDF_FIELD_UNKNOWN")).toBe(true);
  });

  it("blocks duplicate pdf_field_name across two questions", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [
        makeQuestion({ id: "q-1", pdf_field_name: "Applicant.LastName" }),
        makeQuestion({ id: "q-2", pdf_field_name: "Applicant.LastName" }),
      ],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_PDF_FIELD_DUPLICATED")).toBe(true);
  });

  it("blocks select question with no options", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [
        makeQuestion({
          field_type: "select",
          options: [],
          pdf_field_name: "Applicant.LastName",
        }),
      ],
      ctx,
    });
    expect(result.issues.some((i) => i.code === "CATALOG_SELECT_WITHOUT_OPTIONS")).toBe(true);
  });

  it("emits warning for unmapped detected field (not signature)", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [makeQuestion()], // maps only LastName; FirstName is unmapped
      ctx,
    });
    const warning = result.issues.find(
      (i) => i.code === "CATALOG_PDF_FIELD_UNMAPPED" && i.ref?.pdf_field_name === "Applicant.FirstName",
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    // Still ok (only a warning)
    expect(result.ok).toBe(true);
  });

  it("does NOT warn for unmapped signature fields", () => {
    const version = makeVersion({
      detected_fields: [
        { pdf_field_name: "Signature", field_type: "signature", page: 1, rect: [0, 0, 100, 50] },
        { pdf_field_name: "Applicant.LastName", field_type: "text", page: 1, rect: [10, 10, 100, 20] },
      ],
    });
    const result = validateVersionPublication({
      version,
      groups: [makeGroup()],
      questions: [makeQuestion()], // only LastName mapped
      ctx,
    });
    expect(result.issues.some((i) => i.ref?.pdf_field_name === "Signature")).toBe(false);
  });

  it("blocks incomplete question_i18n bilingual text", () => {
    const result = validateVersionPublication({
      version: makeVersion(),
      groups: [makeGroup()],
      questions: [makeQuestion({ question_i18n: { es: "Solo ES", en: "" } })],
      ctx,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "CATALOG_I18N_INCOMPLETE")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2.6 — validateSourceRef
// ---------------------------------------------------------------------------

describe("validateSourceRef", () => {
  const ctx: VersionCtx = {
    documentSlugsWithSchema: { "acta-nacimiento": { properties: { nombre: { type: "string" } } } },
    aiLetterSlugs: ["carta-motivos"],
    profileFields: ["first_name"],
  };

  it("passes client_answer (no source_ref needed)", () => {
    const issues = validateSourceRef(makeQuestion({ source: "client_answer", source_ref: null }), ctx);
    expect(issues).toHaveLength(0);
  });

  it("passes valid document_extraction with known slug", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "document_extraction",
        source_ref: { document_slug: "acta-nacimiento", json_path: "nombre" },
      }),
      ctx,
    );
    expect(issues.filter((i) => i.severity === "blocking")).toHaveLength(0);
  });

  it("blocks document_extraction with unknown slug", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "document_extraction",
        source_ref: { document_slug: "slug-inexistente", json_path: "field" },
      }),
      ctx,
    );
    expect(issues.some((i) => i.code === "CATALOG_SOURCE_REF_INVALID")).toBe(true);
  });

  it("warns for document_extraction with unknown json_path (RF-ADM-033 E2)", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "document_extraction",
        source_ref: { document_slug: "acta-nacimiento", json_path: "ruta.inexistente.profunda" },
      }),
      ctx,
    );
    expect(issues.some((i) => i.code === "CATALOG_SOURCE_PATH_UNKNOWN" && i.severity === "warning")).toBe(true);
  });

  it("blocks generation_output with unknown form_slug", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "generation_output",
        source_ref: { form_slug: "slug-no-existe", output_path: "output.text" },
      }),
      ctx,
    );
    expect(issues.some((i) => i.code === "CATALOG_SOURCE_REF_INVALID")).toBe(true);
  });

  it("passes valid generation_output with known ai_letter slug", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "generation_output",
        source_ref: { form_slug: "carta-motivos", output_path: "output.text" },
      }),
      ctx,
    );
    expect(issues).toHaveLength(0);
  });

  it("passes profile source with whitelisted field", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "profile",
        source_ref: { profile_field: "first_name" },
      }),
      ctx,
    );
    expect(issues).toHaveLength(0);
  });

  it("blocks profile source with non-whitelisted field", () => {
    const issues = validateSourceRef(
      makeQuestion({
        source: "profile",
        source_ref: { profile_field: "secret_field" },
      }),
      ctx,
    );
    expect(issues.some((i) => i.code === "CATALOG_SOURCE_REF_INVALID")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §2.7 — expandPerPartyRequirements
// ---------------------------------------------------------------------------

describe("expandPerPartyRequirements", () => {
  it("non-per-party docs expand to single item with party_id=null", () => {
    const docs = [makeRequiredDoc({ is_per_party: false })];
    const parties = [{ id: "party-1", party_role: "petitioner" }];
    const result = expandPerPartyRequirements(docs, parties);
    expect(result).toHaveLength(1);
    expect(result[0].party_id).toBeNull();
    expect(result[0].key).toBe("doc-1:case");
  });

  it("per-party doc expands once per eligible party", () => {
    const docs = [
      makeRequiredDoc({
        id: "doc-per",
        is_per_party: true,
        party_roles: ["beneficiary"],
      }),
    ];
    const parties = [
      { id: "p1", party_role: "beneficiary" },
      { id: "p2", party_role: "beneficiary" },
      { id: "p3", party_role: "petitioner" }, // not eligible
    ];
    const result = expandPerPartyRequirements(docs, parties);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.party_id)).toEqual(["p1", "p2"]);
  });

  it("0 eligible parties → 0 items (RF-ADM-028 A1, no error)", () => {
    const docs = [
      makeRequiredDoc({
        id: "doc-per",
        is_per_party: true,
        party_roles: ["minor"],
      }),
    ];
    const parties = [{ id: "p1", party_role: "petitioner" }];
    const result = expandPerPartyRequirements(docs, parties);
    expect(result).toHaveLength(0);
  });

  it("skips inactive docs", () => {
    const docs = [makeRequiredDoc({ is_active: false })];
    const result = expandPerPartyRequirements(docs, []);
    expect(result).toHaveLength(0);
  });

  it("propagates accepted_format to every expanded item", () => {
    const docs = [
      makeRequiredDoc({ accepted_format: "png", is_per_party: true, party_roles: ["minor"] }),
    ];
    const parties = [
      { id: "p1", party_role: "minor" },
      { id: "p2", party_role: "minor" },
    ];
    const result = expandPerPartyRequirements(docs, parties);
    expect(result.map((r) => r.accepted_format)).toEqual(["png", "png"]);
  });
});

// ---------------------------------------------------------------------------
// §2.7 — applyRequirementOverrides
// ---------------------------------------------------------------------------

describe("applyRequirementOverrides", () => {
  function makeExpanded(overrides: Partial<ExpandedRequirement> = {}): ExpandedRequirement {
    return {
      key: "doc-1:case",
      required_document_type_id: "doc-1",
      party_id: null,
      label_i18n: { es: "Pasaporte", en: "Passport" },
      help_i18n: null,
      category_i18n: null,
      is_required: true,
      ai_extract: false,
      extraction_schema: null,
      accepted_format: "pdf",
      allow_multiple: false,
      position: 0,
      ...overrides,
    };
  }

  it("hides an override with is_hidden=true", () => {
    const expanded = [makeExpanded()];
    const overrides: RequirementOverrideInput[] = [
      { id: "ov-1", required_document_type_id: "doc-1", party_id: null, is_hidden: true },
    ];
    const result = applyRequirementOverrides(expanded, overrides);
    expect(result).toHaveLength(0);
  });

  it("changes is_required via override", () => {
    const expanded = [makeExpanded({ is_required: true })];
    const overrides: RequirementOverrideInput[] = [
      {
        id: "ov-1",
        required_document_type_id: "doc-1",
        party_id: null,
        is_required: false,
      },
    ];
    const result = applyRequirementOverrides(expanded, overrides);
    expect(result[0].is_required).toBe(false);
  });

  it("adds a custom requirement with required_document_type_id=null", () => {
    const expanded: ExpandedRequirement[] = [];
    const overrides: RequirementOverrideInput[] = [
      {
        id: "ov-custom",
        required_document_type_id: null,
        party_id: null,
        custom_label_i18n: { es: "Extra", en: "Extra" },
      },
    ];
    const result = applyRequirementOverrides(expanded, overrides);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("custom:ov-custom:case");
  });

  it("party-scoped override only affects matching party (not null override)", () => {
    const expanded = [
      makeExpanded({ key: "doc-1:p1", party_id: "p1" }),
      makeExpanded({ key: "doc-1:p2", party_id: "p2" }),
    ];
    const overrides: RequirementOverrideInput[] = [
      {
        id: "ov-1",
        required_document_type_id: "doc-1",
        party_id: "p1",
        is_required: false,
      },
    ];
    const result = applyRequirementOverrides(expanded, overrides);
    const p1 = result.find((r) => r.party_id === "p1");
    const p2 = result.find((r) => r.party_id === "p2");
    expect(p1?.is_required).toBe(false);
    expect(p2?.is_required).toBe(true);
  });

  // --- includeHidden: staff view keeps hidden items flagged (does not drop) ---

  it("with includeHidden=true, keeps a hidden item flagged instead of dropping it", () => {
    const expanded = [makeExpanded()];
    const overrides: RequirementOverrideInput[] = [
      { id: "ov-1", required_document_type_id: "doc-1", party_id: null, is_hidden: true },
    ];
    const result = applyRequirementOverrides(expanded, overrides, { includeHidden: true });
    expect(result).toHaveLength(1);
    expect(result[0].is_hidden).toBe(true);
    expect(result[0].override_id).toBe("ov-1");
  });

  it("with includeHidden=true, only the party-scoped instance is flagged hidden", () => {
    const expanded = [
      makeExpanded({ key: "doc-1:p1", party_id: "p1" }),
      makeExpanded({ key: "doc-1:p2", party_id: "p2" }),
    ];
    const overrides: RequirementOverrideInput[] = [
      { id: "ov-1", required_document_type_id: "doc-1", party_id: "p1", is_hidden: true },
    ];
    const result = applyRequirementOverrides(expanded, overrides, { includeHidden: true });
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.party_id === "p1")?.is_hidden).toBe(true);
    expect(result.find((r) => r.party_id === "p2")?.is_hidden ?? false).toBe(false);
  });

  it("client view (default) still drops the same hidden item", () => {
    const expanded = [makeExpanded()];
    const overrides: RequirementOverrideInput[] = [
      { id: "ov-1", required_document_type_id: "doc-1", party_id: null, is_hidden: true },
    ];
    expect(applyRequirementOverrides(expanded, overrides)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// §2.7 — isServiceContractable
// ---------------------------------------------------------------------------

describe("isServiceContractable", () => {
  it("true for active non-archived service", () => {
    expect(isServiceContractable(makeService({ is_active: true, archived_at: null }))).toBe(true);
  });

  it("false for inactive service", () => {
    expect(isServiceContractable(makeService({ is_active: false, archived_at: null }))).toBe(false);
  });

  it("false for archived service", () => {
    expect(isServiceContractable(makeService({ is_active: true, archived_at: "2025-01-01T00:00:00Z" }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// nextVersionNumber
// ---------------------------------------------------------------------------

describe("nextVersionNumber", () => {
  it("returns 1 when no versions exist", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  it("returns max+1", () => {
    expect(nextVersionNumber([{ version: 3 }, { version: 1 }, { version: 2 }])).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// validateExtractionSchema
// ---------------------------------------------------------------------------

describe("validateExtractionSchema", () => {
  it("accepts valid subset schema", () => {
    const schema = { type: "object", properties: { name: { type: "string" } } };
    expect(validateExtractionSchema(schema).valid).toBe(true);
  });

  it("rejects $ref (recursive — not Gemini-portable)", () => {
    const schema = { type: "object", $ref: "#/definitions/Name" };
    const { valid, reason } = validateExtractionSchema(schema);
    expect(valid).toBe(false);
    expect(reason).toContain("$ref");
  });

  it("rejects anyOf/oneOf/not", () => {
    expect(validateExtractionSchema({ anyOf: [] }).valid).toBe(false);
    expect(validateExtractionSchema({ oneOf: [] }).valid).toBe(false);
    expect(validateExtractionSchema({ not: {} }).valid).toBe(false);
  });

  it("rejects non-object schema", () => {
    expect(validateExtractionSchema("string").valid).toBe(false);
    expect(validateExtractionSchema(null).valid).toBe(false);
    expect(validateExtractionSchema([]).valid).toBe(false);
  });
});
