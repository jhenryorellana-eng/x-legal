-- ============================================================
-- 0004_cases.sql
-- Block: cases (12 tables) — core operational module
-- Resolves legacy D2 (minors in JSONB), D6 (single timeline)
-- Depends on: 0001, 0002, 0003
-- ============================================================

-- ── Case number sequence helper ────────────────────────────────────────────────
-- next_case_number(org_uuid): generates ULP-YYYY-NNNN sequential numbers per org per year.
-- Uses an internal counter table (no Postgres SEQUENCE per org/year needed at V2.0 scale).

create table public._case_number_counters (
  org_id     uuid    not null references public.orgs(id),
  year       integer not null,
  last_seq   integer not null default 0,
  primary key (org_id, year)
);
comment on table public._case_number_counters is 'Internal counter for next_case_number(). Not exposed via RLS.';

-- _case_number_counters does NOT need RLS for authenticated users (internal use only, service_role)
alter table public._case_number_counters enable row level security;
-- No policies: deny-by-default for authenticated. Only service_role (BYPASSRLS) accesses it.

create or replace function public.next_case_number(org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  yr   integer := extract(year from now());
  seq  integer;
begin
  insert into public._case_number_counters (org_id, year, last_seq)
  values (org, yr, 1)
  on conflict (org_id, year) do update
    set last_seq = public._case_number_counters.last_seq + 1
  returning last_seq into seq;

  return 'ULP-' || yr::text || '-' || lpad(seq::text, 4, '0');
end;
$$;

grant execute on function public.next_case_number(uuid) to authenticated;

-- ── cases ─────────────────────────────────────────────────────────────────────
create table public.cases (
  id                       uuid    primary key default gen_random_uuid(),
  org_id                   uuid    not null references public.orgs(id),
  case_number              text    not null unique,
  service_id               uuid    not null references public.services(id),
  service_plan_id          uuid    not null references public.service_plans(id),
  current_phase_id         uuid    references public.service_phases(id),
  status                   text    not null default 'payment_pending'
                             check (status in (
                               'payment_pending', 'active', 'in_validation',
                               'ready_for_delivery', 'delivered', 'completed',
                               'cancelled', 'on_hold'
                             )),
  primary_client_id        uuid    not null references public.users(id),
  assigned_paralegal_id    uuid    references public.staff_profiles(user_id),
  assigned_sales_id        uuid    references public.staff_profiles(user_id),
  opened_at                timestamptz,
  completed_at             timestamptz,
  rebooking_blocked_until  timestamptz,
  internal_note            text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
comment on table public.cases is 'Core case entity. case_number = ULP-YYYY-NNNN (next_case_number()). status drives the operational workflow.';
comment on column public.cases.rebooking_blocked_until is 'Penalty: late cancellation blocks rescheduling for 7 days. Staff can lift it.';

-- Trigram index for case number search by staff
create index cases_case_number_trgm_idx on public.cases using gin(case_number gin_trgm_ops);

drop trigger if exists trg_cases_updated_at on public.cases;
create trigger trg_cases_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

-- ── case_members ─────────────────────────────────────────────────────────────
-- Client-side RLS base: a client can only see data for cases they are a member of
create table public.case_members (
  id          uuid    primary key default gen_random_uuid(),
  case_id     uuid    not null references public.cases(id) on delete cascade,
  user_id     uuid    not null references public.users(id) on delete cascade,
  access_role text    not null default 'owner' check (access_role in ('owner', 'viewer')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (case_id, user_id)
);
comment on table public.case_members is 'RLS base for client access. A client sees ONLY their case_members cases.';

drop trigger if exists trg_case_members_updated_at on public.case_members;
create trigger trg_case_members_updated_at
  before update on public.case_members
  for each row execute function public.set_updated_at();

-- ── is_case_member helper (now that case_members exists) ──────────────────────
create or replace function public.is_case_member(case_uuid uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.case_members cm
      join public.users u on u.id = cm.user_id
     where cm.case_id = case_uuid
       and cm.user_id = (select auth.uid())
       and u.is_active
  )
$$;

grant execute on function public.is_case_member(uuid) to authenticated;

-- ── case_parties ─────────────────────────────────────────────────────────────
-- Resolves D2: parties are rows, not JSON
create table public.case_parties (
  id               uuid    primary key default gen_random_uuid(),
  case_id          uuid    not null references public.cases(id) on delete cascade,
  person_record_id uuid    references public.person_records(id),
  user_id          uuid    references public.users(id),
  party_role       text    not null check (party_role in (
                     'beneficiary', 'petitioner', 'minor', 'spouse',
                     'guardian', 'witness', 'member', 'other'
                   )),
  position         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (person_record_id is not null or user_id is not null)
);
comment on table public.case_parties is 'Case parties as rows (replaces legacy D2 minors/spouse JSONB). Either person_record_id or user_id must be set.';

drop trigger if exists trg_case_parties_updated_at on public.case_parties;
create trigger trg_case_parties_updated_at
  before update on public.case_parties
  for each row execute function public.set_updated_at();

-- ── case_phase_history ────────────────────────────────────────────────────────
create table public.case_phase_history (
  id         uuid    primary key default gen_random_uuid(),
  case_id    uuid    not null references public.cases(id) on delete cascade,
  phase_id   uuid    not null references public.service_phases(id),
  entered_at timestamptz not null default now(),
  entered_by uuid    references public.users(id),
  note       text,
  created_at timestamptz not null default now()
  -- No updated_at: history is immutable (trigger N3 prevents UPDATE/DELETE)
);
comment on table public.case_phase_history is 'Immutable log of phase transitions. Trigger enforces no UPDATE/DELETE.';

-- ── case_documents ────────────────────────────────────────────────────────────
create table public.case_documents (
  id                       uuid    primary key default gen_random_uuid(),
  case_id                  uuid    not null references public.cases(id) on delete cascade,
  required_document_type_id uuid   references public.required_document_types(id),
  party_id                 uuid    references public.case_parties(id),
  uploaded_by              uuid    not null references public.users(id),
  storage_path             text    not null,
  original_filename        text    not null,
  mime_type                text    not null,
  size_bytes               integer not null,
  status                   text    not null default 'uploaded'
                             check (status in ('uploaded', 'approved', 'rejected', 'replaced')),
  rejection_reason_i18n    jsonb,
  reviewed_by              uuid    references public.staff_profiles(user_id),
  reviewed_at              timestamptz,
  correction_due_at        timestamptz,
  replaces_document_id     uuid    references public.case_documents(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
comment on table public.case_documents is 'Documents uploaded by clients/staff against requirements. required_document_type_id=null means free upload.';
comment on column public.case_documents.replaces_document_id is 'Self-referential chain of re-submissions.';

-- Composite index for case document listings
create index case_documents_case_status_idx on public.case_documents(case_id, status);
create index case_documents_case_req_party_idx on public.case_documents(case_id, required_document_type_id, party_id);

-- Partial index: global review queue for Diana (status='uploaded')
create index if not exists case_documents_review_queue_idx
  on public.case_documents(status, created_at)
  where status = 'uploaded';

drop trigger if exists trg_case_documents_updated_at on public.case_documents;
create trigger trg_case_documents_updated_at
  before update on public.case_documents
  for each row execute function public.set_updated_at();

-- ── document_extractions ──────────────────────────────────────────────────────
create table public.document_extractions (
  id               uuid    primary key default gen_random_uuid(),
  case_document_id uuid    not null unique references public.case_documents(id) on delete cascade,
  model            text    not null,
  status           text    not null default 'pending'
                     check (status in ('pending', 'completed', 'failed')),
  payload          jsonb,
  raw_text         text,
  error            text,
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric(8,4),
  completed_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.document_extractions is 'Gemini extraction pipeline results per document. Written only by service_role (job).';

drop trigger if exists trg_document_extractions_updated_at on public.document_extractions;
create trigger trg_document_extractions_updated_at
  before update on public.document_extractions
  for each row execute function public.set_updated_at();

-- ── case_form_responses ───────────────────────────────────────────────────────
create table public.case_form_responses (
  id                     uuid    primary key default gen_random_uuid(),
  case_id                uuid    not null references public.cases(id) on delete cascade,
  form_definition_id     uuid    not null references public.form_definitions(id),
  automation_version_id  uuid    references public.form_automation_versions(id),
  party_id               uuid    references public.case_parties(id),
  answers                jsonb   not null default '{}',
  status                 text    not null default 'draft'
                           check (status in ('draft', 'submitted', 'approved')),
  filled_pdf_path        text,
  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (case_id, form_definition_id, party_id)
  -- The above unique treats NULL party_id as distinct; for non-party forms we use a partial unique index:
);
comment on table public.case_form_responses is 'Client/staff answers to form_questions. status=approved gates PDF generation (filled_by=client). Trigger N3 blocks client self-approval.';

-- Partial unique index: for non-per-party forms (party_id IS NULL), only one response per case+form
create unique index case_form_responses_no_party_unique_idx
  on public.case_form_responses(case_id, form_definition_id)
  where party_id is null;

drop trigger if exists trg_case_form_responses_updated_at on public.case_form_responses;
create trigger trg_case_form_responses_updated_at
  before update on public.case_form_responses
  for each row execute function public.set_updated_at();

-- ── ai_generation_runs ────────────────────────────────────────────────────────
create table public.ai_generation_runs (
  id                            uuid    primary key default gen_random_uuid(),
  case_id                       uuid    not null references public.cases(id) on delete cascade,
  form_definition_id            uuid    not null references public.form_definitions(id),
  config_snapshot               jsonb   not null,
  party_id                      uuid    references public.case_parties(id),
  status                        text    not null default 'queued'
                                  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  version                       integer not null default 1,
  output_path                   text,
  output_text                   text,
  output_summary                text,
  progress                      jsonb,
  model                         text,
  input_tokens                  integer,
  output_tokens                 integer,
  cost_usd                      numeric(8,4),
  cache_read_input_tokens       integer,
  cache_creation_input_tokens   integer,
  error                         text,
  is_test                       boolean not null default false,
  requested_by                  uuid    references public.users(id),
  completed_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (case_id, form_definition_id, party_id, version)
);
comment on table public.ai_generation_runs is 'Versioned AI letter generation runs. is_test=true excluded from metrics. progress supports chunking checkpoints.';

drop trigger if exists trg_ai_generation_runs_updated_at on public.ai_generation_runs;
create trigger trg_ai_generation_runs_updated_at
  before update on public.ai_generation_runs
  for each row execute function public.set_updated_at();

-- ── case_overrides ────────────────────────────────────────────────────────────
create table public.case_overrides (
  id               uuid    primary key default gen_random_uuid(),
  case_id          uuid    not null references public.cases(id) on delete cascade,
  service_phase_id uuid    not null references public.service_phases(id),
  appointment_count integer,
  duration_minutes  integer,
  set_by           uuid    references public.staff_profiles(user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (case_id, service_phase_id)
);
comment on table public.case_overrides is 'Per-case appointment policy overrides. Vanessa is functional owner (calendar module, RF-VAN).';

drop trigger if exists trg_case_overrides_updated_at on public.case_overrides;
create trigger trg_case_overrides_updated_at
  before update on public.case_overrides
  for each row execute function public.set_updated_at();

-- ── case_requirement_overrides ────────────────────────────────────────────────
create table public.case_requirement_overrides (
  id                       uuid    primary key default gen_random_uuid(),
  case_id                  uuid    not null references public.cases(id) on delete cascade,
  required_document_type_id uuid   references public.required_document_types(id),
  custom_label_i18n        jsonb,
  party_id                 uuid    references public.case_parties(id),
  is_hidden                boolean not null default false,
  is_required              boolean,
  created_by               uuid    references public.staff_profiles(user_id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (case_id, required_document_type_id, party_id)
);
comment on table public.case_requirement_overrides is 'Per-case document requirement adjustments by staff. required_document_type_id=null means custom requirement for this case only.';

drop trigger if exists trg_case_requirement_overrides_updated_at on public.case_requirement_overrides;
create trigger trg_case_requirement_overrides_updated_at
  before update on public.case_requirement_overrides
  for each row execute function public.set_updated_at();

-- ── document_translations ─────────────────────────────────────────────────────
create table public.document_translations (
  id               uuid    primary key default gen_random_uuid(),
  case_document_id uuid    not null references public.case_documents(id) on delete cascade,
  direction        text    not null check (direction in ('es-en', 'en-es')),
  status           text    not null default 'processing'
                     check (status in ('processing', 'completed', 'failed')),
  translated_pdf_path text,
  translated_text     text,
  model               text,
  input_tokens        integer,
  output_tokens       integer,
  cost_usd            numeric(8,4),
  requested_by        uuid    references public.users(id),
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (case_document_id, direction)  -- cache: one translation per document per direction
);
comment on table public.document_translations is 'Gemini document translations with caching (one per direction per document).';

drop trigger if exists trg_document_translations_updated_at on public.document_translations;
create trigger trg_document_translations_updated_at
  before update on public.document_translations
  for each row execute function public.set_updated_at();

-- ── case_timeline ─────────────────────────────────────────────────────────────
-- D6: unified case activity log (client-visible + team log in single table)
create table public.case_timeline (
  id                uuid    primary key default gen_random_uuid(),
  case_id           uuid    not null references public.cases(id) on delete cascade,
  event_type        text    not null,
  icon              text    not null default 'info',
  color             text    not null default 'accent',
  title_i18n        jsonb   not null,
  body_i18n         jsonb,
  actor_kind        text    not null check (actor_kind in ('client', 'team', 'system')),
  actor_user_id     uuid    references public.users(id),
  visible_to_client boolean not null default true,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
  -- No updated_at: timeline is immutable (trigger N3 prevents UPDATE/DELETE)
);
comment on table public.case_timeline is 'Immutable unified case activity log. visible_to_client filters what client sees in their timeline.';
comment on column public.case_timeline.event_type is 'document.uploaded, phase.advanced, payment.received, appointment.booked, message.sent, generation.completed, appointment.no_show, expediente.printed...';

create index case_timeline_case_occurred_idx on public.case_timeline(case_id, occurred_at desc);

-- ── Deferred FKs from 0003 ────────────────────────────────────────────────────
-- Now that cases exists, add the FK constraints left pending in 0003:

alter table public.leads
  add constraint leads_won_case_fk
  foreign key (won_case_id)
  references public.cases(id);

alter table public.staff_tasks
  add constraint staff_tasks_case_fk
  foreign key (case_id)
  references public.cases(id);

-- ── RLS: enable on all tables in this block ───────────────────────────────────
alter table public.cases                      enable row level security;
alter table public.case_members               enable row level security;
alter table public.case_parties               enable row level security;
alter table public.case_phase_history         enable row level security;
alter table public.case_documents             enable row level security;
alter table public.document_extractions       enable row level security;
alter table public.case_form_responses        enable row level security;
alter table public.ai_generation_runs         enable row level security;
alter table public.case_overrides             enable row level security;
alter table public.case_requirement_overrides enable row level security;
alter table public.document_translations      enable row level security;
alter table public.case_timeline              enable row level security;

-- ── Policies: cases ───────────────────────────────────────────────────────────
create policy cases_select on public.cases
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (select public.is_case_member(id))
      or (select public.has_module('cases', false))
    )
  );

create policy cases_insert on public.cases
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('cases', true))
  );

-- UPDATE: staff with cases module only (client never updates cases directly)
create policy cases_update on public.cases
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('cases', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('cases', true))
  );
-- DELETE: denied (status='cancelled')

-- ── Policies: case_members ────────────────────────────────────────────────────
-- SELECT: own memberships (client lists their cases) OR staff cases module
create policy case_members_select on public.case_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('cases', false))
  );

-- INSERT/UPDATE/DELETE: admin only (exceptional viewer management;
-- normal case creation uses service_role via createCaseFromContract)
create policy case_members_insert on public.case_members
  for insert to authenticated
  with check ( (select public.is_admin()) );

create policy case_members_update on public.case_members
  for update to authenticated
  using      ( (select public.is_admin()) )
  with check ( (select public.is_admin()) );

create policy case_members_delete on public.case_members
  for delete to authenticated
  using ( (select public.is_admin()) );

-- ── Policies: case_parties ────────────────────────────────────────────────────
create policy case_parties_select on public.case_parties
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

create policy case_parties_insert on public.case_parties
  for insert to authenticated
  with check ( (select public.has_module('cases', true)) );

create policy case_parties_update on public.case_parties
  for update to authenticated
  using      ( (select public.has_module('cases', true)) )
  with check ( (select public.has_module('cases', true)) );

create policy case_parties_delete on public.case_parties
  for delete to authenticated
  using (
    (select public.has_module('cases', true))
    and not exists (
      select 1 from public.case_documents d where d.party_id = case_parties.id
    )
  );

-- ── Policies: case_phase_history ──────────────────────────────────────────────
-- Client can see their own case history (the path they walked)
create policy case_phase_history_select on public.case_phase_history
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

create policy case_phase_history_insert on public.case_phase_history
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and entered_by = (select auth.uid())
  );
-- UPDATE/DELETE: denied (immutable history; trigger N3)

-- ── Policies: case_documents ──────────────────────────────────────────────────
create policy case_documents_select on public.case_documents
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

-- Client uploads their own documents to their own cases
create policy case_documents_insert_client on public.case_documents
  for insert to authenticated
  with check (
    (select public.is_case_member(case_id))
    and uploaded_by = (select auth.uid())
  );

-- Staff uploads on behalf of case
create policy case_documents_insert_staff on public.case_documents
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and uploaded_by = (select auth.uid())
  );

-- UPDATE: staff reviews (approve/reject/replace); re-upload by client is a new INSERT
create policy case_documents_update on public.case_documents
  for update to authenticated
  using      ( (select public.has_module('cases', true)) )
  with check ( (select public.has_module('cases', true)) );
-- DELETE: denied (status='replaced')

-- ── Policies: document_extractions ────────────────────────────────────────────
-- Only staff cases module (payload is technical pipeline data; costs hidden from client)
create policy document_extractions_select on public.document_extractions
  for select to authenticated
  using (
    exists (
      select 1 from public.case_documents d
       where d.id = case_document_id
         and (select public.has_module('cases', false))
    )
  );
-- INSERT/UPDATE/DELETE: service_role only (Gemini job)

-- ── Policies: case_form_responses ─────────────────────────────────────────────
create policy case_form_responses_select on public.case_form_responses
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

-- Client inserts draft responses for forms they fill
create policy case_form_responses_insert_client on public.case_form_responses
  for insert to authenticated
  with check (
    (select public.is_case_member(case_id))
    and status = 'draft'
    and exists (
      select 1 from public.form_definitions fd
       where fd.id = form_definition_id
         and fd.filled_by in ('client', 'both')
    )
  );

-- Staff inserts responses for any form
create policy case_form_responses_insert_staff on public.case_form_responses
  for insert to authenticated
  with check ( (select public.has_module('cases', true)) );

-- Client can edit draft and submit (not approve — trigger N3 enforces that)
create policy case_form_responses_update_client on public.case_form_responses
  for update to authenticated
  using  ( (select public.is_case_member(case_id)) and status = 'draft' )
  with check (
    (select public.is_case_member(case_id))
    and status in ('draft', 'submitted')
  );

create policy case_form_responses_update_staff on public.case_form_responses
  for update to authenticated
  using      ( (select public.has_module('cases', true)) )
  with check ( (select public.has_module('cases', true)) );
-- DELETE: denied

-- ── Policies: ai_generation_runs ─────────────────────────────────────────────
-- Only staff (prompt snapshots, costs; client receives output as a delivery, not by reading runs)
create policy ai_generation_runs_select on public.ai_generation_runs
  for select to authenticated
  using ( (select public.has_module('cases', false)) );

-- Staff enqueues; job updates (service_role)
create policy ai_generation_runs_insert on public.ai_generation_runs
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and requested_by = (select auth.uid())
    and status = 'queued'
  );
-- UPDATE/DELETE: service_role only (worker QStash: status/progress/output)

-- ── Policies: case_overrides ──────────────────────────────────────────────────
-- Client reads (needed for server to calculate remaining appointments for their phase)
create policy case_overrides_select on public.case_overrides
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('calendar', false))
    or (select public.has_module('cases', false))
  );

-- Vanessa (calendar module) is the functional owner of appointment overrides
create policy case_overrides_insert on public.case_overrides
  for insert to authenticated
  with check (
    (select public.has_module('calendar', true))
    and set_by = (select auth.uid())
  );

create policy case_overrides_update on public.case_overrides
  for update to authenticated
  using (
    (select public.has_module('calendar', true))
    and set_by = (select auth.uid())
  )
  with check (
    (select public.has_module('calendar', true))
    and set_by = (select auth.uid())
  );

create policy case_overrides_delete on public.case_overrides
  for delete to authenticated
  using ( (select public.has_module('calendar', true)) );

-- ── Policies: case_requirement_overrides ──────────────────────────────────────
-- Client reads to see effective checklist (catalog ± overrides)
create policy case_req_overrides_select on public.case_requirement_overrides
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

create policy case_req_overrides_insert on public.case_requirement_overrides
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and created_by = (select auth.uid())
  );

create policy case_req_overrides_update on public.case_requirement_overrides
  for update to authenticated
  using      ( (select public.has_module('cases', true)) )
  with check ( (select public.has_module('cases', true)) );

create policy case_req_overrides_delete on public.case_requirement_overrides
  for delete to authenticated
  using ( (select public.has_module('cases', true)) );

-- ── Policies: document_translations ──────────────────────────────────────────
create policy document_translations_select on public.document_translations
  for select to authenticated
  using (
    exists (
      select 1 from public.case_documents d
       where d.id = case_document_id
         and (
           (select public.is_case_member(d.case_id))
           or (select public.has_module('cases', false))
         )
    )
  );

-- Client or staff can request translation for documents within their scope
create policy document_translations_insert on public.document_translations
  for insert to authenticated
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1 from public.case_documents d
       where d.id = case_document_id
         and (
           (select public.is_case_member(d.case_id))
           or (select public.has_module('cases', true))
         )
    )
  );
-- UPDATE/DELETE: service_role only (job completes/fails; unique by direction provides caching)

-- ── Policies: case_timeline ───────────────────────────────────────────────────
-- Client sees only visible_to_client=true entries
create policy case_timeline_select_client on public.case_timeline
  for select to authenticated
  using (
    (select public.is_case_member(case_id)) and visible_to_client
  );

create policy case_timeline_select_staff on public.case_timeline
  for select to authenticated
  using ( (select public.has_module('cases', false)) );

-- Client inserts timeline events for their own actions
create policy case_timeline_insert_client on public.case_timeline
  for insert to authenticated
  with check (
    (select public.is_case_member(case_id))
    and actor_kind = 'client'
    and actor_user_id = (select auth.uid())
  );

-- Staff inserts team events
create policy case_timeline_insert_staff on public.case_timeline
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and actor_kind = 'team'
    and actor_user_id = (select auth.uid())
  );
-- UPDATE/DELETE: denied (immutable; trigger N3)
-- system events (actor_kind='system') are written by service_role

-- ── N3 integrity triggers (DOC-31 N3) ─────────────────────────────────────────
-- Immutability beyond RLS: also guards against service_role bugs.

create or replace function public.prevent_row_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable (operation: %)', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists case_phase_history_immutable on public.case_phase_history;
create trigger case_phase_history_immutable
  before update or delete on public.case_phase_history
  for each row execute function public.prevent_row_mutation();

drop trigger if exists case_timeline_immutable on public.case_timeline;
create trigger case_timeline_immutable
  before update or delete on public.case_timeline
  for each row execute function public.prevent_row_mutation();

-- case_form_responses: transition guard — only staff (or service_role, which has
-- no auth.uid()) may set status='approved'. Clients submit, never self-approve.
create or replace function public.enforce_form_response_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    if (select auth.uid()) is not null and not public.has_module('cases', true) then
      raise exception 'Only staff with cases module can approve a form response'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists case_form_responses_approval_guard on public.case_form_responses;
create trigger case_form_responses_approval_guard
  before update on public.case_form_responses
  for each row execute function public.enforce_form_response_approval();

-- ── person_records: recreate SELECT policy with the client branch ─────────────
-- The 0001 version only had the staff branch (case_parties/case_members did not
-- exist yet). Now that they do, the full DOC-31 policy applies: staff with cases
-- module OR client seeing persons linked to their own cases (minors/spouse).
drop policy if exists person_records_select on public.person_records;
create policy person_records_select on public.person_records
  for select to authenticated
  using (
    (org_id = (select public.auth_org_id()) and (select public.has_module('cases', false)))
    or exists (
      select 1 from public.case_parties cp
       where cp.person_record_id = person_records.id
         and (select public.is_case_member(cp.case_id))
    )
  );

-- ── Surface reduction (DOC-31 principle 7: anon executes NOTHING) ─────────────
revoke execute on function public.next_case_number(uuid) from public, anon;
revoke execute on function public.is_case_member(uuid) from public, anon;
revoke execute on function public.prevent_row_mutation() from public, anon, authenticated;
revoke execute on function public.enforce_form_response_approval() from public, anon, authenticated;
