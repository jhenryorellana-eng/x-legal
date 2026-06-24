-- =============================================================================
-- 0027_scheduling_org_level.sql
-- Move scheduling availability + anti-overlap + agenda visibility from PER-STAFF
-- to PER-ORG ("a single UsaLatino agenda").
--
-- Rationale (decision by Henry): the client books against the organization, not
-- against a person; availability is one shared set; Vanessa and Henry must see
-- and edit the SAME availability and the SAME appointments. staff_id is kept as
-- "who attends" metadata (default = the org's sales owner).
--
-- Changes:
--   A. availability_rules       → add org_id, staff_id nullable, backfill, RLS org-scoped
--   B. availability_exceptions  → idem
--   C. org_scheduling_settings  → new table (PK org_id, 1 row/org), merge from staff rows
--   D. appointments             → add org_id, backfill, swap EXCLUDE staff_id→org_id, RLS
--
-- staff_scheduling_settings is kept in the schema (unused after this migration);
-- cleanup is deferred to a later migration once this is stable.
--
-- Idempotent / re-runnable. Pre-condition for the EXCLUDE swap: appointments has
-- no overlapping 'scheduled' rows for the new (org_id) key. With 0 rows today the
-- swap is trivially safe.
--
-- Depends on: 0001_identity (orgs, users, auth_org_id, has_module, is_case_member,
--             set_updated_at, btree_gist), 0007_scheduling.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. availability_rules → org-level
-- ---------------------------------------------------------------------------
alter table public.availability_rules
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

alter table public.availability_rules alter column staff_id drop not null;

update public.availability_rules ar
   set org_id = u.org_id
  from public.users u
 where u.id = ar.staff_id
   and ar.org_id is null;

alter table public.availability_rules alter column org_id set not null;

create index if not exists availability_rules_org_weekday_idx
  on public.availability_rules (org_id, weekday);

-- RLS: replace per-staff policies with org-scoped (availability module) policies.
drop policy if exists availability_rules_select on public.availability_rules;
drop policy if exists availability_rules_insert on public.availability_rules;
drop policy if exists availability_rules_update on public.availability_rules;
drop policy if exists availability_rules_delete on public.availability_rules;

create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', false))
  );

create policy availability_rules_insert on public.availability_rules
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

create policy availability_rules_update on public.availability_rules
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

create policy availability_rules_delete on public.availability_rules
  for delete to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

-- ---------------------------------------------------------------------------
-- B. availability_exceptions → org-level
-- ---------------------------------------------------------------------------
alter table public.availability_exceptions
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

alter table public.availability_exceptions alter column staff_id drop not null;

update public.availability_exceptions ae
   set org_id = u.org_id
  from public.users u
 where u.id = ae.staff_id
   and ae.org_id is null;

alter table public.availability_exceptions alter column org_id set not null;

create index if not exists availability_exceptions_org_starts_at_idx
  on public.availability_exceptions (org_id, starts_at);

drop policy if exists availability_exceptions_select on public.availability_exceptions;
drop policy if exists availability_exceptions_insert on public.availability_exceptions;
drop policy if exists availability_exceptions_update on public.availability_exceptions;
drop policy if exists availability_exceptions_delete on public.availability_exceptions;

create policy availability_exceptions_select on public.availability_exceptions
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', false))
  );

create policy availability_exceptions_insert on public.availability_exceptions
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

create policy availability_exceptions_update on public.availability_exceptions
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

create policy availability_exceptions_delete on public.availability_exceptions
  for delete to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

-- ---------------------------------------------------------------------------
-- C. org_scheduling_settings → new table (1 row / org)
-- ---------------------------------------------------------------------------
create table if not exists public.org_scheduling_settings (
  org_id                     uuid        primary key references public.orgs(id) on delete cascade,
  min_notice_hours           integer     not null default 24,
  max_advance_days           integer     not null default 30,
  buffer_minutes             integer     not null default 0,
  cancellation_window_hours  integer     not null default 24,
  rebooking_penalty_days     integer     not null default 7,
  prospect_duration_minutes  integer     not null default 45 check (prospect_duration_minutes >= 5),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

drop trigger if exists set_updated_at_org_scheduling_settings on public.org_scheduling_settings;
create trigger set_updated_at_org_scheduling_settings
  before update on public.org_scheduling_settings
  for each row execute function public.set_updated_at();

-- Merge existing per-staff settings into one row per org, preferring the row of
-- an active 'sales' member (the org's serving owner) when several exist.
insert into public.org_scheduling_settings (
  org_id, min_notice_hours, max_advance_days, buffer_minutes,
  cancellation_window_hours, rebooking_penalty_days, prospect_duration_minutes
)
select o.id,
       coalesce(s.min_notice_hours, 24),
       coalesce(s.max_advance_days, 30),
       coalesce(s.buffer_minutes, 0),
       coalesce(s.cancellation_window_hours, 24),
       coalesce(s.rebooking_penalty_days, 7),
       coalesce(s.prospect_duration_minutes, 45)
  from public.orgs o
  left join lateral (
    select sss.*
      from public.staff_scheduling_settings sss
      join public.users u on u.id = sss.staff_id
      left join public.staff_profiles sp on sp.user_id = sss.staff_id
     where u.org_id = o.id
     order by (sp.role = 'sales') desc nulls last, u.created_at asc
     limit 1
  ) s on true
on conflict (org_id) do nothing;

alter table public.org_scheduling_settings enable row level security;

drop policy if exists org_scheduling_settings_select on public.org_scheduling_settings;
drop policy if exists org_scheduling_settings_insert on public.org_scheduling_settings;
drop policy if exists org_scheduling_settings_update on public.org_scheduling_settings;

create policy org_scheduling_settings_select on public.org_scheduling_settings
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', false))
  );

create policy org_scheduling_settings_insert on public.org_scheduling_settings
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );

create policy org_scheduling_settings_update on public.org_scheduling_settings
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('availability', true))
  );
-- DELETE: denied (1 row/org; rewrite instead)

-- ---------------------------------------------------------------------------
-- D. appointments → org_id + anti-overlap by org
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column if not exists org_id uuid references public.orgs(id) on delete restrict;

-- Backfill org_id from case, then lead, then staff (covers every row).
update public.appointments a
   set org_id = c.org_id
  from public.cases c
 where c.id = a.case_id and a.org_id is null;

update public.appointments a
   set org_id = l.org_id
  from public.leads l
 where l.id = a.lead_id and a.org_id is null;

update public.appointments a
   set org_id = u.org_id
  from public.users u
 where u.id = a.staff_id and a.org_id is null;

alter table public.appointments alter column org_id set not null;

-- Swap the anti-overlap EXCLUDE from per-staff to per-org: a single reservable
-- org agenda (two org appointments can't overlap regardless of who attends).
alter table public.appointments
  drop constraint if exists appointments_staff_id_tstzrange_excl;

alter table public.appointments
  add constraint appointments_org_id_tstzrange_excl
  exclude using gist (
    org_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'scheduled');

create index if not exists appointments_org_starts_at_idx
  on public.appointments (org_id, starts_at);

-- RLS: appointment visibility/edit is org-wide for the calendar module (was
-- keyed on staff_id = auth.uid()). Client policies (own / case member) unchanged.
drop policy if exists appointments_select on public.appointments;
drop policy if exists appointments_update_staff on public.appointments;

create policy appointments_select on public.appointments
  for select to authenticated
  using (
    client_user_id = (select auth.uid())
    or (case_id is not null and (select public.is_case_member(case_id)))
    or (
      org_id = (select public.auth_org_id())
      and (select public.has_module('calendar', false))
    )
  );

create policy appointments_update_staff on public.appointments
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('calendar', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('calendar', true))
  );
