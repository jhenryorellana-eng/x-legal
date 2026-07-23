/**
 * Constants for external evaluation tools (v1: Juez — juez.vercel.app).
 *
 * The integration contract v1 is documented in docs/PROMPT-JUEZ-XLEGAL.md.
 * x-legal is the source of truth (attempts, delivered PDF); Juez is a stateless
 * generation engine reached through {base_url}/xlegal?t={access_token}.
 */

/** tool_key value for the Juez integration (service_external_tools / case_evaluations). */
export const JUEZ_TOOL_KEY = "juez" as const;

/** Header carrying the HMAC-SHA256 hex signature on the inbound webhook. */
export const JUEZ_SIGNATURE_HEADER = "x-juez-signature";

/** Header carrying the shared API key on Juez→x-legal and x-legal→Juez calls. */
export const JUEZ_API_KEY_HEADER = "x-api-key";

/** `webhook_events.source` for Juez deliveries (idempotency scope). */
export const JUEZ_WEBHOOK_SOURCE = "juez";

/** Path of the embedded client page on the Juez app ({base_url}{path}?t={token}). */
export const JUEZ_EMBED_PATH = "/xlegal";

/** Path of the reconciliation endpoint on the Juez app ({base_url}{path}?jobId=). */
export const JUEZ_STATUS_PATH = "/api/xlegal/status";

/** Max accepted size of the evaluation PDF fetched from Juez (bytes). */
export const EVALUATION_PDF_MAX_BYTES = 25 * 1024 * 1024;

/** Allowed host SUFFIX for result.pdfUrl (Vercel Blob). Checked on URL.hostname. */
export const EVALUATION_PDF_HOST_SUFFIX = ".blob.vercel-storage.com";

/**
 * CSP `frame-src` origins for external evaluation tools embedded in the client
 * case screen ({base_url}/xlegal iframe). The middleware CANNOT read
 * `service_external_tools.base_url` (edge, per-request budget), so this static
 * mirror is the source the CSP uses. ⚠ OPERATIVE RULE: any base_url configured
 * in /admin/catalogo must have its ORIGIN added here BEFORE the CSP flips from
 * Report-Only to enforcing (GO-LIVE.md §5) — otherwise the iframe is silently
 * blocked. Origins only, never paths.
 */
export const EVALUATION_TOOL_FRAME_ORIGINS: readonly string[] = [
  "https://juez.vercel.app",
];

/** case_evaluations.status values. */
export const EVALUATION_STATUSES = [
  "pending",
  "in_progress",
  "delivered",
  "failed",
] as const;
export type EvaluationStatus = (typeof EVALUATION_STATUSES)[number];

/** case_evaluation_runs.status values. */
export const EVALUATION_RUN_STATUSES = ["consumed", "completed", "failed"] as const;
export type EvaluationRunStatus = (typeof EVALUATION_RUN_STATUSES)[number];
