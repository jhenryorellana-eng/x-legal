/* Verificación Ola 1+2: descarga el I-589 generado de Karelis y extrae el texto por
 * página con mupdf, comprobando la checklist de hallazgos. node docs/_evidence/i589-hardening-verify.mjs */
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim().replace(/^["']|["']$/g, "") : null; };

const supa = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const PDF_PATH = "case/559220ae-796b-4110-ab45-bfc7eea6a564/forms/i-589-parte-a-informacion-personal-8ba801ac-8897-406c-a159-63743861fef9.pdf";

const { data, error } = await supa.storage.from("generated").download(PDF_PATH);
if (error) { console.error("DOWNLOAD_FAIL", error.message); process.exit(2); }
const bytes = new Uint8Array(await data.arrayBuffer());
fs.writeFileSync(path.join(__dirname, "karelis-i589-ola2.pdf"), bytes);

const doc = mupdf.Document.openDocument(bytes, "application/pdf");
const pages = doc.countPages();
const pageText = [];
for (let i = 0; i < pages; i++) {
  const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
  pageText.push(String(st.asText()).replace(/\s+/g, " ").trim());
}
const all = pageText.join("\n");

const has = (s) => all.includes(s);
const countNA = (all.match(/\bN\/A\b/g) || []).length;
const placeholderDates = (all.match(/\b01\/1990\b|\b01\/01\/1990\b/g) || []).length;

console.log(`PDF: ${pages} páginas, ${bytes.length} bytes\n`);
console.log("=== CHECKLIST ===");
console.log(`[1/14] Inglés — 'Venezuelan':      ${has("Venezuelan")}  | 'Venezolana' (NO debe): ${has("Venezolana")}`);
console.log(`[16]   Etnia 'Mestizo':             ${has("Mestizo")}     | 'Mestiza' (NO debe):    ${has("Mestiza")}`);
console.log(`[17]   Religión 'Catholic':         ${has("Catholic")}    | 'Católica' (NO debe):   ${has("Católica")}`);
console.log(`[13]   Ciudad+país 'Caracas':       ${has("Caracas")}`);
console.log(`[2]    Fechas placeholder 01/1990:  ${placeholderDates}  (debe ser 0)`);
console.log(`[6/N]  Conteo total de "N/A":       ${countNA}  (antes ~271; ahora debe ser mucho menor)`);
console.log("");
console.log("=== Texto por página (recortado) ===");
pageText.forEach((t, i) => console.log(`--- Pág ${i + 1} (${t.length} chars) ---\n${t.slice(0, 300)}\n`));
