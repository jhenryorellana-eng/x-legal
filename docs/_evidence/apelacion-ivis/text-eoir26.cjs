/* Extract text from the filled EOIR-26 to verify item #1 (A-number) and item #8 ground truth. */
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, "eoir26-filled.pdf"));
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  for (let p = 0; p < Math.min(doc.countPages(), 4); p++) {
    const page = doc.loadPage(p);
    const st = page.toStructuredText("preserve-whitespace");
    const txt = JSON.parse(st.asJSON()).blocks
      .flatMap((b) => (b.lines || []).map((l) => l.text))
      .join("\n");
    console.log(`\n===== PAGE ${p + 1} =====\n` + txt.slice(0, 2600));
  }
})();
