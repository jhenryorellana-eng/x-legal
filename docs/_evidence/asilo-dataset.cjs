/**
 * Creates the "Precedentes de asilo" dataset (public won-case references) + items,
 * and links it to the memorandum ai_letter config. Public law only, no client PII.
 * Usage: SBTOKEN=<token> node docs/_evidence/asilo-dataset.cjs <memo_form_definition_id>
 */
const PROJ = "uexxyokexcamyjcknxua";
const FORM_ID = process.argv[2];
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return JSON.parse(t);
};

const arcg =
  "Matter of A-R-C-G-, 26 I&N Dec. 388 (BIA 2014): the Board recognized 'married women in Guatemala who are unable to leave their relationship' as a cognizable particular social group, where persecution is inflicted by a non-state actor and the government is unable or unwilling to protect. The decision applied the immutability, particularity and social-distinction requirements and emphasized country-conditions evidence of impunity for domestic violence.";
const acosta =
  "Matter of Acosta, 19 I&N Dec. 211 (BIA 1985): a particular social group is defined by a common immutable characteristic that members either cannot change, or should not be required to change because it is fundamental to their individual identity or conscience. Foundational standard for PSG analysis in asylum law.";

(async () => {
  const org = (await q("select id from public.orgs limit 1;"))[0].id;
  const ds = (await q(
    "insert into public.ai_datasets (org_id, name, purpose, source_kind, is_active) values " +
      `('${org}', 'Precedentes de asilo', $p$Casos públicos de asilo ganados — guía de estilo, estructura y fuentes$p$, 'court_public', true) returning id;`,
  ))[0].id;
  await q(
    "insert into public.ai_dataset_items (dataset_id, title, content, jurisdiction, outcome, tags, token_count) values " +
      `('${ds}', 'Matter of A-R-C-G- (BIA 2014)', $a$${arcg}$a$, 'BIA', 'granted', array['asilo','psg','gender_violence'], 90),` +
      `('${ds}', 'Matter of Acosta (BIA 1985)', $b$${acosta}$b$, 'BIA', 'granted', array['asilo','psg'], 60);`,
  );
  await q(`update public.ai_generation_configs set dataset_id='${ds}' where form_definition_id='${FORM_ID}';`);
  const v = await q(
    `select d.name, count(i.id) items, (select dataset_id from public.ai_generation_configs where form_definition_id='${FORM_ID}') linked ` +
      `from public.ai_datasets d left join public.ai_dataset_items i on i.dataset_id=d.id where d.id='${ds}' group by d.name;`,
  );
  console.log("OK", JSON.stringify(v));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
