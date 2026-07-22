/* ¿Las páginas DIGITALES del I-589 (pág 3-14 del original) están realmente vacías,
 * o tienen valores en los widgets que no se pintan? Distingue:
 *   - widgets con getValue() no vacío  -> hay dato oculto (bug de appearances)
 *   - widgets todos vacíos             -> el cliente subió el formulario EN BLANCO */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const CLIENT_KEY = "case-documents/case/a310cdac-1292-4920-b7e0-3a808e2bcc3b/1784680630274-1784039342009-ilovepdf_merged__2_.pdf";

(async () => {
  const mupdf = await import("mupdf");
  const r = await fetch(`${URL}/storage/v1/object/${CLIENT_KEY}`, { headers: { Authorization: `Bearer ${SVC}`, apikey: SVC } });
  const buf = Buffer.from(await r.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");

  // AcroForm flags a nivel documento
  try {
    const acro = doc.getTrailer().get("Root").get("AcroForm");
    const needApp = acro && acro.get("NeedAppearances");
    console.log("AcroForm.NeedAppearances =", needApp ? String(needApp) : "(unset/false)");
  } catch (e) { console.log("acro read err", String(e)); }

  const total = doc.countPages();
  for (let p = 0; p < total; p++) {
    const page = doc.loadPage(p);
    const widgets = page.getWidgets?.() ?? [];
    let filled = 0;
    const samples = [];
    for (const w of widgets) {
      let v = "";
      try { v = w.getValue?.() ?? ""; } catch {}
      if (v && String(v).trim() && String(v).trim() !== "Off") {
        filled++;
        if (samples.length < 4) samples.push(`${(w.getName?.() ?? "?").slice(-28)}=${JSON.stringify(String(v).slice(0, 24))}`);
      }
    }
    console.log(`pág ${String(p + 1).padStart(2)}: widgets=${String(widgets.length).padStart(3)}  con_valor=${String(filled).padStart(3)}  ${samples.join("  ")}`);
  }
  try { doc.destroy?.(); } catch {}
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
