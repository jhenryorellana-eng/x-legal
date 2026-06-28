-- 0050_asylum_assembly_blocks.sql
-- Asilo Político — Memorándum de Miedo Creíble: store the document STRUCTURE on the
-- config so it is fully editable from the admin form-editor (no hardcoded order).
--
-- Adds to assembly:
--   blocks      ordered, toggleable structural blocks. The `conclusions` block
--               renders the LAST section on its own, so the chronology sits between
--               the analysis body and the conclusion. Order:
--               cover -> toc -> body -> chronology -> conclusions -> annexes -> closing
--   cover_page  court-facing cover: title + rows (label + {{token}} value). No
--               internal case number, no firm/brand identity.
-- Legacy booleans (cover/toc/chronology/annexes/closing) are left intact; `blocks`
-- takes precedence in the engine. Idempotent (merge via ||).

update public.ai_generation_configs c
set assembly = coalesce(c.assembly, '{}'::jsonb) || jsonb_build_object(
  'blocks', jsonb_build_array(
    jsonb_build_object('type','cover','enabled',true),
    jsonb_build_object('type','toc','enabled',true),
    jsonb_build_object('type','body','enabled',true),
    jsonb_build_object('type','chronology','enabled',true),
    jsonb_build_object('type','conclusions','enabled',true),
    jsonb_build_object('type','annexes','enabled',true),
    jsonb_build_object('type','closing','enabled',true)
  ),
  'cover_page', jsonb_build_object(
    'title', 'LEGAL MEMORANDUM AND APPLICANT DECLARATION IN SUPPORT OF ASYLUM',
    'rows', jsonb_build_array(
      jsonb_build_object('label','Country of nationality','value','{{nationality}}'),
      jsonb_build_object('label','Court / jurisdiction','value','{{court}}'),
      jsonb_build_object('label','A-Number of principal applicant','value','{{a_number}}'),
      jsonb_build_object('label','Derivative applicant(s) included','value','{{derivatives}}'),
      jsonb_build_object('label','Date of entry into the United States','value','{{entry_date}}'),
      jsonb_build_object('label','Principal theory','value','{{principal_theory}}')
    )
  )
)
from public.form_definitions f
where c.form_definition_id = f.id
  and f.slug = 'memorandum-de-miedo-creible';
