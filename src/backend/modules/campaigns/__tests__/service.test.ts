/**
 * Campaigns service — unit tests.
 *
 * Covers: create/update (NOT_EDITABLE), schedule (SCHEDULE_IN_PAST + enqueue),
 * sendCampaignNow (materialize→sending→enqueue, AUDIENCE_EMPTY, ALREADY_SENDING),
 * cancelCampaign, previewAudience breakdown, cross-org guard, sendCampaignBatch
 * (cancellation + completion), applyResendEvent (bounce/complaint), unsubscribeByToken.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRepo = vi.hoisted(() => ({
  insertCampaign: vi.fn(),
  updateCampaign: vi.fn(),
  findCampaignById: vi.fn(),
  listCampaigns: vi.fn(),
  resolveAudience: vi.fn(),
  upsertRecipients: vi.fn().mockResolvedValue(undefined),
  suppressPendingRecipients: vi.fn().mockResolvedValue(undefined),
  claimScheduledForSending: vi.fn().mockResolvedValue(true),
  listPendingRecipientsForSend: vi.fn(),
  markRecipientsSent: vi.fn().mockResolvedValue(undefined),
  campaignMetrics: vi.fn(),
  findRecipientByEmail: vi.fn(),
  setRecipientStatus: vi.fn().mockResolvedValue(undefined),
  markUserBounced: vi.fn().mockResolvedValue(undefined),
  optOutClientMarketing: vi.fn().mockResolvedValue(undefined),
  findCampaignOrgId: vi.fn(),
  findUserIdByEmail: vi.fn(),
  findUserOrgByEmail: vi.fn(),
  listOrgClients: vi.fn(),
}));

const mockQstash = vi.hoisted(() => ({ enqueueJob: vi.fn().mockResolvedValue({ messageId: "m" }) }));
const mockAudit = vi.hoisted(() => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
const mockEvents = vi.hoisted(() => ({ appEvents: { emit: vi.fn() } }));
const mockResend = vi.hoisted(() => ({
  sendTransactional: vi.fn().mockResolvedValue({ id: "e" }),
  sendBatch: vi.fn().mockResolvedValue({ ids: ["e1"] }),
  FROM_CAMPAIGNS: "novedades@x",
}));
const mockEmails = vi.hoisted(() => ({
  renderCampaignEmail: vi.fn().mockResolvedValue({ html: "<html></html>", text: "t" }),
}));
const mockCrypto = vi.hoisted(() => ({
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://x/api/unsubscribe?c=1&u=2&t=abc"),
  verifyUnsubscribeToken: vi.fn(),
}));

vi.mock("../repository.js", () => mockRepo);
vi.mock("@/backend/platform/qstash", () => mockQstash);
vi.mock("@/backend/modules/audit", () => mockAudit);
vi.mock("@/backend/platform/events", () => mockEvents);
vi.mock("@/backend/platform/resend", () => mockResend);
vi.mock("@/backend/platform/emails", () => mockEmails);
vi.mock("@/backend/platform/crypto", () => mockCrypto);
vi.mock("@/backend/platform/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/backend/platform/authz", () => ({
  can: vi.fn(),
  AuthzError: class AuthzError extends Error {
    constructor(public readonly reason: string) {
      super(reason);
      this.name = "AuthzError";
    }
  },
}));

const mockSupabase = vi.hoisted(() => ({ createServiceClient: vi.fn() }));
vi.mock("@/backend/platform/supabase", () => mockSupabase);

function supabaseReturning(data: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const node = (): Record<string, unknown> => ({ eq: () => node(), select: () => node(), maybeSingle });
  return { from: vi.fn(() => node()) };
}

import {
  createCampaign,
  updateCampaign,
  scheduleCampaign,
  sendCampaignNow,
  cancelCampaign,
  previewAudience,
  sendCampaignBatch,
  applyResendEvent,
  unsubscribeByToken,
} from "../service";
import { AuthzError } from "@/backend/platform/authz";

const ORG = "org-1";
const ACTOR = { userId: "staff-1", orgId: ORG, role: "finance", kind: "staff", permissions: new Map() } as import("@/backend/platform/authz").Actor;

beforeEach(() => {
  vi.clearAllMocks();
  mockRepo.findCampaignOrgId.mockResolvedValue(ORG);
  mockSupabase.createServiceClient.mockReturnValue(supabaseReturning({ email: "staff@x.com", locale: "es" }));
});

describe("createCampaign", () => {
  it("creates a draft with org + created_by", async () => {
    mockRepo.insertCampaign.mockResolvedValue({ id: "c1" });
    const row = await createCampaign(ACTOR, { name: "N", subject: "S", bodyHtml: "<p>x</p>", audience: { kind: "all_clients" } });
    expect(row.id).toBe("c1");
    expect(mockRepo.insertCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: ORG, created_by: ACTOR.userId, status: "draft" }),
    );
  });
  it("sanitizes body HTML on write (strips script)", async () => {
    mockRepo.insertCampaign.mockResolvedValue({ id: "c1" });
    await createCampaign(ACTOR, {
      name: "N", subject: "S",
      bodyHtml: '<p>Hola</p><script>alert(1)</script><a href="javascript:alert(2)">x</a>',
      audience: { kind: "all_clients" },
    });
    const body = mockRepo.insertCampaign.mock.calls[0][0].body_html as string;
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("javascript:");
    expect(body).toContain("<p>Hola</p>");
  });
});

describe("updateCampaign", () => {
  it("edits a draft", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "draft" });
    mockRepo.updateCampaign.mockResolvedValue({ id: "c1" });
    await updateCampaign(ACTOR, "c1", { subject: "New" });
    expect(mockRepo.updateCampaign).toHaveBeenCalledWith("c1", expect.objectContaining({ subject: "New" }));
  });
  it("rejects editing a non-draft (NOT_EDITABLE)", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "sent" });
    await expect(updateCampaign(ACTOR, "c1", { subject: "x" })).rejects.toMatchObject({ code: "NOT_EDITABLE" });
  });
  it("blocks cross-org access", async () => {
    mockRepo.findCampaignOrgId.mockResolvedValue("other-org");
    await expect(updateCampaign(ACTOR, "c1", { subject: "x" })).rejects.toBeInstanceOf(AuthzError);
  });
});

describe("scheduleCampaign", () => {
  const CID = "11111111-1111-4111-8111-111111111111";
  it("rejects a past date", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: CID, org_id: ORG, status: "draft" });
    await expect(
      scheduleCampaign(ACTOR, { campaignId: CID, scheduledAt: "2000-01-01T00:00:00.000Z" }),
    ).rejects.toMatchObject({ code: "SCHEDULE_IN_PAST" });
  });
  it("schedules a future date and enqueues a delayed job", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: CID, org_id: ORG, status: "draft" });
    mockRepo.updateCampaign.mockResolvedValue({ id: CID, status: "scheduled" });
    const future = new Date(Date.now() + 86400_000).toISOString();
    await scheduleCampaign(ACTOR, { campaignId: CID, scheduledAt: future });
    expect(mockRepo.updateCampaign).toHaveBeenCalledWith(CID, expect.objectContaining({ status: "scheduled" }));
    expect(mockQstash.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: "send-campaign", dedupeId: `send-campaign:${CID}:batch-1` }),
      expect.objectContaining({ delay: expect.any(Number) }),
    );
  });
});

describe("sendCampaignNow", () => {
  beforeEach(() => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "draft", audience: { kind: "all_clients" } });
    mockRepo.updateCampaign.mockResolvedValue({ id: "c1", status: "sending" });
  });
  it("materializes, marks sending, enqueues batch-1", async () => {
    mockRepo.resolveAudience.mockResolvedValue([
      { userId: "u1", email: "u1@x.com", locale: "es", marketingOptIn: true, emailBouncedAt: null },
    ]);
    await sendCampaignNow(ACTOR, "c1");
    expect(mockRepo.upsertRecipients).toHaveBeenCalled();
    expect(mockRepo.updateCampaign).toHaveBeenCalledWith("c1", { status: "sending" });
    expect(mockQstash.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ jobKey: "send-campaign", dedupeId: "send-campaign:c1:batch-1", batch: 1 }),
    );
  });
  it("throws AUDIENCE_EMPTY when every candidate is suppressed", async () => {
    mockRepo.resolveAudience.mockResolvedValue([
      { userId: "u1", email: null, locale: "es", marketingOptIn: true, emailBouncedAt: null },
    ]);
    await expect(sendCampaignNow(ACTOR, "c1")).rejects.toMatchObject({ code: "AUDIENCE_EMPTY" });
    expect(mockQstash.enqueueJob).not.toHaveBeenCalled();
  });
  it("throws ALREADY_SENDING when already sending", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "sending" });
    await expect(sendCampaignNow(ACTOR, "c1")).rejects.toMatchObject({ code: "ALREADY_SENDING" });
  });
});

describe("cancelCampaign", () => {
  it("cancels a scheduled campaign", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "scheduled" });
    mockRepo.updateCampaign.mockResolvedValue({ id: "c1", status: "cancelled" });
    await cancelCampaign(ACTOR, "c1");
    expect(mockRepo.updateCampaign).toHaveBeenCalledWith("c1", { status: "cancelled" });
  });
  it("rejects cancelling a sent campaign", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "sent" });
    await expect(cancelCampaign(ACTOR, "c1")).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });
});

describe("previewAudience", () => {
  it("breaks down mailable vs suppressed", async () => {
    mockRepo.resolveAudience.mockResolvedValue([
      { userId: "u1", email: "a@x.com", locale: "es", marketingOptIn: true, emailBouncedAt: null }, // mailable
      { userId: "u2", email: null, locale: "es", marketingOptIn: true, emailBouncedAt: null }, // no_email
      { userId: "u3", email: "c@x.com", locale: "es", marketingOptIn: false, emailBouncedAt: null }, // opted_out
      { userId: "u4", email: "d@x.com", locale: "es", marketingOptIn: true, emailBouncedAt: "2026-01-01" }, // bounced
    ]);
    const res = await previewAudience(ACTOR, { audience: { kind: "all_clients" } });
    expect(res.total).toBe(4);
    expect(res.mailable).toBe(1);
    expect(res.suppressed).toEqual({ noEmail: 1, optedOut: 1, bounced: 1 });
  });
});

describe("sendCampaignBatch", () => {
  it("aborts when the campaign is cancelled (mid-send cancel)", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "cancelled" });
    const res = await sendCampaignBatch("c1");
    expect(res.status).toBe("aborted");
    expect(mockResend.sendBatch).not.toHaveBeenCalled();
  });
  it("scheduled fire: claims atomically before sending (loses claim → abort)", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "scheduled", audience: { kind: "all_clients" } });
    mockRepo.claimScheduledForSending.mockResolvedValue(false); // another worker won
    const res = await sendCampaignBatch("c1");
    expect(res.status).toBe("aborted");
    expect(mockResend.sendBatch).not.toHaveBeenCalled();
  });
  it("completes when no pending recipients remain", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "sending", subject: "S", body_html: "<p>x</p>" });
    mockRepo.listPendingRecipientsForSend.mockResolvedValue([]);
    mockRepo.campaignMetrics.mockResolvedValue({ total: 2, pending: 0, sent: 2, failed: 0, suppressed: 0, bounced: 0, complained: 0 });
    mockRepo.updateCampaign.mockResolvedValue({ id: "c1", status: "sent" });
    const res = await sendCampaignBatch("c1");
    expect(res.status).toBe("completed");
    expect(mockRepo.updateCampaign).toHaveBeenCalledWith("c1", { status: "sent", sent_count: 2 });
    expect(mockEvents.appEvents.emit).toHaveBeenCalledWith(expect.objectContaining({ type: "campaign.sent" }));
  });
  it("sends a batch and marks recipients sent", async () => {
    mockRepo.findCampaignById.mockResolvedValue({ id: "c1", org_id: ORG, status: "sending", subject: "S", body_html: "<p>x</p>" });
    mockRepo.listPendingRecipientsForSend.mockResolvedValue([
      { id: "r1", userId: "u1", email: "u1@x.com", locale: "es" },
    ]);
    const res = await sendCampaignBatch("c1");
    expect(mockResend.sendBatch).toHaveBeenCalled();
    expect(mockRepo.markRecipientsSent).toHaveBeenCalledWith(["r1"], expect.any(String));
    expect(res.hasMore).toBe(false);
  });
});

describe("applyResendEvent", () => {
  it("bounce → recipient bounced + user bounced", async () => {
    mockRepo.findRecipientByEmail.mockResolvedValue({ id: "r1", user_id: "u1" });
    await applyResendEvent({ type: "email.bounced", email: "u1@x.com", at: "2026-06-16T00:00:00Z" });
    expect(mockRepo.setRecipientStatus).toHaveBeenCalledWith("r1", "bounced", expect.any(String));
    expect(mockRepo.markUserBounced).toHaveBeenCalledWith("u1", expect.any(String));
  });
  it("complaint → recipient complained + opt-out", async () => {
    mockRepo.findRecipientByEmail.mockResolvedValue({ id: "r1", user_id: "u1" });
    await applyResendEvent({ type: "email.complained", email: "u1@x.com", at: "2026-06-16T00:00:00Z" });
    expect(mockRepo.setRecipientStatus).toHaveBeenCalledWith("r1", "complained", expect.any(String));
    expect(mockRepo.optOutClientMarketing).toHaveBeenCalledWith("u1");
  });
  it("falls back to user lookup by email when no recipient row exists", async () => {
    mockRepo.findRecipientByEmail.mockResolvedValue(null);
    mockRepo.findUserIdByEmail.mockResolvedValue("u9");
    await applyResendEvent({ type: "email.bounced", email: "tx@x.com", at: "2026-06-16T00:00:00Z" });
    expect(mockRepo.markUserBounced).toHaveBeenCalledWith("u9", expect.any(String));
  });
});

describe("unsubscribeByToken", () => {
  it("opts out on a valid token", async () => {
    mockCrypto.verifyUnsubscribeToken.mockReturnValue(true);
    const res = await unsubscribeByToken("c1", "u1", "tok");
    expect(res.ok).toBe(true);
    expect(mockRepo.optOutClientMarketing).toHaveBeenCalledWith("u1");
  });
  it("rejects an invalid token", async () => {
    mockCrypto.verifyUnsubscribeToken.mockReturnValue(false);
    const res = await unsubscribeByToken("c1", "u1", "bad");
    expect(res.ok).toBe(false);
    expect(mockRepo.optOutClientMarketing).not.toHaveBeenCalled();
  });
});
