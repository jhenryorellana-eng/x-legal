-- ---------------------------------------------------------------------------
-- 0061_zelle_proof_required.sql
--
-- Zelle payments MUST carry a comprobante (Henry 2026-07-02):
--   1) Cleanup: revert the proof-less demo Zelle payment (test data from the
--      old "Registrar pago" button that skipped the upload). Written
--      generically: any zelle payment without proof is reverted.
--   2) CHECK constraint — the hard guarantee. The billing service writes with
--      service_role (bypasses RLS), so RLS alone cannot enforce this invariant.
--   3) RLS: tighten payments_insert_client so a client insert requires the
--      proof path (defense in depth for direct PostgREST writes).
--
-- Timeline projections (payment.received / downpayment.confirmed) are left
-- untouched: case_timeline is the immutable activity log.
-- ---------------------------------------------------------------------------

-- 1) Cleanup (order matters: ledger → installment revert → payment delete)

delete from public.ledger_entries le
 using public.payments p
 where le.payment_id = p.id
   and p.method = 'zelle'
   and p.zelle_proof_path is null;

-- Revert installments whose ONLY successful payment was a proof-less zelle one.
update public.installments i
   set status = 'pending',
       paid_at = null
 where i.status = 'paid'
   and exists (
     select 1 from public.payments p
      where p.installment_id = i.id
        and p.method = 'zelle'
        and p.zelle_proof_path is null
        and p.status = 'succeeded'
   )
   and not exists (
     select 1 from public.payments p2
      where p2.installment_id = i.id
        and p2.status = 'succeeded'
        and (p2.method <> 'zelle' or p2.zelle_proof_path is not null)
   );

delete from public.payments
 where method = 'zelle'
   and zelle_proof_path is null;

-- 2) Hard invariant: no Zelle payment without its comprobante

alter table public.payments
  add constraint payments_zelle_requires_proof
  check (method <> 'zelle' or zelle_proof_path is not null);

-- 3) RLS: client inserts must include the proof path (was: proof optional)

drop policy payments_insert_client on public.payments;
create policy payments_insert_client on public.payments
  for insert to authenticated
  with check (
    method = 'zelle'
    and status = 'pending'
    and zelle_proof_path is not null
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
