/**
 * Fixes the original propose's A.I / A.II field MISMAPS in v2 (verified empirically
 * via discover-text123 + text-p1/p2 renders): the answers were landing in the wrong
 * AcroForm boxes (e.g. DOB → an entry-history date box). Repoints each question to
 * its correct box.
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/fix-ai-aii.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const VER = "ee9f6692-aacf-4cf4-a7cb-716d9cf63c0a";
const S0 = "form1[0].#subform[0].";
const SN = "form1[0].#subform[1].NotMarried[0].";

// [oldFullName, newFullName, label]
const FIXES = [
  [S0 + "PtAILine9_InCareOf[0]", S0 + "PtAILine1_ANumber[0]", "A-Number (línea 1)"],
  [S0 + "DateTimeField6[0]", S0 + "DateTimeField1[0]", "Fecha de nacimiento (línea 12)"],
  [S0 + "TextField3[0]", S0 + "TextField1[4]", "País de nacimiento (línea 13)"],
  [S0 + "TextField4[0]", S0 + "TextField1[3]", "Nacionalidad (línea 14)"],
  [S0 + "TextField5[0]", S0 + "TextField1[6]", "Grupo racial (línea 16)"],
  [S0 + "TextField5[1]", S0 + "TextField1[7]", "Religión (línea 17)"],
  [SN + "DateTimeField8[0]", SN + "DateTimeField7[0]", "Fecha nac. cónyuge (línea 3)"],
];

const q = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + process.env.SBTOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (r.status >= 300) throw new Error(`SQL ${r.status}: ${t}`);
  return t ? JSON.parse(t) : [];
};
const esc = (s) => s.replace(/'/g, "''");

(async () => {
  for (const [oldN, newN, label] of FIXES) {
    const res = await q(`
      update form_questions q set pdf_field_name='${esc(newN)}'
      from form_question_groups g
      where q.group_id=g.id and g.automation_version_id='${VER}' and q.pdf_field_name='${esc(oldN)}'
      returning q.id;`);
    console.log((res.length ? "OK  " : "MISS ") + label + " (" + res.length + ")");
  }

  // "Spouse in the U.S.?" select currently points at line 22 (court proceedings);
  // the real "is in the U.S." is line 15's Yes/No checkbox pair (Yes=left=[1]).
  const SID = "2a767829-a006-4721-aadf-864d907e6ec1";
  const rows = await q(`select options from form_questions where id='${SID}';`);
  if (rows.length) {
    const opts = rows[0].options;
    for (const o of opts) {
      if (o.value === "si") o.pdf_field_name = SN + "PtAIILine15_CheckBox15[1]";
      if (o.value === "no") o.pdf_field_name = SN + "PtAIILine15_CheckBox15[0]";
    }
    await q(`update form_questions set options='${esc(JSON.stringify(opts))}'::jsonb where id='${SID}';`);
    console.log("OK  Cónyuge en EE.UU.? select → línea 15 CheckBox15");
  }
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
