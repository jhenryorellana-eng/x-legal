-- 0079_asilo_single_phase.sql
--
-- Fusiona el servicio "Asilo Político" de 2 fases (fase-1 "Sustentos" + fase-2
-- "Reforzar") a UNA sola fase "Preparación del caso" (slug `principal`). Mueve a
-- la fase superviviente los documentos, formularios (I-589 + memorándum de Miedo
-- Creíble + su cuestionario), milestones y datos operativos que colgaban de la
-- fase-2; define una ruta única de 3 citas (introducción · avance I-589 · avance
-- miedo creíble); y elimina la fase-2.
--
-- Data-only, idempotente: no-op si ya no existe `fase-2`. Resuelve las fases por
-- slug (sin hardcodear ids). La survivor conserva su id, así que todas sus
-- referencias siguen válidas; solo se reapunta lo que colgaba de fase-2.
--
-- Nota de slugs: en PRODUCCIÓN las fases del Asilo tenían slug `fase-1`/`fase-2`
-- (aplicadas por 0047-0048); los nombres `sustentos`/`reforzar` del seed son
-- históricos y divergentes (deriva preexistente). Esta migración resuelve por el
-- slug real `fase-2`.
--
-- Verificado antes de aplicar: `public.appointments` tenía 0 filas agendadas para
-- el Asilo, por lo que colapsar la ruta de citas (borrar+reinsertar
-- `service_appointment_schedule`) NO reetiqueta ninguna cita real. Si este patrón
-- se reutiliza con reservas existentes, remapear `appointments.sequence_number`.
--
-- Notas de integridad:
--   • `service_phase_milestones` tiene UNIQUE (service_phase_id, position) → los
--     milestones se renumeran al moverlos (offset tras los existentes).
--   • `required_document_types` y `form_definitions` solo tienen UNIQUE en slug;
--     igualmente se renumera position para un orden limpio.
--   • `case_phase_history` es inmutable (trigger case_phase_history_immutable) →
--     se deshabilita puntualmente para borrar la fila de transición a la fase que
--     se elimina (dentro de la misma transacción, DDL transaccional en Postgres).

do $$
declare
  v_service  uuid;
  v_survivor uuid;
  v_fase2    uuid;
  v_doc_off  int;
  v_form_off int;
  v_ms_off   int;
begin
  select id into v_service from public.services where slug = 'asilo-politico';
  if v_service is null then
    raise notice '0079: servicio asilo-politico no encontrado; no-op';
    return;
  end if;

  select id into v_fase2 from public.service_phases
   where service_id = v_service and slug = 'fase-2';
  if v_fase2 is null then
    raise notice '0079: fase-2 ya no existe; migración ya aplicada (no-op)';
    return;
  end if;

  -- Survivor = la fase de asilo que NO es fase-2, con menor position.
  select id into v_survivor from public.service_phases
   where service_id = v_service and slug <> 'fase-2'
   order by position limit 1;

  -- Offsets para renumerar los hijos movidos, después de los existentes.
  select coalesce(max(position), -1) + 1 into v_doc_off
    from public.required_document_types where service_phase_id = v_survivor;
  select coalesce(max(position), -1) + 1 into v_form_off
    from public.form_definitions where service_phase_id = v_survivor;
  select coalesce(max(position), -1) + 1 into v_ms_off
    from public.service_phase_milestones where service_phase_id = v_survivor;

  -- ── 1. Documentos: mover fase-2 → survivor ─────────────────────────────────
  update public.required_document_types d
     set service_phase_id = v_survivor,
         position = v_doc_off + t.rn - 1,
         updated_at = now()
    from (
      select id, row_number() over (order by is_active desc, position, slug) rn
        from public.required_document_types where service_phase_id = v_fase2
    ) t
   where d.id = t.id;

  -- ── 2. Formularios: memo + cuestionario + I-589 Partes B/C → survivor ──────
  update public.form_definitions f
     set service_phase_id = v_survivor,
         position = v_form_off + t.rn - 1,
         updated_at = now()
    from (
      select id, row_number() over (order by position, slug) rn
        from public.form_definitions where service_phase_id = v_fase2
    ) t
   where f.id = t.id;

  -- ── 3. Milestones: mover renumerando (position es único por fase) ──────────
  update public.service_phase_milestones m
     set service_phase_id = v_survivor,
         position = v_ms_off + t.rn - 1
    from (
      select id, row_number() over (order by week_offset nulls last, position, slug) rn
        from public.service_phase_milestones where service_phase_id = v_fase2
    ) t
   where m.id = t.id;

  -- ── 4. Citas: ruta única de 3 citas en la survivor ─────────────────────────
  delete from public.service_appointment_schedule
   where service_phase_id in (v_survivor, v_fase2);

  insert into public.service_appointment_schedule
    (service_phase_id, sequence_number, duration_minutes, kind, week_offset, label_i18n, objectives_i18n, position)
  values
    (v_survivor, 1, 30, 'video', 1,
     '{"es":"Introducción y uso del sistema","en":"Introduction & onboarding"}'::jsonb,
     jsonb_build_array(
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Dar la bienvenida y explicar el proceso de asilo afirmativo (Formulario I-589) y cómo usar la plataforma.',
         'en','Welcome the client and explain the affirmative asylum process (Form I-589) and how to use the platform.')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Revisar la lista de documentos y quiénes deben aportarlos: solicitante, cónyuge e hijos.',
         'en','Review the document checklist and who must provide each: applicant, spouse and children.')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Explicar el plazo de 1 año desde el ingreso a EE. UU. y confirmar los familiares derivados del caso.',
         'en','Explain the 1-year filing deadline from U.S. entry and confirm the derivative family members.'))
     ), 0),
    (v_survivor, 2, 30, 'video', 2,
     '{"es":"Avance del Formulario I-589","en":"Form I-589 progress"}'::jsonb,
     jsonb_build_array(
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Revisar el avance del Formulario I-589 y confirmar los datos personales (identidad, nacionalidad, fecha y forma de ingreso, I-94 y A-number).',
         'en','Review Form I-589 progress and confirm personal data (identity, nationality, date and manner of entry, I-94 and A-number).')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Verificar que los documentos de identidad y de entrada estén subidos, legibles y completos por cada miembro.',
         'en','Verify identity and entry documents are uploaded, legible and complete for each member.')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Identificar los documentos que requieren traducción al inglés y explicar el siguiente paso.',
         'en','Identify the documents that require English translation and explain the next step.'))
     ), 1),
    (v_survivor, 3, 30, 'video', 3,
     '{"es":"Avance del Miedo Creíble","en":"Credible Fear progress"}'::jsonb,
     jsonb_build_array(
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Revisar la declaración jurada y la narrativa de persecución: coherencia, fechas, nombres y nivel de detalle.',
         'en','Review the sworn declaration and persecution narrative: consistency, dates, names and level of detail.')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Verificar las evidencias sustentatorias subidas y confirmar su traducción al inglés.',
         'en','Verify the uploaded supporting evidence and confirm its English translation.')),
       jsonb_build_object('id', gen_random_uuid(), 'text', jsonb_build_object(
         'es','Confirmar el nexo con la base protegida y revisar el avance del memorándum de Miedo Creíble antes de validar el expediente.',
         'en','Confirm the nexus to the protected ground and review the Credible Fear memorandum progress before validating the case file.'))
     ), 2);

  -- Política de citas: una sola en la survivor (3 citas); quitar la de fase-2.
  update public.phase_appointment_policies
     set appointment_count = 3, duration_minutes = 30, kind = 'video', updated_at = now()
   where service_phase_id = v_survivor;
  insert into public.phase_appointment_policies (service_phase_id, appointment_count, duration_minutes, kind)
  select v_survivor, 3, 30, 'video'
   where not exists (select 1 from public.phase_appointment_policies where service_phase_id = v_survivor);
  delete from public.phase_appointment_policies where service_phase_id = v_fase2;

  -- ── 5. Datos operativos: reapuntar de fase-2 a la survivor ─────────────────
  update public.cases                     set current_phase_id = v_survivor where current_phase_id = v_fase2;
  update public.case_documents            set service_phase_id = v_survivor where service_phase_id = v_fase2;
  update public.case_form_responses       set service_phase_id = v_survivor where service_phase_id = v_fase2;
  update public.case_appointment_schedule set service_phase_id = v_survivor where service_phase_id = v_fase2;
  update public.appointments              set service_phase_id = v_survivor where service_phase_id = v_fase2;
  update public.case_overrides            set service_phase_id = v_survivor where service_phase_id = v_fase2;

  -- ── 6. case_phase_history (inmutable): borrar la transición a la fase eliminada ──
  execute 'alter table public.case_phase_history disable trigger case_phase_history_immutable';
  delete from public.case_phase_history where phase_id = v_fase2;
  execute 'alter table public.case_phase_history enable trigger case_phase_history_immutable';

  -- ── 7. entry_phase_id: reapuntar cualquier servicio de entrada a fase-2 ─────
  update public.services set entry_phase_id = v_survivor where entry_phase_id = v_fase2;

  -- ── 8. Renombrar la survivor a la fase única ───────────────────────────────
  update public.service_phases set
     slug = 'principal',
     label_i18n = '{"es":"Preparación del caso","en":"Case preparation"}'::jsonb,
     client_explainer_i18n = jsonb_build_object(
       'es','Sube tus documentos de identidad y de entrada a EE. UU., completa el Formulario I-589 y tu declaración jurada, y adjunta las evidencias de persecución. Con eso generamos el memorándum de Miedo Creíble y armamos tu expediente.',
       'en','Upload your identity and U.S. entry documents, complete Form I-589 and your sworn declaration, and attach your evidence of persecution. With that we generate the Credible Fear memorandum and assemble your case file.'),
     position = 0
   where id = v_survivor;

  -- ── 9. Eliminar la fase-2 (ya sin referencias) ─────────────────────────────
  delete from public.service_phases where id = v_fase2;

  raise notice '0079: asilo fusionado a fase única (survivor=%)', v_survivor;
end $$;
