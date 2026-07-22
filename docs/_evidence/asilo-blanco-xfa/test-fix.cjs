/* PRUEBA DE CAUSA RAÍZ: regenerar apariencias (NeedAppearances + update() + bake())
 * debe hacer visibles los datos que hoy salen en blanco. Renderiza pág 3 ANTES vs DESPUÉS. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_KEY = "case-documents/case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/1784680630274-1784039342009-ilovepdf_merged__2_.pdf";
const OUT = __dirname;

function inkRatio(mupdf, page) {
  const pix = page.toPixmap(mupdf.Matrix.scale(1, 1), mupdf.ColorSpace.DeviceGray, false);
  const s = pix.getPixels();
  let ink = 0;
  for (let i = 0; i < s.length; i++) if (s[i] < 245) ink++;
  return ink / s.length;
}

(async () => {
  const M = await import("mupdf");
  const r = await fetch(`${URL}/storage/v1/object/${CLIENT_KEY}`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
  const buf = Buffer.from(await r.arrayBuffer());

  // Regenerar apariencias sobre TODO el doc (receta fillAcroForm sin cambiar valores)
  const doc = M.Document.openDocument(buf, "application/pdf");
  try {
    const acro = doc.getTrailer().get("Root").get("AcroForm");
    if (acro) acro.put("NeedAppearances", true);
  } catch (e) { console.log("acro err", String(e)); }
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const page = doc.loadPage(i);
    for (const w of page.getWidgets?.() ?? []) { try { w.update?.(); } catch {} }
  }
  try { doc.bake?.(); } catch (e) { console.log("bake err", String(e)); }

  // Guardar el PDF reparado y renderizar la pág 3 (I-589 pág 1 digital) DESPUÉS
  const fixed = doc.saveToBuffer("").asUint8Array();
  fs.writeFileSync(path.join(OUT, "asilo-REPARADO.pdf"), Buffer.from(fixed));

  const doc2 = M.Document.openDocument(Buffer.from(fixed), "application/pdf");
  const page3 = doc2.loadPage(2);
  const inkAfter = inkRatio(M, page3);
  const png = page3.toPixmap(M.Matrix.scale(0.9, 0.9), M.ColorSpace.DeviceRGB, false).asPNG();
  fs.writeFileSync(path.join(OUT, "asilo-p03-DESPUES.png"), Buffer.from(png));

  // texto extraíble después
  const st = page3.toStructuredText("preserve-whitespace");
  const txt = JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join(" ");
  console.log("pág 3 DESPUÉS: ink% =", (inkAfter * 100).toFixed(2));
  console.log("pág 3 DESPUÉS: contiene 'PAQUI'? ", txt.includes("PAQUI"), " | '240765392'? ", txt.includes("240765392"));
  console.log("muestra texto:", txt.replace(/\s+/g, " ").slice(0, 220));
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
