/* Diagnostic: enumerate every widget annotation of the EOIR-26 via pdf-lib (raw
 * PDF-native /Rect, bottom-left origin) to find the TRUE signature-widget rects/pages
 * (mupdf's detected_fields rects are misaligned with the visible content). Read-only. */
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef } = require("pdf-lib");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL_BASE = get("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE = get("SUPABASE_SERVICE_ROLE_KEY");
const SOURCE = "forms/93512a98-b8a8-4673-b0aa-5d5cfb7b0202/1784158838694-EOIR-26.pdf";

(async () => {
  const res = await fetch(`${URL_BASE}/storage/v1/object/catalog-assets/${SOURCE}`, {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
  });
  if (!res.ok) { console.error("download failed", res.status); process.exit(1); }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const pages = doc.getPages();

  const num = (x) => (x && typeof x.asNumber === "function" ? x.asNumber() : Number(x?.numberValue ?? x));
  pages.forEach((page, idx) => {
    const mb = page.node.MediaBox?.() ?? page.node.get(PDFName.of("MediaBox"));
    const mbArr = mb && mb.asArray ? mb.asArray().map(num) : null;
    const annotsRaw = page.node.get(PDFName.of("Annots"));
    const annots = annotsRaw instanceof PDFRef ? ctx.lookup(annotsRaw) : annotsRaw;
    if (!(annots instanceof PDFArray)) return;
    for (let i = 0; i < annots.size(); i++) {
      let a = annots.get(i);
      if (a instanceof PDFRef) a = ctx.lookup(a);
      if (!(a instanceof PDFDict)) continue;
      const subtype = a.get(PDFName.of("Subtype"));
      const ft = a.get(PDFName.of("FT"));
      const t = a.get(PDFName.of("T"));
      const rect = a.get(PDFName.of("Rect"));
      const ftStr = ft ? String(ft) : "";
      // Signature widgets: /FT /Sig, OR a widget with no field type + no /T (the EOIR-26
      // signature widgets are unnamed). Print all widgets so we can eyeball it.
      const rectArr = rect && rect.asArray ? rect.asArray().map(num) : null;
      const isSig = ftStr === "/Sig";
      if (isSig || !t) {
        console.log(JSON.stringify({
          page: idx, mediaBox: mbArr, subtype: String(subtype ?? ""), ft: ftStr,
          name: t ? String(t) : null, rect: rectArr,
        }));
      }
    }
  });
})();
