/**
 * Zelle reconciliation — pure domain (parser, authenticity, ref codes, names,
 * scoring, match decision).
 *
 * NO I/O. Everything here is deterministic and unit-tested against the real
 * Chase .eml fixtures. Ported from the tested design in
 * IMPLEMENTACION-ZELLE-USALATINO.md, adapted to this schema (installments in
 * cents, case_number as ref code) and hardened per the Codex review
 * (two-tier decision, circuit breakers, no fuzzy ref correction).
 *
 * @module zelle-recon/domain
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const CHASE_CONFIG = {
  /** authserv-id Migadu stamps on reception. MX hosts rotate (mx11, mx13…). */
  authservIdPattern: /^mx\d+\.migadu\.com$/i,
  /** Domain that MUST have signed with DKIM. */
  signingDomain: "chase.com",
  /** Expected visible From address. */
  fromAddress: "no.reply.alerts@chase.com",
  /** Envelope sender carries a rotating numeric suffix: .01@, .06@, .10@… */
  envelopeFromPattern: /^no\.reply\.alerts(\.\d+)?@chase\.com$/i,
  /** Expected subject (® arrives RFC-2047 encoded; compare decoded). */
  subjectPattern: /^You received money with Zelle/i,
} as const;

/**
 * Template fingerprints observed in REAL production emails (2026-07 fixtures).
 * Chase runs two sender systems (digital-pymt-comm-service and
 * p2p-payment-product-service) and both template ids are live. An unknown id
 * fails CLOSED: parse still runs, but nothing auto-approves and staff is
 * alerted to re-verify the parser.
 */
export const KNOWN_TEMPLATE_IDS: readonly string[] = [
  "zelle_auto_accept_receiver",
  "zelle_auto_accept_receiver_chase_email",
];

export const SCORER_VERSION = 1;

// ---------------------------------------------------------------------------
// MIME utilities
// ---------------------------------------------------------------------------

/**
 * Decodes quoted-printable to UTF-8.
 *
 * CRITICAL: Chase sends the body quoted-printable with soft line breaks ("="
 * at end of line) that split words in half — a real email carried
 * "CRISTAL BON=\nILLA CASANOVA". If the HTML is parsed without decoding
 * first, the surname comes out broken and matching fails silently. This
 * function ALWAYS runs before any regex. `input` must have been read as
 * latin1/binary so each char is one byte.
 */
export function decodeQuotedPrintable(input: string): string {
  const noSoftBreaks = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const ch = noSoftBreaks[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(noSoftBreaks.substr(i + 1, 2))) {
      bytes.push(parseInt(noSoftBreaks.substr(i + 1, 2), 16));
      i += 2;
    } else {
      bytes.push(noSoftBreaks.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&reg;": "®",
};

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Authenticity — the Migadu Authentication-Results stamp
// ---------------------------------------------------------------------------

export interface AuthVerdict {
  ok: boolean;
  dkim: string | null;
  spf: string | null;
  dmarc: string | null;
  reasons: string[];
}

/**
 * Decides whether the email really came from Chase.
 *
 * Migadu validates DKIM/SPF/DMARC on reception and stamps the verdict in
 * `Authentication-Results: mx13.migadu.com; …`. That stamp is trustworthy
 * BECAUSE the final server writes it — but only if the right header is read:
 * an attacker can pre-insert a forged Authentication-Results with the same
 * authserv-id, and Migadu appends its own without removing the fake. Hence:
 * MORE THAN ONE Migadu-stamped header → reject (header injection).
 *
 * The caller must pass ONLY `Authentication-Results` header values —
 * `ARC-Authentication-Results` is a different header and never counts.
 */
export function verifyChaseAuthenticity(input: {
  authenticationResults: string[];
  fromAddress: string | null;
  subject: string | null;
}): AuthVerdict {
  const reasons: string[] = [];
  const verdict: AuthVerdict = { ok: false, dkim: null, spf: null, dmarc: null, reasons };

  const stamps = input.authenticationResults.filter((v) =>
    CHASE_CONFIG.authservIdPattern.test(v.split(";")[0].trim()),
  );

  if (stamps.length === 0) {
    reasons.push("No Authentication-Results stamped by Migadu.");
    return verdict;
  }
  if (stamps.length > 1) {
    reasons.push(
      `${stamps.length} Authentication-Results headers carry a Migadu authserv-id — ` +
        "possible header injection; rejected.",
    );
    return verdict;
  }

  const stamp = stamps[0];
  let dkimOk = false;
  let spfOk = false;
  let dmarcOk = false;

  const dkimMatch = stamp.match(/\bdkim=(\w+)([^;]*)/i);
  verdict.dkim = dkimMatch?.[1]?.toLowerCase() ?? null;
  if (verdict.dkim === "pass") {
    const d = dkimMatch?.[2]?.match(/header\.d=([^\s;]+)/i)?.[1]?.toLowerCase();
    if (d === CHASE_CONFIG.signingDomain) dkimOk = true;
    else reasons.push(`DKIM signed for "${d ?? "?"}", not ${CHASE_CONFIG.signingDomain}.`);
  } else {
    reasons.push(`DKIM did not pass (${verdict.dkim ?? "absent"}).`);
  }

  const spfMatch = stamp.match(/\bspf=(\w+)/i);
  verdict.spf = spfMatch?.[1]?.toLowerCase() ?? null;
  if (verdict.spf === "pass") {
    const mailfrom = stamp.match(/smtp\.mailfrom=([^\s;]+)/i)?.[1] ?? "";
    if (CHASE_CONFIG.envelopeFromPattern.test(mailfrom)) spfOk = true;
    else reasons.push(`SPF passed but envelope sender is "${mailfrom}".`);
  } else {
    reasons.push(`SPF did not pass (${verdict.spf ?? "absent"}).`);
  }

  const dmarcMatch = stamp.match(/\bdmarc=(\w+)([^;]*)/i);
  verdict.dmarc = dmarcMatch?.[1]?.toLowerCase() ?? null;
  if (verdict.dmarc === "pass") {
    const hf = dmarcMatch?.[2]?.match(/header\.from=([^\s;]+)/i)?.[1]?.toLowerCase();
    if (hf === CHASE_CONFIG.signingDomain) dmarcOk = true;
    else reasons.push(`DMARC aligned with "${hf ?? "?"}".`);
  } else {
    reasons.push(`DMARC did not pass (${verdict.dmarc ?? "absent"}).`);
  }

  const fromAddr = (input.fromAddress ?? "").trim().toLowerCase();
  const fromOk = fromAddr === CHASE_CONFIG.fromAddress;
  if (!fromOk) reasons.push(`Unexpected From: "${fromAddr}".`);

  const subjectOk = CHASE_CONFIG.subjectPattern.test(input.subject ?? "");
  if (!subjectOk) reasons.push(`Unexpected subject: "${input.subject ?? ""}".`);

  verdict.ok = dkimOk && spfOk && dmarcOk && fromOk && subjectOk;
  return verdict;
}

// ---------------------------------------------------------------------------
// Chase HTML parser
// ---------------------------------------------------------------------------

export interface ChaseZellePayment {
  senderName: string;
  amountCents: number;
  /** ISO YYYY-MM-DD as declared by Chase (no time, no zone); null if absent. */
  sentOn: string | null;
  transactionNumber: string;
  memo: string | null;
  templateId: string | null;
  /** true when the known template set contains templateId (fail-closed gate). */
  templateKnown: boolean;
  /** true if the <h1> name reappears in the "… is registered with" paragraph. */
  nameCrossChecked: boolean;
}

export type ChaseParseErrorCode =
  | "PARSE_FAILED"
  | "MISSING_FIELD"
  | "BAD_AMOUNT"
  | "BAD_DATE";

export class ChaseParseError extends Error {
  constructor(
    message: string,
    public readonly code: ChaseParseErrorCode,
  ) {
    super(message);
    this.name = "ChaseParseError";
  }
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** "Jul 22, 2026" → "2026-07-22". Explicit map — independent of Node's locale. */
function parseChaseDate(raw: string): string {
  const m = raw.trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) throw new ChaseParseError(`Unrecognized date: "${raw}"`, "BAD_DATE");
  const mm = MONTHS[m[1].toLowerCase()];
  if (!mm) throw new ChaseParseError(`Unrecognized month: "${m[1]}"`, "BAD_DATE");
  return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
}

/** "$1,234.56" → 123456 (integer cents — the schema's currency unit). */
function parseAmountCents(raw: string): number {
  const m = raw.match(/\$?\s*([\d,]+)(?:\.(\d{2}))?/);
  if (!m) throw new ChaseParseError(`Unreadable amount: "${raw}"`, "BAD_AMOUNT");
  const dollars = Number(m[1].replace(/,/g, ""));
  const cents = m[2] ? Number(m[2]) : 0;
  const total = dollars * 100 + cents;
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new ChaseParseError(`Invalid amount: "${raw}"`, "BAD_AMOUNT");
  }
  return total;
}

/**
 * Extracts the payment data. Receives HTML ALREADY decoded from
 * quoted-printable. Throws ChaseParseError when the template does not line up
 * — the caller must send the email to manual review, never discard silently.
 */
export function parseChaseZelleEmail(html: string): ChaseZellePayment {
  // First <title> only — the Chase template carries a second, empty <title>
  // further down the body (observed in every real fixture).
  const templateId = html.match(/<title>\s*([^<]*?)\s*<\/title>/i)?.[1] || null;

  // 1. Sender name: the <h1> is the template's most stable anchor.
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (!h1) throw new ChaseParseError("No <h1> with the sender found", "PARSE_FAILED");
  const headline = stripTags(h1);
  const nameMatch = headline.match(/^(.+?)\s+sent you money\b/i);
  if (!nameMatch) throw new ChaseParseError(`Unexpected headline: "${headline}"`, "PARSE_FAILED");
  const senderName = nameMatch[1].trim();

  // 2. Details table: scope to the block after "Here are the details" and read
  //    the <td> cells as label/value pairs — more tolerant to inline-style
  //    churn than one regex per field.
  const detailsStart = html.search(/Here are the details/i);
  if (detailsStart === -1) {
    throw new ChaseParseError("Details block not found", "PARSE_FAILED");
  }
  const tableStart = html.indexOf("<table", detailsStart);
  const tableEnd = html.indexOf("</table>", tableStart);
  if (tableStart === -1 || tableEnd === -1) {
    throw new ChaseParseError("Details table not found", "PARSE_FAILED");
  }
  const table = html.slice(tableStart, tableEnd);

  const cells = [...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]));
  const fields = new Map<string, string>();
  for (let i = 0; i + 1 < cells.length; i += 2) {
    fields.set(cells[i].toLowerCase(), cells[i + 1]);
  }

  const need = (label: string): string => {
    const v = fields.get(label);
    if (v === undefined || v === "") {
      throw new ChaseParseError(`Missing field "${label}"`, "MISSING_FIELD");
    }
    return v;
  };

  // 3. Amount (cents)
  const amountCents = parseAmountCents(need("amount"));

  // 4. Transaction number → idempotency key (survives Chase alert resends,
  //    where Message-ID may change but the transaction number never does)
  const txnRaw = need("transaction number");
  const transactionNumber = txnRaw.replace(/\s+/g, "");
  if (!/^\d{6,}$/.test(transactionNumber)) {
    throw new ChaseParseError(`Invalid transaction number: "${txnRaw}"`, "MISSING_FIELD");
  }

  // 5. Memo — optional, very often "N/A"
  const memoRaw = fields.get("memo") ?? "";
  const memo = !memoRaw || /^n\s*\/?\s*a$/i.test(memoRaw) ? null : memoRaw;

  // 6. Free cross-check: Chase repeats the name in the paragraph below
  //    ("X is registered with a Zelle® member bank…").
  const nameCrossChecked = new RegExp(
    escapeRegExp(senderName) + "\\s+is registered with a Zelle",
    "i",
  ).test(stripTags(html));

  // Sent on is nullable defensive: a missing date must not lose the payment.
  let sentOn: string | null = null;
  const sentOnRaw = fields.get("sent on");
  if (sentOnRaw) sentOn = parseChaseDate(sentOnRaw);

  return {
    senderName,
    amountCents,
    sentOn,
    transactionNumber,
    memo,
    templateId,
    templateKnown: templateId !== null && KNOWN_TEMPLATE_IDS.includes(templateId),
    nameCrossChecked,
  };
}

// ---------------------------------------------------------------------------
// Reference codes (case numbers in the memo)
// ---------------------------------------------------------------------------

export interface RefCodeExtraction {
  /** Canonical "U26-000107" when exactly one distinct code was found. */
  canonical: string | null;
  /** Every distinct canonical code found, in order of appearance. */
  all: string[];
  /** ≥2 DISTINCT codes → nobody can tell which case the payer meant. */
  ambiguous: boolean;
}

/**
 * Tolerant-but-not-fuzzy ref-code extraction (Codex-agreed rule): controlled
 * separator tolerance only. Accepts "U26-000107", "U26 000107", "u26000107",
 * "U 26 - 000107". Never edit-distance correction, never guessed zero-padding
 * ("U26-107" does NOT match), never digits without the UYY prefix.
 */
export function extractRefCode(text: string | null | undefined): RefCodeExtraction {
  if (!text) return { canonical: null, all: [], ambiguous: false };
  const normalized = text
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ");

  const seen = new Set<string>();
  const all: string[] = [];
  for (const m of normalized.matchAll(/(?:^|[^A-Z0-9])U[\s-]*(\d{2})[\s-]*(\d{6})(?!\d)/g)) {
    const canonical = `U${m[1]}-${m[2]}`;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      all.push(canonical);
    }
  }

  return {
    canonical: all.length === 1 ? all[0] : null,
    all,
    ambiguous: all.length > 1,
  };
}

// ---------------------------------------------------------------------------
// Name normalization + similarity (Hispanic-name aware)
// ---------------------------------------------------------------------------

/**
 * Normalization designed for Hispanic names: two surnames, middle initials,
 * variable order between the CRM and what the person registered at their
 * bank. Drops 1-letter tokens ("ELIANA M VILLA" → ELIANA VILLA) and sorts
 * alphabetically so order stops mattering. Mirror this if it ever moves to SQL.
 */
export function normalizePayerName(input: string): string {
  const noAccents = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/Ñ/g, "N")
    .replace(/ñ/g, "n");
  return noAccents
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1)
    .sort()
    .join(" ");
}

function nameTokens(name: string): Set<string> {
  return new Set(normalizePayerName(name).split(" ").filter((t) => t !== ""));
}

/** Token Jaccard — with compound names, one missing surname degrades
 *  proportionally instead of ruining a whole-string similarity. */
export function nameJaccard(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function nameSharedTokens(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared;
}

/**
 * Containment: the bank almost always carries FEWER name tokens than the CRM
 * ("LUCIA PAREDES" vs "Lucia Fernanda Paredes Solis de Ramirez"). Measures
 * whether the shorter name is contained in the longer one. Callers must also
 * require ≥2 shared tokens — otherwise a lone "MARIA" would have perfect
 * containment against every María in the system.
 */
export function nameContainment(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  const min = Math.min(ta.size, tb.size);
  if (min === 0) return 0;
  return nameSharedTokens(a, b) / min;
}

// ---------------------------------------------------------------------------
// Scoring + match decision (two-tier)
// ---------------------------------------------------------------------------

export interface NotificationFacts {
  senderName: string;
  normalizedSender: string;
  amountCents: number;
  sentOn: string | null;
  memo: string | null;
  /** Canonical ref code, if exactly one was found in the memo. */
  refCode: string | null;
  refAmbiguous: boolean;
  authOk: boolean;
  templateKnown: boolean;
}

export interface MatchCandidate {
  caseId: string;
  caseNumber: string;
  serviceSlug: string | null;
  installmentId: string;
  installmentNumber: number;
  isDownpayment: boolean;
  amountCents: number;
  dueDate: string;
  status: "pending" | "overdue";
  clientUserId: string;
  clientFullName: string;
  /** An unexpired Stripe checkout is in flight for this installment. */
  hasPendingStripe: boolean;
  /** A client-uploaded Zelle proof is pending verification (link, don't dup). */
  pendingZellePaymentId: string | null;
  /** Remaining unpaid balance of the whole case, in cents. */
  caseBalanceCents: number;
}

export interface PayerAlias {
  normalizedName: string;
  clientUserId: string;
  relationship: "self" | "family" | "third_party";
  confirmationsCount: number;
  revoked: boolean;
}

export interface ReconConfig {
  enabled: boolean;
  tierAMaxAmountCents: number;
  dailyAutoMaxCents: number;
  dailyAutoMaxCount: number;
  perPayerDailyMax: number;
  tierBMode: "review_only" | "auto";
}

export const DEFAULT_RECON_CONFIG: ReconConfig = {
  enabled: false, // dark-launch: pipeline fills the inbox, nothing auto-applies
  tierAMaxAmountCents: 50_000, // $500 — Henry's day-1 ceiling
  dailyAutoMaxCents: 250_000, // $2,500/day aggregate circuit breaker
  dailyAutoMaxCount: 5,
  perPayerDailyMax: 2,
  tierBMode: "review_only",
};

export interface DailyAutoStats {
  totalCents: number;
  count: number;
  /** Auto-approvals today keyed by normalized payer name. */
  byPayer: Record<string, number>;
}

export type MatchSignals = Record<string, number | string | boolean>;

export interface ScoredCandidate extends MatchCandidate {
  score: number;
  signals: MatchSignals;
}

/** Tier-B thresholds (ported from the tested design). */
const TIER_B_MIN_SUGGEST = 25;
const TIER_B_MIN_SCORE = 85;
const TIER_B_MIN_MARGIN = 15;

/**
 * Heuristic score of one candidate (tier B). Signals are additive; the
 * identity gate caps the total at 40 when NOTHING identifies the payer —
 * amount and recency are confirmation, never identification (two clients
 * owing $500 score identically on amount).
 */
export function scoreCandidate(
  n: NotificationFacts,
  c: MatchCandidate,
  aliases: PayerAlias[],
  identityFanout: number,
): { score: number; signals: MatchSignals } {
  const alias = aliases.find(
    (a) => !a.revoked && a.clientUserId === c.clientUserId && a.normalizedName === n.normalizedSender,
  );

  // Identity conflict: the payer's name maps to ≥2 clients with open
  // installments. The alias stops proving WHO the money is for — it only
  // proves the family circle. It drops from 60 to 25 and blocks auto.
  const conflicted = identityFanout >= 2;
  const sAlias = alias ? (conflicted ? 25 : 60) : 0;

  const jaccard = nameJaccard(n.senderName, c.clientFullName);
  const shared = nameSharedTokens(n.senderName, c.clientFullName);
  const containment = nameContainment(n.senderName, c.clientFullName);

  const sName =
    jaccard >= 0.8 ? 35
    : jaccard >= 0.5 ? 25
    : shared >= 2 && containment >= 0.75 ? 20
    : jaccard >= 0.3 ? 10
    : 0;

  const sBalance = n.amountCents === c.caseBalanceCents ? 30 : 0;
  const sInstallment = n.amountCents === c.amountCents ? 20 : 0;

  // Memo mentions the service ("apelacion" → the appeal case)
  const sMemo =
    n.memo && c.serviceSlug &&
    normalizePayerName(n.memo).includes(normalizePayerName(c.serviceSlug.replace(/-/g, " ")))
      ? 10
      : 0;

  // Recency: the installment's due date within 30 days of the payment date.
  let sRecent = 0;
  if (n.sentOn) {
    const dueMs = Date.parse(`${c.dueDate}T00:00:00Z`);
    const sentMs = Date.parse(`${n.sentOn}T00:00:00Z`);
    if (Number.isFinite(dueMs) && Number.isFinite(sentMs)) {
      const days = Math.abs(dueMs - sentMs) / 86_400_000;
      if (days <= 30) sRecent = 10;
    }
  }

  const rawTotal = sAlias + sName + sBalance + sInstallment + sMemo + sRecent;

  // IDENTITY GATE: without evidence of WHO paid (confirmed alias or enough of
  // the name), the score is capped at 40 — far below auto-approval.
  const hasIdentity =
    sAlias > 0 || jaccard >= 0.5 || (shared >= 2 && containment >= 0.75);
  const score = hasIdentity ? rawTotal : Math.min(rawTotal, 40);

  return {
    score,
    signals: {
      scorer_version: SCORER_VERSION,
      alias: sAlias,
      alias_relationship: alias?.relationship ?? "",
      name: sName,
      balance: sBalance,
      installment: sInstallment,
      memo: sMemo,
      recent: sRecent,
      jaccard: Math.round(jaccard * 10_000) / 10_000,
      shared_tokens: shared,
      containment: Math.round(containment * 10_000) / 10_000,
      has_identity: hasIdentity,
      identity_fanout: identityFanout,
      raw_total: rawTotal,
    },
  };
}

export type MatchDecision =
  | {
      action: "auto_approve";
      tier: "A" | "B";
      candidate: MatchCandidate;
      score: number;
      signals: MatchSignals;
    }
  | {
      action: "review";
      tier: "A" | "B" | null;
      reason: string;
      candidates: ScoredCandidate[];
    }
  | { action: "unmatched"; reason: string };

export type RefResolution =
  | { status: "none" }
  | { status: "ambiguous" }
  | { status: "unknown"; refCode: string }
  | { status: "resolved"; refCode: string; caseId: string };

/** Shared circuit-breaker gate for BOTH tiers. Returns a refusal reason or null. */
function breakerReason(
  n: NotificationFacts,
  c: MatchCandidate,
  cfg: ReconConfig,
  today: DailyAutoStats,
): string | null {
  if (!cfg.enabled) return "breaker_disabled";
  if (n.amountCents > cfg.tierAMaxAmountCents) return "over_amount_cap";
  if (today.count >= cfg.dailyAutoMaxCount) return "daily_count_cap";
  if (today.totalCents + n.amountCents > cfg.dailyAutoMaxCents) return "daily_amount_cap";
  if ((today.byPayer[n.normalizedSender] ?? 0) >= cfg.perPayerDailyMax) return "payer_daily_cap";
  if (c.hasPendingStripe) return "stripe_pending";
  if (c.pendingZellePaymentId) return "client_proof_pending";
  return null;
}

/**
 * The decision heart. Two tiers (agreed with Codex):
 *
 *   TIER A (deterministic): exactly one valid ref code → resolves to a case
 *   with EXACTLY ONE payable installment of the EXACT amount, no in-flight
 *   payment, no contradicting alias history, breakers clear → auto-approve.
 *
 *   TIER B (heuristic): everything else scores for the review inbox. Auto
 *   only when tierBMode === "auto" (off at launch) AND score ≥85, margin
 *   ≥15, exact installment amount, identity present, no conflict, breakers
 *   clear.
 *
 * An invalid or ambiguous explicit ref NEVER falls back to heuristic auto —
 * a bad identifier is a conflict signal, not "no signal".
 */
export function decideMatch(
  n: NotificationFacts,
  ref: RefResolution,
  candidates: MatchCandidate[],
  aliases: PayerAlias[],
  cfg: ReconConfig,
  today: DailyAutoStats,
): MatchDecision {
  const activeAliases = aliases.filter(
    (a) => !a.revoked && a.normalizedName === n.normalizedSender,
  );
  // Fanout = distinct clients this payer's confirmed history points at,
  // restricted to clients that actually have payable installments right now.
  const candidateClients = new Set(candidates.map((c) => c.clientUserId));
  const fanout = new Set(
    activeAliases.filter((a) => candidateClients.has(a.clientUserId)).map((a) => a.clientUserId),
  ).size;

  const scoreAll = (): ScoredCandidate[] =>
    candidates
      .map((c) => ({ ...c, ...scoreCandidate(n, c, activeAliases, fanout) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

  // Fail-closed gates that block ANY auto-approval outright.
  if (!n.authOk) {
    return { action: "review", tier: null, reason: "auth_failed", candidates: scoreAll() };
  }
  if (!n.templateKnown) {
    return { action: "review", tier: null, reason: "template_changed", candidates: scoreAll() };
  }
  if (n.refAmbiguous) {
    return { action: "review", tier: null, reason: "ambiguous_ref", candidates: scoreAll() };
  }

  // ----- Explicit ref code path (tier A or review — never heuristic auto) ---
  if (ref.status === "unknown") {
    return { action: "review", tier: "A", reason: "unknown_reference", candidates: scoreAll() };
  }
  if (ref.status === "resolved") {
    const caseCandidates = candidates.filter((c) => c.caseId === ref.caseId);
    if (caseCandidates.length === 0) {
      // Case exists but nothing payable (already paid by card? waived?).
      return { action: "review", tier: "A", reason: "case_no_payable", candidates: scoreAll() };
    }
    const exact = caseCandidates.filter((c) => c.amountCents === n.amountCents);
    if (exact.length === 0) {
      // Partial / lump / mismatched amount — the domain has no partial payments.
      return {
        action: "review",
        tier: "A",
        reason: "amount_mismatch",
        candidates: caseCandidates.map((c) => ({ ...c, ...scoreCandidate(n, c, activeAliases, fanout) })),
      };
    }
    if (exact.length > 1) {
      return {
        action: "review",
        tier: "A",
        reason: "multi_installment",
        candidates: exact.map((c) => ({ ...c, ...scoreCandidate(n, c, activeAliases, fanout) })),
      };
    }

    const candidate = exact[0];

    // Sibling-typo guard (Codex): the payer's CONFIRMED history points
    // exclusively at a different client → a valid-looking ref may be a typo'd
    // family case number. Ask instead of guessing.
    const aliasClients = new Set(activeAliases.map((a) => a.clientUserId));
    if (aliasClients.size > 0 && !aliasClients.has(candidate.clientUserId)) {
      return {
        action: "review",
        tier: "A",
        reason: "identity_conflict",
        candidates: [{ ...candidate, ...scoreCandidate(n, candidate, activeAliases, fanout) }],
      };
    }

    const breaker = breakerReason(n, candidate, cfg, today);
    if (breaker) {
      return {
        action: "review",
        tier: "A",
        reason: breaker,
        candidates: [{ ...candidate, ...scoreCandidate(n, candidate, activeAliases, fanout) }],
      };
    }

    const scored = scoreCandidate(n, candidate, activeAliases, fanout);
    return {
      action: "auto_approve",
      tier: "A",
      candidate,
      score: scored.score,
      signals: { ...scored.signals, ref_exact: true, ref_code: ref.refCode },
    };
  }

  // ----- No ref: heuristic tier B -----------------------------------------
  const scored = scoreAll();
  if (scored.length === 0 || scored[0].score < TIER_B_MIN_SUGGEST) {
    // Deliberate: below the suggest floor we show NO candidate at all — a
    // random name on screen invites confirming without looking.
    return { action: "unmatched", reason: "no_identifiable_client" };
  }

  const best = scored[0];
  const second = scored[1]?.score ?? 0;

  if (cfg.tierBMode === "auto") {
    const conflicted = (best.signals.identity_fanout as number) >= 2;
    const eligible =
      best.score >= TIER_B_MIN_SCORE &&
      best.score - second >= TIER_B_MIN_MARGIN &&
      best.amountCents === n.amountCents &&
      best.signals.has_identity === true &&
      !conflicted;
    if (eligible) {
      const breaker = breakerReason(n, best, cfg, today);
      if (!breaker) {
        return {
          action: "auto_approve",
          tier: "B",
          candidate: best,
          score: best.score,
          signals: best.signals,
        };
      }
    }
  }

  return { action: "review", tier: "B", reason: "tier_b", candidates: scored };
}
