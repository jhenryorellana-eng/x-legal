-- =============================================================================
-- 0007_scheduling.sql
-- Block 7: scheduling (4 tables)
-- Depends on: 0001_identity.sql (staff_profiles, users, orgs),
--             0003_leads_kanban.sql (leads),
--             0004_cases.sql (cases, case_members)
-- Requires:   btree_gist extension (created in 0001_identity.sql)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- availability_rules
-- ---------------------------------------------------------------------------
create table public.availability_rules (
  id          uuid      primary key default gen_random_uuid(),
  staff_id    uuid      not null references public.staff_profiles(user_id) on delete cascade,
  weekday     smallint  not null check (weekday between 0 and 6),  -- 0=Sunday
  start_local time      not null,
  end_local   time      not null,
  timezone    text      not null,  -- IANA timezone of the staff member at creation time
  is_active   boolean   not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index availability_rules_staff_weekday_idx
  on public.availability_rules (staff_id, weekday);

create trigger set_updated_at_availability_rules
  before update on public.availability_rules
  for each row execute function public.set_updated_at();

alter table public.availability_rules enable row level security;

-- Staff reads their own rules; availability module (Vanessa/admin) reads all
create policy availability_rules_select on public.availability_rules
  for select to authenticated
  using (
    staff_id = (select auth.uid())
    or (select public.has_module('availability', false))
  );

-- INSERT/UPDATE/DELETE: availability module edit (Vanessa manages the whole agenda)
create policy availability_rules_insert on public.availability_rules
  for insert to authenticated
  with check ((select public.has_module('availability', true)));

create policy availability_rules_update on public.availability_rules
  for update to authenticated
  using      ((select public.has_module('availability', true)))
  with check ((select public.has_module('availability', true)));

create policy availability_rules_delete on public.availability_rules
  for delete to authenticated
  using ((select public.has_module('availability', true)));

-- ---------------------------------------------------------------------------
-- availability_exceptions
-- ---------------------------------------------------------------------------
create table public.availability_exceptions (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references public.staff_profiles(user_id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index availability_exceptions_staff_starts_at_idx
  on public.availability_exceptions (staff_id, starts_at);

create trigger set_updated_at_availability_exceptions
  before update on public.availability_exceptions
  for each row execute function public.set_updated_at();

alter table public.availability_exceptions enable row level security;

-- Same pattern as availability_rules
create policy availability_exceptions_select on public.availability_exceptions
  for select to authenticated
  using (
    staff_id = (select auth.uid())
    or (select public.has_module('availability', false))
  );

create policy availability_exceptions_insert on public.availability_exceptions
  for insert to authenticated
  with check ((select public.has_module('availability', true)));

create policy availability_exceptions_update on public.availability_exceptions
  for update to authenticated
  using      ((select public.has_module('availability', true)))
  with check ((select public.has_module('availability', true)));

create policy availability_exceptions_delete on public.availability_exceptions
  for delete to authenticated
  using ((select public.has_module('availability', true)));

-- ---------------------------------------------------------------------------
-- staff_scheduling_settings
-- ---------------------------------------------------------------------------
create table public.staff_scheduling_settings (
  staff_id                   uuid    primary key references public.staff_profiles(user_id) on delete cascade,
  min_notice_hours           integer not null default 24,   -- minimum advance booking by client
  max_advance_days           integer not null default 30,   -- maximum booking window
  buffer_minutes             integer not null default 0,    -- buffer between appointments
  cancellation_window_hours  integer not null default 24,   -- cancellation without penalty
  rebooking_penalty_days     integer not null default 7,    -- rebook block after late cancellation
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create trigger set_updated_at_staff_scheduling_settings
  before update on public.staff_scheduling_settings
  for each row execute function public.set_updated_at();

alter table public.staff_scheduling_settings enable row level security;

-- SELECT: staff sees their own settings; availability module sees all
create policy staff_scheduling_settings_select on public.staff_scheduling_settings
  for select to authenticated
  using (
    staff_id = (select auth.uid())
    or (select public.has_module('availability', false))
  );

-- INSERT/UPDATE: availability module edit
create policy staff_scheduling_settings_insert on public.staff_scheduling_settings
  for insert to authenticated
  with check ((select public.has_module('availability', true)));

create policy staff_scheduling_settings_update on public.staff_scheduling_settings
  for update to authenticated
  using      ((select public.has_module('availability', true)))
  with check ((select public.has_module('availability', true)));

-- DELETE: denied (1:1 settings row; rewrite instead)

-- ---------------------------------------------------------------------------
-- appointments
-- ---------------------------------------------------------------------------
create table public.appointments (
  id               uuid        primary key default gen_random_uuid(),
  case_id          uuid        references public.cases(id) on delete restrict,
  lead_id          uuid        references public.leads(id) on delete restrict,
  service_phase_id uuid        references public.service_phases(id) on delete restrict,
  staff_id         uuid        not null references public.staff_profiles(user_id) on delete restrict,
  client_user_id   uuid        references public.users(id) on delete restrict,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  kind             text        not null default 'video'
                               check (kind in ('video','phone','presencial')),
  status           text        not null default 'scheduled'
                               check (status in ('scheduled','completed','cancelled','no_show','rescheduled')),
  sequence_number  integer,    -- "Appointment 2 of 3" within the phase
  livekit_room_id  text,       -- if kind='video'
  notes            text,       -- Vanessa's per-appointment notes
  reminder_1d      boolean     not null default true,
  reminder_1h      boolean     not null default false,
  reminder_1d_sent_at timestamptz,  -- reminder idempotency (DOC-26)
  reminder_1h_sent_at timestamptz,
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- XOR: a booking must belong to a case OR a lead, never neither, never both
  check (case_id is not null or lead_id is not null),

  -- Unique constraint: enforce "Appointment N of M" within a phase
  -- (only for scheduled/completed; rescheduled/cancelled/no_show slots are excluded)
  unique (case_id, service_phase_id, sequence_number)
    where (status in ('scheduled','completed')),

  -- One active live call per conversation is tracked in calls table;
  -- this unique prevents double-booking the same staff member at the same time.
  -- Requires btree_gist (created in 0001_identity.sql).
  exclude using gist (
    staff_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'scheduled')
);

-- Indexes for common queries
create index appointments_staff_starts_at_idx
  on public.appointments (staff_id, starts_at);

create index appointments_case_starts_at_idx
  on public.appointments (case_id, starts_at);

create trigger set_updated_at_appointments
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;

-- SELECT: client (their own appointments or case appointments) | assigned staff | calendar module
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    client_user_id = (select auth.uid())
    or (case_id is not null and (select public.is_case_member(case_id)))
    or staff_id = (select auth.uid())
    or (select public.has_module('calendar', false))
  );

-- INSERT client: self-service within scheduling policy (enforcement in scheduling/service)
create policy appointments_insert_client on public.appointments
  for insert to authenticated
  with check (
    client_user_id = (select auth.uid())
    and case_id is not null
    and (select public.is_case_member(case_id))
    and status = 'scheduled'
  );

-- INSERT staff: calendar module (includes lead appointments where lead_id is not null)
create policy appointments_insert_staff on public.appointments
  for insert to authenticated
  with check ((select public.has_module('calendar', true)));

-- UPDATE client: cancel/reschedule their own future appointment
create policy appointments_update_client on public.appointments
  for update to authenticated
  using  (client_user_id = (select auth.uid()) and status = 'scheduled')
  with check (client_user_id = (select auth.uid()));

-- UPDATE staff: calendar module OR the assigned staff member marks completed/no_show
create policy appointments_update_staff on public.appointments
  for update to authenticated
  using (
    (select public.has_module('calendar', true))
    or staff_id = (select auth.uid())
  )
  with check (
    (select public.has_module('calendar', true))
    or staff_id = (select auth.uid())
  );

-- DELETE: denied (use status='cancelled')
