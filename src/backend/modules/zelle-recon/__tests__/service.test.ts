/**
 * zelle-recon service — wiring tests with mocked repository/platform.
 *
 * Covers: tier-A auto-settlement path (lifecycle + proof upload + billing
 * call), degradation when the RPC refuses, tier-B review path, ingest dedupe
 * by message_id, and the Chase-resend mismatch flag.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRepo = vi.hoisted(() => ({
  findReconOrgId: vi.fn(),
  listAdminUserIds: vi.fn().mockResolvedValue([]),
  getIngestState: vi.fn(),
  claimIngestLease: vi.fn(),
  releaseIngestLease: vi.fn().mockResolvedValue(undefined),
  insertInboundEmail: vi.fn(),
  updateInboundEmailParse: vi.fn().mockResolvedValue(undefined),
  findInboundEmailById: vi.fn(),
  findNotificationByTransactionNumber: vi.fn(),
  findNotificationById: vi.fn(),
  insertNotification: vi.fn(),
  updateNotificationLifecycle: vi.fn().mockResolvedValue(undefined),
  insertMatches: vi.fn(),
  listMatchesForNotification: vi.fn(),
  findMatchById: vi.fn(),
  updateMatch: vi.fn(),
  rejectOtherSuggestedMatches: vi.fn().mockResolvedValue(undefined),
  listReviewNotifications: vi.fn().mockResolvedValue([]),
  listSuggestedMatchesForNotifications: vi.fn().mockResolvedValue([]),
  listAutoAppliedMatches: vi.fn().mockResolvedValue([]),
  getCaseHeaders: vi.fn().mockResolvedValue(new Map()),
  getInstallmentHeaders: vi.fn().mockResolvedValue(new Map()),
  findPendingZellePaymentId: vi.fn().mockResolvedValue(null),
  listAliasesByName: vi.fn().mockResolvedValue([]),
  upsertPayerIdentity: vi.fn(),
  getDailyAutoStats: vi.fn().mockResolvedValue({ totalCents: 0, count: 0, byPayer: {} }),
  findCaseIdByCaseNumber: vi.fn(),
  listMatchCandidates: vi.fn().mockResolvedValue([]),
  readOrgSettingsRaw: vi.fn().mockResolvedValue({}),
  writeReconSettings: vi.fn(),
}));

const mockSweep = vi.hoisted(() => vi.fn());
const mockUpload = vi.hoisted(() => vi.fn().mockResolvedValue("ok"));
const mockHtmlToPdf = vi.hoisted(() => vi.fn().mockResolvedValue(new Uint8Array([1])));
const mockEnqueue = vi.hoisted(() => vi.fn().mockResolvedValue({ messageId: "m1" }));
const mockApplyBank = vi.hoisted(() => vi.fn());
const mockAppEvents = vi.hoisted(() => {
  const emit = vi.fn().mockResolvedValue(undefined);
  return { emit, emitAndWait: emit, on: vi.fn() };
});
const mockInsertNotifIdem = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../repository.js", () => mockRepo);

vi.mock("@/backend/platform/imap", () => ({
  sweepZelleMailbox: mockSweep,
  RECONCILED_FLAG: "$Reconciled",
}));

vi.mock("@/backend/platform/storage", () => ({ uploadBytesToStorage: mockUpload }));
vi.mock("@/backend/platform/pdf", () => ({ htmlToPdf: mockHtmlToPdf }));
vi.mock("@/backend/platform/qstash", () => ({ enqueueJob: mockEnqueue }));
vi.mock("@/backend/platform/events", () => ({ appEvents: mockAppEvents }));
vi.mock("@/backend/platform/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  type: {},
}));
vi.mock("@/backend/modules/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/backend/modules/billing", () => ({
  applyBankVerifiedZellePayment: mockApplyBank,
}));
vi.mock("@/backend/modules/notifications", () => ({
  insertNotificationIdempotent: mockInsertNotifIdem,
}));
vi.mock("@/backend/modules/org", () => {
  const { z } = require("zod");
  const ZelleReconciliationSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    tier_a_max_amount_cents: z.number().int().positive().default(50_000),
    daily_auto_max_cents: z.number().int().positive().default(250_000),
    daily_auto_max_count: z.number().int().positive().default(5),
    per_payer_daily_max: z.number().int().positive().default(2),
    tier_b_mode: z.enum(["review_only", "auto"]).default("review_only"),
  });
  return { ZelleReconciliationSettingsSchema };
});

import { matchZelleNotification, runZelleIngestSweep } from "../service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = "11111111-1111-4111-8111-111111111111";
const NOTIF = "22222222-2222-4222-8222-222222222222";
const EMAIL_ID = "33333333-3333-4333-8333-333333333333";
const CASE_ID = "44444444-4444-4444-8444-444444444444";
const INST = "55555555-5555-4555-8555-555555555555";
const CLIENT = "66666666-6666-4666-8666-666666666666";
const MATCH = "77777777-7777-4777-8777-777777777777";

const notification = {
  id: NOTIF,
  org_id: ORG,
  email_id: EMAIL_ID,
  transaction_number: "30107053254",
  sender_name: "ELIANA M VILLA",
  normalized_sender: "ELIANA VILLA",
  amount_cents: 50000,
  sent_on: "2026-07-20",
  memo: "U26-000107",
  ref_code: "U26-000107",
  ref_ambiguous: false,
  name_cross_checked: true,
  lifecycle_status: "received",
  review_reason: null,
  applied_payment_id: null,
};

const emailRow = {
  id: EMAIL_ID,
  auth_ok: true,
  template_id: "zelle_auto_accept_receiver",
  dkim: "pass",
  spf: "pass",
  dmarc: "pass",
};

const candidate = {
  caseId: CASE_ID,
  caseNumber: "U26-000107",
  serviceSlug: "apelacion",
  installmentId: INST,
  installmentNumber: 3,
  isDownpayment: false,
  amountCents: 50000,
  dueDate: "2026-07-25",
  status: "pending" as const,
  clientUserId: CLIENT,
  clientFullName: "Eliana Marisol Villa Quispe",
  hasPendingStripe: false,
  pendingZellePaymentId: null,
  caseBalanceCents: 150000,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.listAdminUserIds.mockResolvedValue([]);
  mockRepo.getDailyAutoStats.mockResolvedValue({ totalCents: 0, count: 0, byPayer: {} });
  mockRepo.listAliasesByName.mockResolvedValue([]);
  mockRepo.readOrgSettingsRaw.mockResolvedValue({ zelle_reconciliation: { enabled: true } });
  mockRepo.findNotificationById.mockResolvedValue(notification);
  mockRepo.findInboundEmailById.mockResolvedValue(emailRow);
  mockRepo.findCaseIdByCaseNumber.mockResolvedValue(CASE_ID);
  mockRepo.listMatchCandidates.mockResolvedValue([candidate]);
  mockRepo.insertMatches.mockResolvedValue([{ id: MATCH }]);
  mockHtmlToPdf.mockResolvedValue(new Uint8Array([1]));
});

describe("matchZelleNotification — tier A auto-settlement", () => {
  it("uploads the proof PDF and settles via billing (atomic RPC path)", async () => {
    mockApplyBank.mockResolvedValue({ applied: true, paymentId: "pay-1" });

    await matchZelleNotification(NOTIF);

    // lifecycle applying BEFORE settlement
    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "applying",
    });
    // derivative proof to the bucket the existing viewer reads
    expect(mockUpload).toHaveBeenCalledWith(
      "payment-proofs",
      `zelle-auto/${INST}/30107053254.pdf`,
      expect.any(Uint8Array),
      "application/pdf",
    );
    expect(mockApplyBank).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: NOTIF,
        matchId: MATCH,
        installmentId: INST,
        amountCents: 50000,
        orgId: ORG,
        payerUserId: null,
      }),
    );
    // no review degradation, no inbox event
    expect(mockAppEvents.emitAndWait).not.toHaveBeenCalled();
  });

  it("degrades to review with the RPC's reason when settlement is refused", async () => {
    mockApplyBank.mockResolvedValue({ applied: false, reason: "STRIPE_PENDING" });

    await matchZelleNotification(NOTIF);

    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "review",
      review_reason: "STRIPE_PENDING",
    });
    const event = mockAppEvents.emitAndWait.mock.calls[0][0];
    expect(event.type).toBe("zelle.match_suggested");
    expect(event.payload.reason).toBe("STRIPE_PENDING");
  });

  it("skips terminal/in-flight notifications (idempotent job retry)", async () => {
    mockRepo.findNotificationById.mockResolvedValue({
      ...notification,
      lifecycle_status: "applied",
    });
    await matchZelleNotification(NOTIF);
    expect(mockApplyBank).not.toHaveBeenCalled();
    expect(mockRepo.updateNotificationLifecycle).not.toHaveBeenCalled();
  });

  it("crash BEFORE settlement reverts to review (auto_settlement_error) and rethrows", async () => {
    mockUpload.mockRejectedValueOnce(new Error("storage down"));
    mockRepo.findNotificationById
      .mockResolvedValueOnce(notification) // entry read
      .mockResolvedValueOnce({ ...notification, lifecycle_status: "applying" }); // post-crash re-read

    await expect(matchZelleNotification(NOTIF)).rejects.toThrow("storage down");

    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "review",
      review_reason: "auto_settlement_error",
    });
    const event = mockAppEvents.emitAndWait.mock.calls[0][0];
    expect(event.payload.reason).toBe("auto_settlement_error");
  });

  it("crash AFTER the RPC committed never reverts an applied notification", async () => {
    mockApplyBank.mockRejectedValueOnce(new Error("events tail failed"));
    mockRepo.findNotificationById
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce({ ...notification, lifecycle_status: "applied" });

    await expect(matchZelleNotification(NOTIF)).rejects.toThrow("events tail failed");

    const reverts = mockRepo.updateNotificationLifecycle.mock.calls.filter(
      (c) => c[1]?.lifecycle_status === "review",
    );
    expect(reverts).toHaveLength(0);
  });
});

describe("matchZelleNotification — review paths", () => {
  it("no ref code → tier B suggestions persisted + finance event", async () => {
    mockRepo.findNotificationById.mockResolvedValue({
      ...notification,
      memo: null,
      ref_code: null,
    });

    await matchZelleNotification(NOTIF);

    expect(mockApplyBank).not.toHaveBeenCalled();
    expect(mockRepo.insertMatches).toHaveBeenCalledTimes(1);
    const rows = mockRepo.insertMatches.mock.calls[0][0];
    expect(rows[0]).toMatchObject({ tier: "B", status: "suggested", review_reason: "tier_b" });
    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "review",
      review_reason: "tier_b",
    });
    expect(mockAppEvents.emitAndWait).toHaveBeenCalledTimes(1);
  });

  it("unknown sender + unmatchable amount → unmatched, NO candidate rows", async () => {
    mockRepo.findNotificationById.mockResolvedValue({
      ...notification,
      memo: null,
      ref_code: null,
      sender_name: "PEDRO DESCONOCIDO SILVA",
      normalized_sender: "DESCONOCIDO PEDRO SILVA",
      amount_cents: 999999,
    });

    await matchZelleNotification(NOTIF);

    expect(mockRepo.insertMatches).not.toHaveBeenCalled();
    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "review",
      review_reason: "no_identifiable_client",
    });
  });
});

// ---------------------------------------------------------------------------
// Ingest sweep (mailparser is real; IMAP + repo are mocked)
// ---------------------------------------------------------------------------

const SYNTH_AUTH =
  "mx13.migadu.com; dkim=pass header.d=chase.com header.s=d4815; " +
  "spf=pass smtp.mailfrom=no.reply.alerts.01@chase.com; dmarc=pass (policy=reject) header.from=chase.com";

function synthRawEmail(txn: string): Buffer {
  const body = [
    "<html><head><title>zelle_auto_accept_receiver</title></head><body>",
    "<h1>MARIA MARTINEZ LOPEZ sent you money</h1>",
    "<p>Here are the details:</p>",
    "<table><tbody>",
    "<tr><td>Amount</td><td><b>$600.00</b></td></tr>",
    "<tr><td>Sent on</td><td><b>Jul 22, 2026</b></td></tr>",
    `<tr><td>Transaction number</td><td><b>${txn}</b></td></tr>`,
    "<tr><td>Memo</td><td><b>N/A</b></td></tr>",
    "</tbody></table>",
    "<p>MARIA MARTINEZ LOPEZ is registered with a Zelle member bank.</p>",
    "</body></html>",
  ].join("\r\n");
  return Buffer.from(
    [
      `Authentication-Results: ${SYNTH_AUTH}`,
      "From: Chase <no.reply.alerts@chase.com>",
      "To: henryorellana@usalatinoprime.com",
      `Message-ID: <synth-${txn}@chase.test>`,
      "Subject: You received money with Zelle(R)",
      "Content-Type: text/html; charset=UTF-8",
      "",
      body,
    ].join("\r\n"),
    "utf8",
  );
}

describe("runZelleIngestSweep", () => {
  beforeEach(() => {
    mockRepo.findReconOrgId.mockResolvedValue(ORG);
    mockRepo.claimIngestLease.mockResolvedValue(true);
    mockRepo.getIngestState.mockResolvedValue({ org_id: ORG, last_uid: 0, uidvalidity: null });
    mockSweep.mockImplementation(async (_opts, handle) => {
      await handle({ uid: 7, uidvalidity: 99, source: synthRawEmail("30107053254"), internalDate: null });
      return { uidvalidity: BigInt(99), newLastUid: 7, fetched: 1, processed: 1, failed: 0 };
    });
    mockRepo.insertInboundEmail.mockResolvedValue({
      inserted: true,
      row: { id: EMAIL_ID, org_id: ORG },
    });
    mockRepo.findNotificationByTransactionNumber.mockResolvedValue(null);
    mockRepo.insertNotification.mockResolvedValue({ inserted: true, row: { id: NOTIF } });
  });

  it("stores evidence, creates the notification and fans out the match job", async () => {
    const result = await runZelleIngestSweep();

    expect(result.swept).toBe(true);
    // .eml uploaded to the evidence bucket
    expect(mockUpload).toHaveBeenCalledWith(
      "zelle-inbound",
      expect.stringMatching(/^raw\//),
      expect.any(Uint8Array),
      "message/rfc822",
    );
    const emailInsert = mockRepo.insertInboundEmail.mock.calls[0][0];
    expect(emailInsert.auth_ok).toBe(true);
    expect(emailInsert.parse_status).toBe("parsed");
    expect(emailInsert.template_id).toBe("zelle_auto_accept_receiver");

    const notifInsert = mockRepo.insertNotification.mock.calls[0][0];
    expect(notifInsert.transaction_number).toBe("30107053254");
    expect(notifInsert.amount_cents).toBe(60000);
    expect(notifInsert.normalized_sender).toBe("LOPEZ MARIA MARTINEZ");

    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        jobKey: "match-zelle-notification",
        entityId: NOTIF,
        dedupeId: "match-zelle:30107053254",
      }),
    );
    expect(mockRepo.releaseIngestLease).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ success: true, lastUid: 7, uidvalidity: 99 }),
    );
  });

  it("duplicate Message-ID → evidence dedupe, no notification, no job", async () => {
    mockRepo.insertInboundEmail.mockResolvedValue({ inserted: false, row: null });

    await runZelleIngestSweep();

    expect(mockRepo.insertNotification).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("Chase resend with DIFFERENT amount → flags resend_mismatch on the existing notification", async () => {
    mockRepo.findNotificationByTransactionNumber.mockResolvedValue({
      ...notification,
      amount_cents: 12345, // disagrees with the email's $600.00
      lifecycle_status: "review",
    });

    await runZelleIngestSweep();

    expect(mockRepo.insertNotification).not.toHaveBeenCalled();
    expect(mockRepo.updateInboundEmailParse).toHaveBeenCalledWith(EMAIL_ID, {
      notification_id: NOTIF,
    });
    expect(mockRepo.updateNotificationLifecycle).toHaveBeenCalledWith(NOTIF, {
      lifecycle_status: "review",
      review_reason: "resend_mismatch",
    });
  });

  it("lease busy → sweep skipped without touching IMAP", async () => {
    mockRepo.claimIngestLease.mockResolvedValue(false);

    const result = await runZelleIngestSweep();

    expect(result.swept).toBe(false);
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("IMAP failure → lease released with the error, then rethrown", async () => {
    mockSweep.mockRejectedValue(new Error("socket timeout"));

    await expect(runZelleIngestSweep()).rejects.toThrow("socket timeout");
    expect(mockRepo.releaseIngestLease).toHaveBeenCalledWith(
      ORG,
      expect.objectContaining({ success: false, error: "socket timeout" }),
    );
  });
});
