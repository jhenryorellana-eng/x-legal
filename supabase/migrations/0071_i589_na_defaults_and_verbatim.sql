-- 0071_i589_na_defaults_and_verbatim.sql
-- Configures the published I-589 to use the empty-field + verbatim primitives from 0070.
-- In-place data edit on the published versions (same pattern as 0066–0069; the config
-- stays editable/versionable from the admin editor). Idempotent and reversible.

-- 1) Every APPLICABLE-but-EMPTY field renders "N/A" (was: only free-text). This fills the
--    empty child rows (A-Number / passport / SSN) reported as blank, and any other empty
--    applicable field, per 8 CFR 1208.3(c)(3). Both published I-589 versions.
update public.form_automation_versions
set default_empty_policy = 'na'
where id in (
  '7de5f9de-6abe-4aa0-bb74-755eb38de867',  -- v3 · Form I-589 Part A (personal info + children)
  '87a1e926-517c-4278-bd56-639949745a48'   -- v2 · I-589 Parts B & C (asylum claim)
);

-- 2) VERBATIM identity fields: names, cities, and A-Numbers are written to the PDF exactly
--    as stored — never ES→EN translated nor PII-masked. This is what makes the principal's
--    A-Number print "A123456789" instead of the masked "A-•••-•••", and keeps proper nouns
--    intact. Structured codes (SSN/passport/phone/dates) are already covered generically by
--    the engine's isVerbatimValue heuristic; this pins the proper nouns the heuristic can't
--    detect. Narratives (Part B/C textareas) keep no_translate = false so they still translate.

-- 2a) All TEXT fields in the Part A.II blocks (children + spouse) — names, nationality, race,
--     city, marital, A-Number, passport, SSN, status. All are proper nouns, codes, or already-
--     canonical English; none need translation. NOTE the exact " —" separator: a plain
--     '%Parte A.II%' would ALSO match 'Parte A.III' (substring), wrongly over-marking the
--     Antecedentes section. `like 'Parte A.II —%'` matches only the A.II groups.
update public.form_questions q
set no_translate = true
from public.form_question_groups g
where q.group_id = g.id
  and g.automation_version_id = '7de5f9de-6abe-4aa0-bb74-755eb38de867'
  and g.title_i18n->>'es' like 'Parte A.II —%'
  and q.field_type = 'text';

-- 2b) Principal + spouse identity proper nouns and the principal A-Number (Part A.I).
update public.form_questions q
set no_translate = true
where q.group_id in (
    select id from public.form_question_groups
    where automation_version_id = '7de5f9de-6abe-4aa0-bb74-755eb38de867'
  )
  and q.pdf_field_name in (
    'form1[0].#subform[0].PtAILine1_ANumber[0]',                 -- A-Number (the masked-bug field)
    'form1[0].#subform[0].PtAILine4_LastName[0]',                -- your last name
    'form1[0].#subform[0].PtAILine5_FirstName[0]',               -- your first name
    'form1[0].#subform[0].PtAILine6_MiddleName[0]',              -- your middle name
    'form1[0].#subform[0].TextField1[4]',                        -- your city + country of birth
    'form1[0].#subform[1].NotMarried[0].PtAIILine5_LastName[0]', -- spouse last name
    'form1[0].#subform[1].NotMarried[0].PtAIILine6_FirstName[0]' -- spouse first name
  );
