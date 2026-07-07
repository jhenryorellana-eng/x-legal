-- 0067_i589_partd_remap.sql
-- Ola 2b: corrige el cluster de mismappings de la propuesta IA en Part D (pág. 9) del
-- I-589, detectado por el barrido maximal (todos los campos rellenados con datos
-- trazables). Mapeo real determinado por los rects de detected_fields + el render:
--   TextField20[0] = "Print your complete name"      (recibía el teléfono)
--   TextField20[1] = "Write your name in native alphabet" (recibía el teléfono)
--   TextField22[0] = línea de FIRMA                   (recibía el alfabeto nativo)
--   CheckBox1[0]   = casilla G-28                     (recibía el CAT)
--   CheckBox31[0]  = casilla CAT real (pág. 1, arriba)
-- Part D NO tiene campo de teléfono (el teléfono es item 8 de la pág. 1).
--
-- In-place sobre la versión publicada (datos demo). Rollback: no trivial (documentado
-- en docs/historial/2026-07-07-i589-generator-hardening.md).

DO $$
DECLARE v_ver uuid; v_partd uuid;
BEGIN
  SELECT id INTO v_ver FROM public.form_automation_versions
    WHERE form_definition_id='e7f12a89-d1dd-4478-84f3-17afff5a0b8d' AND status='published' LIMIT 1;
  SELECT id INTO v_partd FROM public.form_question_groups
    WHERE automation_version_id=v_ver AND title_i18n->>'en' LIKE 'Part D%';

  -- 1) Eliminar las preguntas de teléfono FANTASMA (Part D no tiene ese campo).
  DELETE FROM public.form_questions
    WHERE group_id=v_partd AND pdf_field_name IN
      ('form1[0].#subform[10].TextField20[0]', 'form1[0].#subform[10].TextField20[1]');

  -- 2) Alfabeto nativo: re-apuntar de la línea de firma (TextField22[0]) a su casilla real (TextField20[1]).
  --    Esto deja TextField22[0] (firma) SIN mapear → en blanco por diseño.
  UPDATE public.form_questions SET pdf_field_name='form1[0].#subform[10].TextField20[1]'
    WHERE group_id=v_partd AND pdf_field_name='form1[0].#subform[10].TextField22[0]';

  -- 3) Añadir "Print your complete name" → la casilla real (TextField20[0]).
  INSERT INTO public.form_questions
    (id, group_id, question_i18n, help_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, validation, condition)
  VALUES (gen_random_uuid(), v_partd,
    '{"en":"Print your complete name (applicant).","es":"Escriba su nombre completo (solicitante)."}'::jsonb, NULL,
    'text', NULL, 'form1[0].#subform[10].TextField20[0]', 'client_answer', NULL, false, 10, NULL, NULL);

  -- 4) CAT: mapear a la casilla CAT real (CheckBox31[0], pág. 1); G-28 (CheckBox1[0]) queda sin mapear → apagada.
  UPDATE public.form_questions SET pdf_field_name=NULL, options=jsonb_build_array(
      jsonb_build_object('value','si','label_i18n',jsonb_build_object('en','Yes','es','Sí'),'pdf_field_name','form1[0].#subform[0].CheckBox31[0]'),
      jsonb_build_object('value','no','label_i18n',jsonb_build_object('en','No','es','No'),'pdf_field_name',NULL))
    WHERE group_id=v_partd AND pdf_field_name='form1[0].#subform[10].CheckBox1[0]';

  -- 5) Nombre del preparador → el campo real de Part E.
  UPDATE public.form_questions SET pdf_field_name='form1[0].#subform[10].PtE_PreparerName[0]'
    WHERE group_id=v_partd AND pdf_field_name='form1[0].#subform[10].TextField25[0]';

  -- 6) Desmapear el "segundo nombre de preparador" dudoso (TextField25[1]).
  UPDATE public.form_questions SET pdf_field_name=NULL
    WHERE group_id=v_partd AND pdf_field_name='form1[0].#subform[10].TextField25[1]';

  -- 7) Supplement A (child 5/6): esta plantilla de 12 págs no tiene página de Supplement A
  --    (es un formulario aparte para >4 hijos) → dejar el grupo en blanco.
  UPDATE public.form_question_groups SET do_not_fill=true
    WHERE automation_version_id=v_ver AND title_i18n->>'en' LIKE 'Supplement A%';
END $$;
