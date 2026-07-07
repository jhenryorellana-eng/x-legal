-- 0069_i589_children_1_4.sql
-- Fix: en el I-589, Part A.II (págs 2-3) los slots de hijo salían vacíos — solo Child 1
-- (parcial) y Child 2 (3 campos) estaban mapeados; Children 3-4 no existían. Este template
-- tiene 4 slots completos de hijo (Child 1 en #subform[1]; Children 2-4 en #subform[3],
-- patrón Child{Campo}{N}). Aquí se (re)mapean los 12 campos core por hijo 1-4 como preguntas
-- client_answer, gateadas por la cantidad de hijos (child 1 si hay hijos; child N si total>=N).
-- El cliente los teclea en "Formularios"; el wizard ya los renderiza data-driven.
--
-- Hijos 5+ requieren el Supplement A real de USCIS (PDF aparte) → follow-up.
-- In-place sobre la versión publicada (datos demo). Idempotente por posición/borrado previo.

DO $$
DECLARE
  v_ver         uuid;
  v_grp         uuid;
  v_haschildren uuid;
  v_totalchild  uuid;
  n int; i int; pos int := 2;
  suffixes  text[] := ARRAY['Last','First','Middle','DOB','Nat','Race','City','Marital','Alien','Passport','SSN'];
  labels_en text[] := ARRAY['Last name','First name','Middle name','Date of birth','Nationality (citizenship)','Race, ethnic, or tribal group','City and country of birth','Marital status','Alien Registration Number (A-Number), if any','Passport/ID card number, if any','U.S. Social Security Number, if any'];
  labels_es text[] := ARRAY['Apellidos','Nombre','Segundo nombre','Fecha de nacimiento','Nacionalidad (ciudadanía)','Raza, grupo étnico o tribal','Ciudad y país de nacimiento','Estado civil','Número de registro de extranjero (A-Number), si tiene','Número de pasaporte o identificación, si tiene','Número de Seguro Social de EE. UU., si tiene'];
  ftypes    text[] := ARRAY['text','text','text','date','text','text','text','text','text','text','text'];
  fld text; cond jsonb; qi jsonb;
BEGIN
  SELECT id INTO v_ver FROM public.form_automation_versions
    WHERE form_definition_id='e7f12a89-d1dd-4478-84f3-17afff5a0b8d' AND status='published' LIMIT 1;
  SELECT id INTO v_grp FROM public.form_question_groups
    WHERE automation_version_id=v_ver AND title_i18n->>'en' LIKE 'Part A.II — Information About Your Children%';
  SELECT id INTO v_haschildren FROM public.form_questions
    WHERE group_id=v_grp AND question_i18n->>'en' ILIKE 'Do you have any children%' LIMIT 1;
  SELECT id INTO v_totalchild FROM public.form_questions
    WHERE group_id=v_grp AND pdf_field_name LIKE '%TotalChild%' LIMIT 1;
  IF v_grp IS NULL OR v_totalchild IS NULL THEN RAISE EXCEPTION 'I-589 children group not found'; END IF;

  -- Limpiar los slots de hijo incompletos previos; conservar las 2 preguntas de compuerta.
  DELETE FROM public.form_questions
    WHERE group_id=v_grp AND id NOT IN (v_haschildren, v_totalchild);

  FOR n IN 1..4 LOOP
    IF n = 1 THEN
      cond := jsonb_build_object('when', jsonb_build_object('question', v_haschildren::text, 'op','equals','value','si'), 'action','show');
    ELSE
      cond := jsonb_build_object('when', jsonb_build_object('question', v_totalchild::text, 'op','gte','value', n), 'action','show');
    END IF;

    FOR i IN 1..array_length(suffixes,1) LOOP
      IF n = 1 THEN
        fld := format('form1[0].#subform[1].Child%s1[0]', suffixes[i]);
      ELSE
        fld := format('form1[0].#subform[3].Child%s%s[0]', suffixes[i], n);
      END IF;
      qi := jsonb_build_object('en', format('Child %s — %s', n, labels_en[i]), 'es', format('Hijo %s — %s', n, labels_es[i]));
      INSERT INTO public.form_questions
        (id, group_id, question_i18n, help_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, validation, condition)
      VALUES (gen_random_uuid(), v_grp, qi, NULL, ftypes[i], NULL, fld, 'client_answer', NULL, false, pos, NULL, cond);
      pos := pos + 1;
    END LOOP;

    -- Estatus migratorio actual (el nombre del campo difiere entre child 1 y 2-4).
    IF n = 1 THEN
      fld := 'form1[0].#subform[1].PtAIILine18_CurrentStatusofChild[0]';
    ELSE
      fld := format('form1[0].#subform[3].PtAIILine18_ChildCurrentStatus%s[0]', n);
    END IF;
    INSERT INTO public.form_questions
      (id, group_id, question_i18n, help_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, validation, condition)
    VALUES (gen_random_uuid(), v_grp,
      jsonb_build_object('en', format('Child %s — current immigration status', n), 'es', format('Hijo %s — estatus migratorio actual', n)),
      NULL, 'text', NULL, fld, 'client_answer', NULL, false, pos, NULL, cond);
    pos := pos + 1;
  END LOOP;
END $$;
