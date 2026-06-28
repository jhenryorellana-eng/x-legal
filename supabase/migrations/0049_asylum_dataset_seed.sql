-- 0049_asylum_dataset_seed.sql
--
-- Enriches the "Precedentes de asilo" dataset with REAL, public legal authorities
-- (BIA + Circuit precedent) and NGO model-declaration structures, tagged with the
-- denial-reason / protected-ground taxonomy. Content = our own summaries of public
-- holdings (public domain); never the applicant's facts. Idempotent by (dataset, title).
-- token_count is required (loadDatasetItems filters out NULLs) — estimated as len/4.

insert into public.ai_dataset_items (dataset_id, title, jurisdiction, outcome, content, tags, token_count)
select d.id, v.title, v.jurisdiction, v.outcome, v.content, v.tags, ceil(length(v.content) / 4.0)::int
from public.ai_datasets d
join (values
  ('INS v. Cardoza-Fonseca, 480 U.S. 421 (1987)', 'SCOTUS', 'granted',
   'The Supreme Court held that the "well-founded fear" standard for asylum under INA 208 is more generous than the "clear probability" standard for withholding: an applicant need only show a reasonable possibility of persecution (as little as a roughly one-in-ten chance). Use in the governing-legal-standards section to establish the lower asylum burden and to distinguish asylum from withholding.',
   array['asylum','well_founded_fear','WFF_OBJECTIVE','standard']),
  ('Matter of Mogharrabi, 19 I&N Dec. 439 (BIA 1987)', 'BIA', 'granted',
   'Established the four-part well-founded-fear test: the applicant possesses a belief or characteristic the persecutor seeks to overcome; the persecutor is aware, or could become aware, that the applicant holds it; the persecutor has the capability to punish; and the inclination to do so. Apply each prong to the client''s specific facts in the well-founded-fear analysis.',
   array['well_founded_fear','nexus','political_opinion']),
  ('Matter of M-E-V-G-, 26 I&N Dec. 227 (BIA 2014)', 'BIA', 'remanded',
   'A particular social group must be composed of members who share a common immutable characteristic, be defined with particularity, and be socially distinct within the society in question. Articulate the proposed PSG precisely and prove each of the three elements separately in the protected-ground section.',
   array['psg','particularity','social_distinction','IMPUTED_WEAK']),
  ('Matter of Kasinga, 21 I&N Dec. 357 (BIA 1996)', 'BIA', 'granted',
   'Recognized a well-founded fear of female genital cutting as persecution on account of membership in a particular social group. Useful authority that serious bodily or cultural harm tied to an immutable trait constitutes persecution and can rest on a forward-looking fear.',
   array['psg','gender_violence','NOT_PERSECUTION']),
  ('Navas v. INS, 217 F.3d 646 (9th Cir. 2000)', '9th Cir.', 'granted',
   'The Ninth Circuit held that persecution directed at a family member can establish imputed political opinion, and that credible threats coupled with violence by state-linked actors compel a finding of past persecution. Use to argue imputed political opinion and family-based nexus, and to rebut a "personal dispute" framing.',
   array['imputed_political_opinion','political_opinion','nexus','STATE_ACTION']),
  ('Sangha v. INS, 103 F.3d 1482 (9th Cir. 1997)', '9th Cir.', 'denied',
   'Clarified that the applicant must show the persecutor was motivated, at least in part, by the applicant''s actual or imputed political opinion, not merely by a desire to recruit or by generalized civil strife. Use to frame the one-central-reason nexus and to distinguish the claim from generalized violence.',
   array['political_opinion','nexus','NEXUS_FAIL']),
  ('Bringas-Rodriguez v. Sessions, 850 F.3d 1051 (9th Cir. 2017) (en banc)', '9th Cir.', 'remanded',
   'En banc, the court held that an applicant need not report abuse to authorities where reporting would be futile or dangerous, and that country-conditions evidence can establish the government''s unwillingness or inability to protect. Use in the government-protection and corroboration sections.',
   array['STATE_ACTION','CORROBORATION','state_action']),
  ('Cece v. Holder, 733 F.3d 662 (7th Cir. 2013) (en banc)', '7th Cir.', 'remanded',
   'Held that a particular social group of young women targeted for trafficking was cognizable, and that a group is not impermissibly circular merely because the shared harm is the persecution feared. Use to defend a PSG definition against a circularity objection.',
   array['psg','particularity']),
  ('Matter of S-P-, 21 I&N Dec. 486 (BIA 1996)', 'BIA', 'granted',
   'In mixed-motive cases the applicant must produce evidence from which it is reasonable to conclude that the harm was motivated, in part, by an actual or imputed protected ground. Use to argue nexus where the persecutor also had non-protected motives such as extortion.',
   array['mixed_motive','nexus','political_opinion','NEXUS_FAIL']),
  ('Matter of Pula, 19 I&N Dec. 467 (BIA 1987)', 'BIA', 'granted',
   'Set out the factors governing the favorable exercise of discretion for asylum, rejecting a rigid focus on manner of entry. Use in the prayer-for-relief and discretion discussion to show the equities favor a grant.',
   array['discretion','ONE_YEAR_BAR']),
  ('Human Rights First - Sample Declaration and Templates', 'NGO model', 'model',
   'Model declaration structure used by practitioners: (1) introduction and identity; (2) family and personal background; (3) a chronological account of each persecutory incident with dates, actors and impact; (4) an explicit nexus to the protected ground; (5) why the applicant fears return; and (6) the penalty-of-perjury attestation. Mirror this structure and tone; never copy facts.',
   array['declaration_structure','political_opinion','model_letter']),
  ('CLINIC Asylum Toolkit - Declarations, Briefs and Exhibits', 'NGO model', 'model',
   'Practitioner toolkit: organize the declaration chronologically; corroborate each material fact with a specific exhibit; include a country-conditions section citing the U.S. State Department report and reputable NGO reporting; and attach a cover letter with a numbered exhibit index. Follow this exhibit-by-exhibit corroboration approach.',
   array['declaration_structure','exhibits','country_conditions','model_letter']),
  ('Immigration Equality - Annotated Sample Declaration', 'NGO model', 'model',
   'Annotated guidance: write in the applicant''s first-person voice; include sensory and emotional detail to support credibility under the REAL ID Act; keep all dates consistent with the I-589; and explain any gaps or missing corroboration rather than omitting them. Use to strengthen credibility, detail and internal consistency.',
   array['declaration_structure','CREDIBILITY','model_letter'])
) as v(title, jurisdiction, outcome, content, tags) on true
where d.name = 'Precedentes de asilo'
  and not exists (select 1 from public.ai_dataset_items i where i.dataset_id = d.id and i.title = v.title);
