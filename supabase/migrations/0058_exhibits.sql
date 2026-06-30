-- =============================================================================
-- 0058_exhibits.sql
-- Automatic exhibits (anexos) for AI legal letters.
--
-- When a letter (e.g. the Credible-Fear asylum memorandum) is generated, the AI
-- already cites external sources in its final "Annexes / Index of Exhibits" table
-- (country conditions via web_search, federal jurisprudence from the dataset, plus
-- admin-curated baseline links). Each cited link must end up physically downloaded,
-- rendered to PDF, and bound into the expediente. This migration adds the durable
-- manifest of those exhibits, a per-domain circuit-breaker table for the fetch
-- pipeline, the admin config knobs on the letter, and the 'exhibit' item type so a
-- ready exhibit can be an ordered piece of the case file.
--
-- Owner module: exhibits (single writer; jobs write via service_role).
-- Staff-only (client never sees these), mirroring the expediente block (DOC-30 §8).
-- Depends on: 0004_cases.sql, 0008_expediente.sql, 0017_ai_engine_f4.sql,
--             0021_generation_engine_config.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- case_exhibits — one row per cited source captured from a generation run
-- ---------------------------------------------------------------------------
create table public.case_exhibits (
  id              uuid        primary key default gen_random_uuid(),
  case_id         uuid        not null references public.cases(id) on delete cascade,
  run_id          uuid        not null references public.ai_generation_runs(id) on delete cascade,
  source_kind     text        not null check (source_kind in (
                                'country_condition','jurisprudence','admin_curated','dataset'
                              )),
  cite_order      integer     not null,            -- order in the Annexes table (= legal order)
  exhibit_label   text,                            -- 'A-1','B-3'... (from the memo tabs; reassigned on assembly)
  source_url      text        not null,            -- original URL as cited
  canonical_url   text        not null,            -- normalized (no tracking/fragment/www)
  url_hash        text        not null,            -- sha256(canonical_url) → dedup + content cache key
  title           text,
  publisher       text,                            -- author / source_name / court
  published_date  text,                            -- AI dates can be imprecise ('2024', 'March 2024') → text, not date
  supports        text,                            -- "why it helps" / the paragraph it backs
  status          text        not null default 'pending' check (status in (
                                'pending','fetching','ready','failed','manual'
                              )),
  fetch_method    text        check (fetch_method in ('pdf','render','archive','manual')),
  final_url       text,                            -- effective URL (may be a Wayback snapshot)
  content_sha256  text,                            -- integrity of the downloaded/rendered bytes
  pdf_path        text,                            -- bucket 'expedientes', prefix 'exhibits/'
  page_count      integer,
  attempts        integer     not null default 0,
  last_error      text,
  accessed_at     timestamptz,                     -- for the "Accessed on" provenance stamp
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- dedup: one source → one exhibit per generation run (lowest cite_order wins in app layer)
  unique (run_id, url_hash)
);

create index case_exhibits_case_status_idx on public.case_exhibits (case_id, status);
create index case_exhibits_run_idx on public.case_exhibits (run_id);
create index case_exhibits_status_attempts_idx on public.case_exhibits (status, attempts);

create trigger set_updated_at_case_exhibits
  before update on public.case_exhibits
  for each row execute function public.set_updated_at();

alter table public.case_exhibits enable row level security;

-- SELECT: expedientes module (Diana + admin). Client never sees exhibits.
create policy case_exhibits_select on public.case_exhibits
  for select to authenticated
  using ((select public.has_module('expedientes', false)));

-- INSERT/UPDATE: expedientes edit (Diana's manual upload / retry actions).
-- The capture + fetch jobs write via service_role (which bypasses RLS).
create policy case_exhibits_insert on public.case_exhibits
  for insert to authenticated
  with check ((select public.has_module('expedientes', true)));

create policy case_exhibits_update on public.case_exhibits
  for update to authenticated
  using ((select public.has_module('expedientes', true)))
  with check ((select public.has_module('expedientes', true)));

-- DELETE: denied (history is preserved; status drives lifecycle).

-- ---------------------------------------------------------------------------
-- exhibit_domain_health — per-domain circuit breaker + courtesy rate limiting,
-- shared across fetch-exhibit jobs. Infra table: only the jobs (service_role)
-- read/write it; no authenticated access.
-- ---------------------------------------------------------------------------
create table public.exhibit_domain_health (
  domain               text        primary key,
  consecutive_failures integer     not null default 0,
  open_until           timestamptz,                 -- circuit open until this time
  last_request_at      timestamptz,                 -- politeness / rate limit
  updated_at           timestamptz not null default now()
);

create trigger set_updated_at_exhibit_domain_health
  before update on public.exhibit_domain_health
  for each row execute function public.set_updated_at();

alter table public.exhibit_domain_health enable row level security;
-- No policies: authenticated users have no access; jobs use service_role (bypasses RLS).

-- ---------------------------------------------------------------------------
-- ai_generation_configs — admin "save links" knobs per letter
-- ---------------------------------------------------------------------------
alter table public.ai_generation_configs
  add column if not exists attach_sources_enabled boolean not null default false,
  add column if not exists attach_sources_kinds   text[]  not null default '{country_condition,jurisprudence}',
  add column if not exists curated_sources        jsonb   not null default '[]'::jsonb;
  -- curated_sources shape: [{ "url": text, "title": text, "category": text }]

-- ---------------------------------------------------------------------------
-- expediente_items — add 'exhibit' (ref_id → case_exhibits.id, validated in service)
-- ---------------------------------------------------------------------------
alter table public.expediente_items
  drop constraint if exists expediente_items_item_type_check;

alter table public.expediente_items
  add constraint expediente_items_item_type_check
  check (item_type in (
    'cover','ai_generation','automated_form','client_document','translation','external_file','exhibit'
  ));
