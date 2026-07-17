/**
 * Tests for frontend/lib/zip-lookup.ts — pure helpers.
 *
 * (The useUsZipLookup hook itself is covered manually/e2e: it needs a DOM +
 * timers + fetch, and this suite runs in a node environment.)
 */

import { describe, it, expect } from "vitest";
import { extractZip5 } from "../zip-lookup";

describe("extractZip5", () => {
  it("accepts a plain 5-digit ZIP", () => {
    expect(extractZip5("33101")).toBe("33101");
  });

  it("takes the 5-digit base of a ZIP+4", () => {
    expect(extractZip5("33101-1234")).toBe("33101");
  });

  it("trims surrounding whitespace", () => {
    expect(extractZip5("  33101 ")).toBe("33101");
  });

  it("rejects partial or malformed input", () => {
    expect(extractZip5("3310")).toBeNull();
    expect(extractZip5("331012")).toBeNull();
    expect(extractZip5("abcde")).toBeNull();
    expect(extractZip5("33101-12")).toBeNull();
    expect(extractZip5("")).toBeNull();
  });
});
