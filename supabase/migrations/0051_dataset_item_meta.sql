-- 0051_dataset_item_meta.sql
-- Robust research: source the memorandum's JURISPRUDENCE exhibits from the curated
-- dataset (reliable + auditable) instead of the flaky open-ended web_search for case
-- law (web_search works fine for country-conditions, but searching for "6-10 published
-- federal precedents" hangs or returns nothing). The dataset already holds real
-- precedents (citation in title, court in jurisdiction, holding in content, denial-
-- reason taxonomy in tags); this adds a `meta` jsonb so each precedent can carry a
-- verified public URL (and a `kind` so the engine knows which items are annexable
-- precedents vs NGO model declarations vs country sources). Idempotent.

alter table public.ai_dataset_items
  add column if not exists meta jsonb not null default '{}'::jsonb;

comment on column public.ai_dataset_items.meta is
  'Structured annex metadata: { kind: precedent|country|model, citation, court, year, url, holding }. Drives the dataset-sourced jurisprudence exhibits when web_search case-law is unavailable.';

-- Default kind from the existing shape (NGO models have outcome=''model'').
update public.ai_dataset_items
set meta = meta || jsonb_build_object('kind', case when outcome = 'model' then 'model' else 'precedent' end)
where not (meta ? 'kind');

-- Verified public URLs (reachable 200/202, confirmed) for the landmark precedents.
-- Others stay citation-only (the citation is the authority for a court filing; the
-- engine renders "Citation verified; public copy on file." and re-checks any URL at
-- runtime). More URLs can be added from the /admin/datasets editor.
update public.ai_dataset_items set meta = meta || jsonb_build_object('url', 'https://www.law.cornell.edu/supremecourt/text/480/421')
  where title ilike 'INS v. Cardoza-Fonseca%';
update public.ai_dataset_items set meta = meta || jsonb_build_object('url', 'https://www.courtlistener.com/opinion/767252/jose-rodas-navas-v-immigration-and-naturalization-service/')
  where title ilike 'Navas v. INS%';
update public.ai_dataset_items set meta = meta || jsonb_build_object('url', 'https://www.law.cornell.edu/supremecourt/text/502/478')
  where title ilike '%Elias-Zacarias%';
