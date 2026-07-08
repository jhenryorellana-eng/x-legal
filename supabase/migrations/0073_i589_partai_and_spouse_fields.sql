-- 0073_i589_partai_and_spouse_fields.sql
-- Maps the remaining APPLICABLE fields of Part A.I (you) and the full spouse block (Part A.II).
-- Widget↔item map verified by a sentinel trace render of the blank template (docs/_evidence/
-- i589-trace-p{1,2}.png). Item 9 (mailing address "if different than item 8") is intentionally
-- NOT mapped — it is left blank because the mailing address equals the residence. The EOIR/USCIS
-- "for official use only" boxes (TextField8/9, DateTimeField2[3-6]) are likewise NOT mapped.
-- In-place on the published v3 (keeps the live Karelis case working — no version bump).

DO $$
DECLARE
  aiGid uuid := 'd20f6512-028f-479f-8a49-ee5618cb1df2';   -- Parte A.I
  spGid uuid := 'd664fa0c-6dfa-4911-b0fd-8b5dda18c118';   -- Parte A.II cónyuge
  spCond jsonb := '{"when":{"op":"equals","value":"si","question":"67351891-7f71-48bc-a057-fd5053e7ac9d"},"action":"show","lock_message_i18n":null}'::jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.form_questions WHERE group_id = aiGid AND position >= 18) THEN
    RAISE NOTICE '0073 already applied — skipping'; RETURN;
  END IF;

  -- Text / date fields (both groups) via a compact VALUES list.
  INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
  SELECT v.gid, jsonb_build_object('es', v.es, 'en', v.en), v.ft, NULL, v.pdf, 'client_answer', NULL, false, v.pos, v.cond, v.nt
  FROM (VALUES
    -- Part A.I (no condition)
    (aiGid, 'Número de Seguro Social de EE. UU. (si tiene)', 'U.S. Social Security Number (if any)', 'text', 'form1[0].#subform[0].TextField1[0]', 18, NULL::jsonb, true),
    (aiGid, 'Número de Cuenta en Línea de USCIS (si tiene)', 'USCIS Online Account Number (if any)', 'text', 'form1[0].#subform[0].TextField1[8]', 19, NULL::jsonb, true),
    (aiGid, '¿Qué otros nombres ha usado (nombre de soltera y alias)?', 'What other names have you used (maiden name and aliases)?', 'text', 'form1[0].#subform[0].TextField1[1]', 20, NULL::jsonb, true),
    (aiGid, 'Nacionalidad al nacer', 'Nationality at Birth', 'text', 'form1[0].#subform[0].TextField1[5]', 21, NULL::jsonb, true),
    (aiGid, 'Número de apartamento de su residencia (si tiene)', 'Apartment number of your residence (if any)', 'text', 'form1[0].#subform[0].PtAILine8_AptNumber[0]', 22, NULL::jsonb, false),
    (aiGid, '¿Cuándo salió por última vez de su país? (mm/dd/aaaa)', 'When did you last leave your country? (mm/dd/yyyy)', 'date', 'form1[0].#subform[0].DateTimeField6[0]', 23, NULL::jsonb, false),
    (aiGid, '¿Cuál es su número I-94 actual (si tiene)?', 'What is your current I-94 Number, if any?', 'text', 'form1[0].#subform[0].TextField3[0]', 24, NULL::jsonb, true),
    (aiGid, 'Última entrada a EE. UU. — Fecha (mm/dd/aaaa)', 'Last entry into the U.S. — Date (mm/dd/yyyy)', 'date', 'form1[0].#subform[0].DateTimeField2[0]', 25, NULL::jsonb, false),
    (aiGid, 'Última entrada a EE. UU. — Lugar', 'Last entry into the U.S. — Place', 'text', 'form1[0].#subform[0].TextField4[0]', 26, NULL::jsonb, true),
    (aiGid, 'Última entrada a EE. UU. — Estatus', 'Last entry into the U.S. — Status', 'text', 'form1[0].#subform[0].TextField4[1]', 27, NULL::jsonb, true),
    (aiGid, 'Última entrada a EE. UU. — Fecha de vencimiento del estatus (mm/dd/aaaa)', 'Last entry into the U.S. — Date status expires (mm/dd/yyyy)', 'date', 'form1[0].#subform[0].DateTimeField2[1]', 28, NULL::jsonb, false),
    (aiGid, '¿Qué país emitió su último pasaporte o documento de viaje?', 'What country issued your last passport or travel document?', 'text', 'form1[0].#subform[0].TextField5[0]', 29, NULL::jsonb, true),
    (aiGid, 'Número de pasaporte', 'Passport Number', 'text', 'form1[0].#subform[0].TextField5[1]', 30, NULL::jsonb, true),
    (aiGid, 'Número de documento de viaje (si aplica)', 'Travel Document Number (if any)', 'text', 'form1[0].#subform[0].TextField5[2]', 31, NULL::jsonb, true),
    (aiGid, 'Fecha de vencimiento del pasaporte (mm/dd/aaaa)', 'Passport Expiration Date (mm/dd/yyyy)', 'date', 'form1[0].#subform[0].DateTimeField2[2]', 32, NULL::jsonb, false),
    (aiGid, '¿Cuál es su idioma nativo (incluya dialecto, si aplica)?', 'What is your native language (include dialect, if applicable)?', 'text', 'form1[0].#subform[0].TextField7[0]', 33, NULL::jsonb, true),
    (aiGid, '¿Qué otros idiomas habla con fluidez?', 'What other languages do you speak fluently?', 'text', 'form1[0].#subform[0].TextField7[1]', 35, NULL::jsonb, true),
    -- Spouse (gated by married)
    (spGid, 'Cónyuge — Número de Registro de Extranjero (A-Number), si tiene', 'Spouse — Alien Registration Number (A-Number), if any', 'text', 'form1[0].#subform[1].NotMarried[0].PtAIILine1_ANumber[0]', 8, spCond, true),
    (spGid, 'Cónyuge — Número de pasaporte o identificación (si tiene)', 'Spouse — Passport/ID Card Number (if any)', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[1]', 9, spCond, true),
    (spGid, 'Cónyuge — Número de Seguro Social de EE. UU. (si tiene)', 'Spouse — U.S. Social Security Number (if any)', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[2]', 10, spCond, true),
    (spGid, 'Cónyuge — Segundo nombre', 'Spouse — Middle Name', 'text', 'form1[0].#subform[1].NotMarried[0].PtAIILine7_MiddleName[0]', 11, spCond, true),
    (spGid, 'Cónyuge — Otros nombres usados (nombre de soltera y alias)', 'Spouse — Other names used (maiden name and aliases)', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[3]', 12, spCond, true),
    (spGid, 'Cónyuge — Fecha de matrimonio (mm/dd/aaaa)', 'Spouse — Date of Marriage (mm/dd/yyyy)', 'date', 'form1[0].#subform[1].NotMarried[0].DateTimeField8[0]', 13, spCond, false),
    (spGid, 'Cónyuge — Lugar de matrimonio', 'Spouse — Place of Marriage', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[4]', 14, spCond, true),
    (spGid, 'Cónyuge — Ciudad y país de nacimiento', 'Spouse — City and Country of Birth', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[5]', 15, spCond, true),
    (spGid, 'Cónyuge — Raza, grupo étnico o tribal', 'Spouse — Race, Ethnic, or Tribal Group', 'text', 'form1[0].#subform[1].NotMarried[0].TextField10[6]', 16, spCond, true),
    (spGid, 'Cónyuge — Lugar de la última entrada a EE. UU.', 'Spouse — Place of last entry into the U.S.', 'text', 'form1[0].#subform[1].NotMarried[0].PtAIILine16_PlaceofLastEntry[0]', 18, spCond, true),
    (spGid, 'Cónyuge — Fecha de la última entrada a EE. UU. (mm/dd/aaaa)', 'Spouse — Date of last entry into the U.S. (mm/dd/yyyy)', 'date', 'form1[0].#subform[1].NotMarried[0].PtAIILine17_DateofLastEntry[0]', 19, spCond, false),
    (spGid, 'Cónyuge — Número I-94 (si tiene)', 'Spouse — I-94 Number (if any)', 'text', 'form1[0].#subform[1].NotMarried[0].PtAIILine18_I94Number[0]', 20, spCond, true),
    (spGid, 'Cónyuge — Estatus al ser admitido por última vez (tipo de visa, si aplica)', 'Spouse — Status when last admitted (visa type, if any)', 'text', 'form1[0].#subform[1].NotMarried[0].PtAIILine19_StatusofLastAdmission[0]', 21, spCond, true),
    (spGid, 'Cónyuge — Fecha de vencimiento de la estadía autorizada (si aplica) (mm/dd/aaaa)', 'Spouse — Expiration date of authorized stay, if any (mm/dd/yyyy)', 'date', 'form1[0].#subform[1].NotMarried[0].PtAIILine21_ExpDateofAuthorizedStay[0]', 22, spCond, false),
    (spGid, 'Cónyuge — Fecha de llegada anterior a EE. UU. (si aplica) (mm/dd/aaaa)', 'Spouse — Date of previous arrival in the U.S., if any (mm/dd/yyyy)', 'date', 'form1[0].#subform[1].NotMarried[0].PtAIILine23_PreviousArrivalDate[0]', 24, spCond, false)
  ) AS v(gid, es, en, ft, pdf, pos, cond, nt);

  -- Selects (checkbox groups): each option carries its own pdf_field_name.
  -- item 24 (Part A.I): Are you fluent in English? Yes/No
  INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
  VALUES (aiGid, jsonb_build_object('es','¿Habla inglés con fluidez?','en','Are you fluent in English?'), 'select',
    jsonb_build_array(
      jsonb_build_object('value','si','label_i18n', jsonb_build_object('es','Sí','en','Yes'),'pdf_field_name','form1[0].#subform[0].CheckBox4[0]'),
      jsonb_build_object('value','no','label_i18n', jsonb_build_object('es','No','en','No'),'pdf_field_name','form1[0].#subform[0].CheckBox4[1]')
    ), NULL, 'client_answer', NULL, false, 34, NULL, false);

  -- Spouse item 14 Sex
  INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
  VALUES (spGid, jsonb_build_object('es','Cónyuge — Sexo','en','Spouse — Sex'), 'select',
    jsonb_build_array(
      jsonb_build_object('value','male','label_i18n', jsonb_build_object('es','Masculino','en','Male'),'pdf_field_name','form1[0].#subform[1].NotMarried[0].CheckBox14_Sex[0]'),
      jsonb_build_object('value','female','label_i18n', jsonb_build_object('es','Femenino','en','Female'),'pdf_field_name','form1[0].#subform[1].NotMarried[0].CheckBox14_Sex[1]')
    ), NULL, 'client_answer', NULL, false, 17, spCond, false);

  -- Spouse item 22 in Immigration Court proceedings? Yes/No
  INSERT INTO public.form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, source_ref, is_required, position, condition, no_translate)
  VALUES (spGid, jsonb_build_object('es','Cónyuge — ¿Está en procedimientos ante una Corte de Inmigración?','en','Spouse — Is your spouse in Immigration Court proceedings?'), 'select',
    jsonb_build_array(
      jsonb_build_object('value','si','label_i18n', jsonb_build_object('es','Sí','en','Yes'),'pdf_field_name','form1[0].#subform[1].NotMarried[0].PtAIILine22_Yes[0]'),
      jsonb_build_object('value','no','label_i18n', jsonb_build_object('es','No','en','No'),'pdf_field_name','form1[0].#subform[1].NotMarried[0].PtAIILine22_No[0]')
    ), NULL, 'client_answer', NULL, false, 23, spCond, false);
END $$;
