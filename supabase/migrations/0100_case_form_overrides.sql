-- 0100 — Ola apelación (EOIR-26A): per-case FORM visibility overrides.
--
-- Mirrors case_requirement_overrides (documents) for FORMS. Admin/sales can hide an
-- OPTIONAL form (form_definitions.is_required=false, migration 0099) from a specific
-- case so the client never sees it — e.g. the EOIR-26A Fee Waiver when the appellant
-- will pay the fee. Only optional forms may be hidden (enforced in
-- cases.setFormVisibility). Restore = delete the row.
--
-- RLS mirrors case_requirement_overrides exactly (0004_cases.sql): the client reads
-- it (to compute their effective form list) but only staff with the cases module
-- write it.

create table if not exists public.case_form_overrides (
  id                 uuid    primary key default gen_random_uuid(),
  case_id            uuid    not null references public.cases(id) on delete cascade,
  form_definition_id uuid    not null references public.form_definitions(id) on delete cascade,
  party_id           uuid    references public.case_parties(id),
  is_hidden          boolean not null default false,
  created_by         uuid    references public.staff_profiles(user_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (case_id, form_definition_id, party_id)
);
comment on table public.case_form_overrides is
  'Per-case form visibility overrides by staff (admin/sales). Mirrors case_requirement_overrides for form_definitions. Only optional forms (is_required=false) may be hidden.';

drop trigger if exists trg_case_form_overrides_updated_at on public.case_form_overrides;
create trigger trg_case_form_overrides_updated_at
  before update on public.case_form_overrides
  for each row execute function public.set_updated_at();

alter table public.case_form_overrides enable row level security;

-- ── Policies (mirror case_requirement_overrides) ─────────────────────────────
-- Client reads to compute the effective form list (catalog ± overrides).
create policy case_form_overrides_select on public.case_form_overrides
  for select to authenticated
  using (
    (select public.is_case_member(case_id))
    or (select public.has_module('cases', false))
  );

create policy case_form_overrides_insert on public.case_form_overrides
  for insert to authenticated
  with check (
    (select public.has_module('cases', true))
    and created_by = (select auth.uid())
  );

create policy case_form_overrides_update on public.case_form_overrides
  for update to authenticated
  using      ( (select public.has_module('cases', true)) )
  with check ( (select public.has_module('cases', true)) );

create policy case_form_overrides_delete on public.case_form_overrides
  for delete to authenticated
  using ( (select public.has_module('cases', true)) );
