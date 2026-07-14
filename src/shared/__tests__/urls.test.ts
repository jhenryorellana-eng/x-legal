/**
 * urls.ts — server-side absolute-link resolution must never yield a loopback
 * origin, and must prefer the real request host over env / canonical.
 */

import { describe, it, expect } from "vitest";
import {
  CANONICAL_ORIGIN,
  isLoopbackOrigin,
  signingLinkPath,
  resolveAppOrigin,
  absoluteAppUrl,
} from "../urls";

describe("isLoopbackOrigin", () => {
  it("is true for empty / loopback origins", () => {
    for (const bad of ["", null, undefined, "http://localhost:3000", "http://127.0.0.1:3100", "http://0.0.0.0", "https://[::1]:3000"]) {
      expect(isLoopbackOrigin(bad)).toBe(true);
    }
  });

  it("is false for a real public origin", () => {
    expect(isLoopbackOrigin("https://x-legal.usalatinoprime.com")).toBe(false);
  });
});

describe("signingLinkPath", () => {
  it("builds the public firma path for a token", () => {
    expect(signingLinkPath("abc-123")).toBe("/firma/abc-123");
  });
});

describe("resolveAppOrigin", () => {
  it("uses the request host when it matches the canonical (allow-listed) host", () => {
    expect(
      resolveAppOrigin({ forwardedHost: "x-legal.usalatinoprime.com", forwardedProto: "https", envUrl: "http://localhost:3000" }),
    ).toBe("https://x-legal.usalatinoprime.com");
  });

  it("uses the request host when it matches the configured env host", () => {
    expect(
      resolveAppOrigin({ forwardedHost: "app.example.com", forwardedProto: "https", envUrl: "https://app.example.com" }),
    ).toBe("https://app.example.com");
  });

  it("SECURITY: ignores an untrusted/spoofed request host and falls back to canonical", () => {
    expect(
      resolveAppOrigin({ forwardedHost: "attacker.evil.com", forwardedProto: "https", envUrl: "http://localhost:3000" }),
    ).toBe(CANONICAL_ORIGIN);
  });

  it("SECURITY: an untrusted host falls back to the configured env origin when set", () => {
    expect(
      resolveAppOrigin({ forwardedHost: "attacker.evil.com", forwardedProto: "https", envUrl: "https://app.example.com" }),
    ).toBe("https://app.example.com");
  });

  it("ignores a loopback host and falls back to the env origin", () => {
    expect(
      resolveAppOrigin({ forwardedHost: "localhost:3000", forwardedProto: "http", envUrl: "https://app.example.com" }),
    ).toBe("https://app.example.com");
  });

  it("falls back to the canonical origin when host and env are loopback/absent", () => {
    expect(resolveAppOrigin({ forwardedHost: "localhost:3000", forwardedProto: "http", envUrl: "http://localhost:3000" })).toBe(
      CANONICAL_ORIGIN,
    );
    expect(resolveAppOrigin({})).toBe(CANONICAL_ORIGIN);
  });

  it("strips a trailing slash from the env fallback", () => {
    expect(resolveAppOrigin({ envUrl: "https://app.example.com/" })).toBe("https://app.example.com");
  });
});

describe("absoluteAppUrl", () => {
  it("joins a relative path onto the resolved origin", () => {
    expect(absoluteAppUrl("/firma/tok", { forwardedHost: "x-legal.usalatinoprime.com" })).toBe(
      "https://x-legal.usalatinoprime.com/firma/tok",
    );
    expect(absoluteAppUrl("firma/tok", { forwardedHost: "x-legal.usalatinoprime.com" })).toBe(
      "https://x-legal.usalatinoprime.com/firma/tok",
    );
  });

  it("passes through an already-absolute URL", () => {
    expect(absoluteAppUrl("https://other.example/x", { forwardedHost: "x-legal.usalatinoprime.com" })).toBe(
      "https://other.example/x",
    );
  });
});
