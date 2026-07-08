-- 0072_i589_children_entry_fields.sql
-- Maps the child ENTRY fields (Part A.II items 12,13,14,15,16,17,19,20,21) for children 1-4.
-- 0069 only mapped the 12 core child fields (name/DOB/nationality/A-Number/passport/SSN/status),
-- so items 12-21 (sex, in-US, place/date of last entry, I-94, status admitted, expiration, court,
-- include) were NEVER asked in the client portal → they printed blank. This adds them as
-- client-answer questions, gated by the child count (same pattern as 0069). In-place on the
-- published v3 (demo config).
--
-- Widget map (verified from detected_fields rects): sex = CheckBox{12,26,36,46}_Sex ([0]=Male,
-- [1]=Female); in-US = CheckBox{17,27,37,47} ([0]=Yes, [1]=No). Child 1 lives in #subform[1]
-- and uses un-suffixed names (item 15 is the quirky PtAIILine15_ExpirationDate); children 2-4
-- live in #subform[3] with the numeric suffix.

DO $$
DECLARE
  gid uuid := 'bae4c8f5-64ed-4b7d-b8a6-e7c47960a657';
  q_haschildren text := 'a861242c-2cbd-4e4e-a4a6-c2b3ce215004';
  q_total text := '876bfe49-0079-4835-9207-7335f4ad4740';
  sex_base text[] := array['CheckBox12_Sex','CheckBox26_Sex','CheckBox36_Sex','CheckBox46_Sex'];
  inus_base text[] := array['CheckBox17','CheckBox27','CheckBox37','CheckBox47'];
  n int; subf text; sfx text; cond jsonb; p int;
  f_place text; f_date text; f_i94 text; f_stat text; f_exp text;
BEGIN
  -- Idempotency: bail if the entry fields were already appended (positions >= 50).
  IF EXISTS (SELECT 1 FROM public.form_questions WHERE group_id = gid AND position >= 50) THEN
    RAISE NOTICE '0072 already applied — skipping';
    RETURN;
  END IF;

  FOR n IN 1..4 LOOP
    subf := CASE WHEN n = 1 THEN 'form1[0].#subform[1].' ELSE 'form1[0].#subform[3].' END;
    sfx  := CASE WHEN n = 1 THEN '' ELSE n::text END;
    cond := CASE WHEN n = 1
      THEN jsonb_build_object('when', jsonb_build_object('op','equals','value','si','question', q_haschildren), 'action','show')
      ELSE jsonb_build_object('when', jsonb_build_object('op','gte','value', n, 'question', q_total), 'action','show')
    END;
    p := 50 + (n - 1) * 9;

    f_place := subf || 'PtAIILine14_PlaceofLastEntry' || sfx || '[0]';
    f_date  := CASE WHEN n = 1 THEN subf || 'PtAIILine15_ExpirationDate[0]'
                    ELSE subf || 'PtAIILine15_DateofLastEntry' || n || '[0]' END;
    f_i94   := subf || 'PtAIILine16_I94Number' || sfx || '[0]';
    f_stat  := subf || 'PtAIILine17_StatusofLastAdmission' || sfx || '[0]';
    f_exp   := subf || 'PtAIILine19_ExpDateofAuthorizedStay' || sfx || '[0]';

    -- 12 Sex (select → Male/Female checkboxes)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Sexo', n), 'en', format('Child %s — Sex', n)), 'select',
      jsonb_build_array(
        jsonb_build_object('value','male','label_i18n', jsonb_build_object('es','Masculino','en','Male'),'pdf_field_name', subf||sex_base[n]||'[0]'),
        jsonb_build_object('value','female','label_i18n', jsonb_build_object('es','Femenino','en','Female'),'pdf_field_name', subf||sex_base[n]||'[1]')
      ), NULL, 'client_answer', NULL, false, p + 0, cond, false);

    -- 13 Is this child in the U.S.? (select → Yes/No)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — ¿Está actualmente en los Estados Unidos?', n), 'en', format('Child %s — Is this child in the U.S.?', n)), 'select',
      jsonb_build_array(
        jsonb_build_object('value','si','label_i18n', jsonb_build_object('es','Sí','en','Yes'),'pdf_field_name', subf||inus_base[n]||'[0]'),
        jsonb_build_object('value','no','label_i18n', jsonb_build_object('es','No','en','No'),'pdf_field_name', subf||inus_base[n]||'[1]')
      ), NULL, 'client_answer', NULL, false, p + 1, cond, false);

    -- 14 Place of last entry (text, verbatim)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Lugar de la última entrada a EE. UU.', n), 'en', format('Child %s — Place of last entry into the U.S.', n)), 'text', NULL, f_place, 'client_answer', NULL, false, p + 2, cond, true);

    -- 15 Date of last entry (date)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Fecha de la última entrada a EE. UU.', n), 'en', format('Child %s — Date of last entry into the U.S.', n)), 'date', NULL, f_date, 'client_answer', NULL, false, p + 3, cond, false);

    -- 16 I-94 Number (text, verbatim)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Número I-94 (si tiene)', n), 'en', format('Child %s — I-94 Number (if any)', n)), 'text', NULL, f_i94, 'client_answer', NULL, false, p + 4, cond, true);

    -- 17 Status when last admitted (text, verbatim)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Estatus al ser admitido por última vez (tipo de visa, si aplica)', n), 'en', format('Child %s — Status when last admitted (visa type, if any)', n)), 'text', NULL, f_stat, 'client_answer', NULL, false, p + 5, cond, true);

    -- 19 Expiration date of authorized stay (date)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — Fecha de vencimiento de la estadía autorizada (si aplica)', n), 'en', format('Child %s — Expiration date of authorized stay, if any', n)), 'date', NULL, f_exp, 'client_answer', NULL, false, p + 6, cond, false);

    -- 20 In Immigration Court proceedings? (select → Yes/No)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — ¿Está en procedimientos ante una Corte de Inmigración?', n), 'en', format('Child %s — Is this child in Immigration Court proceedings?', n)), 'select',
      jsonb_build_array(
        jsonb_build_object('value','si','label_i18n', jsonb_build_object('es','Sí','en','Yes'),'pdf_field_name', subf||'PtAIILine20_Yes'||sfx||'[0]'),
        jsonb_build_object('value','no','label_i18n', jsonb_build_object('es','No','en','No'),'pdf_field_name', subf||'PtAIILine20_No'||sfx||'[0]')
      ), NULL, 'client_answer', NULL, false, p + 7, cond, false);

    -- 21 Include this child in this application? (select → Yes/No)
    INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
    VALUES (gid, jsonb_build_object('es', format('Hijo %s — ¿Deseas incluir a este hijo/a en esta solicitud?', n), 'en', format('Child %s — Include this child in this application?', n)), 'select',
      jsonb_build_array(
        jsonb_build_object('value','si','label_i18n', jsonb_build_object('es','Sí','en','Yes'),'pdf_field_name', subf||'PtAIILine21_Yes'||sfx||'[0]'),
        jsonb_build_object('value','no','label_i18n', jsonb_build_object('es','No','en','No'),'pdf_field_name', subf||'PtAIILine21_No'||sfx||'[0]')
      ), NULL, 'client_answer', NULL, false, p + 8, cond, false);
  END LOOP;
END $$;
