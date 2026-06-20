/**
 * Fixes the I-589 Part A.III collapsed/mismapped textareas in the v2 DRAFT:
 * deletes the 4 wrong questions and creates correctly-split questions mapped to
 * the authoritative distinct AcroForm fields (from v1's curated i589 field-map),
 * with proper types (date for date boxes, text otherwise).
 * Usage: SBTOKEN=<token> node docs/_evidence/fix-a3-split.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const GID = "72bf4941-186d-480d-a36b-84329ac7acc5"; // Parte A.III group (v2 draft)
const SUB = "form1[0].#subform[4].";
const WRONG = [
  "727b68e1-9a67-4c99-908b-11cb71435904", // última dirección (collapsed)
  "3913d105-ce2a-4743-884d-55e27853dfea", // empleo (mismapped to residence_3_street)
  "b808f002-225b-4bc0-b929-bca4eb4e62e0", // educación (mismapped to residence_1_street)
  "2fb7c6c6-e803-4caa-bc81-da1f711bedeb", // direcciones (mismapped to mother_current_location)
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

// [es, en, field, type]
const NEW = [
  // Última dirección fuera de EE.UU. antes de llegar
  ["Última dirección fuera de EE.UU. — calle y número", "Last address outside the U.S. — street & number", "TextField13[0]", "text"],
  ["Última dirección fuera de EE.UU. — ciudad", "Last address outside the U.S. — city", "TextField13[2]", "text"],
  ["Última dirección fuera de EE.UU. — provincia/estado", "Last address outside the U.S. — province/state", "TextField13[4]", "text"],
  ["Última dirección fuera de EE.UU. — país", "Last address outside the U.S. — country", "TextField13[6]", "text"],
  ["Última dirección fuera de EE.UU. — desde (mes/año)", "Last address outside the U.S. — from (mo/yr)", "DateTimeField21[0]", "date"],
  ["Última dirección fuera de EE.UU. — hasta (mes/año)", "Last address outside the U.S. — to (mo/yr)", "DateTimeField20[0]", "date"],
  // Residencia más reciente de los últimos 5 años (fila 1)
  ["Residencia reciente (5 años) — calle y número", "Recent residence (5 yrs) — street & number", "TextField13[8]", "text"],
  ["Residencia reciente (5 años) — ciudad", "Recent residence (5 yrs) — city", "TextField13[10]", "text"],
  ["Residencia reciente (5 años) — provincia/estado", "Recent residence (5 yrs) — province/state", "TextField13[12]", "text"],
  ["Residencia reciente (5 años) — país", "Recent residence (5 yrs) — country", "TextField13[14]", "text"],
  ["Residencia reciente (5 años) — desde (mes/año)", "Recent residence (5 yrs) — from (mo/yr)", "DateTimeField22[0]", "date"],
  ["Residencia reciente (5 años) — hasta (mes/año)", "Recent residence (5 yrs) — to (mo/yr)", "DateTimeField23[0]", "date"],
  // Educación más reciente (fila 1)
  ["Educación reciente — nombre de la institución", "Recent education — name of school", "TextField13[24]", "text"],
  ["Educación reciente — tipo de escuela", "Recent education — type of school", "TextField13[25]", "text"],
  ["Educación reciente — ubicación (ciudad, país)", "Recent education — location (city, country)", "TextField13[26]", "text"],
  ["Educación reciente — desde (mes/año)", "Recent education — from (mo/yr)", "DateTimeField32[0]", "date"],
  ["Educación reciente — hasta (mes/año)", "Recent education — to (mo/yr)", "DateTimeField33[0]", "date"],
  // Empleo más reciente (fila 1) — el pedido explícito de Henry
  ["Empleo reciente — empleador (nombre y dirección)", "Recent employment — employer (name & address)", "TextField13[39]", "text"],
  ["Empleo reciente — su ocupación", "Recent employment — your occupation", "TextField13[40]", "text"],
  ["Empleo reciente — desde (mes/año)", "Recent employment — from (mo/yr)", "DateTimeField42[0]", "date"],
  ["Empleo reciente — hasta (mes/año)", "Recent employment — to (mo/yr)", "DateTimeField43[0]", "date"],
];

(async () => {
  await q(`delete from form_questions where id in (${WRONG.map((id) => `'${id}'`).join(",")});`);
  const values = NEW.map(([es, en, field, type], i) => {
    const label = JSON.stringify({ es, en });
    return `('${GID}', $L$${label}$L$, '${type}', '${SUB}${field}', 'client_answer', false, ${100 + i})`;
  }).join(",\n");
  await q(
    "insert into form_questions (group_id, question_i18n, field_type, pdf_field_name, source, is_required, position) values\n" + values + ";",
  );
  const out = await q(
    `select count(*) total, count(*) filter (where field_type='date') dates from form_questions where group_id='${GID}';`,
  );
  console.log("A.III now:", JSON.stringify(out));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
