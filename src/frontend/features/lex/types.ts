/**
 * Lex assistant — shared types for the deterministic insight engine.
 *
 * V2.0 Lex is DETERMINISTIC (DOC-52 §0.5, RF-VAN-005, P-52-07): every message is
 * computed by pure rules over the real data each board already loads — no LLM.
 * These types are the contract between:
 *   - the boards (which build a typed `LexContext` from real data), and
 *   - the engine (`buildLexInsight`) which returns the top-priority `LexInsight`.
 *
 * This module is intentionally free of React / next-intl / backend imports so the
 * engine stays pure and unit-testable and respects the eslint-boundaries layering
 * (frontend → frontend | shared).
 *
 * Coherence rule (hard): every claim a message makes must be backed by a real,
 * computed value carried in the context. Money and stage labels are pre-formatted
 * by the page (locale-aware) and passed in as display strings — the engine never
 * formats. i18n resolution happens in the page via `composeLexBubble`.
 */

/** Severity of an insight. Also its priority: danger > warn > info > celebrate. */
export type LexTone = "danger" | "warn" | "info" | "celebrate";

/**
 * A deep-link / action the bubble offers. Serialisable: the client view maps
 * `id` → a known handler (e.g. "contactTopLead") or falls back to navigating to
 * `href`. Labels are resolved to strings by the page (via i18n).
 */
export interface LexActionDescriptor {
  /** Stable action id the client view maps to a handler. */
  id: string;
  /** i18n key (under `staff.lex`) for the label, e.g. "actions.contactLead". */
  labelKey: string;
  /** Interpolation params for the label. */
  labelParams?: Record<string, string | number>;
  /** Deep link to navigate to when there is no custom handler for `id`. */
  href?: string;
  /** Render as a secondary/ghost button. */
  ghost?: boolean;
  /** Material Symbols icon name. */
  icon?: string;
}

/** The composed top-ranked insight for a board (pre-i18n). */
export interface LexInsight {
  /** Stable id → dismiss key + React key (e.g. "sales:priority"). */
  id: string;
  tone: LexTone;
  /** i18n key (under `staff.lex`), e.g. "sales.priority". */
  messageKey: string;
  /** Interpolation params for the message (the `b` markup tag is added later). */
  params: Record<string, string | number>;
  actions: LexActionDescriptor[];
}

// ── Per-role board contexts (only real, already-loaded data) ─────────────────
// Numbers drive the threshold logic; *pre-formatted* strings carry display
// values (money, %, stage labels) so the engine never touches locale/format.

/** Vanessa · `/ventas/mi-dia`. */
export interface SalesHomeContext {
  role: "sales";
  /** Uncontacted leads (drives the "priority #1" nudge). */
  uncontacted: number;
  /** Oldest uncontacted lead's display name (or null). */
  topLeadName: string | null;
}

/** Diana · `/legal`. Counts derived from `getCaseBoardAlerts`. */
export interface LegalHomeContext {
  role: "legal";
  /** Σ documents awaiting review across owned cases. */
  docsToReview: number;
  /** # cases that have at least one document to review. */
  docsCases: number;
  /** # cases the lawyer returned with corrections. */
  corrections: number;
  /** # cases with a failed AI generation to retry. */
  failedGen: number;
  /** # cases with an overdue RFE. */
  rfeOverdue: number;
  /** Total cases Diana owns on the board (fallback message). */
  activeCases: number;
}

/** Andrium · `/finanzas`. From `getCollectionMetrics` + overdue + print queue. */
export interface FinanceHomeContext {
  role: "finance";
  /** # cases with an overdue installment. */
  overdueCases: number;
  /** Overdue amount, page-formatted (e.g. "$1,200"). */
  overdueAmount: string;
  /** # expedientes ready to print. */
  printQueue: number;
  /** Collected this month, in cents (drives whether to show the nudge). */
  collectedCents: number;
  /** Collected this month, page-formatted. */
  collectedAmount: string;
  /** Month-over-month trend label (e.g. "+12%") or null when no baseline. */
  collectedTrendLabel: string | null;
}

/** Henry · `/admin`. From `getAdminOverview` (org-wide). */
export interface AdminHomeContext {
  role: "admin";
  /** # cases with overdue balances. */
  overdueCases: number;
  /** Overdue amount, page-formatted. */
  overdueAmount: string;
  /** Current open cases (fallback message). */
  activeCases: number;
  /** Conversion %, page-formatted (e.g. "24%" or "—"). */
  conversionLabel: string;
  /** Lead funnel stage counts (real) — used to compute the biggest leak. */
  funnel: { newLeads: number; contacted: number; won: number };
  /** Localised stage labels for the leak message. */
  stageLabels: { leads: string; contacted: string; won: string };
}

export type LexContext =
  | SalesHomeContext
  | LegalHomeContext
  | FinanceHomeContext
  | AdminHomeContext;

/**
 * Serialisable view-model the client boards render. Composed by the page from a
 * `LexInsight` + i18n (`composeLexBubble`). `null` → render nothing.
 */
export interface LexBubbleVM {
  /** Stable dismiss key (once closed, stays closed for the session). */
  dismissKey: string;
  /** Localised rich text (`<b>` renders in accent). Composed server-side. */
  html: string;
  /** Localised, serialisable actions. */
  actions: LexBubbleActionVM[];
}

export interface LexBubbleActionVM {
  id: string;
  label: string;
  href?: string;
  ghost?: boolean;
  icon?: string;
}
