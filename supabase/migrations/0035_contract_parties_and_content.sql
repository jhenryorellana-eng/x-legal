-- ============================================================
-- 0035_contract_parties_and_content.sql
-- Contract-aware party roles + per-service contract content (DOC-41 / DOC-51).
--
-- 1) service_party_roles.include_in_contract — whether parties of this role are
--    listed/committed in the signed contract. INDEPENDENT of is_required (which
--    governs case data-entry) and of cardinality. The applicant/"petitioner" is
--    implicit and ALWAYS in the contract. Default true → existing behaviour
--    (all declared parties appear) is preserved on backfill.
--
-- 2) services contract content — the per-service formal contract text rendered in
--    the signing page + signed PDF (mirrors the legacy jsPDF sections):
--      - contract_object_i18n        OBJETO DEL CONTRATO         {es,en}
--      - contract_scope_i18n         ALCANCE DEL SERVICIO (list) {es:[],en:[]}
--      - contract_special_clause_i18n CLÁUSULA ESPECIAL (opt)    {es,en}
--    Universal boilerplate (gastos/naturaleza/obligaciones/cancelación/firmas)
--    lives in code (contracts/contract-boilerplate.ts), not per service.
--
-- Depends on: 0002_catalog, 0023_service_party_roles
-- Additive only (new nullable/defaulted columns). Safe to apply to a live DB.
-- ============================================================

alter table public.service_party_roles
  add column if not exists include_in_contract boolean not null default true;

comment on column public.service_party_roles.include_in_contract is
  'Whether parties of this role are listed/committed in the contract. Independent of is_required and cardinality. The implicit applicant (petitioner) is always included.';

alter table public.services
  add column if not exists contract_object_i18n        jsonb,
  add column if not exists contract_scope_i18n         jsonb,
  add column if not exists contract_special_clause_i18n jsonb;

comment on column public.services.contract_object_i18n is
  'OBJETO DEL CONTRATO — per-service legal purpose text {es,en}.';
comment on column public.services.contract_scope_i18n is
  'ALCANCE DEL SERVICIO — per-service ordered scope/stages list {es:[],en:[]}.';
comment on column public.services.contract_special_clause_i18n is
  'CLÁUSULA ESPECIAL — optional per-service special clause {es,en}.';
