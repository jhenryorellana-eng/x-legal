/**
 * Constants for the SaaS Abogados integration (DOC-70).
 *
 * The contract is owned by the external SaaS ("el código del SaaS manda"); these
 * mirror its enums/conventions so the V2 `integrations` module stays in sync.
 */

/**
 * Source identifier V2 ALWAYS sends, explicit. The SaaS Zod defaults `source` to
 * `'henryflow'` (the legacy system) — omitting it would mix V2's idempotency and
 * polling with the legacy. DOC-70 §2.1 ⚠️.
 */
export const ABOGADOS_SOURCE = "usalatinoprime-v2" as const;

/** Document `kind` accepted by the SaaS package (DOC-70 §2.1 / §2.4). */
export const DOCUMENT_KINDS = ["declaration", "official_form", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Finding severities in a verdict (DOC-70 §4.1). */
export const FINDING_SEVERITIES = ["critical", "moderate", "suggestion"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** SaaS semáforo colors (DOC-70 §4.1). */
export const SEMAFORO_COLORS = ["green", "amber", "red"] as const;
export type SemaforoColor = (typeof SEMAFORO_COLORS)[number];

/** Where a `needs_corrections` verdict routes the work (DOC-70 §4.4). */
export const RETURN_TO = ["team", "client"] as const;
export type ReturnTo = (typeof RETURN_TO)[number];

/** Header carrying the HMAC-SHA256 hex signature on the inbound verdict webhook (DOC-70 §4.2). */
export const ABOGADOS_SIGNATURE_HEADER = "x-abogados-signature";

/** Header carrying the integration API key on the outbound POST/GET (DOC-70 §2 / §6). */
export const ABOGADOS_API_KEY_HEADER = "x-api-key";

/** Integration endpoint paths on the SaaS (relative to ABOGADOS_API_URL). */
export const ABOGADOS_VALIDATIONS_PATH = "/api/integration/validations";
