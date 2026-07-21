import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { stampSignatureAtRects, renderMarkdownToPdf, SIGNATURE_ANCHOR } from "../pdf";

async function makePdf(pages = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  return doc.save();
}

/** A guaranteed-valid PNG: render a blank PDF page to a small pixmap via mupdf
 *  (the same toPixmap→asPNG path the evidence render scripts use). */
async function makePng(): Promise<Uint8Array> {

  const mupdf = (await import("mupdf")) as any;
  const pdf = await makePdf(1);
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(0.1, 0.1), mupdf.ColorSpace.DeviceRGB, false);
  return pix.asPNG() as Uint8Array;
}

const isPdf = (b: Uint8Array) => Buffer.from(b.subarray(0, 4)).toString("latin1") === "%PDF";

/**
 * stampSignatureAtRects — draws a signature image at explicit widget rects (mupdf
 * fillImage, coordinate-consistent with detected_fields). Degrades to the original
 * bytes (same reference) when it cannot stamp.
 */
describe("stampSignatureAtRects", () => {
  it("stamps at a rect and preserves the page count + PDF validity", async () => {
    const src = await makePdf(2);
    const png = await makePng();
    const out = await stampSignatureAtRects(src, png, [{ page: 0, rect: [180, 480, 530, 550] }]);
    expect(out).not.toBe(src); // a new (stamped) buffer, not the degrade path
    expect(isPdf(out)).toBe(true);
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
  });

  it("stamps multiple rects across different pages", async () => {
    const src = await makePdf(3);
    const png = await makePng();
    const out = await stampSignatureAtRects(src, png, [
      { page: 0, rect: [180, 480, 530, 550] },
      { page: 2, rect: [184, 396, 527, 467] },
    ]);
    expect(out).not.toBe(src);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });

  it("returns the input unchanged when there are no placements", async () => {
    const src = await makePdf(1);
    const png = await makePng();
    expect(await stampSignatureAtRects(src, png, [])).toBe(src);
  });

  it("returns the input unchanged when the image is empty", async () => {
    const src = await makePdf(1);
    const out = await stampSignatureAtRects(src, new Uint8Array(), [{ page: 0, rect: [10, 10, 100, 60] }]);
    expect(out).toBe(src);
  });

  it("returns the input unchanged when the image is undecodable", async () => {
    const src = await makePdf(1);
    const out = await stampSignatureAtRects(src, new Uint8Array([1, 2, 3, 4, 5]), [
      { page: 0, rect: [10, 10, 100, 60] },
    ]);
    expect(out).toBe(src);
  });
});

/**
 * renderMarkdownToPdf with a signature image — stamps at the invisible SIGNATURE_ANCHOR
 * the caller placed inline in the markdown (a signed ai_letter). Backward-compatible
 * with no options.
 */
describe("renderMarkdownToPdf — signature stamping", () => {
  const signedMd =
    `Respectfully submitted,\n\n<span style="color:#fff;font-size:1pt">${SIGNATURE_ANCHOR}</span>\n\nJuan Pérez\nRespondent, Pro Se`;

  it("renders a valid PDF when the anchor is present but no image is given", async () => {
    const out = await renderMarkdownToPdf(signedMd);
    expect(isPdf(out)).toBe(true);
  });

  it("stamps the image at the inline anchor without throwing", async () => {
    const png = await makePng();
    const out = await renderMarkdownToPdf(signedMd, { signatureImageBytes: png });
    expect(isPdf(out)).toBe(true);
  });

  it("is backward-compatible with no options", async () => {
    const out = await renderMarkdownToPdf("Hello world");
    expect(isPdf(out)).toBe(true);
  });
});
