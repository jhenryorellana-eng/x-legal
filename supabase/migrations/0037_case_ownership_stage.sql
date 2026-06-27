-- 0037: Case ownership stage — responsable / etapa interna (eje propio).
--
-- Nuevo eje de RESPONSABILIDAD, separado del `cases.status` legal (payment→…→completed)
-- y de la columna kanban. El caso avanza Ventas → Legal → Operaciones → Cerrado por
-- TRASPASO MANUAL (gated por tareas), cambiando el responsable y la tarjeta de su board.
--
--  1. cases.current_stage     — etapa interna (default 'sales').
--  2. cases.current_owner_id  — responsable actual (staff). El kanban de casos lo proyecta.
--  3. case_stage_history      — log inmutable de traspasos (mirror de case_phase_history).
--  4. Backfill de casos existentes.
--
-- El traspaso NO modifica cases.status (regla "kanban ≠ status", RF-DIA-006).

-- 1 ──────────────────────────────────────────────────────────────────────────
alter table public.cases
  add column if not exists current_stage text not null default 'sales'
    check (current_stage in ('sales', 'legal', 'operations', 'done'));
comment on column public.cases.current_stage is
  'Etapa interna de responsabilidad (eje propio, NO el status legal): sales→legal→operations→done.';

-- 2 ──────────────────────────────────────────────────────────────────────────
alter table public.cases
  add column if not exists current_owner_id uuid
    references public.staff_profiles(user_id) on delete set null;
comment on column public.cases.current_owner_id is
  'Staff responsable actual del caso. El kanban board_kind=cases del owner proyecta la tarjeta.';

create index if not exists cases_current_owner_idx on public.cases (current_owner_id);
create index if not exists cases_current_stage_idx on public.cases (current_stage);

-- 3 ──────────────────────────────────────────────────────────────────────────
create table if not exists public.case_stage_history (
  id            uuid        primary key default gen_random_uuid(),
  case_id       uuid        not null references public.cases(id) on delete cascade,
  from_stage    text,
  to_stage      text        not null,
  from_owner_id uuid        references public.staff_profiles(user_id),
  to_owner_id   uuid        references public.staff_profiles(user_id),
  actor_id      uuid        references public.users(id),
  note          text,
  created_at    timestamptz not null default now()
  -- No updated_at: history is immutable (trigger prevents UPDATE/DELETE)
);
comment on table public.case_stage_history is
  'Log inmutable de traspasos de responsable/etapa. Trigger impide UPDATE/DELETE. Escrito por service_role.';

create index if not exists case_stage_history_case_idx
  on public.case_stage_history (case_id, created_at);

alter table public.case_stage_history enable row level security;

-- SELECT: staff con vista de casos (es información interna de gestión, no cliente-facing).
create policy case_stage_history_select on public.case_stage_history
  for select to authenticated
  using ( (select public.has_module('cases', false)) );
-- INSERT/UPDATE/DELETE: service_role only (transferCase corre con service client; authz en servicio).

drop trigger if exists case_stage_history_immutable on public.case_stage_history;
create trigger case_stage_history_immutable
  before update or delete on public.case_stage_history
  for each row execute function public.prevent_row_mutation();

-- 4 ── Backfill ───────────────────────────────────────────────────────────────
-- Casos con paralegal asignado → ya están en Legal (responsable = paralegal).
update public.cases
   set current_stage = 'legal',
       current_owner_id = assigned_paralegal_id
 where assigned_paralegal_id is not null;

-- Resto → Ventas (responsable = el sales asignado; puede quedar NULL → admin asigna).
update public.cases
   set current_stage = 'sales',
       current_owner_id = assigned_sales_id
 where assigned_paralegal_id is null;
