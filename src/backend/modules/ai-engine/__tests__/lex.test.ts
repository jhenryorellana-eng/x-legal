/**
 * ai-engine Lex case chat — unit tests.
 *
 * Pure domain (no mocks): chunkText (cap/overlap/words/unicode), sha256,
 * buildLexSystemPrompt (scope guards), buildAnswersDocument (labels/empties).
 *
 * Service (all I/O mocked — lex-repository, platform/*):
 *   - reindexCaseKnowledge: same content_hash → 0 embeds; changed → re-embed;
 *     deleted document → orphan sweep called without its key.
 *   - sendLexMessage: validation (LEX_MESSAGE_INVALID), no case access → throw,
 *     busy thread (LEX_BUSY), happy path enqueues lex-answer with 280s timeout.
 *   - executeLexAnswerJob with the AI stub: deterministic persisted answer with
 *     chunk sources + zero cost; single-spend no-op when already completed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  chunkText,
  sha256,
  buildCaseProfile,
  buildLexSystemPrompt,
  buildAnswersDocument,
  LEX_CHUNK_MAX_CHARS,
  LEX_MODELS,
  DEFAULT_LEX_MODEL,
} from "../lex-domain";

// ---------------------------------------------------------------------------
// Mocks (hoisted) — service dependencies
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const repo = {
    findThread: vi.fn(),
    getThreadById: vi.fn(),
    getOrCreateThread: vi.fn(),
    listMessages: vi.fn(),
    getMessageById: vi.fn(),
    findRunningMessage: vi.fn(),
    insertMessage: vi.fn(),
    updateAssistantMessage: vi.fn().mockResolvedValue(undefined),
    getCaseForProfile: vi.fn(),
    findCaseOrgId: vi.fn(),
    listIndexableDocuments: vi.fn(),
    listIndexableFormResponses: vi.fn(),
    listExistingChunks: vi.fn(),
    upsertChunk: vi.fn().mockResolvedValue(undefined),
    deleteChunksNotIn: vi.fn().mockResolvedValue(0),
    deleteSourceChunksFrom: vi.fn().mockResolvedValue(0),
    deleteDocumentChunks: vi.fn().mockResolvedValue(undefined),
    matchCaseKnowledge: vi.fn(),
    getOrgLexModel: vi.fn().mockResolvedValue(null),
    getUserLocale: vi.fn().mockResolvedValue("es"),
    hasPendingExtractions: vi.fn().mockResolvedValue(false),
  };

  const authz = {
    requireCaseAccess: vi.fn().mockResolvedValue(undefined),
    AuthzError: class AuthzError extends Error {
      constructor(public readonly reason: string) {
        super(reason);
        this.name = "AuthzError";
      }
    },
  };

  const qstash = { enqueueJob: vi.fn().mockResolvedValue({ messageId: "qstash-1" }) };
  const embeddings = {
    embedText: vi.fn().mockResolvedValue(new Array(768).fill(0.01)),
    toVectorLiteral: vi.fn((v: number[]) => `[${v.join(",")}]`),
  };
  const aiStub = { isAiStubEnabled: vi.fn(() => false) };
  const anthropicClient = { messages: { create: vi.fn(), stream: vi.fn() } };
  const getAnthropicClient = vi.fn(() => anthropicClient);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

  return { repo, authz, qstash, embeddings, aiStub, anthropicClient, getAnthropicClient, logger };
});

vi.mock("../lex-repository", () => mocks.repo);

vi.mock("@/backend/platform/authz", () => ({
  requireCaseAccess: mocks.authz.requireCaseAccess,
  AuthzError: mocks.authz.AuthzError,
}));

vi.mock("@/backend/platform/qstash", () => ({
  enqueueJob: mocks.qstash.enqueueJob,
}));

vi.mock("@/backend/platform/embeddings", () => ({
  embedText: mocks.embeddings.embedText,
  toVectorLiteral: mocks.embeddings.toVectorLiteral,
  EMBEDDING_DIM: 768,
}));

vi.mock("@/backend/platform/ai-stub", () => ({
  isAiStubEnabled: mocks.aiStub.isAiStubEnabled,
}));

vi.mock("@/backend/platform/anthropic", () => ({
  getAnthropicClient: mocks.getAnthropicClient,
  DEFAULT_LEX_MODEL: "claude-sonnet-4-6",
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: mocks.logger,
}));

// Imported AFTER the mocks (vitest hoists vi.mock anyway).
import {
  sendLexMessage,
  reindexCaseKnowledge,
  executeLexAnswerJob,
  type LexAnswerJobPayload,
} from "../lex-service";
import type { Actor } from "@/backend/platform/authz";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const STAFF_ID = "33333333-3333-4333-8333-333333333333";
const THREAD_ID = "44444444-4444-4444-8444-444444444444";

const STAFF_ACTOR: Actor = {
  userId: STAFF_ID,
  orgId: ORG_ID,
  kind: "staff",
  role: "admin",
  permissions: new Map(),
};

const PROFILE = {
  caseId: CASE_ID,
  orgId: ORG_ID,
  caseNumber: "T-0001",
  status: "active",
  currentStage: "intake",
  serviceName: "Asilo Político",
  planName: "self",
  currentPhase: "Fase 1",
  parties: [{ role: "petitioner", name: "Juana Pérez" }],
};

function profileText(): string {
  return buildCaseProfile({
    caseNumber: PROFILE.caseNumber,
    serviceName: PROFILE.serviceName,
    planName: PROFILE.planName,
    currentPhase: PROFILE.currentPhase,
    status: PROFILE.status,
    currentStage: PROFILE.currentStage,
    parties: PROFILE.parties,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authz.requireCaseAccess.mockResolvedValue(undefined);
  mocks.aiStub.isAiStubEnabled.mockReturnValue(false);
  mocks.embeddings.embedText.mockResolvedValue(new Array(768).fill(0.01));
  mocks.repo.updateAssistantMessage.mockResolvedValue(undefined);
  mocks.repo.deleteChunksNotIn.mockResolvedValue(0);
  mocks.repo.deleteSourceChunksFrom.mockResolvedValue(0);
  mocks.repo.getOrgLexModel.mockResolvedValue(null);
  mocks.repo.getUserLocale.mockResolvedValue("es");
  mocks.repo.hasPendingExtractions.mockResolvedValue(false);
});

// ---------------------------------------------------------------------------
// chunkText (pure)
// ---------------------------------------------------------------------------

describe("lex chunkText", () => {
  it("returns a single chunk for short text and [] for empty input", () => {
    expect(chunkText("hola caso")).toEqual(["hola caso"]);
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("respects the max chars cap on every chunk", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) => `P${i}-` + "x".repeat(990));
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      expect([...c].length).toBeLessThanOrEqual(LEX_CHUNK_MAX_CHARS);
    }
  });

  it("keeps context overlap between consecutive chunks (hard-split path)", () => {
    const text = "abcd".repeat(125); // 500 chars, single paragraph
    const chunks = chunkText(text, 200, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect([...chunks[0]].length).toBe(200);
    // The second chunk starts 150 chars in (200 - 50 overlap).
    expect(chunks[1].startsWith(text.slice(150, 200))).toBe(true);
  });

  it("does not cut words in paragraph mode", () => {
    // 100 paragraphs of 10 complete words each.
    let n = 0;
    const paragraphs = Array.from({ length: 100 }, () =>
      Array.from({ length: 10 }, () => `w${String(n++).padStart(4, "0")}`).join(" "),
    );
    const chunks = chunkText(paragraphs.join("\n\n"), 500, 100);
    expect(chunks.length).toBeGreaterThan(1);
    const wordRe = /^w\d{4}$/;
    for (const c of chunks) {
      for (const word of c.split(/\s+/)) {
        // A mid-word cut would produce a fragment failing the pattern.
        expect(wordRe.test(word)).toBe(true);
      }
    }
  });

  it("is unicode-safe: never emits lone surrogates when hard-splitting", () => {
    const text = "áéíóú ñ 😀 ".repeat(60); // single paragraph with astral chars
    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(1);
    const loneHigh = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
    const loneLow = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    for (const c of chunks) {
      expect([...c].length).toBeLessThanOrEqual(100);
      expect(loneHigh.test(c)).toBe(false);
      expect(loneLow.test(c)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// sha256 (pure)
// ---------------------------------------------------------------------------

describe("lex sha256", () => {
  it("matches the known sha-256 vector and is deterministic", () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abd")).not.toBe(sha256("abc"));
  });
});

// ---------------------------------------------------------------------------
// buildLexSystemPrompt (pure)
// ---------------------------------------------------------------------------

describe("buildLexSystemPrompt", () => {
  it("scopes Lex to THIS case and forbids inventing facts (es)", () => {
    const prompt = buildLexSystemPrompt({ serviceName: "Asilo Político", locale: "es" });
    expect(prompt).toContain("Asilo Político");
    expect(prompt).toContain("SOLO respondes sobre ESTE caso");
    expect(prompt).toContain("PROHIBIDO inventar");
    expect(prompt).toContain("USCIS/EOIR");
  });

  it("has the same guards in English", () => {
    const prompt = buildLexSystemPrompt({ serviceName: "Asylum", locale: "en" });
    expect(prompt).toContain("ONLY answer about THIS case");
    expect(prompt).toContain("NEVER invent facts");
    expect(prompt).toContain("politely refuse");
  });

  it("exposes the whitelisted models with the documented default", () => {
    expect(LEX_MODELS).toContain(DEFAULT_LEX_MODEL);
    expect(DEFAULT_LEX_MODEL).toBe("claude-sonnet-4-6");
  });
});

// ---------------------------------------------------------------------------
// buildAnswersDocument (pure)
// ---------------------------------------------------------------------------

describe("buildAnswersDocument", () => {
  it("renders P/R lines with labels and skips empty answers", () => {
    const doc = buildAnswersDocument(
      {
        q1: "  Juana Pérez ",
        q2: "",
        q3: null,
        q4: ["a", "b"],
        q5: "   ",
        q6: 42,
      },
      { q1: "Nombre completo", q4: "Países", q6: "Hijos" },
    );
    expect(doc).toContain("P: Nombre completo\nR: Juana Pérez");
    expect(doc).toContain("P: Países\nR: a, b");
    expect(doc).toContain("P: Hijos\nR: 42");
    expect(doc).not.toContain("q2");
    expect(doc).not.toContain("q3");
    expect(doc).not.toContain("q5");
  });

  it("falls back to the question id when no label is known", () => {
    const doc = buildAnswersDocument({ qx: "sí" }, {});
    expect(doc).toContain("P: qx\nR: sí");
  });

  it("returns empty string when nothing is answered", () => {
    expect(buildAnswersDocument({ q1: "", q2: null }, {})).toBe("");
  });
});

// ---------------------------------------------------------------------------
// reindexCaseKnowledge (mocked repository)
// ---------------------------------------------------------------------------

describe("reindexCaseKnowledge", () => {
  it("same content_hash → no re-embed, everything skipped", async () => {
    mocks.repo.getCaseForProfile.mockResolvedValue(PROFILE);
    const rawText = "Contenido del pasaporte extraído por OCR.";
    mocks.repo.listIndexableDocuments.mockResolvedValue([
      { documentId: "doc-1", label: "Pasaporte", rawText },
    ]);
    mocks.repo.listIndexableFormResponses.mockResolvedValue([]);

    // Precompute the exact chunks the service will produce → same hashes.
    const existing = [
      ...chunkText(profileText()).map((content, i) => ({
        id: `c-p-${i}`,
        source_kind: "case_profile",
        source_id: CASE_ID,
        chunk_index: i,
        content_hash: sha256(content),
      })),
      ...chunkText(rawText).map((content, i) => ({
        id: `c-d-${i}`,
        source_kind: "document_extraction",
        source_id: "doc-1",
        chunk_index: i,
        content_hash: sha256(content),
      })),
    ];
    mocks.repo.listExistingChunks.mockResolvedValue(existing);

    const result = await reindexCaseKnowledge(CASE_ID);

    expect(mocks.embeddings.embedText).not.toHaveBeenCalled();
    expect(mocks.repo.upsertChunk).not.toHaveBeenCalled();
    expect(result.indexed).toBe(0);
    expect(result.skipped).toBe(existing.length);
  });

  it("changed content → re-embeds and upserts only the changed chunk", async () => {
    mocks.repo.getCaseForProfile.mockResolvedValue(PROFILE);
    mocks.repo.listIndexableDocuments.mockResolvedValue([]);
    mocks.repo.listIndexableFormResponses.mockResolvedValue([]);
    mocks.repo.listExistingChunks.mockResolvedValue([
      {
        id: "stale",
        source_kind: "case_profile",
        source_id: CASE_ID,
        chunk_index: 0,
        content_hash: "0".repeat(64), // stale hash → re-embed
      },
    ]);

    const result = await reindexCaseKnowledge(CASE_ID);

    expect(mocks.embeddings.embedText).toHaveBeenCalledTimes(1);
    expect(mocks.repo.upsertChunk).toHaveBeenCalledTimes(1);
    const upserted = mocks.repo.upsertChunk.mock.calls[0][0] as { content_hash: string; embedding: string };
    expect(upserted.content_hash).toBe(sha256(profileText()));
    expect(upserted.embedding).toMatch(/^\[/);
    expect(result.indexed).toBe(1);
  });

  it("deleted document → orphan sweep runs without the document key", async () => {
    mocks.repo.getCaseForProfile.mockResolvedValue(PROFILE);
    mocks.repo.listIndexableDocuments.mockResolvedValue([]); // document gone
    mocks.repo.listIndexableFormResponses.mockResolvedValue([]);
    mocks.repo.listExistingChunks.mockResolvedValue([
      {
        id: "orphan-1",
        source_kind: "document_extraction",
        source_id: "doc-deleted",
        chunk_index: 0,
        content_hash: "a".repeat(64),
      },
      ...chunkText(profileText()).map((content, i) => ({
        id: `c-p-${i}`,
        source_kind: "case_profile",
        source_id: CASE_ID,
        chunk_index: i,
        content_hash: sha256(content),
      })),
    ]);
    mocks.repo.deleteChunksNotIn.mockResolvedValue(1);

    const result = await reindexCaseKnowledge(CASE_ID);

    expect(mocks.repo.deleteChunksNotIn).toHaveBeenCalledWith(CASE_ID, [
      { source_kind: "case_profile", source_id: CASE_ID },
    ]);
    expect(result.removed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// sendLexMessage (mocked repository + authz + qstash)
// ---------------------------------------------------------------------------

describe("sendLexMessage", () => {
  function mockIdleThread() {
    mocks.repo.findCaseOrgId.mockResolvedValue(ORG_ID);
    mocks.repo.getOrCreateThread.mockResolvedValue({
      id: THREAD_ID,
      case_id: CASE_ID,
      staff_user_id: STAFF_ID,
      created_at: "2026-07-18T00:00:00.000Z",
    });
    mocks.repo.findRunningMessage.mockResolvedValue(null);
  }

  it("rejects empty / over-long content with LEX_MESSAGE_INVALID (before any I/O)", async () => {
    await expect(sendLexMessage(STAFF_ACTOR, CASE_ID, "   ")).rejects.toMatchObject({
      name: "LexError",
      code: "LEX_MESSAGE_INVALID",
    });
    await expect(
      sendLexMessage(STAFF_ACTOR, CASE_ID, "x".repeat(2001)),
    ).rejects.toMatchObject({ code: "LEX_MESSAGE_INVALID" });
    expect(mocks.authz.requireCaseAccess).not.toHaveBeenCalled();
  });

  it("propagates the authorization failure when the actor has no case access", async () => {
    mocks.authz.requireCaseAccess.mockRejectedValue(
      new mocks.authz.AuthzError("forbidden_module"),
    );
    await expect(
      sendLexMessage(STAFF_ACTOR, CASE_ID, "¿Qué falta?"),
    ).rejects.toMatchObject({ name: "AuthzError", reason: "forbidden_module" });
    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
  });

  it("rejects with LEX_BUSY when an assistant answer is already running", async () => {
    mockIdleThread();
    mocks.repo.findRunningMessage.mockResolvedValue({ id: "m-running" });

    await expect(sendLexMessage(STAFF_ACTOR, CASE_ID, "¿Y ahora?")).rejects.toMatchObject({
      name: "LexError",
      code: "LEX_BUSY",
    });
    expect(mocks.repo.insertMessage).not.toHaveBeenCalled();
    expect(mocks.qstash.enqueueJob).not.toHaveBeenCalled();
  });

  it("happy path: persists user + running placeholder and enqueues lex-answer", async () => {
    mockIdleThread();
    mocks.repo.insertMessage
      .mockResolvedValueOnce({ id: "m-user" })
      .mockResolvedValueOnce({ id: "m-assistant" });

    const res = await sendLexMessage(STAFF_ACTOR, CASE_ID, "¿Qué documentos faltan?");

    expect(res).toEqual({ threadId: THREAD_ID, messageId: "m-assistant" });
    expect(mocks.repo.insertMessage).toHaveBeenCalledTimes(2);
    expect(mocks.repo.insertMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: "assistant", status: "running", content: "" }),
    );
    expect(mocks.qstash.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: "lex-answer",
        entityId: "m-assistant",
        messageId: "m-assistant",
        threadId: THREAD_ID,
        caseId: CASE_ID,
        orgId: ORG_ID,
        dedupeId: "lex-answer:m-assistant",
      }),
      { retries: 2, timeout: "280s" },
    );
  });
});

// ---------------------------------------------------------------------------
// executeLexAnswerJob with the E2E stub (mocked repository + embeddings)
// ---------------------------------------------------------------------------

describe("executeLexAnswerJob (AI stub)", () => {
  const PAYLOAD: LexAnswerJobPayload = {
    jobKey: "lex-answer",
    entityId: "m-assistant",
    attempt: 1,
    dedupeId: "lex-answer:m-assistant",
    orgId: ORG_ID,
    messageId: "m-assistant",
    threadId: THREAD_ID,
    caseId: CASE_ID,
  };

  function mockThread() {
    mocks.repo.getThreadById.mockResolvedValue({
      id: THREAD_ID,
      case_id: CASE_ID,
      staff_user_id: STAFF_ID,
      created_at: "2026-07-18T00:00:00.000Z",
    });
    mocks.repo.listMessages.mockResolvedValue([
      {
        id: "m-user",
        thread_id: THREAD_ID,
        role: "user",
        content: "¿Qué documentos faltan?",
        status: "completed",
        sources: [],
        created_at: "2026-07-18T00:00:00.000Z",
      },
      {
        id: "m-assistant",
        thread_id: THREAD_ID,
        role: "assistant",
        content: "",
        status: "running",
        sources: [],
        created_at: "2026-07-18T00:00:01.000Z",
      },
    ]);
    mocks.repo.getCaseForProfile.mockResolvedValue(PROFILE);
    mocks.repo.matchCaseKnowledge.mockResolvedValue([
      { id: "c1", sourceKind: "document_extraction", sourceId: "doc-1", sourceLabel: "Pasaporte", content: "…", similarity: 0.9 },
      { id: "c2", sourceKind: "form_response", sourceId: "r-1", sourceLabel: "I-589", content: "…", similarity: 0.8 },
    ]);
  }

  it("persists the deterministic stub answer with chunk sources and zero cost", async () => {
    mocks.aiStub.isAiStubEnabled.mockReturnValue(true);
    mocks.repo.getMessageById.mockResolvedValue({
      id: "m-assistant",
      thread_id: THREAD_ID,
      role: "assistant",
      status: "running",
      content: "",
    });
    mockThread();

    const outcome = await executeLexAnswerJob(PAYLOAD);

    expect(outcome).toBe("completed");
    expect(mocks.getAnthropicClient).not.toHaveBeenCalled();
    expect(mocks.repo.updateAssistantMessage).toHaveBeenCalledWith(
      "m-assistant",
      expect.objectContaining({
        status: "completed",
        cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        error: null,
      }),
    );
    const patch = mocks.repo.updateAssistantMessage.mock.calls[0][1] as {
      content: string;
      sources: Array<{ kind: string; label?: string }>;
    };
    expect(patch.content).toContain("Respuesta de prueba de Lex (stub E2E)");
    expect(patch.content).toContain("¿Qué documentos faltan?");
    expect(patch.content).toContain("Fuentes del caso consultadas: 2");
    const labels = patch.sources.filter((s) => s.kind === "chunk").map((s) => s.label);
    expect(labels).toContain("Pasaporte");
    expect(labels).toContain("I-589");
  });

  it("single-spend: an already-completed message is a no-op", async () => {
    mocks.repo.getMessageById.mockResolvedValue({
      id: "m-assistant",
      thread_id: THREAD_ID,
      role: "assistant",
      status: "completed",
      content: "done",
    });

    const outcome = await executeLexAnswerJob(PAYLOAD);

    expect(outcome).toBe("skipped");
    expect(mocks.repo.updateAssistantMessage).not.toHaveBeenCalled();
    expect(mocks.embeddings.embedText).not.toHaveBeenCalled();
    expect(mocks.getAnthropicClient).not.toHaveBeenCalled();
  });
});
