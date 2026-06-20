/**
 * Adds an empirically-verified per-option pdf_field_name to each A.I/A.II SELECT
 * question (Sex, Marital, Yes/No groups) and nulls the question's own
 * pdf_field_name, so the fill engine ticks the CORRECT checkbox per answer
 * (previously a select always marked option [0]).
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/rebuild-selects.cjs
 */
const PROJ = "uexxyokexcamyjcknxua";
const S0 = "form1[0].#subform[0].";
const S1 = "form1[0].#subform[1].";
const S1N = "form1[0].#subform[1].NotMarried[0].";

// questionId -> { optionValue: fullPdfFieldName | null }
const MAP = {
  "1a6c78eb-9857-408e-967d-59cbd9504af4": { male: S0 + "PartALine9Sex[0]", female: S0 + "PartALine9Sex[1]" },
  "c197889a-e550-4a13-9c74-52cfc3dafe2a": { single: S0 + "Marital[0]", married: S0 + "Marital[1]", divorced: S0 + "Marital[2]", widowed: S0 + "Marital[3]" },
  "6906a633-564f-4cc7-9165-e6079c0087fb": { no: S0 + "CheckBox3[0]", yes_ongoing: S0 + "CheckBox3[1]", yes_completed: S0 + "CheckBox3[2]" },
  "56af39f2-0dc7-4bb0-99b8-58bda0fd65b2": { si: S1 + "CheckBox5[0]", no: null },
  "2a767829-a006-4721-aadf-864d907e6ec1": { si: S1N + "PtAIILine22_Yes[0]", no: S1N + "PtAIILine22_No[0]" },
  "0c48e2ae-7aa5-4e72-be66-815cf79d30ba": { si: S1N + "PtAIILine24_Yes[0]", no: S1N + "PtAIILine24_No[0]" },
  "a553f00e-e860-49ff-97f6-b9c96670571e": { si: S1 + "ChildrenCheckbox[1]", no: S1 + "ChildrenCheckbox[0]" },
  "4d89ab31-85c8-44ce-9eb3-7b3c5cf6861f": { si: S1 + "PtAIILine20_Yes[0]", no: S1 + "PtAIILine20_No[0]" },
  "fcc12aa5-67ed-4068-bee9-496a0c15d03f": { si: S1 + "PtAIILine21_Yes[0]", no: S1 + "PtAIILine21_No[0]" },
};

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
  for (const [qid, valueMap] of Object.entries(MAP)) {
    const rows = await q(`select options from form_questions where id='${qid}';`);
    if (!rows.length) throw new Error("question not found: " + qid);
    const options = rows[0].options;
    let unknown = 0;
    for (const o of options) {
      if (!(o.value in valueMap)) { unknown++; continue; }
      o.pdf_field_name = valueMap[o.value];
    }
    if (unknown) throw new Error(`question ${qid} had ${unknown} options not in map`);
    const json = JSON.stringify(options).replace(/'/g, "''");
    await q(`update form_questions set options='${json}'::jsonb, pdf_field_name=null where id='${qid}';`);
  }
  // audit
  const out = await q(`
    select count(*) selects,
           count(*) filter (where pdf_field_name is null) nulled
    from form_questions
    where id in (${Object.keys(MAP).map((k) => `'${k}'`).join(",")});`);
  console.log("selects updated:", JSON.stringify(out[0]));
})().catch((e) => { console.error("FAIL", e.message); process.exit(1); });
