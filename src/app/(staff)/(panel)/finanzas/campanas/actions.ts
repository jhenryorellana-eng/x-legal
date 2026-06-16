"use server";

/**
 * Campañas — server actions (Andrium / marketing surface).
 *
 * Thin "use server" wrappers over the campaigns module (API-NOT-10..16).
 * Returns `{ ok, data?, error: { code } }`.
 */

import { requireActor } from "@/backend/modules/identity";
import {
  createCampaign,
  updateCampaign,
  previewAudience,
  sendTest,
  scheduleCampaign,
  sendCampaignNow,
  cancelCampaign,
  CampaignError,
  type CreateCampaignInput,
  type UpdateCampaignInput,
  type AudienceSpec,
  type AudiencePreviewDto,
} from "@/backend/modules/campaigns";

export interface CampaignResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

function fail(err: unknown): CampaignResult<never> {
  if (err instanceof CampaignError) return { ok: false, error: { code: err.code } };
  if (err instanceof Error && err.name === "AuthzError") return { ok: false, error: { code: "FORBIDDEN" } };
  return { ok: false, error: { code: "UNEXPECTED" } };
}

export async function createCampaignAction(input: CreateCampaignInput): Promise<CampaignResult<{ id: string }>> {
  try {
    const actor = await requireActor();
    const row = await createCampaign(actor, input);
    return { ok: true, data: { id: row.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function updateCampaignAction(
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<CampaignResult> {
  try {
    const actor = await requireActor();
    await updateCampaign(actor, campaignId, input);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function previewAudienceAction(audience: AudienceSpec): Promise<CampaignResult<AudiencePreviewDto>> {
  try {
    const actor = await requireActor();
    const data = await previewAudience(actor, { audience });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

export async function sendTestAction(campaignId: string): Promise<CampaignResult> {
  try {
    const actor = await requireActor();
    await sendTest(actor, campaignId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function scheduleCampaignAction(campaignId: string, scheduledAt: string): Promise<CampaignResult> {
  try {
    const actor = await requireActor();
    await scheduleCampaign(actor, { campaignId, scheduledAt });
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function sendCampaignNowAction(campaignId: string): Promise<CampaignResult> {
  try {
    const actor = await requireActor();
    await sendCampaignNow(actor, campaignId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelCampaignAction(campaignId: string): Promise<CampaignResult> {
  try {
    const actor = await requireActor();
    await cancelCampaign(actor, campaignId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
