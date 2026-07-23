-- ============================================================
-- 0106_appeal_deadline_policy.sql
-- Política de "deadline externo" por servicio + paso de Calificación + SLA
-- dinámico anclado al deadline.
--
-- Da de alta, como CONFIGURACIÓN por servicio (nada hardcodeado), el patrón de un
-- servicio con un plazo legal externo duro que el cliente debe cumplir (p. ej.
-- Apelación BIA: 30 días calendario desde la decisión del juez para presentar el
-- expediente, o el cliente es deportado):
--
--  1. service_deadline_policies  — activa el paso "Calificación" y sus parámetros
--                                   (plazo, umbral de aceptación, buffer de correo,
--                                   y qué etapa se ancla al deadline).
--  2. cases.deadline_anchor_date — la fecha ancla capturada en el alta (fecha de la
--                                   decisión del juez). Snapshot, editable = fuera de alcance.
--  3. cases.intake_deadline_date — el deadline congelado (= ancla + deadline_days).
--  4. Seed idempotente: activa la política para 'apelacion' (30/3/1) y ancla su
--     etapa 'legal' (Diana) al deadline.
--
-- El "tope máximo" de la etapa anclada NO se duplica: es su duration_days ya
-- existente en service_stage_slas (Apelación legal = 4). Esta migración NO toca
-- service_stage_slas — toda la config nueva vive en la política.
--
-- Genérico: el comportamiento se activa por is_enabled + anchor_mode, NUNCA por
-- slug del servicio. Otro servicio con plazo legal externo se configura desde admin.
--
-- Depends on: 0002_catalog, 0004_cases, 0084_stage_slas
-- ============================================================

-- 1 ── política de deadline por servicio ──────────────────────────────────────
create table if not exists public.service_deadline_policies (
  service_id                  uuid        primary key references public.services(id) on delete cascade,
  is_enabled                  boolean     not null default false,
  anchor_label_i18n           jsonb       not null default '{}'::jsonb,
  deadline_days               integer     not null default 30 check (deadline_days > 0),
  min_business_days_to_accept integer     not null default 3  check (min_business_days_to_accept >= 0),
  mail_buffer_business_days   integer     not null default 1  check (mail_buffer_business_days >= 0),
  anchored_stage              text        check (anchored_stage in ('sales', 'legal', 'operations')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
comment on table public.service_deadline_policies is
  'Política de plazo legal externo por servicio (config-as-data). is_enabled activa el paso "Calificación" del alta; deadline_days = plazo calendario desde la fecha ancla; min_business_days_to_accept = umbral (hábiles) para el aviso "no aceptar"; mail_buffer_business_days = días hábiles que se restan al deadline para el SLA de la etapa anclada (envío por correo); anchored_stage = etapa cuyo stage_due_at se ancla al deadline (min(entered + duration_days hábiles, deadline - mail_buffer hábiles)); NULL = ninguna (todas fijas).';

drop trigger if exists trg_service_deadline_policies_updated_at on public.service_deadline_policies;
create trigger trg_service_deadline_policies_updated_at
  before update on public.service_deadline_policies
  for each row execute function public.set_updated_at();

-- ── RLS (mirror de service_stage_slas: join directo a services) ───────────────
alter table public.service_deadline_policies enable row level security;

-- SELECT: catalog editors siempre; si no, sólo servicios activos (el alta y el
-- caso la leen para computar el deadline).
create policy service_deadline_policies_select on public.service_deadline_policies
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

create policy service_deadline_policies_insert on public.service_deadline_policies
  for insert to authenticated
  with check (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

create policy service_deadline_policies_update on public.service_deadline_policies
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

create policy service_deadline_policies_delete on public.service_deadline_policies
  for delete to authenticated
  using (
    (select public.has_module('catalog', true))
    and exists (
      select 1 from public.services s
       where s.id = service_id and s.org_id = (select public.auth_org_id())
    )
  );

-- 2 ── fecha ancla + deadline congelado en el caso ────────────────────────────
alter table public.cases
  add column if not exists deadline_anchor_date date,
  add column if not exists intake_deadline_date date;
comment on column public.cases.deadline_anchor_date is
  'Fecha ancla del deadline externo, capturada en el alta (p. ej. fecha de la decisión del juez en Apelación). NULL salvo servicios con service_deadline_policies.is_enabled.';
comment on column public.cases.intake_deadline_date is
  'Deadline legal congelado en el alta (= deadline_anchor_date + service_deadline_policies.deadline_days, calendario). Fuente del SLA dinámico de la etapa anclada. NULL salvo servicios con política.';

-- 3 ── Seed idempotente: activar la política para 'apelacion', anclar 'legal' ────
-- La etapa 'legal' (Diana) se ancla al deadline; su duration_days (=4) queda como
-- tope máximo. 'sales' (Vanessa) permanece fija (no es la anchored_stage).
insert into public.service_deadline_policies
    (service_id, is_enabled, anchor_label_i18n, deadline_days, min_business_days_to_accept, mail_buffer_business_days, anchored_stage)
select s.id, true,
       jsonb_build_object(
         'es', '¿Cuál es la fecha de la decisión del juez? (decisión final del caso)',
         'en', 'What is the date of the judge''s decision? (final decision of the case)'
       ),
       30, 3, 1, 'legal'
  from public.services s
 where s.slug = 'apelacion'
on conflict (service_id) do nothing;
