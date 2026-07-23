/**
 * Evaluations module — domain (Zod schemas + pure logic, no I/O).
 *
 * External evaluation tools (v1: Juez). x-legal is the source of truth for
 * attempts and the delivered PDF; Juez is a stateless generation engine.
 * Contract v1: docs/PROMPT-JUEZ-XLEGAL.md.
 *
 * @module evaluations/domain
 */

import { z } from "zod";
import {
  EVALUATION_PDF_HOST_SUFFIX,
  type EvaluationRunStatus,
  type EvaluationStatus,
} from "@/shared/constants/evaluations";

// ---------------------------------------------------------------------------
// Lenient UUID schema (same as mold modules — demo ids are not RFC v4)
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const zUuid = z.string().regex(UUID_RE, "uuid");

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class EvaluationsError extends Error {
  constructor(
    public readonly code:
      | "WEBHOOK_SIGNATURE_MISSING"
      | "WEBHOOK_SIGNATURE_INVALID"
      | "EVALUATION_NOT_FOUND"
      | "TOOL_NOT_ENABLED"
      | "CASE_NOT_FOUND"
      | "CASE_NOT_ACTIVE"
      | "NO_ATTEMPTS_LEFT"
      | "PDF_NOT_AVAILABLE"
      | "PDF_DOWNLOAD_FAILED"
      | "PDF_TOO_LARGE"
      | "PDF_INVALID"
      | "PDF_HOST_NOT_ALLOWED",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "EvaluationsError";
  }
}

// ---------------------------------------------------------------------------
// Inbound webhook payload (Juez → x-legal) — contract v1 §3.3
// ---------------------------------------------------------------------------

/** Opaque bearer token issued by x-legal (uuid today; keep the check lenient). */
const zToken = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/, "token");

export const JuezWebhookResultSchema = z.object({
  pdfUrl: z.string().url(),
  score: z.number().min(0).max(100).nullish(),
  nivel: z.string().max(40).nullish(),
  headline: z.string().max(500).nullish(),
});

export const JuezWebhookSchema = z
  .object({
    event: z.enum(["evaluation.completed", "evaluation.failed"]),
    token: zToken,
    jobId: z.string().min(8).max(128),
    completedAt: z.string().nullish(),
    result: JuezWebhookResultSchema.nullish(),
    error: z.string().max(500).nullish(),
  })
  .refine((p) => p.event !== "evaluation.completed" || !!p.result, {
    message: "result is required for evaluation.completed",
    path: ["result"],
  });
export type JuezWebhook = z.infer<typeof JuezWebhookSchema>;

/** Body of POST /api/juez/sessions/{token}/consume. */
export const ConsumeBodySchema = z.object({
  jobId: z.string().min(8).max(128),
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Whitelist of the PDF origin by hostname SUFFIX (never substring — blocks
 * `evil.blob.vercel-storage.com.evil.com` and `xblob.vercel-storage.com`).
 * https only.
 */
export function isAllowedPdfHost(pdfUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(pdfUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return url.hostname.endsWith(EVALUATION_PDF_HOST_SUFFIX);
}

export function canConsumeAttempt(allowed: number, used: number): boolean {
  return used < allowed;
}

/**
 * Projects the internal evaluation status onto the wire status of the session
 * GET (contract v1 §3.1): Juez only distinguishes delivered; everything else is
 * "active" ("expired" reserved for future token revocation).
 */
export function projectSessionStatus(
  status: EvaluationStatus,
): "active" | "delivered" | "expired" {
  return status === "delivered" ? "delivered" : "active";
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

export interface EvaluationReportMeta {
  score?: number | null;
  nivel?: string | null;
  headline?: string | null;
  lastError?: string | null;
}

export interface ClientEvaluationVM {
  status: EvaluationStatus;
  attemptsAllowed: number;
  attemptsUsed: number;
  /** `${base_url}/xlegal?t=${access_token}` — the client's own session credential. */
  iframeUrl: string;
  instructions: { es?: string; en?: string };
  pdfAvailable: boolean;
  reportMeta: EvaluationReportMeta;
  deliveredAt: string | null;
}

/** Cheap read for the camino CTA (never creates the session row). */
export interface ClientEvaluationSummary {
  configured: true;
  status: EvaluationStatus | "not_started";
  pdfAvailable: boolean;
}

export interface StaffEvaluationRunVM {
  jobId: string;
  status: EvaluationRunStatus;
  createdAt: string;
  error: string | null;
}

export interface StaffEvaluationVM {
  /** null = the client has not opened the screen yet (no session row). */
  evaluationId: string | null;
  status: EvaluationStatus | "not_started";
  attemptsAllowed: number;
  attemptsUsed: number;
  pdfAvailable: boolean;
  deliveredAt: string | null;
  reportMeta: EvaluationReportMeta;
  runs: StaffEvaluationRunVM[];
  toolKey: string;
}

/** Session state served to Juez (GET /api/juez/sessions/{token}) — minimum PII. */
export interface JuezSessionDto {
  token: string;
  client: { name: string | null; email: string | null; country: string | null };
  attemptsAllowed: number;
  attemptsUsed: number;
  status: EvaluationStatus;
  /** Signed URL (short TTL) when delivered; Juez re-shows the PDF through it. */
  pdfUrl: string | null;
}

export type ConsumeResult =
  | { outcome: "consumed" | "already_consumed"; attemptsAllowed: number; attemptsUsed: number }
  | { outcome: "no_attempts" };
