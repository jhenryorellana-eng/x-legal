/* Prototype the measure-and-break mechanism:
 *  - insert an invisible anchor at the closing-block start
 *  - render, find the anchor's page + total pages
 *  - if the anchor is NOT on the last page (block straddles), re-render with a hard
 *    page break at the block start so the WHOLE block lands on a fresh page.
 * Prove: straddling cases (filler 20-25) end with the closing block intact on ONE page. */
const KEEP = "<<<KEEP>>>";
const PAGEBREAK = "<<<PAGEBREAK>>>";
const ANCHOR = "XULPKEEPANCHORX";
const ANCHOR_SPAN = `<span style="color:#ffffff;font-size:1pt">${ANCHOR}</span>`;

async function htmlToPdfBytes(html) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
  doc.layout(612, 792, 11);
  if (typeof doc.toPDFDocument === "function") return doc.toPDFDocument().saveToBuffer("").asUint8Array();
  const buf = new mupdf.Buffer(); const w = new mupdf.DocumentWriter(buf, "pdf", "");
  for (let i = 0; i < doc.countPages(); i++) { const p = doc.loadPage(i); const d = w.beginPage(p.getBounds()); p.run(d, mupdf.Matrix.identity); w.endPage(); }
  w.close(); return buf.asUint8Array();
}
const STYLE = `<style>body{font-family:'Times New Roman',serif;font-size:11pt;line-height:1.45;margin:72pt;color:#111}p{margin:0 0 9pt}</style>`;
const wrapSeg = (bodyHtml) => `<!DOCTYPE html><html><head>${STYLE}</head><body>${bodyHtml}</body></html>`;
// markdown here is trivial (already HTML-ish); split on PAGEBREAK → graft each segment.
async function renderSegments(md) {
  const mupdf = await import("mupdf");
  const segs = md.split(PAGEBREAK).map((s) => s.trim()).filter(Boolean);
  if (segs.length <= 1) return htmlToPdfBytes(wrapSeg(segs[0] ?? md));
  const dst = new mupdf.PDFDocument();
  for (const s of segs) {
    const b = await htmlToPdfBytes(wrapSeg(s));
    const src = mupdf.Document.openDocument(b, "application/pdf");
    for (let i = 0; i < src.countPages(); i++) dst.graftPage(dst.countPages(), src, i);
  }
  return dst.saveToBuffer("garbage=4,compress=yes").asUint8Array();
}
async function anchorPage(pdfBytes, token) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const n = doc.countPages();
  for (let i = 0; i < n; i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    let hits; try { hits = st.search(token); } catch { hits = null; }
    if (Array.isArray(hits) && hits.length) return { page: i, pageCount: n };
  }
  return { page: -1, pageCount: n };
}
async function resolveKeepTogether(md) {
  if (!md.includes(KEEP)) return md;
  const probe = await renderSegments(md.split(KEEP).join(ANCHOR_SPAN));
  const { page, pageCount } = await anchorPage(probe, ANCHOR);
  const straddle = page >= 0 && page !== pageCount - 1;
  return md.split(KEEP).join(straddle ? PAGEBREAK : "");
}
function buildMd(n) {
  const filler = Array.from({ length: n }, (_, i) => `<p>Filler line number ${i + 1} lorem ipsum dolor sit amet consectetur adipiscing.</p>`).join("");
  const closing = `${KEEP}<p>Respectfully submitted,</p><p>SIGLINE____</p>` +
    `<p><strong>PALMA RODRIGUEZ, IVIS MICHELL</strong><br>Respondent, Pro Se</p>` +
    `<p>Address: 6310 Bumfries Dr.<br>City / State / ZIP: Houston, TX 77096<br>Telephone: (346) 609-4183</p>` +
    `<p>Date: 07/21/2026</p>`;
  return filler + closing;
}
async function pages(pdfBytes) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) out.push(JSON.parse(doc.loadPage(i).toStructuredText("preserve-whitespace").asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n"));
  return out;
}
(async () => {
  const MARK = ["Respectfully submitted", "PALMA RODRIGUEZ", "Address: 6310", "Date: 07/21/2026"];
  for (let n = 18; n <= 26; n++) {
    const resolved = await resolveKeepTogether(buildMd(n));
    const pdf = await renderSegments(resolved);
    const ps = await pages(pdf);
    const at = MARK.map((m) => ps.findIndex((p) => p.includes(m)) + 1);
    const together = new Set(at).size === 1;
    console.log(`filler=${n}  pages=${ps.length}  markers@${at.join(",")}  -> ${together ? "✅ closing intact on p" + at[0] : "❌ SPLIT"}`);
  }
})();
