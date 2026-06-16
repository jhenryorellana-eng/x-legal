/**
 * Campaigns module domain events.
 *
 * - campaign.sent — emitted by the send-campaign job when the last batch closes.
 */

export interface CampaignSentEvent {
  type: "campaign.sent";
  payload: { campaignId: string; orgId: string; sentCount: number };
  occurredAt: Date;
}

export type CampaignEvent = CampaignSentEvent;
