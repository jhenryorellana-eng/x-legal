/**
 * Cases module — parseClientAddress (case Resumen "Datos del cliente").
 *
 * Defensive parse of the `client_profiles.address` JSONB into the typed address
 * surfaced in the case workspace. Old/partial profiles must never render
 * "undefined": missing pieces coerce to null, and the composed "City, ST ZIP"
 * one-liner tolerates gaps.
 */

import { describe, it, expect, vi } from "vitest";

// parseClientAddress is pure, but importing ../service pulls the platform graph
// (supabase → env) which validates env at load. Stub env so the import doesn't
// fail-fast — no client is ever created in this pure-function test.
vi.mock("@/backend/platform/env", () => ({ env: {}, providerEnv: () => ({}) }));

import { parseClientAddress } from "../service";

describe("parseClientAddress", () => {
  it("returns null for null / non-object input", () => {
    expect(parseClientAddress(null)).toBeNull();
    expect(parseClientAddress(undefined)).toBeNull();
    expect(parseClientAddress("1206 Bower St")).toBeNull();
    expect(parseClientAddress(42)).toBeNull();
  });

  it("returns null when the object has no usable field", () => {
    expect(parseClientAddress({})).toBeNull();
    expect(parseClientAddress({ line1: "", city: "  ", zip: null })).toBeNull();
  });

  it("parses a full US address and composes City, ST ZIP", () => {
    const addr = parseClientAddress({
      line1: "1206 BOWER ST",
      apartment: null,
      city: "LINDEN",
      state: "NJ",
      zip: "07036",
    });
    expect(addr).toEqual({
      line1: "1206 BOWER ST",
      apartment: null,
      city: "LINDEN",
      state: "NJ",
      zip: "07036",
      cityStateZip: "LINDEN, NJ 07036",
    });
  });

  it("keeps the apartment when present and trims every field", () => {
    const addr = parseClientAddress({
      line1: "  500 Ocean Dr  ",
      apartment: " 4B ",
      city: " Miami ",
      state: " FL ",
      zip: " 33139 ",
    });
    expect(addr?.line1).toBe("500 Ocean Dr");
    expect(addr?.apartment).toBe("4B");
    expect(addr?.cityStateZip).toBe("Miami, FL 33139");
  });

  it("tolerates a missing zip / city without emitting stray separators", () => {
    expect(parseClientAddress({ city: "Houston", state: "TX" })?.cityStateZip).toBe("Houston, TX");
    expect(parseClientAddress({ state: "TX", zip: "77002" })?.cityStateZip).toBe("TX 77002");
  });

  it("coerces missing sub-fields to null (never undefined)", () => {
    const addr = parseClientAddress({ line1: "1 Main St" });
    expect(addr).toEqual({
      line1: "1 Main St",
      apartment: null,
      city: null,
      state: null,
      zip: null,
      cityStateZip: null,
    });
  });
});
