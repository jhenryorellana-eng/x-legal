-- =============================================================================
-- 0006_billing.sql
-- Block 6: billing (5 tables)
-- Depends on: 0005_contracts.sql (contracts, cases, users, staff_profiles, leads)
-- Helpers assumed: is_staff(), is_client(), is_admin(), has_module(), is_case_member(),
--                  auth_org_id(), staff_role(), set_updated_at()
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payment_plans
-- ---------------------------------------------------------------------------
create table public.payment_plans (
  id                 uuid        primary key default gen_random_uuid(),
  contract_id        uuid        not null unique references public.contracts(id) on delete restrict,
  total_cents        integer     not null,
  downpayment_cents  integer     not null default 0,
  -- Domain rule: downpayment_cents must be > 0 before contract is sent to signing.
  -- Enforced in service layer (not here) because the check only applies at the
  -- 'sent' transition, not on raw INSERT (draft plans start at 0).
  installment_count  integer     not null default 1,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_updated_at_payment_plans
  before update on public.payment_plans
  for each row execute function public.set_updated_at();

alter table public.payment_plans enable row level security;

-- Client reads their plan via contract -> case membership
create policy payment_plans_select on public.payment_plans
  for select to authenticated
  using (
    (select public.has_module('billing', false))
    or exists (
      select 1
        from public.contracts c
       where c.id = payment_plans.contract_id
         and c.case_id is not null
         and (select public.is_case_member(c.case_id))
    )
  );

-- INSERT/UPDATE: billing staff (initial plan also created by service_role in F1)
create policy payment_plans_insert on public.payment_plans
  for insert to authenticated
  with check (
    (select public.has_module('billing', true))
    and exists (
      select 1
        from public.contracts c
        join public.orgs o on o.id = c.org_id
       where c.id = payment_plans.contract_id
         and o.id = (select public.auth_org_id())
    )
  );

create policy payment_plans_update on public.payment_plans
  for update to authenticated
  using      ((select public.has_module('billing', true)))
  with check ((select public.has_module('billing', true)));

-- DELETE: denied (no policy)

-- ---------------------------------------------------------------------------
-- installments
-- ---------------------------------------------------------------------------
create table public.installments (
  id                  uuid        primary key default gen_random_uuid(),
  payment_plan_id     uuid        not null references public.payment_plans(id) on delete restrict,
  number              integer     not null,
  is_downpayment      boolean     not null default false,
  amount_cents        integer     not null,
  due_date            date        not null,
  status              text        not null default 'pending'
                                  check (status in ('pending','processing','paid','overdue','waived')),
  paid_at             timestamptz,
  last_reminder_at    timestamptz,  -- idempotency for due-3d/due-day/overdue reminders
  waived_by           uuid        references public.staff_profiles(user_id) on delete restrict,
  waived_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (payment_plan_id, number)
);

-- Index for cron job: expire pending installments and send reminders
create index installments_status_due_date_idx
  on public.installments (status, due_date);

create trigger set_updated_at_installments
  before update on public.installments
  for each row execute function public.set_updated_at();

alter table public.installments enable row level security;

-- Client reads their installments (their plan -> contract -> case membership)
-- Also accessible by billing and collections modules
create policy installments_select on public.installments
  for select to authenticated
  using (
    (select public.has_module('billing', false))
    or (select public.has_module('collections', false))
    or exists (
      select 1
        from public.payment_plans pp
        join public.contracts c on c.id = pp.contract_id
       where pp.id = installments.payment_plan_id
         and c.case_id is not null
         and (select public.is_case_member(c.case_id))
    )
  );

-- INSERT/UPDATE: billing staff (status transitions by service_role webhook/cron)
create policy installments_insert on public.installments
  for insert to authenticated
  with check ((select public.has_module('billing', true)));

create policy installments_update on public.installments
  for update to authenticated
  using      ((select public.has_module('billing', true)))
  with check ((select public.has_module('billing', true)));

-- DELETE: denied

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table public.payments (
  id                          uuid        primary key default gen_random_uuid(),
  installment_id              uuid        not null references public.installments(id) on delete restrict,
  method                      text        not null check (method in ('stripe','zelle')),
  amount_cents                integer     not null,
  stripe_payment_intent_id    text        unique,  -- Stripe idempotency
  stripe_checkout_session_id  text        unique,  -- session correlation and expiry
  zelle_proof_path            text,                -- proof uploaded (bucket 'payment-proofs')
  status                      text        not null default 'pending'
                                          check (status in ('pending','succeeded','failed','refunded','rejected')),
  confirmed_by                uuid        references public.staff_profiles(user_id) on delete restrict,
  confirmed_at                timestamptz,
  payer_user_id               uuid        references public.users(id) on delete restrict,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger set_updated_at_payments
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

-- SELECT: client via installment -> plan -> contract -> case membership; billing staff
create policy payments_select on public.payments
  for select to authenticated
  using (
    (select public.has_module('billing', false))
    or exists (
      select 1
        from public.installments i
        join public.payment_plans pp on pp.id = i.payment_plan_id
        join public.contracts c on c.id = pp.contract_id
       where i.id = payments.installment_id
         and c.case_id is not null
         and (select public.is_case_member(c.case_id))
    )
  );

-- INSERT client: Zelle proof registration (client uploads their own comprobante)
create policy payments_insert_client on public.payments
  for insert to authenticated
  with check (
    method = 'zelle'
    and status = 'pending'
    and payer_user_id = (select auth.uid())
    and exists (
      select 1
        from public.installments i
        join public.payment_plans pp on pp.id = i.payment_plan_id
        join public.contracts c on c.id = pp.contract_id
       where i.id = payments.installment_id
         and c.case_id is not null
         and (select public.is_case_member(c.case_id))
    )
  );

-- INSERT staff: manual payment record by Andrium
create policy payments_insert_staff on public.payments
  for insert to authenticated
  with check ((select public.has_module('billing', true)));

-- UPDATE: Zelle confirmation/rejection by Andrium; Stripe cycle is service_role
create policy payments_update on public.payments
  for update to authenticated
  using      ((select public.has_module('billing', true)) and confirmed_by = (select auth.uid()))
  with check ((select public.has_module('billing', true)));

-- DELETE: denied

-- ---------------------------------------------------------------------------
-- stripe_customers
-- ---------------------------------------------------------------------------
create table public.stripe_customers (
  user_id            uuid        primary key references public.users(id) on delete cascade,
  stripe_customer_id text        not null unique,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger set_updated_at_stripe_customers
  before update on public.stripe_customers
  for each row execute function public.set_updated_at();

alter table public.stripe_customers enable row level security;

-- SELECT: owner reads their own Stripe customer record; billing reads all
create policy stripe_customers_select on public.stripe_customers
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('billing', false))
  );

-- INSERT/UPDATE/DELETE: service_role only (Stripe sync)
-- No policy for authenticated => denied by default

-- ---------------------------------------------------------------------------
-- ledger_entries
-- ---------------------------------------------------------------------------
create table public.ledger_entries (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references public.orgs(id) on delete restrict,
  entry_date   date        not null,
  kind         text        not null check (kind in ('income','expense')),
  -- Category is free-text with autocomplete (no enum per DOC-30 §6).
  -- Suggested values: cuota, marketing, impresion, salario, reembolso, otros
  category     text        not null,
  amount_cents integer     not null,
  description  text,
  case_id      uuid        references public.cases(id) on delete restrict,
  payment_id   uuid        references public.payments(id) on delete restrict,
  recorded_by  uuid        references public.staff_profiles(user_id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Accounting idempotency: one auto-generated entry per payment per kind
  unique (payment_id, kind) where payment_id is not null
);

-- Index for ledger listing by org and date
create index ledger_entries_org_entry_date_idx
  on public.ledger_entries (org_id, entry_date);

create trigger set_updated_at_ledger_entries
  before update on public.ledger_entries
  for each row execute function public.set_updated_at();

alter table public.ledger_entries enable row level security;

-- SELECT: only finance + admin (accounting module per DOC-31 §4 Bloque 6)
create policy ledger_entries_select on public.ledger_entries
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('accounting', false))
  );

-- INSERT: manual entries by Andrium/admin; auto-generated entries use service_role
create policy ledger_entries_insert on public.ledger_entries
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('accounting', true))
    and recorded_by = (select auth.uid())
  );

-- UPDATE: Andrium can update his own entries; admin can update any
create policy ledger_entries_update on public.ledger_entries
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (select public.has_module('accounting', true))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('accounting', true))
  );

-- DELETE: admin only (correcting erroneous entries; recorded in audit_log)
create policy ledger_entries_delete on public.ledger_entries
  for delete to authenticated
  using (
    (select public.is_admin())
    and org_id = (select public.auth_org_id())
  );
