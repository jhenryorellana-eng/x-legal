-- =============================================================================
-- 0043_promotion_claim_rpc.sql
-- Atomic coupon-use claim — closes the redeem TOCTOU (review CRITICAL-2).
-- Depends on: 0042 (promotions)
-- =============================================================================

-- Increments used_count under a row lock ONLY when the promo is active, within its
-- validity window, and below max_uses. Returns true on a successful claim, false
-- when the coupon is exhausted/inactive/expired. The single conditional UPDATE is
-- atomic, so concurrent redemptions can never exceed max_uses.
create or replace function public.claim_promotion_use(p_promo_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  update public.promotions
     set used_count = used_count + 1,
         updated_at = now()
   where id = p_promo_id
     and is_active
     and (max_uses is null or used_count < max_uses)
     and (valid_from is null or now() >= valid_from)
     and (valid_until is null or now() <= valid_until)
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

-- service_role (BYPASSRLS) calls this from the retention repository. Deny the
-- exposed roles so no signed-in user can bump a counter directly via /rpc.
revoke all on function public.claim_promotion_use(uuid) from public;
revoke all on function public.claim_promotion_use(uuid) from anon;
revoke all on function public.claim_promotion_use(uuid) from authenticated;
