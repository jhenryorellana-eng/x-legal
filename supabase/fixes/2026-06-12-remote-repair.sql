-- ============================================================================
-- REPARACIÓN REMOTA F0 — ejecutar UNA VEZ en el SQL Editor del proyecto
-- "USALATINO V2" (uexxyokexcamyjcknxua). 2026-06-12.
--
-- Por qué existe este archivo: el MCP de Supabase perdió permisos de escritura
-- a mitad de sesión, así que estos dos fixes (ya corregidos en los archivos
-- fuente del repo) no llegaron al remoto.
--
-- Después de ejecutarlo, ACTIVAR EL AUTH HOOK en el dashboard:
--   Authentication → Hooks → Custom Access Token → public.custom_access_token_hook
-- ============================================================================

-- ── Fix 1: usuarios seed insertados a mano en auth.users ─────────────────────
-- GoTrue escanea estas columnas string como NO-nulas; con NULL, cualquier
-- llamada de Auth devuelve 500 "Database error querying schema".
-- Además un teléfono sin phone_confirmed_at no es identidad de login OTP.
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change               = coalesce(email_change, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where id in (
  '00000000-0000-0000-0000-000000000001', -- Henry (admin)
  '00000000-0000-0000-0000-000000000002', -- Vanessa (sales)
  '00000000-0000-0000-0000-000000000003', -- Diana (paralegal)
  '00000000-0000-0000-0000-000000000004', -- Andrium (finance)
  '00000000-0000-0000-0000-000000000101', -- María (cliente demo +17865550101)
  '00000000-0000-0000-0000-000000000102'  -- Carlos (cliente demo +13055550102)
);

update auth.users set
  phone_confirmed_at = coalesce(phone_confirmed_at, now())
where id in (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102'
);

-- ── Fix 2: claim must_change_pw en el Auth Hook (hallazgo C-1 del review) ────
-- El middleware lee el JWT vía getClaims(), que NO expone app_metadata; el
-- flag de cambio forzado de contraseña debe viajar como claim top-level.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  u record;
begin
  select usr.org_id, usr.kind, sp.role
    into u
    from public.users usr
    left join public.staff_profiles sp on sp.user_id = usr.id
   where usr.id = (event->>'user_id')::uuid;

  claims := event->'claims';

  if u.org_id is not null then
    claims := jsonb_set(claims, '{org_id}',    to_jsonb(u.org_id::text));
    claims := jsonb_set(claims, '{user_kind}', to_jsonb(u.kind));
    claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(u.role), 'null'::jsonb));
  else
    claims := jsonb_set(claims, '{user_kind}', '"unprovisioned"');
  end if;

  claims := jsonb_set(
    claims,
    '{must_change_pw}',
    coalesce(
      (select to_jsonb(coalesce((au.raw_app_meta_data ->> 'must_change_password')::boolean, false))
         from auth.users au
        where au.id = (event->>'user_id')::uuid),
      'false'::jsonb
    )
  );

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Verificación rápida (debe devolver 6 filas, todas con tokens = ''):
select id, email, phone, phone_confirmed_at is not null as phone_ok,
       confirmation_token = '' as tokens_ok
  from auth.users
 where id::text like '00000000-0000-0000-0000-0000000001%'
    or id::text like '00000000-0000-0000-0000-00000000000%'
 order by id;
