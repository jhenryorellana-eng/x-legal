/* Renderiza páginas clave a PNG para inspección visual directa (¿en blanco o no?). */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const OUT = __dirname;

const CLIENT_KEY = "case-documents/case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/1784680630274-1784039342009-ilovepdf_merged__2_.pdf";
const COMPILED_KEY = "expedientes/case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/0bef32a7-da9f-483d-a91e-55f9c6ca47bc-a1.pdf";

async function download(fullKey) {
  const r = await fetch(`${URL}/storage/v1/object/${fullKey}?cb=${Date.now()}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC },
  });
  if (!r.ok) throw new Error(`download ${fullKey} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function renderPage(mupdf, buf, pageIdx0, outName, scale = 1.0) {
  const M = mupdf;
  const doc = M.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(pageIdx0);
  const pix = page.toPixmap(M.Matrix.scale(scale, scale), M.ColorSpace.DeviceRGB, false);
  const png = pix.asPNG();
  fs.writeFileSync(path.join(OUT, outName), Buffer.from(png));
  console.log("wrote", outName, `(${Buffer.from(png).length} bytes)`);
  try { pix.destroy?.(); } catch {}
  try { doc.destroy?.(); } catch {}
}

(async () => {
  const mupdf = await import("mupdf");
  const client = await download(CLIENT_KEY);
  const compiled = await download(COMPILED_KEY);

  // Original del cliente: pág 1 (ink 83%, sin texto) y pág 3 (con texto)
  await renderPage(mupdf, client, 0, "orig-p01.png", 0.9);
  await renderPage(mupdf, client, 2, "orig-p03.png", 0.9);

  // Compilado: juez p1 (pág 18), asilo p1 (pág 23), asilo p2 (pág 24), asilo p3 (pág 25)
  await renderPage(mupdf, compiled, 17, "comp-p18-juez.png", 0.9);
  await renderPage(mupdf, compiled, 22, "comp-p23-asilo1.png", 0.9);
  await renderPage(mupdf, compiled, 24, "comp-p25-asilo3.png", 0.9);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
