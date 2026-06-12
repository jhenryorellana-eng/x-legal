-- =============================================================================
-- 02_catalogo_servicios.sql
-- The 13 initial services as configuration (DOC-00 §5.1)
-- Source of content fidelity: legacy registry.ts, workflow files,
-- migrations 20260430_*, 20260521e_*.
-- Idempotent: ON CONFLICT DO NOTHING throughout.
-- This seed populates an empty DB. After go-live, the catalog is edited
-- via the Admin editor — this seed is NOT re-applied (DOC-32 §3).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §5.1 — services (13 initial services)
-- ---------------------------------------------------------------------------
insert into public.services (org_id, slug, category, label_i18n, description_i18n, icon, color, is_active, is_public, position)
select o.id, s.slug, 'migratorio', s.label, s.descr, s.icon, s.color, true, true, s.pos
from public.orgs o
cross join (values
  ('visa-juvenil',
   '{"es":"Visa Juvenil (SIJS)","en":"Juvenile Visa (SIJS)"}'::jsonb,
   '{"es":"Estatus Especial de Inmigrante Juvenil para menores víctimas de abuso, abandono o negligencia parental.","en":"Special Immigrant Juvenile Status for minors who suffered parental abuse, abandonment or neglect."}'::jsonb,
   'child', 'purple', 1),
  ('asilo-politico',
   '{"es":"Asilo Político","en":"Political Asylum"}'::jsonb,
   '{"es":"Solicitud de asilo (I-589) por persecución por raza, religión, nacionalidad, opinión política o grupo social.","en":"Asylum application (I-589) based on persecution for race, religion, nationality, political opinion or social group."}'::jsonb,
   'shield', 'navy', 2),
  ('reforzar-asilo',
   '{"es":"Reforzar Asilo","en":"Asylum Strengthening"}'::jsonb,
   '{"es":"Reforzamiento del caso de asilo para quienes ya presentaron su I-589: declaración jurada y memorándum de Miedo Creíble.","en":"Case strengthening for clients who already filed their I-589: sworn declaration and Credible Fear memorandum."}'::jsonb,
   'shield', 'accent', 3),
  ('apelacion',
   '{"es":"Apelación (BIA)","en":"Appeal (BIA)"}'::jsonb,
   '{"es":"Apelación ante la Junta de Apelaciones de Inmigración — Notice of Appeal (EOIR-26).","en":"Appeal before the Board of Immigration Appeals — Notice of Appeal (EOIR-26)."}'::jsonb,
   'gavel', 'red', 4),
  ('cambio-de-corte',
   '{"es":"Cambio de Corte","en":"Change of Venue"}'::jsonb,
   '{"es":"Moción de cambio de sede (EOIR-33) ante la Corte de Inmigración actual.","en":"Motion for Change of Venue (EOIR-33) before the current Immigration Court."}'::jsonb,
   'map-pin', 'accent', 5),
  ('ajuste-de-estatus-matrimonio',
   '{"es":"Ajuste de Estatus por Matrimonio","en":"Marriage-Based Adjustment of Status"}'::jsonb,
   '{"es":"Petición familiar por matrimonio (I-130) y ajuste de estatus del cónyuge (I-485).","en":"Marriage-based family petition (I-130) and spouse adjustment of status (I-485)."}'::jsonb,
   'heart', 'green', 6),
  ('permiso-de-trabajo',
   '{"es":"Permiso de Trabajo (I-765)","en":"Work Permit (I-765)"}'::jsonb,
   '{"es":"Autorización de empleo por asilo pendiente — categoría (c)(8).","en":"Employment authorization based on pending asylum — category (c)(8)."}'::jsonb,
   'briefcase', 'gold', 7),
  ('cambio-de-estatus',
   '{"es":"Cambio de Estatus","en":"Change of Status"}'::jsonb,
   '{"es":"Cambio de categoría de visa no inmigrante ante USCIS.","en":"Change of nonimmigrant visa category with USCIS."}'::jsonb,
   'doc', 'accent', 8),
  ('mociones',
   '{"es":"Mociones","en":"Motions"}'::jsonb,
   '{"es":"Mociones de reapertura o reconsideración ante la corte de inmigración.","en":"Motions to reopen or reconsider before the immigration court."}'::jsonb,
   'gavel', 'navy', 9),
  ('taxes',
   '{"es":"Declaración de Impuestos","en":"Tax Filing"}'::jsonb,
   '{"es":"Preparación y presentación de la declaración de impuestos.","en":"Tax return preparation and filing."}'::jsonb,
   'calculator', 'green', 10),
  ('itin-number',
   '{"es":"Número ITIN","en":"ITIN Number"}'::jsonb,
   '{"es":"Solicitud del número de identificación fiscal individual (W-7).","en":"Individual Taxpayer Identification Number application (W-7)."}'::jsonb,
   'id-card', 'gold', 11),
  ('licencia-de-conducir',
   '{"es":"Licencia de Conducir","en":"Driver''s License"}'::jsonb,
   '{"es":"Asistencia para obtener la licencia de conducir estatal.","en":"Assistance obtaining a state driver''s license."}'::jsonb,
   'car', 'accent', 12),
  ('adelantos',
   '{"es":"Adelantos (Advance Parole)","en":"Advance Parole"}'::jsonb,
   '{"es":"Permiso de viaje (I-131) para casos con trámite pendiente.","en":"Travel permit (I-131) for cases with a pending application."}'::jsonb,
   'plane', 'purple', 13)
) as s(slug, label, descr, icon, color, pos)
where o.name = 'UsaLatinoPrime'
on conflict (slug) do nothing;


-- ---------------------------------------------------------------------------
-- §5.2 — service_phases
-- ---------------------------------------------------------------------------
insert into public.service_phases (service_id, slug, label_i18n, description_i18n, position)
select s.id, p.slug, p.label, p.descr, p.pos
from public.services s
join (values
  -- Visa Juvenil (source: registry.ts VISA_JUVENIL_PHASES)
  ('visa-juvenil', 'custodia',
   '{"es":"Fase 1 — Custodia","en":"Phase 1 — Custody"}'::jsonb,
   '{"es":"Obtener la orden de custodia con hallazgos SIJS de la corte estatal.","en":"Obtain the custody order with SIJS findings from the state court."}'::jsonb,
   1),
  ('visa-juvenil', 'i360',
   '{"es":"Fase 2 — I-360","en":"Phase 2 — I-360"}'::jsonb,
   '{"es":"Petición SIJS ante USCIS.","en":"SIJS petition before USCIS."}'::jsonb,
   2),
  ('visa-juvenil', 'i485',
   '{"es":"Fase 3 — I-485","en":"Phase 3 — I-485"}'::jsonb,
   '{"es":"Ajuste de estatus / Green Card.","en":"Adjustment of status / Green Card."}'::jsonb,
   3),
  -- Asilo Político (no terminal phase: closure = cases.status='completed', DOC-32 Proposal P1)
  ('asilo-politico', 'sustentos',
   '{"es":"Fase 1 — Sustentos","en":"Phase 1 — Foundations"}'::jsonb,
   '{"es":"Identidad, estatus de ingreso y formulario I-589 (partes 1-5).","en":"Identity, entry status and Form I-589 (parts 1-5)."}'::jsonb,
   1),
  ('asilo-politico', 'reforzar',
   '{"es":"Fase 2 — Reforzar","en":"Phase 2 — Strengthen"}'::jsonb,
   '{"es":"Declaración jurada, evidencias y generación del Miedo Creíble.","en":"Sworn declaration, evidence and Credible Fear generation."}'::jsonb,
   2),
  -- Reforzar Asilo (entry service: maps to asilo-politico phase 'reforzar')
  ('reforzar-asilo', 'reforzar',
   '{"es":"Reforzar Asilo","en":"Strengthen Asylum"}'::jsonb,
   '{"es":"Declaración jurada, evidencias y generación del Miedo Creíble sobre el I-589 ya presentado.","en":"Sworn declaration, evidence and Credible Fear generation over the already-filed I-589."}'::jsonb,
   1),
  -- Single-phase services
  ('apelacion', 'unica',
   '{"es":"Apelación","en":"Appeal"}'::jsonb,
   '{"es":"Apelación ante la BIA — Notice of Appeal vía Formulario EOIR-26.","en":"Appeal before the BIA — Notice of Appeal via Form EOIR-26."}'::jsonb,
   1),
  ('cambio-de-corte', 'unica',
   '{"es":"Cambio de Corte","en":"Change of Venue"}'::jsonb,
   '{"es":"Moción de Cambio de Venue (EOIR-33) ante la Corte de Inmigración actual.","en":"Motion for Change of Venue (EOIR-33) before the current Immigration Court."}'::jsonb,
   1),
  -- Matrimonio (source: registry.ts MATRIMONIO_PHASES)
  ('ajuste-de-estatus-matrimonio', 'i130',
   '{"es":"Fase 1 — Petición (I-130)","en":"Phase 1 — Petition (I-130)"}'::jsonb,
   '{"es":"Petición de familiar por matrimonio (Formulario I-130) ante USCIS.","en":"Marriage-based family petition (Form I-130) before USCIS."}'::jsonb,
   1),
  ('ajuste-de-estatus-matrimonio', 'i485',
   '{"es":"Fase 2 — Ajuste (I-485)","en":"Phase 2 — Adjustment (I-485)"}'::jsonb,
   '{"es":"Ajuste de estatus / Green Card del cónyuge (Formulario I-485).","en":"Spouse''s adjustment of status / Green Card (Form I-485)."}'::jsonb,
   2),
  ('permiso-de-trabajo', 'unica',
   '{"es":"Permiso de Trabajo (I-765)","en":"Work Permit (I-765)"}'::jsonb,
   '{"es":"Solicitud de Autorización de Empleo (I-765) por asilo pendiente — categoría (c)(8).","en":"Employment Authorization application (I-765) for pending asylum — category (c)(8)."}'::jsonb,
   1),
  -- Simple services: 1 flat phase
  ('cambio-de-estatus', 'unica', '{"es":"Trámite","en":"Process"}'::jsonb, null, 1),
  ('mociones',          'unica', '{"es":"Trámite","en":"Process"}'::jsonb, null, 1),
  ('taxes',             'unica', '{"es":"Trámite","en":"Process"}'::jsonb, null, 1),
  ('itin-number',       'unica', '{"es":"Trámite","en":"Process"}'::jsonb, null, 1),
  ('licencia-de-conducir','unica','{"es":"Trámite","en":"Process"}'::jsonb, null, 1),
  ('adelantos',         'unica', '{"es":"Trámite","en":"Process"}'::jsonb, null, 1)
) as p(service_slug, slug, label, descr, pos)
  on p.service_slug = s.slug
on conflict (service_id, slug) do nothing;

-- Set entry-phase link for "Reforzar Asilo" (entry service pattern)
update public.services s
set entry_parent_service_id = (select id from public.services where slug = 'asilo-politico'),
    entry_phase_id = (
      select ph.id
        from public.service_phases ph
        join public.services p on p.id = ph.service_id
       where p.slug = 'asilo-politico'
         and ph.slug = 'reforzar'
    )
where s.slug = 'reforzar-asilo';


-- ---------------------------------------------------------------------------
-- §5.3 — service_plans (price_cents = 0; Admin sets prices before activating sales)
-- ---------------------------------------------------------------------------
insert into public.service_plans (service_id, kind, price_cents, requires_lawyer_validation, default_installments, default_downpayment_cents, is_active)
select s.id, p.kind, 0, p.validation, p.installments, 0, true
-- ^^^ TODO(Henry): set ALL prices and down-payments from the Admin editor before activating sales
from public.services s
join (values
  ('visa-juvenil',                 'self',        false, 10),
  ('visa-juvenil',                 'with_lawyer', true,  10),
  ('asilo-politico',               'self',        false, 9),
  ('asilo-politico',               'with_lawyer', true,  9),
  ('reforzar-asilo',               'self',        false, 9),
  -- legacy reforzar-asilo reference: $900, up to 9 installments, 20% down (20260521e_reforzar_asilo_service.sql)
  ('reforzar-asilo',               'with_lawyer', true,  9),
  ('apelacion',                    'self',        false, 3),
  ('apelacion',                    'with_lawyer', true,  3),
  ('cambio-de-corte',              'self',        false, 2),
  ('cambio-de-corte',              'with_lawyer', true,  2),
  ('ajuste-de-estatus-matrimonio', 'self',        false, 10),
  ('ajuste-de-estatus-matrimonio', 'with_lawyer', true,  10),
  ('permiso-de-trabajo',           'self',        false, 3),
  ('permiso-de-trabajo',           'with_lawyer', true,  3),
  -- Simple services: self only (Admin can add with_lawyer from editor if needed)
  ('cambio-de-estatus',      'self', false, 2),
  ('mociones',               'self', false, 3),
  ('taxes',                  'self', false, 1),
  ('itin-number',            'self', false, 1),
  ('licencia-de-conducir',   'self', false, 1),
  ('adelantos',              'self', false, 2)
) as p(service_slug, kind, validation, installments)
  on p.service_slug = s.slug
on conflict (service_id, kind) do nothing;


-- ---------------------------------------------------------------------------
-- §5.4 — phase_appointment_policies (editable by Vanessa via Admin)
-- ---------------------------------------------------------------------------
insert into public.phase_appointment_policies (service_phase_id, appointment_count, duration_minutes, kind)
select ph.id, p.cnt, p.mins, 'video'
from public.service_phases ph
join public.services s on s.id = ph.service_id
join (values
  ('visa-juvenil',                 'custodia', 3, 30),
  ('visa-juvenil',                 'i360',     2, 30),
  ('visa-juvenil',                 'i485',     2, 30),
  ('asilo-politico',               'sustentos',2, 30),
  ('asilo-politico',               'reforzar', 3, 30),
  ('reforzar-asilo',               'reforzar', 2, 30),
  ('apelacion',                    'unica',    2, 30),
  ('cambio-de-corte',              'unica',    1, 30),
  ('ajuste-de-estatus-matrimonio', 'i130',     2, 30),
  ('ajuste-de-estatus-matrimonio', 'i485',     2, 30),
  ('permiso-de-trabajo',           'unica',    1, 30),
  ('cambio-de-estatus',            'unica',    1, 30),
  ('mociones',                     'unica',    1, 30),
  ('taxes',                        'unica',    1, 30),
  ('itin-number',                  'unica',    1, 30),
  ('licencia-de-conducir',         'unica',    1, 30),
  ('adelantos',                    'unica',    1, 30)
) as p(service_slug, phase_slug, cnt, mins)
  on p.service_slug = s.slug and p.phase_slug = ph.slug
on conflict (service_phase_id) do nothing;


-- ---------------------------------------------------------------------------
-- §5.5 — service_phase_milestones (Visa Juvenil only; others via Admin)
-- Source: prototype C9 / DOC-06 §C9
-- Sequence: corte → I-360 enviada → recibo → I-360 aprobada → visa disponible
--           → I-485 enviada → biometría → decisión
-- Note: 'interview' milestone NOT seeded (not in prototype; add via Admin if needed)
-- ---------------------------------------------------------------------------
insert into public.service_phase_milestones (service_phase_id, slug, label_i18n, glossary_i18n, icon, position)
select ph.id, m.slug, m.label, m.glossary, m.icon, m.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join (values
  -- phase: custodia
  ('custodia', 'orden-custodia',
   '{"es":"Orden de custodia (corte estatal)","en":"Custody order (state court)"}'::jsonb,
   '{"es":"Un juez estatal decide sobre la custodia del menor y emite los hallazgos especiales que la ley exige para la Visa Juvenil.","en":"A state judge rules on the minor''s custody and issues the special findings required by law for SIJS."}'::jsonb,
   'gavel', 1),
  -- phase: i360
  ('i360', 'i360-envio',
   '{"es":"Petición I-360 enviada a USCIS","en":"I-360 petition filed with USCIS"}'::jsonb,
   '{"es":"Tu equipo presentó la petición de Estatus Especial de Inmigrante Juvenil ante USCIS.","en":"Your team filed the Special Immigrant Juvenile petition with USCIS."}'::jsonb,
   'send', 1),
  ('i360', 'recibo',
   '{"es":"Recibo de USCIS","en":"USCIS receipt notice"}'::jsonb,
   '{"es":"USCIS confirmó que recibió tu caso y te asignó un número de recibo. Puedes verificarlo en el sitio oficial de USCIS.","en":"USCIS confirmed it received your case and assigned a receipt number. You can check it on the official USCIS site."}'::jsonb,
   'receipt', 2),
  ('i360', 'i360-aprobacion',
   '{"es":"I-360 aprobada","en":"I-360 approved"}'::jsonb,
   '{"es":"USCIS aprobó la petición. Es el paso clave hacia la residencia.","en":"USCIS approved the petition. It is the key step toward residency."}'::jsonb,
   'check', 3),
  ('i360', 'visa-disponible',
   '{"es":"Visa disponible (fecha de prioridad)","en":"Visa available (priority date)"}'::jsonb,
   '{"es":"Tu fecha de prioridad quedó vigente en el boletín de visas: ya puedes pedir la Green Card.","en":"Your priority date became current in the visa bulletin: you can now apply for the Green Card."}'::jsonb,
   'calendar', 4),
  -- phase: i485
  ('i485', 'i485-envio',
   '{"es":"Solicitud de Green Card (I-485) enviada","en":"Green Card application (I-485) filed"}'::jsonb,
   '{"es":"Tu equipo presentó la solicitud de residencia permanente ante USCIS.","en":"Your team filed the permanent residency application with USCIS."}'::jsonb,
   'send', 1),
  ('i485', 'biometria',
   '{"es":"Biometría","en":"Biometrics appointment"}'::jsonb,
   '{"es":"USCIS te cita para tomar huellas y foto. Es un paso normal del proceso.","en":"USCIS schedules you for fingerprints and photo. A normal step of the process."}'::jsonb,
   'fingerprint', 2),
  ('i485', 'decision',
   '{"es":"Decisión final — ¡Green Card!","en":"Final decision — Green Card!"}'::jsonb,
   '{"es":"USCIS decide tu caso. Si aprueba, la Green Card llega por correo.","en":"USCIS decides your case. If approved, your Green Card arrives by mail."}'::jsonb,
   'star', 3)
) as m(phase_slug, slug, label, glossary, icon, pos)
  on m.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;


-- ---------------------------------------------------------------------------
-- §5.6 — required_document_types
-- Source: 20260430_simplify_custodia/i360/i485_documents.sql,
--         workflows/asilo-politico.ts, 20260521e_reforzar_asilo_service.sql
-- ---------------------------------------------------------------------------

-- ── Visa Juvenil — fase custodia ────────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join (values
  ('custodia', 'acta-nacimiento-menor',
   '{"es":"Acta de nacimiento del menor","en":"Minor''s birth certificate"}'::jsonb,
   '{"es":"Documentos del Menor","en":"Minor''s Documents"}'::jsonb,
   true, true, array['minor']::text[], true, 10),
  ('custodia', 'pasaporte-menor',
   '{"es":"Pasaporte del menor","en":"Minor''s passport"}'::jsonb,
   '{"es":"Documentos del Menor","en":"Minor''s Documents"}'::jsonb,
   false, true, array['minor']::text[], true, 20),
  ('custodia', 'id-menor',
   '{"es":"ID del menor (DNI o cédula)","en":"Minor''s national ID"}'::jsonb,
   '{"es":"Documentos del Menor","en":"Minor''s Documents"}'::jsonb,
   true, true, array['minor']::text[], false, 30),
  ('custodia', 'id-tutor',
   '{"es":"ID del tutor","en":"Guardian''s photo ID"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   true, true, array['guardian']::text[], true, 40),
  ('custodia', 'contrato-renta',
   '{"es":"Contrato de renta del hogar","en":"Home lease agreement"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   true, false, null, false, 50),
  ('custodia', 'facturas-servicios',
   '{"es":"Facturas de servicios del hogar","en":"Home utility bills"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   true, false, null, false, 60),
  ('custodia', 'prueba-ingresos-tutor',
   '{"es":"Prueba de ingresos del tutor","en":"Guardian''s proof of income"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   true, false, null, false, 70),
  ('custodia', 'prueba-residencia-escolar',
   '{"es":"Prueba de residencia escolar","en":"School residence proof"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   true, true, array['minor']::text[], false, 80),
  ('custodia', 'acta-nacimiento-tutor',
   '{"es":"Acta de nacimiento del tutor","en":"Guardian''s birth certificate"}'::jsonb,
   '{"es":"Documentos del Tutor","en":"Guardian''s Documents"}'::jsonb,
   false, true, array['guardian']::text[], false, 90),
  ('custodia', 'id-testigos',
   '{"es":"ID de testigos","en":"Witness IDs"}'::jsonb,
   '{"es":"Evidencias Sustentatorias","en":"Supporting Evidence"}'::jsonb,
   false, true, array['witness']::text[], false, 100),
  ('custodia', 'evidencias-sustento',
   '{"es":"Evidencias (fotos, reportes policiales/médicos, récords)","en":"Supporting evidence (photos, police/medical reports, records)"}'::jsonb,
   '{"es":"Evidencias Sustentatorias","en":"Supporting Evidence"}'::jsonb,
   true, false, null, false, 110)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Visa Juvenil — fase i360 ─────────────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join (values
  ('i360', 'acta-nacimiento-menor',
   '{"es":"Acta de nacimiento del menor","en":"Minor''s birth certificate"}'::jsonb,
   '{"es":"Identificación del menor","en":"Minor''s Identification"}'::jsonb,
   true, true, array['minor']::text[], true, 10),
  ('i360', 'pasaporte-menor',
   '{"es":"Pasaporte del menor","en":"Minor''s passport"}'::jsonb,
   '{"es":"Identificación del menor","en":"Minor''s Identification"}'::jsonb,
   false, true, array['minor']::text[], true, 20),
  ('i360', 'fotos-uscis',
   '{"es":"Fotos tipo pasaporte USCIS (2x2)","en":"USCIS passport-style photos (2x2)"}'::jsonb,
   '{"es":"Identificación del menor","en":"Minor''s Identification"}'::jsonb,
   true, true, array['minor']::text[], false, 30),
  ('i360', 'orden-custodia-sijs',
   '{"es":"Orden de custodia con hallazgos SIJS (Predicate Order)","en":"Custody order with SIJS findings (Predicate Order)"}'::jsonb,
   '{"es":"Orden judicial","en":"Court Order"}'::jsonb,
   true, true, array['minor']::text[], true, 40),
  ('i360', 'i94-menor',
   '{"es":"Registro I-94 del menor","en":"Minor''s I-94 record"}'::jsonb,
   '{"es":"Historial migratorio","en":"Immigration History"}'::jsonb,
   false, true, array['minor']::text[], true, 50),
  ('i360', 'sello-cbp',
   '{"es":"Sello de entrada CBP","en":"CBP entry stamp"}'::jsonb,
   '{"es":"Historial migratorio","en":"Immigration History"}'::jsonb,
   false, true, array['minor']::text[], false, 60),
  ('i360', 'consentimiento-orr',
   '{"es":"Consentimiento ORR (si estuvo bajo custodia ORR)","en":"ORR consent (if applicable)"}'::jsonb,
   '{"es":"Historial migratorio","en":"Immigration History"}'::jsonb,
   false, true, array['minor']::text[], false, 70)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Visa Juvenil — fase i485 ─────────────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'visa-juvenil'
join (values
  ('i485', 'aprobacion-i360',
   '{"es":"Aprobación I-360 (Notice I-797)","en":"I-360 approval notice (I-797)"}'::jsonb,
   '{"es":"I-360 aprobada e identidad","en":"Approved I-360 and Identity"}'::jsonb,
   true, true, array['minor']::text[], true, 10),
  ('i485', 'acta-nacimiento-menor',
   '{"es":"Acta de nacimiento del menor","en":"Minor''s birth certificate"}'::jsonb,
   '{"es":"I-360 aprobada e identidad","en":"Approved I-360 and Identity"}'::jsonb,
   true, true, array['minor']::text[], true, 20),
  ('i485', 'pasaporte-completo',
   '{"es":"Pasaporte completo (todas las páginas)","en":"Full passport (all pages)"}'::jsonb,
   '{"es":"I-360 aprobada e identidad","en":"Approved I-360 and Identity"}'::jsonb,
   true, true, array['minor']::text[], false, 30),
  ('i485', 'id-vigente',
   '{"es":"Identificación vigente con foto","en":"Current photo ID"}'::jsonb,
   '{"es":"I-360 aprobada e identidad","en":"Approved I-360 and Identity"}'::jsonb,
   true, true, array['minor']::text[], false, 40),
  ('i485', 'fotos-uscis',
   '{"es":"Fotos tipo pasaporte USCIS (2x2)","en":"USCIS passport-style photos (2x2)"}'::jsonb,
   '{"es":"I-360 aprobada e identidad","en":"Approved I-360 and Identity"}'::jsonb,
   true, true, array['minor']::text[], false, 50),
  ('i485', 'i94-menor',
   '{"es":"Registro I-94","en":"I-94 record"}'::jsonb,
   '{"es":"Entrada a EE.UU.","en":"U.S. Entry"}'::jsonb,
   false, true, array['minor']::text[], true, 60),
  ('i485', 'sello-cbp',
   '{"es":"Sello de entrada CBP","en":"CBP entry stamp"}'::jsonb,
   '{"es":"Entrada a EE.UU.","en":"U.S. Entry"}'::jsonb,
   false, true, array['minor']::text[], false, 70),
  ('i485', 'consentimiento-orr',
   '{"es":"Consentimiento ORR","en":"ORR consent"}'::jsonb,
   '{"es":"Entrada a EE.UU.","en":"U.S. Entry"}'::jsonb,
   false, true, array['minor']::text[], false, 80),
  ('i485', 'examen-medico-i693',
   '{"es":"Examen médico (I-693, sobre sellado)","en":"Medical exam (I-693, sealed envelope)"}'::jsonb,
   '{"es":"Examen médico y antecedentes","en":"Medical Exam and Background"}'::jsonb,
   true, true, array['minor']::text[], false, 90),
  ('i485', 'antecedentes-penales',
   '{"es":"Antecedentes penales (si aplica)","en":"Criminal records (if any)"}'::jsonb,
   '{"es":"Examen médico y antecedentes","en":"Medical Exam and Background"}'::jsonb,
   false, true, array['minor']::text[], false, 100),
  ('i485', 'registros-corte-juvenil',
   '{"es":"Documentos de corte juvenil (si aplica)","en":"Juvenile court records (if any)"}'::jsonb,
   '{"es":"Examen médico y antecedentes","en":"Medical Exam and Background"}'::jsonb,
   false, true, array['minor']::text[], false, 110),
  ('i485', 'prueba-ingresos-i912',
   '{"es":"Prueba de ingresos / beneficios públicos (I-912)","en":"Income or public benefits proof (I-912)"}'::jsonb,
   '{"es":"Pago / I-912","en":"Payment / I-912"}'::jsonb,
   false, false, null, false, 120)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Asilo Político — fase sustentos ─────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
join (values
  ('sustentos', 'pasaporte',
   '{"es":"Pasaporte","en":"Passport"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, true, 10),
  ('sustentos', 'id-con-foto',
   '{"es":"Cédula o identificación con foto","en":"Photo ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, false, 20),
  ('sustentos', 'i94',
   '{"es":"Registro I-94 (si entró por avión)","en":"I-94 record (if entered by air)"}'::jsonb,
   '{"es":"Inmigración","en":"Immigration"}'::jsonb,
   false, false, null, true, 30),
  ('sustentos', 'parole-nta',
   '{"es":"Parole / NTA (Notice to Appear)","en":"Parole / NTA (Notice to Appear)"}'::jsonb,
   '{"es":"Inmigración","en":"Immigration"}'::jsonb,
   false, false, null, true, 40),
  ('sustentos', 'acta-matrimonio',
   '{"es":"Acta de matrimonio","en":"Marriage certificate"}'::jsonb,
   '{"es":"Familia","en":"Family"}'::jsonb,
   false, true, array['spouse']::text[], false, 50),
  ('sustentos', 'actas-nacimiento-hijos',
   '{"es":"Actas de nacimiento de hijos","en":"Children''s birth certificates"}'::jsonb,
   '{"es":"Familia","en":"Family"}'::jsonb,
   false, true, array['minor']::text[], false, 60)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Asilo Político — fase reforzar ──────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'asilo-politico'
join (values
  ('reforzar', 'declaracion-jurada-personal',
   '{"es":"Declaración jurada personal","en":"Personal sworn declaration"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   true, false, null, true, 10),
  ('reforzar', 'evidencias-persecucion',
   '{"es":"Evidencias de persecución (fotos, reportes, amenazas)","en":"Persecution evidence (photos, reports, threats)"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   false, false, null, false, 20),
  ('reforzar', 'condiciones-pais',
   '{"es":"Condiciones del país de origen","en":"Country conditions"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   false, false, null, false, 30)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Reforzar Asilo — fase reforzar (own catalog) ────────────────────────────
-- Source: 20260521e_reforzar_asilo_service.sql — adds i589-presentado (not in Asilo)
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'reforzar-asilo'
join (values
  ('reforzar', 'i589-presentado',
   '{"es":"I-589 presentado (págs. 1–4)","en":"Filed I-589 (pages 1–4)"}'::jsonb,
   '{"es":"I-589 presentado","en":"Filed I-589"}'::jsonb,
   true, false, null, true, 10),
  ('reforzar', 'declaracion-jurada-personal',
   '{"es":"Declaración jurada personal","en":"Personal sworn declaration"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   true, false, null, true, 20),
  ('reforzar', 'evidencias-persecucion',
   '{"es":"Evidencias de persecución","en":"Persecution evidence"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   false, false, null, false, 30),
  ('reforzar', 'condiciones-pais',
   '{"es":"Condiciones del país de origen","en":"Country conditions"}'::jsonb,
   '{"es":"Tu caso","en":"Your Case"}'::jsonb,
   false, false, null, false, 40)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Apelación — unica ────────────────────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'apelacion'
join (values
  ('unica', 'decision-juez',
   '{"es":"Decisión del Juez de Inmigración","en":"Immigration Judge''s decision"}'::jsonb,
   '{"es":"Documentos del caso","en":"Case Documents"}'::jsonb,
   true, false, null, true, 10),
  -- ai_extract: decision date (appeal deadline is 30 days)
  ('unica', 'nta',
   '{"es":"NTA — Notice to Appear","en":"NTA — Notice to Appear"}'::jsonb,
   '{"es":"Documentos del caso","en":"Case Documents"}'::jsonb,
   false, false, null, true, 20),
  ('unica', 'id-solicitante',
   '{"es":"Identificación del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, false, 30)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Cambio de Corte — unica ──────────────────────────────────────────────────
-- Source: 20260521b_cambio_corte_required_documents.sql
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'cambio-de-corte'
join (values
  ('unica', 'id-solicitante',
   '{"es":"Identificación del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, false, 10),
  ('unica', 'nta',
   '{"es":"NTA — datos de la corte actual","en":"NTA — current court data"}'::jsonb,
   '{"es":"Documentos del caso","en":"Case Documents"}'::jsonb,
   true, false, null, true, 20),
  -- ai_extract: court name, A-Number
  ('unica', 'prueba-nueva-direccion',
   '{"es":"Prueba de la nueva dirección (contrato de renta o factura)","en":"Proof of new address (lease or bill)"}'::jsonb,
   '{"es":"Nueva dirección","en":"New Address"}'::jsonb,
   true, false, null, false, 30)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Ajuste de Estatus por Matrimonio — i130 ──────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'ajuste-de-estatus-matrimonio'
join (values
  ('i130', 'acta-matrimonio',
   '{"es":"Acta de matrimonio","en":"Marriage certificate"}'::jsonb,
   '{"es":"Matrimonio","en":"Marriage"}'::jsonb,
   true, false, null, true, 10),
  ('i130', 'id-peticionario',
   '{"es":"ID del peticionario (ciudadano/residente)","en":"Petitioner''s ID (citizen/resident)"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, true, array['petitioner']::text[], true, 20),
  ('i130', 'acta-nacimiento-beneficiario',
   '{"es":"Acta de nacimiento del beneficiario","en":"Beneficiary''s birth certificate"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, true, array['beneficiary']::text[], true, 30),
  ('i130', 'evidencia-relacion',
   '{"es":"Evidencia de la relación (fotos, comunicaciones)","en":"Relationship evidence (photos, communications)"}'::jsonb,
   '{"es":"Relación conyugal","en":"Marital Relationship"}'::jsonb,
   true, false, null, false, 40),
  ('i130', 'evidencia-financiera-conjunta',
   '{"es":"Cuentas o bienes en común","en":"Joint finances or assets"}'::jsonb,
   '{"es":"Relación conyugal","en":"Marital Relationship"}'::jsonb,
   false, false, null, false, 50)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Ajuste de Estatus por Matrimonio — i485 ──────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'ajuste-de-estatus-matrimonio'
join (values
  ('i485', 'pasaporte-beneficiario',
   '{"es":"Pasaporte del beneficiario","en":"Beneficiary''s passport"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, true, array['beneficiary']::text[], true, 10),
  ('i485', 'i94-beneficiario',
   '{"es":"Registro I-94 del beneficiario","en":"Beneficiary''s I-94 record"}'::jsonb,
   '{"es":"Inmigración","en":"Immigration"}'::jsonb,
   false, false, null, true, 20),
  ('i485', 'fotos-uscis',
   '{"es":"Fotos tipo pasaporte USCIS (2x2)","en":"USCIS passport-style photos (2x2)"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, true, array['beneficiary']::text[], false, 30),
  ('i485', 'examen-medico-i693',
   '{"es":"Examen médico (I-693, sobre sellado)","en":"Medical exam (I-693, sealed envelope)"}'::jsonb,
   '{"es":"Examen médico","en":"Medical Exam"}'::jsonb,
   true, false, null, false, 40),
  ('i485', 'soporte-economico-i864',
   '{"es":"Evidencia de soporte económico — I-864 (taxes, empleo)","en":"Financial support evidence — I-864 (taxes, employment)"}'::jsonb,
   '{"es":"Soporte económico","en":"Financial Support"}'::jsonb,
   true, true, array['petitioner']::text[], false, 50)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Permiso de Trabajo — unica ───────────────────────────────────────────────
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, d.per_party, d.roles, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'permiso-de-trabajo'
join (values
  ('unica', 'recibo-i589',
   '{"es":"Recibo del I-589 (asilo pendiente)","en":"I-589 receipt notice (pending asylum)"}'::jsonb,
   '{"es":"Asilo pendiente","en":"Pending Asylum"}'::jsonb,
   true, false, null, true, 10),
  ('unica', 'fotos-uscis',
   '{"es":"Fotos tipo pasaporte USCIS (2x2)","en":"USCIS passport-style photos (2x2)"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, false, 20),
  ('unica', 'i94-pasaporte',
   '{"es":"I-94 o pasaporte","en":"I-94 or passport"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   false, false, null, false, 30),
  ('unica', 'id-solicitante',
   '{"es":"Identificación del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb,
   true, false, null, false, 40)
) as d(phase_slug, slug, label, cat, req, per_party, roles, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ── Simple services — unica ──────────────────────────────────────────────────

-- Cambio de Estatus
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'cambio-de-estatus'
join (values
  ('unica', 'id-solicitante',
   '{"es":"ID del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 10),
  ('unica', 'pasaporte',
   '{"es":"Pasaporte","en":"Passport"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 20),
  ('unica', 'i94',
   '{"es":"Registro I-94","en":"I-94 record"}'::jsonb,
   '{"es":"Inmigración","en":"Immigration"}'::jsonb, true, false, 30)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- Mociones
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'mociones'
join (values
  ('unica', 'id-solicitante',
   '{"es":"ID del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 10),
  ('unica', 'decision-orden-previa',
   '{"es":"Decisión u orden previa de la corte","en":"Prior court decision or order"}'::jsonb,
   '{"es":"Documentos del caso","en":"Case Documents"}'::jsonb, true, true, 20)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- Taxes
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'taxes'
join (values
  ('unica', 'id-solicitante',
   '{"es":"ID del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 10),
  ('unica', 'formularios-ingresos',
   '{"es":"Formularios de ingresos (W-2 / 1099)","en":"Income forms (W-2 / 1099)"}'::jsonb,
   '{"es":"Ingresos","en":"Income"}'::jsonb, true, false, 20),
  ('unica', 'itin-o-ssn',
   '{"es":"ITIN o SSN","en":"ITIN or SSN"}'::jsonb,
   '{"es":"Identificación fiscal","en":"Tax ID"}'::jsonb, false, false, 30)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- ITIN Number
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'itin-number'
join (values
  ('unica', 'pasaporte',
   '{"es":"Pasaporte","en":"Passport"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, true, 10),
  ('unica', 'declaracion-taxes',
   '{"es":"Declaración de impuestos que acompaña la W-7","en":"Tax return accompanying W-7"}'::jsonb,
   '{"es":"Impuestos","en":"Taxes"}'::jsonb, false, false, 20)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- Licencia de Conducir
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'licencia-de-conducir'
join (values
  ('unica', 'id-solicitante',
   '{"es":"ID del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 10),
  ('unica', 'comprobante-domicilio',
   '{"es":"Comprobante de domicilio","en":"Proof of address"}'::jsonb,
   '{"es":"Domicilio","en":"Address"}'::jsonb, true, false, 20)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;

-- Adelantos (Advance Parole)
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, category_i18n, is_required, is_per_party, party_roles, ai_extract, position)
select ph.id, d.slug, d.label, d.cat, d.req, false, null, d.ai, d.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id and s.slug = 'adelantos'
join (values
  ('unica', 'id-solicitante',
   '{"es":"ID del solicitante","en":"Applicant''s ID"}'::jsonb,
   '{"es":"Identidad","en":"Identity"}'::jsonb, true, false, 10),
  ('unica', 'recibo-caso-pendiente',
   '{"es":"Recibo del caso pendiente (I-485/I-589)","en":"Pending case receipt notice (I-485/I-589)"}'::jsonb,
   '{"es":"Caso pendiente","en":"Pending Case"}'::jsonb, true, true, 20)
) as d(phase_slug, slug, label, cat, req, ai, pos)
  on d.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;


-- ---------------------------------------------------------------------------
-- §5.7 — form_definitions (placeholder slug+kind+label; versions/questions
--         created via Admin editor; official PDFs NOT seeded — §2.3)
-- ---------------------------------------------------------------------------
insert into public.form_definitions (service_phase_id, slug, kind, label_i18n, filled_by, position)
select ph.id, f.slug, f.kind, f.label, f.filled_by, f.pos
from public.service_phases ph
join public.services s on s.id = ph.service_id
join (values
  ('visa-juvenil', 'custodia', 'mi-historia',              'ai_letter',      '{"es":"Mi Historia — declaración jurada del menor","en":"My Story — minor''s sworn declaration"}'::jsonb,       'client', 1),
  ('visa-juvenil', 'custodia', 'formulario-custodia-estatal','pdf_automation', '{"es":"Formulario estatal de custodia","en":"State custody form"}'::jsonb,                                    'staff',  2),
  ('visa-juvenil', 'i360',    'uscis-i-360',               'pdf_automation',  '{"es":"Formulario USCIS I-360","en":"USCIS Form I-360"}'::jsonb,                                               'staff',  1),
  ('visa-juvenil', 'i485',    'uscis-i-485',               'pdf_automation',  '{"es":"Formulario USCIS I-485","en":"USCIS Form I-485"}'::jsonb,                                               'staff',  1),
  ('visa-juvenil', 'i485',    'uscis-i-765',               'pdf_automation',  '{"es":"Formulario USCIS I-765 (permiso de trabajo)","en":"USCIS Form I-765 (work permit)"}'::jsonb,            'staff',  2),
  ('visa-juvenil', 'i485',    'uscis-i-131',               'pdf_automation',  '{"es":"Formulario USCIS I-131 (permiso de viaje)","en":"USCIS Form I-131 (travel permit)"}'::jsonb,            'staff',  3),
  ('asilo-politico','sustentos','uscis-i-589',             'pdf_automation',  '{"es":"Formulario I-589 (partes 1-5)","en":"Form I-589 (parts 1-5)"}'::jsonb,                                  'both',   1),
  ('asilo-politico','reforzar', 'declaracion-jurada',      'ai_letter',       '{"es":"Declaración jurada","en":"Sworn declaration"}'::jsonb,                                                  'both',   1),
  ('asilo-politico','reforzar', 'memorandum-asilo',        'ai_letter',       '{"es":"Memorándum legal de asilo","en":"Asylum legal memorandum"}'::jsonb,                                    'staff',  2),
  ('reforzar-asilo','reforzar', 'memorandum-miedo-creible','ai_letter',       '{"es":"Memorándum de Miedo Creíble","en":"Credible Fear memorandum"}'::jsonb,                                 'staff',  1),
  ('apelacion',    'unica',    'eoir-26',                  'pdf_automation',  '{"es":"Formulario EOIR-26 (Notice of Appeal)","en":"Form EOIR-26 (Notice of Appeal)"}'::jsonb,                'staff',  1),
  ('apelacion',    'unica',    'carta-apelacion',          'ai_letter',       '{"es":"Carta de apelación","en":"Appeal brief letter"}'::jsonb,                                               'staff',  2),
  ('cambio-de-corte','unica',  'eoir-33',                  'pdf_automation',  '{"es":"Formulario EOIR-33 (cambio de sede)","en":"Form EOIR-33 (change of venue)"}'::jsonb,                   'staff',  1),
  ('cambio-de-corte','unica',  'sugerencia-jurisdiccion',  'ai_letter',       '{"es":"Sugerencia de jurisdicción (IA)","en":"Jurisdiction suggestion (AI)"}'::jsonb,                         'staff',  2),
  ('ajuste-de-estatus-matrimonio','i130','uscis-i-130',    'pdf_automation',  '{"es":"Formulario USCIS I-130","en":"USCIS Form I-130"}'::jsonb,                                               'staff',  1),
  ('ajuste-de-estatus-matrimonio','i485','uscis-i-485',    'pdf_automation',  '{"es":"Formulario USCIS I-485","en":"USCIS Form I-485"}'::jsonb,                                               'staff',  1),
  ('permiso-de-trabajo','unica','uscis-i-765',             'pdf_automation',  '{"es":"Formulario USCIS I-765 — categoría (c)(8)","en":"USCIS Form I-765 — category (c)(8)"}'::jsonb,         'staff',  1)
) as f(service_slug, phase_slug, slug, kind, label, filled_by, pos)
  on f.service_slug = s.slug and f.phase_slug = ph.slug
on conflict (service_phase_id, slug) do nothing;
