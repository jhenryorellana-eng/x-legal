-- =============================================================================
-- 0041_campaign_blocks_and_marketing_pref.sql
-- Email visual composer + marketing notification category.
-- Depends on: 0011 (broadcast_campaigns, notification_preferences)
-- Additive only — no data touched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- broadcast_campaigns.body_blocks
--   Structured EmailBlock[] produced by the visual block composer.
--   body_html stays the derived/sanitised render (still NOT NULL): updateCampaign
--   re-renders blocks -> html on every save. Legacy campaigns keep body_blocks NULL
--   and the editor falls back to a single raw-html block.
-- ---------------------------------------------------------------------------
alter table public.broadcast_campaigns
  add column if not exists body_blocks jsonb;

comment on column public.broadcast_campaigns.body_blocks is
  'Structured EmailBlock[] from the visual composer (campaigns/blocks.ts). body_html is the derived react.email render.';

-- ---------------------------------------------------------------------------
-- notification_preferences.marketing
--   Gate for non-transactional sends (campaigns / lifecycle "después").
--   Defaults true (opt-in by contract, like client_profiles.marketing_opt_in),
--   revocable from the client "Ajustes" surface.
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists marketing boolean not null default true;

comment on column public.notification_preferences.marketing is
  'Per-user toggle for non-transactional marketing/lifecycle notifications (campaigns, win-back).';
