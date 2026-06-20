/**
 * Verifies the select->checkbox option mapping: sets each select to a NON-default
 * option and renders pages 1-3 so we can confirm the CORRECT checkbox is ticked
 * (female, divorced, yes_completed, several "No"...). Replicates the prod fill
 * (option field per choice) + the N/A text backfill.
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/verify-selects.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const PROJ = "uexxyokexcamyjcknxua";
const VER = "ee9f6692-aacf-4cf4-a7cb-716d9cf63c0a";
const INTERNAL =
  /(signature|preparer|interpreter|attorney|g-?28|barcode|bar_code|pdf417|qrcode|page[\s_-]?(number|no\b)|uscis\s*use|official\s*use|notary|date\s*of\s*signature)/i;

// non-default test answers (prove the right box is chosen, not just [0])
const ANS = {
  "1a6c78eb-9857-408e-967d-59cbd9504af4": "female",
  "c197889a-e550-4a13-9c74-52cfc3dafe2a": "divorced",
  "6906a633-564f-4cc7-9165-e6079c0087fb": "yes_completed",
  "56af39f2-0dc7-4bb0-99b8-58bda0fd65b2": "si",
  "2a767829-a006-4721-aadf-864d907e6ec1": "no",
  "0c48e2ae-7aa5-4e72-be66-815cf79d30ba": "si",
  "a553f00e-e860-49ff-97f6-b9c96670571e": "si",
  "4d89ab31-85c8-44ce-9eb3-7b3c5cf6861f": "no",
  "fcc12aa5-67ed-4068-bee9-496a0c15d03f": "si",
};

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

const questions = await q(`
  select q.id, q.field_type, q.pdf_field_name name, q.options, q.question_i18n->>'es' es
  from form_question_groups g join form_questions q on q.group_id=g.id
  where g.automation_version_id='${VER}';`);
const detected = await q(`
  select f->>'pdf_field_name' name, f->>'field_type' ft, (f->>'page')::int pg
  from form_automation_versions v, jsonb_array_elements(v.detected_fields) f where v.id='${VER}';`);

const values = {};
const tag = (es) => es.replace(/\(.*?\)/g, "").replace(/—/g, "-").replace(/\s+/g, " ").trim().slice(0, 16) || "X";
const markedReport = [];
for (const x of questions) {
  const optionFields = x.field_type === "select" && Array.isArray(x.options) ? x.options : null;
  const hasOpt = optionFields && optionFields.some((o) => o?.pdf_field_name);
  if (hasOpt) {
    const ans = ANS[x.id] ?? optionFields[0].value;
    const chosen = optionFields.find((o) => String(o.value) === String(ans));
    if (chosen?.pdf_field_name) { values[chosen.pdf_field_name] = true; markedReport.push(`${x.es.slice(0, 26)} = ${ans} -> ${chosen.pdf_field_name.split(".").pop()}`); }
  } else if (x.name) {
    values[x.name] = x.field_type === "checkbox" ? true : tag(x.es);
  }
}
// N/A backfill page 1-4 (mirror prod)
const mapped = new Set(Object.keys(values));
for (const d of detected) {
  if (d.pg >= 1 && d.pg <= 4 && d.ft === "text" && !mapped.has(d.name) && !INTERNAL.test(d.name)) values[d.name] = "N/A";
}

const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try { const a = doc.getTrailer()?.get("Root")?.get("AcroForm"); if (a) { a.delete("XFA"); a.put("NeedAppearances", doc.newBoolean(true)); } } catch {}
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets?.() ?? []) {
    const name = w.getName?.() ?? "";
    if (!(name in values)) continue;
    const ft = w.getFieldType?.() ?? "text";
    try { if (ft === "checkbox") { if (values[name]) w.toggle?.(); } else w.setTextValue?.(String(values[name])); w.update?.(); } catch {}
  }
}
try { doc.bake(); } catch {}
const outBytes = doc.saveToBuffer("").asUint8Array();
const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
for (const p of [0, 1, 2]) {
  const pix = fd.loadPage(p).toPixmap(mupdf.Matrix.scale(2.5, 2.5), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/selects-p${p + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log("marked options:\n " + markedReport.join("\n "));
