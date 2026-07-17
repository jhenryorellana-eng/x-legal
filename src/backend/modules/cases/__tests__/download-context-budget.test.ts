/**
 * cases repository — downloadAllDocumentBytesBySlug budget/cap guardrails.
 *
 * The ai_field context files travel INLINE to Gemini together with the primary
 * document, so the caller passes the REMAINING shared budget (opts.maxTotalBytes)
 * and the repo must stop adding files once it is spent — with a warn, never a
 * silent truncation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const rows: unknown[] = [];
  const downloads = new Map<string, Uint8Array>();

  const download = vi.fn(async (path: string) => {
    const bytes = downloads.get(path);
    return bytes ? { data: new Blob([bytes.buffer as ArrayBuffer]) } : { data: null };
  });

  const from = vi.fn((_table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ["select", "eq", "in", "is", "order", "limit"]) c[m] = vi.fn(self);
    c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows }).then(res);
    return c;
  });

  return { rows, downloads, download, from };
});

vi.mock("@/backend/platform/supabase", () => ({
  createServiceClient: vi.fn(() => ({
    from: mocks.from,
    storage: { from: vi.fn(() => ({ download: mocks.download })) },
  })),
  createServerClient: vi.fn(),
}));

vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { downloadAllDocumentBytesBySlug } from "../repository";
import { logger } from "@/backend/platform/logger";

const CASE_ID = "case-1";

function row(path: string, name: string) {
  return {
    storage_path: path,
    mime_type: "application/pdf",
    display_name: name,
    original_filename: null,
    required_document_types: { slug: "evidencias-sustentatorias" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  mocks.downloads.clear();
});

describe("downloadAllDocumentBytesBySlug — shared budget", () => {
  it("stops adding files once opts.maxTotalBytes is spent (and warns)", async () => {
    mocks.rows.push(row("p1", "Uno"), row("p2", "Dos"));
    mocks.downloads.set("p1", new Uint8Array(6));
    mocks.downloads.set("p2", new Uint8Array(6));

    const files = await downloadAllDocumentBytesBySlug(CASE_ID, "evidencias-sustentatorias", null, {
      maxTotalBytes: 8,
    });

    expect(files).toHaveLength(1);
    expect(files[0].label).toBe("Uno");
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("respects opts.cap keeping the newest rows (and warns)", async () => {
    mocks.rows.push(row("p1", "Vieja"), row("p2", "Nueva"));
    mocks.downloads.set("p1", new Uint8Array(2));
    mocks.downloads.set("p2", new Uint8Array(2));

    const files = await downloadAllDocumentBytesBySlug(CASE_ID, "evidencias-sustentatorias", null, {
      cap: 1,
    });

    expect(files).toHaveLength(1);
    expect(files[0].label).toBe("Nueva");
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it("downloads everything when it fits (no warn)", async () => {
    mocks.rows.push(row("p1", "Uno"), row("p2", "Dos"));
    mocks.downloads.set("p1", new Uint8Array(2));
    mocks.downloads.set("p2", new Uint8Array(2));

    const files = await downloadAllDocumentBytesBySlug(CASE_ID, "evidencias-sustentatorias", null, {
      maxTotalBytes: 100,
    });

    expect(files.map((f) => f.label)).toEqual(["Uno", "Dos"]);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });
});
