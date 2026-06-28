-- 0052_dataset_country_seed.sql
-- Country-conditions fallback corpus (real, verified-reachable sources) for the
-- curated dataset, so the memorandum's Exhibit B is never empty when the web_search
-- country pass is slow/unavailable (its latency is highly variable). These are the
-- Venezuela sources verified during the F4 demo (HRW, State Dept, Amnesty, Freedom
-- House, Foro Penal). Tagged meta.kind=country so they feed ONLY datasetToCountry
-- (the annex fallback), never the few-shot XML or the jurisprudence exhibits.
-- Idempotent by (dataset_id, title). More nationalities can be added from /admin/datasets.

insert into public.ai_dataset_items (dataset_id, title, jurisdiction, outcome, content, tags, token_count, meta)
select d.id, v.title, v.author, 'country', v.content, v.tags, ceil(length(v.content) / 4.0)::int, v.meta
from (select id from public.ai_datasets where name ilike '%precedent%' order by created_at limit 1) d
cross join (values
  (
    'Human Rights Watch - World Report 2024: Venezuela',
    'Human Rights Watch',
    'Human Rights Watch''s World Report 2024 chapter on Venezuela finds that the government of Nicolas Maduro continues to detain, prosecute and abuse real and perceived opponents. Intelligence services (SEBIN and DGCIM) carry out arbitrary detentions, hold detainees incommunicado, and subject them to torture and cruel treatment. Pro-government armed groups (colectivos) operate with state acquiescence to intimidate and attack protesters and opposition organizers. The justice system lacks independence and impunity for security-force abuses is the norm.',
    array['venezuela','country_conditions','political_opinion'],
    jsonb_build_object('kind','country','court','Human Rights Watch','year','2024-01-11','url','https://www.hrw.org/world-report/2024/country-chapters/venezuela')
  ),
  (
    'U.S. Department of State - 2023 Country Report on Human Rights Practices: Venezuela',
    'U.S. Department of State',
    'The State Department''s 2023 human rights report on Venezuela documents unlawful or arbitrary killings by security forces, enforced disappearance, torture and cruel treatment by government agents, harsh and life-threatening prison conditions, arbitrary arrest and detention of regime critics, political prisoners, and serious restrictions on free expression and peaceful assembly. The report attributes these abuses to security and intelligence bodies controlled by the Maduro government and finds that authorities rarely investigate or punish officials who commit abuses.',
    array['venezuela','country_conditions','political_opinion'],
    jsonb_build_object('kind','country','court','U.S. Department of State','year','2024-04-22','url','https://www.state.gov/reports/2023-country-reports-on-human-rights-practices/venezuela/')
  ),
  (
    'Amnesty International - Venezuela',
    'Amnesty International',
    'Amnesty International documents that Venezuelan authorities have intensified a policy of repression designed to silence dissent, including the arbitrary detention and criminal prosecution of human rights defenders, journalists, union leaders and political opponents. Amnesty describes short-term enforced disappearances, fabricated criminal charges, and judicial harassment used to punish and deter opposition activity, and concludes that these acts form part of a widespread and systematic attack on the civilian population.',
    array['venezuela','country_conditions','political_opinion'],
    jsonb_build_object('kind','country','court','Amnesty International','year','2024-03-01','url','https://www.amnesty.org/en/location/americas/south-america/venezuela/report-venezuela/')
  ),
  (
    'Freedom House - Freedom in the World 2024: Venezuela',
    'Freedom House',
    'Freedom House''s Freedom in the World 2024 assessment designates Venezuela as Not Free, citing the Maduro government''s consolidation of authoritarian rule: dismantled democratic institutions, a judiciary subordinated to the executive, jailed and disqualified opposition leaders, and security forces and colectivos used to suppress protest. Venezuelans who oppose the government face surveillance, harassment, arbitrary detention and violence, with no effective domestic remedy.',
    array['venezuela','country_conditions','political_opinion'],
    jsonb_build_object('kind','country','court','Freedom House','year','2024-02-29','url','https://freedomhouse.org/country/venezuela/freedom-world/2024')
  ),
  (
    'Foro Penal - Reporte sobre presos politicos en Venezuela',
    'Foro Penal (Venezuelan NGO)',
    'Foro Penal, a Venezuelan non-governmental organization, maintains the most cited national registry of political detentions in Venezuela. Its reporting documents that since 2014 the state has carried out tens of thousands of arbitrary detentions for political reasons, that hundreds of recognized political prisoners remain in custody at any given time, and that opposition organizers and protesters are among the most frequently targeted, including through military and intelligence courts, incommunicado detention, and torture.',
    array['venezuela','country_conditions','political_opinion'],
    jsonb_build_object('kind','country','court','Foro Penal','year','2024-01-20','url','https://foropenal.com/')
  )
) as v(title, author, content, tags, meta)
where not exists (
  select 1 from public.ai_dataset_items x where x.dataset_id = d.id and x.title = v.title
);
