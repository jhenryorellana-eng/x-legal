import { describe, it, expect, vi } from "vitest";
import { canonicalizeUrl, checkUrlReachable, isLikelyUrl, urlHash } from "../url-utils";

describe("isLikelyUrl", () => {
  it("accepts http/https URLs and rejects everything else", () => {
    expect(isLikelyUrl("https://courtlistener.com/x")).toBe(true);
    expect(isLikelyUrl("http://example.com")).toBe(true);
    expect(isLikelyUrl("not a url")).toBe(false);
    expect(isLikelyUrl("ftp://x")).toBe(false);
    expect(isLikelyUrl("")).toBe(false);
  });
});

describe("checkUrlReachable", () => {
  it("returns reachable:false for an invalid URL without calling fetch", async () => {
    const fetchFn = vi.fn();
    const r = await checkUrlReachable("not a url", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.reachable).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns reachable:true on a 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const r = await checkUrlReachable("https://x", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.reachable).toBe(true);
    expect(r.statusCode).toBe(200);
  });

  it("returns reachable:false on a 404", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const r = await checkUrlReachable("https://x", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.reachable).toBe(false);
    expect(r.statusCode).toBe(404);
  });

  it("falls back to GET when HEAD is not allowed (405)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 405 }) // HEAD
      .mockResolvedValueOnce({ ok: true, status: 200 }); // GET
    const r = await checkUrlReachable("https://x", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.reachable).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns reachable:false (with error) when fetch throws", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    const r = await checkUrlReachable("https://x", { fetchFn: fetchFn as unknown as typeof fetch });
    expect(r.reachable).toBe(false);
    expect(r.error).toContain("ENOTFOUND");
  });
});

describe("canonicalizeUrl", () => {
  it("drops the fragment, lowercases the host, strips a leading www, and removes a trailing slash", () => {
    expect(canonicalizeUrl("https://WWW.Reuters.com/world/article/#section")).toBe(
      "https://reuters.com/world/article",
    );
  });

  it("strips tracking params (utm_*, fbclid, gclid, mc_eid, ref_src) but keeps meaningful ones, sorted", () => {
    expect(
      canonicalizeUrl("https://reuters.com/x?utm_source=tw&fbclid=123&article=9&gclid=z&category=a"),
    ).toBe("https://reuters.com/x?article=9&category=a");
  });

  it("is stable: tracking noise, param order, www and case collapse to the same canonical form", () => {
    const a = canonicalizeUrl("https://www.HRW.org/report?b=2&a=1&utm_medium=email#top");
    const b = canonicalizeUrl("https://hrw.org/report?a=1&b=2&fbclid=xyz");
    expect(a).toBe(b);
  });

  it("preserves the path (no trailing-slash strip on the bare root)", () => {
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("throws on a non-http(s) or invalid URL (callers guard with isLikelyUrl)", () => {
    expect(() => canonicalizeUrl("not a url")).toThrow();
    expect(() => canonicalizeUrl("ftp://example.com")).toThrow();
  });
});

describe("urlHash", () => {
  it("is a deterministic 64-char hex digest of the canonical URL", () => {
    const h = urlHash(canonicalizeUrl("https://reuters.com/x?utm_source=tw"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(urlHash(canonicalizeUrl("https://reuters.com/x")));
  });

  it("differs for different canonical URLs", () => {
    expect(urlHash(canonicalizeUrl("https://reuters.com/a"))).not.toBe(
      urlHash(canonicalizeUrl("https://reuters.com/b")),
    );
  });
});
