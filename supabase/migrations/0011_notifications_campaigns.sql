-- =============================================================================
-- 0011_notifications_campaigns.sql
-- Block 11: notifications, notification_preferences, push_subscriptions,
--           broadcast_campaigns, campaign_recipients
-- Depends on: 0001 (orgs, users, staff_profiles, set_updated_at)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.users(id) on delete cascade,
  type              text        not null,
  icon              text        not null default 'bell',
  color             text        not null default 'accent',
  title_i18n        jsonb       not null,
  body_i18n         jsonb,
  action_url        text,
  dedupe_key        text,
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Index: user feed ordered by recency
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Index: unread count (no-leidos) — partial, only unread rows
create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- Idempotency: unique dedupe_key per user when not null
create unique index notifications_user_dedupe_key_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

drop trigger if exists set_notifications_updated_at on public.notifications;
create trigger set_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

-- SELECT: owner only (also authorizes Realtime channel user:{id} via postgres_changes)
create policy notifications_select on public.notifications
  for select to authenticated
  using ( user_id = (select auth.uid()) );

-- INSERT: service_role only (deny-by-default for authenticated)
-- No policy for authenticated => INSERT denied.

-- UPDATE: owner marks read (read_at column; GRANT limited by N2 in 0001)
create policy notifications_update on public.notifications
  for update to authenticated
  using  ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

-- DELETE: owner cleans their notification center
create policy notifications_delete on public.notifications
  for delete to authenticated
  using ( user_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
create table public.notification_preferences (
  user_id                uuid        primary key references public.users(id) on delete cascade,
  messages               boolean     not null default true,
  appointment_reminders  boolean     not null default true,
  payment_reminders      boolean     not null default true,
  case_updates           boolean     not null default true,
  channels               jsonb       not null default '{"inapp":true,"push":true,"email":true}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

drop trigger if exists set_notification_preferences_updated_at on public.notification_preferences;
create trigger set_notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;

-- SELECT / INSERT / UPDATE: owner only (upsert of their toggles)
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using ( user_id = (select auth.uid()) );

create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );

create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using  ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

-- DELETE: denied (preferences are rewritten, not deleted)


-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references public.users(id) on delete cascade,
  endpoint    text        not null unique,
  keys        jsonb       not null,  -- {p256dh, auth}
  platform    text        not null default 'web'
                check (platform in ('web','capacitor')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_push_subscriptions_updated_at on public.push_subscriptions;
create trigger set_push_subscriptions_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;

-- Full CRUD: owner only (register/deregister their device endpoint)
-- The push sender reads with service_role (BYPASSRLS).
create policy push_subscriptions_select on public.push_subscriptions
  for select to authenticated
  using ( user_id = (select auth.uid()) );

create policy push_subscriptions_insert on public.push_subscriptions
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );

create policy push_subscriptions_update on public.push_subscriptions
  for update to authenticated
  using  ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );

create policy push_subscriptions_delete on public.push_subscriptions
  for delete to authenticated
  using ( user_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- broadcast_campaigns (root table ⌂)
-- ---------------------------------------------------------------------------
create table public.broadcast_campaigns (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.orgs(id),
  name          text        not null,
  subject       text        not null,
  body_html     text        not null,
  audience      jsonb       not null,
  -- {kind:'all_clients'} | {kind:'by_service', service_ids:[]} | {kind:'custom', user_ids:[]}
  status        text        not null default 'draft'
                  check (status in ('draft','scheduled','sending','sent','failed','cancelled')),
  scheduled_at  timestamptz,
  sent_count    integer     not null default 0,
  created_by    uuid        references public.staff_profiles(user_id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists set_broadcast_campaigns_updated_at on public.broadcast_campaigns;
create trigger set_broadcast_campaigns_updated_at
  before update on public.broadcast_campaigns
  for each row execute function public.set_updated_at();

alter table public.broadcast_campaigns enable row level security;

-- SELECT: org member with module 'campaigns'
create policy broadcast_campaigns_select on public.broadcast_campaigns
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('campaigns', false))
  );

-- INSERT: org member with module 'campaigns' (edit), must be creator
create policy broadcast_campaigns_insert on public.broadcast_campaigns
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('campaigns', true))
    and created_by = (select auth.uid())
  );

-- UPDATE: org member with module 'campaigns' (edit); status sending/sent/failed set by job (service_role)
create policy broadcast_campaigns_update on public.broadcast_campaigns
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('campaigns', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('campaigns', true))
  );

-- DELETE: only draft campaigns
create policy broadcast_campaigns_delete on public.broadcast_campaigns
  for delete to authenticated
  using (
    (select public.has_module('campaigns', true))
    and status = 'draft'
  );


-- ---------------------------------------------------------------------------
-- campaign_recipients
-- ---------------------------------------------------------------------------
create table public.campaign_recipients (
  id             uuid        primary key default gen_random_uuid(),
  campaign_id    uuid        not null references public.broadcast_campaigns(id) on delete cascade,
  user_id        uuid        not null references public.users(id),
  email          text        not null,
  status         text        not null default 'pending'
                   check (status in ('pending','sent','failed','suppressed','bounced','complained')),
  sent_at        timestamptz,
  last_event_at  timestamptz,  -- last event from Resend webhook
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, user_id)
);

drop trigger if exists set_campaign_recipients_updated_at on public.campaign_recipients;
create trigger set_campaign_recipients_updated_at
  before update on public.campaign_recipients
  for each row execute function public.set_updated_at();

alter table public.campaign_recipients enable row level security;

-- SELECT: org member with module 'campaigns' (via campaign)
create policy campaign_recipients_select on public.campaign_recipients
  for select to authenticated
  using (
    exists (
      select 1 from public.broadcast_campaigns bc
       where bc.id = campaign_id
         and bc.org_id = (select public.auth_org_id())
    )
    and (select public.has_module('campaigns', false))
  );

-- INSERT / UPDATE / DELETE: service_role only (audience materialization + Resend webhook states)
-- No policies for authenticated => denied by default.
