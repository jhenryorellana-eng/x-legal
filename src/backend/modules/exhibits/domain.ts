/**
 * Exhibits module — pure domain (state machine, source normalization, selection).
 *
 * NO I/O. Every function here is deterministic and testable with zero mocks.
 *
 * Background: when a legal letter (e.g. the Credible-Fear asylum memorandum) is
 * generated, the AI already produces an "Annexes / Index of Exhibits" table of
 * cited sources (country conditions via web_search, federal jurisprudence from the
 * dataset, plus admin-curated baseline links). Each link in that table must end up
 * physically downloaded, rendered to PDF, and bound into the expediente. This
 * module owns that pipeline; `domain.ts` is the pure core: normalize the cited
 * sources, dedup them, and decide which become physical exhibits.
 *
 * @module exhibits/domain
 */

import { canonicalizeUrl, isLikelyUrl, urlHash } from "@/backend/platform/url-utils";

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

export const EXHIBIT_STATUSES = [
  "pending", // captured, not yet fetched
  "fetching", // a fetch-exhibit job is working on it (claimed)
  "ready", // downloaded + rendered to PDF + stored
  "failed", // retries exhausted (paywall, dead link, no snapshot)
  "manual", // Diana uploaded the PDF by hand
] as const;

export type ExhibitStatus = (typeof EXHIBIT_STATUSES)[number];

/** States in which the fetch handler may (re)claim the exhibit (idempotent claim). */
export const CLAIMABLE_STATUSES: ExhibitStatus[] = ["pending", "fetching", "failed"];

/** Terminal-for-assembly states: the exhibit has usable bytes for the expediente. */
export const ATTACHABLE_STATUSES: ExhibitStatus[] = ["ready", "manual"];

const EXHIBIT_TRANSITIONS: Record<ExhibitStatus, ExhibitStatus[]> = {
  pending: ["fetching", "failed", "manual"],
  fetching: ["ready", "failed", "pending", "manual"], // back to pending = scheduled retry
  ready: ["manual"], // a human may still replace it with a hand-picked copy
  failed: ["fetching", "pending", "manual"], // retry, re-queue, or manual upload
  manual: [], // terminal: human-provided source of truth
};

export function canTransitionExhibit(from: ExhibitStatus, to: ExhibitStatus): boolean {
  return EXHIBIT_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Source taxonomy
// ---------------------------------------------------------------------------

export const EXHIBIT_SOURCE_KINDS = [
  "country_condition", // web_search / dataset country reports (the core of credible-fear)
  "jurisprudence", // federal asylum precedents (full opinion)
  "admin_curated", // baseline links the admin pins on the letter config
  "dataset", // URL-bearing items from the generation's dataset
] as const;

export type ExhibitSourceKind = (typeof EXHIBIT_SOURCE_KINDS)[number];

export const FETCH_METHODS = ["pdf", "render", "archive", "manual"] as const;
export type FetchMethod = (typeof FETCH_METHODS)[number];

/**
 * A source exactly as cited in the letter's Annexes table — pre-normalization.
 * `citeOrder` is the position in that table (the legal order of the exhibits);
 * `exhibitLabel` mirrors the memo's tab ("A-1", "B-3") when present.
 */
export interface RawSource {
  url: string;
  title: string | null;
  publisher: string | null; // author / source_name / court
  publishedDate: string | null; // YYYY-MM-DD or null
  supports: string | null; // "why it helps" / the paragraph it backs
  kind: ExhibitSourceKind;
  citeOrder: number;
  exhibitLabel: string | null;
}

export interface NormalizedExhibit extends RawSource {
  canonicalUrl: string;
  urlHash: string;
}

/**
 * Canonicalizes + dedups the cited sources. The same article cited in several
 * paragraphs (each with different tracking params) collapses to one exhibit; on a
 * collision the LOWEST `citeOrder` wins (first appearance in the Annexes table).
 * Sources without a valid http(s) URL are dropped — a court exhibit needs a real,
 * downloadable source. Output is sorted by `citeOrder` (the legal order).
 */
export function normalizeAndDedup(sources: RawSource[]): NormalizedExhibit[] {
  const byHash = new Map<string, NormalizedExhibit>();
  for (const s of sources) {
    if (!isLikelyUrl(s.url)) continue;
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(s.url);
    } catch {
      continue;
    }
    const hash = urlHash(canonicalUrl);
    const existing = byHash.get(hash);
    if (!existing || s.citeOrder < existing.citeOrder) {
      byHash.set(hash, { ...s, canonicalUrl, urlHash: hash });
    }
  }
  return [...byHash.values()].sort((a, b) => a.citeOrder - b.citeOrder);
}

// ---------------------------------------------------------------------------
// Selection policy — which cited sources become physical exhibits
// ---------------------------------------------------------------------------

export interface AttachPolicy {
  /** Source kinds the admin enabled for this letter (config.attach_sources_kinds). */
  enabledKinds: ExhibitSourceKind[];
  /** Optional hard cap on the number of physical exhibits (keeps filings sane). */
  maxExhibits?: number | null;
}

/**
 * Decides which normalized sources are actually downloaded and bound as exhibits.
 *
 * ── Business lever (Henry can tune) ───────────────────────────────────────────
 * This is the rule that shapes filing size, render cost, and defensibility. The
 * default below is deliberately simple — keep only the kinds the admin enabled,
 * preserve the legal (citeOrder) order, and apply an optional cap. Tighten it here
 * when you want to, e.g.: skip notorious paywall domains, require a `publishedDate`
 * for country_condition sources, or only attach a jurisprudence opinion when it is
 * short. Inputs are already deduped + sorted by `normalizeAndDedup`.
 */
export function selectExhibitsToAttach(
  sources: NormalizedExhibit[],
  policy: AttachPolicy,
): NormalizedExhibit[] {
  const enabled = new Set(policy.enabledKinds);
  const selected = sources.filter((s) => enabled.has(s.kind));
  const cap = policy.maxExhibits ?? null;
  return cap != null && cap >= 0 ? selected.slice(0, cap) : selected;
}

// ---------------------------------------------------------------------------
// Bot-block / error-page detection (a rendered 403/"forbidden" page is still a
// valid PDF — without this it would be filed as a real exhibit, e.g. State Dept)
// ---------------------------------------------------------------------------

/** Hard bot-block / interstitial phrases — if present near the top, it's not the source. */
const HARD_BLOCK = /(technical difficulties|access denied|are you a (human|robot)|\bcaptcha\b|just a moment|checking your browser|request (was )?blocked|enable (javascript|cookies)|verify you are human|attention required)/i;
/** Softer error phrases — only damning when the document carries little real content. */
const SOFT_ERROR = /(\bforbidden\b|temporarily unavailable|please try again|service unavailable|429 too many|rate limit|error 1\d{3}|502 bad gateway|503 service)/i;

/**
 * Heuristic: does the extracted text look like a bot-block / error page rather than
 * the real source? Checks the HEAD of the text (so a multi-page repeated error page
 * still trips it). Hard block phrases trip regardless of length; soft phrases only on
 * a thin document; a near-empty render is also rejected. Tuned to avoid false
 * positives on long legal prose that merely mentions a word like "forbidden".
 */
export function isErrorPageText(text: string, pageCount: number): boolean {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 200 && pageCount >= 1) return true; // empty/near-empty render
  const head = t.slice(0, 1200);
  if (HARD_BLOCK.test(head)) return true;
  if (SOFT_ERROR.test(head) && t.length < 2000) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Index of Exhibits — the formal court divider page (Tab · Source · Date · Supports)
// ---------------------------------------------------------------------------

const IDX_NAVY = "#0b1f3a";
const IDX_GOLD = "#c8a24a";

export interface ExhibitIndexRow {
  label: string | null; // exhibit tab (A-1, B-1…)
  source: string; // publisher / title
  date: string | null; // published date
  supports: string | null; // brief relevance ("why it helps")
}

/** Builds the "Index of Exhibits" HTML table (navy/gold, matching the master TOC),
 *  one row per exhibit. Pure — `htmlToPdf` turns it into the divider page that sits
 *  before the exhibits in the compiled expediente. */
export function buildExhibitIndexHtml(rows: ExhibitIndexRow[]): string {
  const esc = (s: string) =>
    String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const th = `text-align:left;font-size:10pt;font-weight:bold;text-transform:uppercase;color:${IDX_GOLD};padding:0 8pt 6pt 0;border-bottom:1pt solid ${IDX_GOLD}`;
  const td = "font-size:11pt;padding:6pt 8pt 6pt 0;vertical-align:top;border-bottom:0.5pt solid #d9dee7";
  const body = rows
    .map(
      (r) =>
        `<tr><td style="${td};font-weight:bold;white-space:nowrap">${esc(r.label ?? "—")}</td>` +
        `<td style="${td}">${esc(r.source)}</td>` +
        `<td style="${td};white-space:nowrap">${esc(r.date ?? "—")}</td>` +
        `<td style="${td}">${esc(r.supports ?? "")}</td></tr>`,
    )
    .join("");
  return (
    `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;margin:54pt 60pt;color:${IDX_NAVY}">` +
    `<div style="font-size:22pt;font-weight:bold;margin:0 0 4pt">Index of Exhibits</div>` +
    `<div style="border-top:2pt solid ${IDX_GOLD};margin-bottom:14pt"></div>` +
    `<table style="width:100%;border-collapse:collapse">` +
    `<thead><tr><th style="${th}">Exhibit</th><th style="${th}">Source</th><th style="${th}">Date</th><th style="${th}">Supports</th></tr></thead>` +
    `<tbody>${body}</tbody></table></body></html>`
  );
}
