import { describe, it, expect, vi } from "vitest";
import { safeFetch, NonRetryableFetchError, RetryableFetchError } from "../safe-fetch";
import { SsrfError } from "../ssrf";

const publicLookup = vi.fn(async () => ({ address: "93.184.216.34", family: 4 }));

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : "body", { status, headers });
}

describe("safeFetch", () => {
  it("returns the response on a 200 (no redirect)", async () => {
    const fetchFn = vi.fn(async () => res(200));
    const out = await safeFetch("https://reuters.com/x", { fetchFn, lookup: publicLookup });
    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("follows a 302 to a public URL, re-validating the new host", async () => {
    const lookup = vi.fn(async () => ({ address: "93.184.216.34", family: 4 }));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(res(302, { location: "https://www.reuters.com/final" }))
      .mockResolvedValueOnce(res(200));
    const out = await safeFetch("https://reuters.com/x", { fetchFn, lookup });
    expect(out.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(2); // both hops validated
  });

  it("blocks a redirect that points at a private address (SSRF via redirect)", async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ address: "93.184.216.34", family: 4 }) // first host public
      .mockResolvedValueOnce({ address: "169.254.169.254", family: 4 }); // redirect target = metadata
    const fetchFn = vi.fn().mockResolvedValueOnce(res(302, { location: "https://evil.example/" }));
    await expect(safeFetch("https://news.example/x", { fetchFn, lookup })).rejects.toBeInstanceOf(SsrfError);
  });

  it("throws RetryableFetchError on a redirect with no Location", async () => {
    const fetchFn = vi.fn(async () => res(302));
    await expect(safeFetch("https://reuters.com/x", { fetchFn, lookup: publicLookup })).rejects.toBeInstanceOf(
      RetryableFetchError,
    );
  });

  it("throws NonRetryableFetchError after exceeding the redirect limit", async () => {
    const fetchFn = vi.fn(async () => res(302, { location: "https://reuters.com/loop" }));
    await expect(
      safeFetch("https://reuters.com/x", { fetchFn, lookup: publicLookup, maxRedirects: 2 }),
    ).rejects.toBeInstanceOf(NonRetryableFetchError);
  });
});
