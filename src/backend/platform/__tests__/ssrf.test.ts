import { describe, it, expect, vi } from "vitest";
import { assertPublicUrl, SsrfError } from "../ssrf";

const publicLookup = vi.fn(async () => ({ address: "93.184.216.34", family: 4 }));

describe("assertPublicUrl", () => {
  it("rejects non-http(s) schemes without resolving DNS", async () => {
    const lookup = vi.fn();
    await expect(assertPublicUrl("ftp://example.com", { lookup })).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("file:///etc/passwd", { lookup })).rejects.toBeInstanceOf(SsrfError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks the cloud metadata IP literal (link-local) without DNS", async () => {
    const lookup = vi.fn();
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/", { lookup })).rejects.toThrow(
      /non-public/,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks private / loopback IP literals (v4 and v6)", async () => {
    const lookup = vi.fn();
    for (const ip of ["http://127.0.0.1/", "http://10.0.0.5/", "http://192.168.1.1/", "http://[::1]/"]) {
      await expect(assertPublicUrl(ip, { lookup })).rejects.toBeInstanceOf(SsrfError);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("allows a public IP literal", async () => {
    await expect(assertPublicUrl("https://93.184.216.34/", { lookup: vi.fn() })).resolves.toBeUndefined();
  });

  it("allows a hostname that resolves to a public address", async () => {
    await expect(assertPublicUrl("https://reuters.com/world", { lookup: publicLookup })).resolves.toBeUndefined();
    expect(publicLookup).toHaveBeenCalledWith("reuters.com");
  });

  it("blocks a hostname that resolves to a private address (DNS-based SSRF)", async () => {
    const lookup = vi.fn(async () => ({ address: "10.1.2.3", family: 4 }));
    await expect(assertPublicUrl("https://evil.example/", { lookup })).rejects.toThrow(/non-public/);
  });

  it("blocks an ipv4-mapped IPv6 pointing at loopback", async () => {
    await expect(assertPublicUrl("http://[::ffff:127.0.0.1]/", { lookup: vi.fn() })).rejects.toBeInstanceOf(
      SsrfError,
    );
  });
});
