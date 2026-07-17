/**
 * Tests for identity/zip-lookup.ts — US ZIP → city/state service.
 *
 * Covers:
 * - lookupUsZip: upstream mapping (places[0]), 404 → not_found, other HTTP
 *   errors → failed, network/timeout → failed, invalid ZIP short-circuits
 *   without any network call, malformed upstream payload → not_found.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { lookupUsZip, US_ZIP_REGEX } from "../zip-lookup";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MIAMI = {
  places: [{ "place name": "Miami", "state abbreviation": "FL" }],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("US_ZIP_REGEX", () => {
  it("accepts exactly 5 digits", () => {
    expect(US_ZIP_REGEX.test("33101")).toBe(true);
  });
  it("rejects partial, ZIP+4 and non-digits", () => {
    expect(US_ZIP_REGEX.test("3310")).toBe(false);
    expect(US_ZIP_REGEX.test("33101-1234")).toBe(false);
    expect(US_ZIP_REGEX.test("abcde")).toBe(false);
  });
});

describe("lookupUsZip", () => {
  it("maps places[0] to city/state on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, MIAMI));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupUsZip("33101");

    expect(result).toEqual({ status: "found", city: "Miami", state: "FL" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.zippopotam.us/us/33101",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("returns not_found when the upstream answers 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, {})));
    expect(await lookupUsZip("00000")).toEqual({ status: "not_found" });
  });

  it("returns not_found when the payload has no usable place", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { places: [] })));
    expect(await lookupUsZip("33101")).toEqual({ status: "not_found" });
  });

  it("returns failed on other upstream HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {})));
    expect(await lookupUsZip("33101")).toEqual({ status: "failed" });
  });

  it("returns failed when the request throws (network/timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await lookupUsZip("33101")).toEqual({ status: "failed" });
  });

  it("short-circuits invalid ZIPs without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await lookupUsZip("3310")).toEqual({ status: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
