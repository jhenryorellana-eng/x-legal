/**
 * ai-engine — improveFormAnswerText (T5 "Mejorar con IA").
 *
 * All I/O mocked (repository, anthropic, ratelimit, authz). Covers:
 *  - config gate (no question / no ai_improve / empty instruction)
 *  - form mismatch + draft-version rejection (archived allowed — pinned drafts)
 *  - rate limit denial
 *  - input cap
 *  - deterministic stub short-circuit (no provider touched)
 *  - PII: raw A-Number never reaches the provider; token restored verbatim
 *  - output validation failure → AI_IMPROVE_OUTPUT_INVALID
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findQuestionForImprove: vi.fn(),
  };
  const authz = {
    can: vi.fn(),
    requireCaseAccess: vi.fn(),
  };
  const limitAiImprove = vi.fn();
  const isAiStubEnabled = vi.fn();

  const streamParams: unknown[] = [];
  let finalMessageText = "";
  const anthropicClient = {
    messages: {
      stream: vi.fn((params: unknown) => {
        streamParams.push(params);
        return {
          finalMessage: async () => ({
            usage: { input_tokens: 100, output_tokens: 50 },
            content: [{ type: "text", text: finalMessageText }],
            stop_reason: "end_turn",
            model: "claude-haiku-4-5",
          }),
        };
      }),
      create: vi.fn(),
    },
  };

  return {
    repo,
    authz,
    limitAiImprove,
    isAiStubEnabled,
    anthropicClient,
    streamParams,
    setFinalMessageText: (t: string) => {
      finalMessageText = t;
    },
    getAnthropicClient: vi.fn(() => anthropicClient),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock("../repository", () => mocks.repo);

vi.mock("@/backend/platform/authz", () => ({
  can: mocks.authz.can,
  requireCaseAccess: mocks.authz.requireCaseAccess,
  AuthzError: class AuthzError extends Error {
    constructor(code: string) {
      super(code);
      this.name = "AuthzError";
    }
  },
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: vi.fn(),
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));

vi.mock("@/backend/platform/ratelimit", () => ({
  limitAiImprove: mocks.limitAiImprove,
}));

vi.mock("@/backend/platform/gemini", () => ({
  getGeminiModels: vi.fn(),
  DEFAULT_GEMINI_MODEL: "gemini-2.5-flash",
}));

vi.mock("@/backend/platform/ai-stub", () => ({
  isAiStubEnabled: mocks.isAiStubEnabled,
}));

vi.mock("@/backend/platform/storage", () => ({
  createSignedDownloadUrl: vi.fn(),
  uploadBytesToStorage: vi.fn(),
  downloadBytesFromStorage: vi.fn(),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn(),
}));

vi.mock("@/backend/platform/pdf", () => ({
  renderMarkdownToPdf: vi.fn(),
  renderMarkdownToDocx: vi.fn(),
  renderCertifiedTranslationPdf: vi.fn(),
}));

vi.mock("@/backend/platform/url-utils", () => ({
  checkUrlReachable: vi.fn().mockResolvedValue({ reachable: true }),
  keepReachable: vi.fn(async (items: unknown[]) => items),
  isLikelyUrl: () => true,
}));

vi.mock("../events", () => ({
  emitGenerationCompleted: vi.fn(),
  emitGenerationFailed: vi.fn(),
  emitExtractionCompleted: vi.fn(),
}));

vi.mock("@/backend/modules/catalog", () => ({
  getServiceTranslationConfig: vi.fn(),
}));

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

import type { Actor } from "@/backend/platform/authz";
import { improveFormAnswerText, AiEngineError } from "../service";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUESTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeActor(): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    kind: "client",
    role: null,
    permissions: new Map(),
  } as unknown as Actor;
}

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: QUESTION_ID,
    question_i18n: { es: "Nombre completo y número A de cada persona", en: "Full name and A-Number" },
    field_type: "textarea",
    ai_improve: { instruction: "Una persona por línea: APELLIDO(S), Nombre(s) - A###-###-###." },
    version: { id: "version-1", status: "published", form_definition_id: FORM_ID },
    ...overrides,
  };
}

function baseInput(text = "diego armando perez gomez a312654987") {
  return { caseId: CASE_ID, formDefinitionId: FORM_ID, questionId: QUESTION_ID, text };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.streamParams.length = 0;
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
  mocks.limitAiImprove.mockResolvedValue({ allowed: true, reset: 0 });
  mocks.isAiStubEnabled.mockReturnValue(false);
  mocks.repo.findQuestionForImprove.mockResolvedValue(makeQuestion());
});

describe("improveFormAnswerText — gates", () => {
  it("requires case access first", async () => {
    mocks.authz.requireCaseAccess.mockRejectedValue(new Error("forbidden_case"));
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toThrow("forbidden_case");
    expect(mocks.repo.findQuestionForImprove).not.toHaveBeenCalled();
  });

  it("rejects when rate limited", async () => {
    mocks.limitAiImprove.mockResolvedValue({ allowed: false, reset: Date.now() });
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_RATE_LIMITED",
    });
  });

  it("rejects when the question does not exist", async () => {
    mocks.repo.findQuestionForImprove.mockResolvedValue(null);
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_NOT_ENABLED",
    });
  });

  it("rejects when the question belongs to ANOTHER form (anti-IDOR)", async () => {
    mocks.repo.findQuestionForImprove.mockResolvedValue(
      makeQuestion({ version: { id: "v", status: "published", form_definition_id: "otro-form" } }),
    );
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_NOT_ENABLED",
    });
  });

  it("rejects a draft version", async () => {
    mocks.repo.findQuestionForImprove.mockResolvedValue(
      makeQuestion({ version: { id: "v", status: "draft", form_definition_id: FORM_ID } }),
    );
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_NOT_ENABLED",
    });
  });

  it("accepts an ARCHIVED version (client draft pinned to it)", async () => {
    mocks.isAiStubEnabled.mockReturnValue(true);
    mocks.repo.findQuestionForImprove.mockResolvedValue(
      makeQuestion({ version: { id: "v", status: "archived", form_definition_id: FORM_ID } }),
    );
    const r = await improveFormAnswerText(makeActor(), baseInput("hola"));
    expect(r.improvedText).toBe("hola [mejorado-stub]");
  });

  it("rejects when ai_improve is not configured or empty", async () => {
    mocks.repo.findQuestionForImprove.mockResolvedValue(makeQuestion({ ai_improve: null }));
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_NOT_ENABLED",
    });

    mocks.repo.findQuestionForImprove.mockResolvedValue(
      makeQuestion({ ai_improve: { instruction: "   " } }),
    );
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_NOT_ENABLED",
    });
  });

  it("rejects text over the input cap", async () => {
    await expect(
      improveFormAnswerText(makeActor(), baseInput("x".repeat(10_001))),
    ).rejects.toMatchObject({ code: "AI_IMPROVE_TEXT_TOO_LONG" });
  });

  it("returns whitespace-only text unchanged (no provider call)", async () => {
    const r = await improveFormAnswerText(makeActor(), baseInput("   "));
    expect(r.improvedText).toBe("   ");
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
  });
});

describe("improveFormAnswerText — stub", () => {
  it("short-circuits deterministically without touching the provider", async () => {
    mocks.isAiStubEnabled.mockReturnValue(true);
    const r = await improveFormAnswerText(makeActor(), baseInput("hola como estas"));
    expect(r.improvedText).toBe("hola como estas [mejorado-stub]");
    expect(mocks.anthropicClient.messages.stream).not.toHaveBeenCalled();
    expect(mocks.getAnthropicClient).not.toHaveBeenCalled();
  });
});

describe("improveFormAnswerText — PII round-trip", () => {
  it("never sends the raw A-Number to the provider and restores it verbatim", async () => {
    mocks.setFinalMessageText("PEREZ GOMEZ, Diego Armando - [[PII_1]]");

    const r = await improveFormAnswerText(makeActor(), baseInput());

    // The provider saw the token, never the raw number:
    const params = mocks.streamParams[0] as { messages: Array<{ content: string }>; system: string };
    expect(params.messages[0].content).toContain("[[PII_1]]");
    expect(params.messages[0].content).not.toContain("a312654987");
    // The instruction and field label travel in the user message:
    expect(params.messages[0].content).toContain("APELLIDO(S), Nombre(s)");
    expect(params.messages[0].content).toContain("Nombre completo y número A");

    // Restored digits are the client's own; the A-Number is then normalized
    // DETERMINISTICALLY to the canonical A-######### (Henry, 2026-07-16):
    expect(r.improvedText).toBe("PEREZ GOMEZ, Diego Armando - A-312654987");
  });

  it("rejects an output that dropped the PII token (answer stays untouched)", async () => {
    mocks.setFinalMessageText("PEREZ GOMEZ, Diego Armando");
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_IMPROVE_OUTPUT_INVALID",
    });
  });

  it("wraps provider failures as AI_PROVIDER_UNAVAILABLE", async () => {
    mocks.anthropicClient.messages.stream.mockImplementationOnce(() => {
      throw new Error("529 overloaded");
    });
    await expect(improveFormAnswerText(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });
});

describe("improveFormAnswerText — error typing", () => {
  it("throws AiEngineError instances (typed codes for the action envelope)", async () => {
    mocks.repo.findQuestionForImprove.mockResolvedValue(null);
    try {
      await improveFormAnswerText(makeActor(), baseInput());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AiEngineError);
    }
  });
});
