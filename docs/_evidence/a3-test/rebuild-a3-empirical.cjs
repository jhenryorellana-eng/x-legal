/**
 * REBUILDS the I-589 Part A.III group (v2 draft) from the EMPIRICALLY-VERIFIED
 * page-4 field map (docs/_evidence/a3-test/discover-widgets.txt + discover-text.png),
 * replacing the prior questions whose indices were copied from v1's *estimated*
 * field-map (which had collisions: education_1 vs residence_5, employment off-by-one,
 * mother/father names pointing at sibling cells).
 *
 * Adds full coverage: section 1 (2 rows), residences (5), education (4), employment (3),
 * and parents+siblings (name / city-country of birth / DECEASED checkbox / current
 * location). Overflow rows are conditional ("show if count >= N", mirroring "Hijo N").
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/rebuild-a3-empirical.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const GID = "72bf4941-186d-480d-a36b-84329ac7acc5";
const SUB = "form1[0].#subform[4].";
const F = (leaf) => SUB + leaf;
const YESNO = [
  { value: "si", label_i18n: { en: "Yes", es: "Sí" } },
  { value: "no", label_i18n: { en: "No", es: "No" } },
];

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

// ---- ordered question list (gates + fields) ----
// helpers: t/d/n/sel/cb question builders
let pos = 0;
const Q = [];
const add = (o) => { Q.push({ position: ++pos, required: false, type: "text", pdf: null, options: null, validation: null, cond: null, ...o }); };
const T = (es, en, leaf, req, cond) => add({ es, en, type: "text", pdf: F(leaf), required: !!req, cond });
const D = (es, en, leaf, req, cond) => add({ es, en, type: "date", pdf: F(leaf), required: !!req, cond });
const CB = (es, en, leaf, cond) => add({ es, en, type: "checkbox", pdf: F(leaf), required: false, cond });
const NUM = (k, es, en, min, max) => add({ gate: k, es, en, type: "number", validation: { min, max }, required: true });
const SEL = (k, es, en) => add({ gate: k, es, en, type: "select", options: YESNO, required: true });
const C = (gate, op, value) => ({ gate, op, value }); // condition ref (resolved to id later)

// SECTION 1 — last address outside the U.S. (row 1, required)
T("Última dirección fuera de EE.UU. — número y calle", "Last address outside the U.S. — number and street", "TextField13[0]", true);
T("Última dirección fuera de EE.UU. — ciudad", "Last address outside the U.S. — city/town", "TextField13[2]", true);
T("Última dirección fuera de EE.UU. — departamento/provincia/estado", "Last address outside the U.S. — department/province/state", "TextField13[4]", true);
T("Última dirección fuera de EE.UU. — país", "Last address outside the U.S. — country", "TextField13[6]", true);
D("Última dirección fuera de EE.UU. — desde (mes/año)", "Last address outside the U.S. — from (mo/yr)", "DateTimeField21[0]", true);
D("Última dirección fuera de EE.UU. — hasta (mes/año)", "Last address outside the U.S. — to (mo/yr)", "DateTimeField20[0]", true);
// gate: alternate address in country of persecution (if different)
SEL("sec1_alt", "¿Su última dirección antes de EE.UU. está en un país distinto al de la persecución?", "Is your last address before the U.S. in a different country than the one where you fear persecution?");
// SECTION 1 — row 2 (alternate, conditional)
T("Última dirección en el país de persecución — número y calle", "Last address in the country of persecution — number and street", "TextField13[1]", false, C("sec1_alt", "equals", "si"));
T("Última dirección en el país de persecución — ciudad", "Last address in the country of persecution — city/town", "TextField13[3]", false, C("sec1_alt", "equals", "si"));
T("Última dirección en el país de persecución — departamento/provincia/estado", "Last address in the country of persecution — department/province/state", "TextField13[5]", false, C("sec1_alt", "equals", "si"));
T("Última dirección en el país de persecución — país", "Last address in the country of persecution — country", "TextField13[7]", false, C("sec1_alt", "equals", "si"));
D("Última dirección en el país de persecución — desde (mes/año)", "Last address in the country of persecution — from (mo/yr)", "DateTimeField22[0]", false, C("sec1_alt", "equals", "si"));
D("Última dirección en el país de persecución — hasta (mes/año)", "Last address in the country of persecution — to (mo/yr)", "DateTimeField23[0]", false, C("sec1_alt", "equals", "si"));

// SECTION 2 — residences last 5 years (5 rows), count-gated
NUM("res_n", "¿En cuántas direcciones vivió durante los últimos 5 años?", "In how many residences did you live during the last 5 years?", 1, 20);
const RES = [
  ["TextField13[8]", "TextField13[10]", "TextField13[12]", "TextField13[14]", "DateTimeField24[0]", "DateTimeField26[0]"],
  ["TextField13[9]", "TextField13[11]", "TextField13[13]", "TextField13[15]", "DateTimeField25[0]", "DateTimeField27[0]"],
  ["TextField13[16]", "TextField13[17]", "TextField13[18]", "TextField13[19]", "DateTimeField28[0]", "DateTimeField29[0]"],
  ["TextField13[20]", "TextField13[21]", "TextField13[22]", "TextField13[23]", "DateTimeField30[0]", "DateTimeField31[0]"],
  ["TextField13[24]", "TextField13[25]", "TextField13[26]", "TextField13[27]", "DateTimeField32[0]", "DateTimeField33[0]"],
];
RES.forEach((r, i) => {
  const n = i + 1, cond = C("res_n", "gte", n), req = n === 1;
  T(`Residencia ${n} (últimos 5 años) — número y calle`, `Residence ${n} (last 5 yrs) — number and street`, r[0], req, cond);
  T(`Residencia ${n} — ciudad`, `Residence ${n} — city/town`, r[1], false, cond);
  T(`Residencia ${n} — departamento/provincia/estado`, `Residence ${n} — department/province/state`, r[2], false, cond);
  T(`Residencia ${n} — país`, `Residence ${n} — country`, r[3], false, cond);
  D(`Residencia ${n} — desde (mes/año)`, `Residence ${n} — from (mo/yr)`, r[4], false, cond);
  D(`Residencia ${n} — hasta (mes/año)`, `Residence ${n} — to (mo/yr)`, r[5], false, cond);
});

// SECTION 3 — education last 5 years (4 rows), count-gated
NUM("edu_n", "¿En cuántas escuelas estudió en los últimos 5 años? (0 si ninguna)", "In how many schools did you study in the last 5 years? (0 if none)", 0, 20);
const EDU = [
  ["TextField13[28]", "TextField13[30]", "TextField13[32]", "DateTimeField41[0]", "DateTimeField40[0]"],
  ["TextField13[29]", "TextField13[31]", "TextField13[33]", "DateTimeField38[0]", "DateTimeField39[0]"],
  ["TextField13[34]", "TextField13[35]", "TextField13[36]", "DateTimeField37[0]", "DateTimeField36[0]"],
  ["TextField13[37]", "TextField13[38]", "TextField13[39]", "DateTimeField34[0]", "DateTimeField35[0]"],
];
EDU.forEach((r, i) => {
  const n = i + 1, cond = C("edu_n", "gte", n);
  T(`Educación ${n} — nombre de la institución`, `Education ${n} — name of school`, r[0], false, cond);
  T(`Educación ${n} — tipo de escuela`, `Education ${n} — type of school`, r[1], false, cond);
  T(`Educación ${n} — ubicación (ciudad, país)`, `Education ${n} — location (city, country)`, r[2], false, cond);
  D(`Educación ${n} — desde (mes/año)`, `Education ${n} — from (mo/yr)`, r[3], false, cond);
  D(`Educación ${n} — hasta (mes/año)`, `Education ${n} — to (mo/yr)`, r[4], false, cond);
});

// SECTION 4 — employment last 5 years (3 rows), count-gated
NUM("emp_n", "¿Cuántos empleos tuvo en los últimos 5 años? (0 si ninguno)", "How many jobs did you have in the last 5 years? (0 if none)", 0, 20);
const EMP = [
  ["TextField13[40]", "TextField13[42]", "DateTimeField42[0]", "DateTimeField44[0]"],
  ["TextField13[41]", "TextField13[43]", "DateTimeField43[0]", "DateTimeField45[0]"],
  ["TextField13[44]", "TextField13[45]", "DateTimeField46[0]", "DateTimeField47[0]"],
];
EMP.forEach((r, i) => {
  const n = i + 1, cond = C("emp_n", "gte", n);
  T(`Empleo ${n} — empleador (nombre y dirección)`, `Employment ${n} — employer (name and address)`, r[0], false, cond);
  T(`Empleo ${n} — su ocupación`, `Employment ${n} — your occupation`, r[1], false, cond);
  D(`Empleo ${n} — desde (mes/año)`, `Employment ${n} — from (mo/yr)`, r[2], false, cond);
  D(`Empleo ${n} — hasta (mes/año)`, `Employment ${n} — to (mo/yr)`, r[3], false, cond);
});

// SECTION 5 — parents + siblings (name / city-country of birth / DECEASED / current location)
T("Madre — nombre completo", "Mother — full name", "TextField13[46]", true);
T("Madre — ciudad y país de nacimiento", "Mother — city and country of birth", "TextField13[49]", false);
CB("¿Su madre ha fallecido?", "Is your mother deceased?", "CheckBoxAIII5\\.m[0]");
T("Madre — ubicación actual (ciudad, país)", "Mother — current location (city, country)", "TextField35[0]", false);
T("Padre — nombre completo", "Father — full name", "TextField13[47]", true);
T("Padre — ciudad y país de nacimiento", "Father — city and country of birth", "TextField13[50]", false);
CB("¿Su padre ha fallecido?", "Is your father deceased?", "CheckBoxAIII5\\.f[0]");
T("Padre — ubicación actual (ciudad, país)", "Father — current location (city, country)", "TextField35[1]", false);
// siblings, count-gated
NUM("sib_n", "¿Cuántos hermanos o hermanas tiene? (0 si ninguno)", "How many brothers or sisters do you have? (0 if none)", 0, 20);
const SIB = [
  ["TextField13[48]", "TextField13[51]", "CheckBoxAIII5\\.s1[0]", "TextField35[2]"],
  ["TextField13[52]", "TextField13[53]", "CheckBoxAIII5\\.s2[0]", "TextField35[3]"],
  ["TextField13[54]", "TextField13[55]", "CheckBoxAIII5\\.s3[0]", "TextField35[4]"],
  ["TextField13[56]", "TextField13[57]", "CheckBoxAIII5\\.s4[0]", "TextField35[5]"],
];
SIB.forEach((r, i) => {
  const n = i + 1, cond = C("sib_n", "gte", n);
  T(`Hermano/a ${n} — nombre completo`, `Sibling ${n} — full name`, r[0], false, cond);
  T(`Hermano/a ${n} — ciudad y país de nacimiento`, `Sibling ${n} — city and country of birth`, r[1], false, cond);
  CB(`¿El hermano/a ${n} ha fallecido?`, `Is sibling ${n} deceased?`, r[2], cond);
  T(`Hermano/a ${n} — ubicación actual (ciudad, país)`, `Sibling ${n} — current location (city, country)`, r[3], false, cond);
});

// ---- emit SQL ----
const jq = (obj) => `$J$${JSON.stringify(obj)}$J$::jsonb`;
const sqlVal = (s) => `'${String(s).replace(/'/g, "''")}'`;

(async () => {
  // 1) wipe existing A.III questions
  await q(`delete from form_questions where group_id='${GID}';`);

  // 2) insert gates first, capture ids by their es label
  const gates = Q.filter((x) => x.gate);
  const gateValues = gates.map((g) =>
    `('${GID}', ${jq({ es: g.es, en: g.en })}, '${g.type}', ${g.options ? jq(g.options) : "null"}, null, 'client_answer', ${g.required}, ${g.position}, ${g.validation ? jq(g.validation) : "null"}, null)`,
  );
  const gRows = await q(
    `insert into form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, is_required, position, validation, condition) values\n${gateValues.join(",\n")}\nreturning id, question_i18n->>'es' es;`,
  );
  const gateKeyToId = {};
  for (const g of gates) {
    const row = gRows.find((r) => r.es === g.es);
    if (!row) throw new Error("gate id not found: " + g.es);
    gateKeyToId[g.gate] = row.id;
  }

  // 3) insert field questions with conditions resolved to gate ids
  const fields = Q.filter((x) => !x.gate);
  const fieldValues = fields.map((f) => {
    let condJson = "null";
    if (f.cond) {
      const gid = gateKeyToId[f.cond.gate];
      if (!gid) throw new Error("unresolved cond gate: " + f.cond.gate);
      condJson = jq({ when: { question: gid, op: f.cond.op, value: f.cond.value }, action: "show" });
    }
    return `('${GID}', ${jq({ es: f.es, en: f.en })}, '${f.type}', ${f.options ? jq(f.options) : "null"}, ${f.pdf ? sqlVal(f.pdf) : "null"}, 'client_answer', ${f.required}, ${f.position}, ${f.validation ? jq(f.validation) : "null"}, ${condJson})`;
  });
  await q(
    `insert into form_questions (group_id, question_i18n, field_type, options, pdf_field_name, source, is_required, position, validation, condition) values\n${fieldValues.join(",\n")};`,
  );

  // 4) audit
  const out = await q(`
    select count(*) total,
           count(*) filter (where field_type='date') dates,
           count(*) filter (where field_type='checkbox') checkboxes,
           count(*) filter (where field_type='number') counts,
           count(*) filter (where condition is not null) conditional,
           count(*) filter (where pdf_field_name is null) gates_nopdf,
           count(*) filter (where is_required) required
    from form_questions where group_id='${GID}';`);
  console.log("A.III rebuilt:", JSON.stringify(out[0]));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
