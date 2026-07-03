-- ============================================================
-- 0062 — search_clients_for_staff RPC (RF-VAN-018)
--
-- Server-side client search for the "Nuevo caso" modal step 1
-- ("¿Para quién es el caso?"): find existing clients by name
-- (fuzzy, uses the trigram GIN index client_profiles_name_trgm_idx
-- from 0001), email, or phone digits — plus the client's case
-- count so the picker can show "N casos" per RF-VAN-018.
--
-- Empty query returns the most recent clients (picker default list).
-- Executed exclusively via service_role from identity/repository.ts
-- (the server action gates on can(actor,'clients','view')).
-- ============================================================

create or replace function public.search_clients_for_staff(
  p_org   uuid,
  p_query text,
  p_limit int default 8
)
returns table (
  user_id    uuid,
  first_name text,
  last_name  text,
  email      text,
  phone_e164 text,
  address    jsonb,
  case_count bigint
)
language sql
stable
set search_path = ''
as $$
  select
    u.id as user_id,
    cp.first_name,
    cp.last_name,
    u.email,
    u.phone_e164,
    cp.address,
    (select count(*) from public.cases c where c.primary_client_id = u.id) as case_count
  from public.users u
  join public.client_profiles cp on cp.user_id = u.id
  where u.org_id = p_org
    and u.kind = 'client'
    and u.is_active
    and (
      btrim(coalesce(p_query, '')) = ''
      -- Same concatenation expression as client_profiles_name_trgm_idx (0001)
      or (cp.first_name || ' ' || cp.last_name) ilike '%' || btrim(p_query) || '%'
      or u.email ilike '%' || btrim(p_query) || '%'
      or (
        regexp_replace(coalesce(p_query, ''), '\D', '', 'g') <> ''
        and u.phone_e164 like '%' || regexp_replace(p_query, '\D', '', 'g') || '%'
      )
    )
  order by
    case
      when btrim(coalesce(p_query, '')) = '' then null
      else public.similarity(cp.first_name || ' ' || cp.last_name, btrim(p_query))
    end desc nulls last,
    u.created_at desc
  limit least(greatest(coalesce(p_limit, 8), 1), 20);
$$;

comment on function public.search_clients_for_staff(uuid, text, int) is
  'Client picker search for the "Nuevo caso" modal (RF-VAN-018): name (trigram) / email / phone-digit match within an org, with per-client case count. service_role only; authz lives in identity.searchClients. See migration 0062.';

revoke all on function public.search_clients_for_staff(uuid, text, int) from public, anon, authenticated;
grant execute on function public.search_clients_for_staff(uuid, text, int) to service_role;
