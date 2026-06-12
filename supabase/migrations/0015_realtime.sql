-- =============================================================================
-- 0015_realtime.sql
-- Realtime publication + policies on realtime.messages for private channels
-- Depends on: 0010 (messages), 0011 (notifications)
-- =============================================================================
-- DOC-25 §1: ONLY public.messages and public.notifications are added to
-- supabase_realtime. All other tables use server-sent events or polling.
--
-- Private channel topology (DOC-25 §1.3, Proposal P5):
--   user:{user_id}           => personal notifications + call.incoming ringing
--   conv:{conversation_id}   => messaging thread (postgres_changes on messages)
--   board:{board_id}         => kanban live updates (broadcast card.moved)
--   team:{org_id}            => team presence (staff track; clients observe)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Publication: add ONLY the two approved tables
-- The publication supabase_realtime is pre-created by Supabase; we add tables.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;


-- ---------------------------------------------------------------------------
-- realtime.messages policies — private channel authorization
-- ---------------------------------------------------------------------------
-- Principle: any channel prefix NOT covered below is implicitly denied
-- (deny-by-default). A malformed UUID in split_part cast throws a cast error,
-- which Supabase Realtime treats as a deny.

-- ── user:{user_id} — personal channel (notifications + call.incoming) ──────
-- SELECT (subscribe): only the channel owner
-- INSERT (broadcast acks/self events): only the channel owner
-- The server broadcasts call.incoming with service_role (BYPASSRLS).
create policy "rt user select"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() = 'user:' || (select auth.uid())::text
  );

create policy "rt user insert"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() = 'user:' || (select auth.uid())::text
  );


-- ── conv:{conversation_id} — messaging thread ────────────────────────────────
-- postgres_changes on messages is the source of truth; no INSERT policy needed
-- for client broadcast here (typing indicators, if added in V2.x, go here).
-- SELECT: conversation participant
create policy "rt conv select"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'conv:%'
    and (select public.is_conversation_participant(
           split_part(realtime.topic(), ':', 2)::uuid
         ))
  );


-- ── board:{board_id} — kanban live updates ───────────────────────────────────
-- SELECT: board owner or admin
-- INSERT: board owner or admin (card.moved broadcast; normally emitted server-side)
create policy "rt board select"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'board:%'
    and exists (
      select 1 from public.kanban_boards b
       where b.id = split_part(realtime.topic(), ':', 2)::uuid
         and (
           b.owner_staff_id = (select auth.uid())
           or (select public.is_admin())
         )
    )
  );

create policy "rt board insert"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'board:%'
    and exists (
      select 1 from public.kanban_boards b
       where b.id = split_part(realtime.topic(), ':', 2)::uuid
         and (
           b.owner_staff_id = (select auth.uid())
           or (select public.is_admin())
         )
    )
  );


-- ── team:{org_id} — team presence ────────────────────────────────────────────
-- SELECT (observe): any active user of the org (client sees "Online" indicator)
-- INSERT (track presence): ONLY staff (clients do not publish presence, DOC-25 §1.7)
create policy "rt team select"
  on realtime.messages for select to authenticated
  using (
    realtime.topic() = 'team:' || (select public.auth_org_id())::text
    and (
      (select public.is_staff())
      or (select public.is_client())
    )
  );

create policy "rt team insert"
  on realtime.messages for insert to authenticated
  with check (
    realtime.topic() = 'team:' || (select public.auth_org_id())::text
    and (select public.is_staff())
  );

-- Notes:
-- (a) Helper functions (security definer) from 0001 work here because
--     realtime.messages uses auth.uid() / auth.jwt() from the same session context.
-- (b) No other topic prefix has a policy => any private channel outside
--     user:/conv:/board:/team: is rejected (deny-by-default).
-- (c) split_part(...)::uuid raises a cast error on malformed topics => treated as deny.
