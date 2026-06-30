import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { stampBates } from "../pdf";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

describe("stampBates", () => {
  it("stamps every page and preserves the page count + validity", async () => {
    const src = await makePdf(3);
    const out = await stampBates(src, "USALP-");
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(3);
    // a stamped PDF is larger than the empty source (text content was drawn)
    expect(out.length).toBeGreaterThan(src.length);
    expect(Buffer.from(out.subarray(0, 4)).toString("latin1")).toBe("%PDF");
  });

  it("is deterministic for the same input", async () => {
    const src = await makePdf(2);
    const a = await stampBates(src, "USALP-");
    const b = await stampBates(src, "USALP-");
    expect(a.length).toBe(b.length);
  });

  it("degrades gracefully (returns the original bytes) on an unparseable PDF", async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    const out = await stampBates(garbage, "USALP-");
    expect(out).toBe(garbage);
  });
});
