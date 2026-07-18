-- 0093_lex_case_chat.sql
-- Lex case chat (staff): pestaña "Lex" del workspace de caso — chat IA por caso.
--   1. case_knowledge_chunks: índice RAG por caso (chunks + embedding 768d) alimentado
--      por document_extractions.raw_text y case_form_responses.answers. Reindex
--      incremental por content_hash (jobs lex-reindex-case).
--   2. RPC match_case_knowledge: retrieval semántico acotado SIEMPRE a un case_id
--      (aislamiento por caso — Lex solo conoce este caso).
--   3. case_lex_threads / case_lex_messages: historial de chat PRIVADO por empleado
--      (un hilo por caso+empleado). El cliente nunca lee estas tablas.
-- Aditivo (tablas nuevas + RPC). pgvector ya habilitado en 0055.

-- 1. Índice de conocimiento por caso ─────────────────────────────────────────
create table if not exists public.case_knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  case_id      uuid not null references public.cases(id) on delete cascade,
  -- Qué alimenta el chunk: extracción de un documento, respuesta de formulario,
  -- o el perfil factual del caso (servicio/fase/status/partes).
  source_kind  text not null check (source_kind in ('document_extraction', 'form_response', 'case_profile')),
  -- case_documents.id / case_form_responses.id / cases.id según source_kind.
  source_id    uuid not null,
  -- Etiqueta humana para citas en UI (nombre de documento / texto de la pregunta).
  source_label text not null default '',
  chunk_index  int  not null,
  content      text not null,
  -- sha-256 del contenido → reindex incremental: mismo hash = no re-embeber.
  content_hash text not null,
  embedding    vector(768),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (source_kind, source_id, chunk_index)
);

comment on table public.case_knowledge_chunks is
  'RAG index per case for the staff Lex chat: chunks from document_extractions.raw_text + case_form_responses (+ case profile), embedded with Gemini gemini-embedding-001 @768 (same pipeline as ai_dataset_items, 0055). Written only by service-role jobs (lex-reindex-case).';

create index if not exists idx_case_knowledge_chunks_case
  on public.case_knowledge_chunks(case_id, source_kind, source_id);

create index if not exists idx_case_knowledge_chunks_embedding
  on public.case_knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- 2. RPC de retrieval acotado al caso ────────────────────────────────────────
-- similarity = 1 - distancia coseno. El filtro case_id es OBLIGATORIO (firma de
-- la función): no existe camino de retrieval que mezcle casos.
create or replace function public.match_case_knowledge(
  query_embedding vector(768),
  p_case_id   uuid,
  match_count int default 12
)
returns table (
  id           uuid,
  source_kind  text,
  source_id    uuid,
  source_label text,
  content      text,
  similarity   float
)
language sql
stable
as $$
  select c.id, c.source_kind, c.source_id, c.source_label, c.content,
         1 - (c.embedding <=> query_embedding) as similarity
  from public.case_knowledge_chunks c
  where c.case_id = p_case_id
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;

grant execute on function public.match_case_knowledge(vector, uuid, int) to authenticated, service_role;

-- 3. Hilos y mensajes del chat Lex (privados por empleado) ───────────────────
create table if not exists public.case_lex_threads (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references public.cases(id) on delete cascade,
  staff_user_id uuid not null references public.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  unique (case_id, staff_user_id)
);

comment on table public.case_lex_threads is
  'One Lex chat thread per (case, staff member) — private history per employee. The client never sees these rows.';

create table if not exists public.case_lex_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references public.case_lex_threads(id) on delete cascade,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null default '',
  -- 'running' = placeholder del assistant mientras el job lex-answer trabaja
  -- (polling de status desde la UI, patrón Pre-Mortem).
  status        text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  -- Citas: [{kind:'chunk', label}] (documentos/preguntas del caso) y [{kind:'web', uri, title}].
  sources       jsonb not null default '[]'::jsonb,
  model         text,
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(8,4),
  error         text,
  created_at    timestamptz not null default now()
);

comment on table public.case_lex_messages is
  'Lex chat messages. Assistant rows are written by the lex-answer QStash job (service-role); cost_usd rolls up into case AI spend (DOC-74 §5).';

create index if not exists idx_case_lex_messages_thread
  on public.case_lex_messages(thread_id, created_at);

create index if not exists idx_case_lex_threads_case
  on public.case_lex_threads(case_id);

-- 4. RLS ─────────────────────────────────────────────────────────────────────
alter table public.case_knowledge_chunks enable row level security;
alter table public.case_lex_threads      enable row level security;
alter table public.case_lex_messages     enable row level security;

-- Chunks: lectura staff con módulo cases (igual que document_extractions);
-- escritura SOLO service-role (jobs) — no hay policy de escritura para authenticated.
create policy case_knowledge_chunks_select on public.case_knowledge_chunks
  for select to authenticated
  using ( (select public.has_module('cases', false)) );

-- Threads: solo el empleado dueño del hilo (y con módulo cases).
create policy case_lex_threads_select on public.case_lex_threads
  for select to authenticated
  using (
    staff_user_id = (select auth.uid())
    and (select public.has_module('cases', false))
  );

create policy case_lex_threads_insert on public.case_lex_threads
  for insert to authenticated
  with check (
    staff_user_id = (select auth.uid())
    and (select public.has_module('cases', true))
  );

-- Mensajes: visibles/insertables solo por el dueño del hilo padre.
create policy case_lex_messages_select on public.case_lex_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.case_lex_threads t
      where t.id = thread_id
        and t.staff_user_id = (select auth.uid())
    )
    and (select public.has_module('cases', false))
  );

create policy case_lex_messages_insert on public.case_lex_messages
  for insert to authenticated
  with check (
    exists (
      select 1 from public.case_lex_threads t
      where t.id = thread_id
        and t.staff_user_id = (select auth.uid())
    )
    and (select public.has_module('cases', true))
  );
