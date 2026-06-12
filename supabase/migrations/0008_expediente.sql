-- =============================================================================
-- 0008_expediente.sql
-- Block 8: expediente / document assembler (4 tables)
-- Depends on: 0004_cases.sql (cases, staff_profiles, users, orgs)
-- Note: client does NOT access any table in this block (DOC-30 §8, DOC-31 §4 Bloque 8)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- cover_templates  (root table: carries org_id)
-- ---------------------------------------------------------------------------
create table public.cover_templates (
  id         uuid        primary key default gen_random_uuid(),
  org_id     uuid        not null references public.orgs(id) on delete restrict,
  name       text        not null,
  -- template shape: {title_i18n:{es,en}, fields:[], style:"ulp-classic"/"ulp-divider"}
  template   jsonb       not null,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_updated_at_cover_templates
  before update on public.cover_templates
  for each row execute function public.set_updated_at();

alter table public.cover_templates enable row level security;

-- SELECT: expedientes module (Diana + admin)
create policy cover_templates_select on public.cover_templates
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('expedientes', false))
  );

-- INSERT/UPDATE: expedientes module edit
create policy cover_templates_insert on public.cover_templates
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('expedientes', true))
  );

create policy cover_templates_update on public.cover_templates
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('expedientes', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('expedientes', true))
  );

-- DELETE: denied (deactivate with is_active=false)

-- ---------------------------------------------------------------------------
-- expedientes
-- ---------------------------------------------------------------------------
create table public.expedientes (
  id                   uuid        primary key default gen_random_uuid(),
  case_id              uuid        not null references public.cases(id) on delete restrict,
  attempt_no           integer     not null default 1,  -- version (increments on each correction cycle)
  status               text        not null default 'draft'
                                   check (status in (
                                     'draft','compiling','compile_failed','compiled',
                                     'sent_to_lawyer','corrections_needed','approved',
                                     'sent_to_finance','printed'
                                   )),
  built_by             uuid        references public.staff_profiles(user_id) on delete restrict,  -- Diana
  compiled_pdf_path    text,       -- bucket 'expedientes'
  page_count           integer,
  sent_to_finance_at   timestamptz,
  sent_to_finance_by   uuid        references public.staff_profiles(user_id) on delete restrict,
  printed_at           timestamptz,
  printed_by           uuid        references public.staff_profiles(user_id) on delete restrict,  -- Andrium
  shipped_at           timestamptz,    -- physical shipment (courier)
  filed_at             timestamptz,    -- filed with court/USCIS
  tracking_ref         text,           -- courier tracking number
  created_at           timestamptz     not null default now(),
  updated_at           timestamptz     not null default now(),
  unique (case_id, attempt_no),
  unique (case_id) where (status = 'draft')  -- only one draft per case at a time
);

create trigger set_updated_at_expedientes
  before update on public.expedientes
  for each row execute function public.set_updated_at();

alter table public.expedientes enable row level security;

-- SELECT: expedientes (Diana), printing (Andrium), validations (for legal review loop)
create policy expedientes_select on public.expedientes
  for select to authenticated
  using (
    (select public.has_module('expedientes', false))
    or (select public.has_module('printing', false))
    or (select public.has_module('validations', false))
  );

-- INSERT: Diana assembles new expediente
create policy expedientes_insert on public.expedientes
  for insert to authenticated
  with check (
    (select public.has_module('expedientes', true))
    and built_by = (select auth.uid())
  );

-- UPDATE: Diana edits the flow; Andrium marks printing fields
--         Compilation status changes (compiling/compiled/compile_failed) via service_role
create policy expedientes_update on public.expedientes
  for update to authenticated
  using (
    (select public.has_module('expedientes', true))
    or (select public.has_module('printing', true))
  )
  with check (
    (select public.has_module('expedientes', true))
    or (select public.has_module('printing', true))
  );

-- DELETE: denied (versions are tracked with attempt_no)

-- ---------------------------------------------------------------------------
-- expediente_items
-- ---------------------------------------------------------------------------
create table public.expediente_items (
  id              uuid    primary key default gen_random_uuid(),
  expediente_id   uuid    not null references public.expedientes(id) on delete restrict,
  position        integer not null,
  item_type       text    not null check (item_type in (
                            'cover','ai_generation','automated_form',
                            'client_document','external_file'
                          )),
  -- ref_id is a logical FK validated in service layer (not enforced by DB FK):
  --   cover            -> cover_renders.id
  --   ai_generation    -> ai_generation_runs.id
  --   automated_form   -> case_form_responses.id
  --   client_document  -> case_documents.id
  ref_id          uuid,
  external_file_path text,  -- if item_type='external_file' (uploaded by Diana)
  title           text    not null,   -- visible name in the expediente index
  page_count      integer,
  include_in_toc  boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (expediente_id, position) deferrable initially deferred
);

create trigger set_updated_at_expediente_items
  before update on public.expediente_items
  for each row execute function public.set_updated_at();

alter table public.expediente_items enable row level security;

-- SELECT: expedientes or printing module (same as expedientes)
create policy expediente_items_select on public.expediente_items
  for select to authenticated
  using (
    exists (
      select 1
        from public.expedientes e
       where e.id = expediente_items.expediente_id
         and (
           (select public.has_module('expedientes', false))
           or (select public.has_module('printing', false))
         )
    )
  );

-- INSERT/UPDATE/DELETE: expedientes edit, only while expediente is in editable state
create policy expediente_items_insert on public.expediente_items
  for insert to authenticated
  with check (
    (select public.has_module('expedientes', true))
    and exists (
      select 1
        from public.expedientes e
       where e.id = expediente_items.expediente_id
         and e.status in ('draft','corrections_needed')
    )
  );

create policy expediente_items_update on public.expediente_items
  for update to authenticated
  using (
    (select public.has_module('expedientes', true))
    and exists (
      select 1
        from public.expedientes e
       where e.id = expediente_items.expediente_id
         and e.status in ('draft','corrections_needed')
    )
  )
  with check (
    (select public.has_module('expedientes', true))
    and exists (
      select 1
        from public.expedientes e
       where e.id = expediente_items.expediente_id
         and e.status in ('draft','corrections_needed')
    )
  );

create policy expediente_items_delete on public.expediente_items
  for delete to authenticated
  using (
    (select public.has_module('expedientes', true))
    and exists (
      select 1
        from public.expedientes e
       where e.id = expediente_items.expediente_id
         and e.status in ('draft','corrections_needed')
    )
  );

-- ---------------------------------------------------------------------------
-- cover_renders
-- ---------------------------------------------------------------------------
create table public.cover_renders (
  id           uuid        primary key default gen_random_uuid(),
  case_id      uuid        not null references public.cases(id) on delete restrict,
  template_id  uuid        references public.cover_templates(id) on delete restrict,
  data         jsonb       not null,   -- values used when rendering
  pdf_path     text        not null,   -- bucket 'generated' (cover PDF)
  created_by   uuid        references public.staff_profiles(user_id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger set_updated_at_cover_renders
  before update on public.cover_renders
  for each row execute function public.set_updated_at();

alter table public.cover_renders enable row level security;

-- SELECT: expedientes module only (client never sees loose covers)
create policy cover_renders_select on public.cover_renders
  for select to authenticated
  using ((select public.has_module('expedientes', false)));

-- INSERT: expedientes module edit (also service_role for render job)
create policy cover_renders_insert on public.cover_renders
  for insert to authenticated
  with check (
    (select public.has_module('expedientes', true))
    and created_by = (select auth.uid())
  );

-- UPDATE/DELETE: denied (re-render creates a new row)
