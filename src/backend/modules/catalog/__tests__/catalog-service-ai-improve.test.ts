/**
 * Catalog service — "Mejorar con IA" per-question config (API-CAT-54).
 *
 * Covers:
 *   1. updateQuestionAiImprove — allowed on draft AND published versions
 *      (controlled exception to immutability), rejected on archived.
 *   2. Zod boundary — empty / oversized instruction rejected; null disables.
 *   3. Audit written with the new value.
 *   4. REGRESSION: upsertQuestion (editor autosave, full-row semantics) can
 *      never write nor wipe ai_improve — the key is omitted from its schema.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findVersionByQuestion: vi.fn(),
    updateQuestionAiImprove: vi.fn(),
    findVersionByGroup: vi.fn(),
    upsertQuestion: vi.fn(),
    getServiceSlugIndex: vi.fn(),
  };
  const can = vi.fn();
  const writeAudit = vi.fn();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { repo, can, writeAudit, logger };
});

vi.mock("../repository", () => ({
  findVersionByQuestion: mocks.repo.findVersionByQuestion,
  updateQuestionAiImprove: mocks.repo.updateQuestionAiImprove,
  findVersionByGroup: mocks.repo.findVersionByGroup,
  upsertQuestion: mocks.repo.upsertQuestion,
  getServiceSlugIndex: mocks.repo.getServiceSlugIndex,
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/backend/platform/pdf", () => ({
  detectAcroFields: vi.fn(),
  fillAcroForm: vi.fn(),
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: vi.fn(),
}));

vi.mock("@/backend/platform/authz", () => ({
  can: mocks.can,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: mocks.writeAudit,
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/platform/events", () => ({
  appEvents: { emit: vi.fn() },
}));

vi.mock("@/backend/modules/ai-engine", () => ({
  proposeFormSegmentation: vi.fn(),
  proposeExtractionSchema: vi.fn(),
  startGeneration: vi.fn(),
  extractRawTextFromStorage: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/backend/platform/storage", () => ({
  validateUploadedObject: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  createSignedDownloadUrl: vi.fn(),
}));

vi.mock("@/shared/constants/profile-fields", () => ({
  PROFILE_SOURCE_FIELDS: ["first_name", "last_name", "email"],
}));

vi.mock("@/shared/constants/ai-models", () => ({
  GENERATION_MODELS: ["claude-fable-5", "claude-sonnet-4-6", "claude-haiku-4-5"],
}));

import type { Actor } from "@/backend/platform/authz";
import { updateQuestionAiImprove, upsertQuestion } from "../service";

const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";

function makeActor(): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    kind: "staff",
    role: "admin",
    permissions: new Map(),
  };
}

function makeVersion(status: string) {
  return {
    id: "version-id-111",
    form_definition_id: "form-id-111",
    version: 2,
    source_pdf_path: null,
    detected_fields: [],
    status,
    published_at: status === "published" ? "2026-07-15T00:00:00Z" : null,
    created_by: "11111111-1111-4111-8111-111111111111",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.can.mockReturnValue(undefined);
  mocks.writeAudit.mockResolvedValue(undefined);
  mocks.repo.updateQuestionAiImprove.mockResolvedValue(undefined);
});

describe("updateQuestionAiImprove — version status gate", () => {
  it("updates on a DRAFT version", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(makeVersion("draft"));

    await updateQuestionAiImprove(makeActor(), {
      question_id: QUESTION_ID,
      ai_improve: { instruction: "Una persona por línea." },
    });

    expect(mocks.repo.updateQuestionAiImprove).toHaveBeenCalledWith(QUESTION_ID, {
      instruction: "Una persona por línea.",
    });
  });

  it("updates on a PUBLISHED version (controlled immutability exception)", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(makeVersion("published"));

    await updateQuestionAiImprove(makeActor(), {
      question_id: QUESTION_ID,
      ai_improve: { instruction: "Formato APELLIDO(S), Nombre(s) - A###-###-###." },
    });

    expect(mocks.repo.updateQuestionAiImprove).toHaveBeenCalledTimes(1);
  });

  it("rejects an ARCHIVED version", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(makeVersion("archived"));

    await expect(
      updateQuestionAiImprove(makeActor(), {
        question_id: QUESTION_ID,
        ai_improve: { instruction: "x" },
      }),
    ).rejects.toMatchObject({ code: "CATALOG_VERSION_PUBLISHED_IMMUTABLE" });
    expect(mocks.repo.updateQuestionAiImprove).not.toHaveBeenCalled();
  });

  it("rejects when the question has no version (not found)", async () => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(null);

    await expect(
      updateQuestionAiImprove(makeActor(), {
        question_id: QUESTION_ID,
        ai_improve: null,
      }),
    ).rejects.toMatchObject({ code: "CATALOG_FORM_NOT_FOUND" });
  });

  it("requires catalog edit permission", async () => {
    mocks.can.mockImplementation(() => {
      throw new Error("forbidden");
    });

    await expect(
      updateQuestionAiImprove(makeActor(), {
        question_id: QUESTION_ID,
        ai_improve: null,
      }),
    ).rejects.toThrow("forbidden");
    expect(mocks.repo.findVersionByQuestion).not.toHaveBeenCalled();
  });
});

describe("updateQuestionAiImprove — Zod boundary + audit", () => {
  beforeEach(() => {
    mocks.repo.findVersionByQuestion.mockResolvedValue(makeVersion("published"));
  });

  it("null disables the config", async () => {
    await updateQuestionAiImprove(makeActor(), { question_id: QUESTION_ID, ai_improve: null });
    expect(mocks.repo.updateQuestionAiImprove).toHaveBeenCalledWith(QUESTION_ID, null);
  });

  it("rejects an empty instruction", async () => {
    await expect(
      updateQuestionAiImprove(makeActor(), {
        question_id: QUESTION_ID,
        ai_improve: { instruction: "" },
      }),
    ).rejects.toThrow();
    expect(mocks.repo.updateQuestionAiImprove).not.toHaveBeenCalled();
  });

  it("rejects an instruction over 4000 chars", async () => {
    await expect(
      updateQuestionAiImprove(makeActor(), {
        question_id: QUESTION_ID,
        ai_improve: { instruction: "x".repeat(4001) },
      }),
    ).rejects.toThrow();
  });

  it("writes an audit entry with the new value", async () => {
    await updateQuestionAiImprove(makeActor(), {
      question_id: QUESTION_ID,
      ai_improve: { instruction: "Limpieza de dictado." },
    });

    expect(mocks.writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      "catalog.form_questions.updated",
      "form_questions",
      QUESTION_ID,
      { after: { ai_improve: { instruction: "Limpieza de dictado." } } },
    );
  });
});

describe("REGRESSION — upsertQuestion never writes ai_improve", () => {
  it("strips ai_improve from the editor autosave payload (full-row upsert can't wipe it)", async () => {
    mocks.repo.findVersionByGroup.mockResolvedValue(makeVersion("draft"));
    mocks.repo.upsertQuestion.mockResolvedValue({ id: QUESTION_ID });

    await upsertQuestion(makeActor(), {
      id: QUESTION_ID,
      group_id: GROUP_ID,
      question_i18n: { es: "¿Pregunta?" },
      help_i18n: null,
      field_type: "textarea",
      options: null,
      pdf_field_name: null,
      source_ref: null,
      validation: null,
      // A hostile/stale client sending ai_improve must NOT reach the repo:
      ai_improve: { instruction: "should be stripped" },
    });

    expect(mocks.repo.upsertQuestion).toHaveBeenCalledTimes(1);
    const row = mocks.repo.upsertQuestion.mock.calls[0][0] as Record<string, unknown>;
    expect("ai_improve" in row).toBe(false);
  });
});
