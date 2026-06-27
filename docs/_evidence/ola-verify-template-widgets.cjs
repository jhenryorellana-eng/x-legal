/* eslint-disable */
// Downloads the BLANK I-589 template and lists checkbox widgets on page 2 (index 1)
// with field name + rect, to map CheckBox5[0]/ChildrenCheckbox[0..1] to physical labels.
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const env = fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(get("NEXT_PUBLIC_SUPABASE_URL") || get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const BUCKET = "catalog-assets";
const TPL = "forms/e7f12a89-d1dd-4478-84f3-17afff5a0b8d/1781838665755-i-589.pdf";

async function main() {
  const { data, error } = await sb.storage.from(BUCKET).download(TPL);
  if (error) throw error;
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.PDFDocument.openDocument(bytes, "application/pdf");
  const idx = 1; // page 2
  const page = doc.loadPage(idx);
  const widgets = page.getWidgets();
  console.log("page 2 widget count:", widgets.length);
  const rows = [];
  for (const w of widgets) {
    let name = "?", ft = "?", rect = null;
    try { name = w.getName(); } catch {}
    try { ft = w.getFieldType(); } catch {}
    try { rect = w.getBounds ? w.getBounds() : (w.getRect ? w.getRect() : null); } catch {}
    if (/CheckBox5|ChildrenCheckbox|NotMarried|Marital|PtAII/i.test(name)) {
      rows.push({ name, ft, rect });
    }
  }
  rows.sort((a, b) => (a.rect && b.rect ? a.rect[1] - b.rect[1] : 0));
  for (const r of rows) console.log(`${r.ft}  y=${r.rect ? Math.round(r.rect[1]) : "?"}  x=${r.rect ? Math.round(r.rect[0]) : "?"}  ${r.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
