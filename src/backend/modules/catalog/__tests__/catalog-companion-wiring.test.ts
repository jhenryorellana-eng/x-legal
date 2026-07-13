/**
 * Catalog service — companion-questionnaire wiring + Pre-Mortem flag sync.
 *
 * Regression guard for the "memo doesn't read its questionnaire" trap: an
 * ai_letter created before its generation config never had its companion slug
 * added to input_form_slugs (ensureCompanionQuestionnaire only wires it when a
 * config already exists), and the editor's form picker cannot select a
 * questionnaire. The fix makes updateGenerationConfig auto-wire the companion on
 * every save, and keeps pre_mortem_enabled mirrored to the guide toggle in both
 * directions — so the whole thing is admin-configurable with no DB edit.
 *
 * Strategy: repository + platform side-effects mocked (vi.hoisted + vi.mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findFormDefinition: vi.fn(),
    getServiceSlugIndex: vi.fn(),
    findDataset: vi.fn(),
    findFormFillGuide: vi.fn(),
    findGenerationConfig: vi.fn(),
    upsertGenerationConfig: vi.fn(),
    upsertFormFillGuide: vi.fn(),
  };
  const can = vi.fn();
  const writeAudit = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { repo, can, writeAudit, logger };
});

vi.mock("../repository", () => ({
  findFormDefinition: mocks.repo.findFormDefinition,
  getServiceSlugIndex: mocks.repo.getServiceSlugIndex,
  findDataset: mocks.repo.findDataset,
  findFormFillGuide: mocks.repo.findFormFillGuide,
  findGenerationConfig: mocks.repo.findGenerationConfig,
  upsertGenerationConfig: mocks.repo.upsertGenerationConfig,
  upsertFormFillGuide: mocks.repo.upsertFormFillGuide,
}));

vi.mock("@/backend/platform/authz", () => ({ can: mocks.can }));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: mocks.writeAudit }));
vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/platform/events", () => ({ appEvents: { emit: vi.fn() } }));
vi.mock("@/backend/platform/supabase", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/backend/platform/pdf", () => ({ detectAcroFields: vi.fn(), fillAcroForm: vi.fn(), backfillNaTextFields: () => 0 }));
vi.mock("@/backend/platform/anthropic", () => ({ getAnthropicClient: vi.fn() }));
vi.mock("@/backend/platform/storage", () => ({ validateUploadedObject: vi.fn(), createSignedUploadUrl: vi.fn(), createSignedDownloadUrl: vi.fn() }));
vi.mock("@/backend/modules/ai-engine", () => ({ proposeFormSegmentation: vi.fn(), proposeExtractionSchema: vi.fn(), startGeneration: vi.fn() }));
vi.mock("@/shared/constants/profile-fields", () => ({ PROFILE_SOURCE_FIELDS: ["first_name", "last_name"] }));
vi.mock("@/shared/constants/ai-models", () => ({
  GENERATION_MODELS: ["claude-fable-5", "claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
  DEFAULT_GENERATION_MODEL: "claude-sonnet-4-6",
}));

import type { Actor } from "@/backend/platform/authz";
import { updateGenerationConfig, saveFormFillGuide } from "../service";

const MEMO_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const COMPANION_SLUG = "memo-reforzar-cuestionario";

function actor(): Actor {
  return { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222", kind: "staff" } as Actor;
}

/** findFormDefinition resolves the memo for MEMO_ID and the companion for COMPANION_ID. */
function wireFormLookups(companionId: string | null) {
  mocks.repo.findFormDefinition.mockImplementation(async (id: string) => {
    if (id === MEMO_ID) return { id: MEMO_ID, kind: "ai_letter", service_phase_id: PHASE_ID, slug: "memo-reforzar", companion_questionnaire_id: companionId };
    if (id === COMPANION_ID) return { id: COMPANION_ID, kind: "questionnaire", service_phase_id: PHASE_ID, slug: COMPANION_SLUG, companion_questionnaire_id: null };
    return null;
  });
}

function baseInput() {
  return {
    form_definition_id: MEMO_ID,
    system_prompt: "You are an attorney.",
    input_document_slugs: [],
    input_form_slugs: [] as string[],
    sections: [],
    assembly: null,
    pre_mortem_enabled: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.can.mockReturnValue(undefined);
  mocks.repo.getServiceSlugIndex.mockResolvedValue({ documents: [], forms: ["memo-reforzar", COMPANION_SLUG] });
  mocks.repo.findFormFillGuide.mockResolvedValue(null);
  mocks.repo.findGenerationConfig.mockResolvedValue(null);
  // upsert echoes what it received (plus a system_prompt for the audit line).
  mocks.repo.upsertGenerationConfig.mockImplementation(async (row: Record<string, unknown>) => ({ ...row }));
  mocks.repo.upsertFormFillGuide.mockImplementation(async (row: Record<string, unknown>) => ({ ...row }));
});

describe("updateGenerationConfig — companion auto-wiring", () => {
  it("adds the companion questionnaire slug to input_form_slugs even when the editor sends none", async () => {
    wireFormLookups(COMPANION_ID);
    await updateGenerationConfig(actor(), baseInput());
    const saved = mocks.repo.upsertGenerationConfig.mock.calls[0][0];
    expect(saved.input_form_slugs).toContain(COMPANION_SLUG);
  });

  it("does not duplicate the companion slug when it is already present", async () => {
    wireFormLookups(COMPANION_ID);
    await updateGenerationConfig(actor(), { ...baseInput(), input_form_slugs: [COMPANION_SLUG] });
    const saved = mocks.repo.upsertGenerationConfig.mock.calls[0][0];
    expect(saved.input_form_slugs.filter((s: string) => s === COMPANION_SLUG)).toHaveLength(1);
  });

  it("leaves input_form_slugs untouched when the letter has no companion", async () => {
    wireFormLookups(null);
    await updateGenerationConfig(actor(), baseInput());
    const saved = mocks.repo.upsertGenerationConfig.mock.calls[0][0];
    expect(saved.input_form_slugs).toEqual([]);
  });

  it("derives pre_mortem_enabled from the enabled guide, overriding the stale input flag", async () => {
    wireFormLookups(COMPANION_ID);
    mocks.repo.findFormFillGuide.mockResolvedValue({ enabled: true });
    await updateGenerationConfig(actor(), baseInput()); // input says false
    const saved = mocks.repo.upsertGenerationConfig.mock.calls[0][0];
    expect(saved.pre_mortem_enabled).toBe(true);
  });
});

describe("saveFormFillGuide — mirrors the toggle into the generation config", () => {
  it("updates the config's pre_mortem_enabled when the guide toggle changes", async () => {
    wireFormLookups(COMPANION_ID);
    mocks.repo.findGenerationConfig.mockResolvedValue({ form_definition_id: MEMO_ID, pre_mortem_enabled: false, system_prompt: "x" });
    await saveFormFillGuide(actor(), { form_definition_id: MEMO_ID, guide_markdown: "# guide", enabled: true });
    expect(mocks.repo.upsertGenerationConfig).toHaveBeenCalledTimes(1);
    expect(mocks.repo.upsertGenerationConfig.mock.calls[0][0].pre_mortem_enabled).toBe(true);
  });

  it("does nothing to the config when there is no generation config (pdf_automation guide)", async () => {
    wireFormLookups(null);
    mocks.repo.findGenerationConfig.mockResolvedValue(null);
    await saveFormFillGuide(actor(), { form_definition_id: MEMO_ID, guide_markdown: "# guide", enabled: true });
    expect(mocks.repo.upsertGenerationConfig).not.toHaveBeenCalled();
  });
});
