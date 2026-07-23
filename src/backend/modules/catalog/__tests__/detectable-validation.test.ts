/**
 * Required documents — `detectable_in_combined` validation (combined uploads).
 *
 * A type can only be detectable inside another upload when the AI can actually
 * extract it: ai_extract=true + extraction_schema + accepted_format='pdf'.
 * Otherwise → CATALOG_DETECTABLE_REQUIRES_EXTRACT. On UPDATE the rule holds
 * against the EFFECTIVE state (patch ∪ existing row) so a partial patch can't
 * silently break the precondition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  repo: {
    requiredDocSlugExists: vi.fn().mockResolvedValue(false),
    insertRequiredDocument: vi.fn(),
    updateRequiredDocument: vi.fn(),
    findRequiredDocById: vi.fn(),
  },
  can: vi.fn(),
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repository")>()),
  requiredDocSlugExists: mocks.repo.requiredDocSlugExists,
  insertRequiredDocument: mocks.repo.insertRequiredDocument,
  updateRequiredDocument: mocks.repo.updateRequiredDocument,
  findRequiredDocById: mocks.repo.findRequiredDocById,
}));
vi.mock("@/backend/platform/authz", () => ({
  can: mocks.can,
  requireCaseAccess: vi.fn(),
  AuthzError: class AuthzError extends Error {},
}));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));
vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: vi.fn(),
}));
vi.mock("@/backend/platform/pdf", () => ({
  detectAcroFields: vi.fn(),
  fillAcroForm: vi.fn(),
}));
vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn(), emitAndWait: vi.fn(), on: vi.fn() },
}));
vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

import { createRequiredDocument, updateRequiredDocument } from "../service";

const PHASE_ID = "11111111-1111-4111-8111-000000000001";
const DOC_ID = "22222222-2222-4222-8222-000000000001";

const ADMIN = {
  userId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  orgId: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
  kind: "staff" as const,
  role: "admin" as const,
  permissions: new Map(),
};

const SCHEMA = {
  type: "object",
  properties: { declarant_name: { type: "string" } },
  required: ["declarant_name"],
};

function createDto(over: Record<string, unknown> = {}) {
  return {
    service_phase_id: PHASE_ID,
    slug: "declaracion-jurada",
    label_i18n: { es: "Declaración jurada", en: "Sworn declaration" },
    is_required: false,
    is_per_party: false,
    ai_extract: true,
    extraction_schema: SCHEMA,
    accepted_format: "pdf" as const,
    allow_multiple: false,
    detectable_in_combined: true,
    detection_hints_i18n: { es: "Narrativa firmada", en: "Signed narrative" },
    position: 0,
    ...over,
  };
}

/** An existing row (DB shape) for the effective-state update checks. */
function existingRow(over: Record<string, unknown> = {}) {
  return {
    id: DOC_ID,
    service_phase_id: PHASE_ID,
    slug: "declaracion-jurada",
    label_i18n: { es: "Declaración jurada", en: "Sworn declaration" },
    help_i18n: null,
    category_i18n: null,
    is_required: false,
    is_per_party: false,
    party_roles: null,
    ai_extract: true,
    extraction_schema: SCHEMA,
    accepted_format: "pdf",
    allow_multiple: false,
    detectable_in_combined: true,
    detection_hints_i18n: null,
    requires_translation: false,
    requires_certified_copy: false,
    signature_role: null,
    position: 0,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(undefined);
  mocks.repo.requiredDocSlugExists.mockResolvedValue(false);
  mocks.repo.insertRequiredDocument.mockImplementation(async (row: unknown) => ({
    id: DOC_ID,
    ...(row as Record<string, unknown>),
  }));
  mocks.repo.updateRequiredDocument.mockImplementation(async (_id: string, patch: unknown) => ({
    ...existingRow(),
    ...(patch as Record<string, unknown>),
  }));
  mocks.repo.findRequiredDocById.mockResolvedValue(existingRow());
});

describe("createRequiredDocument — detectable_in_combined", () => {
  it("accepts detectable with ai_extract + schema + pdf", async () => {
    await expect(createRequiredDocument(ADMIN, createDto())).resolves.toMatchObject({
      id: DOC_ID,
    });
    expect(mocks.repo.insertRequiredDocument).toHaveBeenCalledTimes(1);
  });

  it("rejects detectable without ai_extract", async () => {
    await expect(
      createRequiredDocument(ADMIN, createDto({ ai_extract: false, extraction_schema: null })),
    ).rejects.toMatchObject({ code: "CATALOG_DETECTABLE_REQUIRES_EXTRACT" });
    expect(mocks.repo.insertRequiredDocument).not.toHaveBeenCalled();
  });

  it("rejects detectable without an extraction_schema", async () => {
    await expect(
      createRequiredDocument(ADMIN, createDto({ extraction_schema: null })),
    ).rejects.toMatchObject({ code: "CATALOG_DETECTABLE_REQUIRES_EXTRACT" });
  });

  it("rejects detectable on a PNG document (signatures never classify)", async () => {
    await expect(
      createRequiredDocument(ADMIN, createDto({ accepted_format: "png" })),
    ).rejects.toMatchObject({ code: "CATALOG_DETECTABLE_REQUIRES_EXTRACT" });
  });
});

describe("updateRequiredDocument — effective state (patch ∪ row)", () => {
  it("rejects a patch that turns OFF ai_extract while the row stays detectable", async () => {
    await expect(
      updateRequiredDocument(ADMIN, DOC_ID, { ai_extract: false, extraction_schema: null }),
    ).rejects.toMatchObject({ code: "CATALOG_DETECTABLE_REQUIRES_EXTRACT" });
    expect(mocks.repo.updateRequiredDocument).not.toHaveBeenCalled();
  });

  it("rejects turning detectable ON when the existing row has no schema", async () => {
    mocks.repo.findRequiredDocById.mockResolvedValue(
      existingRow({ detectable_in_combined: false, extraction_schema: null }),
    );
    await expect(
      updateRequiredDocument(ADMIN, DOC_ID, { detectable_in_combined: true }),
    ).rejects.toMatchObject({ code: "CATALOG_DETECTABLE_REQUIRES_EXTRACT" });
  });

  it("accepts turning detectable OFF together with ai_extract (consistent patch)", async () => {
    await expect(
      updateRequiredDocument(ADMIN, DOC_ID, {
        detectable_in_combined: false,
        ai_extract: false,
        extraction_schema: null,
      }),
    ).resolves.toBeTruthy();
    expect(mocks.repo.updateRequiredDocument).toHaveBeenCalledTimes(1);
  });

  it("an unrelated patch (label only) skips the effective-state lookup entirely", async () => {
    await expect(
      updateRequiredDocument(ADMIN, DOC_ID, { label_i18n: { es: "Otro", en: "Other" } }),
    ).resolves.toBeTruthy();
    expect(mocks.repo.findRequiredDocById).not.toHaveBeenCalled();
  });
});
