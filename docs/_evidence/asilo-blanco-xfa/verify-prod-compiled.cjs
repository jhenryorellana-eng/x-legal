/* Verifica el expediente RECOMPILADO EN PROD (por UI, código con el fix desplegado):
 * las páginas del I-589 del asilo deben salir LLENAS (no en blanco). */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const KEY = "expedientes/case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/0bef32a7-da9f-483d-a91e-55f9c6ca47bc-a1.pdf";
const OUT = __dirname;

(async () => {
  const M = await import("mupdf");
  const r = await fetch(`${URL}/storage/v1/object/${KEY}?cb=${Date.now()}`, {
    headers: { Authorization: `Bearer ${SVC}`, apikey: SVC, "cache-control": "no-cache" },
  });
  if (!r.ok) { console.log("DOWNLOAD FAILED", r.status); return; }
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = M.Document.openDocument(buf, "application/pdf");
  const total = doc.countPages();

  // Buscar los datos del solicitante que SÓLO viven en la capa AcroForm del I-589.
  const terms = ["PAQUI PURIZACA", "240765", "AYACUCHO", "221086880"];
  const found = {};
  for (const t of terms) found[t] = [];
  for (let p = 0; p < total; p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    const txt = JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join(" ");
    for (const t of terms) if (txt.includes(t)) found[t].push(p + 1);
  }
  console.log(`compiled PROD: ${total} págs, ${buf.length} bytes`);
  for (const t of terms) console.log(`  "${t}" -> págs [${found[t].join(", ") || "NINGUNA"}]`);

  // Render de la primera página del I-589 digital del asilo (evidencia visual).
  const firstAsilo = (found["240765"] || []).find((p) => p > 20) ?? (found["PAQUI PURIZACA"] || [])[0];
  if (firstAsilo) {
    const png = doc.loadPage(firstAsilo - 1).toPixmap(M.Matrix.scale(0.9, 0.9), M.ColorSpace.DeviceRGB, false).asPNG();
    fs.writeFileSync(path.join(OUT, "PROD-asilo-CONfix.png"), Buffer.from(png));
    console.log(`render de la pág ${firstAsilo} -> PROD-asilo-CONfix.png`);
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
