import { describe, it, expect } from "vitest";
import { buildMailingCoverHtml, type MailingCoverRenderData } from "@/backend/platform/pdf";

/**
 * buildMailingCoverHtml — deterministic mailing-cover markup (pure, no mupdf).
 * Two envelope blocks (BIA + OPLA) on one US Letter page; only the sender name and
 * the OPLA address are variable. Asserting on HTML/CSS is more robust than a PDF
 * byte-snapshot (which drifts with the mupdf version).
 */
const data: MailingCoverRenderData = {
  senderName: "Jhonathan Arthur Arcaya Angeles",
  returnAddress: ["10951 N. Town Center Drive", "Highland, UT 84003"],
  envelopes: [
    {
      recipientLines: ["Board of Immigration Appeals", "5107 Leesburg Pike, Suite 2000", "Falls Church, VA 22041"],
      addressLines: [],
    },
    {
      recipientLines: ["Office of the Principal Legal Advisor (OPLA)", "U.S. Immigration and Customs Enforcement"],
      addressLines: ["500 North Orange Avenue, Suite 5000", "Orlando, FL 32801"],
    },
  ],
  spacing: { blockGapPt: 120, lineHeight: 1.5, fontSizePt: 13, marginPt: 96 },
};

describe("buildMailingCoverHtml", () => {
  it("renders both envelopes: sender + return + TO + recipient", () => {
    const html = buildMailingCoverHtml(data);
    expect(html).toContain("Jhonathan Arthur Arcaya Angeles");
    expect(html).toContain("10951 N. Town Center Drive");
    expect(html).toContain("Highland, UT 84003");
    expect(html).toContain("<div>TO</div>");
    expect(html).toContain("Board of Immigration Appeals");
    expect(html).toContain("Office of the Principal Legal Advisor (OPLA)");
  });

  it("includes the variable OPLA address (2 lines) only on the second envelope", () => {
    const html = buildMailingCoverHtml(data);
    expect(html).toContain("500 North Orange Avenue, Suite 5000");
    expect(html).toContain("Orlando, FL 32801");
  });

  it("repeats the sender name once per envelope (2 total)", () => {
    const html = buildMailingCoverHtml(data);
    const count = html.split("Jhonathan Arthur Arcaya Angeles").length - 1;
    expect(count).toBe(2);
    // Two 'TO' labels — one per envelope.
    expect(html.split("<div>TO</div>").length - 1).toBe(2);
  });

  it("applies the configured spacing (block gap between envelopes, margin, font) in pt", () => {
    const html = buildMailingCoverHtml(data);
    expect(html).toContain("height:120pt"); // block gap between the two envelopes
    expect(html).toContain("padding:96pt");
    expect(html).toContain("font-size:13pt");
    expect(html).toContain("line-height:1.5");
  });

  it("escapes HTML to prevent markup injection", () => {
    const html = buildMailingCoverHtml({ ...data, senderName: "A & B <script>" });
    expect(html).toContain("A &amp; B &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
