-- 0068_i589_phone_split.sql
-- Fix: el teléfono del item 8 (pág. 1) del I-589 tiene DOS campos —
-- PtAILine8_AreaCode[0] (dentro del "( )") y PtAILine8_TelephoneNumber[0] (el número).
-- La pregunta de teléfono (source=profile phone_e164) volcaba los 10 dígitos al campo del
-- número, dejando el "( )" vacío. Con el nuevo `format` en el source_ref (motor):
--   - el número escribe solo la parte local ("555-1234")   → PtAILine8_TelephoneNumber[0]
--   - se añade una pregunta de código de área ("305")        → PtAILine8_AreaCode[0]
-- Ambas derivan del MISMO phone_e164 del perfil (conserva el prefill "Ya lo tenemos").
--
-- In-place sobre la versión publicada (datos demo). Rollback documentado en el historial.

DO $$
DECLARE v_ver uuid; v_ai uuid;
BEGIN
  SELECT id INTO v_ver FROM public.form_automation_versions
    WHERE form_definition_id='e7f12a89-d1dd-4478-84f3-17afff5a0b8d' AND status='published' LIMIT 1;
  SELECT id INTO v_ai FROM public.form_question_groups
    WHERE automation_version_id=v_ver AND title_i18n->>'en'='Part A.I — Information About You';

  -- Número (sin código de área) → parte local "555-1234".
  UPDATE public.form_questions
    SET source_ref='{"profile_field":"phone_e164","format":"us_local_number"}'::jsonb,
        question_i18n='{"en":"What is your phone number (without area code)?","es":"¿Cuál es su número de teléfono (sin código de área)?"}'::jsonb
    WHERE group_id=v_ai AND pdf_field_name='form1[0].#subform[0].PtAILine8_TelephoneNumber[0]';

  -- Código de área → la casilla dentro del "( )".
  INSERT INTO public.form_questions
    (id, group_id, question_i18n, help_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, validation, condition)
  VALUES (gen_random_uuid(), v_ai,
    '{"en":"What is your telephone area code?","es":"¿Cuál es el código de área de su teléfono?"}'::jsonb, NULL,
    'text', NULL, 'form1[0].#subform[0].PtAILine8_AreaCode[0]', 'profile',
    '{"profile_field":"phone_e164","format":"us_area_code"}'::jsonb, false, 17, NULL, NULL);
END $$;
