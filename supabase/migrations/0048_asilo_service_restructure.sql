-- 0048_asilo_service_restructure.sql
--
-- Restructures the "Asilo Político" service to production shape and wires the
-- Credible-Fear memorandum to its real inputs + enables the annexes. Data-only,
-- idempotent. Resolves phase ids by slug (no hardcoded generated ids).

-- ── PART A — Fase 1 documents (adjust flags) ───────────────────────────────
update public.required_document_types d set
  is_required = case d.slug when 'documento-identidad' then false when 'i-94' then false else d.is_required end,
  is_per_party = case d.slug when 'documento-identidad' then true when 'i-94' then true when 'parole-nta' then true else d.is_per_party end,
  party_roles = case d.slug
                  when 'documento-identidad' then array['petitioner','spouse','minor']::text[]
                  when 'i-94' then array['petitioner','spouse','minor']::text[]
                  when 'parole-nta' then array['petitioner','spouse','minor']::text[]
                  else d.party_roles end,
  requires_translation = case d.slug when 'acta-matrimonio' then true when 'acta-nacimiento-hijos' then true else d.requires_translation end,
  updated_at = now()
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where d.service_phase_id = ph.id and ph.slug = 'fase-1';

-- Fase 1: add "Dirección / comprobante de domicilio" (required), only if absent.
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, help_i18n, is_required, is_per_party, ai_extract, requires_translation, allow_multiple, position, is_active)
select ph.id, 'direccion',
       '{"es":"Dirección (comprobante de domicilio)","en":"Address (proof of residence)"}'::jsonb,
       '{"es":"Comprobante de tu domicilio actual (factura de servicios, contrato de arrendamiento, etc.).","en":"Proof of your current address (utility bill, lease, etc.)."}'::jsonb,
       true, false, false, false, false, 0, true
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where ph.slug = 'fase-1'
  and not exists (select 1 from public.required_document_types d where d.service_phase_id = ph.id and d.slug = 'direccion');

-- ── PART B — Fase 2 documents ──────────────────────────────────────────────
-- Deactivate the six granular evidence docs (replaced by one multi-file item).
update public.required_document_types d set is_active = false, updated_at = now()
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where d.service_phase_id = ph.id and ph.slug = 'fase-2'
  and d.slug in ('evidencia-policial','evidencia-medica','evidencia-psicologica','evidencia-amenazas','evidencia-prensa','carta-testigo');

-- Fase 2: one "Evidencias sustentatorias" item (multiple files, each translated).
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, help_i18n, is_required, is_per_party, ai_extract, requires_translation, allow_multiple, position, is_active)
select ph.id, 'evidencias-sustentatorias',
       '{"es":"Evidencias sustentatorias","en":"Supporting evidence"}'::jsonb,
       '{"es":"Sube todas tus pruebas (denuncias, informes médicos/psicológicos, amenazas, prensa, cartas de testigos). Cada archivo requiere traducción.","en":"Upload all your evidence (police reports, medical/psychological reports, threats, press, witness letters). Each file requires translation."}'::jsonb,
       false, false, false, true, true, 1, true
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where ph.slug = 'fase-2'
  and not exists (select 1 from public.required_document_types d where d.service_phase_id = ph.id and d.slug = 'evidencias-sustentatorias');

-- ── PART C — Appointments: 2 per phase (intro + review) ────────────────────
update public.phase_appointment_policies p set appointment_count = 2, updated_at = now()
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where p.service_phase_id = ph.id and ph.slug = 'fase-2';

-- Reset and seed the per-appointment cronograma (intro + review) for both phases.
delete from public.service_appointment_schedule sch
using public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
where sch.service_phase_id = ph.id;

insert into public.service_appointment_schedule
  (service_phase_id, sequence_number, duration_minutes, kind, week_offset, label_i18n, objectives_i18n, position)
select ph.id, v.seq, v.dur, 'video', v.wk, v.label::jsonb, v.obj::jsonb, v.seq - 1
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
join (values
  ('fase-1', 1, 30, 1, '{"es":"Cita de introducción","en":"Introduction"}', '{"es":"Conocer al cliente, explicar el proceso y los documentos de la Fase 1.","en":"Meet the client, explain the process and Phase 1 documents."}'),
  ('fase-1', 2, 30, 2, '{"es":"Revisión de información","en":"Information review"}', '{"es":"Revisar los documentos subidos y la información del I-589 Parte A.","en":"Review uploaded documents and I-589 Part A information."}'),
  ('fase-2', 1, 45, 1, '{"es":"Cita de introducción","en":"Introduction"}', '{"es":"Explicar la fase de Reforzar y la declaración del miedo creíble.","en":"Explain the Strengthen phase and the credible-fear declaration."}'),
  ('fase-2', 2, 30, 3, '{"es":"Revisión de información","en":"Information review"}', '{"es":"Revisar la declaración jurada, evidencias y la narrativa de persecución.","en":"Review the affidavit, evidence and persecution narrative."}')
) as v(phase, seq, dur, wk, label, obj) on v.phase = ph.slug;

-- ── PART D — Credible-Fear memorandum config ───────────────────────────────
-- Wire real inputs (affidavit + the I-589 Parts B/C questionnaire answers),
-- enable the annexes, raise the per-section word floors for a 100+ page body,
-- and broaden the research instructions (>=5 verified country-condition sources).
update public.ai_generation_configs c set
  input_document_slugs = array['declaracion-jurada']::text[],
  input_form_slugs = array['i-589-partes-b-y-c-reclamo-de-asilo']::text[],
  assembly = c.assembly || '{"annexes": true}'::jsonb,
  research_instructions =
    'Use web_search to find (a) 6-10 REAL, favorable, published federal asylum/withholding precedents (Circuit Courts and the BIA) matched to the applicant''s nationality and persecution type — search CourtListener, Justia and scholar.google.com; and (b) at least 5 recent, verified country-conditions sources (international, national and local) — reputable outlets, HRW, U.S. State Department — corroborating the applicant''s region and profile. Never fabricate a citation, holding, statistic or URL; prefer sources with a working link. The reference dataset is a style/argumentation guide and a pointer to the kinds of sources winning cases used.',
  sections = (
    select jsonb_agg(
      case when coalesce((t.s->>'min_words')::int, 0) > 0
        then jsonb_set(t.s, '{min_words}', to_jsonb(least(20000, ceil((t.s->>'min_words')::numeric * 1.2)::int)))
        else t.s end
      order by t.ord
    )
    from jsonb_array_elements(c.sections) with ordinality as t(s, ord)
  ),
  updated_at = now()
from public.form_definitions fd
where fd.id = c.form_definition_id and fd.slug = 'memorandum-de-miedo-creible';
