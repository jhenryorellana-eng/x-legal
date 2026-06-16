/**
 * Campaigns module — public API (module-pub boundary).
 *
 * Server actions live in the page-level actions.ts (`/finanzas/campanas`),
 * which wraps these service functions with "use server".
 */

export {
  // reads
  listCampaigns,
  getCampaign,
  previewAudience,
  listClients,
  // mutations
  createCampaign,
  updateCampaign,
  sendTest,
  scheduleCampaign,
  sendCampaignNow,
  cancelCampaign,
  // system (job / webhook / unsubscribe)
  materializeRecipients,
  sendCampaignBatch,
  applyResendEvent,
  resolveRecipientOrg,
  unsubscribeByToken,
  // error
  CampaignError,
} from "./service";

export type {
  CreateCampaignInput,
  UpdateCampaignInput,
  CampaignSummaryDto,
  CampaignDetailDto,
  AudiencePreviewDto,
  ResendEvent,
  SendBatchResult,
} from "./service";

export type { AudienceSpec, CampaignStatus } from "./domain";
export type { OrgClient } from "./repository";
export type { CampaignEvent } from "./events";
