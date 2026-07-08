-- 0071b_i589_verbatim_scope_fix.sql
-- Hotfix for 0071 as originally applied to PROD: the `ilike '%Parte A.II%'` there also
-- matched 'Parte A.III' (substring), over-marking the Antecedentes section (addresses,
-- education, employment) as verbatim — which would leave occupation / school-type
-- untranslated. This reverts Part A.III to translatable. Its codes/dates are still covered
-- by the engine's isVerbatimValue heuristic and its proper nouns by the translator's
-- preserve-proper-nouns rule (the prior, tested behaviour).
-- Idempotent: 0071 now uses `like 'Parte A.II —%'`, so on a fresh apply this is a no-op.
update public.form_questions q
set no_translate = false
from public.form_question_groups g
where q.group_id = g.id
  and g.automation_version_id = '7de5f9de-6abe-4aa0-bb74-755eb38de867'
  and g.title_i18n->>'es' like 'Parte A.III%'
  and q.field_type = 'text';
