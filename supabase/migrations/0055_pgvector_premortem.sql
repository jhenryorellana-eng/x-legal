-- 0055_pgvector_premortem.sql
-- Etapa D: RAG semántico (pgvector + embeddings Gemini) + módulo Pre-Mortem.
--   1. Habilita pgvector y añade embedding vector(768) a ai_dataset_items (+ índice hnsw coseno).
--   2. RPC match_dataset_items: recuperación por similitud coseno (con filtro opcional por tags).
--   3. Tabla case_pre_mortem_assessments: historial de análisis Pre-Mortem por caso (+ coste IA).
--   4. Flag ai_generation_configs.pre_mortem_enabled: el admin activa el Pre-Mortem por ai_letter.
-- Aditivo (extensión + columnas nullable + tabla + RPC). Embeddings se pueblan por backfill aparte.

-- 1. pgvector + columna de embedding ─────────────────────────────────────────
create extension if not exists vector;

alter table public.ai_dataset_items
  add column if not exists embedding vector(768);

comment on column public.ai_dataset_items.embedding is
  'Gemini gemini-embedding-001 @ outputDimensionality 768 (Etapa D). NULL = aún sin embeber → cae a scoring lexical.';

-- Índice ANN coseno. hnsw escala mejor que ivfflat para un corpus chico/creciente.
create index if not exists idx_ai_dataset_items_embedding
  on public.ai_dataset_items using hnsw (embedding vector_cosine_ops);

-- 2. RPC de retrieval semántico ──────────────────────────────────────────────
-- Devuelve los ítems del dataset más similares al query_embedding (coseno),
-- opcionalmente acotados a los que solapen filter_tags. similarity = 1 - distancia.
create or replace function public.match_dataset_items(
  query_embedding vector(768),
  p_dataset_id    uuid,
  match_count     int default 8,
  filter_tags     text[] default null
)
returns table (
  id           uuid,
  title        text,
  content      text,
  tags         text[],
  outcome      text,
  jurisdiction text,
  token_count  int,
  meta         jsonb,
  similarity   float
)
language sql
stable
as $$
  select i.id, i.title, i.content, i.tags, i.outcome, i.jurisdiction, i.token_count, i.meta,
         1 - (i.embedding <=> query_embedding) as similarity
  from public.ai_dataset_items i
  where i.dataset_id = p_dataset_id
    and i.embedding is not null
    and (filter_tags is null or i.tags && filter_tags)
  order by i.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_dataset_items(vector, uuid, int, text[]) to authenticated, service_role;

-- 3. Historial de Pre-Mortem por caso ─────────────────────────────────────────
create table if not exists public.case_pre_mortem_assessments (
  id                  uuid    primary key default gen_random_uuid(),
  case_id             uuid    not null references public.cases(id) on delete cascade,
  -- ai_letter (config) que se criticó + el run concreto analizado (si aplica).
  form_definition_id  uuid    references public.form_definitions(id),
  run_id              uuid    references public.ai_generation_runs(id) on delete set null,
  overall_risk        text    check (overall_risk in ('low', 'medium', 'high')),
  summary             text,
  -- [{ code, probability, rationale, correction }] — code ∈ taxonomía de 11 motivos.
  reasons             jsonb   not null default '[]'::jsonb,
  model               text,
  input_tokens        integer,
  output_tokens       integer,
  cost_usd            numeric(8,4),
  created_by          uuid    references public.users(id),
  created_at          timestamptz not null default now()
);
comment on table public.case_pre_mortem_assessments is
  'Pre-Mortem risk analyses per case (Etapa D): predicted asylum denial reasons + corrections. Append-only history; cost rolls up into the case AI spend (RF-DIA-021).';

create index if not exists idx_case_pre_mortem_case on public.case_pre_mortem_assessments(case_id, created_at desc);

alter table public.case_pre_mortem_assessments enable row level security;

-- Lectura: staff con el módulo cases (igual que ai_generation_runs).
create policy case_pre_mortem_select on public.case_pre_mortem_assessments
  for select to authenticated
  using ( (select public.has_module('cases', false)) );

-- Escritura: staff con cases:write, autor = uid (el job/acción server-side usa service_role y omite RLS).
create policy case_pre_mortem_insert on public.case_pre_mortem_assessments
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and created_by = (select auth.uid())
  );

-- 4. Flag admin-configurable por ai_letter ────────────────────────────────────
alter table public.ai_generation_configs
  add column if not exists pre_mortem_enabled boolean not null default false;

comment on column public.ai_generation_configs.pre_mortem_enabled is
  'Etapa D: el admin habilita el Pre-Mortem para esta generación (ai_letter). El tab "Pre-Mortem" del caso aparece solo si el servicio tiene algún ai_letter con este flag en true.';
