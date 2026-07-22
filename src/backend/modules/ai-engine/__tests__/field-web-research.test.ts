/**
 * ai-engine — runFieldWebResearch (web_research "Buscar", buscador + IA).
 *
 * All I/O mocked (repository, anthropic, ratelimit, authz). Covers:
 *  - config gate (not a web_research question / template without {{INPUT}})
 *  - form mismatch + draft-version rejection
 *  - rate limit denial + empty query
 *  - deterministic stub short-circuit (no provider touched)
 *  - happy path: {{INPUT}} substituted into the system prompt (query never left literal),
 *    address returned, web citations extracted from web_search_tool_result blocks
 *  - provider failure → AI_PROVIDER_UNAVAILABLE; empty output → WEB_RESEARCH_OUTPUT_INVALID
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const repo = {
    findQuestionForWebResearch: vi.fn(),
  };
  const authz = {
    can: vi.fn(),
    requireCaseAccess: vi.fn(),
  };
  const limitAiWebResearch = vi.fn();
  const isAiStubEnabled = vi.fn();

  const createParams: unknown[] = [];
  let createResult: { content: unknown[]; usage: { input_tokens: number; output_tokens: number }; model: string } = {
    content: [],
    usage: { input_tokens: 0, output_tokens: 0 },
    model: "claude-sonnet-4-6",
  };
  let createThrows: Error | null = null;
  const anthropicClient = {
    messages: {
      stream: vi.fn(),
      create: vi.fn(async (params: unknown) => {
        createParams.push(params);
        if (createThrows) throw createThrows;
        return createResult;
      }),
    },
  };

  return {
    repo,
    authz,
    limitAiWebResearch,
    isAiStubEnabled,
    anthropicClient,
    createParams,
    setCreateResult: (r: typeof createResult) => {
      createResult = r;
    },
    setCreateThrows: (e: Error | null) => {
      createThrows = e;
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

vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: vi.fn() }));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
  DEFAULT_UI_MODEL: "claude-haiku-4-5",
}));

vi.mock("@/backend/platform/ratelimit", () => ({
  limitAiWebResearch: mocks.limitAiWebResearch,
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

vi.mock("@/backend/platform/logger", () => ({ logger: mocks.logger }));
vi.mock("@/backend/modules/audit", () => ({ writeAudit: vi.fn() }));
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
vi.mock("@/backend/modules/catalog", () => ({ getServiceTranslationConfig: vi.fn() }));
vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(),
  createServerClient: vi.fn(),
}));

import type { Actor } from "@/backend/platform/authz";
import { runFieldWebResearch, AiEngineError } from "../service";

const CASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUESTION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeActor(): Actor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    kind: "staff",
    role: "admin",
    permissions: new Map(),
  } as unknown as Actor;
}

const TEMPLATE =
  "Esta es la direccion del corte del juez {{INPUT}}, y con esa direccion buscame la direccion del fiscal principal para enviarle la copia de Proof of Service";

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: QUESTION_ID,
    source: "web_research",
    source_ref: {
      system_prompt_template: TEMPLATE,
      reference_url: "https://www.ice.gov/contact/field-offices?office=12",
      max_uses: 5,
    },
    version: { id: "version-1", status: "published", form_definition_id: FORM_ID },
    ...overrides,
  };
}

function baseInput(query = "8701 S. Gessner Road, Houston, TX 77074") {
  return { caseId: CASE_ID, formDefinitionId: FORM_ID, questionId: QUESTION_ID, query };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createParams.length = 0;
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
  mocks.limitAiWebResearch.mockResolvedValue({ allowed: true, reset: 0 });
  mocks.isAiStubEnabled.mockReturnValue(false);
  mocks.repo.findQuestionForWebResearch.mockResolvedValue(makeQuestion());
  mocks.setCreateThrows(null);
  mocks.setCreateResult({
    content: [
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://www.ice.gov/contact/field-offices?office=12", title: "ICE OPLA Houston" },
          { type: "web_search_result", url: "https://www.ice.gov/contact/field-offices?office=12", title: "dup ignored" },
        ],
      },
      { type: "text", text: "U.S. ICE / OPLA — Office of the Chief Counsel\n126 Northpoint Drive, Room 2020\nHouston, TX 77060" },
    ],
    usage: { input_tokens: 500, output_tokens: 80 },
    model: "claude-sonnet-4-6",
  });
});

describe("runFieldWebResearch", () => {
  it("denies when rate-limited (no provider call)", async () => {
    mocks.limitAiWebResearch.mockResolvedValue({ allowed: false, reset: 0 });
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_RATE_LIMITED",
    });
    expect(mocks.anthropicClient.messages.create).not.toHaveBeenCalled();
  });

  it("rejects an empty query", async () => {
    await expect(runFieldWebResearch(makeActor(), baseInput("   "))).rejects.toMatchObject({
      code: "WEB_RESEARCH_EMPTY_QUERY",
    });
  });

  it("rejects a non-web_research question", async () => {
    mocks.repo.findQuestionForWebResearch.mockResolvedValue(makeQuestion({ source: "client_answer" }));
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_NOT_ENABLED",
    });
  });

  it("rejects when the form does not match the question's version", async () => {
    mocks.repo.findQuestionForWebResearch.mockResolvedValue(
      makeQuestion({ version: { id: "v", status: "published", form_definition_id: "other-form" } }),
    );
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_NOT_ENABLED",
    });
  });

  it("rejects a draft version", async () => {
    mocks.repo.findQuestionForWebResearch.mockResolvedValue(
      makeQuestion({ version: { id: "v", status: "draft", form_definition_id: FORM_ID } }),
    );
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_NOT_ENABLED",
    });
  });

  it("rejects a template missing the {{INPUT}} token", async () => {
    mocks.repo.findQuestionForWebResearch.mockResolvedValue(
      makeQuestion({ source_ref: { system_prompt_template: "Busca una dirección." } }),
    );
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_NOT_ENABLED",
    });
  });

  it("short-circuits on the E2E stub (no provider call)", async () => {
    mocks.isAiStubEnabled.mockReturnValue(true);
    const r = await runFieldWebResearch(makeActor(), baseInput());
    expect(r.address).toContain("Northpoint");
    expect(mocks.anthropicClient.messages.create).not.toHaveBeenCalled();
  });

  it("substitutes {{INPUT}} into the system prompt (the token never reaches the model literally)", async () => {
    await runFieldWebResearch(makeActor(), baseInput("8701 S. Gessner Road, Houston, TX 77074"));
    const params = mocks.createParams[0] as { system: string; messages: Array<{ content: string }> };
    expect(params.system).toContain("8701 S. Gessner Road, Houston, TX 77074");
    expect(params.system).not.toContain("{{INPUT}}");
    // reference_url is appended to steer the search.
    expect(params.system).toContain("https://www.ice.gov/contact/field-offices?office=12");
    // The user turn carries the raw query.
    expect(params.messages[0].content).toBe("8701 S. Gessner Road, Houston, TX 77074");
  });

  it("masks PII in the query before it reaches the live web_search (A-Number never leaves the boundary)", async () => {
    await runFieldWebResearch(makeActor(), baseInput("Corte de Houston, expediente A312-654-987"));
    const params = mocks.createParams[0] as { system: string; messages: Array<{ content: string }> };
    // The A-Number is tokenized (DOC-74 §7.1) — neither the system prompt nor the user
    // turn carries the raw value.
    expect(params.system).not.toContain("A312-654-987");
    expect(params.messages[0].content).not.toContain("A312-654-987");
    expect(params.messages[0].content).toContain("[[PII_1]]");
    // The non-PII part of the address survives (masking is pattern-based, not word-based).
    expect(params.messages[0].content).toContain("Corte de Houston");
  });

  it("returns the produced address + deduped web citations", async () => {
    const r = await runFieldWebResearch(makeActor(), baseInput());
    expect(r.address).toContain("126 Northpoint Drive, Room 2020");
    expect(r.sources).toEqual([
      { uri: "https://www.ice.gov/contact/field-offices?office=12", title: "ICE OPLA Houston" },
    ]);
  });

  it("wraps provider failures as AI_PROVIDER_UNAVAILABLE", async () => {
    mocks.setCreateThrows(new Error("network down"));
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  });

  it("rejects an empty model output", async () => {
    mocks.setCreateResult({
      content: [{ type: "text", text: "   " }],
      usage: { input_tokens: 10, output_tokens: 0 },
      model: "claude-sonnet-4-6",
    });
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toMatchObject({
      code: "WEB_RESEARCH_OUTPUT_INVALID",
    });
  });

  it("errors are AiEngineError instances (mapped to a code by the action layer)", async () => {
    mocks.limitAiWebResearch.mockResolvedValue({ allowed: false, reset: 0 });
    await expect(runFieldWebResearch(makeActor(), baseInput())).rejects.toBeInstanceOf(AiEngineError);
  });
});
