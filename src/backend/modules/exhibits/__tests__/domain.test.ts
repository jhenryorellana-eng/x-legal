import { describe, it, expect } from "vitest";
import {
  canTransitionExhibit,
  normalizeAndDedup,
  selectExhibitsToAttach,
  isErrorPageText,
  type RawSource,
  type NormalizedExhibit,
} from "../domain";

function src(partial: Partial<RawSource> & { url: string; citeOrder: number }): RawSource {
  return {
    title: null,
    publisher: null,
    publishedDate: null,
    supports: null,
    kind: "country_condition",
    exhibitLabel: null,
    ...partial,
  };
}

describe("canTransitionExhibit", () => {
  it("allows the fetch lifecycle and blocks illegal jumps", () => {
    expect(canTransitionExhibit("pending", "fetching")).toBe(true);
    expect(canTransitionExhibit("fetching", "ready")).toBe(true);
    expect(canTransitionExhibit("failed", "fetching")).toBe(true); // retry
    expect(canTransitionExhibit("ready", "pending")).toBe(false); // a ready exhibit is not re-queued
    expect(canTransitionExhibit("manual", "fetching")).toBe(false); // manual is terminal
  });
});

describe("normalizeAndDedup", () => {
  it("collapses the same article (different tracking) to one exhibit, lowest citeOrder wins", () => {
    const out = normalizeAndDedup([
      src({ url: "https://reuters.com/x?utm_source=a", citeOrder: 5, title: "second cite" }),
      src({ url: "https://www.reuters.com/x#frag", citeOrder: 2, title: "first cite" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].citeOrder).toBe(2);
    expect(out[0].title).toBe("first cite");
    expect(out[0].canonicalUrl).toBe("https://reuters.com/x");
    expect(out[0].urlHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("drops sources without a valid http(s) URL (a court exhibit needs a real source)", () => {
    const out = normalizeAndDedup([
      src({ url: "not a url", citeOrder: 1 }),
      src({ url: "ftp://example.com/a", citeOrder: 2 }),
      src({ url: "https://hrw.org/report", citeOrder: 3 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].canonicalUrl).toBe("https://hrw.org/report");
  });

  it("returns exhibits sorted by citeOrder (the legal order of the annexes)", () => {
    const out = normalizeAndDedup([
      src({ url: "https://a.com/3", citeOrder: 3 }),
      src({ url: "https://a.com/1", citeOrder: 1 }),
      src({ url: "https://a.com/2", citeOrder: 2 }),
    ]);
    expect(out.map((e) => e.citeOrder)).toEqual([1, 2, 3]);
  });
});

describe("selectExhibitsToAttach", () => {
  const norm = (over: Partial<NormalizedExhibit> & { citeOrder: number }): NormalizedExhibit => ({
    url: "https://x.com",
    canonicalUrl: "https://x.com",
    urlHash: "h",
    title: null,
    publisher: null,
    publishedDate: null,
    supports: null,
    kind: "country_condition",
    exhibitLabel: null,
    ...over,
  });

  it("keeps only the source kinds the admin enabled, preserving order", () => {
    const out = selectExhibitsToAttach(
      [
        norm({ citeOrder: 1, kind: "country_condition" }),
        norm({ citeOrder: 2, kind: "jurisprudence" }),
        norm({ citeOrder: 3, kind: "dataset" }),
      ],
      { enabledKinds: ["country_condition", "jurisprudence"] },
    );
    expect(out.map((e) => e.kind)).toEqual(["country_condition", "jurisprudence"]);
  });

  it("applies the optional cap (keeps the first N by citeOrder)", () => {
    const out = selectExhibitsToAttach(
      [norm({ citeOrder: 1 }), norm({ citeOrder: 2 }), norm({ citeOrder: 3 })],
      { enabledKinds: ["country_condition"], maxExhibits: 2 },
    );
    expect(out.map((e) => e.citeOrder)).toEqual([1, 2]);
  });
});

describe("isErrorPageText", () => {
  it("flags the real State Dept bot-block page (technical difficulties / forbidden)", () => {
    const t = "We're sorry, this site is currently experiencing technical difficulties. Please try again in a few moments. Exception: forbidden";
    expect(isErrorPageText(t, 48)).toBe(true);
  });

  it("flags Cloudflare / captcha interstitials regardless of length", () => {
    expect(isErrorPageText("Just a moment... Checking your browser before accessing the site. " + "x".repeat(5000), 1)).toBe(true);
    expect(isErrorPageText("Please verify you are human by completing the captcha below.", 1)).toBe(true);
  });

  it("flags an empty / near-empty render", () => {
    expect(isErrorPageText("", 1)).toBe(true);
    expect(isErrorPageText("   \n  ", 2)).toBe(true);
  });

  it("does NOT flag a long legal opinion that merely mentions 'forbidden'", () => {
    const realOpinion =
      "IMMIGRATION AND NATURALIZATION SERVICE v. CARDOZA-FONSECA. 480 U.S. 421. " +
      "The Court held that the well-founded fear standard is more generous than the clear-probability standard. " +
      "Section 243(h) requires withholding of deportation. ".repeat(40) +
      "Certain conduct is forbidden under the Act.";
    expect(isErrorPageText(realOpinion, 44)).toBe(false);
  });

  it("does NOT flag a normal country-conditions report", () => {
    const report =
      "Human Rights Watch World Report 2024: Venezuela. The government continued to detain and prosecute opponents. ".repeat(30);
    expect(isErrorPageText(report, 11)).toBe(false);
  });
});
