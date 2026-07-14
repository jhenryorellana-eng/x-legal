-- ============================================================
-- 0085_case_number_format_and_org_prefix.sql
-- Nueva nomenclatura de casos: U26-000018 = {marca}{año 2 díg}-{correlativo 6 díg}.
--
-- Cambia el formato del número de caso de `ULP-YYYY-NNNN` (prefijo fijo, año 4 díg,
-- correlativo 4 díg → tope 9 999/año) a `{PREFIX}{YY}-{NNNNNN}` (correlativo 6 díg
-- → 1 millón/año por marca). La "marca" (prefijo) deja de estar hardcodeada y pasa
-- a ser configurable por-org en `orgs.settings.case_prefix` (default 'U' = USALatino),
-- lo que deja el sistema multi-marca-ready sin tocar código a futuro.
--
--  1. orgs.settings.case_prefix — se fija 'U' para el/los org existentes (visible/configurable).
--  2. next_case_number()        — lee el prefijo del org y compone el formato nuevo.
--  3. Backfill                  — reformatea los casos existentes PRESERVANDO el correlativo
--                                 (ULP-2026-0015 → U26-000015). El contador no se toca.
--
-- El contador `_case_number_counters` (PK org_id, year) ya reinicia por año y por org
-- (org == marca hoy) — NO cambia de esquema ni de valor.
--
-- ⚠ Limitación aceptada (decisión de Henry): el año a 2 dígitos hace que la cadena se
-- repita en 100 años (U26-… reaparece en 2126); el UNIQUE de cases.case_number lo
-- rechazaría entonces. Aceptable para el horizonte del producto.
-- ============================================================

-- ── 1. Prefijo de marca por-org (settings bag) ─────────────────────────────────
-- Se fija 'U' para cualquier org que aún no tenga la clave. La función igual hace
-- coalesce a 'U', así que esto es sólo para dejarlo explícito/editable por el admin.
update public.orgs
set settings = jsonb_set(settings, '{case_prefix}', '"U"', true)
where settings->>'case_prefix' is null;

-- ── 2. Generador de número de caso — formato nuevo, prefijo por-org ─────────────
create or replace function public.next_case_number(org uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  yr     integer := extract(year from now());
  seq    integer;
  prefix text;
begin
  -- Marca del org (settings.case_prefix); default 'U' si falta la clave o el row.
  select coalesce(nullif(o.settings->>'case_prefix', ''), 'U')
    into prefix
    from public.orgs o
   where o.id = org;
  prefix := coalesce(prefix, 'U');

  -- Contador atómico por (org, año): el upsert incrementa y lee en una sola sentencia.
  insert into public._case_number_counters (org_id, year, last_seq)
  values (org, yr, 1)
  on conflict (org_id, year) do update
    set last_seq = public._case_number_counters.last_seq + 1
  returning last_seq into seq;

  -- {PREFIX}{YY}-{NNNNNN}  p.ej. U26-000018
  return prefix || lpad((yr % 100)::text, 2, '0') || '-' || lpad(seq::text, 6, '0');
end;
$$;

-- ── 3. Backfill de casos existentes (preserva el correlativo) ──────────────────
-- Sólo filas con el formato viejo ULP-YYYY-NNNN. Todas pertenecen al org USALatino
-- (prefijo 'U'), así que se hardcodea 'U' en este reformateo puntual. Idempotente:
-- una vez migradas, dejan de matchear el patrón.
update public.cases
set case_number =
      'U'
      || lpad((split_part(case_number, '-', 2)::int % 100)::text, 2, '0')
      || '-'
      || lpad(split_part(case_number, '-', 3)::int::text, 6, '0')
where case_number ~ '^ULP-\d{4}-\d+$';

comment on column public.cases.case_number is
  'Business id: {PREFIX}{YY}-{NNNNNN} vía next_case_number(). PREFIX = orgs.settings.case_prefix (default U). Ej.: U26-000018.';
