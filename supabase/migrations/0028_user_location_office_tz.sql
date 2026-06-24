-- =============================================================================
-- 0028_user_location_office_tz.sql
-- Per-user location (city/country) + the org's canonical "office" timezone.
--
-- - users gets city / country / country_code / location_confirmed_at, set when
--   the user detects their location (browser geolocation → BigDataCloud reverse
--   geocode) or changes it manually in Configuración. users.timezone already
--   exists (the IANA zone, source of truth for rendering).
-- - org_scheduling_settings gets office_timezone: the CANONICAL zone the shared
--   availability rules are defined in. Each staff/client then SEES the agenda and
--   availability converted to their own users.timezone (DOC-43 org agenda, multi-TZ).
--
-- Idempotent / additive. No data loss.
-- Depends on: 0001_identity (users), 0027_scheduling_org_level (org_scheduling_settings).
-- =============================================================================

-- users: location columns
alter table public.users add column if not exists city text;
alter table public.users add column if not exists country text;
alter table public.users add column if not exists country_code text;
alter table public.users add column if not exists location_confirmed_at timestamptz;

-- org_scheduling_settings: canonical office timezone (the zone availability_rules
-- wall-times are defined in). Backfill from the existing rules' snapshot.
alter table public.org_scheduling_settings
  add column if not exists office_timezone text not null default 'America/New_York';

update public.org_scheduling_settings s
   set office_timezone = r.timezone
  from (
    select org_id, min(timezone) as timezone
      from public.availability_rules
     group by org_id
  ) r
 where r.org_id = s.org_id;
