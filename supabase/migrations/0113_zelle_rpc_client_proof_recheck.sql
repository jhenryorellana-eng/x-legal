-- =============================================================================
-- 0113_zelle_rpc_client_proof_recheck.sql
-- Review finding #2 (code-reviewer, 2026-07-23): the atomic settlement RPC
-- re-checked stripe-pending but NOT a pending client-uploaded Zelle proof.
-- A proof uploaded in the scoring→settlement window must win (link, don't
-- duplicate — the inbox confirm flow settles THAT payment instead).
-- CREATE OR REPLACE of apply_zelle_auto_payment with the extra precondition.
-- Applied to PROD via MCP (2026-07-23).
-- =============================================================================

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
  if exists (
    select 1 from public.payments
     where installment_id = p_installment_id
       and method = 'stripe' and status = 'pending'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'STRIPE_PENDING');
  end if;
  -- 0113: a client-uploaded proof pending verification wins — the inbox
  -- confirm flow links/settles THAT payment (never a duplicate bank_auto row).
  if exists (
    select 1 from public.payments
     where installment_id = p_installment_id
       and method = 'zelle' and status = 'pending'
  ) then
    return jsonb_build_object('applied', false, 'reason', 'CLIENT_PROOF_PENDING');
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
    return jsonb_build_object('applied', false, 'reason', 'CONCURRENT_SETTLEMENT');
end;
$$;

-- Re-assert the grants (CREATE OR REPLACE preserves ACLs, but keep it explicit).
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from public;
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from anon;
revoke all on function public.apply_zelle_auto_payment(uuid, uuid, uuid, integer, text, uuid, uuid) from authenticated;
