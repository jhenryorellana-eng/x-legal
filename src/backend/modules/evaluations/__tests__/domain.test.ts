/**
 * evaluations module — domain unit tests.
 *
 * Pure logic: webhook schema, PDF host whitelist (incl. bypass attempts),
 * attempt math, wire-status projection.
 */

import { describe, it, expect } from "vitest";
import {
  JuezWebhookSchema,
  ConsumeBodySchema,
  isAllowedPdfHost,
  canConsumeAttempt,
  projectSessionStatus,
} from "../domain";

const TOKEN = "3f2b8c04-1111-4222-8333-944445555666";

describe("isAllowedPdfHost", () => {
  it("accepts a real Vercel Blob URL", () => {
    expect(
      isAllowedPdfHost("https://abc123.public.blob.vercel-storage.com/xlegal/informes/i.pdf"),
    ).toBe(true);
  });

  it("rejects suffix-spoofing bypasses", () => {
    // whitelist host as a SUBDOMAIN label of an attacker domain
    expect(
      isAllowedPdfHost("https://evil.blob.vercel-storage.com.evil.com/x.pdf"),
    ).toBe(false);
    // missing the boundary dot
    expect(isAllowedPdfHost("https://xblob.vercel-storage.com/x.pdf")).toBe(false);
    // suffix in the path, not the host
    expect(
      isAllowedPdfHost("https://evil.com/.blob.vercel-storage.com/x.pdf"),
    ).toBe(false);
    // userinfo trick
    expect(
      isAllowedPdfHost("https://a.blob.vercel-storage.com@evil.com/x.pdf"),
    ).toBe(false);
  });

  it("rejects non-https and malformed URLs", () => {
    expect(isAllowedPdfHost("http://abc.blob.vercel-storage.com/x.pdf")).toBe(false);
    expect(isAllowedPdfHost("not-a-url")).toBe(false);
  });
});

describe("JuezWebhookSchema", () => {
  const base = {
    token: TOKEN,
    jobId: "11111111-2222-4333-8444-555566667777",
  };

  it("requires result for evaluation.completed", () => {
    expect(JuezWebhookSchema.safeParse({ ...base, event: "evaluation.completed" }).success).toBe(
      false,
    );
    expect(
      JuezWebhookSchema.safeParse({
        ...base,
        event: "evaluation.completed",
        result: { pdfUrl: "https://a.blob.vercel-storage.com/x.pdf", score: 62 },
      }).success,
    ).toBe(true);
  });

  it("accepts evaluation.failed without result", () => {
    expect(
      JuezWebhookSchema.safeParse({
        ...base,
        event: "evaluation.failed",
        error: "GENERATION_FAILED",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown events and malformed tokens", () => {
    expect(
      JuezWebhookSchema.safeParse({ ...base, event: "evaluation.exploded" }).success,
    ).toBe(false);
    expect(
      JuezWebhookSchema.safeParse({
        ...base,
        token: "short",
        event: "evaluation.failed",
      }).success,
    ).toBe(false);
  });
});

describe("ConsumeBodySchema", () => {
  it("requires a jobId of sane length", () => {
    expect(ConsumeBodySchema.safeParse({ jobId: "tiny" }).success).toBe(false);
    expect(
      ConsumeBodySchema.safeParse({ jobId: "11111111-2222-4333-8444-555566667777" }).success,
    ).toBe(true);
  });
});

describe("attempt math + status projection", () => {
  it("canConsumeAttempt", () => {
    expect(canConsumeAttempt(1, 0)).toBe(true);
    expect(canConsumeAttempt(1, 1)).toBe(false);
    expect(canConsumeAttempt(2, 1)).toBe(true);
    expect(canConsumeAttempt(0, 0)).toBe(false);
  });

  it("projectSessionStatus maps delivered, everything else is active", () => {
    expect(projectSessionStatus("delivered")).toBe("delivered");
    expect(projectSessionStatus("pending")).toBe("active");
    expect(projectSessionStatus("in_progress")).toBe("active");
    expect(projectSessionStatus("failed")).toBe("active");
  });
});
