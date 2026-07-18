/**
 * storage.ts — upload size limit (RNF-016) + validation helpers.
 *
 * RNF-016 defines the per-client-file cap as "default 25 MB, configurable".
 * The project raised it to 50 MB (scanned court records exceed 200 pages) and
 * DOC-15 RF-TRX requires ONE shared constant per upload context — frontend and
 * backend must read the same value, never duplicate literals.
 */
import { describe, expect, it, vi } from "vitest";

// storage.ts imports the Supabase service client at module load; the pure
// validators under test never touch it.
vi.mock("../supabase", () => ({
  createServiceClient: () => {
    throw new Error("not used in this test");
  },
}));

import { UPLOAD_MAX_FILE_BYTES, UPLOAD_MAX_FILE_MB } from "@/shared/constants/uploads";
import { MAX_FILE_SIZE_BYTES, validateFileSize, validateMagicBytes } from "../storage";

describe("upload size limit — single shared 50MB constant (RNF-016 / RF-TRX)", () => {
  it("the shared constant is 50 MB and platform/storage re-uses it", () => {
    expect(UPLOAD_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(UPLOAD_MAX_FILE_MB).toBe(50);
    expect(MAX_FILE_SIZE_BYTES).toBe(UPLOAD_MAX_FILE_BYTES);
  });

  it("accepts a 49 MB file", () => {
    expect(validateFileSize(49 * 1024 * 1024).ok).toBe(true);
  });

  it("rejects a 51 MB file with the limit spelled out", () => {
    const res = validateFileSize(51 * 1024 * 1024);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("50 MB");
  });

  it("still honors an explicit per-call override", () => {
    expect(validateFileSize(6 * 1024 * 1024, 5 * 1024 * 1024).ok).toBe(false);
    expect(validateFileSize(4 * 1024 * 1024, 5 * 1024 * 1024).ok).toBe(true);
  });
});

describe("validateMagicBytes (regression — untouched by the limit change)", () => {
  it("accepts a real %PDF- header and rejects a spoofed one", () => {
    expect(validateMagicBytes("a.pdf", Buffer.from("%PDF-1.7\n")).ok).toBe(true);
    expect(validateMagicBytes("a.pdf", Buffer.from("MZ\x90\x00")).ok).toBe(false);
  });
});
