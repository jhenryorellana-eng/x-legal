-- 0099 — Ola apelación (EOIR-26A): per-form optionality.
--
-- A form_definition can now be OPTIONAL (is_required=false), mirroring
-- required_document_types.is_required. An optional form is SHOWN BY DEFAULT but can
-- be hidden per-case by admin/sales via case_form_overrides (migration 0100) — the
-- EOIR-26A Fee Waiver is the first: shown on every appeal case, hidden by Vanessa
-- when the appellant will pay the $1,030 fee instead of requesting a waiver.
--
-- Default true keeps every existing form required/visible (no behavior change).
-- Idempotent: add column if not exists.

alter table public.form_definitions
  add column if not exists is_required boolean not null default true;

comment on column public.form_definitions.is_required is
  'False = optional form: shown by default but hideable per-case via case_form_overrides (admin/sales). True = always required/shown.';
