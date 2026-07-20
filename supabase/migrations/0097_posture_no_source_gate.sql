-- 0097 — Correct 0096: a posture shapes QUESTIONS, it does not gate documents.
--
-- WHY. 0096 modelled procedural posture as also declaring the documents a case
-- needs (required_source_slugs), and seeded the Appeal "pretermision" posture to
-- require both a DHS Motion to Pretermit and a hearing TRANSCRIPT — enforced as a
-- hard gate on form approval. In review with the practice owner two facts broke
-- that model:
--   1. The hearing transcript does NOT exist at this stage — in a BIA appeal the
--      court produces it AFTER the Notice of Appeal (EOIR-26) is filed, not before.
--   2. Gating the whole case on documents that may be unobtainable froze a case
--      with a filing deadline. Documents are ordinary catalog requirements; the
--      posture's ONLY job is to shape the questionnaire (drop merits questions a
--      pretermission never produced).
--
-- So: drop the transcript, stop the posture from requiring documents, and make the
-- DHS Motion to Pretermit a normal REQUIRED document of the Appeal service (it
-- genuinely holds the grounds the appeal must rebut — it is simply requested like
-- any other document, not enforced by posture logic).
--
-- Idempotent: safe on a fresh DB (which just applied 0096) and on production
-- (already reconciled by hand in the 2026-07-19 session).

-- 1) The transcript requirement was a mistake — remove it (0 uploads by design).
delete from public.case_requirement_overrides o
using public.required_document_types rdt
where o.required_document_type_id = rdt.id
  and rdt.slug = 'transcript-audiencia';

delete from public.required_document_types rdt
using public.service_phases sp, public.services s
where rdt.service_phase_id = sp.id and sp.service_id = s.id
  and s.slug = 'apelacion' and rdt.slug = 'transcript-audiencia';

-- 2) A posture no longer requires documents — it only shapes questions.
update public.service_postures sp
set required_source_slugs = '{}'
from public.services s
where sp.service_id = s.id and s.slug = 'apelacion'
  and coalesce(array_length(sp.required_source_slugs, 1), 0) > 0;

-- 3) The DHS Motion to Pretermit becomes a normal REQUIRED document of the service.
--    0096 created it (is_required=false, driven by posture); promote it and make
--    sure its label/help/schema are the production values. Insert if a fresh DB
--    somehow lacks it.
insert into public.required_document_types
  (service_phase_id, slug, label_i18n, help_i18n, is_required, ai_extract, extraction_schema, position, allow_multiple)
select sp.id, 'mocion-pretermision-dhs',
  '{"es":"Moción de Pretermisión de DHS","en":"DHS Motion to Pretermit"}'::jsonb,
  '{"es":"El escrito con el que el gobierno (DHS) pidió al juez rechazar el caso sin llegar al fondo. Contiene los motivos que la apelación debe refutar. Se solicita al abogado anterior o a la corte de inmigración.","en":"The government (DHS) brief asking the judge to reject the case without reaching the merits. Contains the grounds the appeal must rebut."}'::jsonb,
  true, true,
  '{"type":"object","properties":{"filing_date":{"type":"string","nullable":true,"description":"Date the motion was filed, YYYY-MM-DD. Null if not stated."},"legal_grounds":{"type":"array","items":{"type":"string"},"description":"Each distinct legal ground DHS argued to pretermit, quoted or closely paraphrased, one per entry (e.g. the one-year asylum filing deadline was missed; the proposed particular social group is not cognizable; no nexus to a protected ground). Empty array if none identifiable."},"authorities_cited":{"type":"array","items":{"type":"string"},"description":"Case citations and statutory/regulatory provisions DHS relied on, verbatim (e.g. Matter of A-B-, 27 I&N Dec. 316; 8 C.F.R. 1208.4)."}}}'::jsonb,
  (select coalesce(max(r2.position), 0) + 1
     from public.required_document_types r2
     join public.service_phases sp2 on sp2.id = r2.service_phase_id
     join public.services s2 on s2.id = sp2.service_id
     where s2.slug = 'apelacion'),
  false
from public.services s
join public.service_phases sp on sp.service_id = s.id
where s.slug = 'apelacion'
on conflict (service_phase_id, slug)
  do update set is_required = true, ai_extract = true,
    label_i18n = excluded.label_i18n, help_i18n = excluded.help_i18n,
    extraction_schema = excluded.extraction_schema;
