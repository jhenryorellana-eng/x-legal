-- 0094_lex_tab_role_access_seed.sql
-- Seed que faltó en 0093 (precedente: 0083 con "notas"): la resolución de
-- pestañas trata a un rol CON filas en case_tab_role_access como "configurado"
-- y usa exactamente ese conjunto — un tab nuevo sin fila queda oculto para toda
-- org que ya configuró la matriz. Hace visible "lex" para esos roles.
--
-- Nota operativa: para la org existente esto ya se aplicó manualmente vía
-- /admin/configuracion/tabs-caso el 2026-07-18 (verificación en vivo de la ola
-- Lex), así que aplicar esta migración ahí es un no-op. Queda versionada por
-- consistencia del historial de migraciones y como recordatorio del patrón:
-- CADA pestaña nueva del workspace de caso necesita su seed (o nace oculta).
-- Idempotent.

insert into public.case_tab_role_access (org_id, role, tab_id, enabled)
select distinct org_id, role, 'lex', true
  from public.case_tab_role_access
 where tab_id <> 'lex'
on conflict (org_id, role, tab_id) do nothing;
