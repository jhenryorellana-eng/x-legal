/**
 * Acceptance-completeness test (USCIS rule: no blank box; "N/A" allowed for
 * inapplicable fields — 8 CFR 1208.3(c)(3)). Simulates the fill engine + an N/A
 * backfill: maps the answered questions, then writes "N/A" into every applicant
 * TEXT field on pages 1-4 that is still blank (excluding office-use/signature).
 * Renders pages 1-4 so we can confirm there is no empty text box left.
 *
 * Usage: SBTOKEN=<token> node docs/_evidence/a3-test/fulltest2.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as mupdf from "mupdf";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/a3-test`;
const PROJ = "uexxyokexcamyjcknxua";
const VER = "ee9f6692-aacf-4cf4-a7cb-716d9cf63c0a";

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

const questions = await q(`
  select q.field_type, q.pdf_field_name name, q.question_i18n->>'es' es
  from form_question_groups g join form_questions q on q.group_id=g.id
  where g.automation_version_id='${VER}' and q.pdf_field_name is not null;`);
const detected = await q(`
  select f->>'pdf_field_name' name, f->>'field_type' ft, (f->>'page')::int pg
  from form_automation_versions v, jsonb_array_elements(v.detected_fields) f
  where v.id='${VER}';`);

const mappedNames = new Set(questions.map((x) => x.name));
const tagOf = (es) => es.replace(/\(.*?\)/g, "").replace(/—/g, "-").replace(/\s+/g, " ").trim().slice(0, 18) || "X";
const values = {};
for (const x of questions) values[x.name] = x.field_type === "checkbox" ? true : tagOf(x.es);

// N/A backfill: every page-1-4 applicant TEXT field still blank -> "N/A"
let naCount = 0;
for (const d of detected) {
  if (d.pg < 1 || d.pg > 4) continue;
  if (d.ft !== "text") continue;
  if (mappedNames.has(d.name)) continue;
  if (INTERNAL.test(d.name)) continue;
  values[d.name] = "N/A";
  naCount++;
}
console.log(`mapped: ${mappedNames.size} | N/A-backfilled text fields (pg1-4): ${naCount}`);

// fill + render
const bytes = new Uint8Array(readFileSync(`${ROOT}/i-589.pdf`));
const doc = mupdf.Document.openDocument(bytes, "application/pdf");
try {
  const acro = doc.getTrailer()?.get("Root")?.get("AcroForm");
  if (acro) { acro.delete("XFA"); acro.put("NeedAppearances", doc.newBoolean(true)); }
} catch {}
let filled = 0, blankTextOnPg14 = [];
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i);
  for (const w of page.getWidgets?.() ?? []) {
    const name = w.getName?.() ?? "";
    const ft = w.getFieldType?.() ?? "text";
    if (name in values) {
      try { if (ft === "checkbox") { if (values[name]) w.toggle?.(); } else w.setTextValue?.(String(values[name])); w.update?.(); filled++; } catch {}
    } else if (i <= 3 && ft !== "checkbox" && !INTERNAL.test(name)) {
      blankTextOnPg14.push(`p${i + 1}:${name.split(".").pop()}`);
    }
  }
}
try { doc.bake(); } catch {}
const outBytes = doc.saveToBuffer("").asUint8Array();
const fd = mupdf.Document.openDocument(outBytes, "application/pdf");
for (const p of [0, 1, 2, 3]) {
  const pix = fd.loadPage(p).toPixmap(mupdf.Matrix.scale(2.3, 2.3), mupdf.ColorSpace.DeviceRGB, false);
  writeFileSync(`${OUT}/accept-p${p + 1}.png`, Buffer.from(pix.asPNG()));
}
console.log(`filled widgets: ${filled} | BLANK applicant text boxes still on pg1-4: ${blankTextOnPg14.length}`, blankTextOnPg14.slice(0, 20));
