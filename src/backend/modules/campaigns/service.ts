/**
 * Campaigns module — service layer (DOC-47 Part B §5, DOC-55 §4, DOC-73 §4).
 *
 * Order per use case: can() → requireCampaignOrg (cross-org guard, since the
 * service client bypasses RLS) → Zod → domain → repo → writeAudit → side-effects.
 *
 * @module campaigns/service
 */

import { z } from "zod";
import { can, AuthzError } from "@/backend/platform/authz";
import type { Actor } from "@/backend/platform/authz";
import { createServiceClient } from "@/backend/platform/supabase";
import { logger } from "@/backend/platform/logger";
import { writeAudit } from "@/backend/modules/audit";
import { sendTransactional, FROM_CAMPAIGNS } from "@/backend/platform/resend";
import { sendBatch } from "@/backend/platform/resend";
import { renderCampaignEmail } from "@/backend/platform/emails";
import { buildUnsubscribeUrl, verifyUnsubscribeToken } from "@/backend/platform/crypto";
import { sanitizeCampaignHtml } from "@/backend/platform/email-html";
import { appEvents } from "@/backend/platform/events";
import { enqueueJob } from "@/backend/platform/qstash";
import type { Json } from "@/shared/database.types";

import {
  canTransitionCampaign,
  isEditable,
  isCancellable,
  parseAudience,
  audienceToJson,
  suppressionReason,
  type AudienceSpec,
  type CampaignStatus,
} from "./domain";
import {
  insertCampaign,
  updateCampaign as repoUpdateCampaign,
  findCampaignById,
  listCampaigns as repoListCampaigns,
  resolveAudience,
  upsertRecipients,
  suppressPendingRecipients,
  claimScheduledForSending,
  listPendingRecipientsForSend,
  markRecipientsSent,
  campaignMetrics,
  findRecipientByEmail,
  setRecipientStatus,
  markUserBounced,
  optOutClientMarketing,
  findCampaignOrgId,
  findUserIdByEmail,
  findUserOrgByEmail,
  listOrgClients,
  type CampaignRow,
  type CampaignMetrics,
  type OrgClient,
} from "./repository";

const SEND_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class CampaignError extends Error {
  constructor(
    public readonly code:
      | "CAMPAIGN_NOT_FOUND"
      | "NOT_EDITABLE"
      | "INVALID_STATE_TRANSITION"
      | "AUDIENCE_INVALID"
      | "AUDIENCE_EMPTY"
      | "SCHEDULE_IN_PAST"
      | "TEST_EMAIL_INVALID"
      | "ALREADY_SENDING",
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "CampaignError";
  }
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const AudienceSchema: z.ZodType<AudienceSpec> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all_clients") }),
  z.object({ kind: z.literal("by_service"), serviceIds: z.array(z.string().uuid()).min(1) }),
  z.object({ kind: z.literal("custom"), userIds: z.array(z.string().uuid()).min(1) }),
]);

const CreateCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  bodyHtml: z.string().min(1),
  audience: AudienceSchema,
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

const UpdateCampaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  subject: z.string().min(1).max(200).optional(),
  bodyHtml: z.string().min(1).optional(),
  audience: AudienceSchema.optional(),
});
export type UpdateCampaignInput = z.infer<typeof UpdateCampaignSchema>;

const ScheduleSchema = z.object({
  campaignId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CampaignSummaryDto {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatus;
  audienceKind: AudienceSpec["kind"];
  scheduledAt: string | null;
  sentCount: number;
  createdAt: string;
}

export interface CampaignDetailDto extends CampaignSummaryDto {
  bodyHtml: string;
  audience: AudienceSpec;
  metrics: CampaignMetrics;
}

export interface AudiencePreviewDto {
  total: number;
  mailable: number;
  suppressed: { noEmail: number; optedOut: number; bounced: number };
  asOf: string;
}

function toSummaryDto(row: CampaignRow): CampaignSummaryDto {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    status: row.status as CampaignStatus,
    audienceKind: parseAudience(row.audience).kind,
    scheduledAt: row.scheduled_at,
    sentCount: row.sent_count,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Cross-org guard
// ---------------------------------------------------------------------------

async function requireCampaignOrg(actor: Actor, campaignId: string): Promise<void> {
  const orgId = await findCampaignOrgId(campaignId);
  if (!orgId) throw new CampaignError("CAMPAIGN_NOT_FOUND");
  if (orgId !== actor.orgId) throw new AuthzError("cross_org_access_denied");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** @api-id API-NOT-08 */
export async function listCampaigns(
  actor: Actor,
  opts: { status?: CampaignStatus; cursor?: string; limit?: number },
): Promise<{ items: CampaignSummaryDto[]; nextCursor: string | null }> {
  can(actor, "campaigns", "view");
  const { items, nextCursor } = await repoListCampaigns(actor.orgId, opts);
  return { items: items.map(toSummaryDto), nextCursor };
}

/** @api-id API-NOT-09 */
export async function getCampaign(actor: Actor, id: string): Promise<CampaignDetailDto> {
  can(actor, "campaigns", "view");
  await requireCampaignOrg(actor, id);
  const row = await findCampaignById(id);
  if (!row) throw new CampaignError("CAMPAIGN_NOT_FOUND");
  const metrics = await campaignMetrics(id);
  return {
    ...toSummaryDto(row),
    bodyHtml: row.body_html,
    audience: parseAudience(row.audience),
    metrics,
  };
}

/** Lists the org's active clients for the custom-audience picker. */
export async function listClients(actor: Actor): Promise<OrgClient[]> {
  can(actor, "campaigns", "view");
  return listOrgClients(actor.orgId);
}

/** @api-id API-NOT-12 — live audience count + suppression breakdown. */
export async function previewAudience(
  actor: Actor,
  input: { audience: AudienceSpec },
): Promise<AudiencePreviewDto> {
  can(actor, "campaigns", "view");
  const audience = AudienceSchema.parse(input.audience);
  const candidates = await resolveAudience(actor.orgId, audience);

  let mailable = 0;
  let noEmail = 0;
  let optedOut = 0;
  let bounced = 0;
  for (const c of candidates) {
    const r = suppressionReason(c);
    if (!r) mailable += 1;
    else if (r === "no_email") noEmail += 1;
    else if (r === "opted_out") optedOut += 1;
    else if (r === "bounced") bounced += 1;
  }

  return {
    total: candidates.length,
    mailable,
    suppressed: { noEmail, optedOut, bounced },
    asOf: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** @api-id API-NOT-10 */
export async function createCampaign(actor: Actor, input: CreateCampaignInput): Promise<CampaignRow> {
  can(actor, "campaigns", "edit");
  const parsed = CreateCampaignSchema.parse(input);
  const row = await insertCampaign({
    org_id: actor.orgId,
    name: parsed.name,
    subject: parsed.subject,
    body_html: sanitizeCampaignHtml(parsed.bodyHtml),
    audience: audienceToJson(parsed.audience) as Json,
    status: "draft",
    created_by: actor.userId,
    sent_count: 0,
  });
  await writeAudit(actor, "campaigns.created", "broadcast_campaigns", row.id, {
    after: { name: parsed.name, audienceKind: parsed.audience.kind },
  });
  return row;
}

/** @api-id API-NOT-11 — edit a DRAFT campaign. */
export async function updateCampaign(
  actor: Actor,
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<CampaignRow> {
  can(actor, "campaigns", "edit");
  await requireCampaignOrg(actor, campaignId);
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");
  if (!isEditable(campaign.status as CampaignStatus)) throw new CampaignError("NOT_EDITABLE");

  const parsed = UpdateCampaignSchema.parse(input);
  const patch: Record<string, unknown> = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.subject !== undefined) patch.subject = parsed.subject;
  if (parsed.bodyHtml !== undefined) patch.body_html = sanitizeCampaignHtml(parsed.bodyHtml);
  if (parsed.audience !== undefined) patch.audience = audienceToJson(parsed.audience) as Json;

  const row = await repoUpdateCampaign(campaignId, patch as Parameters<typeof repoUpdateCampaign>[1]);
  await writeAudit(actor, "campaigns.updated", "broadcast_campaigns", campaignId, { after: patch });
  return row;
}

/** @api-id API-NOT-13 — send a test to the staff member's own email. */
export async function sendTest(actor: Actor, campaignId: string): Promise<void> {
  can(actor, "campaigns", "edit");
  await requireCampaignOrg(actor, campaignId);
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");

  const supabase = createServiceClient();
  const { data: user } = await supabase
    .from("users")
    .select("email, locale")
    .eq("id", actor.userId)
    .maybeSingle();
  if (!user?.email) throw new CampaignError("TEST_EMAIL_INVALID");

  const unsubscribeUrl = buildUnsubscribeUrl(campaign.id, actor.userId);
  const { html, text } = await renderCampaignEmail({
    locale: user.locale ?? "es",
    subject: campaign.subject,
    bodyHtml: campaign.body_html,
    unsubscribeUrl,
  });

  await sendTransactional({
    to: user.email,
    subject: `[Prueba] ${campaign.subject}`,
    html,
    text,
    from: FROM_CAMPAIGNS,
  });
}

/** @api-id API-NOT-14 — schedule a draft to send at a future time. */
export async function scheduleCampaign(
  actor: Actor,
  input: { campaignId: string; scheduledAt: string },
): Promise<CampaignRow> {
  can(actor, "campaigns", "edit");
  await requireCampaignOrg(actor, input.campaignId);
  const parsed = ScheduleSchema.parse(input);

  const campaign = await findCampaignById(parsed.campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");
  if (!canTransitionCampaign(campaign.status as CampaignStatus, "scheduled")) {
    throw new CampaignError("INVALID_STATE_TRANSITION");
  }
  if (new Date(parsed.scheduledAt).getTime() <= Date.now()) {
    throw new CampaignError("SCHEDULE_IN_PAST");
  }

  const row = await repoUpdateCampaign(parsed.campaignId, {
    status: "scheduled",
    scheduled_at: parsed.scheduledAt,
  });
  await writeAudit(actor, "campaigns.scheduled", "broadcast_campaigns", parsed.campaignId, {
    after: { scheduledAt: parsed.scheduledAt },
  });

  // Fire a delayed send-campaign job; sendCampaignBatch handles scheduled→sending.
  const delaySec = Math.max(0, Math.floor((new Date(parsed.scheduledAt).getTime() - Date.now()) / 1000));
  await enqueueJob(
    {
      jobKey: "send-campaign",
      entityId: parsed.campaignId,
      attempt: 1,
      dedupeId: `send-campaign:${parsed.campaignId}:batch-1`,
      orgId: campaign.org_id,
      campaignId: parsed.campaignId,
      batch: 1,
    },
    { delay: delaySec },
  );
  return row;
}

/**
 * @api-id API-NOT-15 — send now: materialize recipients, mark sending, enqueue batch-1.
 *
 * Returns the campaign + a flag the action uses to enqueue the first batch
 * (the job is enqueued by the page action to keep platform/qstash out of the
 * module-int → no extra coupling here; see actions.ts).
 */
export async function sendCampaignNow(actor: Actor, campaignId: string): Promise<CampaignRow> {
  can(actor, "campaigns", "edit");
  await requireCampaignOrg(actor, campaignId);
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");

  if (campaign.status === "sending") throw new CampaignError("ALREADY_SENDING");
  if (!canTransitionCampaign(campaign.status as CampaignStatus, "sending")) {
    throw new CampaignError("INVALID_STATE_TRANSITION");
  }

  const { total, suppressed } = await materializeRecipients(campaignId);
  if (total - suppressed <= 0) throw new CampaignError("AUDIENCE_EMPTY");

  const row = await repoUpdateCampaign(campaignId, { status: "sending" });
  await writeAudit(actor, "campaigns.send_started", "broadcast_campaigns", campaignId, {
    after: { total, suppressed },
  });

  await enqueueJob({
    jobKey: "send-campaign",
    entityId: campaignId,
    attempt: 1,
    dedupeId: `send-campaign:${campaignId}:batch-1`,
    orgId: campaign.org_id,
    campaignId,
    batch: 1,
  });
  return row;
}

/** @api-id API-NOT-16 — cancel (scheduled → cancelled / sending → best-effort cancelled). */
export async function cancelCampaign(actor: Actor, campaignId: string): Promise<CampaignRow> {
  can(actor, "campaigns", "edit");
  await requireCampaignOrg(actor, campaignId);
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");
  if (!isCancellable(campaign.status as CampaignStatus)) {
    throw new CampaignError("INVALID_STATE_TRANSITION");
  }
  const row = await repoUpdateCampaign(campaignId, { status: "cancelled" });
  await writeAudit(actor, "campaigns.cancelled", "broadcast_campaigns", campaignId, {
    before: { status: campaign.status },
  });
  return row;
}

// ---------------------------------------------------------------------------
// Materialization (DOC-73 §4.2)
// ---------------------------------------------------------------------------

/**
 * Resolves + freezes the audience into campaign_recipients. Suppressed rows
 * (no email / opted out / bounced) are inserted with status='suppressed' so the
 * send job never mails them. Idempotent (unique(campaign_id,user_id)).
 */
export async function materializeRecipients(
  campaignId: string,
): Promise<{ total: number; suppressed: number }> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) throw new CampaignError("CAMPAIGN_NOT_FOUND");

  const audience = parseAudience(campaign.audience);
  const candidates = await resolveAudience(campaign.org_id, audience);

  const rows = candidates.map((c) => ({
    campaign_id: campaignId,
    user_id: c.userId,
    email: c.email ?? "",
    status: suppressionReason(c) ? "suppressed" : "pending",
  }));

  await upsertRecipients(rows);

  // Promote any already-pending recipient who became ineligible since the first
  // materialization (e.g. opted out between scheduling and the scheduled fire) — STRONG-4.
  const nowSuppressed = candidates.filter((c) => suppressionReason(c)).map((c) => c.userId);
  await suppressPendingRecipients(campaignId, nowSuppressed);

  const suppressed = rows.filter((r) => r.status === "suppressed").length;
  return { total: rows.length, suppressed };
}

// ---------------------------------------------------------------------------
// Send batch (called by the send-campaign job; system-level, no actor)
// ---------------------------------------------------------------------------

export interface SendBatchResult {
  status: "sent_batch" | "completed" | "aborted";
  hasMore: boolean;
}

/**
 * Processes ONE batch of up to 100 pending recipients for a campaign.
 *
 * Handles the scheduled→sending transition on the first fire. Aborts (no-op)
 * if the campaign is cancelled/sent/failed — this is how a mid-send cancel
 * stops the self-chain. Returns hasMore so the job can enqueue the next batch.
 */
export async function sendCampaignBatch(campaignId: string): Promise<SendBatchResult> {
  const campaign = await findCampaignById(campaignId);
  if (!campaign) return { status: "aborted", hasMore: false };

  let status = campaign.status as CampaignStatus;

  // Scheduled fire: materialize + atomically claim the scheduled→sending transition.
  // Only the worker that wins the conditional UPDATE proceeds; a duplicate QStash
  // delivery (slow ACK) loses the claim and aborts — preventing a double send (MED-2).
  if (status === "scheduled") {
    const claimed = await claimScheduledForSending(campaignId);
    if (!claimed) return { status: "aborted", hasMore: false };
    await materializeRecipients(campaignId);
    status = "sending";
  }

  if (status !== "sending") return { status: "aborted", hasMore: false };

  const batch = await listPendingRecipientsForSend(campaignId, SEND_BATCH_SIZE);

  // No pending left → close the campaign.
  if (batch.length === 0) {
    const metrics = await campaignMetrics(campaignId);
    await repoUpdateCampaign(campaignId, { status: "sent", sent_count: metrics.sent });
    appEvents.emit({
      type: "campaign.sent",
      payload: { campaignId, orgId: campaign.org_id, sentCount: metrics.sent },
      occurredAt: new Date(),
    });
    return { status: "completed", hasMore: false };
  }

  // Render each recipient's email (per-locale + per-recipient unsubscribe).
  const items = await Promise.all(
    batch.map(async (r) => {
      const unsubscribeUrl = buildUnsubscribeUrl(campaignId, r.userId);
      const { html, text } = await renderCampaignEmail({
        locale: r.locale,
        subject: campaign.subject,
        bodyHtml: campaign.body_html,
        unsubscribeUrl,
      });
      return { to: r.email, subject: campaign.subject, html, text, from: FROM_CAMPAIGNS };
    }),
  );

  const ids = batch.map((r) => r.id);
  try {
    await sendBatch(items);
    await markRecipientsSent(ids, new Date().toISOString());
  } catch (err) {
    // Leave recipients 'pending' (do NOT mark failed): a QStash retry re-processes
    // the SAME pending batch. Marking them failed here would make the next pass see
    // 0 pending and prematurely close the campaign as 'sent' with sent_count=0 (STRONG-2).
    logger.error({ err, campaignId, count: ids.length }, "campaigns: sendBatch failed — leaving pending for retry");
    throw err; // QStash retries this batch
  }

  return { status: "sent_batch", hasMore: batch.length === SEND_BATCH_SIZE };
}

// ---------------------------------------------------------------------------
// Resend webhook handler (system; called by the webhook route)
// ---------------------------------------------------------------------------

export interface ResendEvent {
  type: string;
  email: string | null;
  at: string;
}

/**
 * Applies a verified Resend status event (DOC-73 §5):
 *   - email.delivered  → stamp last_event_at (status stays 'sent')
 *   - email.bounced    → recipient 'bounced' + users.email_bounced_at
 *   - email.complained → recipient 'complained' + client_profiles.marketing_opt_in=false
 */
export async function applyResendEvent(evt: ResendEvent): Promise<void> {
  if (!evt.email) return;
  const recipient = await findRecipientByEmail(evt.email);

  if (evt.type === "email.delivered") {
    if (recipient) await setRecipientStatus(recipient.id, "sent", evt.at);
    return;
  }

  if (evt.type === "email.bounced") {
    const userId = recipient?.user_id ?? (await findUserIdByEmail(evt.email));
    if (recipient) await setRecipientStatus(recipient.id, "bounced", evt.at);
    if (userId) await markUserBounced(userId, evt.at);
    return;
  }

  if (evt.type === "email.complained") {
    const userId = recipient?.user_id ?? (await findUserIdByEmail(evt.email));
    if (recipient) await setRecipientStatus(recipient.id, "complained", evt.at);
    if (userId) await optOutClientMarketing(userId);
    return;
  }

  // Unknown event types: no-op.
}

/** Resolves the org of a Resend event's recipient (for the webhook barrier). */
export async function resolveRecipientOrg(email: string | null): Promise<string | null> {
  if (!email) return null;
  return findUserOrgByEmail(email);
}

// ---------------------------------------------------------------------------
// Unsubscribe (token-authenticated; no actor)
// ---------------------------------------------------------------------------

/**
 * Verifies the HMAC unsubscribe token and opts the user out of marketing.
 * The token IS the authentication — no session required (email link).
 */
export async function unsubscribeByToken(
  campaignId: string,
  userId: string,
  token: string,
): Promise<{ ok: boolean }> {
  if (!verifyUnsubscribeToken(campaignId, userId, token)) return { ok: false };
  await optOutClientMarketing(userId);
  return { ok: true };
}
