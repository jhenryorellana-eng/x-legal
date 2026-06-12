-- =============================================================================
-- 0009_integrations.sql
-- Block 9: integrations — SaaS Abogados + webhook ingestion (2 tables)
-- Depends on: 0008_expediente.sql (expedientes),
--             0004_cases.sql (cases, orgs, users)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- legal_validations
-- Mirrors a submission to the SaaS Abogados platform.
-- The truth of the verdict lives on the SaaS side; this is the local mirror.
-- ---------------------------------------------------------------------------
create table public.legal_validations (
  id                      uuid        primary key default gen_random_uuid(),
  case_id                 uuid        not null references public.cases(id) on delete restrict,
  expediente_id           uuid        not null references public.expedientes(id) on delete restrict,
  attempt_no              integer     not null,  -- = expedientes.attempt_no that was sent
  external_validation_id  uuid,                  -- id returned by the SaaS
  status                  text        not null default 'pending'
                                      check (status in (
                                        'pending','sent','queued','in_review',
                                        'validated','needs_corrections','cancelled','error'
                                      )),
  semaforo                text        check (semaforo in ('green','amber','red')),
  ai_score                integer,
  verdict                 text        check (verdict in ('validated','needs_corrections')),
  verdict_notes           text,
  -- [{severity, category, location, description, recommendation}]
  verdict_findings        jsonb,
  verdict_at              timestamptz,
  return_to               text        check (return_to in ('team','client')),
  sent_at                 timestamptz,
  error                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (case_id, attempt_no)
);

-- Partial index for polling: only rows awaiting a response need to be scanned
create index legal_validations_pending_status_idx
  on public.legal_validations (status)
  where (status in ('sent','queued','in_review'));

create trigger set_updated_at_legal_validations
  before update on public.legal_validations
  for each row execute function public.set_updated_at();

alter table public.legal_validations enable row level security;

-- SELECT: validations module (Diana + admin)
create policy legal_validations_select on public.legal_validations
  for select to authenticated
  using ((select public.has_module('validations', false)));

-- INSERT: Diana registers the submission; the service transitions to 'sent'
create policy legal_validations_insert on public.legal_validations
  for insert to authenticated
  with check (
    (select public.has_module('validations', true))
    and status = 'pending'
  );

-- UPDATE: service_role ONLY (SaaS Abogados webhook writes verdict fields).
--         Cancellation also goes via service (Actor staff -> service_role after can() check).
--         No policy for authenticated => denied by default for UPDATE.

-- DELETE: denied

-- ---------------------------------------------------------------------------
-- webhook_events  (root table: carries org_id)
-- Ingestion log for ALL incoming webhooks: Stripe, Abogados, LiveKit, QStash, Resend.
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id               uuid        primary key default gen_random_uuid(),
  org_id           uuid        not null references public.orgs(id) on delete restrict,
  source           text        not null check (source in ('stripe','abogados','livekit','qstash','resend')),
  event_type       text,
  idempotency_key  text        not null,  -- e.g. Stripe event.id; abogados: validation_id+verdict_at
  signature_valid  boolean     not null,
  raw_body         jsonb       not null,
  processed_at     timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Guarantees idempotency: processing the same webhook twice is a no-op
  unique (source, idempotency_key)
);

create trigger set_updated_at_webhook_events
  before update on public.webhook_events
  for each row execute function public.set_updated_at();

alter table public.webhook_events enable row level security;

-- SELECT: forensic audit by admin only (audit module)
create policy webhook_events_select on public.webhook_events
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('audit', false))
  );

-- INSERT/UPDATE/DELETE: service_role ONLY (all webhook handlers use the service client).
-- Authenticated users must never be able to fabricate or mutate webhook records.
-- No policy for INSERT/UPDATE/DELETE => denied by default for authenticated.
