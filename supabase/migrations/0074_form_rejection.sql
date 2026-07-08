-- 0074: form response rejection flow (mirror of case_documents review).
--
-- Adds the `rejected` status + review metadata to case_form_responses so staff
-- can return a submitted form to the client for correction (RF-DIA-014 parity),
-- and the client can edit + resubmit it (rejected → submitted).
--
-- Notification wiring (form_response.approved / form_response.rejected → client,
-- form_response.submitted → sales) lives in the app layer (F2 matrix).

-- 1) Allow the new terminal-ish state 'rejected'.
alter table public.case_form_responses
  drop constraint if exists case_form_responses_status_check;
alter table public.case_form_responses
  add constraint case_form_responses_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected'));

-- 2) Review metadata (mirrors case_documents: reason i18n + reviewer + deadline).
alter table public.case_form_responses
  add column if not exists rejection_reason_i18n jsonb,
  add column if not exists reviewed_by            uuid references public.users(id),
  add column if not exists reviewed_at            timestamptz,
  add column if not exists correction_due_at      timestamptz;
comment on column public.case_form_responses.rejection_reason_i18n is
  'Bilingual staff reason shown to the client on rejection (amber, never red — RF-TRX-022).';

-- 3) Let the client edit + resubmit a rejected form.
-- Before: USING required status='draft', which locked a rejected form for the client.
-- After: the client may edit a 'draft' OR 'rejected' row, transitioning it back to
-- 'submitted' (WITH CHECK). Clients still can never set 'approved'/'rejected'.
drop policy if exists case_form_responses_update_client on public.case_form_responses;
create policy case_form_responses_update_client on public.case_form_responses
  for update to authenticated
  using  ( (select public.is_case_member(case_id)) and status in ('draft', 'rejected') )
  with check (
    (select public.is_case_member(case_id))
    and status in ('draft', 'submitted')
  );

-- 4) Harden the transition guard: only staff (or service_role, no auth.uid()) may
-- set 'approved' OR 'rejected'. Clients submit/resubmit, never self-review.
create or replace function public.enforce_form_response_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('approved', 'rejected') and old.status is distinct from new.status then
    if (select auth.uid()) is not null and not public.has_module('cases', true) then
      raise exception 'Only staff with cases module can approve or reject a form response'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.enforce_form_response_approval() from public, anon, authenticated;
