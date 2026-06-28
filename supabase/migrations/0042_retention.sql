-- =============================================================================
-- 0042_retention.sql
-- Lifecycle "después" (fidelización): promotions, promotion_redemptions,
-- referral_codes, referrals, reviews.
-- Depends on: 0001 (orgs, users, staff_profiles, helpers, set_updated_at),
--             0004 (cases), 0007? (leads)
-- Authz model: service-layer can() is the real gate; modules write with
-- service_role (RLS bypass). RLS below is defense-in-depth + direct client reads.
-- Additive only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- promotions — discount coupons applied when contracting a (new) service.
-- ---------------------------------------------------------------------------
create table if not exists public.promotions (
  id             uuid        primary key default gen_random_uuid(),
  org_id         uuid        not null references public.orgs(id),
  code           text        not null,
  description    text,
  kind           text        not null check (kind in ('percent','amount')),
  value          integer     not null check (value > 0),
  -- percent: 1..100 ; amount: cents (>0)
  currency       text        not null default 'usd',
  service_scope  jsonb,      -- null = all services ; {"service_ids":[...]}
  valid_from     timestamptz,
  valid_until    timestamptz,
  max_uses       integer     check (max_uses is null or max_uses > 0),
  used_count     integer     not null default 0,
  is_active      boolean     not null default true,
  created_by     uuid        references public.staff_profiles(user_id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (org_id, code),
  constraint promotions_percent_max check (kind <> 'percent' or value <= 100)
);

create index if not exists promotions_org_active_idx
  on public.promotions (org_id, is_active);

drop trigger if exists set_promotions_updated_at on public.promotions;
create trigger set_promotions_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

alter table public.promotions enable row level security;

-- SELECT/INSERT/UPDATE/DELETE: org staff with module 'promotions'
create policy promotions_select on public.promotions
  for select to authenticated
  using ( org_id = (select public.auth_org_id())
          and (select public.has_module('promotions', false)) );

create policy promotions_insert on public.promotions
  for insert to authenticated
  with check ( org_id = (select public.auth_org_id())
               and (select public.has_module('promotions', true)) );

create policy promotions_update on public.promotions
  for update to authenticated
  using  ( org_id = (select public.auth_org_id())
           and (select public.has_module('promotions', true)) )
  with check ( org_id = (select public.auth_org_id())
               and (select public.has_module('promotions', true)) );

create policy promotions_delete on public.promotions
  for delete to authenticated
  using ( org_id = (select public.auth_org_id())
          and (select public.has_module('promotions', true)) );


-- ---------------------------------------------------------------------------
-- promotion_redemptions — one row per applied coupon (immutable ledger).
-- Written server-side (service_role) at case/contract creation.
-- ---------------------------------------------------------------------------
create table if not exists public.promotion_redemptions (
  id            uuid        primary key default gen_random_uuid(),
  promotion_id  uuid        not null references public.promotions(id) on delete cascade,
  org_id        uuid        not null references public.orgs(id),
  case_id       uuid        references public.cases(id) on delete set null,
  user_id       uuid        references public.users(id) on delete set null,
  amount_cents  integer,    -- computed discount applied
  redeemed_by   uuid        references public.staff_profiles(user_id),
  redeemed_at   timestamptz not null default now()
);

create index if not exists promotion_redemptions_promotion_idx
  on public.promotion_redemptions (promotion_id);
create index if not exists promotion_redemptions_org_idx
  on public.promotion_redemptions (org_id, redeemed_at desc);

alter table public.promotion_redemptions enable row level security;

-- SELECT: org staff with module 'promotions'. Writes: service_role only.
create policy promotion_redemptions_select on public.promotion_redemptions
  for select to authenticated
  using ( org_id = (select public.auth_org_id())
          and (select public.has_module('promotions', false)) );


-- ---------------------------------------------------------------------------
-- referral_codes — one stable code per referrer (client).
-- ---------------------------------------------------------------------------
create table if not exists public.referral_codes (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.orgs(id),
  referrer_user_id  uuid        not null references public.users(id) on delete cascade,
  code              text        not null,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, referrer_user_id),
  unique (org_id, code)
);

drop trigger if exists set_referral_codes_updated_at on public.referral_codes;
create trigger set_referral_codes_updated_at
  before update on public.referral_codes
  for each row execute function public.set_updated_at();

alter table public.referral_codes enable row level security;

-- SELECT: org staff with module 'referrals' OR the referrer themselves.
create policy referral_codes_select on public.referral_codes
  for select to authenticated
  using (
    referrer_user_id = (select auth.uid())
    or ( org_id = (select public.auth_org_id())
         and (select public.has_module('referrals', false)) )
  );
-- INSERT/UPDATE: service_role (codes minted server-side). No authenticated policy.


-- ---------------------------------------------------------------------------
-- referrals — one row per referral event (a referred lead/user).
-- ---------------------------------------------------------------------------
create table if not exists public.referrals (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.orgs(id),
  referral_code_id  uuid        not null references public.referral_codes(id) on delete cascade,
  referred_lead_id  uuid        references public.leads(id) on delete set null,
  referred_user_id  uuid        references public.users(id) on delete set null,
  status            text        not null default 'pending'
                      check (status in ('pending','converted','rewarded','void')),
  reward            jsonb,      -- {kind:'promo'|'credit', value, note}
  converted_at      timestamptz,
  rewarded_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists referrals_org_status_idx
  on public.referrals (org_id, status);
create index if not exists referrals_code_idx
  on public.referrals (referral_code_id);

drop trigger if exists set_referrals_updated_at on public.referrals;
create trigger set_referrals_updated_at
  before update on public.referrals
  for each row execute function public.set_updated_at();

alter table public.referrals enable row level security;

-- SELECT: org staff with module 'referrals' OR the referrer (via their code).
create policy referrals_select on public.referrals
  for select to authenticated
  using (
    ( org_id = (select public.auth_org_id())
      and (select public.has_module('referrals', false)) )
    or exists (
      select 1 from public.referral_codes rc
       where rc.id = referral_code_id
         and rc.referrer_user_id = (select auth.uid())
    )
  );
-- INSERT/UPDATE: service_role (created on lead capture, advanced on conversion).


-- ---------------------------------------------------------------------------
-- reviews — post-completion satisfaction (rating + NPS) and testimonials.
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references public.orgs(id),
  user_id       uuid        not null references public.users(id) on delete cascade,
  case_id       uuid        references public.cases(id) on delete set null,
  rating        integer     check (rating between 1 and 5),
  nps           integer     check (nps between 0 and 10),
  body          text,
  is_public     boolean     not null default false,
  requested_at  timestamptz,
  submitted_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, case_id)
);

create index if not exists reviews_org_idx
  on public.reviews (org_id, submitted_at desc);

drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;

-- SELECT: org staff with module 'reviews' OR the author.
create policy reviews_select on public.reviews
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or ( org_id = (select public.auth_org_id())
         and (select public.has_module('reviews', false)) )
  );

-- INSERT/UPDATE: the client author may submit/edit their own review.
create policy reviews_insert on public.reviews
  for insert to authenticated
  with check ( user_id = (select auth.uid()) );

create policy reviews_update on public.reviews
  for update to authenticated
  using  ( user_id = (select auth.uid()) )
  with check ( user_id = (select auth.uid()) );


-- ---------------------------------------------------------------------------
-- Seed module permissions for finance staff (Andrium) — admin bypasses has_module.
-- Idempotent (guarded by NOT EXISTS).
-- ---------------------------------------------------------------------------
insert into public.employee_module_permissions (staff_id, module_key, can_view, can_edit)
select sp.user_id, m.key, true, true
  from public.staff_profiles sp
  cross join (values ('promotions'),('referrals'),('reviews'),('retention')) as m(key)
 where sp.role = 'finance'
   and not exists (
     select 1 from public.employee_module_permissions e
      where e.staff_id = sp.user_id and e.module_key = m.key
   );
