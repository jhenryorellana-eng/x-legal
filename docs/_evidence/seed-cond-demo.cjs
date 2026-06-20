/**
 * Seeds a Sí/No → conditional-explanation pair into the I-589 Parte A draft
 * version (live verification of the conditional-fields read path).
 * Usage: SBTOKEN=<token> node docs/_evidence/seed-cond-demo.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const FORM = "e7f12a89-d1dd-4478-84f3-17afff5a0b8d";
const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`HTTP ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
};

(async () => {
  const vid = (await q(
    `select id from form_automation_versions where form_definition_id='${FORM}' order by version desc limit 1;`,
  ))[0].id;
  const gid = (await q(
    `select id from form_question_groups where automation_version_id='${vid}' order by position limit 1;`,
  ))[0].id;
  await q(`delete from form_questions where group_id='${gid}';`);

  const q1Label = JSON.stringify({ es: "¿Tienes hijos?", en: "Do you have children?" });
  const q1Opts = JSON.stringify([
    { value: "si", label_i18n: { es: "Sí", en: "Yes" } },
    { value: "no", label_i18n: { es: "No", en: "No" } },
  ]);
  const q1 = (await q(
    `insert into form_questions (group_id, question_i18n, field_type, options, source, is_required, position)` +
      ` values ('${gid}', $j$${q1Label}$j$, 'select', $o$${q1Opts}$o$, 'client_answer', true, 0) returning id;`,
  ))[0].id;

  const q2Label = JSON.stringify({ es: "Cuéntanos sobre tus hijos", en: "Tell us about your children" });
  const q2Help = JSON.stringify({ es: "Solo aparece si respondiste Sí.", en: "Only shown if you answered Yes." });
  const cond = JSON.stringify({ when: { question: q1, op: "equals", value: "si" }, action: "show" });
  await q(
    `insert into form_questions (group_id, question_i18n, help_i18n, field_type, source, is_required, position, condition)` +
      ` values ('${gid}', $j$${q2Label}$j$, $h$${q2Help}$h$, 'textarea', 'client_answer', true, 1, $c$${cond}$c$);`,
  );

  const out = await q(
    `select position, field_type, condition from form_questions where group_id='${gid}' order by position;`,
  );
  console.log("SEEDED q1=", q1, "\n", JSON.stringify(out, null, 2));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
