/* Download the re-rendered letter PDFs from Storage and confirm both formatting
 * fixes landed:
 *   1) the service-method line "Method of service (check one):" is NOT glued to the
 *      first "[ ]/[X]" box — each box is on its own text line.
 *   2) there is blank vertical space above the signature line.
 * Also renders the Proof's page + each letter's signature page to PNG for a human
 * eyeball (written next to this script). */
const fs = require("node:fs");
const path = require("node:path");

const env = fs.readFileSync(path.join(__dirname, "..", "..", "..", ".env.local"), "utf8");
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim();
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");

const RUNS = {
  "statement-v1": "bb3f0ff5-3607-411c-8ab7-25a85da9e78e",
  "statement-v3-newest": "871fac7f-371f-4641-bebb-7748ef42887b",
  "proof-of-service": "3d5b811b-8217-4ee6-b44e-19a983ca8510",
};

function linesOf(doc) {
  const lines = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const st = doc.loadPage(p).toStructuredText("preserve-whitespace");
    for (const b of JSON.parse(st.asJSON()).blocks) {
      for (const l of b.lines || []) lines.push(l.text);
    }
  }
  return lines;
}

(async () => {
  const mupdf = await import("mupdf");
  for (const [label, runId] of Object.entries(RUNS)) {
    const key = `generated/runs/${runId}/output.pdf`;
    const r = await fetch(`${URL}/storage/v1/object/generated/${key}`, {
      headers: { Authorization: `Bearer ${SVC}`, apikey: SVC },
    });
    console.log(`\n=== ${label} (${runId}) ===`);
    if (!r.ok) { console.log(`  DOWNLOAD FAILED ${r.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const doc = mupdf.Document.openDocument(buf, "application/pdf");
    const lines = linesOf(doc);
    console.log(`  bytes=${buf.length}  pages=${doc.countPages()}`);

    // (1) Method of service: the label line must NOT contain a check-box.
    const methodIdx = lines.findIndex((l) => /Method of service/i.test(l));
    if (methodIdx >= 0) {
      const labelLine = lines[methodIdx];
      const glued = /\[[ Xx]\]/.test(labelLine);
      console.log(`  method label line: "${labelLine.trim()}"`);
      console.log(`  first box on its OWN line? -> ${glued ? "❌ GLUED to label" : "✅ separate line"}`);
      console.log(`  next 3 lines: ${lines.slice(methodIdx + 1, methodIdx + 4).map((l) => `"${l.trim()}"`).join(" | ")}`);
    }

    // (2) Signature: show the lines around the printable signature line / Pro Se.
    const sigIdx = lines.findIndex((l) => /_{6,}/.test(l));
    const proSeIdx = lines.findIndex((l) => /Pro Se/i.test(l));
    const anchor = sigIdx >= 0 ? sigIdx : proSeIdx;
    if (anchor >= 0) {
      console.log(`  around signature: ${lines.slice(Math.max(0, anchor - 3), anchor + 2).map((l) => `"${l.trim()}"`).join(" | ")}`);
    }

    // Render the last page (signature is at the end) to PNG for a human eyeball.
    const lastPage = doc.loadPage(doc.countPages() - 1);
    const pix = lastPage.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.join(__dirname, `${label}-lastpage.png`), pix.asPNG());
    console.log(`  wrote ${label}-lastpage.png`);
  }
})();
