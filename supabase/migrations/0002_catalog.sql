-- ============================================================
-- 0002_catalog.sql
-- Block: catalog (13 tables) — configurable services engine
-- Resolves legacy D1 (global phase enum) and D3 (4 form systems)
-- Depends on: 0001_identity
-- ============================================================

-- ── services ─────────────────────────────────────────────────────────────────
-- Note: entry_phase_id FK to service_phases is added after service_phases is created (FK cycle fix).
create table public.services (
  id                      uuid        primary key default gen_random_uuid(),
  org_id                  uuid        not null references public.orgs(id),
  slug                    text        not null unique,
  category                text        not null check (category in ('migratorio', 'empresarial', 'familiar')),
  label_i18n              jsonb       not null,
  description_i18n        jsonb,
  long_description_i18n   jsonb,
  benefits_i18n           jsonb,
  icon                    text        not null default 'doc',
  color                   text        not null default 'accent',
  is_active               boolean     not null default false,
  archived_at             timestamptz,
  is_public               boolean     not null default true,
  entry_parent_service_id uuid        references public.services(id),
  entry_phase_id          uuid,       -- FK added below after service_phases exists
  position                integer     not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.services is 'Configurable service catalog (replaces legacy phase enum D1). slug is the stable identifier.';

drop trigger if exists trg_services_updated_at on public.services;
create trigger trg_services_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- ── service_plans ─────────────────────────────────────────────────────────────
create table public.service_plans (
  id                       uuid    primary key default gen_random_uuid(),
  service_id               uuid    not null references public.services(id) on delete cascade,
  kind                     text    not null check (kind in ('self', 'with_lawyer')),
  price_cents              integer not null,
  currency                 char(3) not null default 'USD',
  requires_lawyer_validation boolean not null default false,
  default_installments     integer not null default 1,
  default_downpayment_cents integer,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (service_id, kind)
);
comment on table public.service_plans is 'Pricing plans per service (self vs with_lawyer).';

drop trigger if exists trg_service_plans_updated_at on public.service_plans;
create trigger trg_service_plans_updated_at
  before update on public.service_plans
  for each row execute function public.set_updated_at();

-- ── service_phases ─────────────────────────────────────────────────────────────
-- Replaces the legacy global phase enum (D1): phases are rows, not enum values.
create table public.service_phases (
  id                   uuid    primary key default gen_random_uuid(),
  service_id           uuid    not null references public.services(id) on delete cascade,
  slug                 text    not null,
  label_i18n           jsonb   not null,
  description_i18n     jsonb,
  client_explainer_i18n jsonb,
  position             integer not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (service_id, slug),
  unique (service_id, position) deferrable initially deferred
);
comment on table public.service_phases is 'Service phases as rows (not enum). Replaces legacy D1.';

drop trigger if exists trg_service_phases_updated_at on public.service_phases;
create trigger trg_service_phases_updated_at
  before update on public.service_phases
  for each row execute function public.set_updated_at();

-- Now add the FK for the services <-> service_phases cycle
alter table public.services
  add constraint services_entry_phase_fk
  foreign key (entry_phase_id)
  references public.service_phases(id);

-- ── service_phase_milestones ────────────────────────────────────────────────────
create table public.service_phase_milestones (
  id               uuid    primary key default gen_random_uuid(),
  service_phase_id uuid    not null references public.service_phases(id) on delete cascade,
  slug             text    not null,
  label_i18n       jsonb   not null,
  description_i18n jsonb,
  glossary_i18n    jsonb,
  icon             text    not null default 'route',
  position         integer not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (service_phase_id, slug),
  unique (service_phase_id, position) deferrable initially deferred
);
comment on table public.service_phase_milestones is 'Client-visible milestones within a phase ("Mi proceso"). Finer grain than phase.';

drop trigger if exists trg_service_phase_milestones_updated_at on public.service_phase_milestones;
create trigger trg_service_phase_milestones_updated_at
  before update on public.service_phase_milestones
  for each row execute function public.set_updated_at();

-- ── phase_appointment_policies ─────────────────────────────────────────────────
-- 1:1 with service_phases (PK = service_phase_id)
create table public.phase_appointment_policies (
  service_phase_id  uuid    primary key references public.service_phases(id) on delete cascade,
  appointment_count integer not null default 1,
  duration_minutes  integer not null default 30,
  kind              text    not null default 'video' check (kind in ('video', 'phone', 'presencial')),
  updated_by        uuid    references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.phase_appointment_policies is 'Default appointment policy per phase. Vanessa is the functional owner (RF-VAN).';

drop trigger if exists trg_phase_appointment_policies_updated_at on public.phase_appointment_policies;
create trigger trg_phase_appointment_policies_updated_at
  before update on public.phase_appointment_policies
  for each row execute function public.set_updated_at();

-- ── required_document_types ────────────────────────────────────────────────────
create table public.required_document_types (
  id                    uuid    primary key default gen_random_uuid(),
  service_phase_id      uuid    not null references public.service_phases(id) on delete restrict,
  slug                  text    not null,
  label_i18n            jsonb   not null,
  help_i18n             jsonb,
  category_i18n         jsonb,
  is_required           boolean not null default true,
  is_per_party          boolean not null default false,
  party_roles           text[],
  ai_extract            boolean not null default false,
  extraction_schema     jsonb,
  requires_translation  boolean not null default false,
  requires_certified_copy boolean not null default false,
  position              integer not null default 0,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (service_phase_id, slug)
);
comment on table public.required_document_types is 'Document requirements per phase (catalog config). Replaces legacy other_*_documents cowildcards.';

drop trigger if exists trg_required_document_types_updated_at on public.required_document_types;
create trigger trg_required_document_types_updated_at
  before update on public.required_document_types
  for each row execute function public.set_updated_at();

-- ── form_definitions ──────────────────────────────────────────────────────────
-- Single form system replacing legacy D3 (4 systems)
create table public.form_definitions (
  id               uuid    primary key default gen_random_uuid(),
  service_phase_id uuid    not null references public.service_phases(id) on delete restrict,
  slug             text    not null,
  kind             text    not null check (kind in ('ai_letter', 'pdf_automation')),
  label_i18n       jsonb   not null,
  description_i18n jsonb,
  filled_by        text    not null default 'client' check (filled_by in ('client', 'staff', 'both')),
  is_per_party     boolean not null default false,
  party_roles      text[],
  position         integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (service_phase_id, slug)
);
comment on table public.form_definitions is 'Unified form system (replaces 4 legacy systems D3). Supports ai_letter and pdf_automation kinds.';

drop trigger if exists trg_form_definitions_updated_at on public.form_definitions;
create trigger trg_form_definitions_updated_at
  before update on public.form_definitions
  for each row execute function public.set_updated_at();

-- ── form_automation_versions ───────────────────────────────────────────────────
create table public.form_automation_versions (
  id                 uuid    primary key default gen_random_uuid(),
  form_definition_id uuid    not null references public.form_definitions(id) on delete cascade,
  version            integer not null,
  source_pdf_path    text    not null,
  detected_fields    jsonb   not null default '[]',
  status             text    not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at       timestamptz,
  created_by         uuid    references public.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (form_definition_id, version)
);
comment on table public.form_automation_versions is 'Versioned PDF automation definitions. At most 1 published per form_definition (enforced by partial unique index).';

-- Partial unique index: at most 1 published version per form_definition
create unique index form_automation_versions_one_published_idx
  on public.form_automation_versions(form_definition_id)
  where status = 'published';

drop trigger if exists trg_form_automation_versions_updated_at on public.form_automation_versions;
create trigger trg_form_automation_versions_updated_at
  before update on public.form_automation_versions
  for each row execute function public.set_updated_at();

-- ── form_question_groups ───────────────────────────────────────────────────────
create table public.form_question_groups (
  id                   uuid    primary key default gen_random_uuid(),
  automation_version_id uuid   not null references public.form_automation_versions(id) on delete cascade,
  title_i18n           jsonb   not null,
  position             integer not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (automation_version_id, position) deferrable initially deferred
);
comment on table public.form_question_groups is 'Question groups within a form automation version (AI-assisted segmentation, editable).';

drop trigger if exists trg_form_question_groups_updated_at on public.form_question_groups;
create trigger trg_form_question_groups_updated_at
  before update on public.form_question_groups
  for each row execute function public.set_updated_at();

-- ── form_questions ────────────────────────────────────────────────────────────
create table public.form_questions (
  id             uuid    primary key default gen_random_uuid(),
  group_id       uuid    not null references public.form_question_groups(id) on delete cascade,
  question_i18n  jsonb   not null,
  help_i18n      jsonb,
  field_type     text    not null check (field_type in ('text', 'number', 'date', 'checkbox', 'select', 'textarea')),
  options        jsonb,
  pdf_field_name text,
  source         text    not null default 'client_answer'
                   check (source in ('client_answer', 'document_extraction', 'generation_output', 'profile')),
  source_ref     jsonb,
  is_required    boolean not null default true,
  position       integer not null,
  validation     jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (group_id, position) deferrable initially deferred
);
comment on table public.form_questions is 'Individual questions mapped to AcroForm PDF fields or AI generation outputs.';

drop trigger if exists trg_form_questions_updated_at on public.form_questions;
create trigger trg_form_questions_updated_at
  before update on public.form_questions
  for each row execute function public.set_updated_at();

-- ── ai_datasets ───────────────────────────────────────────────────────────────
create table public.ai_datasets (
  id          uuid    primary key default gen_random_uuid(),
  org_id      uuid    not null references public.orgs(id),
  name        text    not null,
  purpose     text,
  source_kind text    not null default 'manual' check (source_kind in ('eoir', 'uscis', 'court_public', 'manual')),
  is_active   boolean not null default true,
  created_by  uuid    references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.ai_datasets is 'AI training/context datasets (EOIR/USCIS case examples). Used by ai_generation_configs.';

drop trigger if exists trg_ai_datasets_updated_at on public.ai_datasets;
create trigger trg_ai_datasets_updated_at
  before update on public.ai_datasets
  for each row execute function public.set_updated_at();

-- ── ai_dataset_items ──────────────────────────────────────────────────────────
create table public.ai_dataset_items (
  id          uuid    primary key default gen_random_uuid(),
  dataset_id  uuid    not null references public.ai_datasets(id) on delete cascade,
  title       text    not null,
  jurisdiction text,
  outcome     text,
  content     text,
  file_path   text,
  tags        text[]  not null default '{}',
  token_count integer,
  added_by    uuid    references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.ai_dataset_items is 'Individual case examples or documents within an AI dataset.';

drop trigger if exists trg_ai_dataset_items_updated_at on public.ai_dataset_items;
create trigger trg_ai_dataset_items_updated_at
  before update on public.ai_dataset_items
  for each row execute function public.set_updated_at();

-- ── ai_generation_configs ─────────────────────────────────────────────────────
-- 1:1 with form_definitions (PK = form_definition_id)
create table public.ai_generation_configs (
  form_definition_id    uuid    primary key references public.form_definitions(id) on delete cascade,
  system_prompt         text    not null,
  input_document_slugs  text[]  not null default '{}',
  input_form_slugs      text[]  not null default '{}',
  dataset_id            uuid    references public.ai_datasets(id),
  model                 text    not null default 'claude-fable-5',
  max_output_tokens     integer not null default 32000,
  output_format         text    not null default 'pdf' check (output_format in ('pdf', 'docx', 'md')),
  output_language       text    not null default 'en' check (output_language in ('es', 'en', 'both')),
  updated_by            uuid    references public.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
comment on table public.ai_generation_configs is 'Generation config for ai_letter form definitions. 1:1 with form_definitions.';

drop trigger if exists trg_ai_generation_configs_updated_at on public.ai_generation_configs;
create trigger trg_ai_generation_configs_updated_at
  before update on public.ai_generation_configs
  for each row execute function public.set_updated_at();

-- ── RLS: enable on all catalog tables ────────────────────────────────────────
alter table public.services                  enable row level security;
alter table public.service_plans             enable row level security;
alter table public.service_phases            enable row level security;
alter table public.service_phase_milestones  enable row level security;
alter table public.phase_appointment_policies enable row level security;
alter table public.required_document_types   enable row level security;
alter table public.form_definitions          enable row level security;
alter table public.form_automation_versions  enable row level security;
alter table public.form_question_groups      enable row level security;
alter table public.form_questions            enable row level security;
alter table public.ai_datasets               enable row level security;
alter table public.ai_dataset_items          enable row level security;
alter table public.ai_generation_configs     enable row level security;

-- ── Policies: services ────────────────────────────────────────────────────────
-- SELECT: catalog editor sees everything; others see active+non-archived;
--         clients only see is_public services
create policy services_select on public.services
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (select public.has_module('catalog', false))
      or (
        is_active
        and archived_at is null
        and (
          (select public.is_staff())
          or (is_public and (select public.is_client()))
        )
      )
    )
  );

-- INSERT/UPDATE: catalog editor only
create policy services_insert on public.services
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('catalog', true))
  );

create policy services_update on public.services
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('catalog', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('catalog', true))
  );
-- DELETE: denied (archive via archived_at)

-- ── Policies: service_plans ───────────────────────────────────────────────────
create policy service_plans_select on public.service_plans
  for select to authenticated
  using (
    exists (
      select 1 from public.services s
       where s.id = service_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null and is_active)
         )
    )
  );

create policy service_plans_insert on public.service_plans
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_plans_update on public.service_plans
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );
-- DELETE: denied (deactivate with is_active)

-- ── Policies: service_phases ──────────────────────────────────────────────────
create policy service_phases_select on public.service_phases
  for select to authenticated
  using (
    exists (
      select 1 from public.services s
       where s.id = service_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

create policy service_phases_insert on public.service_phases
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_phases_update on public.service_phases
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );
-- DELETE: denied (historical case references)

-- ── Policies: service_phase_milestones ────────────────────────────────────────
create policy service_phase_milestones_select on public.service_phase_milestones
  for select to authenticated
  using (
    exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

create policy service_phase_milestones_insert on public.service_phase_milestones
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_phase_milestones_update on public.service_phase_milestones
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );
-- DELETE: denied (is_active=false pattern)

-- ── Policies: phase_appointment_policies ──────────────────────────────────────
create policy phase_appt_policies_select on public.phase_appointment_policies
  for select to authenticated
  using (
    exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null)
         )
    )
  );

-- UPDATE: catalog editor (1:1 policy, replaceable)
create policy phase_appt_policies_update on public.phase_appointment_policies
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy phase_appt_policies_insert on public.phase_appointment_policies
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy phase_appt_policies_delete on public.phase_appointment_policies
  for delete to authenticated
  using ( (select public.has_module('catalog', true)) );

-- ── Policies: required_document_types ────────────────────────────────────────
create policy required_doc_types_select on public.required_document_types
  for select to authenticated
  using (
    exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null and is_active)
         )
    )
  );

create policy required_doc_types_insert on public.required_document_types
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy required_doc_types_update on public.required_document_types
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );
-- DELETE: denied (is_active=false)

-- ── Policies: form_definitions ────────────────────────────────────────────────
create policy form_definitions_select on public.form_definitions
  for select to authenticated
  using (
    exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or (s.is_active and s.archived_at is null and is_active)
         )
    )
  );

create policy form_definitions_insert on public.form_definitions
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy form_definitions_update on public.form_definitions
  for update to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.service_phases ph
      join public.services s on s.id = ph.service_id
       where ph.id = service_phase_id and s.org_id = (select public.auth_org_id())
    )
  );
-- DELETE: denied (is_active=false)

-- ── Policies: form_automation_versions ───────────────────────────────────────
create policy form_automation_versions_select on public.form_automation_versions
  for select to authenticated
  using (
    (select public.has_module('catalog', false))
    or (
      status = 'published'
      and exists (
        select 1 from public.form_definitions fd
        join public.service_phases ph on ph.id = fd.service_phase_id
        join public.services s on s.id = ph.service_id
         where fd.id = form_definition_id
           and s.org_id = (select public.auth_org_id())
      )
    )
  );

create policy form_automation_versions_insert on public.form_automation_versions
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy form_automation_versions_update on public.form_automation_versions
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );
-- DELETE: denied (status='archived')

-- ── Policies: form_question_groups ────────────────────────────────────────────
create policy form_question_groups_select on public.form_question_groups
  for select to authenticated
  using (
    exists (
      select 1 from public.form_automation_versions fav
      join public.form_definitions fd on fd.id = fav.form_definition_id
      join public.service_phases ph on ph.id = fd.service_phase_id
      join public.services s on s.id = ph.service_id
       where fav.id = automation_version_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or fav.status = 'published'
         )
    )
  );

create policy form_question_groups_insert on public.form_question_groups
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy form_question_groups_update on public.form_question_groups
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );

create policy form_question_groups_delete on public.form_question_groups
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.form_automation_versions fav
       where fav.id = automation_version_id and fav.status = 'draft'
    )
  );

-- ── Policies: form_questions ──────────────────────────────────────────────────
create policy form_questions_select on public.form_questions
  for select to authenticated
  using (
    exists (
      select 1 from public.form_question_groups grp
      join public.form_automation_versions fav on fav.id = grp.automation_version_id
      join public.form_definitions fd on fd.id = fav.form_definition_id
      join public.service_phases ph on ph.id = fd.service_phase_id
      join public.services s on s.id = ph.service_id
       where grp.id = group_id
         and s.org_id = (select public.auth_org_id())
         and (
           (select public.has_module('catalog', false))
           or fav.status = 'published'
         )
    )
  );

create policy form_questions_insert on public.form_questions
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy form_questions_update on public.form_questions
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );

create policy form_questions_delete on public.form_questions
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.form_question_groups grp
      join public.form_automation_versions fav on fav.id = grp.automation_version_id
       where grp.id = group_id and fav.status = 'draft'
    )
  );

-- ── Policies: ai_datasets ─────────────────────────────────────────────────────
create policy ai_datasets_select on public.ai_datasets
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('datasets', false))
  );

create policy ai_datasets_insert on public.ai_datasets
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('datasets', true))
  );

create policy ai_datasets_update on public.ai_datasets
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('datasets', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('datasets', true))
  );
-- DELETE: denied (is_active=false; referenced by ai_generation_configs)

-- ── Policies: ai_dataset_items ────────────────────────────────────────────────
create policy ai_dataset_items_select on public.ai_dataset_items
  for select to authenticated
  using (
    exists (
      select 1 from public.ai_datasets d
       where d.id = dataset_id and d.org_id = (select public.auth_org_id())
    )
    and (select public.has_module('datasets', false))
  );

create policy ai_dataset_items_insert on public.ai_dataset_items
  for insert to authenticated
  with check (
    (select public.has_module('datasets', true))
    and exists (
      select 1 from public.ai_datasets d
       where d.id = dataset_id and d.org_id = (select public.auth_org_id())
    )
  );

create policy ai_dataset_items_update on public.ai_dataset_items
  for update to authenticated
  using (
    (select public.has_module('datasets', true))
    and exists (
      select 1 from public.ai_datasets d
       where d.id = dataset_id and d.org_id = (select public.auth_org_id())
    )
  )
  with check (
    (select public.has_module('datasets', true))
    and exists (
      select 1 from public.ai_datasets d
       where d.id = dataset_id and d.org_id = (select public.auth_org_id())
    )
  );

create policy ai_dataset_items_delete on public.ai_dataset_items
  for delete to authenticated
  using (
    (select public.has_module('datasets', true))
    and exists (
      select 1 from public.ai_datasets d
       where d.id = dataset_id and d.org_id = (select public.auth_org_id())
    )
  );

-- ── Policies: ai_generation_configs ──────────────────────────────────────────
-- system_prompt is sensitive; clients never read this; generation jobs use service_role
create policy ai_generation_configs_select on public.ai_generation_configs
  for select to authenticated
  using ( (select public.has_module('catalog', false)) );

create policy ai_generation_configs_insert on public.ai_generation_configs
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy ai_generation_configs_update on public.ai_generation_configs
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );
-- DELETE: denied (1:1 config with form_definition)
