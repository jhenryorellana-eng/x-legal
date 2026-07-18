/**
 * extractPdfPageRange — sub-PDF extraction for the chunked OCR pipeline
 * (large scanned documents are OCR'd in page-range chunks; each chunk must be
 * a valid standalone PDF well under the inline request limit).
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { countPdfPages, extractPdfPageRange } from "../pdf";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

describe("extractPdfPageRange", () => {
  it("extracts a middle range (0-based start, end exclusive)", async () => {
    const src = await makePdf(10);
    const out = await extractPdfPageRange(src, 3, 7);
    expect(await countPdfPages(out)).toBe(4);
    expect(Buffer.from(out.subarray(0, 4)).toString("latin1")).toBe("%PDF");
  });

  it("clamps the end to the document length", async () => {
    const src = await makePdf(10);
    const out = await extractPdfPageRange(src, 8, 99);
    expect(await countPdfPages(out)).toBe(2);
  });

  it("extracts the final single page", async () => {
    const src = await makePdf(5);
    const out = await extractPdfPageRange(src, 4, 5);
    expect(await countPdfPages(out)).toBe(1);
  });

  it("throws on an empty or out-of-bounds range", async () => {
    const src = await makePdf(3);
    await expect(extractPdfPageRange(src, 2, 2)).rejects.toThrow();
    await expect(extractPdfPageRange(src, 5, 8)).rejects.toThrow();
    await expect(extractPdfPageRange(src, -1, 2)).rejects.toThrow();
  });
});
