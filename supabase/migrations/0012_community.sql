-- =============================================================================
-- 0012_community.sql
-- Block 12: community_posts, community_reactions, community_comments
-- Depends on: 0001 (orgs, users, staff_profiles, set_updated_at)
-- =============================================================================
-- Intent: feed exclusive for authenticated clients of the org (read/react/comment);
-- staff with module 'community' publish and moderate.

-- ---------------------------------------------------------------------------
-- community_posts (root table ⌂)
-- ---------------------------------------------------------------------------
create table public.community_posts (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.orgs(id),
  author_staff_id   uuid        references public.staff_profiles(user_id),
  -- null => approved client testimonial
  author_display    text,
  -- e.g. "Lucía M. · Familia ULP · Texas"
  kind              text        not null default 'text'
                      check (kind in ('text','video','live')),
  body              text,
  video_url         text,
  live_starts_at    timestamptz,
  live_join_url     text,
  is_published      boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index community_posts_org_created_idx
  on public.community_posts (org_id, created_at desc);

drop trigger if exists set_community_posts_updated_at on public.community_posts;
create trigger set_community_posts_updated_at
  before update on public.community_posts
  for each row execute function public.set_updated_at();

alter table public.community_posts enable row level security;

-- SELECT: clients see published posts of their org; module 'community' sees all (drafts/hidden)
create policy community_posts_select on public.community_posts
  for select to authenticated
  using (
    org_id = (select public.auth_org_id())
    and (
      ( (select public.is_client()) and is_published )
      or (select public.has_module('community', false))
    )
  );

-- INSERT: staff with module 'community' only (clients never post directly)
create policy community_posts_insert on public.community_posts
  for insert to authenticated
  with check (
    org_id = (select public.auth_org_id())
    and (select public.has_module('community', true))
  );

-- UPDATE: staff with module 'community' (publish/hide/edit)
create policy community_posts_update on public.community_posts
  for update to authenticated
  using  ( org_id = (select public.auth_org_id())
           and (select public.has_module('community', true)) )
  with check ( org_id = (select public.auth_org_id())
               and (select public.has_module('community', true)) );

-- DELETE: staff with module 'community'
create policy community_posts_delete on public.community_posts
  for delete to authenticated
  using (
    (select public.has_module('community', true))
  );


-- ---------------------------------------------------------------------------
-- community_reactions
-- ---------------------------------------------------------------------------
create table public.community_reactions (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references public.community_posts(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  kind        text        not null check (kind in ('heart','fire','clap')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (post_id, user_id, kind)
);

drop trigger if exists set_community_reactions_updated_at on public.community_reactions;
create trigger set_community_reactions_updated_at
  before update on public.community_reactions
  for each row execute function public.set_updated_at();

alter table public.community_reactions enable row level security;

-- SELECT: anyone authenticated who can see the published post of their org
create policy community_reactions_select on public.community_reactions
  for select to authenticated
  using (
    exists (
      select 1 from public.community_posts p
       where p.id = post_id
         and p.org_id = (select public.auth_org_id())
         and p.is_published
    )
    and ( (select public.is_client()) or (select public.has_module('community', false)) )
  );

-- INSERT: authenticated client reacts to a published post of their org, as themselves
create policy community_reactions_insert on public.community_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_client())
    and exists (
      select 1 from public.community_posts p
       where p.id = post_id
         and p.org_id = (select public.auth_org_id())
         and p.is_published
    )
  );

-- UPDATE: denied (a reaction is removed and re-added, not edited)

-- DELETE: owner removes their own reaction; moderation by community module
create policy community_reactions_delete on public.community_reactions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('community', true))
  );


-- ---------------------------------------------------------------------------
-- community_comments
-- ---------------------------------------------------------------------------
create table public.community_comments (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references public.community_posts(id) on delete cascade,
  user_id     uuid        not null references public.users(id),
  body        text        not null,
  is_hidden   boolean     not null default false,  -- moderation flag
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index community_comments_post_created_idx
  on public.community_comments (post_id, created_at);

drop trigger if exists set_community_comments_updated_at on public.community_comments;
create trigger set_community_comments_updated_at
  before update on public.community_comments
  for each row execute function public.set_updated_at();

alter table public.community_comments enable row level security;

-- SELECT: hidden comments visible only to moderation (community module); clients see non-hidden on published posts
create policy community_comments_select on public.community_comments
  for select to authenticated
  using (
    exists (
      select 1 from public.community_posts p
       where p.id = post_id
         and p.org_id = (select public.auth_org_id())
         and p.is_published
    )
    and (
      ( (select public.is_client()) and not is_hidden )
      or (select public.has_module('community', false))
    )
  );

-- INSERT: authenticated client comments on a published post of their org, as themselves
create policy community_comments_insert on public.community_comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_client())
    and exists (
      select 1 from public.community_posts p
       where p.id = post_id
         and p.org_id = (select public.auth_org_id())
         and p.is_published
    )
  );

-- UPDATE: moderation only (hide/unhide); authors cannot edit (V2 simplicity)
create policy community_comments_update on public.community_comments
  for update to authenticated
  using  ( (select public.has_module('community', true)) )
  with check ( (select public.has_module('community', true)) );

-- DELETE: owner deletes their own comment; moderation can also delete
create policy community_comments_delete on public.community_comments
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_module('community', true))
  );
