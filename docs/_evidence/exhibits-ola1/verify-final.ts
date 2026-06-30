import * as fs from "fs";
import * as path from "path";

async function main() {
  const mupdf = await import("mupdf");
  const M = mupdf as unknown as { Document: { openDocument(b: Uint8Array, t: string): unknown } };
  const file = path.resolve(__dirname, "live-case-expediente.pdf");
  const bytes = new Uint8Array(fs.readFileSync(file));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = M.Document.openDocument(bytes, "application/pdf") as any;
  const n = doc.countPages();
  const pageText = (i: number) => {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    return String(st.asText()).replace(/\s+/g, " ").trim();
  };
  const first = pageText(0);
  const last = pageText(n - 1);
  console.log(`pages: ${n}, sizeKB: ${Math.round(bytes.length / 1024)}`);
  console.log(`TOC(p1) starts: ${first.slice(0, 90)}`);
  console.log(`Bates USALP-0001 on p1: ${/USALP-0001/.test(first)}`);
  console.log(`Bates USALP-${String(n).padStart(4, "0")} on last page: ${new RegExp(`USALP-${String(n).padStart(4, "0")}`).test(last)}`);

  // render TOC (p1) + Exhibit A-1 first page (p14) to PNG for visual evidence
  for (const [idx, name] of [[0, "p01-index"], [13, "p14-exhibit-A1"], [89, "p90-exhibit-B2-statedept"]] as [number, string][]) {
    if (idx >= n) continue;
    const page = doc.loadPage(idx);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pix = page.toPixmap((mupdf as any).Matrix.scale(1.4, 1.4), (mupdf as any).ColorSpace.DeviceRGB, false);
    fs.writeFileSync(path.resolve(__dirname, `final-${name}.png`), Buffer.from(pix.asPNG()));
    console.log(`rendered final-${name}.png`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
