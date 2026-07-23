-- 0107_document_coverage.sql
-- Cobertura de documentos combinados (DOC-40/41/42, historial 2026-07-22).
-- (1) Config por tipo de documento: la IA puede detectar este tipo dentro de OTRA
--     subida de la misma fase (PDF combinado) usando pistas editables por el admin.
-- (2) Tabla de coberturas: "el case_document X contiene el contenido del tipo Y".
--     Escrita solo por el job classify-document-coverage (service_role); leída por
--     cases via service_role. Supersede/invalidez del doc origen se derivan en
--     lectura (cases.buildDocumentsMatrix) — no se materializan (D2).

alter table public.required_document_types
  add column if not exists detectable_in_combined boolean not null default false,
  add column if not exists detection_hints_i18n jsonb;

comment on column public.required_document_types.detectable_in_combined is
  'La IA puede detectar este tipo dentro de OTRA subida de la misma fase (requiere ai_extract + extraction_schema + accepted_format=pdf).';
comment on column public.required_document_types.detection_hints_i18n is
  'Pistas {es,en} editables por el admin que la IA usa para reconocer el tipo dentro de un PDF combinado.';

create table public.case_document_coverages (
  id                                 uuid primary key default gen_random_uuid(),
  case_id                            uuid not null references public.cases(id) on delete cascade,
  case_document_id                   uuid not null references public.case_documents(id) on delete cascade,
  covered_required_document_type_id  uuid not null references public.required_document_types(id) on delete cascade,
  party_id                           uuid references public.case_parties(id) on delete cascade,
  status         text not null default 'detected' check (status in ('detected','dismissed')),
  confidence     numeric(3,2) not null check (confidence >= 0 and confidence <= 1),
  page_range     text,
  -- Extraído con el extraction_schema del tipo CUBIERTO (no del slot origen).
  payload        jsonb,
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  cost_usd       numeric(8,4),
  dismissed_by   uuid references public.users(id),
  dismissed_at   timestamptz,
  dismiss_reason text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint case_document_coverages_unique
    unique nulls not distinct (case_document_id, covered_required_document_type_id, party_id)
);

comment on table public.case_document_coverages is
  'Cobertura IA: un case_document (origen) contiene el contenido de otro required_document_type de la fase. Escrita solo por service_role (job classify-document-coverage). Una cobertura cuenta solo si status=detected, el origen sigue uploaded|approved y el slot cubierto no tiene subida propia activa — derivado en cases.buildDocumentsMatrix, nunca materializado. El descarte de staff (dismissed) persiste y no es resucitado por re-runs.';

create index case_document_coverages_case_status_idx
  on public.case_document_coverages(case_id, status);
create index case_document_coverages_covered_idx
  on public.case_document_coverages(case_id, covered_required_document_type_id);

create trigger trg_case_document_coverages_updated_at
  before update on public.case_document_coverages
  for each row execute function public.set_updated_at();

-- Service-role only (patrón case_ai_field_cache/0091): RLS activada con CERO
-- políticas; el cliente la lee solo vía DTOs gateados por requireCaseAccess.
alter table public.case_document_coverages enable row level security;
