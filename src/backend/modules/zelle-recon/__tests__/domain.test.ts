/**
 * zelle-recon domain — parser, authenticity, ref codes, names, scoring,
 * decision. Pure functions, zero mocks.
 *
 * Two layers:
 *  - Synthetic structural suite (always runs, CI-safe): a minimal Chase-like
 *    email built in-code, plus attack mutations.
 *  - Real-fixture regression (runs when the gitignored .eml files are present
 *    locally): the three production emails from 2026-07-20/22.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeQuotedPrintable,
  verifyChaseAuthenticity,
  parseChaseZelleEmail,
  ChaseParseError,
  extractRefCode,
  normalizePayerName,
  nameJaccard,
  nameContainment,
  nameSharedTokens,
  scoreCandidate,
  decideMatch,
  DEFAULT_RECON_CONFIG,
  KNOWN_TEMPLATE_IDS,
  type MatchCandidate,
  type NotificationFacts,
  type PayerAlias,
  type ReconConfig,
  type DailyAutoStats,
} from "../domain";

// ---------------------------------------------------------------------------
// Test helpers: raw .eml handling (the service uses mailparser; tests keep a
// tiny independent splitter so the domain contract is exercised directly)
// ---------------------------------------------------------------------------

function splitRawEmail(raw: string): { headerLines: Array<{ key: string; value: string }>; body: string } {
  const sep = raw.search(/\r?\n\r?\n/);
  const headerBlock = sep === -1 ? raw : raw.slice(0, sep);
  const body = sep === -1 ? "" : raw.slice(sep).replace(/^\r?\n\r?\n/, "").replace(/^\r?\n/, "");

  const headerLines: Array<{ key: string; value: string }> = [];
  let current: string | null = null;
  for (const line of headerBlock.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && current !== null) {
      current += " " + line.trim();
      continue;
    }
    if (current !== null) headerLines.push(toHeader(current));
    current = line;
  }
  if (current !== null) headerLines.push(toHeader(current));
  return { headerLines, body };
}

function toHeader(line: string): { key: string; value: string } {
  const idx = line.indexOf(":");
  if (idx === -1) return { key: line.trim().toLowerCase(), value: "" };
  return { key: line.slice(0, idx).trim().toLowerCase(), value: line.slice(idx + 1).trim() };
}

/** Minimal RFC-2047 Q-decode — enough for the Chase subject (®). */
function decodeSubject(value: string): string {
  return value.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_m, _cs, enc, text) => {
    if (/^b$/i.test(enc)) return Buffer.from(text, "base64").toString("utf8");
    return decodeQuotedPrintable(String(text).replace(/_/g, " "));
  });
}

function authInputFromRaw(raw: string): {
  authenticationResults: string[];
  fromAddress: string | null;
  subject: string | null;
} {
  const { headerLines } = splitRawEmail(raw);
  // ARC-Authentication-Results is a DIFFERENT header key and never included.
  const authenticationResults = headerLines
    .filter((h) => h.key === "authentication-results")
    .map((h) => h.value);
  const fromRaw = headerLines.find((h) => h.key === "from")?.value ?? "";
  const fromAddress = fromRaw.match(/<([^>]+)>/)?.[1]?.toLowerCase() ?? fromRaw.toLowerCase() ?? null;
  const subjectRaw = headerLines.find((h) => h.key === "subject")?.value ?? null;
  return {
    authenticationResults,
    fromAddress,
    subject: subjectRaw ? decodeSubject(subjectRaw) : null,
  };
}

function parseRaw(raw: string) {
  const { body } = splitRawEmail(raw);
  return parseChaseZelleEmail(decodeQuotedPrintable(body));
}

// ---------------------------------------------------------------------------
// Synthetic Chase-like email (CI-safe structural coverage)
// ---------------------------------------------------------------------------

const SYNTH_AUTH_STAMP =
  "mx13.migadu.com; dkim=pass header.d=chase.com header.s=d4815 header.b=abc123; " +
  "spf=pass (mx13.migadu.com: domain of no.reply.alerts.01@chase.com designates 1.2.3.4 as permitted sender) " +
  "smtp.mailfrom=no.reply.alerts.01@chase.com; dmarc=pass (policy=reject) header.from=chase.com";

/** QP body with a soft line break splitting the surname — the real trap. */
const SYNTH_BODY_QP = [
  '<html><head><title>zelle_auto_accept_receiver</title></head><body>',
  "<h1>ROSA VILLAFU=",
  "ERTE AYALA sent you money</h1>",
  "<p>Here are the details:</p>",
  "<table><tbody>",
  "<tr><td>Amount</td><td><b>$1,234.56</b></td></tr>",
  "<tr><td>Sent on</td><td><b>Jul 23, 2026</b></td></tr>",
  "<tr><td>Transaction number</td><td><b>30999888777</b></td></tr>",
  "<tr><td>Memo</td><td><b>caso U26 000107 gracias</b></td></tr>",
  "</tbody></table>",
  "<p>ROSA VILLAFUERTE AYALA is registered with a Zelle=C2=AE member bank.</p>",
  "<title></title>",
  "</body></html>",
].join("\r\n");

const SYNTH_RAW = [
  "Delivered-To: henryorellana@usalatinoprime.com",
  "ARC-Authentication-Results: i=1; mx13.migadu.com; dkim=pass header.d=chase.com",
  `Authentication-Results: ${SYNTH_AUTH_STAMP}`,
  "From: Chase <no.reply.alerts@chase.com>",
  "To: henryorellana@usalatinoprime.com",
  "Subject: =?UTF-8?Q?You_received_money_with_Zelle=C2=AE?=",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  SYNTH_BODY_QP,
].join("\r\n");

describe("parseChaseZelleEmail (synthetic)", () => {
  it("reassembles a QP soft-break-split surname before parsing", () => {
    const p = parseRaw(SYNTH_RAW);
    expect(p.senderName).toBe("ROSA VILLAFUERTE AYALA");
    expect(p.nameCrossChecked).toBe(true);
  });

  it("parses amount with thousands separator to integer cents", () => {
    expect(parseRaw(SYNTH_RAW).amountCents).toBe(123456);
  });

  it("parses date, transaction number and memo", () => {
    const p = parseRaw(SYNTH_RAW);
    expect(p.sentOn).toBe("2026-07-23");
    expect(p.transactionNumber).toBe("30999888777");
    expect(p.memo).toBe("caso U26 000107 gracias");
  });

  it("takes the FIRST <title> (the template carries a second empty one)", () => {
    const p = parseRaw(SYNTH_RAW);
    expect(p.templateId).toBe("zelle_auto_accept_receiver");
    expect(p.templateKnown).toBe(true);
  });

  it("flags an unknown template id (fail-closed gate) but still parses", () => {
    const mutated = SYNTH_RAW.replace("zelle_auto_accept_receiver", "zelle_v3_2027_redesign");
    const p = parseRaw(mutated);
    expect(p.templateKnown).toBe(false);
    expect(p.amountCents).toBe(123456); // degradation: parse still worked
  });

  it("throws MISSING_FIELD when a label is renamed (→ manual review)", () => {
    const mutated = SYNTH_RAW.replace(/Transaction number/g, "Txn ID");
    expect(() => parseRaw(mutated)).toThrowError(ChaseParseError);
    try {
      parseRaw(mutated);
    } catch (e) {
      expect((e as ChaseParseError).code).toBe("MISSING_FIELD");
    }
  });

  it("throws BAD_AMOUNT on an empty amount", () => {
    const mutated = SYNTH_RAW.replace(">$1,234.56<", "><");
    expect(() => parseRaw(mutated)).toThrowError(ChaseParseError);
  });

  it('maps memo "N/A" to null', () => {
    const mutated = SYNTH_RAW.replace(">caso U26 000107 gracias<", ">N/A<");
    expect(parseRaw(mutated).memo).toBeNull();
  });
});

describe("verifyChaseAuthenticity (synthetic attacks)", () => {
  const good = () => authInputFromRaw(SYNTH_RAW);

  it("accepts the genuine Migadu stamp", () => {
    const v = verifyChaseAuthenticity(good());
    expect(v.ok).toBe(true);
    expect(v.dkim).toBe("pass");
  });

  it("rejects when no Migadu stamp exists", () => {
    const input = good();
    input.authenticationResults = [];
    expect(verifyChaseAuthenticity(input).ok).toBe(false);
  });

  it("rejects TWO Migadu stamps (header injection)", () => {
    const input = good();
    input.authenticationResults = [
      "mx13.migadu.com; dkim=pass header.d=chase.com; spf=pass smtp.mailfrom=no.reply.alerts@chase.com; dmarc=pass header.from=chase.com",
      SYNTH_AUTH_STAMP,
    ];
    const v = verifyChaseAuthenticity(input);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/injection/i);
  });

  it("ARC-Authentication-Results never substitutes the real stamp", () => {
    // The caller filters by header key; an input with only non-Migadu stamps fails.
    const input = good();
    input.authenticationResults = ["i=1; mx13.migadu.com; dkim=pass header.d=chase.com"];
    // authserv-id position check: "i=1;" prefix means the first segment is not
    // the Migadu authserv-id → not counted as a Migadu stamp.
    expect(verifyChaseAuthenticity(input).ok).toBe(false);
  });

  it("rejects dkim=fail", () => {
    const input = good();
    input.authenticationResults = [SYNTH_AUTH_STAMP.replace("dkim=pass", "dkim=fail")];
    expect(verifyChaseAuthenticity(input).ok).toBe(false);
  });

  it("rejects a lookalike signing domain", () => {
    const input = good();
    input.authenticationResults = [
      SYNTH_AUTH_STAMP.replace("header.d=chase.com", "header.d=chase.com.evil.tld"),
    ];
    expect(verifyChaseAuthenticity(input).ok).toBe(false);
  });

  it("rejects an unexpected From address", () => {
    const input = good();
    input.fromAddress = "alerts@chase-secure.com";
    expect(verifyChaseAuthenticity(input).ok).toBe(false);
  });

  it("accepts rotating envelope suffixes (.01@, .10@…)", () => {
    const input = good();
    input.authenticationResults = [
      SYNTH_AUTH_STAMP.replace("no.reply.alerts.01@chase.com", "no.reply.alerts.10@chase.com"),
    ];
    expect(verifyChaseAuthenticity(input).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real-fixture regression (local only — .eml files are gitignored PII)
// ---------------------------------------------------------------------------

const FIXTURES = join(__dirname, "fixtures");
const hasFixtures = existsSync(join(FIXTURES, "chase-p2p-svc.eml"));
const readFixture = (f: string) => readFileSync(join(FIXTURES, f), "latin1");

describe.skipIf(!hasFixtures)("real Chase fixtures (regression)", () => {
  it("chase-digital-svc.eml: MARIA MARTINEZ LOPEZ $600, memo N/A", () => {
    const p = parseRaw(readFixture("chase-digital-svc.eml"));
    expect(p.senderName).toBe("MARIA MARTINEZ LOPEZ");
    expect(p.amountCents).toBe(60000);
    expect(p.sentOn).toBe("2026-07-22");
    expect(p.transactionNumber).toBe("30107053254");
    expect(p.memo).toBeNull();
    expect(p.templateId).toBe("zelle_auto_accept_receiver");
    expect(p.templateKnown).toBe(true);
    expect(p.nameCrossChecked).toBe(true);
  });

  it("chase-digital-svc-2.eml: CRISTAL BONILLA CASANOVA $350 (QP-split surname)", () => {
    const p = parseRaw(readFixture("chase-digital-svc-2.eml"));
    expect(p.senderName).toBe("CRISTAL BONILLA CASANOVA");
    expect(p.amountCents).toBe(35000);
    expect(p.transactionNumber).toBe("30090803983");
    expect(p.memo).toBeNull();
    expect(p.templateKnown).toBe(true);
  });

  it("chase-p2p-svc.eml: ELIANA M VILLA $500, memo 'apelacion'", () => {
    const p = parseRaw(readFixture("chase-p2p-svc.eml"));
    expect(p.senderName).toBe("ELIANA M VILLA");
    expect(p.amountCents).toBe(50000);
    expect(p.sentOn).toBe("2026-07-20");
    expect(p.transactionNumber).toBe("30081042929");
    expect(p.memo).toBe("apelacion");
    expect(p.templateKnown).toBe(true);
    expect(p.nameCrossChecked).toBe(true);
  });

  it("every real fixture passes authenticity via the single Migadu stamp", () => {
    for (const f of ["chase-digital-svc.eml", "chase-digital-svc-2.eml", "chase-p2p-svc.eml"]) {
      const v = verifyChaseAuthenticity(authInputFromRaw(readFixture(f)));
      expect(v.ok, `${f}: ${v.reasons.join(" | ")}`).toBe(true);
    }
  });

  it("both live template ids are in the known set", () => {
    expect(KNOWN_TEMPLATE_IDS).toContain("zelle_auto_accept_receiver");
    expect(KNOWN_TEMPLATE_IDS).toContain("zelle_auto_accept_receiver_chase_email");
  });
});

// ---------------------------------------------------------------------------
// Ref codes
// ---------------------------------------------------------------------------

describe("extractRefCode", () => {
  it.each([
    ["U26-000107", "U26-000107"],
    ["U26 000107", "U26-000107"],
    ["u26000107", "U26-000107"],
    ["U 26 - 000107", "U26-000107"],
    ["pago caso U26-000107 gracias", "U26-000107"],
  ])("accepts %s → %s", (input, expected) => {
    const r = extractRefCode(input);
    expect(r.canonical).toBe(expected);
    expect(r.ambiguous).toBe(false);
  });

  it.each([
    ["caso 107"],
    ["000107"],
    ["U26-107"], // no guessed zero-padding
    ["U2G-000107"],
    ["X26-000107"],
    ["U26-0001071"], // trailing extra digit
  ])("does NOT match %s", (input) => {
    expect(extractRefCode(input).canonical).toBeNull();
  });

  it("repeated occurrences of the SAME code are fine", () => {
    const r = extractRefCode("U26-000107 repito U26 000107");
    expect(r.canonical).toBe("U26-000107");
    expect(r.ambiguous).toBe(false);
  });

  it("two DISTINCT codes → ambiguous, no canonical", () => {
    const r = extractRefCode("U26-000107 y U26-000200");
    expect(r.canonical).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.all).toEqual(["U26-000107", "U26-000200"]);
  });

  it("null/empty input", () => {
    expect(extractRefCode(null).canonical).toBeNull();
    expect(extractRefCode("").ambiguous).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

describe("name normalization + similarity", () => {
  it("drops single-letter tokens and sorts", () => {
    expect(normalizePayerName("ELIANA M VILLA")).toBe("ELIANA VILLA");
    expect(normalizePayerName("Villa, Eliana")).toBe(normalizePayerName("Eliana Villa"));
  });

  it("strips accents and ñ", () => {
    expect(normalizePayerName("José Muñoz")).toBe(normalizePayerName("JOSE MUNOZ"));
  });

  it("distinct names do not collide", () => {
    expect(normalizePayerName("MARIA MARTINEZ LOPEZ")).not.toBe(
      normalizePayerName("MARIA MARTINEZ"),
    );
  });

  it("jaccard: partial vs exact vs unrelated", () => {
    expect(nameJaccard("ELIANA M VILLA", "Eliana Marisol Villa Quispe")).toBeCloseTo(0.5);
    expect(nameJaccard("CRISTAL BONILLA CASANOVA", "Cristal Bonilla Casanova")).toBe(1);
    expect(nameJaccard("GUILLERMO VILLAFUERTE", "Rosa Villafuerte Ayala")).toBeCloseTo(0.25);
  });

  it("containment rescues bank-truncated names (≥2 shared tokens required by callers)", () => {
    expect(nameContainment("LUCIA PAREDES", "Lucia Fernanda Paredes Solis de Ramirez")).toBe(1);
    expect(nameSharedTokens("LUCIA PAREDES", "Lucia Fernanda Paredes Solis de Ramirez")).toBe(2);
    // A lone first name has perfect containment but only 1 shared token —
    // which is why the identity gate demands ≥2.
    expect(nameContainment("MARIA", "Maria Martinez Lopez")).toBe(1);
    expect(nameSharedTokens("MARIA", "Maria Martinez Lopez")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Scoring + decision
// ---------------------------------------------------------------------------

const CFG_ON: ReconConfig = { ...DEFAULT_RECON_CONFIG, enabled: true };
const NO_STATS: DailyAutoStats = { totalCents: 0, count: 0, byPayer: {} };

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    caseId: "case-1",
    caseNumber: "U26-000107",
    serviceSlug: "apelacion",
    installmentId: "inst-1",
    installmentNumber: 3,
    isDownpayment: false,
    amountCents: 50000,
    dueDate: "2026-07-25",
    status: "pending",
    clientUserId: "client-1",
    clientFullName: "Eliana Marisol Villa Quispe",
    hasPendingStripe: false,
    pendingZellePaymentId: null,
    caseBalanceCents: 150000,
    ...over,
  };
}

function facts(over: Partial<NotificationFacts> = {}): NotificationFacts {
  return {
    senderName: "ELIANA M VILLA",
    normalizedSender: normalizePayerName("ELIANA M VILLA"),
    amountCents: 50000,
    sentOn: "2026-07-20",
    memo: null,
    refCode: null,
    refAmbiguous: false,
    authOk: true,
    templateKnown: true,
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("amount alone NEVER identifies: capped at 40 without identity", () => {
    const n = facts({ senderName: "PEDRO DESCONOCIDO SILVA", normalizedSender: normalizePayerName("PEDRO DESCONOCIDO SILVA") });
    const c = candidate({ caseBalanceCents: 50000 }); // exact balance AND exact cuota
    const { score, signals } = scoreCandidate(n, c, [], 0);
    expect(signals.has_identity).toBe(false);
    expect(score).toBeLessThanOrEqual(40);
    expect(signals.raw_total).toBeGreaterThan(40); // balance 30 + cuota 20 + recency
  });

  it("name match unlocks the full score", () => {
    const { score, signals } = scoreCandidate(facts(), candidate(), [], 0);
    expect(signals.has_identity).toBe(true);
    expect(signals.name).toBe(25); // jaccard 0.5
    expect(signals.installment).toBe(20);
    expect(score).toBeGreaterThanOrEqual(45);
  });

  it("confirmed alias is the strongest signal (60)", () => {
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("GUILLERMO VILLAFUERTE"),
        clientUserId: "client-1",
        relationship: "family",
        confirmationsCount: 3,
        revoked: false,
      },
    ];
    const n = facts({
      senderName: "GUILLERMO VILLAFUERTE",
      normalizedSender: normalizePayerName("GUILLERMO VILLAFUERTE"),
    });
    const { signals } = scoreCandidate(n, candidate(), aliases, 1);
    expect(signals.alias).toBe(60);
  });

  it("identity conflict drops alias 60→25 (stops deciding)", () => {
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("GUILLERMO VILLAFUERTE"),
        clientUserId: "client-1",
        relationship: "family",
        confirmationsCount: 3,
        revoked: false,
      },
    ];
    const n = facts({
      senderName: "GUILLERMO VILLAFUERTE",
      normalizedSender: normalizePayerName("GUILLERMO VILLAFUERTE"),
    });
    const { signals } = scoreCandidate(n, candidate(), aliases, 2);
    expect(signals.alias).toBe(25);
  });

  it("revoked aliases are ignored", () => {
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("ELIANA M VILLA"),
        clientUserId: "client-1",
        relationship: "self",
        confirmationsCount: 1,
        revoked: true,
      },
    ];
    const { signals } = scoreCandidate(facts(), candidate(), aliases, 0);
    expect(signals.alias).toBe(0);
  });
});

describe("decideMatch — tier A (deterministic ref code)", () => {
  const ref = { status: "resolved", refCode: "U26-000107", caseId: "case-1" } as const;

  it("auto-approves: one valid ref → one exact-amount payable installment", () => {
    const d = decideMatch(facts({ refCode: "U26-000107" }), ref, [candidate()], [], CFG_ON, NO_STATS);
    expect(d.action).toBe("auto_approve");
    if (d.action === "auto_approve") {
      expect(d.tier).toBe("A");
      expect(d.candidate.installmentId).toBe("inst-1");
      expect(d.signals.ref_exact).toBe(true);
    }
  });

  it("amount mismatch → review, never partial settlement", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107", amountCents: 45000 }),
      ref,
      [candidate()],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "amount_mismatch" });
  });

  it("two exact-amount installments on the case → review (multi_installment)", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107" }),
      ref,
      [candidate(), candidate({ installmentId: "inst-2", installmentNumber: 4 })],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "multi_installment" });
  });

  it("case with nothing payable → review (case_no_payable)", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107" }),
      ref,
      [candidate({ caseId: "other-case" })],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "case_no_payable" });
  });

  it("unknown reference → review, NEVER heuristic fallback", () => {
    const d = decideMatch(
      facts({ refCode: "U26-999999" }),
      { status: "unknown", refCode: "U26-999999" },
      [candidate()], // a perfect heuristic candidate exists…
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "unknown_reference" });
  });

  it("ambiguous refs (two distinct codes) → review", () => {
    const d = decideMatch(
      facts({ refAmbiguous: true }),
      { status: "ambiguous" },
      [candidate()],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "ambiguous_ref" });
  });

  it("pending Stripe checkout blocks auto (stripe_pending)", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107" }),
      ref,
      [candidate({ hasPendingStripe: true })],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "stripe_pending" });
  });

  it("client-uploaded proof pending → link, don't duplicate (client_proof_pending)", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107" }),
      ref,
      [candidate({ pendingZellePaymentId: "pay-9" })],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "client_proof_pending" });
  });

  it("sibling-typo guard: payer's confirmed history points at ANOTHER client", () => {
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("ELIANA M VILLA"),
        clientUserId: "client-OTHER",
        relationship: "family",
        confirmationsCount: 2,
        revoked: false,
      },
    ];
    const d = decideMatch(facts({ refCode: "U26-000107" }), ref, [candidate()], aliases, CFG_ON, NO_STATS);
    expect(d).toMatchObject({ action: "review", reason: "identity_conflict" });
  });

  it("ref + alias for the SAME client still auto-approves", () => {
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("ELIANA M VILLA"),
        clientUserId: "client-1",
        relationship: "self",
        confirmationsCount: 2,
        revoked: false,
      },
    ];
    const d = decideMatch(facts({ refCode: "U26-000107" }), ref, [candidate()], aliases, CFG_ON, NO_STATS);
    expect(d.action).toBe("auto_approve");
  });
});

describe("decideMatch — circuit breakers", () => {
  const ref = { status: "resolved", refCode: "U26-000107", caseId: "case-1" } as const;
  const goodFacts = () => facts({ refCode: "U26-000107" });

  it("kill switch off → review (breaker_disabled)", () => {
    const d = decideMatch(goodFacts(), ref, [candidate()], [], DEFAULT_RECON_CONFIG, NO_STATS);
    expect(d).toMatchObject({ action: "review", reason: "breaker_disabled" });
  });

  it("amount over the $500 cap → review (over_amount_cap)", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107", amountCents: 60000 }),
      ref,
      [candidate({ amountCents: 60000 })],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "over_amount_cap" });
  });

  it("daily count cap reached → review", () => {
    const stats: DailyAutoStats = { totalCents: 0, count: 5, byPayer: {} };
    const d = decideMatch(goodFacts(), ref, [candidate()], [], CFG_ON, stats);
    expect(d).toMatchObject({ action: "review", reason: "daily_count_cap" });
  });

  it("daily amount cap would be exceeded → review", () => {
    const stats: DailyAutoStats = { totalCents: 240000, count: 2, byPayer: {} };
    const d = decideMatch(goodFacts(), ref, [candidate()], [], CFG_ON, stats);
    expect(d).toMatchObject({ action: "review", reason: "daily_amount_cap" });
  });

  it("same payer over their rolling cap → review", () => {
    const stats: DailyAutoStats = {
      totalCents: 0,
      count: 0,
      byPayer: { [normalizePayerName("ELIANA M VILLA")]: 2 },
    };
    const d = decideMatch(goodFacts(), ref, [candidate()], [], CFG_ON, stats);
    expect(d).toMatchObject({ action: "review", reason: "payer_daily_cap" });
  });

  it("unknown template NEVER auto-approves, even with a perfect ref", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107", templateKnown: false }),
      ref,
      [candidate()],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "template_changed" });
  });

  it("failed authenticity NEVER auto-approves", () => {
    const d = decideMatch(
      facts({ refCode: "U26-000107", authOk: false }),
      ref,
      [candidate()],
      [],
      CFG_ON,
      NO_STATS,
    );
    expect(d).toMatchObject({ action: "review", reason: "auth_failed" });
  });
});

describe("decideMatch — tier B (no ref code)", () => {
  it("launch mode (review_only): a 95-point candidate still goes to review", () => {
    const d = decideMatch(facts(), { status: "none" }, [candidate()], [], CFG_ON, NO_STATS);
    expect(d.action).toBe("review");
    if (d.action === "review") {
      expect(d.tier).toBe("B");
      expect(d.candidates.length).toBeGreaterThan(0);
      expect(d.candidates[0].score).toBeGreaterThan(0);
    }
  });

  it("no identifiable client → unmatched with NO suggested candidate", () => {
    const n = facts({
      senderName: "PEDRO DESCONOCIDO SILVA",
      normalizedSender: normalizePayerName("PEDRO DESCONOCIDO SILVA"),
      amountCents: 999999,
    });
    const d = decideMatch(n, { status: "none" }, [candidate()], [], CFG_ON, NO_STATS);
    expect(d).toMatchObject({ action: "unmatched" });
  });

  it("tierBMode=auto: high score + margin + exact amount auto-approves as tier B", () => {
    const cfg: ReconConfig = { ...CFG_ON, tierBMode: "auto" };
    const aliases: PayerAlias[] = [
      {
        normalizedName: normalizePayerName("ELIANA M VILLA"),
        clientUserId: "client-1",
        relationship: "self",
        confirmationsCount: 3,
        revoked: false,
      },
    ];
    // alias 60 + name 25 + cuota 20 + recency 10 = 115, second candidate far away
    const d = decideMatch(facts(), { status: "none" }, [candidate()], aliases, cfg, NO_STATS);
    expect(d.action).toBe("auto_approve");
    if (d.action === "auto_approve") expect(d.tier).toBe("B");
  });

  it("tierBMode=auto: identity-conflict fanout blocks tier-B auto", () => {
    const cfg: ReconConfig = { ...CFG_ON, tierBMode: "auto" };
    const guillermo = normalizePayerName("GUILLERMO VILLAFUERTE");
    const aliases: PayerAlias[] = [
      { normalizedName: guillermo, clientUserId: "client-1", relationship: "family", confirmationsCount: 3, revoked: false },
      { normalizedName: guillermo, clientUserId: "client-2", relationship: "self", confirmationsCount: 1, revoked: false },
    ];
    const n = facts({ senderName: "GUILLERMO VILLAFUERTE", normalizedSender: guillermo });
    const candidates = [
      candidate(),
      candidate({ caseId: "case-2", installmentId: "inst-2", clientUserId: "client-2", clientFullName: "Guillermo Villafuerte Mendoza" }),
    ];
    const d = decideMatch(n, { status: "none" }, candidates, aliases, cfg, NO_STATS);
    expect(d.action).toBe("review"); // tie/conflict → never guess
  });
});
