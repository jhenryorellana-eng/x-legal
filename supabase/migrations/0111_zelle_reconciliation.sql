-- =============================================================================
-- 0111_zelle_reconciliation.sql
-- Automatic Zelle reconciliation (Chase alert emails → Migadu IMAP → matching).
-- Depends on: 0006 (billing), 0014 (storage buckets), 0061 (zelle proof CHECK).
--
-- ⚠ PRE-CHECK before applying (must return 0 rows — a duplicate would break the
--   new partial unique index; resolve with finance before applying):
--     select installment_id, count(*) from public.payments
--     where status = 'succeeded' group by 1 having count(*) > 1;
--
-- Layers (deliberately separated — evidence is never rewritten):
--   zelle_ingest_state         → IMAP cursor + lease-lock + heartbeat (1 row/org)
--   zelle_inbound_emails       → raw evidence (append-only, .eml in Storage)
--   zelle_payment_notifications→ one parsed bank transaction (unique txn number)
--   zelle_payment_matches      → candidate/decision snapshots (explainability)
--   zelle_payer_identities     → learned payer aliases (Andrium's confirmations)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) payments: confirmation origin + global success mutex
-- ---------------------------------------------------------------------------

-- 'manual'   = a human (staff) confirmed (confirmed_by = staff user)
-- 'bank_auto'= the reconciler auto-applied a bank-verified Zelle alert
--              (confirmed_by IS NULL — NULL alone must not carry semantics).
alter table public.payments
  add column confirmation_source text not null default 'manual'
  check (confirmation_source in ('manual','bank_auto'));

-- One SUCCEEDED payment per installment, across ALL methods and code paths
-- (Stripe webhook, manual Zelle confirm, auto reconciler). DB-level backstop
-- against double settlement — applyPaymentSuccess is not transactional.
create unique index payments_succeeded_unique_idx
  on public.payments (installment_id)
  where status = 'succeeded';

-- ---------------------------------------------------------------------------
-- 2) zelle_ingest_state — IMAP sweep cursor, lease lock, heartbeat
-- ---------------------------------------------------------------------------

create table public.zelle_ingest_state (
  org_id          uuid primary key references public.orgs(id) on delete cascade,
  mailbox         text not null default 'ZELLE',
  uidvalidity     bigint,
  last_uid        bigint not null default 0,
  -- Row lease instead of pg advisory locks: session advisory locks do not
  -- survive PostgREST connection pooling. A sweep claims the lease with a
  -- conditional UPDATE (lease_until < now()) and it expires on its own.
  lease_until     timestamptz not null default 'epoch',
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger set_updated_at_zelle_ingest_state
  before update on public.zelle_ingest_state
  for each row execute function public.set_updated_at();

alter table public.zelle_ingest_state enable row level security;

create policy "zelle_ingest_state select" on public.zelle_ingest_state
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('billing', false))
  );
-- No INSERT/UPDATE/DELETE policies: only the service_role worker writes.

-- ---------------------------------------------------------------------------
-- 3) zelle_inbound_emails — raw evidence, append-only
-- ---------------------------------------------------------------------------

create table public.zelle_inbound_emails (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete restrict,
  message_id      text not null unique,
  imap_uid        bigint not null,
  uidvalidity     bigint not null,
  received_at     timestamptz,
  from_address    text,
  subject         text,
  -- Canonical evidence: the raw .eml in the private 'zelle-inbound' bucket.
  raw_eml_path    text not null,
  raw_hash        text not null,             -- sha256 of the raw .eml bytes
  template_id     text,                      -- <title> fingerprint of the Chase HTML
  auth_ok         boolean not null default false,
  dkim            text,
  spf             text,
  dmarc           text,
  auth_reasons    jsonb not null default '[]'::jsonb,
  parse_status    text not null default 'pending'
                  check (parse_status in ('pending','parsed','parse_failed','rejected_auth')),
  parse_error     text,
  -- Chase resend of an already-known transaction: extra evidence attached to
  -- the existing notification (set after the fact — hence updatable).
  notification_id uuid,
  created_at      timestamptz not null default now()
);

create index zelle_inbound_emails_org_created_idx
  on public.zelle_inbound_emails (org_id, created_at desc);
create index zelle_inbound_emails_parse_status_idx
  on public.zelle_inbound_emails (org_id, parse_status)
  where parse_status in ('parse_failed','rejected_auth');

comment on table public.zelle_inbound_emails is
  'Append-only. Probative evidence of every bank alert; never edited or deleted.';

-- Append-only enforced in the DB (even against service_role): UPDATE may only
-- touch the processing columns; DELETE is forbidden outright.
create or replace function public.zelle_inbound_emails_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'zelle_inbound_emails is append-only: DELETE is forbidden';
  end if;
  if new.id              is distinct from old.id
     or new.org_id       is distinct from old.org_id
     or new.message_id   is distinct from old.message_id
     or new.imap_uid     is distinct from old.imap_uid
     or new.uidvalidity  is distinct from old.uidvalidity
     or new.received_at  is distinct from old.received_at
     or new.from_address is distinct from old.from_address
     or new.subject      is distinct from old.subject
     or new.raw_eml_path is distinct from old.raw_eml_path
     or new.raw_hash     is distinct from old.raw_hash
     or new.template_id  is distinct from old.template_id
     or new.auth_ok      is distinct from old.auth_ok
     or new.dkim         is distinct from old.dkim
     or new.spf          is distinct from old.spf
     or new.dmarc        is distinct from old.dmarc
     or new.auth_reasons is distinct from old.auth_reasons
     or new.created_at   is distinct from old.created_at
  then
    raise exception 'zelle_inbound_emails is append-only: only parse_status/parse_error/notification_id may change';
  end if;
  return new;
end;
$$;

create trigger zelle_inbound_emails_no_delete
  before delete on public.zelle_inbound_emails
  for each row execute function public.zelle_inbound_emails_guard();

create trigger zelle_inbound_emails_guard_update
  before update on public.zelle_inbound_emails
  for each row execute function public.zelle_inbound_emails_guard();

alter table public.zelle_inbound_emails enable row level security;

create policy "zelle_inbound_emails select" on public.zelle_inbound_emails
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('billing', false))
  );

-- ---------------------------------------------------------------------------
-- 4) zelle_payment_notifications — one parsed bank transaction
-- ---------------------------------------------------------------------------

create table public.zelle_payment_notifications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.orgs(id) on delete restrict,
  email_id           uuid not null references public.zelle_inbound_emails(id) on delete restrict,
  -- Real idempotency key: assigned by Chase, survives alert resends
  -- (RETRY-COUNT > 0) where Message-ID can change.
  transaction_number text not null unique,
  sender_name        text not null,
  normalized_sender  text not null,
  amount_cents       integer not null check (amount_cents > 0),
  sent_on            date,
  memo               text,                    -- "N/A" → null at parse time
  ref_code           text,                    -- canonical U26-000107, if present
  ref_ambiguous      boolean not null default false,
  name_cross_checked boolean not null default false,
  lifecycle_status   text not null default 'received'
                     check (lifecycle_status in
                       ('received','matched','review','applying','applied','dismissed','error')),
  review_reason      text,
  applied_payment_id uuid references public.payments(id) on delete restrict,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index zelle_payment_notifications_org_status_idx
  on public.zelle_payment_notifications (org_id, lifecycle_status, created_at desc);
create index zelle_payment_notifications_sender_idx
  on public.zelle_payment_notifications (org_id, normalized_sender);

create trigger set_updated_at_zelle_payment_notifications
  before update on public.zelle_payment_notifications
  for each row execute function public.set_updated_at();

alter table public.zelle_payment_notifications enable row level security;

create policy "zelle_payment_notifications select" on public.zelle_payment_notifications
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('billing', false))
  );

alter table public.zelle_inbound_emails
  add constraint zelle_inbound_emails_notification_fk
  foreign key (notification_id) references public.zelle_payment_notifications(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- 5) zelle_payment_matches — candidate/decision snapshots
-- ---------------------------------------------------------------------------

create table public.zelle_payment_matches (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id) on delete restrict,
  notification_id uuid not null references public.zelle_payment_notifications(id) on delete restrict,
  case_id         uuid not null references public.cases(id) on delete restrict,
  installment_id  uuid not null references public.installments(id) on delete restrict,
  client_user_id  uuid references public.users(id) on delete set null,
  score           integer not null default 0,
  -- Full signal breakdown + scorer_version: what lets us raise thresholds
  -- with evidence instead of hunches.
  signals         jsonb not null default '{}'::jsonb,
  tier            text not null check (tier in ('A','B')),
  status          text not null default 'suggested'
                  check (status in ('suggested','approved','rejected','unmatched')),
  auto_approved   boolean not null default false,
  approved_by     uuid references public.staff_profiles(user_id) on delete set null,
  approved_at     timestamptz,
  review_reason   text,
  created_at      timestamptz not null default now()
);

-- A payment can never be applied twice: one approved match per notification.
create unique index zelle_payment_matches_one_approved_idx
  on public.zelle_payment_matches (notification_id)
  where status = 'approved';

create index zelle_payment_matches_notification_idx
  on public.zelle_payment_matches (notification_id);
create index zelle_payment_matches_pending_idx
  on public.zelle_payment_matches (org_id, status, created_at desc)
  where status = 'suggested';

alter table public.zelle_payment_matches enable row level security;

create policy "zelle_payment_matches select" on public.zelle_payment_matches
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('billing', false))
  );

-- ---------------------------------------------------------------------------
-- 6) zelle_payer_identities — learned alias book
-- ---------------------------------------------------------------------------

-- Chase only gives the payer NAME (no email/phone), and very often the payer
-- is a family member or employer whose name looks nothing like the client's.
-- Every manual confirmation teaches an alias so tomorrow's payment from the
-- same name pre-fills alone. Unique per (name, client) — NOT per name: one
-- payer can legitimately fund several clients (identity-conflict fanout).
create table public.zelle_payer_identities (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.orgs(id) on delete restrict,
  normalized_name     text not null,
  client_user_id      uuid not null references public.users(id) on delete cascade,
  relationship        text not null default 'self'
                      check (relationship in ('self','family','third_party')),
  confirmations_count integer not null default 1,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  confirmed_by        uuid references public.staff_profiles(user_id) on delete set null,
  revoked_at          timestamptz,
  unique (org_id, normalized_name, client_user_id)
);

create index zelle_payer_identities_name_idx
  on public.zelle_payer_identities (org_id, normalized_name)
  where revoked_at is null;

alter table public.zelle_payer_identities enable row level security;

create policy "zelle_payer_identities select" on public.zelle_payer_identities
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('billing', false))
  );

-- ---------------------------------------------------------------------------
-- 7) Storage bucket: zelle-inbound (raw .eml evidence + sanitized derivatives)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('zelle-inbound',
        'zelle-inbound',
        false,
        10485760,
        array['message/rfc822','text/plain','text/html','application/pdf'])
on conflict (id) do nothing;

-- SELECT: staff with the billing module. Writes: service_role only (no policy).
create policy "zelle-inbound select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'zelle-inbound'
    and (select public.has_module('billing', false))
  );

-- ---------------------------------------------------------------------------
-- 8) RPC: atomic auto-settlement (tier A)
-- ---------------------------------------------------------------------------

-- The ONLY path that settles a bank-verified Zelle payment automatically.
-- Locks the installment and the notification, re-checks every precondition
-- under the lock, and applies payment + ledger + installment + match +
-- notification in ONE transaction. Domain events / receipt email are emitted
-- by the TS caller AFTER this commits (billing.applyBankVerifiedZellePayment).
-- Returns {applied:false, reason} instead of raising so the caller can degrade
-- the notification to review without a rollback-retry dance.
create or replace function public.apply_zelle_auto_payment(
  p_notification_id uuid,
  p_match_id        uuid,
  p_installment_id  uuid,
  p_amount_cents    integer,
  p_proof_path      text,
  p_org_id          uuid,
  p_payer_user_id   uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_installment  public.installments%rowtype;
  v_notification public.zelle_payment_notifications%rowtype;
  v_case_id      uuid;
  v_payment_id   uuid;
begin
  -- Lock order is fixed (installment → notification) to avoid deadlocks with
  -- any future settlement path.
  select * into v_installment
    from public.installments
   where id = p_installment_id
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'INSTALLMENT_NOT_FOUND');
  end if;

  select * into v_notification
    from public.zelle_payment_notifications
   where id = p_notification_id
   for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'NOTIFICATION_NOT_FOUND');
  end if;

  -- Idempotency: already applied → succeed only if it is the same application.
  if v_notification.lifecycle_status = 'applied' then
    return jsonb_build_object(
      'applied', v_notification.applied_payment_id is not null,
      'reason', 'ALREADY_APPLIED',
      'payment_id', v_notification.applied_payment_id
    );
  end if;

  if v_notification.org_id <> p_org_id then
    return jsonb_build_object('applied', false, 'reason', 'ORG_MISMATCH');
  end if;
  if v_notification.lifecycle_status not in ('received','matched','applying') then
    return jsonb_build_object('applied', false, 'reason', 'NOTIFICATION_NOT_APPLICABLE');
  end if;

  -- Re-check under the lock: the world may have changed since scoring.
  if v_installment.status not in ('pending','overdue') then
    return jsonb_build_object('applied', false, 'reason', 'INSTALLMENT_NOT_PAYABLE');
  end if;
  if v_installment.amount_cents <> p_amount_cents
     or v_notification.amount_cents <> p_amount_cents then
    return jsonb_build_object('applied', false, 'reason', 'AMOUNT_MISMATCH');
  end if;
  if exists (
    select 1 from public.payments
     where installment_id = p_installment_id and status = 'succeeded'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'ALREADY_SETTLED');
  end if;
  -- Active Stripe checkout in flight (0019 mutex covers stripe-vs-stripe only).
  if exists (
    select 1 from public.payments
     where installment_id = p_installment_id
       and method = 'stripe' and status = 'pending'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'STRIPE_PENDING');
  end if;

  select c.case_id into v_case_id
    from public.payment_plans pp
    join public.contracts c on c.id = pp.contract_id
   where pp.id = v_installment.payment_plan_id;

  insert into public.payments (
    installment_id, method, status, amount_cents,
    zelle_proof_path, confirmation_source,
    confirmed_by, confirmed_at, payer_user_id,
    stripe_payment_intent_id, stripe_checkout_session_id
  ) values (
    p_installment_id, 'zelle', 'succeeded', p_amount_cents,
    p_proof_path, 'bank_auto',
    null, now(), p_payer_user_id,
    null, null
  ) returning id into v_payment_id;

  -- Ledger income (idempotent — same contract as insertLedgerIfAbsent).
  if v_case_id is not null then
    insert into public.ledger_entries
      (org_id, entry_date, kind, category, amount_cents, case_id, payment_id, recorded_by)
    values
      (p_org_id, current_date, 'income', 'cuota', p_amount_cents, v_case_id, v_payment_id, null)
    on conflict (payment_id, kind) where payment_id is not null do nothing;
  end if;

  update public.installments
     set status = 'paid', paid_at = now()
   where id = p_installment_id;

  update public.zelle_payment_matches
     set status = 'approved', auto_approved = true, approved_at = now()
   where id = p_match_id and notification_id = p_notification_id;

  update public.zelle_payment_notifications
     set lifecycle_status = 'applied', applied_payment_id = v_payment_id
   where id = p_notification_id;

  return jsonb_build_object(
    'applied', true,
    'payment_id', v_payment_id,
    'case_id', v_case_id
  );
exception
  when unique_violation then
    -- payments_succeeded_unique_idx or the one-approved-match index fired:
    -- a concurrent settlement won the race. Nothing was written (rollback).
    return jsonb_build_object('applied', false, 'reason', 'CONCURRENT_SETTLEMENT');
end;
$$;

-- service_role (BYPASSRLS) calls this from billing. Deny the exposed roles so
-- no signed-in user can settle payments via /rpc (0043 pattern).
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from public;
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from anon;
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from authenticated;
