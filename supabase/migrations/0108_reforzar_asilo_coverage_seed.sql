-- 0108_reforzar_asilo_coverage_seed.sql
-- Seed de cobertura para reforzar-asilo/fase-1 (doble red, decisión de Henry
-- 2026-07-22): la declaración jurada y las evidencias pasan a OPCIONALES y
-- detectables dentro de un PDF combinado. El I-589 queda obligatorio y
-- no-detectable (es el contenedor). Idempotente, resuelve por slug — cero ids.

do $$
declare
  v_phase uuid;
begin
  select ph.id into v_phase
    from public.service_phases ph
    join public.services s on s.id = ph.service_id
   where s.slug = 'reforzar-asilo' and ph.slug = 'fase-1';
  if v_phase is null then
    raise notice 'seed cobertura: reforzar-asilo/fase-1 no existe; no-op';
    return;
  end if;

  update public.required_document_types
     set is_required = false,
         detectable_in_combined = true,
         detection_hints_i18n = jsonb_build_object(
           'es', 'Declaración jurada (affidavit) del solicitante: narrativa en primera persona de los hechos de persecución, usualmente firmada y fechada, a menudo titulada "Declaration", "Affidavit" o "Declaración jurada". Suele venir como anexo del I-589.',
           'en', 'Applicant sworn declaration (affidavit): first-person narrative of the persecution facts, usually signed and dated, often titled "Declaration", "Affidavit" or "Sworn statement". Frequently attached to the I-589.'
         ),
         updated_at = now()
   where service_phase_id = v_phase
     and slug = 'declaracion-jurada-affidavit';

  update public.required_document_types
     set is_required = false,
         detectable_in_combined = true,
         detection_hints_i18n = jsonb_build_object(
           'es', 'Evidencias sustentatorias: denuncias policiales, informes médicos o psicológicos, amenazas (capturas/cartas), notas de prensa, cartas de testigos, fotos de lesiones. Cualquier anexo probatorio distinto del formulario y de la declaración.',
           'en', 'Supporting evidence: police reports, medical or psychological records, threat messages (screenshots/letters), press articles, witness letters, injury photos. Any evidentiary annex other than the form itself and the declaration.'
         ),
         updated_at = now()
   where service_phase_id = v_phase
     and slug = 'evidencias-sustentatorias';
end $$;
