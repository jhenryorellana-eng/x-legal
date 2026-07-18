-- 0091 — ai_field resolution cache (autofill total, velocidad del wizard).
--
-- An ai_field (e.g. EOIR-26 item #6) used to fire a Gemini call on EVERY wizard
-- open. This cache stores the resolved value keyed by an input fingerprint
-- (instruction + connected config + model + the document set's id/size/updated_at),
-- validated on read — a new/replaced document changes the fingerprint and forces
-- a recompute. Self-healing: no event wiring, no invalidation races.

create table if not exists public.case_ai_field_cache (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  party_id uuid references public.case_parties(id) on delete cascade,
  question_id uuid not null,
  input_fingerprint text not null,
  value text not null,
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint case_ai_field_cache_unique unique nulls not distinct (case_id, party_id, question_id)
);

comment on table public.case_ai_field_cache is
  'Resolved ai_field values (cases module, service-role only). Fingerprint-validated on read; a changed document set recomputes.';

create index if not exists case_ai_field_cache_case_idx
  on public.case_ai_field_cache (case_id);

-- Service-role only: RLS enabled with ZERO policies (anon/authenticated denied;
-- the service client bypasses RLS). Values are served to clients exclusively
-- through the prefill DTO (requireCaseAccess-gated reads in cases/service).
alter table public.case_ai_field_cache enable row level security;
