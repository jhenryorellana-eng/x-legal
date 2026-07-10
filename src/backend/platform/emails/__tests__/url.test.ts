/**
 * emailBaseUrl / emailAbsoluteUrl — email links must never point at a loopback
 * host (unreachable from a mail client); they fall back to the canonical origin.
 */

import { describe, it, expect, vi } from "vitest";

// Mock env so NEXT_PUBLIC_APP_URL can vary per test.
const mockEnv = vi.hoisted(() => ({ env: { NEXT_PUBLIC_APP_URL: "" } }));
vi.mock("../../env", () => mockEnv);

import { emailBaseUrl, emailAbsoluteUrl } from "../url";

const CANONICAL = "https://x-legal.usalatinoprime.com";

describe("emailBaseUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when it is a real origin", () => {
    mockEnv.env.NEXT_PUBLIC_APP_URL = CANONICAL;
    expect(emailBaseUrl()).toBe(CANONICAL);
  });

  it("falls back to the canonical origin for localhost / loopback", () => {
    for (const bad of [
      "http://localhost:3000",
      "http://127.0.0.1:3100",
      "http://0.0.0.0:3000",
      "",
    ]) {
      mockEnv.env.NEXT_PUBLIC_APP_URL = bad;
      expect(emailBaseUrl()).toBe(CANONICAL);
    }
  });

  it("strips a trailing slash", () => {
    mockEnv.env.NEXT_PUBLIC_APP_URL = "https://example.com/";
    expect(emailBaseUrl()).toBe("https://example.com");
  });
});

describe("emailAbsoluteUrl", () => {
  it("joins a relative path onto the (guarded) origin", () => {
    mockEnv.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(emailAbsoluteUrl("/pagos")).toBe(`${CANONICAL}/pagos`);
    expect(emailAbsoluteUrl("pagos")).toBe(`${CANONICAL}/pagos`);
  });

  it("passes through an already-absolute URL", () => {
    mockEnv.env.NEXT_PUBLIC_APP_URL = CANONICAL;
    expect(emailAbsoluteUrl("https://other.example/x")).toBe("https://other.example/x");
  });
});
