/* Compare: closing as RAW top-level <p> (like the real doc) vs wrapped in a plain
 * <div> vs <div> with break-inside:avoid. Detect an INTERNAL split (any of the 5
 * closing lines on a different page than the first). */
async function pagesText(html) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(new TextEncoder().encode(html), "text/html");
  doc.layout(612, 792, 11);
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    out.push(JSON.parse(st.asJSON()).blocks.flatMap((b) => (b.lines || []).map((l) => l.text)).join("\n"));
  }
  return out;
}
const CLOSING_PARAS = [
  `<p>Respectfully submitted,</p>`,
  `<p>SIGLINE____</p>`,
  `<p><strong>PALMA RODRIGUEZ, IVIS MICHELL</strong><br>Respondent, Pro Se</p>`,
  `<p>Address: 6310 Bumfries Dr.<br>City / State / ZIP: Houston, TX 77096<br>Telephone: (346) 609-4183</p>`,
  `<p>Date: 07/21/2026</p>`,
];
const MARKERS = ["Respectfully submitted", "PALMA RODRIGUEZ", "Address: 6310", "Date: 07/21/2026"];
function build(n, mode) {
  const filler = Array.from({ length: n }, (_, i) => `<p>Filler line number ${i + 1} lorem ipsum dolor sit amet consectetur adipiscing.</p>`).join("");
  let closing;
  if (mode === "raw") closing = CLOSING_PARAS.join("");
  else if (mode === "div") closing = `<div>${CLOSING_PARAS.join("")}</div>`;
  else closing = `<div style="page-break-inside:avoid;break-inside:avoid">${CLOSING_PARAS.join("")}</div>`;
  return `<!DOCTYPE html><html><head><style>body{font-family:'Times New Roman',serif;font-size:11pt;line-height:1.45;margin:72pt;color:#111}p{margin:0 0 9pt}</style></head><body>${filler}${closing}</body></html>`;
}
async function internalSplit(n, mode) {
  const pages = await pagesText(build(n, mode));
  const at = MARKERS.map((m) => pages.findIndex((p) => p.includes(m)));
  if (at.some((x) => x < 0)) return { split: null, at };
  const split = new Set(at).size > 1;
  return { split, at: at.map((x) => x + 1) };
}
(async () => {
  for (let n = 14; n <= 30; n++) {
    const raw = await internalSplit(n, "raw");
    const div = await internalSplit(n, "div");
    const avoid = await internalSplit(n, "avoid");
    const fmt = (r) => (r.split === null ? "??" : r.split ? `SPLIT[${r.at.join(",")}]` : `together[p${r.at[0]}]`);
    console.log(`filler=${n}  raw:${fmt(raw).padEnd(18)}  div:${fmt(div).padEnd(16)}  div+avoid:${fmt(avoid)}`);
  }
})();
