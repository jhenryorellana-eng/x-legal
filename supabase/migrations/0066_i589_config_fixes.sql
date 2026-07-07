-- 0066_i589_config_fixes.sql
-- Data migration: corrige la CONFIGURACIÓN del I-589 (form_questions/groups) para que
-- el PDF generado sea aceptable por USCIS. Complementa la Ola 1 (motor, migración 0065).
--
-- Se aplica IN-PLACE sobre la versión publicada del I-589 (form_definition
-- e7f12a89-…, "Formulario I-589"). Decisión consciente: son datos DEMO (no hay casos
-- reales en curso), así se evita la réplica SQL frágil de una versión nueva; la config
-- sigue 100% editable/versionable desde el admin (duplicate-as-draft) cuando se quiera.
--
-- Cubre los hallazgos: 1/14 (vocabulario ES→EN), 5 (pares Sí/No colapsados),
-- 8 (Supplement A solo con >4 hijos), 9 (Parts F/G en blanco), 10 (fecha de firma en
-- blanco), 11 (base de asilo obligatoria ≥1), 12 (mapeo Sí/No option-based), 13 (ciudad+país).
-- Deferidos (documentados): item 18 (source desde el tipo de caso), idioma nativo/
-- "fluent English" (no existen en el AcroForm del I-589), G-28 (no hay campo), y los
-- bloques de hijos 2-4 de la página principal (condiciones por conteo — follow-up).
--
-- Rollback: no trivial (edición in-place de config demo). El estado previo quedó
-- documentado en docs/historial/2026-07-07-i589-generator-hardening.md; se puede
-- re-generar la estructura desde el editor admin.

DO $$
DECLARE
  v_ver        uuid;
  v_partb      uuid;
  v_partc      uuid;
  v_ai         uuid;   -- Part A.I
  v_partd      uuid;   -- Part D
  v_totalchild uuid;
BEGIN
  SELECT id INTO v_ver FROM public.form_automation_versions
    WHERE form_definition_id = 'e7f12a89-d1dd-4478-84f3-17afff5a0b8d' AND status = 'published' LIMIT 1;
  IF v_ver IS NULL THEN RAISE EXCEPTION 'I-589 published version not found'; END IF;

  SELECT id INTO v_partb FROM public.form_question_groups WHERE automation_version_id = v_ver AND title_i18n->>'en' LIKE 'Part B%';
  SELECT id INTO v_partc FROM public.form_question_groups WHERE automation_version_id = v_ver AND title_i18n->>'en' LIKE 'Part C%';
  SELECT id INTO v_ai    FROM public.form_question_groups WHERE automation_version_id = v_ver AND title_i18n->>'en' = 'Part A.I — Information About You';
  SELECT id INTO v_partd FROM public.form_question_groups WHERE automation_version_id = v_ver AND title_i18n->>'en' LIKE 'Part D%';
  SELECT fq.id INTO v_totalchild
    FROM public.form_questions fq JOIN public.form_question_groups g ON g.id = fq.group_id
    WHERE g.automation_version_id = v_ver
      AND g.title_i18n->>'en' LIKE 'Part A.II — Information About Your Children'
      AND fq.pdf_field_name LIKE '%TotalChild%';

  -- A) Parts F y G: en blanco por diseño (se completan en la entrevista / audiencia). ------
  UPDATE public.form_question_groups SET do_not_fill = true
    WHERE automation_version_id = v_ver
      AND (title_i18n->>'en' LIKE 'Part F%' OR title_i18n->>'en' LIKE 'Part G%');

  -- B) Bug sistémico Sí/No (Part B y C): el select mapeaba TODO a la casilla "No" ([1]) --
  --    como texto. Se pasa a mapeo por opción: Sí→[0], No→[1].
  UPDATE public.form_questions fq
    SET pdf_field_name = NULL,
        options = jsonb_build_array(
          jsonb_build_object('value','si','label_i18n', jsonb_build_object('en','Yes','es','Sí'),
                             'pdf_field_name', regexp_replace(fq.pdf_field_name, '\[1\]$', '[0]')),
          jsonb_build_object('value','no','label_i18n', jsonb_build_object('en','No','es','No'),
                             'pdf_field_name', fq.pdf_field_name)
        )
    WHERE fq.group_id IN (v_partb, v_partc)
      AND fq.field_type = 'select'
      AND fq.pdf_field_name IS NOT NULL
      AND fq.pdf_field_name LIKE '%[1]';

  -- C) Base de asilo: 6 checkboxes sueltos → 1 multiselect obligatorio (mín. 1). -----------
  DELETE FROM public.form_questions WHERE group_id = v_partb AND field_type = 'checkbox';
  INSERT INTO public.form_questions
    (id, group_id, question_i18n, help_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, validation, condition)
  VALUES (
    gen_random_uuid(), v_partb,
    '{"en":"On what basis are you applying for asylum or protection? Select all that apply.","es":"¿En qué se basa su solicitud de asilo o protección? Marque todas las que correspondan."}'::jsonb,
    '{"en":"At least one basis is required to file.","es":"Se requiere al menos una base para presentar."}'::jsonb,
    'multiselect',
    '[{"value":"race","label_i18n":{"en":"Race","es":"Raza"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxrace[0]"},
      {"value":"religion","label_i18n":{"en":"Religion","es":"Religión"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxreligion[0]"},
      {"value":"nationality","label_i18n":{"en":"Nationality","es":"Nacionalidad"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxnationality[0]"},
      {"value":"political_opinion","label_i18n":{"en":"Political opinion","es":"Opinión política"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxpolitics[0]"},
      {"value":"social_group","label_i18n":{"en":"Particular social group","es":"Grupo social determinado"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxsocial[0]"},
      {"value":"torture","label_i18n":{"en":"Torture Convention (CAT)","es":"Convención contra la Tortura (CAT)"},"pdf_field_name":"form1[0].#subform[5].#subform[6].CheckBoxtorture[0]"}]'::jsonb,
    NULL, 'client_answer', NULL, true, 0, '{"minSelected":1}'::jsonb, NULL
  );

  -- D) Part A.I: vocabulario controlado con valor canónico en INGLÉS (ES→EN determinista). -
  --    El select mapea a un campo de texto (opciones sin pdf_field_name) → escribe el value.
  -- Nacionalidad (item 15) → TextField1[3]
  UPDATE public.form_questions SET field_type = 'select', source = 'client_answer', source_ref = NULL, options = $j$[
    {"value":"Venezuelan","label_i18n":{"en":"Venezuelan","es":"Venezolana"}},
    {"value":"Colombian","label_i18n":{"en":"Colombian","es":"Colombiana"}},
    {"value":"Cuban","label_i18n":{"en":"Cuban","es":"Cubana"}},
    {"value":"Mexican","label_i18n":{"en":"Mexican","es":"Mexicana"}},
    {"value":"Honduran","label_i18n":{"en":"Honduran","es":"Hondureña"}},
    {"value":"Guatemalan","label_i18n":{"en":"Guatemalan","es":"Guatemalteca"}},
    {"value":"Salvadoran","label_i18n":{"en":"Salvadoran","es":"Salvadoreña"}},
    {"value":"Nicaraguan","label_i18n":{"en":"Nicaraguan","es":"Nicaragüense"}},
    {"value":"Ecuadorian","label_i18n":{"en":"Ecuadorian","es":"Ecuatoriana"}},
    {"value":"Peruvian","label_i18n":{"en":"Peruvian","es":"Peruana"}},
    {"value":"Haitian","label_i18n":{"en":"Haitian","es":"Haitiana"}},
    {"value":"Dominican","label_i18n":{"en":"Dominican","es":"Dominicana"}},
    {"value":"Brazilian","label_i18n":{"en":"Brazilian","es":"Brasileña"}},
    {"value":"Argentine","label_i18n":{"en":"Argentine","es":"Argentina"}},
    {"value":"Chilean","label_i18n":{"en":"Chilean","es":"Chilena"}},
    {"value":"Bolivian","label_i18n":{"en":"Bolivian","es":"Boliviana"}},
    {"value":"Other","label_i18n":{"en":"Other","es":"Otra"}}]$j$::jsonb
    WHERE group_id = v_ai AND pdf_field_name = 'form1[0].#subform[0].TextField1[3]';

  -- Raza / grupo étnico (item 16) → TextField1[6]
  UPDATE public.form_questions SET field_type = 'select', source = 'client_answer', source_ref = NULL, options = $j$[
    {"value":"Hispanic/Latino","label_i18n":{"en":"Hispanic/Latino","es":"Hispano/Latino"}},
    {"value":"Mestizo","label_i18n":{"en":"Mestizo","es":"Mestizo/a"}},
    {"value":"White","label_i18n":{"en":"White","es":"Blanca"}},
    {"value":"Black or Afro-descendant","label_i18n":{"en":"Black or Afro-descendant","es":"Negra o afrodescendiente"}},
    {"value":"Indigenous","label_i18n":{"en":"Indigenous","es":"Indígena"}},
    {"value":"Mixed","label_i18n":{"en":"Mixed","es":"Mixta"}},
    {"value":"Other","label_i18n":{"en":"Other","es":"Otra"}}]$j$::jsonb
    WHERE group_id = v_ai AND pdf_field_name = 'form1[0].#subform[0].TextField1[6]';

  -- Religión (item 17) → TextField1[7]
  UPDATE public.form_questions SET field_type = 'select', source = 'client_answer', source_ref = NULL, options = $j$[
    {"value":"Catholic","label_i18n":{"en":"Catholic","es":"Católica"}},
    {"value":"Evangelical","label_i18n":{"en":"Evangelical","es":"Evangélica"}},
    {"value":"Protestant","label_i18n":{"en":"Protestant","es":"Protestante"}},
    {"value":"Christian (other)","label_i18n":{"en":"Christian (other)","es":"Cristiana (otra)"}},
    {"value":"Jewish","label_i18n":{"en":"Jewish","es":"Judía"}},
    {"value":"Muslim","label_i18n":{"en":"Muslim","es":"Musulmana"}},
    {"value":"None","label_i18n":{"en":"None","es":"Ninguna"}},
    {"value":"Other","label_i18n":{"en":"Other","es":"Otra"}}]$j$::jsonb
    WHERE group_id = v_ai AND pdf_field_name = 'form1[0].#subform[0].TextField1[7]';

  -- Ciudad + país de nacimiento (item 13) → TextField1[4]
  UPDATE public.form_questions
    SET source = 'client_answer', source_ref = NULL,
        question_i18n = '{"en":"What is your city and country of birth? (e.g. Caracas, Venezuela)","es":"¿Cuál es su ciudad y país de nacimiento? (p. ej. Caracas, Venezuela)"}'::jsonb
    WHERE group_id = v_ai AND pdf_field_name = 'form1[0].#subform[0].TextField1[4]';

  -- E) Part D: colapsar los pares Sí/No de intérprete (ckboxynd2) y preparador (ckboxynd3). -
  UPDATE public.form_questions SET pdf_field_name = NULL,
    options = jsonb_build_array(
      jsonb_build_object('value','si','label_i18n', jsonb_build_object('en','Yes','es','Sí'),'pdf_field_name','form1[0].#subform[10].ckboxynd2[0]'),
      jsonb_build_object('value','no','label_i18n', jsonb_build_object('en','No','es','No'),'pdf_field_name','form1[0].#subform[10].ckboxynd2[1]'))
    WHERE group_id = v_partd AND pdf_field_name = 'form1[0].#subform[10].ckboxynd2[0]';
  UPDATE public.form_questions SET pdf_field_name = NULL,
    options = jsonb_build_array(
      jsonb_build_object('value','si','label_i18n', jsonb_build_object('en','Yes','es','Sí'),'pdf_field_name','form1[0].#subform[10].ckboxynd3[0]'),
      jsonb_build_object('value','no','label_i18n', jsonb_build_object('en','No','es','No'),'pdf_field_name','form1[0].#subform[10].ckboxynd3[1]'))
    WHERE group_id = v_partd AND pdf_field_name = 'form1[0].#subform[10].ckboxynd3[0]';
  -- Eliminar las preguntas "confirmación" duplicadas (las [1]) — origen de las contradicciones.
  DELETE FROM public.form_questions
    WHERE group_id = v_partd
      AND pdf_field_name IN ('form1[0].#subform[10].ckboxynd2[1]', 'form1[0].#subform[10].ckboxynd3[1]');

  -- F) Part D: la FECHA de firma va en blanco (se firma a mano al presentar). ---------------
  UPDATE public.form_questions SET pdf_field_name = NULL
    WHERE group_id = v_partd AND pdf_field_name = 'form1[0].#subform[10].DateTimeField48[0]';

  -- G) Supplement A solo aplica con MÁS DE 4 hijos: gate child 5/6 por el total. -----------
  IF v_totalchild IS NOT NULL THEN
    UPDATE public.form_questions fq
      SET condition = jsonb_build_object('when', jsonb_build_object('question', v_totalchild::text, 'op', 'gte', 'value', 5), 'action', 'show')
      FROM public.form_question_groups g
      WHERE fq.group_id = g.id AND g.automation_version_id = v_ver AND g.title_i18n->>'en' LIKE 'Supplement A — Child 5%';
    UPDATE public.form_questions fq
      SET condition = jsonb_build_object('when', jsonb_build_object('question', v_totalchild::text, 'op', 'gte', 'value', 6), 'action', 'show')
      FROM public.form_question_groups g
      WHERE fq.group_id = g.id AND g.automation_version_id = v_ver AND g.title_i18n->>'en' LIKE 'Supplement A — Child 6%';
  END IF;
END $$;
