import { describe, it, expect, vi } from "vitest";
import { checkUrlReachable, isLikelyUrl } from "../url-utils";

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
