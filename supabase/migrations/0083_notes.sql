-- 0083_notes.sql
-- Case / lead notes with three visibility levels (general | team | personal).
--
-- Replaces the degenerate single-field mechanisms (kanban_cards.pinned_note —
-- dropped here) with a proper multi-note model. A note is anchored to EXACTLY
-- one subject: a case OR a lead (typed FKs, not polymorphic text) so referential
-- integrity + cascade deletes hold. Personal notes written at the lead stage
-- follow the person into the case: the case view unions notes whose lead_id maps
-- to the case via leads.won_case_id.
--
-- Visibility:
--   general  → client (in their case history) + all staff
--   team     → all staff of the org (admin/sales/paralegal/finance)
--   personal → only the author
--
-- RLS mirrors the canonical case_timeline pattern (has_module / is_case_member /
-- is_admin). Reads/writes go through the actor-bound client so RLS is the
-- authoritative gate; the service layer adds can() + a cross-org guard.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.notes (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.orgs(id)  on delete cascade,
  case_id         uuid        references public.cases(id)  on delete cascade,
  lead_id         uuid        references public.leads(id)  on delete cascade,
  author_user_id  uuid        not null references public.users(id),
  visibility      text        not null check (visibility in ('general', 'team', 'personal')),
  body            text        not null check (char_length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- exactly one anchor: case XOR lead
  constraint notes_one_anchor check ((case_id is not null) <> (lead_id is not null))
);

comment on table public.notes is
  'Case/lead notes with 3 visibility levels (general=client+staff, team=staff, personal=author). Anchored to exactly one of case_id/lead_id. Lead-stage notes surface in the case via leads.won_case_id.';

create index notes_case_idx
  on public.notes (case_id, created_at desc) where case_id is not null;
create index notes_lead_idx
  on public.notes (lead_id, created_at desc) where lead_id is not null;
create index notes_author_personal_idx
  on public.notes (author_user_id) where visibility = 'personal';

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.notes enable row level security;

-- SELECT (staff): case notes gate on the 'cases' module; lead notes gate on the
-- 'leads' module OR — once the lead is converted — the 'cases' module, so the
-- whole case team sees team/general notes carried over from the lead. Personal
-- notes are only ever visible to their author.
create policy notes_select_staff on public.notes
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (case_id is not null and (select public.has_module('cases', false)))
      or (lead_id is not null and (
            (select public.has_module('leads', false))
            or exists (
              select 1 from public.leads l
               where l.id = notes.lead_id
                 and l.won_case_id is not null
                 and (select public.has_module('cases', false))
            )
      ))
    )
    and (
      visibility in ('general', 'team')
      or (visibility = 'personal' and author_user_id = (select auth.uid()))
    )
  );

-- SELECT (client): only general notes on a case they are a member of.
create policy notes_select_client on public.notes
  for select to authenticated
  using (
    visibility = 'general'
    and case_id is not null
    and (select public.is_case_member(case_id))
  );

-- INSERT (staff): author = self, org matches, and the actor can VIEW the relevant
-- module (view is enough to contribute a note — finance participates too).
create policy notes_insert_staff on public.notes
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and author_user_id = (select auth.uid())
    and (
      (case_id is not null and (select public.has_module('cases', false)))
      or (lead_id is not null and (select public.has_module('leads', false)))
    )
  );

-- UPDATE / DELETE: the author or an org admin.
create policy notes_update on public.notes
  for update to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (author_user_id = (select auth.uid()) or (select public.is_admin()))
  )
  with check (
    org_id = (select public.auth_org_id())
    and (author_user_id = (select auth.uid()) or (select public.is_admin()))
  );

create policy notes_delete on public.notes
  for delete to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (author_user_id = (select auth.uid()) or (select public.is_admin()))
  );

-- ---------------------------------------------------------------------------
-- Seed: make the new "notas" case-workspace tab visible for orgs that already
-- configured per-role tab overrides (no rows ⇒ code default already shows it).
-- Idempotent.
-- ---------------------------------------------------------------------------

insert into public.case_tab_role_access (org_id, role, tab_id, enabled)
select distinct org_id, role, 'notas', true
  from public.case_tab_role_access
 where tab_id <> 'notas'
on conflict (org_id, role, tab_id) do nothing;

-- ---------------------------------------------------------------------------
-- Retire the legacy per-card pinned note (replaced by the notes system).
-- ---------------------------------------------------------------------------

alter table public.kanban_cards drop column if exists pinned_note;
