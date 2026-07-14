-- =============================================================================
-- 03_demo.sql
-- Demo data for LOCAL development and internal QA only.
-- NEVER run in production or shared staging with the business owner.
-- =============================================================================

-- Anti-prod guard (mandatory per DOC-32 §3)
do $$ begin
  if current_setting('app.environment', true) = 'production' then
    raise exception '03_demo.sql is FORBIDDEN in production';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Demo auth.users (2 clients)
-- ---------------------------------------------------------------------------
do $$ begin
  if current_setting('app.environment', true) is distinct from 'production' then
    insert into auth.users (
      id, instance_id, email, encrypted_password,
      email_confirmed_at, role, aud, created_at, updated_at,
      phone, raw_app_meta_data, raw_user_meta_data
    )
    values
      (
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000000',
        'maria.gonzalez.demo@example.com',
        crypt('demo-maria!', gen_salt('bf')),
        now(), 'authenticated', 'authenticated', now(), now(),
        '+17865550101',
        '{"provider":"phone","providers":["phone"]}'::jsonb,
        '{}'::jsonb
      ),
      (
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000000',
        'carlos.ramirez.demo@example.com',
        crypt('demo-carlos!', gen_salt('bf')),
        now(), 'authenticated', 'authenticated', now(), now(),
        '+13055550102',
        '{"provider":"phone","providers":["phone"]}'::jsonb,
        '{}'::jsonb
      )
    on conflict (id) do nothing;

    -- GoTrue scans these string columns as NON-nullable (see seed 01 note) and
    -- a phone without phone_confirmed_at is not a valid OTP login identity.
    update auth.users set
      confirmation_token         = coalesce(confirmation_token, ''),
      recovery_token             = coalesce(recovery_token, ''),
      email_change               = coalesce(email_change, ''),
      email_change_token_new     = coalesce(email_change_token_new, ''),
      email_change_token_current = coalesce(email_change_token_current, ''),
      phone_change               = coalesce(phone_change, ''),
      phone_change_token         = coalesce(phone_change_token, ''),
      reauthentication_token     = coalesce(reauthentication_token, ''),
      phone_confirmed_at         = coalesce(phone_confirmed_at, now())
    where id in (
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Demo public.users (clients)
-- ---------------------------------------------------------------------------
insert into public.users (id, org_id, kind, phone_e164, email, locale, timezone)
select
  '00000000-0000-0000-0000-000000000101'::uuid,
  o.id, 'client', '+17865550101',
  'maria.gonzalez.demo@example.com', 'es', 'America/New_York'
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict (id) do nothing;

insert into public.users (id, org_id, kind, phone_e164, email, locale, timezone)
select
  '00000000-0000-0000-0000-000000000102'::uuid,
  o.id, 'client', '+13055550102',
  'carlos.ramirez.demo@example.com', 'es', 'America/New_York'
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo client_profiles
-- ---------------------------------------------------------------------------
insert into public.client_profiles (user_id, first_name, last_name, country_of_origin)
values
  ('00000000-0000-0000-0000-000000000101', 'María', 'González', 'Honduras'),
  ('00000000-0000-0000-0000-000000000102', 'Carlos', 'Ramírez',  'El Salvador')
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo person_records (María's children — parties for case 0001)
-- ---------------------------------------------------------------------------
insert into public.person_records (id, org_id, first_name, last_name, date_of_birth, relationship, created_by)
select
  '00000000-0000-0000-0000-000000000201'::uuid,
  o.id, 'Mateo', 'González', '2012-03-15', 'son',
  (select id from auth.users where email = 'diana@usalatinoprime.com')
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict (id) do nothing;

insert into public.person_records (id, org_id, first_name, last_name, date_of_birth, relationship, created_by)
select
  '00000000-0000-0000-0000-000000000202'::uuid,
  o.id, 'Sofía', 'González', '2015-07-22', 'daughter',
  (select id from auth.users where email = 'diana@usalatinoprime.com')
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo cases
-- U26-000001: visa-juvenil, with_lawyer, phase=custodia, active
-- U26-000002: asilo-politico, self, phase=principal, active
-- ---------------------------------------------------------------------------

-- Case 0001
insert into public.cases (
  id, org_id, case_number, service_id, service_plan_id,
  current_phase_id, status, primary_client_id,
  assigned_paralegal_id, assigned_sales_id, opened_at
)
select
  '00000000-0000-0000-0000-000000000301'::uuid,
  o.id,
  'U26-000001',
  s.id,
  pl.id,
  ph.id,
  'active',
  '00000000-0000-0000-0000-000000000101'::uuid,
  diana.user_id,
  vane.user_id,
  now() - interval '20 days'
from public.orgs o
join public.services s on s.slug = 'visa-juvenil'
join public.service_plans pl on pl.service_id = s.id and pl.kind = 'with_lawyer'
join public.service_phases ph on ph.service_id = s.id and ph.slug = 'custodia'
join public.staff_profiles diana on diana.role = 'paralegal'
join public.staff_profiles vane  on vane.role  = 'sales'
where o.name = 'UsaLatinoPrime'
on conflict (case_number) do nothing;

-- Case 0002
insert into public.cases (
  id, org_id, case_number, service_id, service_plan_id,
  current_phase_id, status, primary_client_id,
  assigned_paralegal_id, assigned_sales_id, opened_at
)
select
  '00000000-0000-0000-0000-000000000302'::uuid,
  o.id,
  'U26-000002',
  s.id,
  pl.id,
  ph.id,
  'active',
  '00000000-0000-0000-0000-000000000102'::uuid,
  diana.user_id,
  vane.user_id,
  now() - interval '10 days'
from public.orgs o
join public.services s on s.slug = 'asilo-politico'
join public.service_plans pl on pl.service_id = s.id and pl.kind = 'self'
join public.service_phases ph on ph.service_id = s.id and ph.slug = 'principal'
join public.staff_profiles diana on diana.role = 'paralegal'
join public.staff_profiles vane  on vane.role  = 'sales'
where o.name = 'UsaLatinoPrime'
on conflict (case_number) do nothing;

-- Keep the case-number counter in sync with the seeded cases so the first case
-- created by the app (next_case_number) does not collide with U26-000001/000002.
insert into public._case_number_counters (org_id, year, last_seq)
select o.id, 2026, 2 from public.orgs o where o.name = 'UsaLatinoPrime'
on conflict (org_id, year) do update
  set last_seq = greatest(public._case_number_counters.last_seq, excluded.last_seq);

-- ---------------------------------------------------------------------------
-- case_members
-- ---------------------------------------------------------------------------
insert into public.case_members (case_id, user_id, access_role)
values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'owner'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000102', 'owner')
on conflict (case_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- case_parties (María + Mateo + Sofía on case 0001)
-- ---------------------------------------------------------------------------
insert into public.case_parties (id, case_id, user_id, person_record_id, party_role, position)
values
  -- María as guardian
  ('00000000-0000-0000-0000-000000000401',
   '00000000-0000-0000-0000-000000000301',
   '00000000-0000-0000-0000-000000000101',
   null,
   'guardian', 0),
  -- Mateo as minor
  ('00000000-0000-0000-0000-000000000402',
   '00000000-0000-0000-0000-000000000301',
   null,
   '00000000-0000-0000-0000-000000000201',
   'minor', 1),
  -- Sofía as minor
  ('00000000-0000-0000-0000-000000000403',
   '00000000-0000-0000-0000-000000000301',
   null,
   '00000000-0000-0000-0000-000000000202',
   'minor', 2)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- case_phase_history
-- ---------------------------------------------------------------------------
insert into public.case_phase_history (case_id, phase_id, entered_at, entered_by, note)
select
  '00000000-0000-0000-0000-000000000301'::uuid,
  ph.id,
  now() - interval '20 days',
  diana.user_id,
  'Case opened — entering custody phase'
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join public.staff_profiles diana on diana.role = 'paralegal'
where ph.slug = 'custodia'
on conflict do nothing;

insert into public.case_phase_history (case_id, phase_id, entered_at, entered_by, note)
select
  '00000000-0000-0000-0000-000000000302'::uuid,
  ph.id,
  now() - interval '10 days',
  diana.user_id,
  'Case opened — entering strengthen phase'
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
join public.staff_profiles diana on diana.role = 'paralegal'
where ph.slug = 'principal'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Demo contracts (1 per case)
-- ---------------------------------------------------------------------------
insert into public.contracts (
  id, org_id, case_id, service_id, service_plan_id,
  plan_snapshot, parties_snapshot, status, signed_at, created_by, terms_version
)
select
  '00000000-0000-0000-0000-000000000501'::uuid,
  o.id,
  '00000000-0000-0000-0000-000000000301'::uuid,
  s.id, pl.id,
  jsonb_build_object('price_cents', 0, 'kind', 'with_lawyer'),
  jsonb_build_object('client', 'María González'),
  'signed',
  now() - interval '20 days',
  vane.user_id,
  'v1.0'
from public.orgs o
join public.services s on s.slug = 'visa-juvenil'
join public.service_plans pl on pl.service_id = s.id and pl.kind = 'with_lawyer'
join public.staff_profiles vane on vane.role = 'sales'
where o.name = 'UsaLatinoPrime'
on conflict (case_id) do nothing;

insert into public.contracts (
  id, org_id, case_id, service_id, service_plan_id,
  plan_snapshot, parties_snapshot, status, signed_at, created_by, terms_version
)
select
  '00000000-0000-0000-0000-000000000502'::uuid,
  o.id,
  '00000000-0000-0000-0000-000000000302'::uuid,
  s.id, pl.id,
  jsonb_build_object('price_cents', 0, 'kind', 'self'),
  jsonb_build_object('client', 'Carlos Ramírez'),
  'signed',
  now() - interval '10 days',
  vane.user_id,
  'v1.0'
from public.orgs o
join public.services s on s.slug = 'asilo-politico'
join public.service_plans pl on pl.service_id = s.id and pl.kind = 'self'
join public.staff_profiles vane on vane.role = 'sales'
where o.name = 'UsaLatinoPrime'
on conflict (case_id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo payment_plans + installments
-- María: total $6,000 — $1,000 down (paid) + 10 installments (pending)
-- Carlos: total $2,500 — $500 down (paid, Zelle) + 4 installments (one overdue)
-- ---------------------------------------------------------------------------

-- María payment plan
insert into public.payment_plans (id, contract_id, total_cents, downpayment_cents, installment_count)
values (
  '00000000-0000-0000-0000-000000000601'::uuid,
  '00000000-0000-0000-0000-000000000501'::uuid,
  600000, 100000, 10
) on conflict do nothing;

-- María down payment installment (paid)
insert into public.installments (
  payment_plan_id, number, is_downpayment, amount_cents, due_date, status, paid_at
)
values (
  '00000000-0000-0000-0000-000000000601'::uuid,
  1, true, 100000,
  (now() - interval '20 days')::date,
  'paid',
  now() - interval '20 days'
) on conflict (payment_plan_id, number) do nothing;

-- María remaining 10 installments (pending)
insert into public.installments (payment_plan_id, number, is_downpayment, amount_cents, due_date, status)
select
  '00000000-0000-0000-0000-000000000601'::uuid,
  g.n,
  false,
  50000,
  (now() + (g.n * interval '30 days'))::date,
  'pending'
from generate_series(2, 11) as g(n)
on conflict (payment_plan_id, number) do nothing;

-- Carlos payment plan
insert into public.payment_plans (id, contract_id, total_cents, downpayment_cents, installment_count)
values (
  '00000000-0000-0000-0000-000000000602'::uuid,
  '00000000-0000-0000-0000-000000000502'::uuid,
  250000, 50000, 4
) on conflict do nothing;

-- Carlos down payment (paid via Zelle — confirmed by Andrium)
insert into public.installments (
  payment_plan_id, number, is_downpayment, amount_cents, due_date, status, paid_at
)
values (
  '00000000-0000-0000-0000-000000000602'::uuid,
  1, true, 50000,
  (now() - interval '10 days')::date,
  'paid',
  now() - interval '10 days'
) on conflict (payment_plan_id, number) do nothing;

-- Carlos installment 2 — overdue (for collections QA)
insert into public.installments (payment_plan_id, number, is_downpayment, amount_cents, due_date, status)
values (
  '00000000-0000-0000-0000-000000000602'::uuid,
  2, false, 50000,
  (now() - interval '5 days')::date,
  'overdue'
) on conflict (payment_plan_id, number) do nothing;

-- Carlos installments 3-5 — pending
insert into public.installments (payment_plan_id, number, is_downpayment, amount_cents, due_date, status)
select
  '00000000-0000-0000-0000-000000000602'::uuid,
  g.n,
  false,
  50000,
  (now() + ((g.n - 2) * interval '30 days'))::date,
  'pending'
from generate_series(3, 5) as g(n)
on conflict (payment_plan_id, number) do nothing;

-- ---------------------------------------------------------------------------
-- Demo leads (4 leads assigned to Vanessa)
-- ---------------------------------------------------------------------------
insert into public.leads (id, org_id, phone_e164, full_name, source, category_id, status, assigned_to, contacted_at)
select
  l.id::uuid,
  o.id,
  l.phone,
  l.name,
  l.source,
  lc.id,
  'open',
  vane.user_id,
  l.contacted_at
from public.orgs o
join public.staff_profiles vane on vane.role = 'sales'
cross join (values
  ('00000000-0000-0000-0000-000000000701', '+13055550201', 'Pedro Torres',    'tiktok',    'Caliente', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-000000000702', '+13055550202', 'Luisa Fernández', 'whatsapp',  'Tibio',    now() - interval '1 day'),
  ('00000000-0000-0000-0000-000000000703', '+13055550203', 'Jorge Núñez',     'referido',  'Frío',     now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000704', '+13055550204', 'Ana Castillo',    'web',       'VIP',      null)
) as l(id, phone, name, source, cat_label, contacted_at)
join public.lead_categories lc on lc.org_id = o.id and lc.label = l.cat_label
where o.name = 'UsaLatinoPrime'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Demo kanban board for Vanessa (leads board)
-- ---------------------------------------------------------------------------
insert into public.kanban_boards (id, org_id, owner_staff_id, board_kind)
select
  '00000000-0000-0000-0000-000000000801'::uuid,
  o.id, vane.user_id, 'leads'
from public.orgs o
join public.staff_profiles vane on vane.role = 'sales'
where o.name = 'UsaLatinoPrime'
on conflict (owner_staff_id, board_kind) do nothing;

insert into public.kanban_columns (id, board_id, label, system_key, color, position, is_terminal_won, is_terminal_lost)
values
  ('00000000-0000-0000-0000-000000000811', '00000000-0000-0000-0000-000000000801', 'Nuevos',          'intake',     'accent', 1, false, false),
  ('00000000-0000-0000-0000-000000000812', '00000000-0000-0000-0000-000000000801', 'Contactados',     null,         'gold',   2, false, false),
  ('00000000-0000-0000-0000-000000000813', '00000000-0000-0000-0000-000000000801', 'Cita agendada',   null,         'green',  3, false, false),
  ('00000000-0000-0000-0000-000000000814', '00000000-0000-0000-0000-000000000801', 'Listo para contrato', null,     'green',  4, true,  false),
  ('00000000-0000-0000-0000-000000000815', '00000000-0000-0000-0000-000000000801', 'Rechazado',       null,         'red',    5, false, true)
-- explicit arbiter (id): bare ON CONFLICT fails on tables with deferrable unique constraints (55000)
on conflict (id) do nothing;

-- Place leads on kanban columns
insert into public.kanban_cards (column_id, ref_type, ref_id, position, pinned_note)
values
  ('00000000-0000-0000-0000-000000000811', 'lead', '00000000-0000-0000-0000-000000000701', 1, null),  -- Pedro: Nuevos
  ('00000000-0000-0000-0000-000000000812', 'lead', '00000000-0000-0000-0000-000000000702', 1, null),  -- Luisa: Contactados
  ('00000000-0000-0000-0000-000000000813', 'lead', '00000000-0000-0000-0000-000000000703', 1, null),  -- Jorge: Cita agendada
  ('00000000-0000-0000-0000-000000000811', 'lead', '00000000-0000-0000-0000-000000000704', 2, null)   -- Ana: Nuevos (uncontacted = amber band)
-- explicit arbiter: bare ON CONFLICT fails on tables with deferrable unique constraints (55000)
on conflict (ref_type, ref_id, column_id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo appointments
-- (3 appointments within Vanessa's demo availability: M-F 9:00-17:00 ET)
-- ---------------------------------------------------------------------------

-- Appointment 1: upcoming for case 0001 (video, 30 min)
insert into public.appointments (
  id, case_id, service_phase_id, staff_id, client_user_id,
  starts_at, ends_at, kind, status, sequence_number
)
select
  '00000000-0000-0000-0000-000000000901'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  ph.id,
  vane.user_id,
  '00000000-0000-0000-0000-000000000101'::uuid,
  date_trunc('day', now() + interval '2 days') + interval '14 hours',
  date_trunc('day', now() + interval '2 days') + interval '14 hours 30 minutes',
  'video', 'scheduled', 1
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join public.staff_profiles vane on vane.role = 'sales'
where ph.slug = 'custodia'
-- explicit arbiter (id): bare ON CONFLICT fails on tables with EXCLUDE constraints (55000)
on conflict (id) do nothing;

-- Appointment 2: upcoming for case 0002 (video, 30 min)
insert into public.appointments (
  id, case_id, service_phase_id, staff_id, client_user_id,
  starts_at, ends_at, kind, status, sequence_number
)
select
  '00000000-0000-0000-0000-000000000902'::uuid,
  '00000000-0000-0000-0000-000000000302'::uuid,
  ph.id,
  vane.user_id,
  '00000000-0000-0000-0000-000000000102'::uuid,
  date_trunc('day', now() + interval '3 days') + interval '15 hours',
  date_trunc('day', now() + interval '3 days') + interval '15 hours 30 minutes',
  'video', 'scheduled', 1
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
join public.staff_profiles vane on vane.role = 'sales'
where ph.slug = 'principal'
-- explicit arbiter (id): bare ON CONFLICT fails on tables with EXCLUDE constraints (55000)
on conflict (id) do nothing;

-- Appointment 3: completed historical (case 0001)
insert into public.appointments (
  id, case_id, service_phase_id, staff_id, client_user_id,
  starts_at, ends_at, kind, status, sequence_number
)
select
  '00000000-0000-0000-0000-000000000903'::uuid,
  '00000000-0000-0000-0000-000000000301'::uuid,
  ph.id,
  vane.user_id,
  '00000000-0000-0000-0000-000000000101'::uuid,
  date_trunc('day', now() - interval '15 days') + interval '10 hours',
  date_trunc('day', now() - interval '15 days') + interval '10 hours 30 minutes',
  'video', 'completed', null
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join public.staff_profiles vane on vane.role = 'sales'
where ph.slug = 'custodia'
-- explicit arbiter (id): bare ON CONFLICT fails on tables with EXCLUDE constraints (55000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Demo case_timeline events
-- ---------------------------------------------------------------------------
insert into public.case_timeline (
  case_id, event_type, icon, color, title_i18n, actor_kind, actor_user_id, visible_to_client, occurred_at
)
values
  (
    '00000000-0000-0000-0000-000000000301'::uuid,
    'phase.advanced', 'route', 'purple',
    '{"es":"Caso abierto — Fase Custodia iniciada","en":"Case opened — Custody phase started"}'::jsonb,
    'system', null, true,
    now() - interval '20 days'
  ),
  (
    '00000000-0000-0000-0000-000000000301'::uuid,
    'appointment.booked', 'calendar', 'green',
    '{"es":"Primera cita agendada","en":"First appointment scheduled"}'::jsonb,
    'client', '00000000-0000-0000-0000-000000000101'::uuid, true,
    now() - interval '18 days'
  ),
  (
    '00000000-0000-0000-0000-000000000302'::uuid,
    'phase.advanced', 'route', 'navy',
    '{"es":"Caso abierto — Fase Reforzar iniciada","en":"Case opened — Strengthen phase started"}'::jsonb,
    'system', null, true,
    now() - interval '10 days'
  )
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Demo conversation + messages (case 0001)
-- ---------------------------------------------------------------------------
insert into public.conversations (id, org_id, scope, case_id, title, last_message_at)
select
  '00000000-0000-0000-0000-000000000a01'::uuid,
  o.id, 'case',
  '00000000-0000-0000-0000-000000000301'::uuid,
  'Visa Juvenil — Mateo y Sofía González',
  now() - interval '1 day'
from public.orgs o
where o.name = 'UsaLatinoPrime'
on conflict do nothing;

-- Participants: María + Diana
insert into public.conversation_participants (conversation_id, user_id)
values
  ('00000000-0000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000a01',
   (select id from auth.users where email = 'diana@usalatinoprime.com'))
on conflict (conversation_id, user_id) do nothing;

-- Messages
insert into public.messages (conversation_id, sender_user_id, kind, body, created_at)
values
  (
    '00000000-0000-0000-0000-000000000a01',
    (select id from auth.users where email = 'diana@usalatinoprime.com'),
    'text',
    'Hola María, soy Diana, su paralegal. Hemos recibido sus documentos. La cita de la próxima semana está confirmada.',
    now() - interval '2 days'
  ),
  (
    '00000000-0000-0000-0000-000000000a01',
    '00000000-0000-0000-0000-000000000101'::uuid,
    'text',
    'Muchas gracias Diana! Estaremos listos.',
    now() - interval '1 day'
  )
on conflict do nothing;
