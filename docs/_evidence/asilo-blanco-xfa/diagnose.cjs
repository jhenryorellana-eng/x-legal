/* Diagnóstico: por qué "Asilo presentado completo (con anexos)" sale EN BLANCO al imprimir.
 *
 * Caso a310cdac-… (RICARDO). Documento del cliente id 63fc6484-… en bucket case-documents.
 * Analiza el PDF ORIGINAL subido por el cliente + el expediente COMPILADO, con mupdf:
 *   - ¿Tiene capa XFA? (AcroForm/XFA en el trailer)
 *   - Por página: texto extraído, nº widgets (AcroForm), y % de tinta al renderizar a pixmap
 *     (un render casi 100% blanco = página visualmente vacía → el clásico XFA "dynamic").
 */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");

const CLIENT_DOC = {
  bucket: "case-documents",
  key: "case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/1784680630274-1784039342009-ilovepdf_merged__2_.pdf",
  label: "ORIGINAL subido por el cliente (Asilo presentado completo)",
};
const COMPILED = {
  bucket: "expedientes",
  key: "case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/0bef32a7-da9f-483d-a91e-55f9c6ca47bc-a1.pdf",
  label: "EXPEDIENTE COMPILADO (39 págs)",
};

async function download(bucket, key) {
  const r = await fetch(`${URL}/storage/v1/object/${bucket}/${key}?cb=${Date.now()}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "cache-control": "no-cache" },
  });
  if (!r.ok) throw new Error(`download ${bucket}/${key} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** % de píxeles con tinta (no-blancos) al rasterizar la página a ~72dpi. */
function inkRatio(mupdf, page) {
  try {
    const M = mupdf;
    const pix = page.toPixmap(M.Matrix.scale(1, 1), M.ColorSpace.DeviceGray, false);
    const s = pix.getPixels ? pix.getPixels() : pix.getSamples ? pix.getSamples() : null;
    if (!s) return -1;
    let ink = 0;
    for (let i = 0; i < s.length; i++) if (s[i] < 245) ink++;
    const ratio = ink / s.length;
    try { pix.destroy?.(); } catch {}
    return ratio;
  } catch (e) {
    return -1;
  }
}

function xfaInfo(mupdf, doc) {
  try {
    const acro = doc.getTrailer?.()?.get?.("Root")?.get?.("AcroForm");
    if (!acro) return { hasAcroForm: false, hasXFA: false };
    const xfa = acro.get?.("XFA");
    const hasXFA = !!xfa && !(xfa.isNull?.() ?? false);
    return { hasAcroForm: true, hasXFA };
  } catch (e) {
    return { hasAcroForm: "err", hasXFA: "err", err: String(e) };
  }
}

async function analyze(mupdf, label, buf) {
  const M = mupdf;
  const doc = M.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();
  const xfa = xfaInfo(M, doc);
  console.log(`\n=== ${label} ===`);
  console.log(`bytes=${buf.length}  pages=${total}  AcroForm=${xfa.hasAcroForm}  XFA=${xfa.hasXFA}`);
  console.log(`  pg | textLen | widgets | ink%`);
  for (let p = 0; p < total; p++) {
    const page = doc.loadPage(p);
    let textLen = 0;
    try {
      const st = page.toStructuredText("preserve-whitespace");
      const j = JSON.parse(st.asJSON());
      textLen = (j.blocks || [])
        .flatMap((b) => (b.lines || []).map((l) => l.text || ""))
        .join("").replace(/\s/g, "").length;
    } catch {}
    let widgets = -1;
    try { widgets = (page.getWidgets?.() ?? []).length; } catch {}
    const ink = inkRatio(M, page);
    const inkPct = ink < 0 ? "n/a" : (ink * 100).toFixed(2);
    const flag = ink >= 0 && ink < 0.005 ? "  <== VISUALMENTE EN BLANCO" : "";
    console.log(`  ${String(p + 1).padStart(2)} | ${String(textLen).padStart(7)} | ${String(widgets).padStart(7)} | ${String(inkPct).padStart(6)}${flag}`);
  }
  try { doc.destroy?.(); } catch {}
}

(async () => {
  const mupdf = await import("mupdf");
  const clientBuf = await download(CLIENT_DOC.bucket, CLIENT_DOC.key);
  await analyze(mupdf, CLIENT_DOC.label, clientBuf);

  const compiledBuf = await download(COMPILED.bucket, COMPILED.key);
  await analyze(mupdf, COMPILED.label, compiledBuf);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
