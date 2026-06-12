-- =============================================================================
-- 0010_messaging.sql
-- Block 10: messaging (4 tables)
-- Depends on: 0004_cases.sql (cases, users, orgs),
--             0003_leads_kanban.sql (leads),
--             0007_scheduling.sql (appointments)
-- Defines: is_conversation_participant(uuid) helper (table exists now)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- RLS helper: is_conversation_participant
-- Defined here because conversation_participants table is created in this file.
-- The function is referenced by RLS policies below and by 0015_realtime.sql.
-- ---------------------------------------------------------------------------
create or replace function public.is_conversation_participant(conv uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversation_participants cp
      join public.users u on u.id = cp.user_id
     where cp.conversation_id = conv
       and cp.user_id = (select auth.uid())
       and u.is_active
  )
$$;

-- Grant to authenticated (mirrors the pattern of helpers in 0001)
grant execute on function public.is_conversation_participant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- conversations  (root table: carries org_id)
-- ---------------------------------------------------------------------------
create table public.conversations (
  id              uuid        primary key default gen_random_uuid(),
  org_id          uuid        not null references public.orgs(id) on delete restrict,
  scope           text        not null check (scope in ('case','lead','support')),
  case_id         uuid        references public.cases(id) on delete restrict,
  lead_id         uuid        references public.leads(id) on delete restrict,
  title           text,       -- e.g. "Re: Visa Juvenil de Mateo"
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Each case has exactly one conversation thread
  unique (case_id) where (scope = 'case'),

  -- Enforce scope <-> FK alignment:
  --   scope='case'  requires case_id  not null (and lead_id null implied by the unique + check)
  --   scope='lead'  requires lead_id  not null
  --   scope='support' allows both null
  check (
    (scope = 'case') = (case_id is not null)
    and (scope = 'lead') = (lead_id is not null)
  )
);

-- Indexes for common queries
create index conversations_case_id_idx
  on public.conversations (case_id);

create index conversations_last_message_at_idx
  on public.conversations (last_message_at desc);

create trigger set_updated_at_conversations
  before update on public.conversations
  for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;

-- SELECT: participants and admin only (messaging module does NOT give global read)
create policy conversations_select on public.conversations
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      (select public.is_conversation_participant(id))
      or (select public.is_admin())
    )
  );

-- INSERT: staff with messaging module; automatic case threads created by service_role in F1
create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('messaging', true))
  );

-- UPDATE: service_role only (last_message_at maintained by trigger/service;
--          title editable via service with messaging edit — no policy for authenticated)

-- DELETE: denied

-- ---------------------------------------------------------------------------
-- conversation_participants
-- ---------------------------------------------------------------------------
create table public.conversation_participants (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id) on delete cascade,
  user_id          uuid        not null references public.users(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,  -- for unread badges (GRANT update on last_read_at only, N2)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create trigger set_updated_at_conversation_participants
  before update on public.conversation_participants
  for each row execute function public.set_updated_at();

alter table public.conversation_participants enable row level security;

-- SELECT: a participant sees who else is in their threads; admin sees all
create policy conversation_participants_select on public.conversation_participants
  for select to authenticated
  using (
    (select public.is_conversation_participant(conversation_id))
    or (select public.is_admin())
  );

-- INSERT/DELETE: messaging staff who is already a participant; automatic additions via service_role
create policy conversation_participants_insert on public.conversation_participants
  for insert to authenticated
  with check (
    (select public.has_module('messaging', true))
    and (select public.is_conversation_participant(conversation_id))
  );

create policy conversation_participants_delete on public.conversation_participants
  for delete to authenticated
  using (
    (select public.has_module('messaging', true))
    and (select public.is_conversation_participant(conversation_id))
  );

-- UPDATE: owner only (last_read_at badge mark; column restricted by GRANT in N2)
create policy conversation_participants_update on public.conversation_participants
  for update to authenticated
  using  (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table public.messages (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id) on delete restrict,
  sender_user_id   uuid        references public.users(id) on delete restrict,  -- null => kind='system'
  kind             text        not null default 'text'
                               check (kind in ('text','system','attachment','call_summary')),
  body             text,
  -- Optional AI translation: {lang, text}
  body_translated  jsonb,
  -- [{path, name, mime, size}] from bucket 'chat-attachments'
  attachments      jsonb       not null default '[]',
  created_at       timestamptz not null default now()
  -- No updated_at: messages are immutable (trigger N3 blocks UPDATE/DELETE)
);

-- Index for paginated message loading (cursor-based, newest first)
create index messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at desc);

-- Note: no set_updated_at trigger (messages table has no updated_at column)

alter table public.messages enable row level security;

-- SELECT: participants and admin (also authorizes the Realtime conv:{id} channel)
create policy messages_select on public.messages
  for select to authenticated
  using (
    (select public.is_conversation_participant(conversation_id))
    or (select public.is_admin())
  );

-- INSERT: participant sending their own message (text or attachment only)
--         'system' and 'call_summary' kinds are inserted by service_role
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    (select public.is_conversation_participant(conversation_id))
    and sender_user_id = (select auth.uid())
    and kind in ('text','attachment')
  );

-- UPDATE/DELETE: denied (immutable; body_translated written by service_role job)

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
create table public.calls (
  id               uuid        primary key default gen_random_uuid(),
  conversation_id  uuid        not null references public.conversations(id) on delete restrict,
  appointment_id   uuid        references public.appointments(id) on delete restrict,
  -- LiveKit room name ('call:{id}' | 'appt:{appointment_id}')
  livekit_room     text        not null unique,
  kind             text        not null check (kind in ('audio','video')),
  status           text        not null default 'ringing'
                               check (status in ('ringing','active','ended','missed','declined','cancelled')),
  started_by       uuid        not null references public.users(id) on delete restrict,
  started_at       timestamptz not null,
  answered_at      timestamptz,
  ended_at         timestamptz,
  duration_seconds integer,
  -- Snapshot: [{user_id, joined_at, left_at}]
  participants     jsonb       not null default '[]',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Only one live call per conversation at a time
  unique (conversation_id) where (status in ('ringing','active'))
);

-- Index for call history by conversation
create index calls_conversation_started_at_idx
  on public.calls (conversation_id, started_at desc);

create trigger set_updated_at_calls
  before update on public.calls
  for each row execute function public.set_updated_at();

alter table public.calls enable row level security;

-- SELECT: participants and admin
create policy calls_select on public.calls
  for select to authenticated
  using (
    (select public.is_conversation_participant(conversation_id))
    or (select public.is_admin())
  );

-- INSERT: a participant initiates a call (status must start as 'ringing')
create policy calls_insert on public.calls
  for insert to authenticated
  with check (
    (select public.is_conversation_participant(conversation_id))
    and started_by = (select auth.uid())
    and status = 'ringing'
  );

-- UPDATE: participants can close/decline (best-effort: endCall/declineCall).
--         Final truth (ended_at, duration_seconds, participants snapshot) is written
--         by the LiveKit webhook via service_role (DOC-25 §3).
create policy calls_update on public.calls
  for update to authenticated
  using ((select public.is_conversation_participant(conversation_id)))
  with check ((select public.is_conversation_participant(conversation_id)));

-- DELETE: denied
