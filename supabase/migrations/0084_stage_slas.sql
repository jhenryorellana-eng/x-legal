-- ============================================================
-- 0084_stage_slas.sql
-- Plazo (SLA) por etapa + el "reloj" de cuenta regresiva del caso.
--
-- Da de alta un "plazo por etapa" de primera clase: el admin configura, por
-- servicio, cuántos DÍAS tiene cada etapa de responsabilidad (Ventas/sales,
-- Expediente/legal, Operaciones/operations) para terminar su trabajo. La tarjeta
-- kanban del responsable muestra una CUENTA REGRESIVA contra ese deadline
-- (rojo/amarillo/normal), reemplazando el badge de "tiempo transcurrido".
--
--  1. service_stage_slas       — plazo en días por (servicio, etapa). Fuente de verdad.
--  2. cases.stage_entered_at   — t0 de la etapa actual (cuándo empezó el responsable).
--  3. cases.stage_due_at       — deadline snapshot (= stage_entered_at + duration_days).
--  4. Seed del servicio Asilo Político (sales=7, legal=7, operations=7).
--  5. Backfill de casos activos.
--
-- El deadline se snapshot-ea en el caso al entrar a cada etapa (activación /
-- traspaso) — lo escribe el módulo cases con service_role. Cambiar la config
-- NO mueve retroactivamente casos en vuelo (semántica justa de SLA).
--
-- Depends on: 0002_catalog, 0004_cases, 0037_case_ownership_stage
-- ============================================================

-- 1 ── plazo por (service, stage) ─────────────────────────────────────────────
create table if not exists public.service_stage_slas (
  id            uuid        primary key default gen_random_uuid(),
  service_id    uuid        not null references public.services(id) on delete cascade,
  stage         text        not null check (stage in ('sales', 'legal', 'operations')),
  duration_days integer     not null check (duration_days > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (service_id, stage)
);
comment on table public.service_stage_slas is
  'Plazo (SLA) en días por (servicio, etapa de responsabilidad). Fuente de verdad de la cuenta regresiva del kanban; el estimado total del servicio es la suma de las etapas.';

drop trigger if exists trg_service_stage_slas_updated_at on public.service_stage_slas;
create trigger trg_service_stage_slas_updated_at
  before update on public.service_stage_slas
  for each row execute function public.set_updated_at();

create index if not exists idx_service_stage_slas_service
  on public.service_stage_slas (service_id);

-- ── RLS (mirrors service_appointment_schedule, join directo a services) ───────
alter table public.service_stage_slas enable row level security;

-- SELECT: catalog editors siempre; si no, sólo servicios activos+públicos
-- (el caso lo lee para computar el deadline al activar/traspasar).
create policy service_stage_slas_select on public.service_stage_slas
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

create policy service_stage_slas_insert on public.service_stage_slas
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_stage_slas_update on public.service_stage_slas
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

-- DELETE: catalog editor (replaceStageSlas hace delete+insert).
create policy service_stage_slas_delete on public.service_stage_slas
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

-- 2/3 ── el reloj del caso ─────────────────────────────────────────────────────
alter table public.cases
  add column if not exists stage_entered_at timestamptz,
  add column if not exists stage_due_at     timestamptz;
comment on column public.cases.stage_entered_at is
  't0 de la etapa actual (cuándo el responsable actual empezó): activación (opened_at) para sales, o el momento del traspaso para las demás etapas.';
comment on column public.cases.stage_due_at is
  'Deadline de la etapa actual (snapshot = stage_entered_at + service_stage_slas.duration_days). NULL si no aplica (payment_pending / done / sin SLA). Fuente de la cuenta regresiva del kanban.';

-- índice para leer el board de un dueño ordenado por urgencia
create index if not exists cases_stage_due_idx on public.cases (current_owner_id, stage_due_at);

-- 4 ── Seed: Asilo Político (sales=7 + legal=7 = "2 semanas al cliente"; operations=7) ─
insert into public.service_stage_slas (service_id, stage, duration_days)
select s.id, v.stage, v.days
  from public.services s
  cross join (values ('sales', 7), ('legal', 7), ('operations', 7)) as v(stage, days)
 where s.slug = 'asilo-politico'
on conflict (service_id, stage) do nothing;

-- 5 ── Backfill de casos activos ──────────────────────────────────────────────
-- t0 = último traspaso a la etapa actual (case_stage_history) o, si no existe
-- (casos sembrados directamente sin bitácora), opened_at / created_at.
-- due = t0 + plazo del stage; casos sin plazo → NULL. Sólo casos activos y en
-- etapa no-terminal (payment_pending/done quedan en NULL, sin cuenta regresiva).
update public.cases c
   set stage_entered_at = t0.entered_at,
       stage_due_at = case
         when t0.duration_days is not null
           then t0.entered_at + make_interval(days => t0.duration_days)
         else null
       end
  from (
    select c2.id,
           coalesce(
             (select max(h.created_at)
                from public.case_stage_history h
               where h.case_id = c2.id and h.to_stage = c2.current_stage),
             c2.opened_at,
             c2.created_at
           ) as entered_at,
           (select sla.duration_days
              from public.service_stage_slas sla
             where sla.service_id = c2.service_id and sla.stage = c2.current_stage) as duration_days
      from public.cases c2
     where c2.status = 'active'
       and c2.current_stage in ('sales', 'legal', 'operations')
  ) t0
 where c.id = t0.id;
