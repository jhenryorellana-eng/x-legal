-- ============================================================
-- 0003_leads_kanban.sql
-- Block: leads + kanban + staff productivity (6 tables)
-- Single board engine for leads/cases/collections (ADR-5)
-- Depends on: 0001_identity, 0002_catalog
-- Note: leads.won_case_id and staff_tasks.case_id have no FK yet
--       (cases table does not exist). FKs are added in 0004.
-- ============================================================

-- ── lead_categories ──────────────────────────────────────────────────────────
create table public.lead_categories (
  id         uuid    primary key default gen_random_uuid(),
  org_id     uuid    not null references public.orgs(id),
  label      text    not null,
  color      text    not null default 'accent',
  position   integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, label)
);
comment on table public.lead_categories is 'Lead category chips (Caliente, Tibio, Frio, VIP + custom). Managed by staff with leads module.';

drop trigger if exists trg_lead_categories_updated_at on public.lead_categories;
create trigger trg_lead_categories_updated_at
  before update on public.lead_categories
  for each row execute function public.set_updated_at();

-- ── leads ─────────────────────────────────────────────────────────────────────
-- won_case_id: column exists WITHOUT FK (cases table does not exist yet).
-- FK constraint added in 0004 after cases is created.
create table public.leads (
  id                    uuid    primary key default gen_random_uuid(),
  org_id                uuid    not null references public.orgs(id),
  phone_e164            text    not null,
  full_name             text,
  source                text    not null default 'manual',
  category_id           uuid    references public.lead_categories(id),
  lost_reason           text,
  interested_service_id uuid    references public.services(id),
  note                  text,
  assigned_to           uuid    references public.staff_profiles(id),
  status                text    not null default 'open' check (status in ('open', 'won', 'lost')),
  contacted_at          timestamptz,
  won_case_id           uuid,   -- FK to cases added in 0004
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.leads is 'Sales leads/prospects. won_case_id FK to cases is deferred to 0004.';
comment on column public.leads.source is 'Free label: tiktok, web, whatsapp, voz, referido, manual.';
comment on column public.leads.contacted_at is 'NULL => not yet contacted (amber badge + time badge in UI).';
comment on column public.leads.won_case_id is 'Set when lead is won and case is created. FK constraint added in 0004.';

-- Index for duplicate phone detection per org (NOT unique: may have retries)
create index leads_org_phone_idx on public.leads(org_id, phone_e164);

-- Trigram index for fuzzy full name search by staff
create index leads_full_name_trgm_idx on public.leads using gin(full_name gin_trgm_ops)
  where full_name is not null;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ── kanban_boards ─────────────────────────────────────────────────────────────
create table public.kanban_boards (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id),
  owner_staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  board_kind     text not null check (board_kind in ('leads', 'cases', 'collections')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (owner_staff_id, board_kind)
);
comment on table public.kanban_boards is 'Personal kanban boards per staff member per kind. Owner + admin access only.';

drop trigger if exists trg_kanban_boards_updated_at on public.kanban_boards;
create trigger trg_kanban_boards_updated_at
  before update on public.kanban_boards
  for each row execute function public.set_updated_at();

-- ── kanban_columns ────────────────────────────────────────────────────────────
create table public.kanban_columns (
  id               uuid    primary key default gen_random_uuid(),
  board_id         uuid    not null references public.kanban_boards(id) on delete cascade,
  label            text    not null,
  system_key       text,   -- anchors to automated listeners: 'intake','to_collect','overdue','to_print','done'
  color            text    not null default 'accent',
  position         integer not null,
  is_terminal_won  boolean not null default false,
  is_terminal_lost boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (board_id, position) deferrable initially deferred
);
comment on table public.kanban_columns is 'Columns of a kanban board. system_key survives column renames for automation hooks.';

drop trigger if exists trg_kanban_columns_updated_at on public.kanban_columns;
create trigger trg_kanban_columns_updated_at
  before update on public.kanban_columns
  for each row execute function public.set_updated_at();

-- ── kanban_cards ──────────────────────────────────────────────────────────────
create table public.kanban_cards (
  id          uuid    primary key default gen_random_uuid(),
  column_id   uuid    not null references public.kanban_columns(id) on delete cascade,
  ref_type    text    not null check (ref_type in ('lead', 'case')),
  ref_id      uuid    not null,  -- logical FK to leads.id or cases.id (validated in service layer)
  position    integer not null,
  pinned_note text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (column_id, position) deferrable initially deferred,
  unique (ref_type, ref_id, column_id)  -- one card per entity per column
);
comment on table public.kanban_cards is 'Cards on a kanban column. ref_type/ref_id are logical FKs validated in the service layer (N3).';

drop trigger if exists trg_kanban_cards_updated_at on public.kanban_cards;
create trigger trg_kanban_cards_updated_at
  before update on public.kanban_cards
  for each row execute function public.set_updated_at();

-- ── staff_tasks ───────────────────────────────────────────────────────────────
-- case_id: column exists WITHOUT FK (cases table does not exist yet).
-- FK constraint added in 0004 after cases is created.
create table public.staff_tasks (
  id         uuid    primary key default gen_random_uuid(),
  staff_id   uuid    not null references public.staff_profiles(id) on delete cascade,
  text       text    not null,
  tag        text,   -- 'Cartas','Documentos','Traspaso','Onboarding'...
  case_id    uuid,   -- FK to cases added in 0004
  done_at    timestamptz,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.staff_tasks is 'Personal task list for "Mi dia" of staff. case_id FK to cases deferred to 0004.';

create index staff_tasks_staff_done_idx on public.staff_tasks(staff_id, done_at);

drop trigger if exists trg_staff_tasks_updated_at on public.staff_tasks;
create trigger trg_staff_tasks_updated_at
  before update on public.staff_tasks
  for each row execute function public.set_updated_at();

-- ── RLS: enable on all tables in this block ───────────────────────────────────
alter table public.lead_categories enable row level security;
alter table public.leads            enable row level security;
alter table public.kanban_boards    enable row level security;
alter table public.kanban_columns   enable row level security;
alter table public.kanban_cards     enable row level security;
alter table public.staff_tasks      enable row level security;

-- ── Policies: lead_categories ─────────────────────────────────────────────────
create policy lead_categories_select on public.lead_categories
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', false))
  );

create policy lead_categories_insert on public.lead_categories
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  );

create policy lead_categories_update on public.lead_categories
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  );
-- DELETE: denied (is_active=false; historical leads reference it)

-- ── Policies: leads ───────────────────────────────────────────────────────────
create policy leads_select on public.leads
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', false))
  );

create policy leads_insert on public.leads
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  );

create policy leads_update on public.leads
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('leads', true))
  );
-- DELETE: denied (leads close with status='lost', not deleted)

-- ── Policies: kanban_boards ───────────────────────────────────────────────────
-- Personal board: owner or admin
create policy kanban_boards_select on public.kanban_boards
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      owner_staff_id = (select auth.uid())
      or (select public.is_admin())
    )
  );

create policy kanban_boards_insert on public.kanban_boards
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and owner_staff_id = (select auth.uid())
    and (select public.is_staff())
  );

create policy kanban_boards_update on public.kanban_boards
  for update to authenticated
  using (
    owner_staff_id = (select auth.uid())
    or (select public.is_admin())
  )
  with check (
    owner_staff_id = (select auth.uid())
    or (select public.is_admin())
  );

create policy kanban_boards_delete on public.kanban_boards
  for delete to authenticated
  using (
    owner_staff_id = (select auth.uid())
    or (select public.is_admin())
  );

-- ── Policies: kanban_columns ──────────────────────────────────────────────────
create policy kanban_columns_select on public.kanban_columns
  for select to authenticated
  using (
    exists (
      select 1 from public.kanban_boards b
       where b.id = board_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_columns_insert on public.kanban_columns
  for insert to authenticated
  with check (
    exists (
      select 1 from public.kanban_boards b
       where b.id = board_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_columns_update on public.kanban_columns
  for update to authenticated
  using (
    exists (
      select 1 from public.kanban_boards b
       where b.id = board_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  )
  with check (
    exists (
      select 1 from public.kanban_boards b
       where b.id = board_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_columns_delete on public.kanban_columns
  for delete to authenticated
  using (
    exists (
      select 1 from public.kanban_boards b
       where b.id = board_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- ── Policies: kanban_cards ────────────────────────────────────────────────────
create policy kanban_cards_select on public.kanban_cards
  for select to authenticated
  using (
    exists (
      select 1 from public.kanban_columns c
      join public.kanban_boards b on b.id = c.board_id
       where c.id = column_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_cards_insert on public.kanban_cards
  for insert to authenticated
  with check (
    exists (
      select 1 from public.kanban_columns c
      join public.kanban_boards b on b.id = c.board_id
       where c.id = column_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_cards_update on public.kanban_cards
  for update to authenticated
  using (
    exists (
      select 1 from public.kanban_columns c
      join public.kanban_boards b on b.id = c.board_id
       where c.id = column_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  )
  with check (
    exists (
      select 1 from public.kanban_columns c
      join public.kanban_boards b on b.id = c.board_id
       where c.id = column_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

create policy kanban_cards_delete on public.kanban_cards
  for delete to authenticated
  using (
    exists (
      select 1 from public.kanban_columns c
      join public.kanban_boards b on b.id = c.board_id
       where c.id = column_id
         and b.org_id = (select public.auth_org_id())
         and (b.owner_staff_id = (select auth.uid()) or (select public.is_admin()))
    )
  );

-- ── Policies: staff_tasks ─────────────────────────────────────────────────────
-- Strictly personal: "Mi dia" — not even admin reads other staff tasks (no RF for it)
create policy staff_tasks_select on public.staff_tasks
  for select to authenticated
  using (
    staff_id = (select auth.uid())
    and (select public.is_staff())
  );

create policy staff_tasks_insert on public.staff_tasks
  for insert to authenticated
  with check (
    staff_id = (select auth.uid())
    and (select public.is_staff())
  );

create policy staff_tasks_update on public.staff_tasks
  for update to authenticated
  using (
    staff_id = (select auth.uid())
    and (select public.is_staff())
  )
  with check (
    staff_id = (select auth.uid())
    and (select public.is_staff())
  );

create policy staff_tasks_delete on public.staff_tasks
  for delete to authenticated
  using (
    staff_id = (select auth.uid())
    and (select public.is_staff())
  );
