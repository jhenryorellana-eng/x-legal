/* Download the filled EOIR-26 PDF and dump AcroForm field values (ground truth vs Pre-Mortem transcription). */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");

const OBJECT = "case/e2528124-7255-4156-a378-ab5cffbbcf77/forms/eoir-26-d2f8c97e-f9f7-4996-8674-c09b9a551351.pdf";

(async () => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/generated/${OBJECT}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!res.ok) {
    console.error("download failed", res.status, await res.text());
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(path.join(__dirname, "eoir26-filled.pdf"), buf);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const widgets = page.getWidgets ? page.getWidgets() : [];
    for (const w of widgets) {
      try {
        const name = w.getName ? w.getName() : "?";
        const value = w.getValue ? w.getValue() : "?";
        if (value && value !== "Off" && value !== "") out.push({ p: p + 1, name, value: String(value).slice(0, 120) });
      } catch {}
    }
  }
  console.log(JSON.stringify({ pages: doc.countPages(), filledFields: out }, null, 1));
})();
