-- Migration 0019: Unique partial index for active Stripe payment per installment
--
-- BLOCKER-2 (F6-Ola1 code-review fix): prevents the double-checkout TOCTOU race.
-- The BD acts as the mutex: createCheckoutSessionForInstallment inserts the payment
-- row BEFORE calling Stripe. If a concurrent request tries to insert a second
-- pending/stripe row for the same installment_id, this index raises 23505 and the
-- service maps it to BillingError("PAYMENT_IN_PROGRESS").
--
-- Same pattern as ledger_entries_payment_kind_unique_idx (partial unique index).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.payments_active_stripe_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS payments_active_stripe_unique_idx
  ON public.payments (installment_id)
  WHERE status = 'pending' AND method = 'stripe';
