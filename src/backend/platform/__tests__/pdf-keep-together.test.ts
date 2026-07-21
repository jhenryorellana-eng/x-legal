/**
 * renderMarkdownToPdf — KEEP_TOGETHER_MARKER (letter-closing keep-together).
 *
 * mupdf's HTML engine ignores CSS `break-inside:avoid`, so the renderer MEASURES and,
 * only when the marked block (from the marker to EOF) would straddle a page boundary,
 * pushes the WHOLE block onto a fresh page. These tests drive the real mupdf renderer
 * (no mocks) and assert the differential: the SAME body straddles WITHOUT the marker
 * and stays intact WITH it — without hard-coding page numbers.
 */
import { describe, it, expect } from "vitest";
import { renderMarkdownToPdf, KEEP_TOGETHER_MARKER } from "../pdf";

// A closing block that is a few lines tall (like a real BIA letter closing).
const CLOSING =
  "Respectfully submitted,\n\n" +
  "______________________________\n\n" +
  "**PALMA RODRIGUEZ, IVIS MICHELL**<br>Respondent, Pro Se\n\n" +
  "Address: 6310 Bumfries Dr.<br>City / State / ZIP: Houston, TX 77096<br>Telephone: (346) 609-4183\n\n" +
  "Date: 07/21/2026";

/** Body of `n` paragraphs — tuned so the closing lands across the page 1→2 boundary. */
function body(n: number): string {
  return Array.from({ length: n }, (_, i) => `Filler paragraph number ${i + 1} lorem ipsum dolor sit amet consectetur adipiscing elit.`).join("\n\n");
}

async function pagesText(bytes: Uint8Array): Promise<string[]> {
  const mupdf = await import("mupdf");

  const M = mupdf as any;
  const doc = M.Document.openDocument(bytes, "application/pdf");
  const out: string[] = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    out.push(JSON.parse(st.asJSON()).blocks.flatMap((b: any) => (b.lines || []).map((l: any) => l.text)).join("\n"));
  }
  return out;
}

const pageOf = (pages: string[], needle: string) => pages.findIndex((p) => p.includes(needle));

describe("renderMarkdownToPdf — keep-together closing block", () => {
  // Pick a filler size where the closing straddles the boundary without the marker.
  const N = 22;

  it("WITHOUT the marker the closing block straddles a page boundary (precondition)", async () => {
    const pages = await pagesText(await renderMarkdownToPdf(`${body(N)}\n\n${CLOSING}`));
    const startP = pageOf(pages, "Respectfully submitted");
    const endP = pageOf(pages, "Date: 07/21/2026");
    expect(startP).toBeGreaterThanOrEqual(0);
    expect(endP).toBeGreaterThanOrEqual(0);
    expect(startP).not.toBe(endP); // the bug: the tail orphans onto the next page
  });

  it("WITH the marker the whole closing block stays on one page", async () => {
    const md = `${body(N)}\n\n${KEEP_TOGETHER_MARKER}${CLOSING}`;
    const pages = await pagesText(await renderMarkdownToPdf(md));
    const startP = pageOf(pages, "Respectfully submitted");
    const endP = pageOf(pages, "Date: 07/21/2026");
    expect(startP).toBeGreaterThanOrEqual(0);
    expect(startP).toBe(endP); // intact: salutation … date all on the same page
    // And it moved to a fresh page (not left dangling at the bottom of page 1).
    expect(startP).toBeGreaterThan(0);
  });

  it("does NOT add a page when the closing already fits (marker is a no-op then)", async () => {
    const short = `Short body paragraph.\n\n${CLOSING}`;
    const withMarker = `Short body paragraph.\n\n${KEEP_TOGETHER_MARKER}${CLOSING}`;
    const [a, b] = await Promise.all([
      pagesText(await renderMarkdownToPdf(short)),
      pagesText(await renderMarkdownToPdf(withMarker)),
    ]);
    expect(b.length).toBe(a.length); // no extra page forced
    expect(pageOf(b, "Respectfully submitted")).toBe(pageOf(b, "Date: 07/21/2026"));
    // The marker itself must never appear in the rendered text.
    expect(b.join("\n")).not.toContain("KEEPTOGETHER");
  });
});
