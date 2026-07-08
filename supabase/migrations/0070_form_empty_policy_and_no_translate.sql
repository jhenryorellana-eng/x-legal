-- 0070_form_empty_policy_and_no_translate.sql
-- Admin-configurable EMPTY-FIELD fill policy (blank / N/A / custom) + a per-field
-- VERBATIM flag (never translate/PII-mask a value written to the PDF).
-- Additive and reversible. See src/shared/form-logic/empty-policy.ts, DOC-40.

-- Version-wide default: how an APPLICABLE-but-EMPTY field renders in the PDF.
--   auto  = legacy (only free-text text/textarea → "N/A"; dates/selects stay blank)
--   na    = every text-backed empty (text/textarea/date) → "N/A"
--   blank = leave every empty field blank
alter table public.form_automation_versions
  add column if not exists default_empty_policy text not null default 'auto'
    check (default_empty_policy in ('auto', 'na', 'blank'));

-- Per-field override of the version default.
--   inherit = use the version default
--   na | blank | custom  (custom stamps `empty_placeholder`)
alter table public.form_questions
  add column if not exists empty_policy text not null default 'inherit'
    check (empty_policy in ('inherit', 'na', 'blank', 'custom'));

alter table public.form_questions
  add column if not exists empty_placeholder text;

-- Verbatim: write the answer to the PDF EXACTLY as stored — never machine-translated
-- nor PII-masked (A-Numbers, SSNs, passports, names, cities). This keeps a `maskPii`
-- output (e.g. "A-•••-•••") off the federal form.
alter table public.form_questions
  add column if not exists no_translate boolean not null default false;

comment on column public.form_automation_versions.default_empty_policy is
  'Form-wide default for empty APPLICABLE fields: auto|na|blank. Overridable per question via form_questions.empty_policy.';
comment on column public.form_questions.empty_policy is
  'Empty-fill policy: inherit|na|blank|custom. inherit defers to the version default_empty_policy.';
comment on column public.form_questions.empty_placeholder is
  'Placeholder string used when empty_policy = custom (falls back to "N/A").';
comment on column public.form_questions.no_translate is
  'When true, the answer is written to the PDF verbatim — never translated nor PII-masked.';
