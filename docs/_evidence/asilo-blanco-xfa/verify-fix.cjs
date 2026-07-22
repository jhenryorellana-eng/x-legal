/* VERIFICACIÓN END-TO-END del fix: reproduce el pipeline de compileExpediente
 * (resolveItemBytes + graftPage verbatim) con los items REALES del expediente de RICARDO,
 * corriéndolo SIN fix y CON fix, y compara la página del I-589 digital del asilo. */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const OUT = __dirname;
const CASE = "case/a310cdac-1292-4920-b7e0-3a808e2bcc3b";

// Items del expediente EN ORDEN (bucket, path, ¿subido por persona?)
const ITEMS = [
  { b: "generated", p: `${CASE}/covers/4f54572e-276b-4939-aac4-91466f452ef3.pdf`, person: false },
  { b: "generated", p: `${CASE}/forms/eoir-26-f0cf8e1d-4e7d-405a-a2c5-b2bb9e816bc1.pdf`, person: false },
  { b: "generated", p: `${CASE}/covers/eb68434e-931e-40f0-8833-e70e36a7fbbe.pdf`, person: false },
  { b: "generated", p: `generated/runs/e89f46f8-8430-445e-97bf-dcf1d413f075/output.pdf`, person: false },
  { b: "generated", p: `${CASE}/covers/2db3b0bf-2c81-42b7-af21-27cb1e4dafed.pdf`, person: false },
  { b: "generated", p: `generated/runs/ac3ae628-fe04-426d-b398-6a325ce10368/output.pdf`, person: false },
  { b: "generated", p: `${CASE}/covers/e39c141f-8d07-4472-8835-1e18d1ff6287.pdf`, person: false },
  { b: "case-documents", p: `${CASE}/1784680752340-juez.pdf`, person: true }, // juez
  { b: "generated", p: `${CASE}/covers/ac59ad97-d3af-49c7-8dcf-f9018eaee111.pdf`, person: false },
  { b: "case-documents", p: `${CASE}/1784680630274-1784039342009-ilovepdf_merged__2_.pdf`, person: true }, // ASILO
  { b: "generated", p: `${CASE}/covers/9e629e59-96bd-4e30-bcd8-4a850f3d793d.pdf`, person: false },
  { b: "case-documents", p: `${CASE}/1784680588330-pasaporte.pdf`, person: true }, // pasaporte
];

async function download(b, p) {
  const r = await fetch(`${URL}/storage/v1/object/${b}/${p}`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
  if (!r.ok) throw new Error(`download ${b}/${p} -> ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

// ==== copia EXACTA de la receta de src/backend/platform/pdf.ts::flattenAcroAppearances ====
function flattenAcroAppearances(M, bytes) {
  try {
    const doc = M.Document.openDocument(bytes, "application/pdf");
    try {
      const acro = doc.getTrailer?.()?.get?.("Root")?.get?.("AcroForm");
      if (!acro) return bytes;
      let anyWidget = false;
      const n = doc.countPages();
      for (let i = 0; i < n; i++) {
        const widgets = doc.loadPage(i).getWidgets?.() ?? [];
        if (widgets.length === 0) continue;
        anyWidget = true;
        for (const w of widgets) { try { w.update?.(); } catch {} }
      }
      if (!anyWidget) return bytes;
      try { acro.put("NeedAppearances", doc.newBoolean?.(true) ?? true); } catch {}
      try { doc.bake?.(); } catch {}
      return doc.saveToBuffer("garbage=4,compress=yes").asUint8Array();
    } finally { try { doc.destroy?.(); } catch {} }
  } catch { return bytes; }
}

async function compile(M, withFix) {
  const dst = new M.PDFDocument();
  for (const it of ITEMS) {
    let bytes = await download(it.b, it.p);
    if (withFix && it.person) bytes = Buffer.from(flattenAcroAppearances(M, bytes));
    const src = M.Document.openDocument(bytes, "application/pdf");
    const n = src.countPages();
    for (let i = 0; i < n; i++) dst.graftPage(dst.countPages(), src, i);
    try { src.destroy?.(); } catch {}
  }
  return Buffer.from(dst.saveToBuffer("garbage=4,compress=yes").asUint8Array());
}

function pagesContaining(M, buf, term) {
  const doc = M.Document.openDocument(buf, "application/pdf");
  const hits = [];
  const total = doc.countPages();
  for (let p = 0; p < total; p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    const txt = JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join(" ");
    if (txt.includes(term)) hits.push(p + 1);
  }
  return { total, hits };
}

function renderPage(M, buf, idx0, name) {
  const doc = M.Document.openDocument(buf, "application/pdf");
  const png = doc.loadPage(idx0).toPixmap(M.Matrix.scale(0.9, 0.9), M.ColorSpace.DeviceRGB, false).asPNG();
  fs.writeFileSync(path.join(OUT, name), Buffer.from(png));
}

(async () => {
  const M = await import("mupdf");
  const TERM = "PAQUI PURIZACA"; // dato del solicitante que sólo está en la capa AcroForm del I-589

  const noFix = await compile(M, false);
  const withFix = await compile(M, true);

  const a = pagesContaining(M, noFix, TERM);
  const b = pagesContaining(M, withFix, TERM);
  console.log(`SIN fix : ${a.total} págs, "${TERM}" VISIBLE en páginas [${a.hits.join(", ") || "NINGUNA"}]`);
  console.log(`CON fix : ${b.total} págs, "${TERM}" VISIBLE en páginas [${b.hits.join(", ") || "NINGUNA"}]`);

  // Renderiza la 1ª página digital del ASILO en ambos (para inspección visual).
  // El asilo va tras los primeros ítems; ignoramos coincidencias tempranas (EOIR-26).
  const firstDigital = b.hits.find((p) => p > 20) ?? b.hits[0];
  if (firstDigital) {
    renderPage(M, noFix, firstDigital - 1, "e2e-asilo-SINfix.png");
    renderPage(M, withFix, firstDigital - 1, "e2e-asilo-CONfix.png");
    console.log(`render de la pág ${firstDigital} del expediente → e2e-asilo-SINfix.png / e2e-asilo-CONfix.png`);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
