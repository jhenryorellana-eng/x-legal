-- 0081_questionnaire_generation.sql
-- Ola 3 — Per-case AI questionnaire generation ("super-detailed questions").
--
-- The credible-fear questionnaire (and any future one) can be generated PER CASE
-- by AI: it reads the client's I-589 answers + uploaded documents and produces
-- deep, specific follow-up questions grounded in what THIS client actually lived.
--
-- Modeled as a per-case AI generation (like document_extractions/translations):
-- ai-engine is the single writer of case_questionnaire_instances; catalog owns
-- the config. NOT an ai_generation_run (that's the document-deliverable pipeline).
--
-- Two tables + one column. Additive, non-destructive.

-- ── questionnaire_generation_configs (1:1 with the questionnaire form_definition)
-- Owned by catalog. "How are THIS questionnaire's questions sourced?"
create table if not exists public.questionnaire_generation_configs (
  form_definition_id          uuid primary key
                                references public.form_definitions(id) on delete cascade,
  -- global  = fixed questions for everyone (current behavior)
  -- automatic = all questions AI-generated per case from the inputs
  -- hybrid  = fixed base questions ALWAYS + AI-generated follow-ups appended
  mode                        text not null default 'global'
                                check (mode in ('global','automatic','hybrid')),
  generation_prompt           text,                          -- brief for the question generator
  input_document_slugs        text[] not null default '{}',  -- docs read as context (declaracion-jurada, evidencias, parole-nta)
  input_form_slugs            text[] not null default '{}',   -- forms read as context (i-589 parts)
  prerequisite_form_slugs     text[] not null default '{}',   -- forms that MUST be complete before generating (blocking)
  prerequisite_document_slugs text[] not null default '{}',   -- docs that MUST be present before generating (blocking)
  target_question_count       integer,                        -- orienting target (e.g. 18)
  model                       text,                           -- whitelist GENERATION_MODELS; null = default
  hybrid_layout               text not null default 'append_group'
                                check (hybrid_layout in ('append_group','merge_by_topic')),
  auto_trigger                boolean not null default true,   -- generate automatically when prereqs are met
  allow_client_trigger        boolean not null default false,  -- expose a "generate my questions" button to the client
  on_new_evidence             text not null default 'flag'
                                check (on_new_evidence in ('never','flag','auto')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.questionnaire_generation_configs is
  'Ola 3: how a questionnaire form_definition sources its questions (global | automatic per-case AI | hybrid). 1:1 with form_definitions.';

drop trigger if exists trg_qn_gen_configs_updated_at on public.questionnaire_generation_configs;
create trigger trg_qn_gen_configs_updated_at
  before update on public.questionnaire_generation_configs
  for each row execute function public.set_updated_at();

-- ── case_questionnaire_instances (per-case generated questionnaire, ai-engine-owned)
create table if not exists public.case_questionnaire_instances (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.cases(id) on delete cascade,
  form_definition_id uuid not null references public.form_definitions(id),
  party_id           uuid references public.case_parties(id) on delete cascade,
  status             text not null default 'pending_prereqs'
                       check (status in ('pending_prereqs','queued','generating','ready','failed','stale')),
  version            integer not null default 1,
  is_current         boolean not null default true,
  mode               text not null,                 -- snapshot of the mode used to generate
  schema             jsonb,                          -- {groups:[{id,title_i18n,position,questions:[{id,question_i18n,...,condition}]}]}
  inputs_snapshot    jsonb,                          -- frozen resolved_inputs (I-589 + docs) used to generate
  model              text,
  input_tokens       integer,
  output_tokens      integer,
  cost_usd           numeric(10,4),
  error              text,
  generated_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.case_questionnaire_instances is
  'Ola 3: a per-case AI-generated questionnaire (schema of groups+questions). Single-writer: ai-engine. Read by cases.getFormForClient via service_role.';

-- Exactly one CURRENT instance per (case, form, party). NULLs are distinct in a
-- plain unique index, so coalesce the party to a zero-uuid to enforce the invariant
-- for case-level (null-party) questionnaires too.
create unique index if not exists case_qn_instance_current_uidx
  on public.case_questionnaire_instances (
    case_id, form_definition_id, coalesce(party_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where is_current;

drop trigger if exists trg_case_qn_instances_updated_at on public.case_questionnaire_instances;
create trigger trg_case_qn_instances_updated_at
  before update on public.case_questionnaire_instances
  for each row execute function public.set_updated_at();

-- ── case_form_responses: pin a response to the instance schema it was answered against
alter table public.case_form_responses
  add column if not exists questionnaire_instance_id uuid
    references public.case_questionnaire_instances(id);
comment on column public.case_form_responses.questionnaire_instance_id is
  'Ola 3: the per-case questionnaire instance whose schema this response was filled against (null for global/pdf_automation forms). Keeps answers↔question-labels consistent across regenerations.';

-- ── RLS
alter table public.questionnaire_generation_configs enable row level security;
alter table public.case_questionnaire_instances      enable row level security;

-- Config: catalog module (staff). Mirrors ai_generation_configs.
create policy qn_gen_configs_select on public.questionnaire_generation_configs
  for select to authenticated using ( (select public.has_module('catalog', false)) );
create policy qn_gen_configs_insert on public.questionnaire_generation_configs
  for insert to authenticated with check ( (select public.has_module('catalog', true)) );
create policy qn_gen_configs_update on public.questionnaire_generation_configs
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );

-- Instances: staff read (admin/legal panels); writes are service_role only (ai-engine
-- single-writer). The client never reads this directly — getFormForClient reads it
-- via service_role after requireCaseAccess and passes the schema as a prop. Mirrors
-- ai_generation_runs (staff-select, no authenticated write policy).
create policy case_qn_instances_select on public.case_questionnaire_instances
  for select to authenticated using ( (select public.has_module('cases', false)) );
