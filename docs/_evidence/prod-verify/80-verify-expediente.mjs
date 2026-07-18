/* Download the compiled expediente PDF and verify with mupdf (pages, cover, TOC, Bates). */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };
const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const CASE_ID = process.argv[2] || "c45efdc9-0fa6-4781-898b-a8c8bf2fbf52";
const { data: exp } = await supa.from("expedientes").select("compiled_pdf_path, page_count, status").eq("case_id", CASE_ID).order("attempt_no", { ascending: false }).limit(1).single();
console.log(`expediente status=${exp.status} db_pages=${exp.page_count} path=${exp.compiled_pdf_path}`);

let buf = null;
for (const bucket of ["expedientes", "generated", "case-documents"]) {
  const dl = await supa.storage.from(bucket).download(exp.compiled_pdf_path);
  if (dl.data) { buf = Buffer.from(await dl.data.arrayBuffer()); console.log(`downloaded from bucket '${bucket}' (${buf.length} bytes)`); break; }
}
if (!buf) { console.error("could not download from any bucket"); process.exit(1); }
const out = path.join(__dirname, `expediente-${CASE_ID.slice(0, 8)}.pdf`);
fs.writeFileSync(out, buf);

const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(buf, "application/pdf");
const pages = doc.countPages();
const isPdf = buf.subarray(0, 4).toString("latin1") === "%PDF";
console.log(`FILE ${out} %PDF=${isPdf} pages=${pages}`);

const pageText = (i) => doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
// cover (page 0) + a scan for TOC + Bates stamps
const cover = pageText(0).replace(/\s+/g, " ").trim();
console.log(`\n--- COVER (page 1) ---\n${cover.slice(0, 400)}`);
let tocPage = -1, batesSamples = [];
for (let i = 0; i < pages; i++) {
  const t = pageText(i);
  if (tocPage < 0 && /(Table of Contents|Índice|Index of|INDICE)/i.test(t)) tocPage = i;
  const m = t.match(/USALP[- ]?\d{3,}/i) || t.match(/Bates|USALP/i);
  if (m && batesSamples.length < 4) batesSamples.push(`p${i + 1}:${m[0]}`);
}
console.log(`\nTOC found on page: ${tocPage >= 0 ? tocPage + 1 : "not detected"}`);
if (tocPage >= 0) console.log(`--- TOC (page ${tocPage + 1}) ---\n${pageText(tocPage).replace(/\s+/g, " ").trim().slice(0, 600)}`);
console.log(`\nBates/stamp samples: ${batesSamples.length ? batesSamples.join("  ") : "none matched USALP/Bates pattern"}`);
// last page tail
console.log(`\n--- LAST PAGE (${pages}) ---\n${pageText(pages - 1).replace(/\s+/g, " ").trim().slice(0, 200)}`);
