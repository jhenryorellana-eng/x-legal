/* Verificación Ola 4 (A-Number desenmascarado + hijos N/A): descarga el I-589 recién
 * regenerado de Karelis, extrae texto por página con mupdf, comprueba las aserciones clave
 * y renderiza págs 1-3 a PNG. node docs/_evidence/i589-ola4-verify.mjs */
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

const { data: signed, error: sErr } = await supa.storage.from("generated").createSignedUrl(PDF_PATH, 120);
if (sErr) { console.error("SIGN_FAIL", sErr.message); process.exit(2); }
const resp = await fetch(signed.signedUrl + "&cb=" + Date.now(), { cache: "no-store" });
if (!resp.ok) { console.error("FETCH_FAIL", resp.status); process.exit(2); }
const bytes = new Uint8Array(await resp.arrayBuffer());
fs.writeFileSync(path.join(__dirname, "karelis-i589-ola4.pdf"), bytes);

const doc = mupdf.Document.openDocument(bytes, "application/pdf");
const pages = doc.countPages();
const pageText = [];
for (let i = 0; i < pages; i++) {
  const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
  pageText.push(String(st.asText()).replace(/\s+/g, " ").trim());
}
const all = pageText.join("\n");
const bullets = (all.match(/[••]/g) || []).length;
const maskedAnum = /A-[••]/.test(all);
const rawAnum = all.includes("A123456789");
const naCount = (all.match(/\bN\/A\b/g) || []).length;

console.log(`PDF regenerado: ${pages} páginas, ${bytes.length} bytes\n`);
console.log("=== ASERCIONES CLAVE (Ola 4) ===");
console.log(`[A-Number] 'A123456789' literal presente:   ${rawAnum}   (debe ser true)`);
console.log(`[A-Number] patrón enmascarado 'A-•':         ${maskedAnum}  (debe ser false)`);
console.log(`[Máscara]  bullets '•' en todo el doc:       ${bullets}     (debe ser 0)`);
console.log(`[Hijos]    conteo total de 'N/A':            ${naCount}`);

// Render págs 1-3 (identidad + hijos) a PNG.
for (const idx of [0, 1, 2]) {
  const pix = doc.loadPage(idx).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
  fs.writeFileSync(path.join(__dirname, `karelis-ola4-p${idx + 1}.png`), pix.asPNG());
}
console.log("\nPNGs: karelis-ola4-p{1,2,3}.png");

// Recorte de texto de págs 1-3 para inspección directa.
[0, 1, 2].forEach((i) => console.log(`\n--- Pág ${i + 1} (${pageText[i].length} chars) ---\n${pageText[i].slice(0, 700)}`));
