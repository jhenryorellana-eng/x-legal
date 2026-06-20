/**
 * Full Part-A autofill test on the PUBLISHED v2:
 *  (1) coverage audit — detected fields on pages 1-4 (excluding office-use/internal)
 *      that have NO question = real "empty spaces" the form can't autofill.
 *  (2) fill EVERY mapped question (overflow/siblings forced active) + render pages 1-4
 *      so we can visually confirm there are no blank applicant cells and values land
 *      in the right place.
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/fulltest.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const PROJ = "uexxyokexcamyjcknxua";
const VER = "ee9f6692-aacf-4cf4-a7cb-716d9cf63c0a"; // published v2

const INTERNAL =
  /(signature|preparer|interpreter|attorney|g-?28|barcode|bar_code|pdf417|qrcode|page[\s_-]?(number|no\b)|uscis\s*use|official\s*use|notary|date\s*of\s*signature)/i;

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

// ---- fetch questions (all groups of this version) ----
const questions = await q(`
  select g.position gpos, g.title_i18n->>'es' grp, q.field_type, q.source,
         q.pdf_field_name name, q.question_i18n->>'es' es
  from form_question_groups g
  join form_questions q on q.group_id = g.id
  where g.automation_version_id='${VER}'
  order by g.position, q.position;`);
const mapped = questions.filter((x) => x.name);
const mappedNames = new Set(mapped.map((x) => x.name));

// ---- fetch detected fields, audit page 1-4 coverage ----
const detected = await q(`
  select f->>'pdf_field_name' name, f->>'field_type' ft, (f->>'page')::int pg
  from form_automation_versions v, jsonb_array_elements(v.detected_fields) f
  where v.id='${VER}';`);
const partA = detected.filter((d) => d.pg >= 1 && d.pg <= 4);
const gaps = partA.filter((d) => !mappedNames.has(d.name) && !INTERNAL.test(d.name) && d.ft !== "signature");
console.log(`Part A detected fields (pg 1-4): ${partA.length} | mapped questions: ${mapped.length}`);
console.log(`COVERAGE GAPS (applicant fields on pg 1-4 with NO question): ${gaps.length}`);
const byPage = {};
for (const g of gaps) (byPage[g.pg] ??= []).push(`${g.name.split(".").pop()}(${g.ft})`);
for (const pg of Object.keys(byPage).sort()) console.log(`  pg${pg}: ${byPage[pg].join(", ")}`);

// ---- build a short readable tag per mapped field ----
function tag(es) {
  let s = es.replace(/\(.*?\)/g, "").replace(/—/g, "-").replace(/\s+/g, " ").trim();
  s = s
    .replace(/Última dirección.*persecución/i, "Pers")
    .replace(/Última dirección.*/i, "UltDir")
    .replace(/Residencia (\d+).*?-\s*/i, "Res$1-")
    .replace(/Educación (\d+).*?-\s*/i, "Edu$1-")
    .replace(/Empleo (\d+).*?-\s*/i, "Emp$1-")
    .replace(/Hermano\/a (\d+).*?-\s*/i, "Herm$1-")
    .replace(/Madre.*?-?\s*/i, "Madre-")
    .replace(/Padre.*?-?\s*/i, "Padre-")
    .replace(/Hijo (\d+).*/i, "Hijo$1")
    .replace(/cónyuge|spouse/i, "Conyuge");
  return s.slice(0, 20) || "X";
}
const values = {};
for (const x of mapped) values[x.name] = x.field_type === "checkbox" ? true : tag(x.es);

// ---- fill every mapped field + render pages 1-4 ----
const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try {
  const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
} catch {}
let filled = 0;
const present = new Set();
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets?.() ?? []) {
    const name = w.getName?.() ?? "";
    if (!(name in values)) continue;
    present.add(name);
    const ft = w.getFieldType?.() ?? "text";
    try {
      if (ft === "checkbox") { if (values[name]) w.toggle?.(); }
      else w.setTextValue?.(String(values[name]));
      w.update?.();
      filled++;
    } catch {}
  }
}
const notFound = mapped.filter((x) => !present.has(x.name)).map((x) => x.name);
try { doc.bake(); } catch {}
const outBytes = doc.saveToBuffer("").asUint8Array();
writeFileSync(`${OUT}/fulltest.pdf`, Buffer.from(outBytes));
const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
for (const p of [0, 1, 2, 3]) {
  const pix = fd.loadPage(p).toPixmap(mupdf.Matrix.scale(2.3, 2.3), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/fulltest-p${p + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log(`filled widgets: ${filled} | mapped-but-not-found in PDF: ${notFound.length}`, notFound.slice(0, 10));
