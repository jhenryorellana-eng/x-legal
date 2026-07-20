-- 0096 — Procedural posture as catalog data + the extraction fields it reads.
--
-- WHY. Case U26-000038 was decided by PRETERMISSION: the judge granted DHS's
-- Motion to Pretermit and never reached the merits. No credibility finding, no
-- particular-social-group analysis and no relocation analysis exist anywhere in
-- the record. The question generator, blind to this, produced merits-appeal
-- questions ("what did the judge say about your credibility?") that were
-- unanswerable BY CONSTRUCTION — 14 of 18 generated questions failed. No
-- retrieval improvement fixes that; only knowing the posture does.
--
-- Two matching failures compound it: the actual grounds live in DHS's motion,
-- which was NEVER UPLOADED ('pretermit' appears 0 times in the 291,879 extracted
-- characters), and nothing in the system noticed. A posture therefore also
-- declares the sources it requires.
--
-- DESIGN LIMITS (so this stays declarative and never becomes a rules engine):
-- a posture may only (a) add required sources, (b) inject a prompt fragment,
-- (c) set flags. No priority column — precedence is specificity, computed in code
-- (see catalog/domain.ts detectPosture). Detection reads STRUCTURED extraction
-- fields, never regex over raw_text.

-- ── A) The posture catalog ───────────────────────────────────────────────────

create table if not exists public.service_postures (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  slug text not null,
  label_i18n jsonb not null,
  /** Slug of the required_document_type whose extraction payload is evaluated. */
  source_document_slug text not null,
  /** Flat AND of declarative conditions: [{"field":"…","op":"…","value":…}]. */
  detection jsonb not null default '[]'::jsonb,
  /** Documents this posture makes mandatory (drives the hard source gate). */
  required_source_slugs text[] not null default '{}',
  /** Appended to the question-generation system prompt when this posture matches. */
  question_playbook_prompt text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_id, slug)
);

comment on table public.service_postures is
  'Procedural posture of a case (pretermission, merits denial, in absentia…). Config-as-data: detection is a flat AND over structured extraction fields; precedence is specificity, computed in code, never a column.';

create index if not exists service_postures_service_idx
  on public.service_postures (service_id) where is_active;

alter table public.service_postures enable row level security;

create policy service_postures_select on public.service_postures
  for select to authenticated
  using ( (select public.has_module('catalog', false)) );

create policy service_postures_insert on public.service_postures
  for insert to authenticated
  with check ( (select public.has_module('catalog', true)) );

create policy service_postures_update on public.service_postures
  for update to authenticated
  using      ( (select public.has_module('catalog', true)) )
  with check ( (select public.has_module('catalog', true)) );

create policy service_postures_delete on public.service_postures
  for delete to authenticated
  using ( (select public.has_module('catalog', true)) );

-- ── B) Detected posture on the case ──────────────────────────────────────────

alter table public.cases
  add column if not exists detected_posture text;

comment on column public.cases.detected_posture is
  'service_postures.slug resolved deterministically after the decision extraction completes. Null = not detected; the caller must surface that, never guess.';

-- ── C) The extraction fields the detection reads ─────────────────────────────
-- The decision schema already captured is_oral_decision/decision_outcome, but had
-- nowhere to record WHY the case ended — so "The Court granted DHS's Motion to
-- Pretermit", the single substantive line of the real decision, was extracted as
-- prose and lost. These two fields make it structured and therefore matchable.

update public.required_document_types rdt
set extraction_schema = jsonb_set(
  jsonb_set(
    rdt.extraction_schema,
    '{properties,reached_merits}',
    jsonb_build_object(
      'type', 'boolean',
      'nullable', true,
      'description',
      'True if the Immigration Judge actually decided the MERITS of the application (credibility, nexus, particular social group, relocation, CAT). FALSE if the case ended without reaching the merits — e.g. the court granted a motion to pretermit, dismissed on a threshold/legal bar, or ordered removal in absentia. Return null if unclear. CRITICAL: a summary order that only checks "denied" boxes without any reasoning is NOT evidence that the merits were reached.'
    ),
    true
  ),
  '{properties,dispositive_motion_granted}',
  jsonb_build_object(
    'type', 'string',
    'nullable', true,
    'enum', jsonb_build_array('pretermit', 'summary_denial', 'in_absentia', 'none'),
    'description',
    'Which dispositive motion or mechanism ended the case, copied from the order: "pretermit" if the court granted a Motion to Pretermit (the application was rejected as legally insufficient without a merits hearing), "summary_denial" for a denial with no merits analysis, "in_absentia" if removal was ordered for failure to appear, "none" if the case was decided on the merits. Return null if the order does not say.'
  ),
  true
)
where rdt.slug = 'decision-y-orden-del-juez-de-inmigracion'
  and rdt.extraction_schema ? 'properties';

-- ── D) Seed: the Appeal (BIA) postures ───────────────────────────────────────

insert into public.service_postures
  (service_id, slug, label_i18n, source_document_slug, detection, required_source_slugs, question_playbook_prompt)
select
  s.id,
  v.slug,
  v.label_i18n,
  'decision-y-orden-del-juez-de-inmigracion',
  v.detection,
  v.required_source_slugs,
  v.playbook
from public.services s
cross join (values
  (
    'pretermision',
    '{"es":"Pretermisión (el juez no llegó al fondo)","en":"Pretermission (merits never reached)"}'::jsonb,
    '[{"field":"dispositive_motion_granted","op":"equals","value":"pretermit"},{"field":"reached_merits","op":"is_false"}]'::jsonb,
    array['mocion-pretermision-dhs', 'transcript-audiencia'],
    'POSTURA DEL CASO: PRETERMISIÓN. El juez concedió la moción del DHS y NUNCA llegó al fondo del asunto. '
      || 'Por tanto NO existen hallazgos de credibilidad, NI análisis de grupo social particular, NI análisis de '
      || 'reubicación interna, NI valoración de la evidencia. PROHIBIDO generar preguntas del tipo "¿qué dijo el juez '
      || 'sobre su credibilidad / su grupo social / la reubicación?": son irrespondibles porque esa decisión no existe. '
      || 'Los motivos reales están en la MOCIÓN DE PRETERMISIÓN del DHS. Genera preguntas sobre: (a) los argumentos '
      || 'legales de esa moción y por qué son incorrectos, (b) la suficiencia legal de la solicitud tal como se presentó, '
      || '(c) confirmación de los elementos que YA constan en el escrito del abogado (grupos sociales propuestos, teoría '
      || 'del nexo, exhibiciones), y (d) lo que ocurrió en la audiencia, que solo el cliente recuerda.'
  ),
  (
    'denegacion-de-fondo',
    '{"es":"Denegación en el fondo","en":"Merits denial"}'::jsonb,
    '[{"field":"reached_merits","op":"is_true"}]'::jsonb,
    array[]::text[],
    'POSTURA DEL CASO: DENEGACIÓN EN EL FONDO. El juez sí resolvió el fondo, así que SÍ existen motivos concretos '
      || '(credibilidad, nexo, grupo social, reubicación, CAT). Ancla cada pregunta a un motivo concreto de la decisión.'
  ),
  (
    'in-absentia',
    '{"es":"Orden in absentia","en":"In absentia order"}'::jsonb,
    '[{"field":"dispositive_motion_granted","op":"equals","value":"in_absentia"}]'::jsonb,
    array['nta'],
    'POSTURA DEL CASO: ORDEN IN ABSENTIA. No hubo audiencia de fondo. Las preguntas deben centrarse en la NOTIFICACIÓN '
      || '(si el cliente recibió la NTA y en qué dirección) y en la causa justificada de la incomparecencia.'
  )
) as v(slug, label_i18n, detection, required_source_slugs, playbook)
where s.slug = 'apelacion'
on conflict (service_id, slug) do nothing;

-- ── E) The document types those postures point at ────────────────────────────
-- A gate that names a document with nowhere to upload it is not actionable, and
-- neither slug existed: the Appeal service only had passport / asylum package /
-- decision / supporting evidence. Both are created as is_required = FALSE — a
-- merits denial does not need them — and the POSTURE makes them mandatory for the
-- cases that do. That is the conditional-requirement mechanism, kept as data.

insert into public.required_document_types
  (service_phase_id, slug, label_i18n, help_i18n, is_required, ai_extract, extraction_schema, position, allow_multiple)
select
  sp.id,
  v.slug,
  v.label_i18n,
  v.help_i18n,
  false,
  true,
  v.extraction_schema,
  v.position,
  false
from public.services s
join public.service_phases sp on sp.service_id = s.id
cross join (values
  (
    'mocion-pretermision-dhs',
    '{"es":"Moción de pretermisión del DHS","en":"DHS Motion to Pretermit"}'::jsonb,
    '{"es":"El escrito con el que el gobierno pidió al juez rechazar el caso sin audiencia de fondo. Contiene los MOTIVOS reales que hay que refutar en la apelación. Si no lo tienes, pídeselo a tu abogado anterior o a la corte.","en":"The government brief asking the judge to reject the case without a merits hearing. It contains the actual grounds the appeal must rebut."}'::jsonb,
    '{"type":"object","properties":{"filing_date":{"type":"string","nullable":true,"description":"Date the motion was filed, YYYY-MM-DD. Null if not stated."},"legal_grounds":{"type":"array","items":{"type":"string"},"description":"Each distinct legal ground DHS argued, quoted or closely paraphrased, one per entry (e.g. proposed particular social group is not cognizable; no nexus to a protected ground; application is time-barred). Empty array if none can be identified."},"authorities_cited":{"type":"array","items":{"type":"string"},"description":"Case citations and statutory/regulatory provisions DHS relied on, verbatim (e.g. Matter of A-B-, 27 I&N Dec. 316; 8 C.F.R. 1208.13)."}}}'::jsonb,
    10
  ),
  (
    'transcript-audiencia',
    '{"es":"Transcripción de la audiencia","en":"Hearing transcript"}'::jsonb,
    '{"es":"La transcripción oficial de lo que se dijo en la audiencia. Se solicita a la corte de inmigración. Es la única fuente de lo que el juez dijo de viva voz cuando la decisión fue oral.","en":"The official transcript of the hearing. Requested from the immigration court; the only source of what the judge said when the decision was oral."}'::jsonb,
    '{"type":"object","properties":{"hearing_date":{"type":"string","nullable":true,"description":"Date of the hearing, YYYY-MM-DD. Null if not stated."},"judge_statements":{"type":"array","items":{"type":"string"},"description":"Verbatim statements by the Immigration Judge giving reasons, rulings or findings. Quote exactly; do not paraphrase or summarize."},"rulings_on_evidence":{"type":"array","items":{"type":"string"},"description":"Each ruling admitting, excluding or discounting evidence, quoted verbatim with the exhibit letter when stated."}}}'::jsonb,
    11
  )
) as v(slug, label_i18n, help_i18n, extraction_schema, position)
where s.slug = 'apelacion'
on conflict (service_phase_id, slug) do nothing;
